-- 082_bank_account_entity_kind.sql — is this account the person's, or the
-- business's? And if it is the business's, WHICH business?
--
-- WHY THIS EXISTS, AND WHY IT IS ITS OWN MIGRATION. Every downstream question in
-- the Finance OS forks on this one fact. Business revenue underwrites business
-- funding; personal savings do not. A personal account listed as business
-- inflates what a client appears to be turning over. A business account listed
-- as personal understates it. Both are wrong answers presented with the same
-- confidence as a right one.
--
-- PLAID DOES NOT RELIABLY TELL US. This is the whole point of the file. Plaid
-- returns `type` and `subtype` — depository/checking, credit/credit card — and
-- neither says whose money it is. There is no field on the balance response that
-- distinguishes a sole trader's business chequing account from their personal
-- one, and at many institutions the two are literally the same product. Some
-- accounts carry a hint in `official_name`; most do not, and a name-matching
-- heuristic is precisely the kind of confident guess that puts a client's
-- personal savings under their business.
--
-- SO 'unknown' IS A REAL VALUE, IT IS THE DEFAULT, AND IT MUST SURVIVE. It is
-- not a placeholder waiting to be cleaned up and it is not a synonym for
-- 'personal'. It means: nobody has said, and this platform does not guess. Every
-- consumer of this column must be able to render "not classified" as its own
-- outcome. A migration, a backfill or an endpoint that silently converts
-- 'unknown' into a decision is the failure this design exists to prevent, and
-- the CHECK below is deliberately three values wide so that state remains
-- representable forever rather than being a NULL somebody tidies away.
--
-- WHY NOT A NULLABLE BOOLEAN. `is_business boolean NULL` encodes the same three
-- states and reads as two. Every `WHERE is_business = false` would quietly
-- exclude the unknowns, and every `IF (!is_business)` in JavaScript would
-- quietly include them as personal. A named third value cannot be misread by
-- accident.
--
-- WHICH BUSINESS. `businesses` already exists (001_init.sql) — one or more per
-- client, with a name and an age. `business_id` points at it, and the CHECK
-- makes the incoherent combination unrepresentable: you cannot name a business
-- on an account you have called personal, and you cannot name one on an account
-- nobody has classified. Nullable even when kind='business', because "this is a
-- business account and I do not yet know which entity" is a legitimate and
-- common state during intake.
--
-- CLASSIFICATION IS ATTRIBUTED. Who said so, and when. There is no 'plaid'
-- source value in the CHECK and there must not be one, because Plaid never says
-- — see above. The only sources are 'unclassified' (the default: nobody has
-- said) and 'staff' (a named employee decided). If a client-facing flow is ever
-- built to let clients classify their own accounts, adding 'client' is a
-- deliberate one-line change in a migration somebody signs, not something that
-- arrives by accident.
--
-- ALTER, NOT A NEW TABLE. This is one fact about an account that 081 already
-- models, and a separate classification table would make "is this account
-- business" a join that some future read forgets to do — defaulting, silently,
-- to no row at all. Applied as its own migration rather than folded into 081
-- because the classification is a distinct decision with a distinct reason, and
-- 081 is already applied wherever this runs second. Editing an applied migration
-- is a silent no-op in this repo; superseding it with a new file is the pattern.

ALTER TABLE bank_accounts
  ADD COLUMN IF NOT EXISTS entity_kind text NOT NULL DEFAULT 'unknown';

ALTER TABLE bank_accounts
  ADD COLUMN IF NOT EXISTS business_id uuid;

ALTER TABLE bank_accounts
  ADD COLUMN IF NOT EXISTS entity_kind_source text NOT NULL DEFAULT 'unclassified';

ALTER TABLE bank_accounts
  ADD COLUMN IF NOT EXISTS entity_kind_set_by text;

ALTER TABLE bank_accounts
  ADD COLUMN IF NOT EXISTS entity_kind_set_at timestamptz;

DO $$
BEGIN
  -- Three values, and 'unknown' is one of them permanently.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bank_accounts_entity_kind_chk') THEN
    ALTER TABLE bank_accounts ADD CONSTRAINT bank_accounts_entity_kind_chk
      CHECK (entity_kind IN ('personal','business','unknown'));
  END IF;

  -- No 'plaid'. Plaid does not know. See the header.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bank_accounts_entity_kind_source_chk') THEN
    ALTER TABLE bank_accounts ADD CONSTRAINT bank_accounts_entity_kind_source_chk
      CHECK (entity_kind_source IN ('unclassified','staff'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bank_accounts_business_fk') THEN
    ALTER TABLE bank_accounts ADD CONSTRAINT bank_accounts_business_fk
      FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE SET NULL;
  END IF;

  -- A business may only be named on an account someone has called a business
  -- account. This is what stops a personal account acquiring a business by way
  -- of a partial UPDATE that set the id and left the kind alone.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bank_accounts_business_requires_kind') THEN
    ALTER TABLE bank_accounts ADD CONSTRAINT bank_accounts_business_requires_kind
      CHECK (business_id IS NULL OR entity_kind = 'business');
  END IF;

  -- An unclassified account cannot carry a classifier or a classification time,
  -- and a classified one must carry both. Without this the audit question "who
  -- decided this was a business account" has a NULL answer on rows that claim to
  -- have been decided.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bank_accounts_entity_kind_attribution') THEN
    ALTER TABLE bank_accounts ADD CONSTRAINT bank_accounts_entity_kind_attribution
      CHECK (
        (entity_kind_source = 'unclassified'
           AND entity_kind_set_by IS NULL
           AND entity_kind_set_at IS NULL)
        OR
        (entity_kind_source <> 'unclassified'
           AND entity_kind_set_by IS NOT NULL
           AND entity_kind_set_at IS NOT NULL)
      );
  END IF;
END $$;

-- The read that matters: this client's accounts, split by whose money it is.
-- Unknowns sort first on purpose — they are the work queue, not the leftovers.
CREATE INDEX IF NOT EXISTS idx_bank_accounts_entity_kind
  ON bank_accounts (client_id, entity_kind);

-- "What still needs classifying, across the org." The partial index keeps this
-- cheap as the classified majority grows.
CREATE INDEX IF NOT EXISTS idx_bank_accounts_unclassified
  ON bank_accounts (org_id, created_at)
  WHERE entity_kind = 'unknown';
