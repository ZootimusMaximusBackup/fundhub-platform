-- More no-delete triggers that block Demo Mode wipe as fundhub_app.
-- Complements 150_demo_wipe_allow.sql (invoices + contract_signers).

CREATE OR REPLACE FUNCTION invoices_no_delete() RETURNS trigger AS $$
BEGIN
  IF COALESCE(OLD.is_demo, false) THEN
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
       AND COALESCE(i.is_demo, false)
  ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION
    'invoice_payments %: payments are immutable — post a correction row instead', OLD.id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION contract_signers_no_delete() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM contracts c
     WHERE c.id = OLD.contract_id
       AND COALESCE(c.is_demo, false)
  ) OR EXISTS (
    SELECT 1 FROM clients cl
     WHERE cl.id = OLD.client_id
       AND COALESCE(cl.is_demo, false)
  ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION
    'contract_signers %: a signer is never deleted — void the contract instead', OLD.id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
