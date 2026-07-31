// Card liabilities — the database half. Normalization lives next door in
// index.mjs so the parsing rules stay testable without Postgres. Same split as
// src/tradelines/.
//
// TWO TABLES, ONE WRITE. `card_liability_history` (084) is the durable series
// and the source of truth. `card_liabilities` (083) is a one-row-per-card
// projection of its newest entry, so the ordinary screen read is an indexed
// lookup instead of a sort over a growing series. `recordLiability()` writes
// both in a single transaction — there is no path that writes one and not the
// other, which is what stops the two from becoming two answers to one question.
//
// THE PROJECTION NEVER MOVES BACKWARDS. The 083 upsert carries
// `WHERE EXCLUDED.as_of >= card_liabilities.as_of`. A backfill of an older
// statement lands in the series and leaves the current position alone. Without
// that guard, loading last quarter's file after this month's would show a client
// a balance that is weeks stale — and it would look authoritative.
//
// ORDERING IS BY `as_of`, TIE-BROKEN BY `created_at DESC`. `as_of` is when the
// position was true; `created_at` is when we wrote it. A pull run Monday and
// ingested Wednesday describes Monday. Ties on the same as_of are a bureau
// restating one statement date, and the later write is the correction.
//
// UPSERT, NOT INSERT — same reasoning as src/tradelines/store.mjs. A retried job
// re-reads the same pull; appending would grow a duplicate observation per retry
// and turn a flat balance into a staircase.
//
// NULL IS UNKNOWN AND IS WRITTEN AS NULL. Nothing here coalesces a missing
// minimum payment, balance or APR to zero. `COALESCE` appears exactly once, on
// the 083 upsert of `apr`, and it is there for the opposite reason: a later file
// that omits the rate must not ERASE a rate we already knew. Absence is not a
// correction.

import { normalizeLiabilitiesFromCrs } from "./index.mjs";
// REUSED, NOT REWRITTEN. `withTransaction` already exists and already handles
// the three handle shapes this repo passes around — a pg Pool (pin a connection,
// BEGIN/COMMIT), a checked-out client (run inline, the caller owns the
// transaction), and the plain `{ query }` wrapper from src/db.mjs (no pinning
// possible, so it runs unwrapped). Writing a fourth copy of that logic is the
// duplication rule this repo keeps paying for. It lives in documents/register.mjs
// only because that is where it was first needed; nothing about it is
// document-specific.
import { withTransaction } from "../documents/register.mjs";

// The measure columns, in one list, used to build every statement below. One
// list means the two tables cannot drift apart column by column.
const MEASURES = [
  "as_of",
  "statement_balance_cents",
  "current_balance_cents",
  "minimum_payment_cents",
  "past_due_cents",
  "last_payment_cents",
  "last_payment_date",
  "statement_date",
  "payment_due_date",
  "apr",
  "payment_status",
  "source",
  "source_ref",
  "raw"
];

function valuesFor(row) {
  return MEASURES.map((c) => (c === "raw" ? JSON.stringify(row[c] ?? {}) : row[c] ?? null));
}

/**
 * recordLiability — store one observed position for one card.
 *
 * Appends to the series, then advances the current-position projection if this
 * observation is not older than the one already there. Returns
 * `{ history, current }` — `current` is the projection row as it stands AFTER
 * the write, which is not necessarily this observation (see the backfill guard
 * above).
 *
 * Pass a pool for real atomicity. A checked-out client runs inline inside the
 * transaction the caller already opened. The plain `{ query }` wrapper from
 * src/db.mjs cannot be pinned to one connection, so it runs unwrapped — safe
 * here because both writes are upserts keyed on the same observation, so a
 * retry of an interrupted call converges rather than duplicating.
 */
