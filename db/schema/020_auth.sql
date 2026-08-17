-- fundhub-platform — 020_auth.sql — staff authentication.
--
-- Convention per 001_init.sql: org_id, created_at, updated_at on every table;
-- updated_at maintained by the set_updated_at() trigger defined there.
-- 001_init.sql is NOT edited — every change here is additive.
--
-- IDEMPOTENT. Every statement is IF NOT EXISTS or guarded by a catalog lookup,
-- so re-running this file is a no-op rather than an error.
--
-- ON SECRETS: no column in this file ever holds a plaintext password or a live
-- bearer token. Passwords are stored as PHC-encoded scrypt verifier strings
-- (src/auth/hash.mjs). Session, invite and reset tokens are stored as the
-- sha256 hex of a 32-byte random token; the token itself exists in cleartext
-- only in the single response that mints it.
--
-- ON MERGE ORDER: db/migrate.mjs on the b3-import branch applies
-- schema/ -> migrations/ -> seed/, so this file lands BEFORE
-- db/migrations/012_attribution.sql. The staff_roles block below therefore
-- creates 012's table with 012's exact shape, and 012's own
-- CREATE TABLE IF NOT EXISTS + NOT EXISTS-guarded seed no-op on top of it.
-- If 012 ever lands first instead, this block no-ops and 012's definition wins.

-- ---------------------------------------------------------------------------
-- staff: authentication columns.
-- ---------------------------------------------------------------------------
ALTER TABLE staff ADD COLUMN IF NOT EXISTS email         text;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS password_hash text;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS last_login_at timestamptz;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS status        text NOT NULL DEFAULT 'invited';

-- Existing staff rows predate auth and carry no credential, so 'invited' is the
-- honest default: they reach a password through src/auth/invite.mjs. Login
-- requires status='active' AND password_hash IS NOT NULL, so either default is
-- fail-closed; 'invited' is the one that describes reality.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'staff_status_check') THEN
    ALTER TABLE staff ADD CONSTRAINT staff_status_check
      CHECK (status IN ('active','suspended','invited'));
  END IF;
END $$;

-- Unique per org, case-insensitive — mirrors idx_clients_email in 001. Partial
-- so the pre-auth staff rows that still have a NULL email do not collide.
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_email_org
  ON staff (org_id, lower(email)) WHERE email IS NOT NULL;

-- ---------------------------------------------------------------------------
-- staff_roles — the role CATALOG (012_attribution.sql's shape, reproduced
-- exactly). Note this is a catalog of role definitions keyed by (org_id, key);
-- it is NOT a staff->role join table. A staff member's role is staff.role,
-- which references staff_roles.key softly, exactly as sale_attributions.role
-- does in 012. src/http/middleware/requireRole.mjs gates on staff.role and
-- reads this table only to resolve display names, so a differently-shaped
-- staff_roles landing underneath cannot break the gate.
-- ---------------------------------------------------------------------------
-- The entire staff_roles section lives inside one guard. Nothing here — not the
-- table, not the index, not the seed — touches the database unless staff_roles
-- is either absent or already in the (key, name) catalog shape. A staff_roles
-- that exists in some FOREIGN shape is left strictly alone and the rest of this
-- migration still applies; the alternative is an unguarded lower(key) index
-- reference aborting the file and taking the sessions table down with it.
-- EXECUTE defers column resolution to runtime, so an un-taken branch is never
-- parsed against a table whose columns would not resolve.
DO $$
DECLARE has_catalog_shape boolean;
BEGIN
  IF to_regclass('public.staff_roles') IS NULL THEN
    CREATE TABLE staff_roles (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id      uuid NOT NULL REFERENCES orgs(id),
      key         text NOT NULL,   -- stable: owner, admin, closer, funding_advisor, ...
      name        text NOT NULL,   -- editable display label
      description text,
      active      boolean NOT NULL DEFAULT true,
      sort_order  integer NOT NULL DEFAULT 0,
      created_at  timestamptz NOT NULL DEFAULT now(),
      updated_at  timestamptz NOT NULL DEFAULT now()
    );
  END IF;

  SELECT count(*) = 2 INTO has_catalog_shape
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name   = 'staff_roles'
     AND column_name IN ('key','name');

  IF NOT has_catalog_shape THEN
    RAISE NOTICE '020_auth: staff_roles exists in an unexpected shape — catalog seed skipped. requireRole gates on staff.role and is unaffected.';
    RETURN;
  END IF;

  EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS staff_roles_org_key_uniq ON staff_roles (org_id, lower(key))';

  -- Canonical roles. Matches 012's seed list, plus 'owner' (the role that may
  -- issue invites — see src/auth/invite.mjs). Each row is NOT EXISTS-guarded,
  -- so whichever of 020/012 runs first wins and the other is a no-op.
  EXECUTE $seed$
    INSERT INTO staff_roles (org_id, key, name, description, sort_order)
    SELECT o.id, v.key, v.name, v.description, v.sort_order
      FROM orgs o
      CROSS JOIN (VALUES
        ('owner',             'Owner',              'Full control. Issues staff invites.',        5),
        ('closer',            'Closer',             'Closes the sale. Earns front end.',         10),
        ('funding_advisor',   'Funding Advisor',    'Works the file to funding. Earns back end.',20),
        ('inquiry_specialist','Specialist',         'Inquiry removal and credit repair.',        30),
        ('setter',            'Setter',             'Books the call.',                           40),
        ('admin',             'Admin',              'Operations and oversight.',                 50)
      ) AS v(key, name, description, sort_order)
     WHERE o.is_default
       AND NOT EXISTS (
         SELECT 1 FROM staff_roles r
          WHERE r.org_id = o.id AND lower(r.key) = lower(v.key)
       )
  $seed$;

  -- Backfill from staff.role: any role value actually in use that the catalog
  -- does not know about yet gets a row, so the catalog is never a subset of
  -- reality. Also NOT EXISTS-guarded.
  EXECUTE $backfill$
    INSERT INTO staff_roles (org_id, key, name, description, sort_order)
    SELECT DISTINCT s.org_id, lower(btrim(s.role)), initcap(replace(btrim(s.role), '_', ' ')),
           'Backfilled from staff.role by 020_auth.sql.', 100
      FROM staff s
     WHERE s.role IS NOT NULL AND btrim(s.role) <> ''
       AND NOT EXISTS (
         SELECT 1 FROM staff_roles r
          WHERE r.org_id = s.org_id AND lower(r.key) = lower(btrim(s.role))
       )
  $backfill$;
