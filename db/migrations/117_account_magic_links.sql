-- 117_account_magic_links.sql — sign-in by emailed link, for the client portal.
--
-- WHAT THIS UNBLOCKS. db/migrations/044_accounts.sql gave non-employees an
-- account and a session, and api/auth/login.mjs signs them in with a password.
-- A funding client does not have a password: nothing in this repo has ever set
-- one for an account row, and there is no self-registration screen that could.
-- So the client portal has a working session mechanism and no way for a client
-- to start one. This table is the missing start: a short-lived, single-use,
-- hashed token that is emailed and exchanged for an account session.
--
-- IT IS A REQUEST LOG FIRST AND A TOKEN STORE SECOND, and that ordering is the
-- security property. Every request writes exactly one row whether or not the
-- address belongs to anybody, because the rate limiter counts ROWS. If unknown
-- addresses wrote nothing, the limiter would only ever throttle real customers
-- and an attacker spraying addresses would be unlimited — and the difference in
-- behaviour between a throttled address and an unthrottled one is itself the
-- account oracle the uniform 200 exists to close.
--
--   token_hash NULL  the address matched no account and no client. The row is a
--                    receipt: it proves the request happened and it feeds the
--                    limiter, and there is no secret in it because none was
--                    minted and nothing was emailed.
--   token_hash SET   a link was minted. sha256(token), never the token, exactly
--                    as sessions and account_sessions store theirs, so a leaked
--                    backup yields no usable links.
--
-- SINGLE USE IS ENFORCED BY consumed_at IN THE UPDATE, NOT BY A READ THEN A
-- WRITE. src/auth/magic-link.mjs claims a link with one UPDATE ... WHERE
-- consumed_at IS NULL ... RETURNING, so two requests arriving with the same
-- token cannot both be served: the second matches no row. A SELECT-then-UPDATE
-- would let an email scanner and the human both get a session from one link.
--
-- account_id IS NULLABLE ON PURPOSE. A link may be issued to a client who has
-- no account row yet — that is the auto-provisioning case, and the account is
-- created at verification, not at request time. Requesting a link must not be
-- able to create anything; if it could, an address-spray would populate the
-- accounts table.

CREATE TABLE IF NOT EXISTS account_magic_links (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),

  -- The address as asked for, lowercased and trimmed. Kept even when nothing
  -- matched, because that is what the limiter counts and what support reads.
  email         text NOT NULL,

  -- The account this link signs in, when one already exists.
  account_id    uuid REFERENCES accounts(id) ON DELETE CASCADE,
  -- The client this link belongs to. Set when the address matched a client
  -- record; it is what an account is provisioned FROM at verification.
  client_id     uuid REFERENCES clients(id) ON DELETE CASCADE,

  -- sha256(token). NULL means no link was minted — see the header.
  token_hash    text,
  expires_at    timestamptz,
  consumed_at   timestamptz,

  --   issued        a link was minted and queued for email
  --   no_account    the address matched no account and no client
  --   not_eligible  the address matched an account that cannot use this path
  outcome       text NOT NULL,

  requested_ip         inet,
  requested_user_agent text,
  consumed_ip          inet,
  consumed_user_agent  text,

  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT account_magic_links_outcome_ck
    CHECK (outcome IN ('issued', 'no_account', 'not_eligible')),
  CONSTRAINT account_magic_links_email_ck
    CHECK (email = lower(btrim(email)) AND email <> ''),
  -- An issued link has a secret and a deadline; a receipt has neither. Either
  -- shape is fine, the halfway house is not: a token with no expiry never dies.
  CONSTRAINT account_magic_links_issued_ck CHECK (
    (outcome =  'issued' AND token_hash IS NOT NULL AND expires_at IS NOT NULL) OR
    (outcome <> 'issued' AND token_hash IS NULL     AND expires_at IS NULL)
  ),
  -- Nothing can be consumed that was never issued.
  CONSTRAINT account_magic_links_consumed_ck
    CHECK (consumed_at IS NULL OR token_hash IS NOT NULL)
);

-- The verification lookup, and the guarantee that one token means one row.
-- Partial, because receipts carry no token and several of them share NULL.
CREATE UNIQUE INDEX IF NOT EXISTS account_magic_links_token_uniq
  ON account_magic_links (token_hash) WHERE token_hash IS NOT NULL;

-- The rate limiter's read: how many requests for this address, recently.
CREATE INDEX IF NOT EXISTS account_magic_links_email_idx
  ON account_magic_links (org_id, email, created_at DESC);
-- The same question asked of a source address, for the spray case.
CREATE INDEX IF NOT EXISTS account_magic_links_ip_idx
  ON account_magic_links (org_id, requested_ip, created_at DESC);
-- Links still capable of signing somebody in — what an expiry sweep would read.
CREATE INDEX IF NOT EXISTS account_magic_links_live_idx
  ON account_magic_links (expires_at)
  WHERE consumed_at IS NULL AND token_hash IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 044's accounts_active_needs_hash is LEFT STANDING, and this is how.
-- ---------------------------------------------------------------------------
-- That constraint says an active account must carry a password_hash, and it was
-- written to mean "an active account must be able to authenticate". Dropping it
-- was the obvious way to let a passwordless client be active, and it is the
-- wrong one: src/auth/account-session.pg.test.mjs asserts the rejection, and a
-- migration whose job is to make a test stop failing is a migration that
-- removed a guarantee to buy silence.
--
-- So the guarantee stays and the provisioning path satisfies it honestly.
-- src/auth/magic-link.mjs mints 32 CSPRNG bytes, hashes them with the same
-- scrypt every staff password uses, writes the hash and drops the cleartext
-- without it ever leaving that function. The row therefore holds a REAL
-- credential — it is simply one that nobody, including this system, has a copy
-- of, so password sign-in for that account is a 2^-256 event rather than a
-- policy we have to remember to enforce. The claim the column makes is true.
--
-- What that hash is NOT: a password anybody can be given, and not a lock-out
-- either. A client who wants one goes through the ordinary reset path; until
-- they do, the emailed link is how they sign in.

-- ---------------------------------------------------------------------------
-- The unprivileged app role, same reasoning as 105_login_path_grants.sql.
-- ---------------------------------------------------------------------------
-- 104_app_role.sql runs the application as fundhub_app, which holds no
-- privilege it was not granted. A new table on the sign-in path is a new grant
-- or it is a permission error on the first client who tries to sign in — and
-- that error arrives in production, not here. DELETE is included so a retention
-- sweep can drop spent links without a second migration.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON account_magic_links TO fundhub_app;

    IF NOT has_table_privilege('fundhub_app', 'account_magic_links', 'SELECT')
       OR NOT has_table_privilege('fundhub_app', 'account_magic_links', 'INSERT')
       OR NOT has_table_privilege('fundhub_app', 'account_magic_links', 'UPDATE') THEN
      RAISE EXCEPTION
        'fundhub_app cannot read or write account_magic_links — portal sign-in would fail for every client. Rolling back rather than reporting success.';
    END IF;
    RAISE NOTICE 'fundhub_app verified on account_magic_links.';
  ELSE
    -- 104 has not run here (an older database, or a test fixture built from a
    -- subset). Say so rather than failing: the table is correct either way, and
    -- 105 takes the same position about the roles it depends on.
    RAISE NOTICE 'role fundhub_app does not exist — skipping the grant. Re-run 104_app_role.sql, then this file supersedes nothing and the grant must be made by hand.';
  END IF;
END $$;
