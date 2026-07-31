-- 092_bank_account_fk.sql — the foreign key 085 and 086 left out, on a reason
-- that was already untrue when it was written.
--
-- *** THIS FILE CONNECTS TO NOTHING AND FETCHES NOTHING. *** It adds two
-- foreign keys and nothing else. No new table, no new column, no data written.
--
--
-- ============================================================================
-- 1. THE JUSTIFICATION IN 085 SECTION 4 IS FALSE. THAT IS WHY THIS EXISTS.
-- ============================================================================
--
-- 085_bank_transactions.sql:103-106 says, in these words:
--
--   "`bank_account_id uuid NOT NULL` points at a `bank_accounts` table that
--    DOES NOT EXIST IN THIS REPOSITORY TODAY:
--      $ grep -rn "bank_account" db/schema db/migrations
--          -> no matches before this file"
--
-- db/migrations/081_bank_accounts.sql:34 creates `bank_accounts`, and migrate.mjs
-- applies files in filename order, so 081 was already applied when 085 ran. The
-- grep result quoted above cannot have been produced by this repository. 086
-- then declined the same key by citing 085's reason rather than re-checking it.
--
-- So the missing key was never a considered trade-off between a soft link and a
-- broken run — it was a gap resting on a fact that was not a fact. Both files
-- also said the fix is a LATER migration and never an edit to themselves,
-- because migrate.mjs keys schema_migrations by `<dir>/<file>` and re-editing an
-- applied file is a silent no-op. This is that later migration.
--
--
-- ============================================================================
-- 2. WHAT THE GAP COST. BOTH REPRODUCED, BOTH NOW TESTED.
-- ============================================================================
--
-- (a) REVOKED CONSENT LEFT THE DERIVED DATA BEHIND. 081:42 makes
--     bank_accounts.plaid_item_id ON DELETE CASCADE, so a client revoking a bank
--     login deletes the plaid_items row and every account under it goes with it.
--     The transactions and the detected bills stayed, pointing at account ids
--     that no longer existed. src/banking/store.mjs listRecurringBills() filters
--     on org and client and never on whether the account is still connected, so
--     the cash-flow projector would price a client's month off a bank connection
--     that client had already withdrawn.
--
-- (b) A WHOLLY INVENTED ACCOUNT UUID WAS ACCEPTED. Any well-formed uuid could be
--     written into bank_account_id and Postgres raised nothing.
--
-- src/banking/account-link.pg.test.mjs runs both against real Postgres.
--
--
-- ============================================================================
-- 3. ON DELETE CASCADE, NOT SET NULL AND NOT RESTRICT.
-- ============================================================================
--
-- SET NULL is not available: bank_account_id is NOT NULL on both tables, and a
-- transaction with no account is not a record of anything — the account is what
-- makes a provider transaction id mean one transaction (085 section 3).
--
-- RESTRICT would make revoking a bank login FAIL for any client who has ever had
-- a transaction read. Consent withdrawal must never be blocked by data the
-- consent produced.
--
-- CASCADE matches the chain that already exists and the direction it already
-- runs: plaid_items -> bank_accounts is CASCADE (081:42), bank_accounts ->
-- clients is CASCADE (081:37), and 086 already CASCADEs the evidence join table
-- from both of its parents. Deleting the account the money moved through takes
-- the ledger of those movements and the inferences drawn from them with it.
--
-- *** THIS CHANGES WHAT A REVOKED BANK CONNECTION DESTROYS. *** It is a
-- retention decision on consumer financial data in a regulated product, and it
-- is flagged for human review on that basis rather than treated as a schema
-- tidy-up. Note the boundary: `clients.id` is still ON DELETE SET NULL on both
-- tables (085:187, 086's client_id), so deleting a CLIENT still preserves the
-- evidence that money moved. Only removing the ACCOUNT removes the account's
-- rows.
--
--
-- ============================================================================
-- 4. WHY THIS DOES NOT DELETE ANYTHING.
-- ============================================================================
--
-- 085's header proposed "backfill or delete any orphan rows FIRST, then ADD
-- CONSTRAINT". A migration cannot backfill an orphan — there is no account to
-- point it at — so that reduces to deleting rows, and CLAUDE.md §11 puts
-- anything that deletes data behind an explicit human yes.
--
-- So each key is added NOT VALID and then validated only if there is nothing to
-- object to. NOT VALID skips the one-off scan of rows that are ALREADY there; it
-- does not weaken the key in any other way:
--
--   * every INSERT and UPDATE from now on is checked, so (b) is closed outright;
--   * the referential action is installed either way, so deleting an account
--     cascades to EVERY child row including pre-existing ones, closing (a).
--
-- On any database with no orphans — every fresh one, and every one where the
-- banking tables were never written to by hand — the VALIDATE below runs and the
-- key ends up fully valid, which is the state the tests assert against. Where
-- orphans do exist the migration still applies, says how many it found and on
-- which table, and leaves the key NOT VALID for a human to resolve. A warning a
-- person reads beats rows a migration deleted quietly.
--
-- To finish the job after clearing orphans:
--   ALTER TABLE bank_transactions VALIDATE CONSTRAINT bank_transactions_account_fk;
--   ALTER TABLE recurring_bills   VALIDATE CONSTRAINT recurring_bills_account_fk;


DO $$
DECLARE
  orphans bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bank_transactions_account_fk'
  ) THEN
    ALTER TABLE bank_transactions
      ADD CONSTRAINT bank_transactions_account_fk
      FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id) ON DELETE CASCADE
      NOT VALID;

    SELECT count(*) INTO orphans
      FROM bank_transactions t
      LEFT JOIN bank_accounts a ON a.id = t.bank_account_id
     WHERE a.id IS NULL;

    IF orphans = 0 THEN
      ALTER TABLE bank_transactions VALIDATE CONSTRAINT bank_transactions_account_fk;
    ELSE
      RAISE WARNING
        'bank_transactions: % row(s) point at a bank_accounts row that does not exist. The foreign key is installed and enforces every new write and every account delete, but is left NOT VALID. Resolve those rows, then: ALTER TABLE bank_transactions VALIDATE CONSTRAINT bank_transactions_account_fk;',
        orphans;
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'recurring_bills_account_fk'
  ) THEN
    ALTER TABLE recurring_bills
      ADD CONSTRAINT recurring_bills_account_fk
      FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id) ON DELETE CASCADE
      NOT VALID;

    SELECT count(*) INTO orphans
      FROM recurring_bills b
      LEFT JOIN bank_accounts a ON a.id = b.bank_account_id
     WHERE a.id IS NULL;

    IF orphans = 0 THEN
      ALTER TABLE recurring_bills VALIDATE CONSTRAINT recurring_bills_account_fk;
    ELSE
      RAISE WARNING
        'recurring_bills: % row(s) point at a bank_accounts row that does not exist. The foreign key is installed and enforces every new write and every account delete, but is left NOT VALID. Resolve those rows, then: ALTER TABLE recurring_bills VALIDATE CONSTRAINT recurring_bills_account_fk;',
        orphans;
    END IF;
  END IF;
END $$;


-- The column comments on both tables still say there is no foreign key and that
-- the table it would point at does not exist. Both statements are now wrong in
-- the one place a reader is most likely to look, so they are corrected here
-- rather than left to contradict the schema.
COMMENT ON COLUMN bank_transactions.bank_account_id IS
  'The bank_accounts row this transaction moved through. FK with ON DELETE CASCADE (092): removing the account — including when a revoked bank login cascades it away — removes its transactions. Never NULL.';

COMMENT ON COLUMN recurring_bills.bank_account_id IS
  'The bank_accounts row these outflows belong to. FK with ON DELETE CASCADE (092): removing the account — including when a revoked bank login cascades it away — removes its detected bills. Never NULL.';
