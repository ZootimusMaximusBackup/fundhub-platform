-- 082_bank_account_entity_kind.sql — is this account the person's, or the
-- business's, or do we not know?
--
--
-- *** THERE ARE THREE STATES AND THE THIRD ONE IS NOT A BUG. ***
--
--   personal — the consumer's own account
--   business — the business entity's account
--   unknown  — WE DO NOT KNOW
--
-- `unknown` is the DEFAULT. It is not a placeholder to be cleaned up later, not
-- a data-quality problem, and not a synonym for personal. It is the honest and
-- extremely common answer, and every screen reading this column must have a
-- place to put it.
--
--
-- WHY UNKNOWN IS THE DEFAULT, AND WHY IT MUST NEVER FALL BACK TO 'personal'.
--
-- Plaid does not reliably tell us. There is no field that says "this is a
-- business account". What actually arrives is an account name, a type and a
-- subtype — "Business Complete Checking" is a strong hint, "Chase Checking"
-- under a sole proprietor is no hint at all, and a great many small-business
-- owners run their company through an account that is, legally and in every
-- field Plaid returns, a personal checking account.
--
-- So the classification is a GUESS unless a human made it. The question is only
-- what to do with the guess, and the answer is dictated by which mistake is
-- worse:
--
--   Filing a BUSINESS account under PERSONAL — the client's company money shows
--   up in their personal picture. Wrong, visible, annoying.
--
--   Filing a PERSONAL account under BUSINESS — the client's own money, their
--   salary, their rent, their private spending, is displayed inside their
--   business view and included in business totals. On a screen that may be
--   shown to a partner, an advisor, or a lender, that is somebody's private
--   finances leaking into a commercial context.
--
-- Both are bad. Defaulting to EITHER produces one of them silently and at scale.
-- So neither is the default: an unclassified account says it is unclassified,
-- and the screen shows it in its own place where a human can resolve it in one
-- click. The one thing this column must never do is let a guess wear the
-- clothes of a fact.
--
--
-- WHY A SEPARATE MIGRATION FROM 081. The column and its rule are the thing most
-- likely to be read by somebody trying to understand a screen, and burying it
-- three-quarters of the way down a table definition would hide it. It also
-- models the truth: the split was a decision made about accounts that already
-- existed.
--
-- Adding a NOT NULL column with a DEFAULT to an existing table rewrites no rows
-- on Postgres 11+ and does not lock the table for a scan. `bank_accounts` was
-- created by 081 in this same batch and is empty, so this is a formality here —
-- but it is the reason the default is attached rather than backfilled.

ALTER TABLE bank_accounts
  ADD COLUMN IF NOT EXISTS entity_kind text NOT NULL DEFAULT 'unknown';

ALTER TABLE bank_accounts DROP CONSTRAINT IF EXISTS bank_accounts_entity_kind_check;
ALTER TABLE bank_accounts ADD CONSTRAINT bank_accounts_entity_kind_check
  CHECK (entity_kind IN ('personal', 'business', 'unknown'));

-- HOW WE CAME TO BELIEVE IT. Without this, a human's deliberate decision and a
-- string match on the word "Business" are indistinguishable in the column, and
-- the next person to write a classifier will happily overwrite the human.
--
--   plaid    — the institution or aggregator actually said so
--   manual   — a human classified it. Authoritative; a classifier must not
--              overwrite this.
--   inferred — we guessed from the account name or subtype
--   unset    — nobody has classified it at all (pairs with entity_kind='unknown')
ALTER TABLE bank_accounts
  ADD COLUMN IF NOT EXISTS entity_kind_source text NOT NULL DEFAULT 'unset';

ALTER TABLE bank_accounts DROP CONSTRAINT IF EXISTS bank_accounts_entity_kind_source_check;
ALTER TABLE bank_accounts ADD CONSTRAINT bank_accounts_entity_kind_source_check
  CHECK (entity_kind_source IN ('plaid', 'manual', 'inferred', 'unset'));

-- Who decided, and when. NULL until somebody does. This is what lets a screen
-- say "classified by Dana on 12 June" instead of presenting a guess and a
-- judgement in identical type.
ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS entity_kind_set_at timestamptz;
ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS entity_kind_set_by uuid REFERENCES staff(id);

-- THE TWO RULES THAT KEEP THE THREE STATES HONEST.
--
-- 1. An account classified as personal or business must say how it was
--    classified. 'unset' means nobody classified it, so it cannot coexist with a
--    definite answer — that combination is precisely a guess with no provenance.
-- 2. An UNKNOWN account must not claim a source. "We do not know, according to
--    Plaid" is not a statement about anything.
ALTER TABLE bank_accounts DROP CONSTRAINT IF EXISTS bank_accounts_entity_kind_provenance;
ALTER TABLE bank_accounts ADD CONSTRAINT bank_accounts_entity_kind_provenance
  CHECK (
    (entity_kind = 'unknown' AND entity_kind_source = 'unset') OR
    (entity_kind IN ('personal', 'business') AND entity_kind_source <> 'unset')
  );

-- A human's decision must record who made it. An inferred or Plaid-sourced
-- classification has no human and correctly has no staff id.
ALTER TABLE bank_accounts DROP CONSTRAINT IF EXISTS bank_accounts_entity_kind_manual_actor;
ALTER TABLE bank_accounts ADD CONSTRAINT bank_accounts_entity_kind_manual_actor
  CHECK (entity_kind_source <> 'manual' OR entity_kind_set_by IS NOT NULL);

-- The screens group by this, per client, and the unknown bucket is queried as
-- often as the other two — it is a work queue, not an error list.
CREATE INDEX IF NOT EXISTS idx_bank_accounts_entity_kind
  ON bank_accounts (client_id, entity_kind) WHERE status = 'open';

COMMENT ON COLUMN bank_accounts.entity_kind IS
  'personal | business | unknown. THREE STATES, and unknown is the DEFAULT and a real answer — not a placeholder and NOT a synonym for personal. Plaid does not reliably distinguish these. Defaulting an unclassified account to personal hides business money in a personal view; defaulting to business leaks somebody private finances into a commercial one. Neither is acceptable, so unclassified accounts say so and get their own place on screen. See db/migrations/082_bank_account_entity_kind.sql.';

COMMENT ON COLUMN bank_accounts.entity_kind_source IS
  'plaid | manual | inferred | unset. How we came to believe it. manual is a human decision and a classifier must not overwrite it. Enforced: a definite entity_kind cannot have source unset, and unknown cannot claim a source.';
