-- 104_app_role.sql — a dedicated, unprivileged role for the application to
-- connect as, replacing the superuser currently carried in DATABASE_URL.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY THIS FILE EXISTS, AND IT IS NOT THE OBVIOUS REASON
--
-- The obvious reason is blast radius: the app runs one pooled connection
-- (src/db.mjs) and today that connection can drop every table, read every
-- other database on the instance, and create roles. Any injection or handler
-- bug inherits all of it. True, and worth fixing on its own.
--
-- The real reason is that ROW LEVEL SECURITY IN THIS CODEBASE HAS NEVER BEEN
-- ENFORCED. 045_creative_factory.sql installs ENABLE + FORCE ROW LEVEL
-- SECURITY and a partner-isolation policy across nineteen tables (045, 046,
-- 047, 049, 050). src/partners/rls.mjs opens each transaction, stamps
-- fundhub.partner_id onto it, and the policies read it back. 045's own header
-- explains why FORCE was chosen:
--
--   "The app connects as one pooled role (src/db.mjs) which in most
--    deployments owns these tables, and a table owner is exempt from its own
--    RLS unless FORCE is set. Without FORCE this migration would look
--    protected and enforce nothing."
--
-- That reasoning is correct and it closes the OWNER hole. It does not close
-- the SUPERUSER hole, and nothing can: a superuser — and any role carrying
-- rolbypassrls — bypasses every policy on every table regardless of FORCE.
-- There is no policy, no FORCE, no GRANT that constrains a superuser.
--
-- So while DATABASE_URL holds a superuser, the second lock described at the
-- top of src/partners/rls.mjs — the one meant to catch "a raw db.query()
-- written in a hurry eight months from now, and one written correctly against
-- the wrong partner id" — is open. Cross-partner disclosure is named in that
-- file as the worst bug the module can produce, and the engine-level guard
-- against it is currently inert.
--
-- Swapping the connection role is what switches that code on. Everything else
-- in this file is ordinary least-privilege hygiene; NOBYPASSRLS is the line
-- that matters.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT THE APPLICATION ACTUALLY NEEDS
--
-- Established by reading the tree, not by assuming. Across src/, api/ and
-- netlify/, excluding *.test.mjs, there is:
--
--   * no DDL at all — no CREATE TABLE, ALTER TABLE, DROP, TRUNCATE
--   * no COPY, no LISTEN/NOTIFY, no SET ROLE, no CREATE EXTENSION
--   * set_config('fundhub.actor'|'fundhub.partner_id', …, true) in
--     src/partners/rls.mjs — transaction-local GUCs, which any role may set
--   * plain SELECT / INSERT / UPDATE / DELETE, and sequence use behind the
--     gen_random_uuid() and serial defaults
--
-- Hence the grant list below and nothing beyond it.
--
-- The DDL that DOES exist lives in test files: roughly fourteen suites run
-- ALTER TABLE … DISABLE TRIGGER to exercise the archive-only guards. That
-- requires table ownership, so the TEST connection must stay an owner-level
-- one. It is a developer fixture, not the app's runtime identity, and the two
-- are separated by this migration rather than conflated. See
-- docs/runbooks/postgres-least-privilege.md.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT IS DELIBERATELY NOT GRANTED
--
-- TRUNCATE. This one is load-bearing, not tidiness. This schema enforces
-- archive-only on at least seven tables through *_no_delete triggers
-- (016_ledger_no_delete, 032_entitlements, 042_partners, 045's
-- fundhub_no_delete, and others). TRUNCATE does not fire row triggers. A role
-- holding TRUNCATE can therefore empty an append-only ledger without tripping
-- a single guard the schema installs. Withholding it is what keeps those
-- invariants true against the app's own connection.
--
-- CREATE on schema public. The app creates no objects. Withholding it also
-- means a compromised app connection cannot plant a function or a table that
-- a later privileged session might touch.
--
-- REFERENCES and TRIGGER. Both are schema-shaping rights with no runtime call
-- site in this tree.
--
-- LOGIN and a password. The role is created NOLOGIN. A human runs one ALTER
-- ROLE by hand to set the password and enable login, so no credential is ever
-- committed to this repository. The runbook is the procedure.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- RE-RUN SAFETY, AND THE ONE WAY THIS FILE COULD HAVE LOCKED YOU OUT
--
-- migrate.mjs keys schema_migrations on '<dir>/<file>', so this runs once in
-- the normal course. It is still written to be safe run twice, because a
-- role-and-grant file is exactly the kind a human re-runs by hand against a
-- second database.
--
-- The trap avoided: on the already-exists branch this file re-asserts the NO*
-- attributes but does NOT touch LOGIN or PASSWORD. An ALTER ROLE that reset
-- those would, on a re-run, revoke login from the role the live site is
-- connected as. ALTER ROLE only changes the attributes it names, and the
-- names here are chosen accordingly.


