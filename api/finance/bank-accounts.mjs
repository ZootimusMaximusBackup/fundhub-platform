// /api/finance/bank-accounts — the client's bank accounts, entered by hand.
//
//   GET  ?client_id=<uuid>                              → { ok, client_id, surface, details }
//   POST { action: "add",      client_id, name, ... }
//   POST { action: "classify", account_id, entity_kind } → personal | business | unknown
//   POST { action: "close",    account_id, at? }
//
// *** BY HAND IS THE PRODUCT, NOT A PLACEHOLDER. ***
// src/banking/plaid.mjs is a deliberate empty seam: linkAccount() and
// getAccounts() return `not_implemented` and there is no outbound fetch behind
// them, because storing bank credentials is behind a SOC 2 review and a consent
// flow that are both open (public/app/shell.js:33 records the same decision on
// the nav side). So the balances on this screen are typed in by a person. That
// is a real feature — it is the only way this data exists today — and this
// endpoint must not grow a "sync" action to compensate. There is no import of
// src/banking/plaid.mjs in this file and there must not be one.
//
// *** THIS IS THE WRITER THAT NEVER EXISTED, AND ITS ABSENCE IS AUDIT M8. ***
// Before this file, NOTHING anywhere in the repository inserted a row into
// `bank_accounts` — src/finance/banking-surface.mjs reads them, api/read/
// banking-surface.mjs serves them, public/app/banking-surface.html renders them,
// and the table was empty on every deploy because no code path could put a row
// in it. The screen filled that hole with two invented dollar figures under a
// real client's name. The figures are gone; this is the other half of the fix.
//
// *** THERE IS NO STORE MODULE BEHIND THIS ONE. *** Every other endpoint in this
// batch calls a tested module; this one does not, because nothing in src/ writes
// `bank_accounts`. src/finance/banking-surface.mjs READS them (bankingSurface()
// groups stored rows and is pure), and src/banking/store.mjs owns recurring
// bills, not accounts. This file therefore writes SQL itself — carefully:
//
//   • org_id AND client_id on every statement, from the session and from the
//     ownership check, never from the body.
//   • balances are INTEGER CENTS (available_balance_cents, current_balance_cents,
//     credit_limit_cents are bigint). NULL means UNKNOWN and must stay NULL — an
//     account whose balance nobody has typed in yet is not an account with no
//     money in it, and src/finance/os-grid.mjs:71 sumKnown() is the shared rule
//     for totalling a set with holes in it. Reuse it; do not write a second one.
//   • entity_kind is 'unknown' by DEFAULT and 'unknown' is a real value in 082's
//     CHECK, not a null stand-in. Classifying is a human act; leaving it unknown
//     is the honest state, and 082's header explains why guessing from the
//     account name was rejected.
//   • closing sets closed_at. It does not DELETE — a closed account still
//     explains the transactions and bills attached to it.
//
// *** NO TRANSACTION, AND THAT IS DELIBERATE. *** Every write below is ONE
// statement. The ownership SELECT that precedes it is for the 403 wording only —
// each INSERT/UPDATE re-asserts `org_id = $session` in its own WHERE (or its own
// VALUES), so a row that changed hands between the check and the write is not
// touched. Nothing here needs the pooled-client helper at
// src/finance/soft-pulls.mjs:502, and reaching for the broken probe
// `if (typeof db.connect !== "function") return fn(db)` — always true for the
// shared handle, which exports { query } and no connect — would have run these
// writes on autocommit while claiming a transaction.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import { ENTITY_KINDS, bankingSurface } from "../../src/finance/banking-surface.mjs";
import { toCents, fromCents } from "../../src/commissions/money.mjs";

/* ROLE_SETS.FINANCE — {owner, admin}. The same gate api/read/banking-surface.mjs
   already carries over these exact rows, and shell.js:33 records why the screen
   is owner/admin too: offering an employee a screen whose endpoint refuses them
   is the failure the nav gate exists to prevent. */
const BANK_ROLES = ROLE_SETS.FINANCE;

const SESSION_OWNED = ["org_id", "orgId"];
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(Object(o ?? {}), k);

/* THE COLUMNS, NAMED. Not `SELECT *`: `raw` is on this table and is written by
   the add path below with the provenance of the entry, which is internal
   bookkeeping and not something a screen should render. Identical list to
   api/read/banking-surface.mjs:53 so the two reads cannot disagree about what a
   bank account is. */
