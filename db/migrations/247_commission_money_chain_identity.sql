-- 247_commission_money_chain_identity.sql
--
-- COMPLIANCE REVIEW REQUIRED — payment rails and commission timing.
--
-- Supersedes the missing durable identity path documented beside migration 246.
-- Migration 246 is already applied and is not edited.

-- The payment link is the source of truth for a staff-declared sale motion and
-- product. Old links stay NULL: text, price, title, notes, and amount are not
-- safe backfill sources.
ALTER TABLE payment_links
  ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES products(id),
  ADD COLUMN IF NOT EXISTS sale_id uuid REFERENCES sales(id),
  ADD COLUMN IF NOT EXISTS sale_motion text,
  ADD COLUMN IF NOT EXISTS closer_staff_id uuid REFERENCES staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sales_manager_staff_id uuid REFERENCES staff(id) ON DELETE SET NULL;

ALTER TABLE payment_links DROP CONSTRAINT IF EXISTS payment_links_sale_motion_ck;
ALTER TABLE payment_links ADD CONSTRAINT payment_links_sale_motion_ck
  CHECK (sale_motion IS NULL OR sale_motion IN ('downsell', 'upsell'));

ALTER TABLE payment_links DROP CONSTRAINT IF EXISTS payment_links_motion_product_ck;
ALTER TABLE payment_links ADD CONSTRAINT payment_links_motion_product_ck
  CHECK (sale_motion IS NULL OR product_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS payment_links_sale_idx ON payment_links (sale_id)
  WHERE sale_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS payment_links_product_motion_idx
  ON payment_links (org_id, product_id, sale_motion);

-- A motion is part of a sale's identity. NULL is the historical/main-sale path.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS sale_motion text;
ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_sale_motion_ck;
ALTER TABLE sales ADD CONSTRAINT sales_sale_motion_ck
  CHECK (sale_motion IS NULL OR sale_motion IN ('downsell', 'upsell'));

CREATE INDEX IF NOT EXISTS sales_client_product_motion_idx
  ON sales (org_id, client_id, product_id, sale_motion, sold_at DESC);

-- Each receipt keeps the exact product and motion that were present when the
-- money arrived. Product can be backfilled safely from the receipt's sale.
ALTER TABLE sale_payments
  ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES products(id),
  ADD COLUMN IF NOT EXISTS payment_link_id uuid REFERENCES payment_links(id),
  ADD COLUMN IF NOT EXISTS sale_motion text;

UPDATE sale_payments sp
   SET product_id = s.product_id
  FROM sales s
 WHERE s.id = sp.sale_id
   AND sp.product_id IS NULL;

ALTER TABLE sale_payments ALTER COLUMN product_id SET NOT NULL;
ALTER TABLE sale_payments DROP CONSTRAINT IF EXISTS sale_payments_sale_motion_ck;
ALTER TABLE sale_payments ADD CONSTRAINT sale_payments_sale_motion_ck
  CHECK (sale_motion IS NULL OR sale_motion IN ('downsell', 'upsell'));

CREATE INDEX IF NOT EXISTS sale_payments_link_idx ON sale_payments (payment_link_id)
  WHERE payment_link_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS sale_payments_product_motion_idx
  ON sale_payments (org_id, product_id, sale_motion, paid_at);

ALTER TABLE commission_ledger
  ADD COLUMN IF NOT EXISTS sale_payment_id uuid REFERENCES sale_payments(id);
CREATE INDEX IF NOT EXISTS commission_ledger_sale_payment_idx
  ON commission_ledger (sale_payment_id)
  WHERE sale_payment_id IS NOT NULL;

-- Motion is a rule scope. NULL remains the general rule and a motion-specific
-- rule is more specific in application code.
ALTER TABLE commission_rules ADD COLUMN IF NOT EXISTS sale_motion text;
ALTER TABLE commission_rules DROP CONSTRAINT IF EXISTS commission_rules_sale_motion_ck;
ALTER TABLE commission_rules ADD CONSTRAINT commission_rules_sale_motion_ck
  CHECK (sale_motion IS NULL OR sale_motion IN ('downsell', 'upsell'));

-- paid_amount is one exact sale_payments.amount. It is never an agreed price,
-- requested link amount, title-derived amount, or cumulative cash total.
ALTER TABLE commission_rules DROP CONSTRAINT IF EXISTS commission_rules_amount_basis_check;
ALTER TABLE commission_rules ADD CONSTRAINT commission_rules_amount_basis_check
  CHECK (amount_basis IN (
    'sale_price', 'deposit_collected', 'cash_collected', 'paid_amount',
    'amount_funded', 'amount_approved', 'success_fee'
  ));

ALTER TABLE commission_rules DROP CONSTRAINT IF EXISTS commission_rules_basis_coherent;
ALTER TABLE commission_rules ADD CONSTRAINT commission_rules_basis_coherent CHECK (
  (basis = 'front_end' AND amount_basis IN (
    'sale_price', 'deposit_collected', 'cash_collected', 'paid_amount'
  ))
  OR
  (basis = 'back_end' AND amount_basis IN (
    'amount_funded', 'amount_approved', 'success_fee'
  ))
);

-- The old exclusion did not include motion, so a closer could not have separate
-- deposit/downsell/upsell rules. Rebuild it with the new durable scope.
ALTER TABLE commission_rules DROP CONSTRAINT IF EXISTS commission_rules_no_overlap;
ALTER TABLE commission_rules ADD CONSTRAINT commission_rules_no_overlap
  EXCLUDE USING gist (
    org_id WITH =,
    basis WITH =,
    (COALESCE(product_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
    (COALESCE(lower(role), '*')) WITH =,
    (COALESCE(staff_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
    (COALESCE(sale_motion, '*')) WITH =,
    tstzrange(effective_from, effective_to, '[)') WITH &&
  ) WHERE (active AND stacking = 'base');

CREATE INDEX IF NOT EXISTS commission_rules_motion_lookup_idx
  ON commission_rules (org_id, basis, sale_motion, effective_from DESC)
  WHERE active;

-- Closer, manager, and advisor compensation are separate role credits, not
-- slices of one shared 100%. Keep split protection inside each role.
CREATE OR REPLACE FUNCTION sale_attributions_check_split() RETURNS trigger AS $$
DECLARE total numeric(9,4);
BEGIN
  SELECT COALESCE(SUM(split_percent), 0) INTO total
    FROM sale_attributions
   WHERE sale_id = NEW.sale_id
     AND basis   = NEW.basis
     AND role    = NEW.role
     AND id     <> NEW.id;

  IF total + NEW.split_percent > 100.0001 THEN
    RAISE EXCEPTION
      'sale % %/% split would total %%% (max 100%%). Reduce an existing share first.',
      NEW.sale_id, NEW.basis, NEW.role, total + NEW.split_percent;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON COLUMN payment_links.sale_motion IS
  'Staff-declared downsell or upsell at link creation. NULL means no motion was recorded; never infer it.';
COMMENT ON COLUMN sale_payments.sale_motion IS
  'Frozen motion copied from the payment link for this exact receipt.';
COMMENT ON COLUMN commission_rules.sale_motion IS
  'Optional downsell/upsell rule scope. NULL is a general rule.';
