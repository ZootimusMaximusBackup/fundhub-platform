-- 082_bank_account_entity_kind.sql — whose money is this: the client's, their
-- business's, or we do not know yet.
--
-- THE WHOLE POINT: UNKNOWN IS NOT PERSONAL, AND UNKNOWN IS THE DEFAULT.
--
-- This is a business-funding product. Nearly every decision downstream of a bank
-- account changes depending on whether the account belongs to a person or to an
-- entity: which revenue counts toward a funding offer, which balances a lender
-- may look at, which documents get requested, what a client is told about their
-- own numbers. So the ownership of every account has to be a recorded fact.
--
-- WHY DEFAULTING TO 'personal' WOULD BE A DEFECT, NOT A SHORTCUT. Most consumer
-- bank accounts are personal, so 'personal' looks like the sensible default. It
-- is the most expensive one available. An account we have never classified would
-- arrive pre-labelled with a plausible answer, and nothing downstream can tell a
-- guess apart from a fact — the column reads the same either way. A business
-- account silently filed as personal drags business revenue into a personal
-- picture, or hides it from a funding calculation entirely, and the error is
-- invisible because the data looks complete. Every reviewer sees a filled-in
-- field and moves on. This repo keeps finding exactly this class of silent
-- wrongness — a default that is usually right and unfalsifiable when it is not.
-- So: the default is 'unknown', 'unknown' is a real value in the CHECK below,
-- and code that needs to know ownership must handle 'unknown' by ASKING, never
-- by assuming. Anything that would rather have a guess than an unanswered
-- question is the bug.
--
-- 'unknown' IS A KNOWN-UNKNOWN, WHICH IS NOT THE SAME AS NULL. Migrations 080
-- and 081 use NULL for "we have no record of this and never asked". 'unknown'
-- here is stronger and deliberate: we KNOW this account's ownership matters, we
-- know it has not been established, and we are writing that down so a screen can
-- show it, a query can count it and a person can be asked. That is why the
-- column is NOT NULL with a default rather than a nullable column — an absence
-- can be overlooked, a recorded 'unknown' cannot. A NULL here would be a third
-- state meaning nothing, so it is not permitted.
--
-- 'mixed' / commingled IS DELIBERATELY NOT A VALUE, AND THAT IS A FINDING.
-- Commingled accounts are real and common among the clients this product
-- serves. No document in this repo says how the product should treat one, and
-- inventing a value here would put a business rule nobody agreed to inside a
-- migration — the same discipline 046_ad_platforms.sql applied by leaving the
-- special-ad-category mapping empty rather than guessing an enum. Until a human
-- decides, a commingled account is honestly 'unknown', which prompts the
-- question instead of answering it wrongly. Adding 'mixed' later is one CHECK
-- constraint replacement; un-picking a wrong rule applied to live accounts is not.
--
-- EXISTING ROWS. There are none — bank_accounts was created one migration ago
-- and nothing writes to it. The DEFAULT still does the correct thing if that
-- ever stops being true: every pre-existing row becomes 'unknown', which is the
-- honest description of an account nobody has classified.

ALTER TABLE bank_accounts
  ADD COLUMN IF NOT EXISTS entity_kind text NOT NULL DEFAULT 'unknown';

-- Named, and added separately from the column so a re-run is a no-op rather than
-- an error. A CHECK is used instead of an enum type because replacing an allowed
-- value later (see 'mixed' above) is a one-file constraint swap, while altering a
-- Postgres enum in place is not reversible in the same way.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bank_accounts_entity_kind_check'
  ) THEN
    ALTER TABLE bank_accounts
      ADD CONSTRAINT bank_accounts_entity_kind_check
      --   unknown  — ownership has NOT been established. The default. Not a bug.
      --   personal — established as the individual client's own account.
      --   business — established as belonging to the client's entity.
      CHECK (entity_kind IN ('unknown', 'personal', 'business'));
  END IF;
END $$;

-- HOW WE KNOW, kept beside WHAT WE KNOW. Without this, 'business' picked from a
-- dropdown by a client in a hurry is indistinguishable from 'business' read off
-- a filed entity document, and the two carry very different weight in a funding
-- decision.
--   client_stated      — the client told us. A claim.
--   staff_reviewed     — a human here looked and decided.
--   document_verified  — backed by a document on file.
--   connection_metadata — read from the bank connection itself.
-- NULL means we have not recorded how we know, which is the correct state for
-- every 'unknown' row and a gap worth surfacing on any row that is not.
ALTER TABLE bank_accounts
  ADD COLUMN IF NOT EXISTS entity_kind_source text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bank_accounts_entity_kind_source_check'
  ) THEN
    ALTER TABLE bank_accounts
      ADD CONSTRAINT bank_accounts_entity_kind_source_check
      CHECK (entity_kind_source IS NULL OR entity_kind_source IN
        ('client_stated', 'staff_reviewed', 'document_verified', 'connection_metadata'));
  END IF;
END $$;

-- When ownership was established. NULL means it has not been — which is exactly
-- what every 'unknown' row should carry, and a row that claims personal/business
-- with a NULL here is a data-quality flag, not a normal state.
ALTER TABLE bank_accounts
  ADD COLUMN IF NOT EXISTS entity_kind_set_at timestamptz;

-- An account cannot be classified without a stated basis. This is the constraint
-- that stops a backfill, a psql session or a future endpoint from writing
-- 'business' with no provenance — a rule that lives only in application code is
-- a rule any other write path walks straight past. 'unknown' is deliberately
-- exempt: not knowing needs no evidence.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bank_accounts_entity_kind_provenance_check'
  ) THEN
    ALTER TABLE bank_accounts
      ADD CONSTRAINT bank_accounts_entity_kind_provenance_check
      CHECK (entity_kind = 'unknown' OR entity_kind_source IS NOT NULL);
  END IF;
END $$;

-- The question a human needs answered: which connected accounts are still
-- unclassified. Partial, because that list is the work queue and the classified
-- rows are not.
CREATE INDEX IF NOT EXISTS idx_bank_accounts_entity_unknown
  ON bank_accounts (client_id)
  WHERE entity_kind = 'unknown';