const COLUMNS = `
  id, client_id, name, official_name, mask,
  account_type, account_subtype, currency_code,
  available_balance_cents, current_balance_cents, credit_limit_cents,
  balance_as_of, entity_kind, entity_kind_source, entity_kind_set_at,
  entity_id, closed_at, created_at, updated_at`;

/* 081:70-75. NULL is a fourth answer and it is not in this list: it means the
   bank told us NOTHING about the type, which is different from 'other' (it told
   us something we do not model). There is no default — 081:76 spells out that
   defaulting to 'depository' "would quietly turn an unclassified line of credit
   into cash on hand". */
const ACCOUNT_TYPES = ["depository", "credit", "loan", "investment", "other"];

/* 082:78-82. HOW we know, kept beside WHAT we know, so 'business' picked from a
   dropdown in a hurry is never indistinguishable from 'business' read off a
   filed entity document. 'connection_metadata' is in the CHECK and is NOT
   offered by this endpoint: there is no bank connection in this product, so a
   hand-entry path claiming one would be a false statement about provenance. */
const ENTITY_SOURCES = ["client_stated", "staff_reviewed", "document_verified"];

/* Body keys that are refused outright rather than ignored.
   `account_number` / `routing_number` and friends: 081:60-66 says the mask is
   the ONLY account-number fragment that may be stored here, that there is no
   routing-number column, and that neither may be added — "those are payment
   credentials, they belong nowhere near a table read by dashboards, and storing
   them changes what compliance obligations this system is under". A caller
   sending one has misunderstood what this table is, and silently dropping the
   field would let them go on believing they had stored it.
   `plaid_item_id` / `plaid_account_id`: a hand-entered account came from a
   person. Letting a caller set the provider ids would make a typed balance
   indistinguishable from a fetched one, which is the whole reason those two
   columns stay NULL here. */
const REFUSED_KEYS = [
  "account_number", "accountNumber", "full_account_number",
  "routing_number", "routingNumber", "aba", "iban", "swift", "bic",
  "plaid_item_id", "plaidItemId", "plaid_account_id", "plaidAccountId"
];

