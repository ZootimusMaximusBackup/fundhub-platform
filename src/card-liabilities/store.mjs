// Card liabilities — the database half. The pure half is next door in
// index.mjs, split the same way src/tradelines is, so that every derived figure
// stays testable without Postgres.
//
// TAKES accountRef AS A PARAMETER. This module does not know what an "account"
// is, does not import anything that does, and does not reach for an accounts
// table — W5 owns the aggregator and its accounts table, and neither exists
// yet. The caller supplies the reference; 083 stores it as opaque text; a
// follow-up migration adds the foreign key when there is something to point at.
//
// ABSENCE IS NOT A CORRECTION — the rule this whole file is built around.
// src/tradelines/store.mjs already applies it to the APR ("a later pull that
// omits the APR must not erase a rate we already knew"). Here it applies to
// EVERY nullable column, because a bank refresh routinely returns a partial
// card: the aggregator did not fetch liabilities this cycle, or the issuer's
// endpoint returned the balances and not the terms. A DO UPDATE that overwrote
// unconditionally would turn every partial refresh into data loss, and the loss
// would be invisible — the row would still be there, just emptier.
//
// So every column is COALESCE(EXCLUDED.x, card_liabilities.x). What this means
// in practice, stated plainly because it is a real trade-off: a value can never
// be un-set through this path. A limit that becomes genuinely unknown stays at
// its last known figure. That is the safer of the two failure modes — a stale
// limit is wrong by however much it moved, an erased limit makes utilisation
// unanswerable for the whole client — and it is the one the repo already chose
// for tradelines.

import { withTransaction } from "../documents/register.mjs";
import { TERM_FIELDS, TERM_DATE_FIELDS, asCents, asRate, readDate } from "./index.mjs";

export { TERM_FIELDS };

/* The 083 columns a caller may write. org_id and client_id are passed
   separately because they identify the row rather than describe the card. */
const LIABILITY_COLUMNS = [
  "account_ref",
  "tradeline_id",
  "issuer",
  "last4",
  "is_business",
  "credit_limit_cents",
  "balance_cents",
  "statement_balance_cents",
  "minimum_payment_cents",
  "apr_purchase",
  "apr_cash_advance",
  "apr_balance_transfer",
  "promo_purchase_apr",
  "promo_purchase_ends_on",
  "promo_balance_transfer_apr",
  "promo_balance_transfer_ends_on",
  "statement_close_date",
  "payment_due_date",
  "as_of",
  "raw"
];

/* Columns whose absence must not erase what is already stored. Everything
   except account_ref (the key itself) and raw (handled separately, below). */
const COALESCED = LIABILITY_COLUMNS.filter((c) => c !== "account_ref" && c !== "raw");

/**
 * upsertCardLiability — write one card for one client.
 *
 * Conflict target is uq_card_liabilities_account (client_id, account_ref).
 * account_ref is NOT NULL in 083, so unlike 054's partial index there is no
 * unmatchable case: the same card refreshed twice can never become two rows.
 *
 * `row` is the shape coerceLiabilityRow() produces. issuer and accountRef are
 * required, because a card row without them cannot be identified or shown.
 */
export async function upsertCardLiability(db, { orgId, clientId, accountRef, row = {} } = {}) {
  if (!orgId || !clientId) throw new TypeError("upsertCardLiability: orgId and clientId are required");
  const ref = accountRef ?? row.account_ref;
  if (!ref) throw new TypeError("upsertCardLiability: accountRef is required — it is the card's identity");
  if (!row.issuer) throw new TypeError("upsertCardLiability: issuer is required");

  const values = [orgId, clientId, ...LIABILITY_COLUMNS.map((c) => {
    if (c === "account_ref") return ref;
    if (c === "raw") return JSON.stringify(row.raw ?? {});
    return row[c] ?? null;
  })];
  const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");

  const sets = COALESCED
    .map((c) => `${c} = COALESCE(EXCLUDED.${c}, card_liabilities.${c})`)
    .join(",\n         ");

  const res = await db.query(
    `INSERT INTO card_liabilities (org_id, client_id, ${LIABILITY_COLUMNS.join(", ")})
     VALUES (${placeholders})
     ON CONFLICT (client_id, account_ref)
     DO UPDATE SET
         ${sets},
         -- raw is the whole unparsed record. COALESCE would keep an old blob
         -- alongside new columns, which is the one combination guaranteed to
         -- mislead whoever opens it to settle a dispute. An empty object means
         -- the caller had nothing to record, so the previous one stands.
         raw = CASE WHEN EXCLUDED.raw = '{}'::jsonb THEN card_liabilities.raw ELSE EXCLUDED.raw END,
         updated_at = now()
     RETURNING *`,
    values
  );
  return res.rows[0];
}

