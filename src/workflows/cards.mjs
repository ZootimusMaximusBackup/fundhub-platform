// moveCardToStage — GHL's "Move Opportunity to Stage X" action, ported as a
// find-or-create against cards/pipelines/pipeline_stages (seeded in
// db/seed/002_pipelines.sql — pipeline/stage keys must match that seed exactly).
// Idempotent: find-or-create + a plain UPDATE, safe to run twice.
export async function moveCardToStage(db, { orgId, clientId, pipelineKey, stageKey }) {
  // Org is required. Looking up by key alone used to pick another company's
  // pipeline when two orgs shared the same key names (every org has "sales"),
  // then INSERT a card with this org_id and that foreign pipeline_id. The
  // dashboard read joins on p.org_id = cd.org_id, so those cards vanished from
  // every board — sample markup painted, the API answered "ok, 0 cards", and
  // the screen went blank.
  if (!orgId) return { moved: false, reason: "org_required" };
  const stage = await db.query(
    `SELECT ps.id AS stage_id, ps.pipeline_id FROM pipeline_stages ps
     JOIN pipelines p ON p.id = ps.pipeline_id
     WHERE p.key = $1 AND ps.key = $2 AND p.org_id = $3 AND ps.org_id = $3
     LIMIT 1`,
    [pipelineKey, stageKey, orgId]
  );
  const row = stage.rows[0];
  if (!row) return { moved: false, reason: "stage_not_found" };

  const existing = await db.query(
    `SELECT id FROM cards WHERE client_id = $1 AND pipeline_id = $2 LIMIT 1`,
    [clientId, row.pipeline_id]
  );
  if (existing.rows[0]) {
    await db.query(`UPDATE cards SET stage_id = $2 WHERE id = $1`, [existing.rows[0].id, row.stage_id]);
    return { moved: true, created: false };
  }
  await db.query(
    `INSERT INTO cards (org_id, client_id, pipeline_id, stage_id) VALUES ($1,$2,$3,$4)
     ON CONFLICT (client_id, pipeline_id) DO UPDATE SET stage_id = EXCLUDED.stage_id`,
    [orgId, clientId, row.pipeline_id, row.stage_id]
  );
  return { moved: true, created: true };
}