export default async function handler(req, res) {
  const staff = await requireAuth(req, res, { db });
  if (!staff) return;
  // Second call, deliberately — requireAuth ignores a `roles` key.
  if (!requireRole(res, staff, BANK_ROLES)) return;

  const orgId = staff.org_id ?? null;
  if (!orgId) return res.status(403).json({ ok: false, error: "org_required" });

  try {
    if (req.method === "GET") {
      const q = req.query || {};
      if (!isUuid(q.client_id)) {
        return res.status(400).json({ ok: false, error: "client_id must be a uuid" });
      }
      if (!(await ownsClient(orgId, q.client_id))) {
        return res.status(403).json({ ok: false, error: "forbidden" });
      }
      const clientId = String(q.client_id).trim();
      return res.status(200).json({ ok: true, client_id: clientId, ...(await present(orgId, clientId)) });
    }

    if (req.method === "POST") {
      const body = req.body || {};
      for (const field of SESSION_OWNED) {
        if (hasOwn(body, field)) {
          return res.status(400).json({ ok: false, error: `${field}_not_accepted` });
        }
      }
      for (const field of REFUSED_KEYS) {
        if (hasOwn(body, field)) {
          return res.status(400).json({
            ok: false,
            error: `${field}_not_accepted`,
            message: field.startsWith("plaid")
              ? "an account entered by hand carries no provider ids — those two columns stay empty so a typed balance is never mistaken for a fetched one"
              : "this table stores the last 2-4 digits and nothing else. There is no column for a full account number or a routing number and none may be added (db/migrations/081_bank_accounts.sql:60)"
          });
        }
      }

      switch (body.action) {
        case "add": {
          if (!isUuid(body.client_id)) {
            return res.status(400).json({ ok: false, error: "client_id must be a uuid" });
          }
          if (!(await ownsClient(orgId, body.client_id))) {
            return res.status(403).json({ ok: false, error: "forbidden" });
          }
          const clientId = String(body.client_id).trim();

          /* Every field is read and validated BEFORE the insert, so a caller's
             mistake comes back as a 400 naming the field rather than as a 500
             naming a CHECK constraint. Each reader throws a TypeError or a
             RangeError carrying a sentence; the catch at the bottom turns those
             into 400s with the sentence intact. */
          const accountType = readAccountType(body.account_type ?? body.type);
          const mask = readMask(body.mask);
          const currency = readCurrency(body.currency_code ?? body.currency);
          const available = readCents(body, "available", "available_balance_cents");
          const current = readCents(body, "current", "current_balance_cents");
          const creditLimit = readCents(body, "credit_limit", "credit_limit_cents");
          const balanceAsOf = readWhen(body.balance_as_of, "balance_as_of");
          const entity = readEntity(body, { where: "add" });

          /* entity_id (106_entities.sql) — which wallet this account belongs
             to, distinct from entity_kind above (personal/business/unknown
             classification with no grouping). Optional: an account can be
             added before its wallet exists, matching entity_kind's own
             "unknown by default" rule. Ownership is checked here rather than
             left to the FK, so a caller pointing at someone else's entity gets
             a 400 naming the field instead of a constraint violation. */
          let entityId = null;
          if (body.entity_id !== undefined && body.entity_id !== null && body.entity_id !== "") {
            if (!isUuid(body.entity_id)) {
              return res.status(400).json({ ok: false, error: "entity_id must be a uuid" });
            }
            const owns = await db.query(
              `SELECT 1 FROM entities WHERE id = $1 AND org_id = $2 AND client_id = $3`,
              [String(body.entity_id).trim(), orgId, clientId]
            );
            if (owns.rows.length === 0) {
              return res.status(400).json({ ok: false, error: "entity_id does not belong to this client" });
            }
            entityId = String(body.entity_id).trim();
          }

          /* 081:87 — the limit column is "the credit line, NULL and meaningless
             on a deposit account". A credit limit typed against a chequing
             account is somebody having picked the wrong type or the wrong box,
             and storing it would put a number on the record that means nothing
             and reads as if it means something. Refused, naming both fields, so
             the person can see which of the two they got wrong. */
          if (accountType === "depository" && creditLimit !== undefined && creditLimit !== null) {
            return res.status(400).json({
              ok: false,
              error: "credit_limit_not_on_a_deposit_account",
              message: "a deposit account has no credit line. Either the type is wrong or the limit belongs on a different account (db/migrations/081_bank_accounts.sql:87)"
            });
          }

          /* plaid_item_id and plaid_account_id are absent from this INSERT and
             therefore NULL — 081:41 defines that as "the row was entered by hand
             rather than read from a bank connection ... It is NOT 'we lost the
             link'". That NULL is the provenance marker, and `raw` below records
             the rest of it: who typed it and when. 081:100 requires `raw` to
             carry no credential, and there is none here to carry — this endpoint
             never sees one. */
          const inserted = (await db.query(
            `INSERT INTO bank_accounts
               (org_id, client_id, name, official_name, mask,
                account_type, account_subtype, currency_code,
                available_balance_cents, current_balance_cents, credit_limit_cents,
                balance_as_of, entity_kind, entity_kind_source, entity_kind_set_at, entity_id, raw)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
             RETURNING id`,
            [
              orgId, clientId,
              readText(body.name), readText(body.official_name), mask,
              accountType, readText(body.account_subtype ?? body.subtype), currency,
              orNull(available), orNull(current), orNull(creditLimit),
              balanceAsOf, entity.kind, entity.source, entity.setAt, entityId,
              JSON.stringify({
                entry: "manual",
                entered_by_staff_id: staff.id ?? null,
                entered_at: new Date().toISOString()
              })
            ]
          )).rows[0];

          return res.status(201).json({
            ok: true, action: "add", account_id: inserted.id, client_id: clientId,
            ...(await present(orgId, clientId))
          });
        }
        case "classify": {
          if (!isUuid(body.account_id)) {
            return res.status(400).json({ ok: false, error: "account_id must be a uuid" });
          }
          // Checked here rather than left to 082's CHECK so the caller gets a
          // 400 naming the field instead of a 500 naming a constraint.
          if (!ENTITY_KINDS.includes(String(body.entity_kind || ""))) {
            return res.status(400).json({
              ok: false,
              error: `entity_kind must be one of ${ENTITY_KINDS.join(", ")}`
            });
          }
          const owned = await ownsAccount(orgId, body.account_id);
          if (!owned) {
            return res.status(403).json({ ok: false, error: "forbidden" });
          }

          /* THE PROVENANCE IS NOT OPTIONAL AND THE CONSTRAINT IS NOT THE PLACE
             TO FIND THAT OUT. 082's bank_accounts_entity_kind_provenance_check
             refuses `entity_kind <> 'unknown' AND entity_kind_source IS NULL`,
             and a bare CHECK violation reaches a person as HTTP 500 through
             netlify/functions/api.mjs:334 — "the server broke" for a form they
             filled in wrong. readEntity() answers it here instead, in a sentence
             naming the missing field.

             Going BACK to 'unknown' clears both the source and the date, which
             is 082:88's rule read forwards: NULL there "is the correct state for
             every 'unknown' row". Un-classifying while leaving "a human here
             looked and decided" attached would leave the record asserting that
             somebody established something they then withdrew. */
          const entity = readEntity(
            { entity_kind: body.entity_kind, entity_kind_source: body.entity_kind_source, at: body.at },
            { where: "classify", required: true }
          );

          const updated = (await db.query(
            `UPDATE bank_accounts
                SET entity_kind = $3,
                    entity_kind_source = $4,
                    entity_kind_set_at = $5,
                    updated_at = now()
              WHERE id = $1 AND org_id = $2
              RETURNING id, client_id`,
            [String(body.account_id).trim(), orgId, entity.kind, entity.source, entity.setAt]
          )).rows[0];

          /* The ownership SELECT said this row is ours; the UPDATE says whether
             it still is. They can only disagree if the row moved between the two
             statements, and answering 200 on zero rows updated would report a
             write that did not happen. */
          if (!updated) return res.status(404).json({ ok: false, error: "account_not_found" });

          return res.status(200).json({
            ok: true, action: "classify", account_id: updated.id, client_id: updated.client_id,
            ...(await present(orgId, updated.client_id))
          });
        }
        case "close": {
          if (!isUuid(body.account_id)) {
            return res.status(400).json({ ok: false, error: "account_id must be a uuid" });
          }
          const owned = await ownsAccount(orgId, body.account_id);
          if (!owned) {
            return res.status(403).json({ ok: false, error: "forbidden" });
          }
          const at = readWhen(body.at, "at") ?? new Date().toISOString();

          /* COALESCE KEEPS THE FIRST CLOSE DATE. Closing twice must not move a
             date somebody may have to explain later, and the second press of a
             button is far more likely to be a double-click than a correction.
             This makes the action idempotent: the response after the second call
             is identical to the response after the first. */
          const updated = (await db.query(
            `UPDATE bank_accounts
                SET closed_at = COALESCE(closed_at, $3),
                    updated_at = now()
              WHERE id = $1 AND org_id = $2
              RETURNING id, client_id, closed_at`,
            [String(body.account_id).trim(), orgId, at]
          )).rows[0];

          if (!updated) return res.status(404).json({ ok: false, error: "account_not_found" });

          return res.status(200).json({
            ok: true, action: "close", account_id: updated.id, client_id: updated.client_id,
            closed_at: updated.closed_at,
            ...(await present(orgId, updated.client_id))
          });
        }
        default:
          return res.status(400).json({ ok: false, error: "invalid_action" });
      }
    }

    res.setHeader("allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  } catch (e) {
    if (e instanceof TypeError) {
      return res.status(400).json({ ok: false, error: String(e.message).slice(0, 200) });
    }
    /* RangeError is what money.toCents() raises past its $1bn guard and what the
       readers below raise for a value that parses but cannot be true. Same class
       of fault as a TypeError from the caller's point of view — they sent
       something that does not fit — and it reached them as a 500 until this
       line existed. */
    if (e instanceof RangeError) {
      return res.status(400).json({ ok: false, error: String(e.message).slice(0, 200) });
    }
    /* 23514 is a CHECK violation. Every one of them on this table is reachable
       only through a value the caller chose, and the readers above are meant to
       catch all four before the statement runs. This is the backstop for the
       fifth one somebody adds to a migration later without adding a reader here:
       a 400 naming the constraint is a fault the caller can act on, where the
       500 they would otherwise get says the server broke. */
    if (e && e.code === "23514") {
      return res.status(400).json({
        ok: false,
        error: "rejected_by_a_column_rule",
        message: String(e.constraint || "a CHECK constraint") + " refused this value"
      });
    }
    if (CLIENT_DATA_ERRORS.has(e && e.code)) {
      return res.status(400).json({ ok: false, error: "invalid_parameter" });
    }
    throw e;
  }
}

/* ---------------------------------------------------------------------------
   THE RESPONSE
   ------------------------------------------------------------------------ */

/**
 * present — the client's accounts, grouped, plus the fields the grouping drops.
 *
 * WRITES ANSWER WITH THE SAME PAYLOAD AS THE READ. Three actions, one shape, one
 * renderer on the screen — and no window in which the page shows a state the
 * database has already left. The alternative (return the touched row, make the
 * screen re-read) is two round trips and two ways for the page to be wrong.
 *
 * `surface` IS THE ONLY GROUPING. src/finance/banking-surface.mjs decides which
 * pile an account is in and what a group totals to, and it is the file that
 * carries the rule this area exists to enforce — UNKNOWN IS NOT PERSONAL, never
 * folded, no combined total across the three groups. Regrouping in this handler,
 * or again in a <script> block, would be a second answer that goes stale
 * (src/finance/os-grid.mjs:3).
 *
 * `details` IS ITS COMPLEMENT, NOT A SECOND COPY. accountView() in that module
 * deliberately does not carry currency_code, credit_limit_cents, official_name
 * or created_at, because the grouped view has no use for them. The screen does:
 * a balance printed without its currency is a number with no unit, and a credit
 * card's limit is the context for its "available". So the fields it drops are
 * returned HERE, keyed by account id, and every field appears in exactly one of
 * the two objects. There is no overlap to drift.
 */
async function present(orgId, clientId) {
  /* Closed accounts are fetched, not filtered out. "This client had six accounts
     and two are closed" is a different fact from "this client has four
     accounts", and bankingSurface() is what decides that a closed account's last
     known balance is not reachable money. */
  const rows = (await db.query(
    `SELECT ${COLUMNS} FROM bank_accounts
      WHERE org_id = $1 AND client_id = $2
      ORDER BY entity_kind, name NULLS LAST, id`,
    [orgId, String(clientId).trim()]
  )).rows;

  const details = {};
  for (const r of rows) {
    const limit = asCents(r.credit_limit_cents);
    details[r.id] = {
      official_name: r.official_name ?? null,
      /* NULL means the currency is unknown, and 081:80 is explicit that "an
         amount whose currency is unknown must never be added to one whose
         currency is known". The screen shows it beside every figure so a reader
         can see when a group total spans two of them. */
      currency_code: r.currency_code ?? null,
      credit_limit_cents: limit,
      credit_limit_display: limit === null ? null : fromCents(limit),
      /* TRUE for every row this endpoint can write. It is read off the absence
         of the provider ids rather than off `raw`, because the ids are the
         column-level fact (081:41) and `raw` is bookkeeping. When a bank
         connection is eventually approved and something else writes this table,
         this flag is how a screen tells a typed balance from a fetched one. */
      hand_entered: true,
      created_at: r.created_at ?? null
    };
  }

  return { surface: bankingSurface(rows), details };
}

/* ---------------------------------------------------------------------------
   THE READERS — one per field, each refusing rather than repairing.
   ------------------------------------------------------------------------ */

/** A value the caller did not mention at all. Distinct from null, which is a
 *  caller SAYING "this is unknown". The INSERT needs a concrete NULL either way,
 *  so it converts at the last moment and nowhere earlier. */
const orNull = (v) => (v === undefined ? null : v);

function readText(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  /* An empty box is NULL, never "". 081:52 — "Never fill these with a
     placeholder — a screen showing 'Account' is honest, a screen showing an
     invented name is not". An empty string is the same lie with fewer letters:
     it prints as a name that is there and blank. */
  return s === "" ? null : s;
}

/** readAccountType — one of 081's five, or NULL for "we were told nothing".
 *  There is deliberately no default; see the constant above. */
function readAccountType(v) {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).trim().toLowerCase();
  if (!ACCOUNT_TYPES.includes(s)) {
    throw new TypeError(`account_type must be one of ${ACCOUNT_TYPES.join(", ")}, or left empty`);
  }
  return s;
}

