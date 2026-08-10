-- 161_optimization_repair_pipeline.sql
-- Replace five Optimization stages with the DFY repair pipeline (CREDIT-REPAIR-PIPELINE-SPEC).
-- Remap existing cards from old keys to new equivalents. No specialist_review stage.

WITH org_pipelines AS (
  SELECT p.org_id, p.id AS pipeline_id
  FROM pipelines p
  WHERE p.key = 'optimization'
)
INSERT INTO pipeline_stages (org_id, pipeline_id, key, name, sort_order)
SELECT op.org_id, op.pipeline_id, v.key, v.name, v.ord
FROM org_pipelines op
CROSS JOIN (VALUES
  ('intake', 'Intake', 0),
  ('awaiting_documents', 'Awaiting Documents', 1),
  ('analysis', 'Analysis', 2),
  ('letters_generated', 'Letters Generated', 3),
  ('ready_to_send', 'Ready to Send', 4),
  ('in_transit', 'In Transit', 5),
  ('awaiting_response', 'Awaiting Response', 6),
  ('response_received', 'Response Received', 7),
  ('round_complete', 'Round Complete', 8),
  ('program_complete', 'Program Complete', 9),
  ('on_hold', 'On Hold', 100),
  ('stalled', 'Stalled', 101),
  ('cancelled', 'Cancelled', 102)
) AS v(key, name, ord)
WHERE NOT EXISTS (
  SELECT 1 FROM pipeline_stages ps
  WHERE ps.pipeline_id = op.pipeline_id AND ps.key = v.key AND ps.org_id = op.org_id
);

-- Remap cards on retired stage keys
UPDATE cards c
SET stage_id = neu.id
FROM pipeline_stages old
JOIN pipelines p ON p.id = old.pipeline_id AND p.key = 'optimization'
JOIN pipeline_stages neu ON neu.pipeline_id = old.pipeline_id AND neu.org_id = old.org_id
WHERE c.stage_id = old.id
  AND (
    (old.key = 'round_sent' AND neu.key = 'in_transit') OR
    (old.key = 'bureau_processing' AND neu.key = 'awaiting_response') OR
    (old.key = 'portal_updated' AND neu.key = 'response_received') OR
    (old.key = 'upgrade_invite' AND neu.key = 'program_complete')
  );

-- Hide old stage keys from boards (keep rows so history does not break)
UPDATE pipeline_stages ps
SET sort_order = 900 + ps.sort_order
FROM pipelines p
WHERE p.id = ps.pipeline_id AND p.key = 'optimization'
  AND ps.key IN ('round_sent', 'bureau_processing', 'portal_updated', 'upgrade_invite');
