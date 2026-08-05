-- Demo wipe deletes dependents by client_id. Allow that when the client is
-- is_demo, even if a child row missed its own is_demo flag.

CREATE OR REPLACE FUNCTION invoices_no_delete() RETURNS trigger AS $$
BEGIN
  IF COALESCE(OLD.is_demo, false)
     OR EXISTS (SELECT 1 FROM clients c WHERE c.id = OLD.client_id AND COALESCE(c.is_demo, false))
  THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION
    'invoices %: invoices are not deleted — void or write off instead', OLD.id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION invoice_payments_no_delete() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM invoices i
     WHERE i.id = OLD.invoice_id
       AND (
         COALESCE(i.is_demo, false)
         OR EXISTS (SELECT 1 FROM clients c WHERE c.id = i.client_id AND COALESCE(c.is_demo, false))
       )
  ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION
    'invoice_payments %: payments are immutable — post a correction row instead', OLD.id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION commission_ledger_no_delete() RETURNS trigger AS $$
BEGIN
  IF COALESCE(OLD.is_demo, false)
     OR EXISTS (SELECT 1 FROM clients c WHERE c.id = OLD.client_id AND COALESCE(c.is_demo, false))
  THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION
    'commission_ledger %: rows are immutable and cannot be deleted — post a reversing row instead',
    OLD.id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION entitlements_no_delete() RETURNS trigger AS $$
BEGIN
  IF COALESCE(OLD.is_demo, false)
     OR EXISTS (SELECT 1 FROM clients c WHERE c.id = OLD.client_id AND COALESCE(c.is_demo, false))
  THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION
    'entitlements rows are not deletable — set revoked_at instead (032_entitlements.sql)';
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION contracts_no_delete() RETURNS trigger AS $$
BEGIN
  IF COALESCE(OLD.is_demo, false)
     OR EXISTS (SELECT 1 FROM clients c WHERE c.id = OLD.client_id AND COALESCE(c.is_demo, false))
  THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION
    'contracts %: contracts are never deleted — void it instead', OLD.id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
