-- 267_document_check_live.sql — Document Check is not a GoHighLevel robot.
--
-- WHAT IS WRONG, MEASURED ON LIVE 2026-08-27.
--   Client 89f1a12f-f824-4451-9a53-5705b55374ca uploaded a file at 07:33:23.
--   documents row 3f65f4fe-…, events row 17437f8d-… name 'docs.received'.
--   agent_runs row eb2d00f7-… outcome 'ghl_doc_retired'.
--   messages after 07:33:23 for that client: two closer pay-link sends and
--   nothing else. No SMS-DOC-02-REQUEST-MORE, no DOC-03. The upload was
--   answered with silence.
--
-- HOW IT GOT THERE. 168_retire_ghl_agents.sql retired every row whose code
-- starts with 'GHL-' when the owner cancelled GoHighLevel on 2026-08-15.
-- GHL-DOC was swept up by its name. It has never run on GoHighLevel:
-- 255_ghl_doc_docs_received.sql rewired it off the GHL-era tag onto the
-- docs.received bus event, and src/workflows/ghl-doc-document-check.mjs runs
-- it on Inngest inside this repository.
--
-- Then PR #210 (2026-08-25) taught the code to honour that status — correctly,
-- given the row said retired: src/handlers/ghl-doc.mjs returns ghl_doc_retired
-- before calling the model, and src/messaging/dispatch.mjs blocks any
-- SMS-DOC-02 already queued. Both gates read agents.status, so both clear
-- themselves the moment this row is live again. No code change is needed.
--
-- 168 IS NOT EDITED. db/migrate.mjs keys schema_migrations by '<dir>/<file>'
-- and skips anything already applied, so an edit there is a silent no-op.
-- This file supersedes it for this one row.
--
-- SCOPED TO ONE ROW ON PURPOSE. GHL-A1..A7 and GHL-RECON stay retired.
-- GoHighLevel is still out and AG-07 already replaced GHL-RECON (260).
--
-- GUARDRAILS ARE LEFT '{}' ON PURPOSE. src/agents/runtime.mjs is the only
-- code that enforces them and it never sees this agent — src/agents/select.mjs
-- only considers sms / email / sms_email agents and this one is 'internal'.
-- Filling them would be inventing policy, and authority.msgcap in particular
-- would cap the very messages this migration exists to restore.

UPDATE agents
   SET status        = 'live',
       retired_at    = NULL,
       runtime       = 'inngest',
       runtime_ref   = 'ghl-doc-document-check',
       went_live_at  = COALESCE(went_live_at, now()),
       runtime_notes = COALESCE(runtime_notes || ' · ', '') ||
         'Turned back on by migration 267 on 2026-08-27. Retired in error by 168, ' ||
         'which retired every GHL-* row when GoHighLevel was cancelled. This agent ' ||
         'runs on the Inngest function ghl-doc-document-check on docs.received, ' ||
         'not on GoHighLevel.',
       updated_at    = now()
 WHERE code = 'GHL-DOC'
   AND status = 'retired'
   AND prompt IS NOT NULL
   AND btrim(prompt) <> '';

-- 255 already wrote this row. Re-asserted so the Agent Editor's trigger count
-- is right now that the agent is live, and so a database that missed 255 is
-- not left with a live agent nothing wakes.
INSERT INTO agent_triggers (org_id, agent_code, event_name, source, note)
SELECT a.org_id, a.code, 'docs.received', 'seed',
       'Raised by api/documents-upload.mjs. Runs src/workflows/ghl-doc-document-check.mjs.'
  FROM agents a
 WHERE a.code = 'GHL-DOC'
ON CONFLICT (org_id, agent_code, event_name) DO UPDATE
  SET enabled = true,
      updated_at = now();
