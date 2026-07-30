// Tradelines — the database half. Normalization lives next door in index.mjs so
// that the parsing rules stay testable without Postgres.
//
// UPSERT, NOT INSERT. A client gets pulled repeatedly; every pull re-reports the
// same cards with new balances. Inserting would grow a duplicate set per pull
// and the waterfall would draw the same card three times. The conflict target is
// the partial unique index from 054 — (client_id, account_ref) where account_ref
// is present.
//
// A LINE WITH NO account_ref CANNOT BE MATCHED, so it inserts. That is honest
// rather than clever: matching on (lender, limit) would merge two Amex cards
// with the same limit into one, and silently halve a client's available credit.
// The dashboard shows source and as_of per row, so an unmatched duplicate is
// visible to the closer instead of being quietly averaged away.

import { normalizeFromCrs } from "./index.mjs";

const COLUMNS = [
  "lender", "kind", "credit_limit_cents", "balance_cents", "apr",
  "source", "source_ref", "account_ref", "raw", "as_of"
];

/**
 * upsertTradelines — write normalized rows for one client.
 * Returns the stored rows. Empty input is a no-op returning [], NOT a delete:
 * a pull that parsed to nothing is far more likely to be an unrecognised payload
 * shape than a client who closed every account, and deleting on that reading
 * would erase manually-entered lines too.
 */
export async function upsertTradelines(db, { orgId, clientId, rows = [] }) {
  if (!orgId || !clientId) throw new TypeError("upsertTradelines: orgId and clientId are required");
  if (!rows.length) return [];

  const out = [];
  for (const r of rows) {
    const values = [orgId, clientId, ...COLUMNS.map((c) => (c === "raw" ? JSON.stringify(r[c] ?? {}) : r[c] ?? null))];
    const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");
    const res = await db.query(
      `INSERT INTO tradelines (org_id, client_id, ${COLUMNS.join(", ")})
       VALUES (${placeholders})
       ON CONFLICT (client_id, account_ref) WHERE account_ref IS NOT NULL
       DO UPDATE SET
         lender             = EXCLUDED.lender,
         kind               = EXCLUDED.kind,
         credit_limit_cents = EXCLUDED.credit_limit_cents,
         balance_cents      = EXCLUDED.balance_cents,
         -- COALESCE, not overwrite: a later pull that omits the APR must not
         -- erase a rate we already knew. Absence is not a correction.
         apr                = COALESCE(EXCLUDED.apr, tradelines.apr),
         source             = EXCLUDED.source,
         source_ref         = EXCLUDED.source_ref,
         raw                = EXCLUDED.raw,
         as_of              = EXCLUDED.as_of,
         updated_at         = now()
       RETURNING *`,
      values
    );
    out.push(res.rows[0]);
  }
  return out;
}

/**
 * ingestCrsResult — read the tradelines out of one crs_results row and store
 * them. This is the whole "the soft pull IS the card data" path from the
 * addendum's Finance OS section.
 */
export async function ingestCrsResult(db, crsRow) {
  const rows = normalizeFromCrs(crsRow);
  if (!rows.length) return { ingested: 0, rows: [] };
  const stored = await upsertTradelines(db, {
    orgId: crsRow.org_id,
    clientId: crsRow.client_id,
    rows
  });
  return { ingested: stored.length, rows: stored };
}

/** listTradelines — open lines for one client, cheapest money first (the
 *  waterfall's own order, so the screen and the calculator agree). */
export async function listTradelines(db, { clientId, includeClosed = false }) {
  const res = await db.query(
    `SELECT * FROM tradelines
      WHERE client_id = $1
        AND ($2::boolean OR closed_at IS NULL)
      ORDER BY apr ASC NULLS LAST, lender ASC`,
    [clientId, includeClosed]
  );
  return res.rows;
}
