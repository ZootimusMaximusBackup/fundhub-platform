-- Demo Mode wipe must work as fundhub_app (no SUPERUSER, cannot ALTER TABLE
-- … DISABLE TRIGGER). Real rows stay undeletable; is_demo rows may be removed.

CREATE OR REPLACE FUNCTION commission_ledger_no_delete() RETURNS trigger AS $$
BEGIN
  IF COALESCE(OLD.is_demo, false) THEN
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
  IF COALESCE(OLD.is_demo, false) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION
    'entitlements rows are not deletable — set revoked_at instead (032_entitlements.sql)';
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION contracts_no_delete() RETURNS trigger AS $$
BEGIN
  IF COALESCE(OLD.is_demo, false) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION
    'contracts %: contracts are never deleted — void it instead', OLD.id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION contract_templates_no_delete() RETURNS trigger AS $$
BEGIN
  IF COALESCE(OLD.is_demo, false) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION
    'contract_templates %: templates are never deleted — set active = false instead',
    OLD.id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- affiliate_referrals has no is_demo column; allow wipe when the client is demo.
CREATE OR REPLACE FUNCTION affiliate_referrals_no_delete() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM clients c
     WHERE c.id = OLD.client_id
       AND COALESCE(c.is_demo, false)
  ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION
    'affiliate_referrals %: attribution rows are not deletable — set status = ''void'' with a reason',
    OLD.id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Documents are RESTRICT + no-delete. Demo wipe must remove them or clients stick.
CREATE OR REPLACE FUNCTION documents_no_delete() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM clients c
     WHERE c.id = OLD.client_id
       AND COALESCE(c.is_demo, false)
  ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION
    'documents %: documents are never deleted — register a superseding version instead',
    OLD.id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION document_versions_no_delete() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM documents d
      JOIN clients c ON c.id = d.client_id
     WHERE d.id = OLD.document_id
       AND COALESCE(c.is_demo, false)
  ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION
    'document_versions %: version history is append-only and cannot be deleted',
    OLD.id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
