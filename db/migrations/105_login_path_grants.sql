-- 105_login_path_grants.sql — idempotent proof that fundhub_app can read and
-- write everything the login page depends on.
--
-- WHY THIS EXISTS WHEN 104 ALREADY GRANTS "ALL TABLES". 104_app_role.sql grants
-- SELECT/INSERT/UPDATE/DELETE on every table in schema public, which by its own
-- text already covers everything below. This file exists anyway because 104
-- was renamed from 090_app_role.sql partway through this rollout
-- (docs/workflows/pr-61-merge.md), which changes its schema_migrations key —
-- production only re-runs a migration whose key it has not recorded, and there
-- is no confirmation anywhere in this repo that db/migrate.mjs was run again
-- after that rename landed. So "the blanket grant is fine" is reasoned from the
-- file's own text, not proven against the database people are actually hitting
-- a "Wrong email or password" wall on.
--
-- Rather than assert that and move on, this narrows the same grant to exactly
-- the tables a login touches and VERIFIES the result — same shape as 104's own
-- section E: a permission fix that cannot report success while the permission
-- is still missing.
--
-- SAFE TO RUN ANY NUMBER OF TIMES. GRANT is idempotent — granting a privilege a
-- role already holds is a no-op, not an error, not a warning.

-- ---------------------------------------------------------------------------
-- A. Every table src/auth/login.mjs, src/auth/session.mjs,
--    src/auth/account-session.mjs and src/auth/invite.mjs touch to sign
--    somebody in, rate-limit them, or reset a password. Traced from the
--    source, not assumed:
--
--   orgs             resolveDefaultOrg() — SELECT
--   auth_attempts    checkRateLimit(), recordAttempt() — SELECT, INSERT
--   staff            the credential lookup, last_login_at, password_hash —
--                    SELECT, UPDATE
--   sessions         createSession(), verifySession() — INSERT, UPDATE, SELECT
--   accounts         loginAccount(), last_login_at — SELECT, UPDATE
--   account_sessions createAccountSession(), verifyAccountSession() — INSERT,
--                    UPDATE, SELECT
--   password_resets  requestPasswordReset(), resetPassword() — SELECT,
--                    INSERT, UPDATE
--
-- No sequence among them: every one of these tables defaults its id through
-- gen_random_uuid(), not a serial column — there is nothing to GRANT USAGE on
-- here, unlike the sequence grant 104 carries for tables elsewhere that do.
-- All seven are created in db/schema/001_init.sql, db/schema/020_auth.sql or
-- db/migrations/044_accounts.sql, every one of which runs before this file in
-- migrate.mjs's filename order — so on any database built by this repo's own
-- pipeline, all seven already exist by the time this statement runs.

GRANT SELECT, INSERT, UPDATE, DELETE
  ON orgs, auth_attempts, staff, sessions, accounts, account_sessions, password_resets
  TO fundhub_app;

-- ---------------------------------------------------------------------------
-- B. Prove it, or say by name what is still missing.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  tbl text;
  missing text[] := '{}';
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'orgs','auth_attempts','staff','sessions','accounts','account_sessions','password_resets'
  ]
  LOOP
    IF NOT has_table_privilege('fundhub_app', tbl, 'SELECT') THEN
      missing := array_append(missing, tbl || ':SELECT');
    END IF;
    IF NOT has_table_privilege('fundhub_app', tbl, 'INSERT') THEN
      missing := array_append(missing, tbl || ':INSERT');
    END IF;
    IF NOT has_table_privilege('fundhub_app', tbl, 'UPDATE') THEN
      missing := array_append(missing, tbl || ':UPDATE');
    END IF;
  END LOOP;

  IF array_length(missing, 1) > 0 THEN
    RAISE EXCEPTION
      'fundhub_app is still missing: %. The login path cannot work until these are granted — rolling back so this does not silently report success.',
      array_to_string(missing, ', ');
  END IF;

  RAISE NOTICE 'fundhub_app verified: SELECT/INSERT/UPDATE confirmed on orgs, auth_attempts, staff, sessions, accounts, account_sessions, password_resets — the login path is NOT a grants problem.';
END $$;
