// /api/finance/liabilities — what a client owes on each card, and the series
// behind it.
//
//   GET  ?client_id=<uuid>[&include_closed=1]     → { ok, cards, totals }  the stack
//   GET  ?tradeline_id=<uuid>[&limit=]            → { ok, observations }   one card's series
//   POST { action: "add_card",  client_id, lender, ... }        → a new card
//   POST { action: "edit_card", client_id, tradeline_id, ... }  → change a card
//   POST { action: "upsert",    client_id, tradeline_id, as_of, ... } → a position
//
// *** THE ONE THING THIS FILE MUST NOT SKIP. ***
// src/liabilities/store.mjs's THREE READ FUNCTIONS TAKE NO orgId AND FILTER ON
// NONE. Read them:
//
//   getCurrentLiability(db, { tradelineId })   → WHERE tradeline_id = $1
//   getCurrentLiabilities(db, { clientId })    → WHERE client_id = $1
//   getLiabilityHistory(db, { tradelineId | clientId }) → the same
//
// Every one of those takes an id straight off the query string and matches on it
// alone. An id is not an authorisation to read a row. With one company in the
// database nothing leaks; the day a second exists, an employee of company A
// passes company B's tradeline_id and reads that consumer's balances, minimum
// payments and payment status. That is finding C1 in a different table.
//
// SO THE OWNERSHIP CHECKS BELOW ARE THE ORG FILTER, and they run BEFORE any
// store call. They are not belt-and-braces and they are not a nicety — they are
// the only thing standing between this endpoint and cross-tenant reads, because
// the store will not do it.
//
// THERE IS A SECOND GUARD ON THE CLIENT-WIDE READ, and it is not decoration
// either. `listTradelines()` (src/tradelines/store.mjs:88) REFUSES to run
// without an org id, so the card list is org-scoped by the store itself; the
// unscoped `getCurrentLiabilities()` result is then INTERSECTED with it — a
// position whose tradeline is not in the org-scoped card list is dropped rather
// than rendered. Two independent things now have to be wrong before a balance
// from another company can reach a screen.
//
// NULL IS UNKNOWN AND MUST SURVIVE TO THE SCREEN. A missing minimum payment, a
// missing balance and a missing APR are written as NULL by the store, on
// purpose, and nothing here may COALESCE one to 0. "We do not know what this
// client owes" and "this client owes nothing" are opposite facts about somebody's
// money and only one of them is a claim. card-stack.html renders unknown as an
// em dash, never as 0.00.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import {
  ROLE_SETS, requireRole, isUuid, redact, boundedLimit, CLIENT_DATA_ERRORS
} from "../../src/http/read-api.mjs";
import {
  recordLiability, getCurrentLiabilities, getLiabilityHistory
} from "../../src/liabilities/store.mjs";
import { buildCardStack, shapeCard, shapePosition } from "../../src/liabilities/card-stack.mjs";
import { listTradelines } from "../../src/tradelines/store.mjs";
// readApr IS THE ONLY READER OF A RATE IN THIS REPO AND THIS FILE DOES NOT
// WRITE A SECOND ONE. 054 and 083 both store APR as a decimal fraction with a
// CHECK of 0..1, so a form that collects "24.99" must divide before it writes;
// getting that wrong inflates every dollar figure derived from it a hundredfold
// (audit m4). See aprFraction() below for the one thing readApr() cannot decide
// for a hand-typed value.
import { readApr } from "../../src/tradelines/index.mjs";
// toCents carries this repo's rounding rule (roundHalfUp) and its $1bn sanity
// bound. It is imported rather than reimplemented; the ONE thing it does that is
// wrong for a form is answer 0 for an empty input, which moneyCents() handles
// before delegating. See the note there.
import { toCents as dollarsToCents } from "../../src/commissions/money.mjs";

/* ROLE_SETS.STAFF — the same gate api/read/tradelines.mjs carries, and for the
   same reason: this is the balance half of the card rows that endpoint already
   serves to that set, and gating the two differently would leave a closer able
   to see a limit but not what is drawn against it while working one file.

   IF THIS EVER NARROWS TO FINANCE, card-stack.html must move into
   OWNER_ADMIN_ONLY in public/app/shell.js in the same commit — otherwise the
   app offers every closer a screen that answers 403. */
const LIABILITY_ROLES = ROLE_SETS.STAFF;

const SESSION_OWNED = ["org_id", "orgId"];
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(Object(o ?? {}), k);

