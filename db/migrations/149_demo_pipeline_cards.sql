-- 149_demo_pipeline_cards.sql — put demo clients on the Sales board.
INSERT INTO cards (org_id, client_id, pipeline_id, stage_id, owner)
SELECT c.org_id, c.id, p.id, s.id, 'DEMO Owner'
  FROM clients c
  JOIN orgs o ON o.id = c.org_id AND o.slug = 'fundhub'
  JOIN pipelines p ON p.org_id = c.org_id AND p.key = 'sales'
  JOIN pipeline_stages s ON s.pipeline_id = p.id AND s.key = 'new_lead'
 WHERE c.is_demo IS TRUE
   AND NOT EXISTS (
     SELECT 1 FROM cards x
      WHERE x.client_id = c.id AND x.pipeline_id = p.id
   );