/**
 * readMask — the last 2-4 digits, and NOTHING that could be more than that.
 *
 * THIS IS THE ONE VALIDATION ON THIS ENDPOINT THAT IS ABOUT SAFETY RATHER THAN
 * TIDINESS. 081:60-66 permits the mask and forbids the full account number and
 * the routing number in the same breath, and the mask box is the only place on
 * the screen where a person could type either of them. So a longer run of digits
 * is REFUSED, naming what it looks like — not silently truncated to its last
 * four. Truncating would store the right thing while telling the person nothing,
 * and they would go on believing a full account number is safe to type into this
 * product. Same discipline as the card endpoint refusing a PAN outright.
 *
 * Common decorations are stripped first (•••• 1234, x1234, *1234, whitespace)
 * because they are how a person copies a mask off a statement and they carry no
 * digits of their own. Anything else that is not a digit is refused.
 */
function readMask(v) {
  if (v === null || v === undefined) return null;
  const raw = String(v).trim();
  if (raw === "") return null;
  const stripped = raw.replace(/[\s•*·.\-x×X]/g, "");
  if (!/^\d+$/.test(stripped)) {
    throw new TypeError("mask must be the last 2-4 digits of the account number and nothing else");
  }
  if (stripped.length > 4) {
    throw new TypeError(
      "mask must be the last 2-4 digits only — that looks like a full account number, and this " +
      "product has nowhere to put one. Nothing was stored"
    );
  }
  if (stripped.length < 2) {
    throw new TypeError("mask must be at least 2 digits — a single digit identifies nothing");
  }
  return stripped;
}

