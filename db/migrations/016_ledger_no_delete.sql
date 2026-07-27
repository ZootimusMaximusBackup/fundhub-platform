-- 016_ledger_no_delete.sql
--
-- Extends commission_ledger immutability to block DELETE.
--
-- 014 already blocks mutating paid/approved rows via BEFORE UPDATE.
-- Without a DELETE guard, a ledger row can be deleted, which frees its
-- idempotency key and allows the same commission to be written again on
-- event replay — double-pay. This migration closes that gap.
--
-- Added as a separate migration (not editing 014 in place) so that the
-- applied-migration history stays clean on databases that already ran 014.

CREATE OR REPLACE FUNCTION commission_ledger_no_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'commission_ledger %: rows are immutable and cannot be deleted — post a reversing row instead',
    OLD.id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_commission_ledger_no_delete ON commission_ledger;
CREATE TRIGGER trg_commission_ledger_no_delete
  BEFORE DELETE ON commission_ledger
  FOR EACH ROW EXECUTE FUNCTION commission_ledger_no_delete();
