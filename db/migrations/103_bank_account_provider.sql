-- 103_bank_account_provider.sql — WHERE A BANK ACCOUNT ROW CAME FROM.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY THIS COLUMN EXISTS, AND IT IS NOT BOOKKEEPING
-- ═══════════════════════════════════════════════════════════════════════════
-- 081 shipped with no writer at all. The only `INSERT INTO bank_accounts` in the
-- repository was inside a pg test, and 081's own comment says a NULL
-- plaid_item_id means "the row was entered by hand rather than read from a bank
-- connection — a real and expected case, because nothing in this repo can talk
-- to Plaid yet."
--
-- That is about to stop being true in a specific and dangerous way. A MOCK
-- provider is being added so the account writer can be built and exercised
-- before real Plaid credentials exist. A mock account has a NULL plaid_item_id
-- for the same reason a hand-typed one does — so under 081's scheme the two are
-- indistinguishable, and BOTH are indistinguishable from a real bank read once
-- one lands.
--
-- The Money Map screen puts these balances in front of an owner and totals them.
-- A made-up balance that a screen cannot tell apart from a real one is the exact
-- defect class this schema keeps writing headers about: a confident number
-- nobody can stand behind. So the provenance goes in a column, not in a comment,
-- and not in `raw` where no index and no screen will ever look at it.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THE FOUR VALUES
-- ═══════════════════════════════════════════════════════════════════════════
--   manual — a person typed it. The DEFAULT, because it is what every row
--            written before this migration is: nothing automated could have
--            written one.
--   mock   — a stand-in provider produced it. NOT REAL MONEY. Any screen that
--            shows it must say so, and any funding decision that rests on it is
--            resting on nothing.
--   plaid  — read from a live bank connection. Nothing writes this yet; the
--            seam in src/banking/plaid.mjs is deliberately unclosed and needs a
--            SOC 2 review, a compliance-approved consent flow and a human
--            decision before it can be.
--   import — loaded from a statement or a file a human supplied. Reserved so
--            the obvious next source does not arrive needing another migration
--            and get shoehorned into 'manual' in the meantime.
--
-- NOT NULL WITH A DEFAULT, unlike almost every other column in 081. This one is
-- never unknown: whoever writes a row knows how they got it. "We do not know
-- where this money figure came from" is not a state this table should be able
-- to represent.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY THIS IS NOT entity_kind ALL OVER AGAIN
-- ═══════════════════════════════════════════════════════════════════════════
-- 082's `entity_kind` answers "whose money is this", is genuinely unknown most
-- of the time, and defaults to 'unknown' for exactly that reason. This answers
-- "who told us about it", which the writer always knows at the moment it writes.
-- Different question, different default, and they must not be conflated: a real
-- Plaid account still has entity_kind 'unknown' until a human establishes
-- ownership, and a mock account is 'unknown' too.
--
-- EDITING AN APPLIED MIGRATION IS A SILENT NO-OP — migrate.mjs keys
-- schema_migrations on '<dir>/<file>'. Supersede, do not edit.

ALTER TABLE bank_accounts
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'manual';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bank_accounts_provider_ck'
  ) THEN
    ALTER TABLE bank_accounts
      ADD CONSTRAINT bank_accounts_provider_ck
      CHECK (provider IN ('manual', 'mock', 'plaid', 'import'));
  END IF;
END $$;