-- ---------------------------------------------------------------------------
-- A. The role
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    -- NOLOGIN: the password is set out-of-band by a human. See the runbook.
    CREATE ROLE fundhub_app
      NOLOGIN
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOBYPASSRLS
      NOREPLICATION
      -- NOINHERIT: if anyone ever adds this role to a privileged group, the
      -- privileges do not arrive silently — an explicit SET ROLE is required.
      -- The membership checks in section E use MEMBER rather than USAGE mode
      -- precisely so they still catch that case.
      NOINHERIT;
    RAISE NOTICE 'created role fundhub_app (NOLOGIN — set a password before use)';
  ELSE
    -- Re-assert the attributes that matter. LOGIN and PASSWORD are untouched
    -- on purpose; see the header. This branch is what makes the file useful as
    -- a repair: if someone ever grants fundhub_app BYPASSRLS by hand, running
    -- this migration against that database takes it back.
    ALTER ROLE fundhub_app
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOBYPASSRLS
      NOREPLICATION;
    RAISE NOTICE 'role fundhub_app already existed — re-asserted NOSUPERUSER/NOBYPASSRLS/etc';
  END IF;
END $$;

-- COMMENT ON ROLE needs superuser or CREATEROLE. The admin connection running
-- migrations has it, but this is documentation and must never be the reason a
-- security migration rolls back, so it is allowed to fail on its own.
DO $$
BEGIN
  COMMENT ON ROLE fundhub_app IS
    'Runtime connection identity for the application (DATABASE_URL). Unprivileged by design: NOSUPERUSER and NOBYPASSRLS are what make the partner-isolation policies in 045/046/047/049/050 actually enforce. Holds no TRUNCATE, so the *_no_delete triggers cannot be sidestepped. Never use for migrations — those run as the owner via MIGRATION_DATABASE_URL. Installed by db/migrations/104_app_role.sql.';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'skipped COMMENT ON ROLE fundhub_app (insufficient privilege) — cosmetic only';
END $$;


-- ---------------------------------------------------------------------------
-- B. Connect, and the schema
-- ---------------------------------------------------------------------------
--
-- GRANT CONNECT names the database, and GRANT takes an identifier rather than
-- an expression, so current_database() has to go through format(). Written
-- this way so the file is portable to a staging database without an edit.

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO fundhub_app', current_database());
END $$;

GRANT USAGE ON SCHEMA public TO fundhub_app;

-- On Postgres 14 and older, PUBLIC holds CREATE on schema public, and every
-- role inherits it — including this one, which would quietly undo the
-- "withhold CREATE" decision above. Postgres 15 revoked it by default, so on a
-- modern instance this is a no-op. Kept because it is the difference between
-- assuming the default and asserting it.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;


-- ---------------------------------------------------------------------------
-- C. Data rights on what exists today
-- ---------------------------------------------------------------------------
--
-- Note what is absent from this list: TRUNCATE, REFERENCES, TRIGGER. See the
-- header for why TRUNCATE in particular is not an oversight.
--
-- ALL TABLES covers views as well as tables, which is what the read paths in
-- src/http/ need (v_cashflow_config_gaps and friends). It does not cover
-- materialized views; this schema has none, and if one is ever added it needs
-- its own GRANT here or a superseding migration.

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fundhub_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO fundhub_app;

