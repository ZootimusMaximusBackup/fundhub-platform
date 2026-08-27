// GET /api/dashboard/pipeline-counts
//
// One number per pipeline: how many cards are sitting on that rail right now.
//
// This exists because the board's rail tabs each show a count, and the only way
// to get those counts used to be to fetch every rail's FULL board — all stages,
// all cards, up to 500 rows each — and then throw the cards away and keep the
// length. Eight rails meant eight full board reads on every page load, seven of
// them for rails nobody was looking at. This answers all eight in one query.
//
// The count matches what the board itself would show: a card is counted only if
// its stage still belongs to the pipeline and its client is present, not demo
// (unless the org has demo mode on) and not archived — the same three filters
// api/dashboard/pipeline.mjs applies. The one difference is deliberate: that
// endpoint stops reading at its LIMIT, so a rail past the cap would under-count
// there. This returns the true total.
//
// Read-only. SELECT only. Mirrors api/dashboard/pipeline.mjs style.
import { db } from "../../src/db.mjs";
import { requireDashboardAccess } from "../../src/http/dashboard-auth.mjs";
import { CLIENT_DATA_ERRORS, requireRole, ROLE_SETS } from "../../src/http/read-api.mjs";
import { requireSessionOrg } from "../../src/http/session-org.mjs";
import { safeError } from "../../src/http/health.mjs";
import { orgDemoModeEnabled } from "../../src/demo/exclude-demo.mjs";

// LEFT JOINs so a pipeline with no cards still answers with 0 rather than
// vanishing from the map. The FILTER is what keeps a card that failed one of
// the joins from being counted anyway.
const COUNTS_SQL = `
  SELECT p.key AS pipeline_key,
         COUNT(cd.id) FILTER (
           WHERE s.id IS NOT NULL
             AND (c.id IS NOT NULL OR pr.id IS NOT NULL)
             AND ($2::boolean OR COALESCE(c.is_demo, false) = false)
             AND (c.custom_fields->>'crm_archived_at') IS NULL
         )::int AS count
    FROM pipelines p
    LEFT JOIN cards cd
      ON cd.pipeline_id = p.id AND cd.org_id = $1
    LEFT JOIN pipeline_stages s
      ON s.id = cd.stage_id AND s.pipeline_id = p.id
    LEFT JOIN clients c
      ON c.id = cd.client_id AND c.org_id = p.org_id
    LEFT JOIN partners pr
      ON pr.id = cd.partner_id AND pr.org_id = p.org_id
   WHERE p.org_id = $1
   GROUP BY p.key
   ORDER BY p.key ASC
`;

export default async function handler(req, res) {
  if (req.method && req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  const staff = await requireDashboardAccess(req, res, { db });
  if (!staff) return;
  if (staff !== true && !requireRole(res, staff, ROLE_SETS.STAFF)) return;
  const orgId = requireSessionOrg(res, staff);
  if (!orgId) return;

  try {
    const demoOn = await orgDemoModeEnabled(db, orgId);
    const { rows } = await db.query(COUNTS_SQL, [orgId, demoOn]);

    // A map keyed by pipeline key, because that is what the caller holds. A
    // rail this org has no pipeline row for is simply absent — the board leaves
    // those tabs on their "—", which is the honest answer for unknown.
    const counts = {};
    for (const r of rows) counts[r.pipeline_key] = r.count;

    return res.status(200).json({ ok: true, counts });
  } catch (err) {
    if (CLIENT_DATA_ERRORS.has(err && err.code)) {
      return res.status(400).json({ ok: false, error: "invalid_parameter" });
    }
    return res.status(503).json({ ok: false, db: "down", error: safeError(err) });
  }
}
