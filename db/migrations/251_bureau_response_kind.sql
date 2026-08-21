-- 251_bureau_response_kind.sql — portal upload doors stamp kind at the door.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT con.conname FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
     WHERE rel.relname = 'documents' AND con.contype = 'c'
       AND pg_get_constraintdef(con.oid) ILIKE '%kind%IN%'
  LOOP
    EXECUTE format('ALTER TABLE documents DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'documents_kind_check') THEN
    ALTER TABLE documents ADD CONSTRAINT documents_kind_check
      CHECK (kind IN (
        'authorization','contract','invoice_document','deliverable',
        'client_upload','bureau_response','inquiry_doc'
      ));
  END IF;
END $$;
