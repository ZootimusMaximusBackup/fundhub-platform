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
  "source", "source_ref", "account_ref", "opened_on", "raw", "as_of"
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
         -- Same reasoning: an account's open date does not change, so a re-pull
         -- that happens to omit it (or a payload shape this normalizer cannot
         -- yet read) must not erase a date a previous ingest already stored.
         opened_on          = COALESCE(EXCLUDED.opened_on, tradelines.opened_on),
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
 *  waterfall's own order, so the screen and the calculator agree).
 *
 * ⚠️ `orgId` IS REQUIRED AND IT IS A SECURITY BOUNDARY, NOT A FILTER.
 *
 * This function used to take `clientId` alone. Both callers —
 * api/read/tradelines.mjs and api/read/finance-os.mjs — passed the client id
 * straight off the query string, so ANY authenticated staff session could read
 * ANY client's credit limits and balances in ANY org, just by knowing the uuid.
 * The role gate was correct on both; there was simply no tenant check anywhere
 * between the request and the rows.
 *
 * This is the same defect class 054's own header warns about and the same one
 * the `roles`-key hole was (src/http/auth-gate.test.mjs): a guard that reads like
 * it is doing something and is not. It is fixed the way that one was — by making
 * the missing thing IMPOSSIBLE TO OMIT rather than by remembering to pass it.
 *
 * So this THROWS on a missing org rather than defaulting to unscoped. A caller
 * that cannot name an org has no business reading a client's balances, and a
 * silent fallback is exactly how the hole lasted this long. The org must come
 * from the SESSION (`staff.org_id`), never from user input — a caller-supplied
 * org is not a scope, it is a request to be trusted.
 */
export async function listTradelines(db, { clientId, orgId, includeClosed = false }) {
  if (!clientId) throw new TypeError("listTradelines: clientId is required");
  if (!orgId) {
    throw new TypeError(
      "listTradelines: orgId is required and must come from the session (staff.org_id). " +
      "Reading tradelines without an org scope exposes every org's credit data."
    );
  }
  /* THE ORG IS BOUND FIRST, AND THE ORDER IS LOAD-BEARING.
     Two branches wrote this guard independently and bound the parameters in
     opposite orders. src/http/deal-model-endpoints.test.mjs — "the tradelines
     read is org-scoped too, both bound" — reads params[0] and asserts it is the
     SESSION's org, which is the only way a stubbed db can prove the scope was
     applied rather than merely computed. Swapping the two makes that check read
     the client id and report "the org id bound was not the session's" on code
     that is in fact correctly scoped. Keep org first. */
  const res = await db.query(
    `SELECT * FROM tradelines
      WHERE org_id = $1
        AND client_id = $2
        AND ($3::boolean OR closed_at IS NULL)
      ORDER BY apr ASC NULLS LAST, lender ASC`,
    [orgId, clientId, includeClosed]
  );
  return res.rows;
}
