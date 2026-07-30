// GET /api/dashboard/pipeline?key=sales
//
// The board, as the database actually holds it: the pipeline's stages in
// sort_order, each with the client cards currently sitting in it.
//
// This exists because /api/dashboard/clients returns journey flags
// (crs_paid, deposit_paid, sale_closed) but no stage, and a board built by
// inferring stage from payment flags would be a guess dressed as data. The
// real position is cards.stage_id — one row per client per pipeline — so the
// board reads it directly and no mapping is invented anywhere.
//
// Read-only. SELECT only. Mirrors api/dashboard/clients.mjs style.
import { db } from "../../src/db.mjs";
import { requireDashboardAccess } from "../../src/http/dashboard-auth.mjs";

// Stages first, so a stage with no cards still renders as an empty column
// rather than vanishing from the board.
const STAGES_SQL = `
  SELECT s.id, s.key, s.name, s.sort_order
    FROM pipeline_stages s
    JOIN pipelines p ON p.id = s.pipeline_id
   WHERE p.key = $1
   ORDER BY s.sort_order ASC, s.name ASC
`;

const CARDS_SQL = `
  SELECT
    cd.id,
    cd.stage_id,
    cd.owner,
    cd.entered_at,
    c.id            AS client_id,
    c.first_name,
    c.last_name,
    c.outcome_tier,
    c.funded,
    c.funded_amount,
    (c.custom_fields->>'total_funding_estimate') AS total_funding_estimate
  FROM cards cd
  JOIN pipelines p ON p.id = cd.pipeline_id
  JOIN clients   c ON c.id = cd.client_id
  WHERE p.key = $1
  ORDER BY cd.entered_at DESC
  LIMIT $2
`;

export default async function handler(req, res) {
  // Staff session first; DASHBOARD_SECRET stays as the fallback until cutover,
  // matching the other dashboard routes.
  const staff = await requireDashboardAccess(req, res, { db });
  if (!staff) return;

  const key = String(req.query?.key || "sales");
  const limit = Math.min(parseInt(req.query?.limit ?? "500", 10) || 500, 2000);

  try {
    const stagesRes = await db.query(STAGES_SQL, [key]);
    if (stagesRes.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "unknown_pipeline", key });
    }
    const cardsRes = await db.query(CARDS_SQL, [key, limit]);

    // Group in one pass; a card whose stage was filtered out is dropped rather
    // than silently re-homed into the first column.
    const byStage = new Map(stagesRes.rows.map((s) => [s.id, []]));
    for (const r of cardsRes.rows) {
      const bucket = byStage.get(r.stage_id);
      if (!bucket) continue;
      const est = r.funded_amount ?? r.total_funding_estimate ?? null;
      bucket.push({
        id: r.id,
        client_id: r.client_id,
        name: [r.first_name, r.last_name].filter(Boolean).join(" ") || "(unnamed)",
        owner: r.owner ?? null,
        entered_at: r.entered_at,
        outcome_tier: r.outcome_tier ?? null,
        funded: r.funded ?? false,
        amount: est === null ? null : Number(est)
      });
    }

    const stages = stagesRes.rows.map((s) => {
      const cards = byStage.get(s.id) || [];
      return {
        key: s.key,
        name: s.name,
        sort_order: s.sort_order,
        count: cards.length,
        // Column money is the sum of what is actually in the column, so it can
        // never disagree with the cards under it.
        amount: cards.reduce((a, c) => a + (c.amount || 0), 0),
        cards
      };
    });

    return res.status(200).json({
      ok: true,
      pipeline: key,
      stages,
      total: cardsRes.rows.length
    });
  } catch (err) {
    return res.status(503).json({ ok: false, db: "down", error: err.message });
  }
}