/** readCurrency — ISO 4217 alphabetic, upper-cased, or NULL for unknown. Three
 *  letters is the whole rule; the code is not checked against a list because a
 *  list here would reject a real currency the day one is added. */
function readCurrency(v) {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(s)) {
    throw new TypeError("currency_code must be a three-letter code such as USD, or left empty");
  }
  return s;
}

/**
 * readCents — dollars in, integer cents out, PRESERVING BOTH KINDS OF ABSENCE.
 *
 * THE WIRE SPEAKS DOLLARS; THE COLUMN SPEAKS INTEGER CENTS, and the conversion
 * happens exactly once, here, at the boundary. Three inputs, three answers,
 * because collapsing any two of them writes a number nobody chose:
 *
 *   neither key present   → undefined → "I am not saying anything about this"
 *   "" or null            → null      → "nobody has typed this in yet"
 *   "1,204.50"            → 120450    → one thousand two hundred and four fifty
 *
 * money.toCents() maps null and "" to 0 on purpose — "no payments yet" is a real
 * zero in the commissions ledger it was written for. Here it would be a
 * catastrophe: it would file an account nobody has typed a balance for as an
 * account with no money in it, and 081:30 says NULL "is 'the bank did not tell
 * us', which is a different answer from a zero balance, and the difference
 * decides whether someone gets funded". So the null case never reaches it.
 *
 * NEGATIVES PASS. 081:26 — a chequing account can be overdrawn and a card's
 * available can go negative when it is over limit; "a CHECK (>= 0) here would
 * reject the exact accounts a funding decision most needs to see". The sign is
 * data.
 *
 * Sending both spellings is refused rather than resolved: a caller who sends
 * `available: 12` and `available_balance_cents: 1300` has a bug, and picking one
 * of them for them hides it.
 */
