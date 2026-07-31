-- 101_bank_transaction_subject_anchor.sql — keep a route from a bank transaction
-- back to the person, even after that person's client row is gone.
--
-- ============================================================================
-- 1. THE BUG THIS FIXES. READ THIS BEFORE CHANGING ANYTHING BELOW.
-- ============================================================================
--
-- Deleting one `clients` row does two things at the same moment, and each one is
-- individually defensible:
--
--   (a) bank_transactions.client_id is a FK declared ON DELETE SET NULL (085,
--       section on client_id). It becomes NULL. That was a deliberate choice and
--       it is the right one — "deleting a client must not destroy the evidence
--       that the money moved", same call mail_responses.client_id made in 065.
--
--   (b) bank_accounts.client_id is a FK declared ON DELETE CASCADE (081). Every
--       account row for that client is DELETED outright.
--
-- Separately, each is correct. Together they are a trapdoor.
--
-- bank_transactions.bank_account_id has NO FOREIGN KEY (085, section 4), so
-- nothing nulls it and nothing cascades through it. The value survives. But the
-- bank_accounts row it names has just been deleted by (b), so the value now
-- points at nothing. Meanwhile (a) has erased the only other link to the person.
--
-- The result is a row that is:
--
--     client_id        -> NULL          (no route back to the person)
--     bank_account_id  -> a dead uuid   (no route to the account, and therefore
--                                        no route to the person through it)
--
-- *** THE ROW STILL HOLDS THAT PERSON'S FINANCIAL HISTORY. *** Merchant names,
-- amounts, dates — where they shop, what they pay, when they get paid. It is
-- still in the table. Nothing can find it. A later erasure request asking "remove
-- everything you hold about this person" will search by client_id, match nothing,
-- and report success. The data is not erased; it is unfindable, which is worse,
-- because now it is also unauditable.
--
-- This is not hypothetical bookkeeping. It is the difference between a compliant
-- answer to a data subject and a false one.
--
--
-- ============================================================================
-- 2. THE FIX, AND WHY IT IS NOT A FOREIGN KEY.
-- ============================================================================
--
-- `subject_client_id` is a durable copy of the client id that is DELIBERATELY
-- NOT A FOREIGN KEY. That is the entire point of the column and it must stay
-- that way. A FK is exactly what fails here:
--
--   ON DELETE SET NULL  — reproduces the bug this column exists to fix.
--   ON DELETE CASCADE   — destroys the ledger, which (a) above already rejected.
--   ON DELETE RESTRICT  — refuses to delete the client at all, turning a routine
--                         operation into a database error nobody can clear.
--
-- There is no FK behaviour that means "keep pointing at who this was". So the
-- column is a plain uuid, and the comment below is what stops a future reader
-- from "tidying it up" into a real reference and silently re-opening the hole.
--
-- WHY NOT JUST ADD THE MISSING FK ON bank_account_id INSTEAD. Because it does not
-- solve this. Every ON DELETE option above has the same three failure modes for
-- that column too, and the account row is deleted by the client cascade regardless.
-- Adding it is a separate decision with its own compliance consequence and is
-- recorded as still-open on docs/workflows/fundhub-beta-buildout.md.
--
--
-- ============================================================================
-- 3. WHY A TRIGGER AND NOT A RULE THAT WRITERS ARE ASKED TO REMEMBER.
-- ============================================================================
--
-- The ingest path for this table is owned by another workflow and does not exist
-- yet. Rows can also arrive from a backfill, a psql session, or a provider sync
-- written a year from now by somebody who never reads this file. An anchor that
-- depends on every writer remembering to set it is an anchor that is NULL on the
-- rows that matter.
--
-- So it is a BEFORE INSERT OR UPDATE trigger. Same reasoning as
-- bank_accounts.entity_kind defaulting to 'unknown' in 082: a schema fact any
-- INSERT from any source picks up, rather than a code fact one module honours.
--
-- The trigger is COALESCE-shaped and never overwrites a value that is already
-- there. It fills the anchor from client_id when the anchor is empty; it does not
-- reset the anchor to NULL when client_id later becomes NULL. That asymmetry IS
-- the fix — the SET NULL in (a) fires as an UPDATE on this row, and a symmetric
-- trigger would helpfully undo everything this migration does.
--
--
-- ============================================================================
-- 4. THIS MIGRATION DELETES NOTHING AND ERASES NOTHING.
-- ============================================================================
--
-- It adds a column, a trigger, an index, and it backfills the column from data
-- already in the row. No row is removed, no value is overwritten with a
-- placeholder, no client is de-identified. Erasure runs on an explicit request
-- with an audit record (102) and never on a schedule, a migration, or a sweep.
--
-- The backfill is the honest part: rows ALREADY orphaned before this migration
-- ran have client_id = NULL and cannot be recovered from this table alone. They
-- are counted, not invented. See section 6.


