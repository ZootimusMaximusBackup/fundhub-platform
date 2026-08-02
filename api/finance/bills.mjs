// /api/finance/bills — the recurring bills detected from a client's bank
// transactions, and the button that re-runs the detector.
//
//   GET  ?client_id=<uuid>[&bank_account_id=][&include_candidates=1]
//        → { ok, bills, candidates }
//   GET  ?bill_id=<uuid>                → { ok, evidence }  the charges behind one bill
//   POST { action: "redetect", client_id[, bank_account_id] }
//        → { ok, bills, candidates, evidenceLinked, ... }
//
// *** A CANDIDATE IS NOT A BILL, AND THE TWO MUST NOT SHARE A RENDERING. ***
// detectRecurringBills() returns four lists and they mean different things:
//   bills       medium/high confidence — safe to present as a bill
//   candidates  LOW confidence — stored, but MUST NOT be presented as a bill
//   rejected    no usable cadence was found; never stored, nothing to show
//   excluded    individual input rows that could not be read
// listRecurringBills() defaults `presentableOnly: true` and that default is the
// safety rail: a caller who has not thought about confidence gets only the rows
// that are safe to show a person. `include_candidates=1` is a deliberate act
// with a name attached, and the screen must label what it then draws.
//
// THE RAIL IS KEPT AT THE RESPONSE BOUNDARY RATHER THAN AT THE QUERY. This file
// reads with `presentableOnly: false` — ONE query — and then splits the rows on
// `confidence_label` into two SEPARATE response keys. The rail survives, because
// `candidates` is only populated when the caller asked for it by name, and it is
// structurally impossible for a candidate to arrive inside `bills`. What it buys
// is `candidate_count`, which is always honest: a screen showing four bills can
// say "and three more merchants looked like bills but we are not confident
// enough to call them that" without a second round trip. "We found something
// here and chose not to show it as a bill" and "we found nothing" are different
// statements and a person deciding what to trust needs both.
//
// *** TWO VOCABULARIES, AND MIXING THEM FAILS SILENTLY. ***
//   listRecurringBills()    → raw snake_case database rows
//   listRecurringBillsFor() → camelCase, via fromBillRow(), with next_expected_on
//                             RENAMED to nextExpectedDate
// Feeding raw rows to the cash-flow seam threw nothing and produced a client
// with NO BILLS AT ALL — which reads as "you are fine" rather than "we could not
// read your bills". The whole account is at src/banking/recurring.mjs:1169. Use
// listRecurringBillsFor() for anything heading into a projection, and
// listRecurringBills() for anything heading at a screen that expects columns.
// THIS FILE FEEDS A SCREEN, so it uses the snake_case read throughout;
// api/finance/cashflow.mjs feeds the projector and uses the other one.
//
// *** `now` IS REQUIRED AND HAS NO DEFAULT. *** detectRecurringBills() throws
// without it: "an answer that depends on when it ran cannot be tested or
// audited". The redetect path below passes an explicit instant, and stores it —
// `detected_as_of` on every row is the `now` the detector was given, not the
// moment the INSERT ran.
//
// *** NOTHING HERE READS A BANK. *** src/banking/plaid.mjs is a deliberate empty
// seam that answers not_implemented, so every row in `bank_transactions` got
// there because a person put it there. "Run detection" reads what is already
// stored and infers a pattern from it; it does not fetch, sync or refresh
// anything. If a client's history is three weeks old, this endpoint's answer is
// three weeks old and cannot be made fresher from here.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import {
  listRecurringBills,
  getBillEvidence,
  saveDetection
} from "../../src/banking/store.mjs";
import { detectRecurringBills, PRESENTABLE_LABELS, normaliseMerchant, CADENCE_NAMES } from "../../src/banking/recurring.mjs";
import { fromCents, toCents } from "../../src/commissions/money.mjs";
import { dbDown } from "../../src/http/db-down.mjs";

/* ROLE_SETS.FINANCE — {owner, admin}. These rows are derived from bank
   transactions and are exactly as sensitive as the balances
   api/read/banking-surface.mjs already gates this way. bills-cashflow.html sits
   in public/app/shell.js OWNER_ADMIN_ONLY to match. */