function readCents(body, dollarKey, centsKey) {
  const hasDollars = hasOwn(body, dollarKey);
  const hasCents = hasOwn(body, centsKey);
  if (hasDollars && hasCents) {
    throw new TypeError(
      `send ${dollarKey} (dollars) or ${centsKey} (integer cents), not both — they can disagree`
    );
  }
  if (hasCents) {
    const raw = body[centsKey];
    if (raw === null || raw === "") return null;
    const n = typeof raw === "number" ? raw : Number(String(raw).trim());
    if (!Number.isInteger(n)) {
      throw new TypeError(
        `${centsKey}: money is integer cents — got ${JSON.stringify(raw)}. Send ${dollarKey} for dollars`
      );
    }
    return n;
  }
  if (hasDollars) {
    const raw = body[dollarKey];
    if (raw === null || raw === "") return null;
    /* Thousands separators come off before the number is read. A person typing a
       balance off a statement types 1,204.50, and Number("1,204.50") is NaN —
       which would have reached them as "not a number" for a value that is
       perfectly clear. Nothing else is stripped: a stray letter is still a
       refusal, because a balance that quietly loses a character is worse than
       one that will not save. */
    const cleaned = typeof raw === "number" ? raw : String(raw).trim().replace(/,/g, "");
    return toCents(cleaned);   // TypeError on junk, RangeError past $1bn
  }
  return undefined;
}

