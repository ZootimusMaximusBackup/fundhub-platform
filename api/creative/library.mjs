// GET /api/creative/library — the creative library.
//
//   ?state=pending|passed|blocked|approved|all   (compliance_state)
//   ?kind=static|video|copy   ?format=1x1|4x5|9x16|16x9
//   ?brand_kit_id=  ?include_archived=1  ?limit= ?offset=
//
// storage_key is NOT selected. It is a capability — a signed-URL input — and
// src/http/read-api.mjs's redact() would strip it anyway, but not selecting it in
// the first place means it never enters the process. The screens get
// has_storage_key instead, which is all they need to decide whether to render a
// thumbnail.
import { db } from "../../src/db.mjs";
import { partnerReadHandler, stateFilter } from "../../src/http/partner-read-api.mjs";

const STATES = ["pending", "passed", "blocked", "approved"];
const KINDS = ["static", "video", "copy"];
const FORMATS = ["1x1", "4x5", "9x16", "16x9"];

/* fetchRows is exported so the SQL can be executed directly by
   src/http/creative-endpoints.pg.test.mjs. An endpoint whose query only ever runs
   behind an HTTP handler is one whose column names go unchecked until a partner
   opens the screen. */
export const fetchRows = (tx, { limit, offset, query }) => {
  const state = stateFilter(query, "a.compliance_state", STATES);
  const params = [limit + 1, offset];
  const where = [];

  if (state.sql !== "TRUE") { params.push(state.params[0]); where.push(state.sql.replace("$$", `$${params.length}`)); }
  // An unrecognised kind/format is ignored rather than 400: unlike ?state=, these
  // are cosmetic filters and a stray value should not blank the screen.
  if (KINDS.includes(String(query.kind))) { params.push(query.kind); where.push(`a.kind = $${params.length}`); }
  if (FORMATS.includes(String(query.format))) { params.push(query.format); where.push(`a.format = $${params.length}`); }
  if (query.brand_kit_id) { params.push(query.brand_kit_id); where.push(`a.brand_kit_id = $${params.length}`); }
  if (query.include_archived !== "1") where.push("a.archived_at IS NULL");

  return tx.query(
    `SELECT a.id, a.brand_kit_id, a.kind, a.format, a.provider, a.duration_sec,
            a.ai_generated, a.synthetic_performer, a.compliance_state, a.blocked_reasons,
            a.parent_asset_id, a.archived_at, a.created_at,
            (a.storage_key IS NOT NULL) AS has_storage_key,
            k.name AS brand_kit_name
       FROM creative_assets a
       LEFT JOIN brand_kits k ON k.id = a.brand_kit_id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY a.created_at DESC
      LIMIT $1 OFFSET $2`,
    params
  ).then((r) => r.rows);
};

const run = partnerReadHandler({
  fetch: fetchRows,

});

export default (req, res) => run(req, res, { db });