END $$;

-- ---------------------------------------------------------------------------
-- sessions.
--
-- DELIBERATE DEVIATION from the brief's "token": this stores token_hash. The
-- raw token is returned once by login and never persisted, so a leaked backup
-- yields no usable sessions. Lookup is by sha256(token), so it costs nothing.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),
  staff_id      uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  token_hash    text NOT NULL,              -- sha256 hex of a 32-byte random token
  expires_at    timestamptz NOT NULL,       -- slides forward on use; default 7d
  revoked_at    timestamptz,                -- revoke() stamps this; verify() rejects it
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  ip            inet,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_token ON sessions (token_hash);
CREATE INDEX        IF NOT EXISTS idx_sessions_staff ON sessions (staff_id, expires_at DESC);
CREATE INDEX        IF NOT EXISTS idx_sessions_live  ON sessions (expires_at) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- password_resets — also carries invites (kind='invite'). Same mechanism: a
-- one-shot token that lets the holder set their own password. One table rather
-- than two because an invite IS a reset whose subject has no password yet.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS password_resets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES orgs(id),
  staff_id    uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  token_hash  text NOT NULL,              -- sha256 hex, same discipline as sessions
  kind        text NOT NULL DEFAULT 'reset',
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'password_resets_kind_check') THEN
    ALTER TABLE password_resets ADD CONSTRAINT password_resets_kind_check
      CHECK (kind IN ('reset','invite'));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS idx_pwreset_token ON password_resets (token_hash);
CREATE INDEX        IF NOT EXISTS idx_pwreset_staff ON password_resets (staff_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- auth_attempts — not in the brief, added because it is load-bearing.
--
-- "Rate limit by email AND ip" needs durable state: the dashboard runs as
-- serverless functions, so an in-process counter resets on every cold start and
-- enforces nothing. Records the attempt IDENTITY only — never the password,
-- never a hash of it, never the session token.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auth_attempts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES orgs(id),
  email       text,
  ip          inet,
  successful  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_auth_attempts_email ON auth_attempts (org_id, lower(email), created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_attempts_ip    ON auth_attempts (org_id, ip, created_at DESC);

-- ---------------------------------------------------------------------------
-- updated_at triggers (001 convention). DROP + CREATE so re-running is safe.
-- ---------------------------------------------------------------------------
-- Attached only to tables that actually exist AND carry an updated_at column —
-- set_updated_at() assigns NEW.updated_at, so attaching it to a table without
-- that column would create a trigger that errors on every UPDATE.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['staff_roles','sessions','password_resets','auth_attempts']
  LOOP
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = t AND column_name = 'updated_at'
    );
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_updated ON %1$I;', t);
    EXECUTE format(
      'CREATE TRIGGER trg_%1$s_updated BEFORE UPDATE ON %1$I
         FOR EACH ROW EXECUTE FUNCTION set_updated_at();', t);
  END LOOP;
END $$;