-- ---------------------------------------------------------------------------
-- A. The durable anchor
-- ---------------------------------------------------------------------------

ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS subject_client_id uuid;

COMMENT ON COLUMN bank_transactions.subject_client_id IS
  'Durable route back to the person. NOT a foreign key, deliberately: SET NULL reproduces the orphan bug, CASCADE destroys the ledger, RESTRICT blocks client deletion. Populated by trg_bank_transactions_subject_anchor. Do not convert this to a reference. NULL means the row was already orphaned before migration 101 ran, or arrived with no client attached at all — it is not a synonym for client_id IS NULL.';


-- ---------------------------------------------------------------------------
-- B. The trigger that keeps it populated, from any writer
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION bank_transactions_set_subject_anchor()
RETURNS trigger AS $$
BEGIN
  -- COALESCE, one direction only. Fill the anchor when it is empty; never clear
  -- it, and never overwrite one that is already set.
  --
  -- The ON DELETE SET NULL on client_id arrives here as an UPDATE with
  -- NEW.client_id IS NULL. Because this only ever reads client_id to FILL a NULL
  -- anchor, that update leaves the anchor standing. A symmetric assignment
  -- (NEW.subject_client_id := NEW.client_id) would null the anchor at exactly the
  -- moment it becomes the only copy, which is the whole bug, re-implemented.
  IF NEW.subject_client_id IS NULL AND NEW.client_id IS NOT NULL THEN
    NEW.subject_client_id := NEW.client_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bank_transactions_subject_anchor ON bank_transactions;

CREATE TRIGGER trg_bank_transactions_subject_anchor
  BEFORE INSERT OR UPDATE ON bank_transactions
  FOR EACH ROW
  EXECUTE FUNCTION bank_transactions_set_subject_anchor();


-- ---------------------------------------------------------------------------
-- C. Backfill what is still recoverable
-- ---------------------------------------------------------------------------

-- Only rows that still have a client_id. A row already orphaned before this ran
-- has nothing left in it to recover the person from, and this migration will not
-- guess one. The absence is the finding — see section 6.
UPDATE bank_transactions
   SET subject_client_id = client_id
 WHERE subject_client_id IS NULL
   AND client_id IS NOT NULL;


-- ---------------------------------------------------------------------------
-- D. The erasure lookup
-- ---------------------------------------------------------------------------

-- How an erasure request finds a person's transactions after their client row is
-- gone. Without this index the erasure path is a sequential scan of the whole
-- ledger, which is the kind of cost that gets a compliance job quietly disabled.
-- Org-scoped leading column: every read in this system is scoped to one org from
-- the session, and an index that is not is an index that invites a query that
-- is not.
CREATE INDEX IF NOT EXISTS idx_bank_transactions_subject_client
  ON bank_transactions (org_id, subject_client_id)
  WHERE subject_client_id IS NOT NULL;


-- ---------------------------------------------------------------------------
-- E. Report the rows that were already lost
-- ---------------------------------------------------------------------------

-- Section 6. A migration that silently leaves unrecoverable rows behind looks
-- identical to one that had none. This raises a NOTICE with the count so the
-- person running the migration sees it in the output.
--
-- It is a NOTICE and not an exception on purpose: these rows are pre-existing
-- damage, the migration cannot fix them, and failing the run would only stop the
-- fix that prevents any more of them.
DO $$
DECLARE
  orphaned bigint;
BEGIN
  SELECT count(*) INTO orphaned
    FROM bank_transactions
   WHERE subject_client_id IS NULL;

  IF orphaned > 0 THEN
    RAISE NOTICE '101: % bank_transactions rows have no client anchor and none could be recovered. These were orphaned before this migration ran: client_id was already NULL and bank_account_id points at a deleted account. They hold financial history that no erasure request can find. They are NOT deleted here — deleting data on a migration is exactly what this system does not do. Report them.', orphaned;
  END IF;
END $$;