const BILL_ROLES = ROLE_SETS.FINANCE;

const SESSION_OWNED = ["org_id", "orgId"];
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(Object(o ?? {}), k);

/* HOW MANY TRANSACTIONS ONE DETECTION RUN READS.
   The detector is pure and in-memory, and a client with four years of history on
   three accounts is comfortably tens of thousands of rows — inside a 10-second
   function budget that is a timeout, not a slow answer. So the read is bounded
   and takes the MOST RECENT rows, which are the ones a cadence is inferred from.
   Being cut off is REPORTED (`transactions_capped`) rather than absorbed: a
   detection run over a truncated history can miss an annual bill entirely, and
   "we only looked at the last 5,000 charges" is a fact the person reading the
   answer needs, not an implementation detail. */
const TX_CAP = 5000;

/* A stored bill as the screen needs to read it.
 *
 * A bigint column arrives from node-postgres as a STRING. Every amount that
 * leaves this file carries a 2dp display string computed HERE, by
 * money.fromCents(), because -54.99 as a JavaScript float is not -54.99 and a
 * screen that formats money is a second answer to how money looks. NULL survives
 * as null and the screen renders it as an em dash — never as "0.00", which is a
 * claim.
 *
 * AND THE THREE DATE COLUMNS ARE PUT BACK TO YYYY-MM-DD HERE. This is the same
 * defect fromBillRow() documents at src/banking/recurring.mjs, arriving by a
 * different door: a `date` column decodes to a Date at LOCAL midnight, and
 * JSON.stringify turns that into "2026-08-12T00:00:00.000Z" — which east of
 * Greenwich is THE DAY BEFORE the day that was stored. A next-expected date one
 * day out is a bill the client thinks lands on the 11th when it lands on the
 * 12th. This file does not go through fromBillRow (it deliberately speaks the
 * snake_case column vocabulary the screen's table is built on), so it applies the
 * same rule itself rather than leaving raw Dates on the wire.
 */
function withAmount(row) {
  if (!row) return null;
  const cents = row.typical_amount_cents;
  const n = cents === null || cents === undefined ? null : Number(cents);
  return {
    ...row,
    typical_amount_cents: n,
    typical_amount_display: Number.isInteger(n) ? fromCents(n) : null,
    next_expected_on: dayString(row.next_expected_on),
    first_seen_on: dayString(row.first_seen_on),
    last_seen_on: dayString(row.last_seen_on),
    // A timestamptz, not a date. It is an instant and it keeps its time.
    detected_as_of: row.detected_as_of ? String(new Date(row.detected_as_of).toISOString()) : null
  };
}

/* A `date` column arrives as a Date decoded to LOCAL midnight. Serialised into
   JSON it becomes "2026-07-15T00:00:00.000Z" — and east of Greenwich it becomes
   THE DAY BEFORE, because local midnight is the previous day in UTC. Reading the
   local parts is the only reading that recovers the stored day. Same rule and
   same reason as fromBillRow() in src/banking/recurring.mjs. */
function dayString(value) {
  if (value === null || value === undefined || value === "") return null;
  if (!(value instanceof Date)) return String(value).slice(0, 10);
  if (Number.isNaN(value.getTime())) return null;
  const p = (n) => String(n).padStart(2, "0");
  return `${value.getFullYear()}-${p(value.getMonth() + 1)}-${p(value.getDate())}`;
}

/* One evidence transaction as the screen needs it. Shaped by hand rather than
   passed through, for two reasons: `raw` is the whole unparsed provider record
   and can be kilobytes per row, and a hand-written column list is a list a
   reviewer can read. Amounts keep their sign — 085's convention is that an
   outflow is negative, and flipping it here would be the un-reviewed sign flip
   that file's header calls the most expensive mistake available. */
