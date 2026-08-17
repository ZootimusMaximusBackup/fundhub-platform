-- 172_wl_marketing.sql — white-label partner marketing suite (beta).
--
-- Owner switch per partner, token meter + hard cap, copy history, and a
-- post queue that does not require a connected ad account yet.
-- Nothing here bills. creative_billing_rates stay unset.

ALTER TABLE partner_module_settings
  ADD COLUMN IF NOT EXISTS marketing_suite_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE partner_module_settings
  ADD COLUMN IF NOT EXISTS ai_token_cap_monthly integer NOT NULL DEFAULT 250000;

ALTER TABLE partner_module_settings
  DROP CONSTRAINT IF EXISTS partner_module_settings_token_cap_ck;

ALTER TABLE partner_module_settings
  ADD CONSTRAINT partner_module_settings_token_cap_ck
  CHECK (ai_token_cap_monthly >= 0);

COMMENT ON COLUMN partner_module_settings.marketing_suite_enabled IS
  'Owner-only. Default off. When false the partner may save brand tokens but may not generate copy, publish a new page, or queue posts.';
COMMENT ON COLUMN partner_module_settings.ai_token_cap_monthly IS
  'Hard cap on Anthropic input+output tokens for this partner in the current UTC month. Meter only — no invoice.';

-- ---------------------------------------------------------------------------
-- partner_ai_usage — append-only token counts. Never a bill.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS partner_ai_usage (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES orgs(id),
  partner_id     uuid NOT NULL REFERENCES partners(id) ON DELETE RESTRICT,
  purpose        text NOT NULL,
  source_id      uuid,
  input_tokens   integer NOT NULL DEFAULT 0,
  output_tokens  integer NOT NULL DEFAULT 0,
  model          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_ai_usage_purpose_ck
    CHECK (purpose IN ('copy', 'social', 'creative', 'logo')),
  CONSTRAINT partner_ai_usage_tokens_ck
    CHECK (input_tokens >= 0 AND output_tokens >= 0)
);

CREATE INDEX IF NOT EXISTS partner_ai_usage_month_idx
  ON partner_ai_usage (partner_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- partner_page_section_versions — copy history so a partner can go back.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS partner_page_section_versions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id),
  partner_id   uuid NOT NULL REFERENCES partners(id) ON DELETE RESTRICT,
  page_id      uuid NOT NULL REFERENCES partner_pages(id) ON DELETE CASCADE,
  section_id   text NOT NULL,
  section_json jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_page_section_versions_section_ck
    CHECK (btrim(section_id) <> '')
);

CREATE INDEX IF NOT EXISTS partner_page_section_versions_idx
  ON partner_page_section_versions (page_id, section_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- marketing_content_queue — generated posts before a social channel exists.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS marketing_content_queue (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES orgs(id),
  partner_id      uuid NOT NULL REFERENCES partners(id) ON DELETE RESTRICT,
  caption         text NOT NULL,
  offer_type      text NOT NULL DEFAULT 'funding',
  scheduled_for   timestamptz,
  status          text NOT NULL DEFAULT 'draft',
  social_post_id  uuid REFERENCES social_posts(id) ON DELETE SET NULL,
  blocked_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_content_queue_caption_ck CHECK (btrim(caption) <> ''),
  CONSTRAINT marketing_content_queue_offer_ck
    CHECK (offer_type IN ('funding', 'credit_cards', 'credit_repair')),
  CONSTRAINT marketing_content_queue_status_ck
    CHECK (status IN ('draft', 'queued', 'scheduled', 'discarded', 'blocked'))
);

CREATE INDEX IF NOT EXISTS marketing_content_queue_partner_idx
  ON marketing_content_queue (partner_id, status, created_at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'partner_ai_usage',
    'partner_page_section_versions',
    'marketing_content_queue'
  ] LOOP
    PERFORM fundhub_apply_partner_rls(t);
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON partner_ai_usage TO fundhub_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON partner_page_section_versions TO fundhub_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON marketing_content_queue TO fundhub_app;
  ELSE
    RAISE NOTICE 'skipped grants: role fundhub_app does not exist in this database';
  END IF;
END $$;
