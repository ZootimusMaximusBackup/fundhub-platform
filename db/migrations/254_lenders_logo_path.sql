-- 254_lenders_logo_path.sql — Static logo asset path on lender rows (not CSV).

ALTER TABLE lenders
  ADD COLUMN IF NOT EXISTS logo_path text;

COMMENT ON COLUMN lenders.logo_path IS
  'Public path to lender logo under /assets/lenders/, e.g. /assets/lenders/chase.png';
