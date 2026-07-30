// GET /api/creative/brand-kits — the partner's brand kits.
//
//   ?state=draft|active|archived|all   ?limit= ?offset=
//
// Read-only. Auth, tenancy scoping, pagination and redaction all come from
// src/http/partner-read-api.mjs; this file is its SQL and nothing else.
//
// No partner_id predicate below, deliberately: the query runs inside
// withPartnerScope, so the RLS policy from 045 supplies it. Outside that scope the
// same SQL returns zero rows rather than every partner's kits.
import { db } from "../../src/db.mjs";
import { partnerReadHandler, stateFilter } from "../../src/http/partner-read-api.mjs";

const STATES = ["draft", "active", "archived"];

/* fetchRows is exported so the SQL can be executed directly by
   src/http/creative-endpoints.pg.test.mjs. An endpoint whose query only ever runs
   behind an HTTP handler is one whose column names go unchecked until a partner
   opens the screen. */
export const fetchRows = (tx, { limit, offset, query }) => {
  const state = stateFilter(query, "k.status", STATES);
  const params = [limit + 1, offset, ...state.params];
  return tx.query(
    `SELECT k.id, k.name, k.source_url, k.scraped_at, k.palette, k.fonts,
            k.voice_profile, k.products, k.status, k.logo_asset_id,
            k.created_at, k.updated_at,
            (SELECT count(*)::int FROM creative_assets a
              WHERE a.brand_kit_id = k.id AND a.archived_at IS NULL) AS asset_count
       FROM brand_kits k
      WHERE ${state.sql.replace("$$", `$${params.length}`)}
      ORDER BY k.created_at DESC
      LIMIT $1 OFFSET $2`,
    params
  ).then((r) => r.rows);
};

const run = partnerReadHandler({
  fetch: fetchRows,

});

export default (req, res) => run(req, res, { db });
