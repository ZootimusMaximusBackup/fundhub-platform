-- 245_education_enrollments.sql — where an education enrollment request lands.
--
-- WHY THIS TABLE EXISTS. /education/enroll/ has been a form that saved nothing.
-- Its script set `var WEBHOOK = ''` and only posted when the string started
-- with "http", which an empty string never does; it then ran a bare
-- setTimeout(500) that hid the form and showed a panel reading "You're enrolled
-- in the queue". Nobody was enrolled, nothing was stored, no lead existed and
-- no email went out. Every person who filled that form in was told they had
-- enrolled and was then silently dropped. This table is the missing noun.
--
-- NUMBERED 245, which is this thread's reserved number. 177 belongs to another
-- thread and using it would collide. Never edit an applied migration —
-- db/migrate.mjs keys schema_migrations on '<dir>/<file>' and skips anything
-- already recorded, so an edit is a silent no-op.
--
-- *** NO PRICE COLUMN, ON PURPOSE. ***
-- Price belongs in src/config/offers.mjs, not in a row here. Copying a number
-- into every row would let the page, the config and the stored rows drift
-- apart, and money in this repo is integer cents handled in exactly one place
-- (src/commissions/money.mjs). NOTE: offers.mjs has no entry for either
-- education program today — the closest is FUNDING_MASTERY at 500000 cents,
-- and nothing proves that is the same product. That gap is reported, not
-- guessed at here.
--
-- *** status DEFAULTS TO 'pending_payment' AND MEANS IT. ***
-- A row here is a REQUEST to enroll. It is not a purchase, not a payment and
-- not access to anything. Nothing in this system grants a student portal today.

CREATE TABLE IF NOT EXISTS public.education_enrollments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES orgs(id),
  -- Nullable, and ON DELETE CASCADE to match bookings (203/225): the row holds
  -- this person's own name, email and phone, so when the client record is
  -- purged the enrollment request must go with it rather than survive as an
  -- orphaned copy of the PII that was just removed.
  client_id   uuid REFERENCES clients(id) ON DELETE CASCADE,
  -- 'credit-mastery' | 'capital-strategy' — the two keys /education/ sells.
  -- Validated in src/education/enrollments.mjs; unknown keys are rejected
  -- before the insert rather than stored and puzzled over later.
  program     text NOT NULL,
  full_name   text,
  email       text NOT NULL,
  phone       text,
  sms_consent boolean NOT NULL DEFAULT false,
  status      text NOT NULL DEFAULT 'pending_payment',
  page_url    text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- The only lookup this table has: "what has this address asked for, here?"
-- Case-folded because email case is not identity, matching clients' own
-- lower(email) key.
CREATE INDEX IF NOT EXISTS education_enrollments_org_email_idx
  ON public.education_enrollments (org_id, lower(email));

CREATE INDEX IF NOT EXISTS education_enrollments_client_idx
  ON public.education_enrollments (client_id);

-- Row Level Security, declared explicitly.
--
-- Every other tenant table in this database carries ENABLE + FORCE + one named
-- permissive policy (see 200, 201, 203). A table created with RLS enabled and
-- NO policy is not "locked down", it is broken shut: reads return zero rows and
-- every INSERT fails with 42501, which is exactly how live `bookings` silently
-- rejected inbound bookings. Declaring the policy here keeps a database built
-- from db/ the same shape as live, and keeps src/security/rls-shape.test.mjs
-- (part of `npm run guard:db`) green.
--
-- Permissive — USING (true) WITH CHECK (true) — matching the rest of the
-- database. It restores access; per-org isolation is a separate, owner-level
-- decision and is deliberately not bundled here.
ALTER TABLE public.education_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.education_enrollments FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'education_enrollments'
       AND policyname = 'education_enrollments_app_all'
  ) THEN
    CREATE POLICY education_enrollments_app_all ON public.education_enrollments
      USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Table privileges for the unprivileged app role (db/migrations/104_app_role.sql).
-- Guarded, because a scratch or CI database may not have the role at all.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.education_enrollments TO fundhub_app;
  ELSE
    RAISE NOTICE 'skipped grants: role fundhub_app does not exist in this database';
  END IF;
END $$;