/* The series read's default. Two years of monthly statements is what a person
   scrolls through when asking "has this balance been moving"; the ceiling is
   read-api's MAX_LIMIT via boundedLimit, which also clamps ?limit=-1 — that
   parses to -1, survives a bare Math.min, reaches Postgres and raises "LIMIT
   must not be negative" as a 500 for what is a caller's typo. */
const HISTORY_LIMIT = 24;

/* The CHECK sets from the migrations, restated here so a bad value is refused
   with a message instead of arriving as a 23514 constraint violation the caller
   cannot act on. If a migration widens one of these, widen it here too. */
const KINDS = new Set(["revolving", "loc", "installment"]);          // 054
const PAYMENT_STATUSES = new Set([                                   // 083 / 084
  "current", "late_30", "late_60", "late_90", "late_120", "charge_off", "collection"
]);

export default async function handler(req, res) {
  const staff = await requireAuth(req, res, { db });
  if (!staff) return;
  // Second call, deliberately — requireAuth ignores a `roles` key.
  if (!requireRole(res, staff, LIABILITY_ROLES)) return;

  const orgId = staff.org_id ?? null;
  if (!orgId) return res.status(403).json({ ok: false, error: "org_required" });

  try {
    if (req.method === "GET") {
      const q = req.query || {};

      if (isUuid(q.tradeline_id)) {
        const card = await loadTradeline(orgId, q.tradeline_id);
        if (!card) return res.status(403).json({ ok: false, error: "forbidden" });
        return await sendHistory(res, { orgId, card, limit: q.limit });
      }

      if (!isUuid(q.client_id)) {
        return res.status(400).json({ ok: false, error: "client_id or tradeline_id must be a uuid" });
      }
      if (!(await ownsClient(orgId, q.client_id))) {
        return res.status(403).json({ ok: false, error: "forbidden" });
      }
      return await sendStack(res, {
        orgId,
        clientId: String(q.client_id).trim(),
        includeClosed: truthy(q.include_closed)
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

      /* THE CARD MUST BELONG TO THE CLIENT NAMED IN THE SAME REQUEST, not merely
         to the same company. ownsTradeline-style checks answer "is this card
         ours"; they do not answer "is this card THIS client's". Without the
         second question, a closer working client A's file who pastes client B's
         tradeline id writes B's card position under A's client_id — one row
         naming two different consumers, in a table where client_id is what every
         screen filters on. Both ids are attacker-supplied and both are checked. */
      let card = null;
      if (body.action !== "add_card") {
        if (!isUuid(body.tradeline_id)) {
          return res.status(400).json({ ok: false, error: "tradeline_id must be a uuid" });
        }
        card = await loadTradeline(orgId, body.tradeline_id);
        if (!card) return res.status(403).json({ ok: false, error: "forbidden" });
        if (String(card.client_id) !== clientId) {
          return res.status(403).json({ ok: false, error: "tradeline_belongs_to_another_client" });
        }
      }

      switch (body.action) {
        case "add_card":  return await addCard(res, { orgId, clientId, body });
        case "edit_card": return await editCard(res, { orgId, clientId, card, body });
        case "upsert":    return await upsertPosition(res, { orgId, clientId, card, body });
        /* assign_entity — which wallet (106_entities.sql) this card belongs
           to. entity_id or null (unassign); an entity from a different client
           is refused by name rather than silently ignored, same discipline as
           the tradeline-ownership check three lines up. */
        case "assign_entity": {
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
          const updated = (await db.query(
            `UPDATE tradelines SET entity_id = $3, updated_at = now()
              WHERE id = $1 AND org_id = $2 RETURNING id`,
            [card.id, orgId, entityId]
          )).rows[0];
          return res.status(200).json({ ok: true, action: "assign_entity", tradeline_id: updated.id, entity_id: entityId });
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
    if (CLIENT_DATA_ERRORS.has(e && e.code)) {
      return res.status(400).json({ ok: false, error: "invalid_parameter" });
    }
    /* A column CHECK is the caller's error too, not ours. Every CHECK on 054,
       083 and 084 restates a rule the parsers above already enforce, so getting
       here means a value slipped past them — and answering 500 would tell the
       screen "the database is down" (public/app/data.js classifies it as our
       side breaking) for a number somebody mistyped. 23514 is check_violation,
       23503 is a foreign key that names nothing. */
    if (e && (e.code === "23514" || e.code === "23503")) {
      return res.status(400).json({ ok: false, error: "value_refused_by_the_database" });
    }
    throw e;
  }
}

/* ── reads ─────────────────────────────────────────────────────────────────── */

/**
 * sendStack — the whole card stack for one client.
 *
 * THREE READS, AND THE FIRST ONE IS THE FENCE. listTradelines() throws without
 * an org id and filters on it, so `cards` cannot contain another company's row.
 * The positions and the observation counts are then constrained to those ids.
 */
async function sendStack(res, { orgId, clientId, includeClosed }) {
  const tradelines = await listTradelines(db, { orgId, clientId, includeClosed });

  /* getCurrentLiabilities() matches on client_id ALONE (store.mjs:275). The
     client is already proven ours by ownsClient(), so this cannot cross a
     tenancy line on its own — but the intersection below means it would take
     TWO failures rather than one, and this is the read where a mistake shows a
     consumer's balances to another company's staff. */
  const ours = new Set(tradelines.map((t) => String(t.id)));
  const positions = (await getCurrentLiabilities(db, { clientId }))
    .filter((p) => ours.has(String(p.tradeline_id)));

  /* How many observations stand behind each card. Scoped by org AND client
     directly, because card_liability_history carries both columns (084) and a
     count is still a fact about somebody's file. */
  const counted = await db.query(
    `SELECT tradeline_id, count(*)::int AS n
       FROM card_liability_history
      WHERE org_id = $1 AND client_id = $2
      GROUP BY tradeline_id`,
    [orgId, clientId]
  );
  const observationCounts = {};
  for (const r of counted.rows) observationCounts[String(r.tradeline_id)] = r.n;

  const stack = buildCardStack({ tradelines, positions, observationCounts });
  return res.status(200).json({
    ok: true,
    client_id: clientId,
    include_closed: !!includeClosed,
    source: stack.source,
    lines: stack.lines,
    // How many of those cards the totals cover — closed and installment lines
    // are listed but not totalled. See buildCardStack().
    totalled: stack.totalled,
    disagreements: stack.disagreements,
    cards: redact(stack.cards),
    totals: stack.totals
  });
}

/**
 * sendHistory — one card's observed series, newest first.
 *
 * AN EMPTY ARRAY IS A CARD NOBODY HAS OBSERVED YET. It is NOT a zero balance and
 * the screen must not render it as one — `count: 0` with the card's own details
 * alongside is what lets it say "nothing has been recorded for this card yet" in
 * words rather than drawing a row of zeroes.
 */
async function sendHistory(res, { orgId, card, limit: rawLimit }) {
  const limit = boundedLimit(rawLimit, { fallback: HISTORY_LIMIT, cap: 200 });
  // One more than asked for, so `hasMore` is honest without a second COUNT.
  const rows = await getLiabilityHistory(db, { tradelineId: card.id, limit: limit + 1 });
  const hasMore = rows.length > limit;
  const series = (hasMore ? rows.slice(0, limit) : rows).map(shapePosition);

  /* The card's current position, so the series header can show what stands now
     without the screen holding state from the stack read. Taken from the rows we
     already have rather than a fourth query: the head of a series ordered
     `as_of DESC, created_at DESC` IS the projection, by construction (083). */
  const current = series.length ? series[0] : null;

  return res.status(200).json({
    ok: true,
    source: "card_liability_history",
    tradeline_id: card.id,
    card: redact(shapeCard(card, null, series.length)),
    current: redact(current),
    count: series.length,
    limit,
    hasMore,
    observations: redact(series)
  });
}

/* ── writes ────────────────────────────────────────────────────────────────── */

/**
 * addCard — a credit card typed in by hand.
 *
 * THIS IS A REAL FEATURE, NOT A PLACEHOLDER. Nothing in this repo transmits:
 * src/banking/plaid.mjs is a deliberate empty seam that answers
 * not_implemented, and there is no outbound fetch in src/adapters/ or src/lib/.
 * Cards arrive here two ways — off a soft pull, machine-written by
 * src/tradelines/store.mjs with source='crs', or typed by a person, written
 * here with source='manual'. 054 planned for exactly these two origins and
 * tagged every row with which one it came from, because a closer must always be
 * able to tell a bureau figure from a typed one.
 *
 * WHY THE SQL IS HERE AND NOT IN src/tradelines/store.mjs. upsertTradelines()
 * writes a FIXED column list (store.mjs:18) which does not include the two
 * columns 094 adds, and its conflict target is (client_id, account_ref) — a key
 * a hand-entered card does not have, so every manual add would insert anyway.
 * Bending the bureau-ingest function into a hand-entry function would give one
 * function two jobs and two callers with opposite expectations about what a
 * conflict means.
 *
 * NO account_ref IS SET. 054 reserves it for the bureau's identifier, and
 * writing a last4 into it would let two cards ending in the same four digits
 * collide on uq_tradelines_account — the second silently UPDATING the first and
 * removing a whole card, and its limit, from the client's file. 094's header
 * spells this out.
 */
async function addCard(res, { orgId, clientId, body }) {
  const lender = requiredText(body.lender, "lender", 120);
  const kind = enumField(body.kind, KINDS, "kind") || "revolving";
  const last4 = last4Field(body.last4);
  const limitCents = moneyCents(body.credit_limit, "credit_limit");
  const balanceCents = moneyCents(body.balance, "balance");
  const apr = aprFraction(body.apr, "apr");
  const openedOn = dayField(body.opened_on, "opened_on");
  const asOf = dayField(body.as_of, "as_of");

  const r = await db.query(
    `INSERT INTO tradelines
       (org_id, client_id, lender, kind, last4, credit_limit_cents, balance_cents,
        apr, opened_on, as_of, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'manual')
     RETURNING *`,
    [orgId, clientId, lender, kind, last4, limitCents, balanceCents, apr, openedOn, asOf]
  );
  return res.status(200).json({ ok: true, action: "add_card", card: redact(shapeCard(r.rows[0], null, 0)) });
}

/**
 * editCard — change what we know about a card.
 *
 * OMITTED MEANS "LEAVE IT ALONE". PRESENT-AND-EMPTY MEANS "WE NO LONGER KNOW".
 * Those are two different edits and a form that could only express the first
 * would make an unknown unrecoverable: once somebody typed a limit they were
 * guessing at, there would be no way to put the field back to unknown, and the
 * guess would be totalled, weighted and shown as a fact forever. So a key that
 * is absent from the body is not in the UPDATE at all, and a key that is present
 * with "" or null is set to NULL.
 *
 * A blank is never turned into 0. "We do not know this card's limit" and "this
 * card has a limit of zero" are opposite facts; only the second is a claim.
 */
async function editCard(res, { orgId, clientId, card, body }) {
  const sets = [];
  const params = [];
  const put = (col, value) => { params.push(value); sets.push(`${col} = $${params.length}`); };

  if (hasOwn(body, "lender")) put("lender", requiredText(body.lender, "lender", 120));
  if (hasOwn(body, "kind")) put("kind", enumField(body.kind, KINDS, "kind") || "revolving");
  if (hasOwn(body, "last4")) put("last4", last4Field(body.last4));
  if (hasOwn(body, "credit_limit")) put("credit_limit_cents", moneyCents(body.credit_limit, "credit_limit"));
  if (hasOwn(body, "balance")) put("balance_cents", moneyCents(body.balance, "balance"));
  if (hasOwn(body, "apr")) put("apr", aprFraction(body.apr, "apr"));
  if (hasOwn(body, "opened_on")) put("opened_on", dayField(body.opened_on, "opened_on"));
  if (hasOwn(body, "as_of")) put("as_of", dayField(body.as_of, "as_of"));
  /* Closing a card is an edit, not a delete. Nothing here removes a tradeline:
     the observations in 084 refer to it, and a card closed last year is still
     the reason a balance moved. A closed card drops out of the stack's default
     read and out of every headroom total, which is the whole effect wanted. */
  if (hasOwn(body, "closed_on")) put("closed_at", dayField(body.closed_on, "closed_on"));

  if (!sets.length) return res.status(400).json({ ok: false, error: "nothing_to_change" });

  /* A HAND-TYPED EDIT IS NOT A BUREAU READING. Once a person has corrected a
     card, the row stops being a faithful copy of the pull it came from and the
     tag has to say so — otherwise the next reader sees source='crs' against a
     number no bureau ever reported. */
  sets.push("source = 'manual'");
  sets.push("updated_at = now()");

  params.push(card.id);
  params.push(orgId);
  params.push(clientId);
  const r = await db.query(
    `UPDATE tradelines SET ${sets.join(", ")}
      WHERE id = $${params.length - 2} AND org_id = $${params.length - 1} AND client_id = $${params.length}
      RETURNING *`,
    params
  );
  if (!r.rows[0]) return res.status(404).json({ ok: false, error: "not_found" });
  return res.status(200).json({ ok: true, action: "edit_card", card: redact(shapeCard(r.rows[0], null, 0)) });
}

/**
 * upsertPosition — record one observed billing position on one card.
 *
 * `as_of` IS REQUIRED and recordLiability() throws without it. That is not a
 * formality: `as_of` is when the position was TRUE, it is the ordering key for
 * the whole series (084), and the current-position projection refuses to move
 * backwards on it. A position with no date cannot be placed in the series at
 * all, so there is nowhere to put it.
 *
 * THE SHARED `db` HANDLE IS PASSED, NOT A POOL OPENED HERE. recordLiability
 * swaps the shared singleton for the pool it fronts (store.mjs:134) so its three
 * writes — the series row, the projection upsert and the relink — land in ONE
 * transaction. Handing it anything else silently loses that and leaves the
 * series able to lose an observation with no error raised anywhere (audit m10).
 *
 * THE ANSWER CARRIES `current`, WHICH MAY NOT BE THIS OBSERVATION. Backfilling
 * an older statement lands in the series and deliberately leaves the current
 * position alone; the screen shows both so nobody is left wondering why the
 * headline number did not move.
 */
async function upsertPosition(res, { orgId, clientId, card, body }) {
  const row = {
    as_of: requiredDay(body.as_of, "as_of"),
    current_balance_cents: moneyCents(body.current_balance, "current_balance"),
    statement_balance_cents: moneyCents(body.statement_balance, "statement_balance"),
    minimum_payment_cents: moneyCents(body.minimum_payment, "minimum_payment"),
    past_due_cents: moneyCents(body.past_due, "past_due"),
    last_payment_cents: moneyCents(body.last_payment, "last_payment"),
    last_payment_date: dayField(body.last_payment_date, "last_payment_date"),
    statement_date: dayField(body.statement_date, "statement_date"),
    payment_due_date: dayField(body.payment_due_date, "payment_due_date"),
    apr: aprFraction(body.apr, "apr"),
    payment_status: enumField(body.payment_status, PAYMENT_STATUSES, "payment_status"),
    // Typed by a person. The trust level is part of the record.
    source: "manual",
    source_ref: null,
    raw: {}
  };

  const { history, current } = await recordLiability(db, {
    orgId, clientId, tradelineId: card.id, row
  });

  const shapedCurrent = shapePosition(current);
  const shapedHistory = shapePosition(history);
  return res.status(200).json({
    ok: true,
    action: "upsert",
    tradeline_id: card.id,
    recorded: redact(shapedHistory),
    current: redact(shapedCurrent),
    /* TRUE when this observation did not become the standing position — a
       backfill of an older statement. The screen says so out loud rather than
       leaving a number that visibly did not change. */
    superseded: !!(shapedCurrent && shapedHistory && shapedCurrent.as_of !== shapedHistory.as_of)
  });
}

/* ── field readers ─────────────────────────────────────────────────────────── */
/* Every one of these throws a TypeError on a value it cannot read, and the
   handler's catch turns that into a 400 carrying the message. That is the
   difference between a form and a bureau file, and it is the reason the parsers
   in src/tradelines/index.mjs are not used unmodified here: toCents() and
   readApr() answer NULL for both "not reported" and "unparseable", which is
   exactly right for a payload we cannot re-ask and exactly wrong for a person
   standing in front of the screen. Silently storing their typo as "unknown"
   loses the number AND tells them it saved. */

const blank = (v) => v === undefined || v === null || String(v).trim() === "";
const truthy = (v) => v === true || v === 1 || v === "1" || v === "true" || v === "yes";

function requiredText(v, field, max) {
  if (blank(v)) throw new TypeError(`${field} is required`);
  const s = String(v).trim();
  if (s.length > max) throw new TypeError(`${field} is longer than ${max} characters`);
  return s;
}

function enumField(v, allowed, field) {
  if (blank(v)) return null;
  const s = String(v).trim().toLowerCase();
  if (!allowed.has(s)) {
    throw new TypeError(`${field} must be one of: ${[...allowed].join(", ")}`);
  }
  return s;
}

/* THE BOX LABELLED "LAST 4" IS THE BOX SOMEBODY PASTES A CARD NUMBER INTO.
   094's CHECK refuses anything that is not exactly four digits, and this refuses
   it earlier with a message a person can act on. The refusal is deliberately
   NOT "we trimmed it to the last four for you": quietly accepting a full card
   number would mean the number existed in a request body, a log line and an
   error report on the way to being trimmed. */
function last4Field(v) {
  if (blank(v)) return null;
  const s = String(v).trim();
  if (!/^\d{4}$/.test(s)) {
    throw new TypeError("last4 must be exactly four digits — do not paste a full card number");
  }
  return s;
}

/* moneyCents — dollars from a form → integer cents, or null for "not given".
   Delegates the actual conversion to src/commissions/money.mjs so the rounding
   rule (roundHalfUp) and the $1bn bound are this repo's single ones; the only
   thing added here is refusing a value that cannot be read instead of answering
   0 for it, which is what toCents() does for an empty string. */
function moneyCents(v, field) {
  if (blank(v)) return null;
  const raw = typeof v === "number" ? v : String(v).replace(/[$,\s]/g, "");
  let c;
  try {
    c = dollarsToCents(raw);
  } catch {
    throw new TypeError(`${field} must be an amount in dollars, for example 1250.00`);
  }
  // Every money column on 054, 083 and 084 CHECKs >= 0. A negative balance is a
  // credit on the card, which this product has no representation for; refusing
  // is better than a constraint violation the caller cannot read.
  if (c < 0) throw new TypeError(`${field} cannot be negative`);
  return c;
}

/**
 * aprFraction — a rate typed as a PERCENTAGE → the decimal fraction the column
 * stores, or null for "not given".
 *
 * readApr() does the conversion; this adds the one decision readApr() cannot
 * make for a hand-typed value. readApr() reads anything above 1 as a percentage
 * and anything at or below 1 as a fraction, which is the correct reading of a
 * bureau payload where both forms appear in the same field name. On a form
 * labelled "APR %", a person who types 1 means one percent — and readApr() would
 * store 1.0, which is ONE HUNDRED PERCENT, passing the column CHECK and then
 * making that card the most expensive money in the stack forever.
 *
 * So the ambiguous band is REFUSED rather than guessed at, with a message
 * telling the person what to type. A genuine sub-1% credit-card APR does not
 * exist; 0 does (an intro rate) and is accepted, because zero reads the same way
 * under both interpretations.
 */
function aprFraction(v, field) {
  if (blank(v)) return null;
  const n = Number(String(v).replace(/[%\s,]/g, ""));
  if (!Number.isFinite(n) || n < 0) {
    throw new TypeError(`${field} must be a percentage, for example 24.99`);
  }
  if (n > 0 && n <= 1) {
    throw new TypeError(
      `${field}: enter the percentage, not the decimal — 24.99 means 24.99%, and "${String(v).trim()}" ` +
      `could mean either ${n}% or ${(n * 100).toFixed(2)}%`
    );
  }
  const f = readApr(v);
  // readApr refuses anything above 100% rather than clamping it, because a
  // clamped rate is a wrong number wearing a plausible face and it would be
  // drawn first by a waterfall that sorts on price.
  if (f === null) throw new TypeError(`${field} must be between 0% and 100%`);
  return f;
}

/* A date column, as YYYY-MM-DD. Refused rather than passed through to Postgres
   so a typo comes back as the field that is wrong, not as SQLSTATE 22007. The
   calendar itself is checked (2025-02-30 is not a date) by round-tripping it. */
function dayField(v, field) {
  if (blank(v)) return null;
  const s = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new TypeError(`${field} must be a date, as YYYY-MM-DD`);
  }
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    throw new TypeError(`${field} is not a real date`);
  }
  return s;
}

function requiredDay(v, field) {
  if (blank(v)) throw new TypeError(`${field} is required — a position with no date cannot be placed in the series`);
  return dayField(v, field);
}

/* ── tenancy ───────────────────────────────────────────────────────────────── */

async function ownsClient(orgId, clientId) {
  const r = await db.query(
    `SELECT 1 FROM clients WHERE id = $1 AND org_id = $2`,
    [String(clientId).trim(), orgId]
  );
  return r.rows.length > 0;
}

/* loadTradeline — the card, if it belongs to a client of THIS company. Joined
   through clients rather than trusting tradelines.org_id, so the answer is the
   same one ownsClient gives and there is one definition of "ours" in this file.

   It RETURNS THE ROW rather than a boolean because the caller needs two facts
   from it — that the card is ours, and which client it belongs to — and asking
   twice would leave room for the two answers to be about different rows. */
async function loadTradeline(orgId, tradelineId) {
  const r = await db.query(
    `SELECT t.*
       FROM tradelines t
       JOIN clients c ON c.id = t.client_id
      WHERE t.id = $1 AND c.org_id = $2`,
    [String(tradelineId).trim(), orgId]
  );
  return r.rows[0] ?? null;
}
