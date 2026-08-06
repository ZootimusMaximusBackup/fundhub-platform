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
  'Whichever delivery landed first (PostGrid delivery.confirmed or Experian portal upload). Starts the call clock.';
COMMENT ON COLUMN inquiry_removal_cases.first_delivery_channel IS
  'portal | mail — which channel set first_delivery_at; selects wait days from ai_bureau_config.';
COMMENT ON COLUMN inquiry_removal_cases.call_due_at IS
  'first_delivery_at + configured business-day wait for that bureau/channel, hour-preserved. No statutory window.';
COMMENT ON COLUMN inquiry_removal_cases.letter_provider_id IS
  'PostGrid letter id (or swap). Set on send; delivery webhook matches on this.';
COMMENT ON COLUMN inquiry_removal_cases.gate_override_by IS
  'Owner-only override that clears this bureau for lender matching. Never silent.';

-- Per-bureau wait + USPS mail class + hard-coded dispute P.O. Boxes.
ALTER TABLE ai_bureau_config
  ADD COLUMN IF NOT EXISTS portal_wait_business_days integer NOT NULL DEFAULT 1
    CHECK (portal_wait_business_days >= 0),
  ADD COLUMN IF NOT EXISTS mail_wait_business_days integer NOT NULL DEFAULT 3
    CHECK (mail_wait_business_days >= 0),
  ADD COLUMN IF NOT EXISTS mail_service_level text NOT NULL DEFAULT 'first_class',
  ADD COLUMN IF NOT EXISTS mail_company_name text,
  ADD COLUMN IF NOT EXISTS mail_address_line1 text,
  ADD COLUMN IF NOT EXISTS mail_address_line2 text,
  ADD COLUMN IF NOT EXISTS mail_address_city text,
  ADD COLUMN IF NOT EXISTS mail_address_state text,
  ADD COLUMN IF NOT EXISTS mail_address_zip text,
  ADD COLUMN IF NOT EXISTS mail_address_country text NOT NULL DEFAULT 'US';

-- Widen / replace mail_service_level check for PostGrid USPS classes.
ALTER TABLE ai_bureau_config DROP CONSTRAINT IF EXISTS ai_bureau_config_mail_service_level_check;
ALTER TABLE ai_bureau_config
  ADD CONSTRAINT ai_bureau_config_mail_service_level_check
  CHECK (mail_service_level IN ('first_class', 'priority', 'priority_express'));

-- Migrate any prior Lob defaults.
UPDATE ai_bureau_config
   SET mail_service_level = 'first_class'
 WHERE mail_service_level IS NULL
    OR mail_service_level NOT IN ('first_class', 'priority', 'priority_express');

COMMENT ON COLUMN ai_bureau_config.portal_wait_business_days IS
  'Business days after portal delivery before AI call. Default 1; tune per bureau.';
COMMENT ON COLUMN ai_bureau_config.mail_wait_business_days IS
  'Business days after PostGrid delivery.confirmed before AI call. Default 3 (placeholder).';
COMMENT ON COLUMN ai_bureau_config.mail_service_level IS
  'USPS mail class for dispute letters via PostGrid: first_class | priority | priority_express. Default first_class. Never FedEx/UPS.';

-- Seed EX/EQ/TU with USPS P.O. Box addresses (hardcoded destinations).
INSERT INTO ai_bureau_config (
  org_id, bureau_code, bureau_name,
  portal_wait_business_days, mail_wait_business_days, mail_service_level,
  mail_company_name, mail_address_line1, mail_address_city, mail_address_state, mail_address_zip, mail_address_country
)
SELECT p.org_id, v.code, v.name, 1, 3, 'first_class',
       v.company, v.line1, v.city, v.state, v.zip, 'US'
  FROM pipelines p
  JOIN (VALUES
    ('EX', 'Experian',
     'Experian', 'P.O. Box 4500', 'Allen', 'TX', '75013'),
    ('EQ', 'Equifax',
     'Equifax Information Services LLC', 'P.O. Box 740256', 'Atlanta', 'GA', '30374-0256'),
    ('TU', 'TransUnion',
     'TransUnion LLC Consumer Dispute Center', 'P.O. Box 2000', 'Chester', 'PA', '19016')
  ) AS v(code, name, company, line1, city, state, zip) ON true
 WHERE p.key = 'inquiry_removal'
ON CONFLICT (org_id, bureau_code) DO UPDATE
  SET portal_wait_business_days = COALESCE(ai_bureau_config.portal_wait_business_days, 1),
      mail_wait_business_days = COALESCE(ai_bureau_config.mail_wait_business_days, 3),
      mail_service_level = CASE
        WHEN ai_bureau_config.mail_service_level IN ('first_class', 'priority', 'priority_express')
          THEN ai_bureau_config.mail_service_level
        ELSE 'first_class'
      END,
      mail_company_name = COALESCE(ai_bureau_config.mail_company_name, EXCLUDED.mail_company_name),
      mail_address_line1 = COALESCE(ai_bureau_config.mail_address_line1, EXCLUDED.mail_address_line1),
      mail_address_city = COALESCE(ai_bureau_config.mail_address_city, EXCLUDED.mail_address_city),
      mail_address_state = COALESCE(ai_bureau_config.mail_address_state, EXCLUDED.mail_address_state),
      mail_address_zip = COALESCE(ai_bureau_config.mail_address_zip, EXCLUDED.mail_address_zip),
      mail_address_country = COALESCE(ai_bureau_config.mail_address_country, 'US'),
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
