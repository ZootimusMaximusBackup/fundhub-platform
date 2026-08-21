-- 250_repair_programs.sql — one repair money/program row per client.
--
-- COMPLIANCE REVIEW REQUIRED — trial ($200) and full program pricing live here.
-- Specialist desk must NOT read amount_paid / price_total (owner §2.11).
--
-- Upsert path: trial → full is UPDATE on the same row. One row per client, ever.
-- Numbered 250 because 249_staff_profile_fields.sql already exists.

CREATE TABLE IF NOT EXISTS public.repair_programs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),
  client_id     uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  program       text NOT NULL CHECK (program IN ('trial', 'full')),
  rounds_cap    int  NOT NULL,
  price_total   numeric(10,2) NOT NULL,
  amount_paid   numeric(10,2) NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'complete', 'upsell_pending', 'cancelled')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, client_id)
);

CREATE INDEX IF NOT EXISTS repair_programs_org_status_idx
  ON public.repair_programs (org_id, status);

ALTER TABLE public.repair_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repair_programs FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'repair_programs'
       AND policyname = 'repair_programs_app_all'
  ) THEN
    CREATE POLICY repair_programs_app_all ON public.repair_programs
      USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.repair_programs TO fundhub_app;
  ELSE
    RAISE NOTICE 'skipped grants: role fundhub_app does not exist in this database';
  END IF;
END $$;