/**
 * listCardLiabilities — one client's cards.
 *
 * Business cards first, then by issuer, so a screen that groups by
 * classification does not have to sort. Closed cards are excluded unless asked
 * for: a closed card has no headroom and no future due date, but it is kept
 * rather than deleted because it may still carry a balance somebody owes.
 *
 * NULLS LAST on is_business puts the UNCLASSIFIED cards at the bottom rather
 * than mixed into either group, which is the whole point of the third state.
 */
export async function listCardLiabilities(db, { clientId, includeClosed = false } = {}) {
  if (!clientId) throw new TypeError("listCardLiabilities: clientId is required");
  const res = await db.query(
    `SELECT * FROM card_liabilities
      WHERE client_id = $1
        AND ($2::boolean OR closed_at IS NULL)
      ORDER BY is_business DESC NULLS LAST, issuer ASC, account_ref ASC`,
    [clientId, includeClosed]
  );
  return res.rows;
}

/** getCardLiability — one card by its account reference. */
export async function getCardLiability(db, { clientId, accountRef } = {}) {
  if (!clientId || !accountRef) throw new TypeError("getCardLiability: clientId and accountRef are required");
  const res = await db.query(
    `SELECT * FROM card_liabilities WHERE client_id = $1 AND account_ref = $2`,
    [clientId, accountRef]
  );
  return res.rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// terms — the effective-dated history (084)
// ---------------------------------------------------------------------------

/* EVERY INSTANT THIS MODULE WRITES IS TRUNCATED TO MILLISECONDS. 084's own
   comment on effective_from has the full argument; the short version is that
   Postgres keeps microseconds, a JavaScript Date does not, and every reader of
   this table is JavaScript. A boundary at .734567 comes back to Node as .734,
   and termsAsOf({ at: row.effective_from }) — the single most obvious call
   anyone will make — then asks about an instant 567 microseconds BEFORE the row
   begins and gets handed the PREVIOUS row. Off by one, always at the boundary,
   with no error anywhere.

   clock_timestamp() and not now(), because now() is frozen for the whole
   transaction: two changes inside one transaction would otherwise land on the
   same instant and trip 084's "a term must end after it begins" CHECK. */
const MS_NOW = "date_trunc('milliseconds', clock_timestamp())";

/**
 * openTerms — record the FIRST set of terms for a card.
 *
 * Fails if the card already has an open term row, and that failure comes from
 * uq_card_liability_terms_open rather than from a check in here, so two racing
 * callers cannot both succeed. Use changeTerms() for every subsequent change.
 */
export async function openTerms(db, { orgId, cardLiabilityId, terms = {}, source = "bank", reason = null } = {}) {
  if (!orgId || !cardLiabilityId) throw new TypeError("openTerms: orgId and cardLiabilityId are required");
  const values = [orgId, cardLiabilityId, source, reason, ...TERM_FIELDS.map((f) => terms[f] ?? null)];
  const cols = TERM_FIELDS.join(", ");
  const placeholders = TERM_FIELDS.map((_, i) => `$${i + 5}`).join(", ");
  const res = await db.query(
    `INSERT INTO card_liability_terms (org_id, card_liability_id, source, reason, ${cols}, effective_from)
     VALUES ($1, $2, $3, $4, ${placeholders}, ${MS_NOW})
     RETURNING *`,
    values
  );
  return res.rows[0];
}

/** currentTerms — the row in effect now, or null if the card has none yet. */
export async function currentTerms(db, { cardLiabilityId } = {}) {
  if (!cardLiabilityId) throw new TypeError("currentTerms: cardLiabilityId is required");
  const res = await db.query(
    `SELECT * FROM card_liability_terms
      WHERE card_liability_id = $1 AND effective_to IS NULL`,
    [cardLiabilityId]
  );
  return res.rows[0] ?? null;
}

/* Compare one term field across the open row and what is being proposed.
   Numeric columns come back from Postgres as STRINGS ('1000000', '0.18990'), so
   a bare !== would report a change on every single refresh and fill the history
   with rows where nothing happened. */
function termChanged(field, current, proposed) {
  if (field === "is_business") return current !== proposed;
  // A `date` column comes back as a JS Date OBJECT, and a caller supplies
  // '2026-08-15'. `dateObject !== string` is true every single time, so without
  // this branch a nightly refresh would append a history row every night for a
  // promotional window that had not moved — and the table whose entire job is
  // answering "when did this change" would be buried under nights when it did
  // not.
  if (TERM_DATE_FIELDS.has(field)) return readDate(current) !== readDate(proposed);
  const a = field === "credit_limit_cents" ? asCents(current) : asRate(current);
  const b = field === "credit_limit_cents" ? asCents(proposed) : asRate(proposed);
  return a !== b;
}

/**
 * changeTerms — close what was true and open what is true now.
 *
 * THIS IS THE FUNCTION 013_commission_rules.sql:98 DESCRIBES. It never updates a
 * rate in place; 084's trigger would refuse it if it tried.
 *
 * ONE STATEMENT, SO IT IS ATOMIC ON ANY HANDLE. The close and the open are a
 * single data-modifying CTE rather than two queries in a transaction. That
 * matters because src/db.mjs exports `db` as a bare { query } whose calls may
 * each land on a different pooled connection — a BEGIN issued through it would
 * be worse than useless (src/documents/register.mjs makes the same point). Two
 * separate statements through that handle could close the old row and then fail
 * to open the new one, leaving a card with NO terms in effect and no error
 * anyone would see until a history query came back empty. A single statement
 * cannot half-happen.
 *
 * Both rows take the SAME instant: effective_to on the old row equals
 * effective_from on the new one. With 084's half-open interval that leaves
 * neither a gap nor an overlap, so "which terms were in effect at T" always has
 * exactly one answer. clock_timestamp(), not now(), because now() is frozen for
 * a whole transaction and two changes inside one transaction would then collide
 * with the CHECK that a term must end after it begins.
 *
 * ABSENCE IS NOT A CHANGE. A field the caller did not supply carries forward
 * from the open row rather than being versioned to NULL — same rule the upsert
 * follows. So a refresh that reports only the credit limit does not silently
 * record "and all three APRs became unknown".
 *
 * NOTHING CHANGED MEANS NOTHING IS WRITTEN. A nightly refresh reporting the
 * same limit and the same rates returns { changed: false } and adds no row.
 * Without this the history would gain a row per card per night and the question
 * it exists to answer — when did this actually change — would be buried under
 * thousands of rows where it did not.
 */
export async function changeTerms(db, { orgId, cardLiabilityId, terms = {}, source = "bank", reason = null } = {}) {
  if (!orgId || !cardLiabilityId) throw new TypeError("changeTerms: orgId and cardLiabilityId are required");

  const open = await currentTerms(db, { cardLiabilityId });
  if (!open) {
    // No history yet — this is the first set of terms, not a change to one.
    return { changed: true, opened: await openTerms(db, { orgId, cardLiabilityId, terms, source, reason }), closed: null };
  }

  // Carry forward anything the caller did not report.
  const proposed = {};
  for (const f of TERM_FIELDS) proposed[f] = terms[f] ?? open[f] ?? null;

  const changedFields = TERM_FIELDS.filter((f) => termChanged(f, open[f], proposed[f]));
  if (changedFields.length === 0) return { changed: false, opened: open, closed: null, changedFields: [] };

  const values = [orgId, cardLiabilityId, source, reason, ...TERM_FIELDS.map((f) => proposed[f])];
  const cols = TERM_FIELDS.join(", ");
  const selects = TERM_FIELDS.map((_, i) => `$${i + 5}`).join(", ");

  const res = await db.query(
    `WITH closed AS (
       UPDATE card_liability_terms
          -- GREATEST against effective_from + 1ms: after the truncation above,
          -- two changes inside the same millisecond would otherwise close a row
          -- at the instant it opened, which 084's interval CHECK refuses. One
          -- millisecond of drift keeps them strictly ordered and is invisible to
          -- every question this table answers.
          SET effective_to = GREATEST(${MS_NOW}, effective_from + interval '1 millisecond')
        WHERE card_liability_id = $2 AND effective_to IS NULL
       RETURNING id, effective_to
     )
     INSERT INTO card_liability_terms (org_id, card_liability_id, source, reason, ${cols}, effective_from)
     SELECT $1, $2, $3, $4, ${selects},
            COALESCE((SELECT effective_to FROM closed), ${MS_NOW})
     RETURNING *`,
    values
  );

  return { changed: true, opened: res.rows[0], closed: open, changedFields };
}

/** listTerms — a card's whole history, newest first. */
export async function listTerms(db, { cardLiabilityId } = {}) {
  if (!cardLiabilityId) throw new TypeError("listTerms: cardLiabilityId is required");
  const res = await db.query(
    `SELECT * FROM card_liability_terms
      WHERE card_liability_id = $1
      ORDER BY effective_from DESC`,
    [cardLiabilityId]
  );
  return res.rows;
}

/**
 * termsAsOf — what was true at an instant. The reason 084 exists.
 *
 * Half-open interval, matching 084's own note: effective_from <= T AND
 * (effective_to IS NULL OR effective_to > T). Exactly one row can match, and
 * uq_card_liability_terms_open is what guarantees it.
 *
 * `at` is REQUIRED. No default to now(): a caller that meant "now" should say
 * so, and a caller that forgot to pass the date it was asking about would
 * otherwise get today's terms labelled as March's — which is the exact failure
 * this table was built to prevent.
 */
export async function termsAsOf(db, { cardLiabilityId, at } = {}) {
  if (!cardLiabilityId) throw new TypeError("termsAsOf: cardLiabilityId is required");
  if (!at) throw new TypeError("termsAsOf: `at` is required — an instant to ask about, not a default of now");
  const res = await db.query(
    `SELECT * FROM card_liability_terms
      WHERE card_liability_id = $1
        AND effective_from <= $2
        AND (effective_to IS NULL OR effective_to > $2)`,
    [cardLiabilityId, at]
  );
  return res.rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// the W6 read contract
// ---------------------------------------------------------------------------

/* Resolve either calling convention to a card id. A caller that already holds
   the card passes cardLiabilityId; a caller coming from the aggregator holds
   (clientId, accountRef) and nothing else. Both are legitimate and neither
   should have to do a lookup the store can do. */
async function resolveCardId(db, { cardLiabilityId, clientId, accountRef }) {
  if (cardLiabilityId) return cardLiabilityId;
  if (!clientId || !accountRef) {
    throw new TypeError("card-liabilities: pass cardLiabilityId, or clientId and accountRef");
  }
  const card = await getCardLiability(db, { clientId, accountRef });
  return card ? card.id : null;
}

/**
 * getCurrentLiability — the card AND the terms in effect right now.
 *
 * The two halves are separate tables on purpose (083 is what is true now, 084
 * is the dated record of how it got that way), and this is the call that puts
 * them back together for the ordinary "what does this card look like today"
 * question, so a caller does not have to know that 084 exists.
 *
 * Returns null when there is no such card. `terms` is null when the card exists
 * but nobody has recorded a term row for it — which is a real state, not an
 * error, and must not be papered over with an empty object full of zeroes.
 */
export async function getCurrentLiability(db, { cardLiabilityId, clientId, accountRef } = {}) {
  let card;
  if (cardLiabilityId) {
    card = (await db.query(`SELECT * FROM card_liabilities WHERE id = $1`, [cardLiabilityId])).rows[0] ?? null;
  } else {
    card = await getCardLiability(db, { clientId, accountRef });
  }
  if (!card) return null;
  return { card, terms: await currentTerms(db, { cardLiabilityId: card.id }) };
}

/**
 * getLiabilityHistory — every set of terms this card has ever carried, newest
 * first, each one dated.
 *
 * This is the whole point of 084 in one call: the answer to "what was the limit
 * when we underwrote them in March" is in here, and it stays correct no matter
 * how many times the issuer has moved it since.
 *
 * An unknown card returns [] rather than throwing. A card with no recorded
 * terms also returns [] — the two are distinguished by getCurrentLiability
 * returning null for the first and a card for the second.
 */
export async function getLiabilityHistory(db, { cardLiabilityId, clientId, accountRef } = {}) {
  const id = await resolveCardId(db, { cardLiabilityId, clientId, accountRef });
  if (!id) return [];
  return listTerms(db, { cardLiabilityId: id });
}

/* withTransaction is re-exported rather than reimplemented: src/documents/
   register.mjs already solved "pool vs checked-out client vs bare { query }"
   and a second copy of that logic is a second thing to get subtly wrong. It is
   not used by changeTerms — that is a single statement on purpose — but a
   caller composing an upsert AND a term change into one unit of work needs it. */
export { withTransaction };