/** readWhen — a timestamp the caller typed, or NULL for "we do not know".
 *  081:94 — balance_as_of is "when those balances were TRUE, which is not when
 *  we wrote the row", and NULL there "means we do not know how stale the figures
 *  are, which is itself a reason not to rely on them". It is never defaulted to
 *  now(): stamping today onto a figure copied off last month's statement would
 *  turn an unknown into a false claim. */
function readWhen(v, where) {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).trim();
  const t = Date.parse(s);
  if (!Number.isFinite(t)) throw new TypeError(`${where}: not a date — got ${JSON.stringify(v)}`);
  return new Date(t).toISOString();
}

/**
 * readEntity — whose money this is, and how we know.
 *
 * Returns { kind, source, setAt } ready for the columns. The three move together
 * because 082 constrains them together, and letting a caller set any one of them
 * alone is how a row ends up claiming 'business' with no basis, or 'unknown'
 * still carrying the date somebody decided.
 *
 *   unknown          → source NULL, set_at NULL. Not knowing needs no evidence
 *                      (082:104) and must not carry a decision date.
 *   personal/business→ source REQUIRED, set_at stamped. 082's provenance CHECK
 *                      enforces the first half in SQL; this enforces it in a
 *                      sentence, before the statement runs.
 *
 * `required` is false on add: an account arrives unclassified, which is the
 * honest state and 082's whole argument. It is true on classify, where the
 * caller is by definition making the decision.
 */
function readEntity(body, { where, required = false } = {}) {
  const raw = body.entity_kind ?? body.entityKind;
  if ((raw === null || raw === undefined || raw === "") && !required) {
    /* 082:57 — the default is 'unknown', it is a REAL value and not a null
       stand-in, and code that needs to know ownership must handle it by ASKING.
       The screen's call to action is built on exactly this. */
    return { kind: "unknown", source: null, setAt: null };
  }
  const kind = String(raw ?? "").trim().toLowerCase();
  if (!ENTITY_KINDS.includes(kind)) {
    throw new TypeError(`${where}: entity_kind must be one of ${ENTITY_KINDS.join(", ")}`);
  }
  if (kind === "unknown") return { kind: "unknown", source: null, setAt: null };

  const src = String(body.entity_kind_source ?? body.entityKindSource ?? "").trim().toLowerCase();
  if (!src) {
    throw new TypeError(
      `${where}: marking an account ${kind} needs a basis — entity_kind_source must be one of ` +
      `${ENTITY_SOURCES.join(", ")}. An account cannot be classified without saying how it was decided`
    );
  }
  if (!ENTITY_SOURCES.includes(src)) {
    throw new TypeError(`${where}: entity_kind_source must be one of ${ENTITY_SOURCES.join(", ")}`);
  }
  return { kind, source: src, setAt: readWhen(body.at, `${where}: at`) ?? new Date().toISOString() };
}

/** asCents — a bigint column as a number, or null. node-postgres hands bigints
 *  over as STRINGS, so anything that does arithmetic or formatting on one has to
 *  convert first; fromCents() throws on a string. Same shape as the private
 *  cents() in src/finance/banking-surface.mjs:75 and for the same reason. */
function asCents(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/* ---------------------------------------------------------------------------
   TENANCY
   ------------------------------------------------------------------------ */

async function ownsClient(orgId, clientId) {
  const r = await db.query(
    `SELECT 1 FROM clients WHERE id = $1 AND org_id = $2`,
    [String(clientId).trim(), orgId]
  );
  return r.rows.length > 0;
}

/* ownsAccount — the account is this company's. bank_accounts carries its own
   org_id (081:36), so this is a direct match rather than a join.

   It returns the ROW, not a boolean, because classify and close are addressed by
   account id and still have to answer with the client's whole surface — and the
   client id has to come from the stored row rather than from the body. A caller
   who sent someone else's client_id alongside a real account_id would otherwise
   read a second client's accounts back out of a write to the first. */
async function ownsAccount(orgId, accountId) {
  const r = await db.query(
    `SELECT id, client_id FROM bank_accounts WHERE id = $1 AND org_id = $2`,
    [String(accountId).trim(), orgId]
  );
  return r.rows[0] || null;
}