-- A row that names a bank connection must not claim a person typed it.
--
-- RELAXED ON MERGE, AND ONLY IN THE DIRECTION THAT WAS WRONG. This constraint was
-- written as `provider = 'plaid' AND item IS NOT NULL` OR `provider <> 'plaid'
-- AND item IS NULL` — i.e. ONLY Plaid may hang off a plaid_items row. That was
-- true on the branch this file came from, which has no importer. It is false on
-- main: src/banking/import.mjs (W1) routes EVERY provider through ensureItem(),
-- so a mock import creates a plaid_items row keyed `mock:<client_id>` with the
-- institution name "Mock Bank (test data)" and hangs its accounts off it. That is
-- deliberate and documented — the mock and a real Plaid client are meant to share
-- the whole write path so going live re-implements none of it.
--
-- The original's stated worry was "a mock must never acquire the look of a real
-- one". Nothing here gives it that look: the row still says provider='mock', the
-- item still says "Mock Bank (test data)", and the screen still shows both. What
-- the rule is actually for is the OTHER direction — a row claiming a person typed
-- it while pointing at a bank connection — and that half is kept exactly.
--
-- So: 'manual' means hand-entered and must carry no item. Every other provider
-- may carry one, and 'plaid' must.
DO $$
BEGIN
  -- BACKFILL BEFORE CONSTRAINING. bank_accounts is populated on any database that
  -- has ever run an import, and every one of those rows predates this column, so
  -- they all default to 'manual' while pointing at an item. Adding the constraint
  -- without this fails the migration outright on exactly the databases that have
  -- been used. No row is deleted and none is invented: a row with an item is what
  -- the item says it is.
  UPDATE bank_accounts b
     SET provider = CASE
                      WHEN i.plaid_item_id LIKE 'mock:%' THEN 'mock'
                      ELSE 'plaid'
                    END
    FROM plaid_items i
   WHERE i.id = b.plaid_item_id
     AND b.provider = 'manual';

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bank_accounts_provider_item_ck'
  ) THEN
    ALTER TABLE bank_accounts
      ADD CONSTRAINT bank_accounts_provider_item_ck
      CHECK (
        (provider = 'manual' AND plaid_item_id IS NULL)
        OR (provider = 'plaid' AND plaid_item_id IS NOT NULL)
        OR (provider NOT IN ('manual', 'plaid'))
      );
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- provider_account_id — THE PROVIDER'S OWN KEY, FOR PROVIDERS THAT ARE NOT PLAID
-- ═══════════════════════════════════════════════════════════════════════════
-- 081's uq_bank_accounts_plaid is `(plaid_item_id, plaid_account_id) WHERE
-- plaid_item_id IS NOT NULL AND plaid_account_id IS NOT NULL`. That is the right
-- key for Plaid and it is deliberately partial — 081 explains that NULLs do not
-- collide in Postgres, so an unpartitioned version would let duplicates through
-- while blocking legitimate manual entry.
--
-- But it means a non-Plaid provider has NO conflict target at all. Re-running a
-- mock sync would append a second copy of every account, and a screen that sums
-- balances would then report double. "Detection is not an event, it is a
-- standing inference that gets recomputed" — 086's upsert reasoning applies
-- identically here: a sync is re-read, not appended.
--
-- So: the provider's own identifier for the account, in a column that is not
-- named after one vendor. `plaid_account_id` is left exactly as it is; the Plaid
-- seam belongs to another unit and this migration does not reach into it.
ALTER TABLE bank_accounts
  ADD COLUMN IF NOT EXISTS provider_account_id text;

-- A mock account MUST carry one, so the mock sync is idempotent by construction
-- rather than by the caller remembering to be careful. 'manual' does not — a
-- person typing an account has no provider id to give, and demanding one would
-- make hand entry impossible.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bank_accounts_mock_needs_ref_ck'
  ) THEN
    ALTER TABLE bank_accounts
      ADD CONSTRAINT bank_accounts_mock_needs_ref_ck
      CHECK (provider <> 'mock' OR provider_account_id IS NOT NULL);
  END IF;
END $$;

-- The conflict target for every non-Plaid sync. Scoped by org AND client because
-- a provider id is only unique within the account it came from.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_accounts_provider_ref
  ON bank_accounts (org_id, client_id, provider, provider_account_id)
  WHERE provider_account_id IS NOT NULL;

-- The question a person actually asks this column: "is anything on this screen
-- not real?" Partial, because the answer is nearly always no and a full index
-- would be mostly dead weight.
CREATE INDEX IF NOT EXISTS idx_bank_accounts_not_real
  ON bank_accounts (org_id, client_id)
  WHERE provider = 'mock';

COMMENT ON COLUMN bank_accounts.provider_account_id IS
  'The provider''s own identifier for this account, for providers that are not Plaid. The conflict target of uq_bank_accounts_provider_ref, which is what makes a re-sync an update instead of a duplicate. NULL for hand-entered rows, which have no provider id. Plaid rows keep using plaid_account_id and 081''s own unique index — this column does not replace it.';

COMMENT ON COLUMN bank_accounts.provider IS
  'Where this row came from: manual (a person typed it — the default and what every pre-091 row is), mock (a stand-in provider, NOT REAL MONEY, and every screen showing it must say so), plaid (a live bank connection — nothing writes this yet), import (a statement or file). NOT NULL: the writer always knows. Distinct from entity_kind, which asks whose money it is and is genuinely unknown most of the time. See db/migrations/091_bank_account_provider.sql.';
