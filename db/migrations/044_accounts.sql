-- 044_accounts.sql — principals who are not employees.
--
-- THE GAP. Only `staff` can sign in. public/app/shell.js grants tabs to 'client',
-- 'affiliate' and 'partner', but nothing issues them a session, so Client Portal,
-- Affiliate and Partner Galaxy are screens NOBODY can reach. 036_partner_role.sql
-- seeded 'partner' into the staff catalog as a stopgap purely to make Brand
-- Studio openable; this migration is what that stopgap was waiting for.
--
-- A SEPARATE TABLE, not a `kind` column on staff. Staff are employees: they hold
-- internal roles, draw commission through sale_attributions, own tasks, and are
-- invited through src/auth/invite.mjs. A client is none of those things. One
-- table would mean every staff query needs a "…and not actually a customer"
-- filter, and the first one that forgets is a client in the closer queue.
--
-- MIRRORS src/auth/ EXACTLY. Same scrypt hashes (hash.mjs is reused, not
-- reimplemented), same sha256-of-token storage — the raw token is never
-- persisted — the same sliding expiry, and the same auth_attempts table for rate
-- limiting, so a brute force against a client account is throttled by the code
-- that already throttles staff.
--
-- INVITE-ONLY IS ENFORCED HERE, NOT IN THE UI. self_signup is a column with a
-- CHECK, not a form flag: 'client' and 'affiliate' may self-register, 'partner'
-- may not. A partner is a commercial relationship with a revenue share and an
-- agreement; anyone who could self-register as one could read a book of clients.

CREATE TABLE IF NOT EXISTS accounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES orgs(id),

  --   client    — a funding client, sees their own portal only
  --   affiliate — refers clients, sees their own referrals only
  --   partner   — white-label operator, sees their own book only
  kind            text NOT NULL,

  email           text NOT NULL,
  name            text,
  password_hash   text,                    -- NULL until an invite is accepted

  --   invited   — record exists, cannot sign in
  --   active    — can sign in
  --   suspended — cannot sign in, record and history retained
  status          text NOT NULL DEFAULT 'invited',

  -- Exactly one of these is set, and it must match `kind`. This is the link that
  -- makes a session mean something: a partner session with no partner_id can see
  -- nothing, which is what src/partners/scope.mjs already refuses to guess about.
  client_id       uuid REFERENCES clients(id)    ON DELETE CASCADE,
  affiliate_id    uuid REFERENCES affiliates(id) ON DELETE CASCADE,
  partner_id      uuid REFERENCES partners(id)   ON DELETE CASCADE,

  invited_by      uuid REFERENCES staff(id) ON DELETE SET NULL,
  invited_at      timestamptz,
  invite_token_hash text,
  invite_expires_at timestamptz,
  activated_at    timestamptz,
  last_login_at   timestamptz,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT accounts_kind_ck   CHECK (kind IN ('client', 'affiliate', 'partner')),
  CONSTRAINT accounts_status_ck CHECK (status IN ('invited', 'active', 'suspended')),
  CONSTRAINT accounts_email_ck  CHECK (email = lower(btrim(email)) AND email <> ''),

  -- The subject link must match the kind, and there must be exactly one.
  CONSTRAINT accounts_subject_ck CHECK (
    (kind = 'client'    AND client_id IS NOT NULL AND affiliate_id IS NULL AND partner_id IS NULL) OR
    (kind = 'affiliate' AND affiliate_id IS NOT NULL AND client_id IS NULL AND partner_id IS NULL) OR
    (kind = 'partner'   AND partner_id IS NOT NULL AND client_id IS NULL AND affiliate_id IS NULL)
  ),

  -- An active account must be able to authenticate.
  CONSTRAINT accounts_active_needs_hash CHECK (status <> 'active' OR password_hash IS NOT NULL)
);

-- One login per email per org, across all principal kinds: a person cannot be
-- two principals with one address, and a duplicate would make login ambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS accounts_email_uniq ON accounts (org_id, lower(email));
-- One account per subject.
CREATE UNIQUE INDEX IF NOT EXISTS accounts_client_uniq    ON accounts (client_id)    WHERE client_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS accounts_affiliate_uniq ON accounts (affiliate_id) WHERE affiliate_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS accounts_partner_uniq   ON accounts (partner_id)   WHERE partner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS accounts_kind_idx ON accounts (org_id, kind, status);

-- account_sessions — the same shape as `sessions` in 020_auth.sql. token_hash,
-- never the token: a leaked backup yields no usable sessions.
CREATE TABLE IF NOT EXISTS account_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash    text NOT NULL,
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  ip            inet,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS account_sessions_token_uniq ON account_sessions (token_hash);
CREATE INDEX IF NOT EXISTS account_sessions_account_idx ON account_sessions (account_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS account_sessions_live_idx
  ON account_sessions (expires_at) WHERE revoked_at IS NULL;

-- SELF-SIGNUP POLICY, as data. The application asks this table rather than
-- carrying the rule in a branch somebody can forget to write.
CREATE TABLE IF NOT EXISTS account_signup_policy (
  kind          text PRIMARY KEY,
  self_signup   boolean NOT NULL,
  note          text
);

INSERT INTO account_signup_policy (kind, self_signup, note) VALUES
  ('client',    true,  'A funding client registers themselves after purchase.'),
  ('affiliate', true,  'Affiliates self-register to get a tracking id.'),
  ('partner',   false, 'INVITE ONLY. A partner is a commercial relationship with a revenue share and a signed agreement; self-registration would hand someone a book of clients.')
ON CONFLICT (kind) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at')
     AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_accounts_updated_at'
                      AND tgrelid = 'public.accounts'::regclass) THEN
    CREATE TRIGGER trg_accounts_updated_at BEFORE UPDATE ON accounts
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- Belt to the application's braces: a partner account can only be created with
-- an inviter recorded. Enforced in code AND here, per the unit's requirement
-- that invite-only not live in the UI.
CREATE OR REPLACE FUNCTION accounts_invite_only_gate() RETURNS trigger AS $$
DECLARE allowed boolean;
BEGIN
  SELECT self_signup INTO allowed FROM account_signup_policy WHERE kind = NEW.kind;
  IF allowed IS NULL THEN
    RAISE EXCEPTION 'accounts: no signup policy for kind %', NEW.kind;
  END IF;
  IF allowed = false AND NEW.invited_by IS NULL THEN
    RAISE EXCEPTION
      'accounts: % is invite-only — invited_by is required (044_accounts.sql)', NEW.kind;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_accounts_invite_only ON accounts;
CREATE TRIGGER trg_accounts_invite_only
  BEFORE INSERT ON accounts
  FOR EACH ROW EXECUTE FUNCTION accounts_invite_only_gate();
