-- 155_inquiry_gate.sql — Inquiry Gate v2 schema + pipeline stages.
--
-- Adds delivery/call-clock + owner override columns on inquiry_removal_cases.
-- Inserts awaiting_documents + letters_sent into the existing inquiry_removal
-- pipeline for every org that has it. Does NOT edit db/seed/002_pipelines.sql.

ALTER TABLE inquiry_removal_cases
  ADD COLUMN IF NOT EXISTS first_delivery_at  timestamptz,
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
COMMENT ON COLUMN inquiry_removal_cases.call_due_at IS
  'first_delivery_at + 1 business day, hour-preserved. No statutory 30-day window.';
COMMENT ON COLUMN inquiry_removal_cases.gate_override_by IS
  'Owner-only override that clears this bureau for lender matching. Never silent.';

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