-- The RLS helpers the policies call on every scoped query. PUBLIC already
-- holds EXECUTE on functions by default, so these are belt-and-braces: they
-- keep the partner path working if that default is ever tightened, and they
-- document which two functions the isolation model depends on.
-- Guarded on existence rather than assumed: migrate.mjs applies in filename
-- order so 045 has always run by the time this file does, but this migration
-- is also the one most likely to be run by hand against a fresh or partially
-- built database, and a missing function must not roll back the role.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fundhub_current_partner') THEN
    GRANT EXECUTE ON FUNCTION fundhub_current_partner() TO fundhub_app;
  ELSE
    RAISE NOTICE 'fundhub_current_partner() not present — skipping grant (045 not applied?)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fundhub_is_staff') THEN
    GRANT EXECUTE ON FUNCTION fundhub_is_staff() TO fundhub_app;
  ELSE
    RAISE NOTICE 'fundhub_is_staff() not present — skipping grant (045 not applied?)';
  END IF;
END $$;


-- ---------------------------------------------------------------------------
-- D. Data rights on what does not exist yet
-- ---------------------------------------------------------------------------
--
-- Without this, migration 091 creates a table the app cannot read, and the
-- failure surfaces as a permission error in production some time after the
-- migration ran clean. ALTER DEFAULT PRIVILEGES attaches to the role that
-- creates the object, and future tables will be created by whoever runs
-- migrate.mjs — that is current_user here, i.e. the owner/admin role. Running
-- this migration as the admin connection is therefore not incidental, it is
-- what makes this section correct.
--
-- If a second admin role ever runs migrations, this needs repeating FOR that
-- role. That is the one maintenance obligation this file carries.

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fundhub_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO fundhub_app;


-- ---------------------------------------------------------------------------
-- E. Prove it, or roll the whole thing back
-- ---------------------------------------------------------------------------
--
-- migrate.mjs wraps each file in a transaction, so a RAISE here undoes
-- everything above and records nothing in schema_migrations. A migration whose
-- entire purpose is removing privilege should not be able to report success
-- while leaving privilege in place — that is the failure mode that would send
-- someone to the runbook's final step believing they were protected.
--
-- Checked through role MEMBERSHIP, not just fundhub_app's own catalog flags: a
-- role that is a member of a superuser role is a superuser in effect, and the
-- flag on its own row would still read false.
--
-- MEMBER mode, not USAGE. USAGE asks "are these privileges active right now",
-- which is false for a NOINHERIT role holding a membership it has not SET ROLE
-- into — so a USAGE check would report clean on exactly the role this file
-- creates while a SET ROLE away from superuser. MEMBER asks "can it reach
-- them at all", which is the question a security check has to ask. A role is
-- always a MEMBER of itself, so its own flags are still covered.

DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(flag, ', ') INTO bad
  FROM (
    SELECT 'SUPERUSER' AS flag
     WHERE EXISTS (SELECT 1 FROM pg_roles r
                    WHERE pg_has_role('fundhub_app', r.oid, 'MEMBER') AND r.rolsuper)
    UNION ALL
    SELECT 'BYPASSRLS'
     WHERE EXISTS (SELECT 1 FROM pg_roles r
                    WHERE pg_has_role('fundhub_app', r.oid, 'MEMBER') AND r.rolbypassrls)
    UNION ALL
    SELECT 'CREATEROLE'
     WHERE EXISTS (SELECT 1 FROM pg_roles r
                    WHERE pg_has_role('fundhub_app', r.oid, 'MEMBER') AND r.rolcreaterole)
    UNION ALL
    SELECT 'CREATEDB'
     WHERE EXISTS (SELECT 1 FROM pg_roles r
                    WHERE pg_has_role('fundhub_app', r.oid, 'MEMBER') AND r.rolcreatedb)
    UNION ALL
    SELECT 'REPLICATION'
     WHERE EXISTS (SELECT 1 FROM pg_roles r
                    WHERE pg_has_role('fundhub_app', r.oid, 'MEMBER') AND r.rolreplication)
  ) s;

  IF bad IS NOT NULL THEN
    RAISE EXCEPTION
      'fundhub_app still holds: %. Almost certainly granted through membership in another role. Rolling back — the app must not be pointed at this role until it is clean.', bad;
  END IF;

  IF has_schema_privilege('fundhub_app', 'public', 'CREATE') THEN
    RAISE EXCEPTION
      'fundhub_app can still CREATE in schema public. Something re-granted it, or it is a member of a role that owns the schema. Rolling back.';
  END IF;

  RAISE NOTICE 'fundhub_app verified: no superuser, no bypassrls, no createrole, no createdb, no replication, no schema create';
END $$;
