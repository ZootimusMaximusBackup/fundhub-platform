-- 259_contracts_staff_id.sql
-- Link employment (and other) contracts to a staff roster row so signed
-- agreements can be opened from Staff & Teams. Signed PDF/HTML already lives
-- in documents via contracts.signed_document_id; this column is the staff door.

ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS staff_id uuid REFERENCES staff(id);

CREATE INDEX IF NOT EXISTS idx_contracts_staff
  ON contracts (org_id, staff_id)
  WHERE staff_id IS NOT NULL;

COMMENT ON COLUMN contracts.staff_id IS
  'Optional staff member this contract is about (employment / hire agreements). Distinct from created_by / sent_by.';
