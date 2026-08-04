-- t138_lenders.sql — Lender database (Airtable port).
--
-- TEMPORARY PREFIX. Other sessions are landing migrations in parallel; final
-- numbering is decided at merge. Sort order places this after 137_* and before
-- any later numbered file once renumbered.
--
-- Source: fundhub-docs sources/ghl-crm-source-of-truth.md
--   ONLINEBIZCC / INBRANCHBIZCC / BIZLOC_STATED / BIZLOC_DOCUMENTED /
--   PERSONALCC / PERSONALLOANS / PERSONALLOC  (~8545–8899)
--   APPLICATIONS lender_table single-select (~8958–8973)
--   LENDER_BUREAU_OBSERVATIONS (~9832–9835)
--
-- ONE table + lender_table discriminator (APPLICATIONS references those names).
-- Product-only columns are nullable. Tables ship EMPTY — CSV import is the
-- load path. Do not invent lender names or bureau assignments.

-- Exact Airtable APPLICATIONS.lender_table single-select values.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lender_table') THEN
    CREATE TYPE lender_table AS ENUM (
      'OnlineBizCC',
      'InBranchBizCC',
      'BizLOC_Stated',
      'BizLOC_Documented',
      'PersonalCC',
      'PersonalLoans',
      'PersonalLOC'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'application_status') THEN
    CREATE TYPE application_status AS ENUM (
      'Apply',
      'Applied',
      'Approved',
      'Denied',
      'Missing Docs',
      'Action Required'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lender_observation_review_status') THEN
    CREATE TYPE lender_observation_review_status AS ENUM (
      'pending',
      'confirmed',
      'dismissed',
      'corrected'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS lenders (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                      uuid NOT NULL REFERENCES orgs(id),
  lender_table                lender_table NOT NULL,
  -- Shared / primary
  name                        text NOT NULL,          -- Airtable "Bank / Issuer Name"
  product_name                text,                   -- optional product label
  application_url             text,
  lender_row_url              text,                   -- Airtable record URL when imported
  eligible_states             text,
  bureaus_pulled              text,
  business_bureau_pulled      text,
  double_pull                 text,
  multiple_llc_allowed        text,
  stated_requirements         text,
  docs_requested              text,
  application_method          text,
  approval_speed              text,
  typical_approval_range      numeric(14,2),
  average_starting_loc        numeric(14,2),
  max_known_loc               numeric(14,2),
  apr_terms                   text,
  repayment_terms             text,
  draw_period_renewal         text,
  relationship_required       text,
  deposit_balance_impact      text,
  known_friendly_states       text,
  insider_tips                text,
  priority_tier               smallint CHECK (priority_tier IS NULL OR priority_tier IN (1, 2, 3)),
  last_updated_by             text,
  last_updated_date           date,
  notes                       text,
  -- Soft status for CRM filters (Airtable lender tables have no status field)
  active                      boolean NOT NULL DEFAULT true,
  -- Product-specific (nullable across tables)
  branch_location_info        text,
  prequal_soft_pull           text,
  intro_offers                text,
  requires_account_opening    text,
  minimum_deposit             numeric(14,2),
  underwriter_interaction     text,
  relationship_manager        text,
  documentation_required      text,
  minimum_time_in_business_years numeric(6,2),
  minimum_revenue_threshold   numeric(14,2),
  collateral_required         text,
  renewal_terms               text,
  loan_type                   text,
  apr_range_pct               numeric(8,4),
  repayment_terms_months      integer,
  funding_speed               text,
  loc_type                    text,
  -- Airtable row id when imported (for observation linkage)
  external_row_id             text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lenders_org_table_idx
  ON lenders (org_id, lender_table);
CREATE INDEX IF NOT EXISTS lenders_org_active_tier_idx
  ON lenders (org_id, active, priority_tier);
CREATE INDEX IF NOT EXISTS lenders_org_name_idx
  ON lenders (org_id, lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS lenders_org_external_uniq
  ON lenders (org_id, external_row_id)
  WHERE external_row_id IS NOT NULL;

DROP TRIGGER IF EXISTS lenders_set_updated_at ON lenders;
CREATE TRIGGER lenders_set_updated_at
  BEFORE UPDATE ON lenders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE lenders IS
  'Port of seven Airtable lender product tables. Discriminator lender_table matches APPLICATIONS single-select. Empty until CSV import.';

-- Expand existing applications (schema/001) to the Airtable APPLICATIONS shape.
ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS client_id           uuid REFERENCES clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lender_id           uuid REFERENCES lenders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lender_name         text,
  ADD COLUMN IF NOT EXISTS product_name        text,
  ADD COLUMN IF NOT EXISTS application_url     text,
  ADD COLUMN IF NOT EXISTS lender_row_url      text,
  ADD COLUMN IF NOT EXISTS lender_table        lender_table,
  ADD COLUMN IF NOT EXISTS requested_amount    numeric(14,2),
  ADD COLUMN IF NOT EXISTS submitted_date      date,
  ADD COLUMN IF NOT EXISTS status_updated_date timestamptz,
  ADD COLUMN IF NOT EXISTS condition_text      text;

-- Backfill lender_name from legacy bank column where empty.
UPDATE applications
   SET lender_name = bank
 WHERE lender_name IS NULL AND bank IS NOT NULL;

CREATE INDEX IF NOT EXISTS applications_client_idx
  ON applications (client_id);
CREATE INDEX IF NOT EXISTS applications_lender_idx
  ON applications (lender_id);
CREATE INDEX IF NOT EXISTS applications_org_status_idx
  ON applications (org_id, status);

-- Constrain status to Airtable options when set (NULL still allowed for legacy).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'applications_status_ck'
  ) THEN
    ALTER TABLE applications
      ADD CONSTRAINT applications_status_ck
      CHECK (
        status IS NULL OR status IN (
          'Apply', 'Applied', 'Approved', 'Denied',
          'Missing Docs', 'Action Required'
        )
      );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS lender_bureau_observations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES orgs(id),
  application_id        uuid REFERENCES applications(id) ON DELETE SET NULL,
  client_id             uuid REFERENCES clients(id) ON DELETE SET NULL,
  funding_round_id      uuid REFERENCES funding_rounds(id) ON DELETE SET NULL,
  lender_name           text,
  lender_table          lender_table,
  lender_row_id         uuid REFERENCES lenders(id) ON DELETE SET NULL,
  expected_bureaus_raw  text,
  observed_bureau       text,
  observation_source    text,
  mismatch_flag         boolean NOT NULL DEFAULT false,
  review_status         lender_observation_review_status NOT NULL DEFAULT 'pending',
  notes                 text,
  created_by            text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lender_bureau_obs_org_review_idx
  ON lender_bureau_observations (org_id, review_status, mismatch_flag);
CREATE INDEX IF NOT EXISTS lender_bureau_obs_client_idx
  ON lender_bureau_observations (client_id);
CREATE INDEX IF NOT EXISTS lender_bureau_obs_lender_idx
  ON lender_bureau_observations (lender_row_id);

DROP TRIGGER IF EXISTS lender_bureau_obs_set_updated_at ON lender_bureau_observations;
CREATE TRIGGER lender_bureau_obs_set_updated_at
  BEFORE UPDATE ON lender_bureau_observations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE lender_bureau_observations IS
  'Feedback loop: observed bureau pull vs lenders.bureaus_pulled. Mismatches surface on the Lenders review queue.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON lenders TO fundhub_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON lender_bureau_observations TO fundhub_app;
    -- applications already granted via ALL TABLES / defaults; re-assert columns usable.
  ELSE
    RAISE NOTICE 'skipped grants: role fundhub_app does not exist in this database';
  END IF;
END $$;