function evidenceRow(t) {
  const cents = t.amount_cents === null || t.amount_cents === undefined ? null : Number(t.amount_cents);
  return {
    id: t.id,
    bank_account_id: t.bank_account_id,
    posted_on: dayString(t.posted_on),
    authorized_on: dayString(t.authorized_on),
    merchant_name: t.merchant_name ?? null,
    category: t.category ?? null,
    is_pending: t.is_pending === true,
    provider_transaction_id: t.provider_transaction_id ?? null,
    amount_cents: cents,
    amount_display: Number.isInteger(cents) ? fromCents(cents) : null
  };
}

export default async function handler(req, res) {
  const staff = await requireAuth(req, res, { db });
  if (!staff) return;
  // Second call, deliberately — requireAuth ignores a `roles` key.
  if (!requireRole(res, staff, BILL_ROLES)) return;

  const orgId = staff.org_id ?? null;
  if (!orgId) return res.status(403).json({ ok: false, error: "org_required" });

  try {
    if (req.method === "GET") {
      const q = req.query || {};

      if (isUuid(q.bill_id)) {
        if (!(await ownsBill(orgId, q.bill_id))) {
          return res.status(403).json({ ok: false, error: "forbidden" });
        }
        const billId = String(q.bill_id).trim();

        /* THE "SHOW ME THE FOUR CHARGES THAT MADE YOU SAY THIS" READ. It is what
           a human uses to check a detected bill by hand before trusting it, and
           it is the reason the evidence link is a join table rather than a
           uuid[] column.

           NOTE: getBillEvidence() takes NO orgId and filters on none — it joins
           on the bill id alone. An id is not an authorisation, so the ownsBill()
           check above is the ONLY tenancy guard on this path. It is not defence
           in depth. Do not reorder these two lines. */
        const evidence = await getBillEvidence(db, billId);
        const bill = await billRow(orgId, billId);

        return res.status(200).json({
          ok: true,
          bill_id: billId,
          bill: withAmount(bill),
          count: evidence.length,
          evidence: evidence.map(evidenceRow)
        });
      }

      if (!isUuid(q.client_id)) {
        return res.status(400).json({ ok: false, error: "client_id or bill_id must be a uuid" });
      }
      if (!(await ownsClient(orgId, q.client_id))) {
        return res.status(403).json({ ok: false, error: "forbidden" });
      }
      const clientId = String(q.client_id).trim();

      let bankAccountId = null;
      if (q.bank_account_id !== undefined && q.bank_account_id !== "") {
        if (!isUuid(q.bank_account_id)) {
          return res.status(400).json({ ok: false, error: "bank_account_id must be a uuid" });
        }
        bankAccountId = String(q.bank_account_id).trim();
      }
      const includeCandidates = truthy(q.include_candidates);

      /* orgId is REQUIRED by listRecurringBills and it throws without one, which
         is the guarantee this endpoint leans on: there is no code path here that
         can read another company's bills, because the only read available
         refuses to run unscoped. */
      const rows = await listRecurringBills(db, {
        orgId,
        clientId,
        bankAccountId,
        presentableOnly: false
      });

      const bills = [];
      const candidates = [];
      for (const row of rows) {
        (PRESENTABLE_LABELS.includes(row.confidence_label) ? bills : candidates)
          .push(withAmount(row));
      }

      /* THE ACCOUNTS AND THE TRANSACTION COUNT ARE PART OF THE ANSWER, not
         decoration. A client with no bills and no transactions is "nobody has
         entered this client's bank history yet"; a client with no bills and
         4,000 transactions is "we looked and found no repeating pattern". Those
         are opposite findings and the screen cannot tell them apart without
         these two numbers — so it would draw an empty projection under a real
         person's name, which reads as "you are fine". */
      const accounts = await listAccounts(orgId, clientId);
      const transactionCount = await countTransactions(orgId, clientId, bankAccountId);

      return res.status(200).json({
        ok: true,
        client_id: clientId,
        bank_account_id: bankAccountId,
        bills,
        // Populated only when the caller asked by name. The count is always
        // honest so the screen can say how many guesses it is NOT showing.
        candidates: includeCandidates ? candidates : [],
        candidates_included: includeCandidates,
        candidate_count: candidates.length,
        accounts,
        transaction_count: transactionCount
      });
    }

    if (req.method === "POST") {
      const body = req.body || {};
      for (const field of SESSION_OWNED) {
        if (hasOwn(body, field)) {
          return res.status(400).json({ ok: false, error: `${field}_not_accepted` });
        }
      }
      if (!isUuid(body.client_id)) {
        return res.status(400).json({ ok: false, error: "client_id must be a uuid" });
      }
      if (!(await ownsClient(orgId, body.client_id))) {
        return res.status(403).json({ ok: false, error: "forbidden" });
      }
      const clientId = String(body.client_id).trim();

      switch (body.action) {
        case "redetect": {
          let bankAccountId = null;
          if (body.bank_account_id !== undefined && body.bank_account_id !== null && body.bank_account_id !== "") {
            if (!isUuid(body.bank_account_id)) {
              return res.status(400).json({ ok: false, error: "bank_account_id must be a uuid" });
            }
            bankAccountId = String(body.bank_account_id).trim();
          }

          /* The accounts are read first for two separate jobs. One: they are the
             org+client boundary the transaction read joins through, so a
             transaction can only reach the detector if it hangs off an account
             this company owns for this client. Two: `entity_kind` is the only
             place a business/personal fact exists, and the detector will not
             invent one — a bill it cannot classify carries
             `is_business_unknown_reason` instead of a guess. */
          const accounts = await listAccounts(orgId, clientId);
          if (bankAccountId && !accounts.some((a) => String(a.id) === bankAccountId)) {
            return res.status(403).json({ ok: false, error: "forbidden" });
          }
          if (accounts.length === 0) {
            /* Not an error. There is nothing to detect over, and saying so is
               the answer — a 200 with zeroes would read as "we looked and this
               client has no bills", which is a different and wrong statement. */
            return res.status(200).json({
              ok: true,
              action: "redetect",
              ran: false,
              reason: "no_bank_accounts",
              message: "This client has no bank accounts on file, so there are no transactions to read. Add an account first.",
              accounts: [],
              transactions_read: 0,
              transactions_capped: false
            });
          }

          const accountIsBusiness = {};
          for (const a of accounts) {
            if (a.entity_kind === "business") accountIsBusiness[a.id] = true;
            else if (a.entity_kind === "personal") accountIsBusiness[a.id] = false;
            // 'unknown' is deliberately absent: 082 writes it down as a
            // known-unknown, and handing the detector `false` for it would turn
            // "nobody has said" into "we checked and it is personal".
          }

          const { rows, capped } = await readTransactions(orgId, clientId, bankAccountId);
          if (rows.length === 0) {
            return res.status(200).json({
              ok: true,
              action: "redetect",
              ran: false,
              reason: "no_transactions",
              message: "These accounts have no transactions on file yet, so there is nothing to detect a pattern in. Nothing in this system reads a bank — the history has to be entered.",
              accounts,
              transactions_read: 0,
              transactions_capped: false
            });
          }

          /* AN EXPLICIT INSTANT, ONCE. The same value decides which bills look
             stopped, what `next_expected_on` is, and what `detected_as_of` says
             on every stored row — so it is read from the clock exactly here and
             passed down. Nothing below this line reads a clock.

             It is UTC, because the server's clock is UTC and there is no
             timezone row anywhere in this schema for the company or the client.
             That is a real limitation: a detection run at 19:00 in California
             is dated the next day. It is reported as `detected_as_of` rather
             than hidden, because a date that is silently a day out is worse
             than one that is stated. */
          const now = new Date();

          const result = detectRecurringBills(rows, {
            now,
            accountIsBusiness,
            accountIds: bankAccountId ? [bankAccountId] : accounts.map((a) => String(a.id))
          });

          /* PASS THE SHARED `db` HANDLE. saveDetection reaches for the pool
             behind it so every bill and its evidence land in ONE transaction; a
             half-written detection asserts a client pays $54.99 a month with
             nothing behind it, which is worse than not writing it at all —
             indistinguishable from a well-evidenced bill at every call site that
             does not join.

             UPSERT-BASED ON PURPOSE. Detection is a standing inference that gets
             recomputed, not an event. Without the upsert, running this weekly
             would leave fifty-two rows for one subscription and any SUM over the
             table would report this client's outgoings at fifty-two times their
             true value (src/banking/store.mjs:100). */
          const saved = await saveDetection(db, result, { orgId });

          return res.status(200).json({
            ok: true,
            action: "redetect",
            ran: true,
            detected_as_of: result.detectedAsOf,
            transactions_read: rows.length,
            transactions_capped: capped,
            accounts,
            // saveDetection's own counts, verbatim. `rejectedNotStored` and
            // `excludedNotStored` are the two that answer "why did my bill not
            // appear" — a merchant with no repeating cadence, and an input row
            // that could not be read at all.
            ...saved,
            rejected: result.rejected.length,
            excluded: result.excluded.length,
            // The reasons, grouped and counted. Not the rows: a person wants to
            // know that 12 charges were skipped because they had no merchant
            // name, not to read 12 identical lines.
            rejected_reasons: tally(result.rejected, (r) => r.reason),
            excluded_reasons: tally(result.excluded, (r) => r.reason)
          });
        }
        /* add_manual — a person declares a recurring bill directly, for an
           account too new to have three months of transaction history behind
           it. 107_recurring_bills_manual.sql adds `source` and relaxes the
           four detection-only columns (occurrence_count, first/last_seen_on,
           detected_as_of) to NULL for this path rather than faking a
           detection that never ran. confidence_pct = 100 / 'high' is not a
           guess being dressed up — a human stating a fact IS the highest
           confidence this table has room to record, and 086's own header
           reserves exactly that value for something other than the detector's
           95% clamp. */
        case "add_manual": {
          if (!isUuid(body.bank_account_id)) {
            return res.status(400).json({ ok: false, error: "bank_account_id must be a uuid" });
          }
          const accounts = await listAccounts(orgId, clientId);
          const account = accounts.find((a) => String(a.id) === String(body.bank_account_id).trim());
          if (!account) return res.status(403).json({ ok: false, error: "forbidden" });

          const merchantDisplay = String(body.merchant_display || "").trim();
          if (!merchantDisplay) return res.status(400).json({ ok: false, error: "merchant_display is required" });
          const merchantKey = normaliseMerchant(merchantDisplay);
          if (!merchantKey) {
            return res.status(400).json({ ok: false, error: "merchant_display did not normalise to a usable key" });
          }

          const cadence = String(body.cadence || "").trim().toLowerCase();
          if (!CADENCE_NAMES.includes(cadence)) {
            return res.status(400).json({ ok: false, error: `cadence must be one of ${CADENCE_NAMES.join(", ")}` });
          }

          let amountCents;
          try {
            const raw = body.typical_amount;
            if (raw === undefined || raw === null || raw === "") {
              return res.status(400).json({ ok: false, error: "typical_amount is required" });
            }
            const dollars = typeof raw === "number" ? raw : String(raw).trim().replace(/,/g, "");
            const cents = toCents(dollars);
            // A bill is an outflow — recurring_bills_outflow_ck requires it
            // negative. A person types a positive dollar amount; the sign is
            // applied here, once, rather than asked of them.
            amountCents = -Math.abs(cents);
          } catch (e) {
            return res.status(400).json({ ok: false, error: "typical_amount: " + String(e.message).slice(0, 150) });
          }

          const nextExpectedOn = body.next_expected_on ? String(body.next_expected_on).trim() : null;
          const unknownReason = body.next_expected_unknown_reason ? String(body.next_expected_unknown_reason).trim() : null;
          if (!nextExpectedOn && !unknownReason) {
            return res.status(400).json({
              ok: false,
              error: "either next_expected_on or next_expected_unknown_reason is required",
              message: "state the next date this bill is due, or say why that cannot be known yet — one of the two, never neither"
            });
          }
          if (nextExpectedOn && unknownReason) {
            return res.status(400).json({ ok: false, error: "send next_expected_on or next_expected_unknown_reason, not both" });
          }

          let isBusiness = null;
          if (body.is_business === true) isBusiness = true;
          else if (body.is_business === false) isBusiness = false;
          // Anything else (undefined, null) stays NULL — unknown, per 086 §6.

          const saved = (await db.query(
            `INSERT INTO recurring_bills
               (org_id, bank_account_id, client_id, merchant_key, merchant_display,
                cadence, typical_amount_cents, next_expected_on, next_expected_unknown_reason,
                confidence_pct, confidence_label, is_business, source)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,100,'high',$10,'manual')
             ON CONFLICT (bank_account_id, merchant_key, cadence) DO UPDATE SET
               merchant_display = EXCLUDED.merchant_display,
               typical_amount_cents = EXCLUDED.typical_amount_cents,
               next_expected_on = EXCLUDED.next_expected_on,
               next_expected_unknown_reason = EXCLUDED.next_expected_unknown_reason,
               is_business = EXCLUDED.is_business,
               source = 'manual',
               updated_at = now()
             RETURNING *`,
            [orgId, account.id, clientId, merchantKey, merchantDisplay, cadence, amountCents,
             nextExpectedOn, unknownReason, isBusiness]
          )).rows[0];

          return res.status(200).json({ ok: true, action: "add_manual", bill: withAmount(saved) });
        }
        default:
          return res.status(400).json({ ok: false, error: "invalid_action" });
      }
    }

    res.setHeader("allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  } catch (e) {
    if (e instanceof TypeError || e instanceof RangeError) {
      // toBillRow() throws RangeError when a "bill" is not an outflow, and the
      // detector throws TypeError for a missing `now`. Both are the caller's.
      return res.status(400).json({ ok: false, error: String(e.message).slice(0, 200) });
    }
    if (CLIENT_DATA_ERRORS.has(e && e.code)) {
      return res.status(400).json({ ok: false, error: "invalid_parameter" });
    }
    /* A DATABASE THAT DID NOT ANSWER IS NOT OUR CODE THROWING, AND THE SCREEN
       MUST NOT BE TOLD IT WAS. Everything above this line has already claimed
       the faults it can name; what is left reaches netlify/functions/api.mjs as
       a bare 500 internal_error, which public/app/data.js words as "something
       went wrong on our side ... The database did not report a problem." That
       sentence is false during an outage and it is how the funding-capacity read
       reported a dead database as a bug in this file. 503 + db:"down" is the
       shape data.js already reads as "the database is not answering".
       See src/http/db-down.mjs — it stays narrow, so anything it cannot
       positively identify still falls through to the 500 it got before. */
    if (dbDown(res, e)) return;

    throw e;
  }
}

/* `1`, `true`, `yes`, `on` — the four spellings a query string and a checkbox
   actually produce. Anything else is false, including the empty string, so
   `?include_candidates=` does not silently widen what a screen draws. */
function truthy(v) {
  if (v === true) return true;
  const s = String(v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

/* Count by reason, sorted commonest first. */
function tally(rows, keyOf) {
  const counts = new Map();
  for (const r of rows ?? []) {
    const k = String(keyOf(r) ?? "unknown");
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([reason, count]) => ({ reason, count }));
}

async function ownsClient(orgId, clientId) {
  const r = await db.query(
    `SELECT 1 FROM clients WHERE id = $1 AND org_id = $2`,
    [String(clientId).trim(), orgId]
  );
  return r.rows.length > 0;
}

async function ownsBill(orgId, billId) {
  const r = await db.query(
    `SELECT 1 FROM recurring_bills WHERE id = $1 AND org_id = $2`,
    [String(billId).trim(), orgId]
  );
  return r.rows.length > 0;
}

/* The bill itself, so the evidence page can name what the charges are evidence
   FOR. Org-scoped again rather than trusting the ownsBill() call a few lines
   up — the cost is one indexed primary-key lookup and the benefit is that this
   query is correct read on its own. */
async function billRow(orgId, billId) {
  const r = await db.query(
    `SELECT * FROM recurring_bills WHERE id = $1 AND org_id = $2`,
    [String(billId).trim(), orgId]
  );
  return r.rows[0] ?? null;
}

/* Every account this company holds for this client, closed ones included.
   A closed account's history is still the evidence behind a bill that was
   detected while it was open, so hiding it here would leave a bill on screen
   whose account cannot be named. `closed_at` is sent so the screen can say so.

   NULL name is NOT filled in with a placeholder. 081: "a screen showing
   'Account' is honest, a screen showing an invented name is not." */
async function listAccounts(orgId, clientId) {
  const r = await db.query(
    `SELECT id, name, official_name, mask, account_type, account_subtype,
            entity_kind, closed_at
       FROM bank_accounts
      WHERE org_id = $1 AND client_id = $2
      ORDER BY closed_at NULLS FIRST, created_at ASC`,
    [orgId, String(clientId).trim()]
  );
  /* `closed_at` is a timestamptz and node-postgres hands it over as a Date.
     String(Date) is the HUMAN-READABLE form — "Fri Jul 31 2026 01:00:00 GMT+0100" —
     not the ISO one, and that exact mistake on `balance_as_of` next door refused
     a whole projection until real Postgres caught it. toISOString(), explicitly. */
  return r.rows.map((a) => ({
    ...a,
    closed_at: a.closed_at ? new Date(a.closed_at).toISOString() : null
  }));
}

/* How many transactions exist to detect over. Cheap, and it is the difference
   between "no history has been entered" and "we looked and found no pattern". */
async function countTransactions(orgId, clientId, bankAccountId) {
  const r = await db.query(
    `SELECT count(*)::bigint AS n
       FROM bank_transactions t
       JOIN bank_accounts a ON a.id = t.bank_account_id AND a.org_id = t.org_id
      WHERE t.org_id = $1
        AND a.client_id = $2
        AND ($3::uuid IS NULL OR t.bank_account_id = $3)`,
    [orgId, String(clientId).trim(), bankAccountId]
  );
  return Number(r.rows[0]?.n ?? 0);
}

/**
 * The transactions one detection run reads.
 *
 * SCOPED THROUGH THE ACCOUNT, NOT THROUGH THE TRANSACTION'S OWN client_id.
 * `bank_transactions.client_id` is NULLABLE (085) and a hand-entered row can
 * easily be missing it; `bank_accounts.client_id` is NOT NULL (081) and is the
 * fact that says whose money this is. Filtering on the transaction's own column
 * would silently drop every unattributed charge, and a detector that never sees
 * a client's rent produces a projection that says they can afford things they
 * cannot.
 *
 * `client_id` is then COALESCEd from the account for the same reason on the way
 * out: toBillRow() writes `client_id` straight onto the stored bill, and a bill
 * stored with a NULL client is a bill no client-scoped read will ever return.
 *
 * Bounded, ordered newest first, and the cut-off is reported. See TX_CAP.
 */
async function readTransactions(orgId, clientId, bankAccountId) {
  const r = await db.query(
    `SELECT t.id,
            t.bank_account_id,
            COALESCE(t.client_id, a.client_id) AS client_id,
            t.provider_transaction_id,
            t.amount_cents,
            t.posted_on,
            t.merchant_name,
            t.is_pending
       FROM bank_transactions t
       JOIN bank_accounts a ON a.id = t.bank_account_id AND a.org_id = t.org_id
      WHERE t.org_id = $1
        AND a.client_id = $2
        AND ($3::uuid IS NULL OR t.bank_account_id = $3)
      ORDER BY t.posted_on DESC NULLS LAST, t.id ASC
      LIMIT $4`,
    [orgId, String(clientId).trim(), bankAccountId, TX_CAP + 1]
  );
  const capped = r.rows.length > TX_CAP;
  const rows = capped ? r.rows.slice(0, TX_CAP) : r.rows;
  // `posted_on` is a Date at local midnight; parseDay in the detector reads the
  // local parts, so it is handed over untouched. Converting it here would be a
  // second place the same conversion is written.
  return { rows, capped };
}
