-- 255_ghl_doc_docs_received.sql
-- GHL-DOC was seeded against the GHL-era tag docs:uploaded. Nothing in this
-- stack raises that tag. api/documents-upload.mjs emits docs.received.
-- The runner is src/workflows/ghl-doc-document-check.mjs. JSON accept /
-- request_more / hold routing is not this migration.

UPDATE agents
   SET trigger_events = '["docs.received"]'::jsonb,
       updated_at = now()
 WHERE code = 'GHL-DOC';

DELETE FROM agent_triggers
 WHERE agent_code = 'GHL-DOC'
   AND event_name <> 'docs.received';

INSERT INTO agent_triggers (org_id, agent_code, event_name, source, note)
SELECT a.org_id, a.code, 'docs.received', 'seed',
       'Rewired from GHL-era tag docs:uploaded. Raised by api/documents-upload.mjs.'
  FROM agents a
 WHERE a.code = 'GHL-DOC'
ON CONFLICT (org_id, agent_code, event_name) DO UPDATE
  SET source = EXCLUDED.source,
      note = EXCLUDED.note,
      enabled = true,
      updated_at = now();