export async function recordLiability(db, { orgId, clientId, tradelineId, row }) {
  if (!orgId || !clientId || !tradelineId) {
    throw new TypeError("recordLiability: orgId, clientId and tradelineId are required");
  }
  if (!row?.as_of) throw new TypeError("recordLiability: row.as_of is required");

  return withTransaction(db, async (tx) => {
    const historyRow = await appendHistory(tx, { orgId, clientId, tradelineId, row });
    const current = await upsertCurrent(tx, { orgId, clientId, tradelineId, row });
    // Point the series entry at the projection it feeds. Done after both writes
    // because on a backfill the projection is an OLDER row than this one, and
    // the link should name whichever projection is actually live.
    if (current?.id) {
      await tx.query(`UPDATE card_liability_history SET liability_id = $1 WHERE id = $2`,
        [current.id, historyRow.id]);
      historyRow.liability_id = current.id;
    }
    return { history: historyRow, current };
  });
}

async function appendHistory(db, { orgId, clientId, tradelineId, row }) {
  const values = [orgId, clientId, tradelineId, ...valuesFor(row)];
  const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");
  const res = await db.query(
    `INSERT INTO card_liability_history (org_id, client_id, tradeline_id, ${MEASURES.join(", ")})
     VALUES (${placeholders})
     ON CONFLICT (tradeline_id, as_of) DO UPDATE SET
       statement_balance_cents = EXCLUDED.statement_balance_cents,
       current_balance_cents   = EXCLUDED.current_balance_cents,
       minimum_payment_cents   = EXCLUDED.minimum_payment_cents,
       past_due_cents          = EXCLUDED.past_due_cents,
       last_payment_cents      = EXCLUDED.last_payment_cents,
       last_payment_date       = EXCLUDED.last_payment_date,
       statement_date          = EXCLUDED.statement_date,
       payment_due_date        = EXCLUDED.payment_due_date,
       apr                     = COALESCE(EXCLUDED.apr, card_liability_history.apr),
       payment_status          = EXCLUDED.payment_status,
       source                  = EXCLUDED.source,
       source_ref              = EXCLUDED.source_ref,
       raw                     = EXCLUDED.raw,
       created_at              = now()
     RETURNING *`,
    values
  );
  return res.rows[0];
}

async function upsertCurrent(db, { orgId, clientId, tradelineId, row }) {
  const values = [orgId, clientId, tradelineId, ...valuesFor(row)];
  const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");
  const res = await db.query(
    `INSERT INTO card_liabilities (org_id, client_id, tradeline_id, ${MEASURES.join(", ")})
     VALUES (${placeholders})
     ON CONFLICT (tradeline_id) DO UPDATE SET
       as_of                   = EXCLUDED.as_of,
       statement_balance_cents = EXCLUDED.statement_balance_cents,
       current_balance_cents   = EXCLUDED.current_balance_cents,
       minimum_payment_cents   = EXCLUDED.minimum_payment_cents,
       past_due_cents          = EXCLUDED.past_due_cents,
       last_payment_cents      = EXCLUDED.last_payment_cents,
       last_payment_date       = EXCLUDED.last_payment_date,
       statement_date          = EXCLUDED.statement_date,
       payment_due_date        = EXCLUDED.payment_due_date,
       apr                     = COALESCE(EXCLUDED.apr, card_liabilities.apr),
       payment_status          = EXCLUDED.payment_status,
       source                  = EXCLUDED.source,
       source_ref              = EXCLUDED.source_ref,
       raw                     = EXCLUDED.raw,
       updated_at              = now()
     WHERE EXCLUDED.as_of >= card_liabilities.as_of
     RETURNING *`,
    values
  );
  // Zero rows means the guard above rejected this write as older than what is
  // already current. That is a success, not a failure — read back the row that
  // stands, so callers always get the live projection.
  if (res.rows[0]) return res.rows[0];
  return getCurrentLiability(db, { tradelineId });
}

/**
 * getCurrentLiability — the position that stands for one card, or null.
 *
 * Reads the 083 projection by default: one indexed row, no sort. Pass
 * `{ fromHistory: true }` to compute it from the series instead, which is the
 * same answer by construction and is what the pg tests use to prove the
 * projection has not drifted.
 *
 * Call with `{ tradelineId }` for one card, or `{ clientId }` for every card the
 * client holds (returns an array in that case — see getCurrentLiabilities).
 */
