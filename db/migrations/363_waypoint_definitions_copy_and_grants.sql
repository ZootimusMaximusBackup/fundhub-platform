-- 363_waypoint_definitions_copy_and_grants.sql — supersede two things an
-- earlier version of 361 and 362 got wrong, for any database that already
-- applied them.
--
-- WHY THIS FILE EXISTS AT ALL. 361 and 362 have never run against production —
-- they are new on this branch — so both were corrected in place. But migrate.mjs
-- keys schema_migrations on <dir>/<file>, so a CHANGED FILE NEVER RE-RUNS: any
-- database that already applied the earlier 361 and 362 (a scratch database, a
-- peer's checkout, CI on a stale cache) still carries the old policy, the old
-- grants and the old copy, and the edits above would be a silent no-op there.
-- This file is what reaches those. On a fresh database it re-asserts what 361
-- and 362 already did and changes nothing.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- PART ONE — THE POLICY AND THE GRANTS (the deploy risk)
--
-- The earlier 361 installed FORCE ROW LEVEL SECURITY plus a SELECT-ONLY policy.
-- FORCE subjects the table owner to its own policies, so on that shape every
-- write to waypoint_definitions fails for any role that is not a superuser and
-- does not hold BYPASSRLS. Measured on a scratch Postgres as a plain role:
--
--   INSERT -> ERROR: new row violates row-level security policy
--   UPDATE -> UPDATE 0, and NO ERROR
--   DELETE -> DELETE 0, and NO ERROR
--
-- 362 inserts six rows into this table as the migration role. If the production
-- migration role is not a superuser, that INSERT raises and the whole migration
-- run fails — a broken deploy, not a broken feature. And the promise that the
-- checklist is edited with an UPDATE instead of a code change is false, silently.
--
-- The fix is the shape 330 already uses in production: one permissive policy
-- FOR ALL, with the application's read-only-ness carried by GRANTS instead.
--
-- THE REVOKE IS THE LOAD-BEARING HALF. 104_app_role.sql runs
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public
--     GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fundhub_app;
-- so fundhub_app was handed INSERT, UPDATE and DELETE on this table the moment
-- 361 created it, and the earlier claim that "the application holds SELECT on
-- that table and nothing else" was not true: the writes were stopped by row-level
-- security, not by the grant. After this file it IS true, and an attempted write
-- raises permission denied rather than reporting success and changing nothing.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- PART TWO — THE COPY (the compliance defect)
--
-- The earlier 362 seeded the personal-loan step with the detail
--
--   "You qualify today, before any of the optimization work lands."
--
-- A reviewer ran the real enrolment for a client with ZERO rows in crs_results —
-- nobody had pulled their credit — and that sentence was stored on their
-- checklist and returned to their portal. We did not know that client qualified
-- for anything. Two other steps carried the same class of claim: the paydown
-- detail called itself "the single biggest lever on your score", and the
-- do-not-open-credit step named "the pre-approval you are building toward".
--
-- Every title and detail below describes the ACTION the client takes and never
-- the RESULT they will get. src/waypoints/seed.pg.test.mjs fails if qualify,
-- approved, guaranteed, boost, points, score or a dollar amount reaches any
-- seeded title or detail.
--
-- CONDITIONAL ON PURPOSE: each UPDATE fires only where the text is still exactly
-- what the earlier 362 wrote. A row somebody has since edited by hand is left
-- alone — 361's whole argument is that this table is edited with SQL, and a
-- blanket UPDATE here would stamp on that.
--
-- SAFETY. No DDL beyond one policy swap. Touches at most six rows in one table,
-- deletes nothing, and re-running it changes nothing.

-- ---------------------------------------------------------------------------
-- PART ONE
-- ---------------------------------------------------------------------------
ALTER TABLE public.waypoint_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waypoint_definitions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS waypoint_definitions_app_read ON public.waypoint_definitions;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'waypoint_definitions'
       AND policyname = 'waypoint_definitions_all'
  ) THEN
    CREATE POLICY waypoint_definitions_all ON public.waypoint_definitions
      USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.waypoint_definitions FROM fundhub_app;
    GRANT SELECT ON public.waypoint_definitions TO fundhub_app;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- PART TWO
-- ---------------------------------------------------------------------------

UPDATE public.waypoint_definitions
   SET detail = 'You do not have to do it in one payment. Anything you put against this card moves the balance toward the target.'
 WHERE key = 'paydown_revolving_account'
   AND detail = 'This is the single biggest lever on your score. You do not have to do it all at once — every payment that lands moves the number.';

UPDATE public.waypoint_definitions
   SET title  = 'Do not open new credit while we work on your file',
       detail = 'A new card adds a hard inquiry and lowers the average age of your accounts. Talk to your advisor before you apply for anything.'
 WHERE key = 'no_new_credit'
   AND title = 'Do not open new credit until your funding is secured'
   AND detail = 'A new card lowers your average account age and adds a hard inquiry, and both of those work against the pre-approval you are building toward. Get the funding first.';

UPDATE public.waypoint_definitions
   SET title  = 'Talk to your advisor about a personal loan',
       detail = 'Raise it early, before any of the optimization work changes your accounts. Your advisor will walk you through whether it fits your plan.'
 WHERE key = 'personal_loan'
   AND title = 'Secure your personal loan now'
   AND detail = 'You qualify today, before any of the optimization work lands. Take it first — anything you open after this point costs you more than it gives you.';

UPDATE public.waypoint_definitions
   SET detail = 'File online with the Secretary of State{state_clause}. Send us the filing confirmation once you have it.'
 WHERE key = 'form_llc'
   AND detail = 'File online with the Secretary of State{state_clause}. Once it is filed the clock starts, and lenders count how old the entity is.';

UPDATE public.waypoint_definitions
   SET detail = 'You can apply for one on IRS.gov at no cost. Your business bank account will ask for it.'
 WHERE key = 'get_ein'
   AND detail = 'It is free at IRS.gov and it takes about ten minutes. Your business bank account will ask for it.';

UPDATE public.waypoint_definitions
   SET detail = 'Open it in the LLC name, using the EIN. Take your filing paperwork and your EIN letter with you.'
 WHERE key = 'business_checking'
   AND detail = 'Under the LLC name, using the EIN. Even a hundred dollars in it is enough to start.';
