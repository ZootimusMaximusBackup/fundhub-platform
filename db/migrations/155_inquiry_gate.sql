-- 155_inquiry_gate.sql — Inquiry Gate v2 schema + pipeline stages.
--
-- Adds delivery/call-clock + owner override columns on inquiry_removal_cases.
-- Inserts awaiting_documents + letters_sent into the existing inquiry_removal
-- pipeline for every org that has it. Does NOT edit db/seed/002_pipelines.sql.

ALTER TABLE inquiry_removal_cases
  ADD COLUMN IF NOT EXISTS first_delivery_at  timestamptz,
  ADD COLUMN IF NOT EXISTS first_delivery_channel text
    CHECK (first_delivery_channel IS NULL OR first_delivery_channel IN ('portal', 'mail')),
  ADD COLUMN IF NOT EXISTS call_due_at        timestamptz,
  ADD COLUMN IF NOT EXISTS call_fired_at      timestamptz,
  ADD COLUMN IF NOT EXISTS letter_provider_id text,
  ADD COLUMN IF NOT EXISTS portal_confirmation text,
  ADD COLUMN IF NOT EXISTS gate_override_by   uuid REFERENCES staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS gate_override_at   timestamptz,
  ADD COLUMN IF NOT EXISTS letter_draft_html  text,
  ADD COLUMN IF NOT EXISTS draft_letter_document_id uuid REFERENCES documents(id) ON DELETE SET NULL;

COMMENT ON COLUMN inquiry_removal_cases.first_delivery_at IS
  'Whichever delivery landed first (Lob delivered or Experian portal upload). Starts the call clock.';
COMMENT ON COLUMN inquiry_removal_cases.first_delivery_channel IS
  'portal | mail — which channel set first_delivery_at; selects wait days from ai_bureau_config.';
COMMENT ON COLUMN inquiry_removal_cases.call_due_at IS
  'first_delivery_at + configured business-day wait for that bureau/channel, hour-preserved. No statutory window.';
COMMENT ON COLUMN inquiry_removal_cases.gate_override_by IS
  'Owner-only override that clears this bureau for lender matching. Never silent.';

-- Per-bureau / per-channel delivery→call wait (owner-tunable; not hardcoded).
ALTER TABLE ai_bureau_config
  ADD COLUMN IF NOT EXISTS portal_wait_business_days integer NOT NULL DEFAULT 1
    CHECK (portal_wait_business_days >= 0),
  ADD COLUMN IF NOT EXISTS mail_wait_business_days integer NOT NULL DEFAULT 3
    CHECK (mail_wait_business_days >= 0),
  ADD COLUMN IF NOT EXISTS mail_service_level text NOT NULL DEFAULT 'priority_express'
    CHECK (mail_service_level IN ('priority', 'priority_express'));

COMMENT ON COLUMN ai_bureau_config.portal_wait_business_days IS
  'Business days after portal delivery before AI call. Default 1; tune per bureau.';
COMMENT ON COLUMN ai_bureau_config.mail_wait_business_days IS
  'Business days after mailed-letter delivery before AI call. Default 3 (placeholder).';
COMMENT ON COLUMN ai_bureau_config.mail_service_level IS
  'Lob service level for mailed dispute letters: priority | priority_express. Default priority_express.';

-- Ensure the three bureau rows exist per org that has inquiry_removal (empty
-- config shell — no phone numbers invented). ON CONFLICT keeps owner edits.
INSERT INTO ai_bureau_config (
  org_id, bureau_code, bureau_name,
  portal_wait_business_days, mail_wait_business_days, mail_service_level
)
SELECT p.org_id, v.code, v.name, 1, 3, 'priority_express'
  FROM pipelines p
  JOIN (VALUES
    ('EX', 'Experian'),
    ('EQ', 'Equifax'),
    ('TU', 'TransUnion')
  ) AS v(code, name) ON true
 WHERE p.key = 'inquiry_removal'
ON CONFLICT (org_id, bureau_code) DO UPDATE
  SET portal_wait_business_days = COALESCE(ai_bureau_config.portal_wait_business_days, 1),
      mail_wait_business_days = COALESCE(ai_bureau_config.mail_wait_business_days, 3),
      mail_service_level = COALESCE(ai_bureau_config.mail_service_level, 'priority_express'),
      updated_at = now();

-- Renumber existing inquiry_removal stages, then insert the two new ones.
-- Target order:
--   0 requested
--   1 specialist_assigned
--   2 awaiting_documents   (NEW)
--   3 letters_sent         (NEW)
--   4 calls_in_progress
--   5 removed
--   6 resume_funding
--   7 hold

UPDATE pipeline_stages ps
   SET sort_order = v.ord,
       updated_at = now()
  FROM pipelines p,
       (VALUES
         ('requested', 0),
         ('specialist_assigned', 1),
         ('awaiting_documents', 2),
         ('letters_sent', 3),
         ('calls_in_progress', 4),
         ('removed', 5),
         ('resume_funding', 6),
         ('hold', 7)
       ) AS v(key, ord)
 WHERE p.id = ps.pipeline_id
   AND p.key = 'inquiry_removal'
   AND ps.key = v.key;

INSERT INTO pipeline_stages (org_id, pipeline_id, key, name, sort_order)
SELECT p.org_id, p.id, s.key, s.name, s.ord
  FROM pipelines p
  JOIN (VALUES
    ('awaiting_documents', 'Awaiting Documents', 2),
    ('letters_sent',       'Letters Sent',       3)
  ) AS s(key, name, ord) ON true
 WHERE p.key = 'inquiry_removal'
ON CONFLICT (pipeline_id, key) DO UPDATE
  SET name = EXCLUDED.name,
      sort_order = EXCLUDED.sort_order,
      updated_at = now();

-- Second pass so newly inserted rows and any that missed the first UPDATE
-- land on the final order (calls_in_progress and later shift by +2).
UPDATE pipeline_stages ps
   SET sort_order = v.ord,
       updated_at = now()
  FROM pipelines p,
       (VALUES
         ('requested', 0),
         ('specialist_assigned', 1),
         ('awaiting_documents', 2),
         ('letters_sent', 3),
         ('calls_in_progress', 4),
         ('removed', 5),
         ('resume_funding', 6),
         ('hold', 7)
       ) AS v(key, ord)
 WHERE p.id = ps.pipeline_id
   AND p.key = 'inquiry_removal'
   AND ps.key = v.key;