export async function getCurrentLiability(db, { tradelineId, fromHistory = false } = {}) {
  if (!tradelineId) throw new TypeError("getCurrentLiability: tradelineId is required");
  if (fromHistory) {
    const res = await db.query(
      `SELECT * FROM card_liability_history
        WHERE tradeline_id = $1
        ORDER BY as_of DESC, created_at DESC
        LIMIT 1`,
      [tradelineId]
    );
    return res.rows[0] ?? null;
  }
  const res = await db.query(`SELECT * FROM card_liabilities WHERE tradeline_id = $1`, [tradelineId]);
  return res.rows[0] ?? null;
}

/**
 * getCurrentLiabilities — the standing position on every card a client holds.
 * Most urgent first; an unknown due date sorts LAST, because "we do not know
 * when this is due" is not "this is due today" and must not head a list a closer
 * reads out loud.
 */
export async function getCurrentLiabilities(db, { clientId }) {
  if (!clientId) throw new TypeError("getCurrentLiabilities: clientId is required");
  const res = await db.query(
    `SELECT * FROM card_liabilities
      WHERE client_id = $1
      ORDER BY payment_due_date ASC NULLS LAST, as_of DESC`,
    [clientId]
  );
  return res.rows;
}

/**
 * getLiabilityHistory — the series for one card, newest first.
 *
 * ORDER BY as_of DESC, created_at DESC — the ordering key decision from 084,
 * stated once and matched by the index. `limit` caps the series for a screen
 * that shows the last N statements; omit it for the whole record.
 *
 * Returns [] for a card with no observations. That is not an error and must not
 * be rendered as a zero balance.
 */
export async function getLiabilityHistory(db, { tradelineId, clientId, limit = null } = {}) {
  if (!tradelineId && !clientId) {
    throw new TypeError("getLiabilityHistory: tradelineId or clientId is required");
  }
  const where = tradelineId ? "tradeline_id = $1" : "client_id = $1";
  const params = [tradelineId ?? clientId];
  let sql =
    `SELECT * FROM card_liability_history
      WHERE ${where}
      ORDER BY as_of DESC, created_at DESC`;
  if (limit != null) {
    params.push(limit);
    sql += ` LIMIT $${params.length}`;
  }
  const res = await db.query(sql, params);
  return res.rows;
}

/**
 * ingestCrsLiabilities — read the billing positions out of one stored pull and
 * record them against the cards they belong to.
 *
 * A position is attached to a `tradelines` row by (client_id, account_ref), the
 * same key 054's partial unique index uses. A record whose account_ref matches
 * no known card is SKIPPED and counted, not invented into a new tradeline: this
 * module owns liability positions, not the card registry, and creating a card
 * here would put a second writer on a table `src/tradelines/store.mjs` already
 * owns. The skipped count is returned so a caller can see it happened.
 */
export async function ingestCrsLiabilities(db, crsRow) {
  const rows = normalizeLiabilitiesFromCrs(crsRow);
  if (!rows.length) return { recorded: 0, skipped: 0, rows: [] };

  const refs = rows.map((r) => r.account_ref);
  const known = await db.query(
    `SELECT id, account_ref FROM tradelines WHERE client_id = $1 AND account_ref = ANY($2::text[])`,
    [crsRow.client_id, refs]
  );
  const byRef = new Map(known.rows.map((r) => [r.account_ref, r.id]));

  const out = [];
  let skipped = 0;
  for (const row of rows) {
    const tradelineId = byRef.get(row.account_ref);
    if (!tradelineId) { skipped += 1; continue; }
    const { current } = await recordLiability(db, {
      orgId: crsRow.org_id,
      clientId: crsRow.client_id,
      tradelineId,
      row
    });
    out.push(current);
  }
  return { recorded: out.length, skipped, rows: out };
}
