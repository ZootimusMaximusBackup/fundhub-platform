// GET /api/creative/jobs — generation job status.
//
//   ?state=queued|running|succeeded|failed|all   ?limit= ?offset=
//
// `error` IS returned, on purpose: a partner whose generation failed needs to know
// why, and hiding it turns a fixable problem into a support ticket. That is only
// safe because src/creative/providers/_http.mjs scrubs anything key-shaped out of
// a provider error before it is stored — see the credential tests in
// src/creative/providers/providers.test.mjs.
//
// cost_cents is NOT returned. It is fundhub's vendor cost, and UNIT 9 bills a
// marked-up figure derived from it; showing the raw cost would publish the markup.
import { db } from "../../src/db.mjs";
import { partnerReadHandler, stateFilter } from "../../src/http/partner-read-api.mjs";

const STATES = ["queued", "running", "succeeded", "failed"];

/* fetchRows is exported so the SQL can be executed directly by
   src/http/creative-endpoints.pg.test.mjs. An endpoint whose query only ever runs
   behind an HTTP handler is one whose column names go unchecked until a partner
   opens the screen. */
export const fetchRows = (tx, { limit, offset, query }) => {
  const state = stateFilter(query, "j.status", STATES);
  const params = [limit + 1, offset, ...state.params];
  return tx.query(
    `SELECT j.id, j.brand_kit_id, j.provider, j.status, j.attempt, j.error,
            j.idempotency_key, j.started_at, j.finished_at, j.created_at,
            j.spec -> 'assetKind'  AS asset_kind,
            j.spec -> 'formats'    AS formats,
            j.spec -> 'variants'   AS variants,
            (SELECT count(*)::int FROM generation_job_assets ja WHERE ja.job_id = j.id) AS asset_count
       FROM generation_jobs j
      WHERE ${state.sql.replace("$$", `$${params.length}`)}
      ORDER BY j.created_at DESC
      LIMIT $1 OFFSET $2`,
    params
  ).then((r) => r.rows);
};

const run = partnerReadHandler({
  fetch: fetchRows,

});

export default (req, res) => run(req, res, { db });
