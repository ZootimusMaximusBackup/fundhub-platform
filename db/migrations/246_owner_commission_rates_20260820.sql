-- 246_owner_commission_rates_20260820.sql
--
-- OWNER-SET, effective 2026-08-20:
--   closer       16.67% of funding deposit collected
--   closer        0.25% of funded amount
--   sales_manager 5.00% of funding deposit collected
--   sales_manager 0.25% of funded amount
--
-- These are data rows, not calculator constants. Percent units follow the
-- commission schema: 0.25 means 0.25%.
--
-- The separate downsell/upsell formulas are owner-set but are not inserted here.
-- They stay pending until a durable sale_motion plus product identity source can
-- select the paid amount without guessing from labels, defaults, agreed amounts,
-- requested amounts, or ordinary cash collection.

DO $$
DECLARE
  v_start timestamptz := '2026-08-20T00:00:00Z';
  v_org uuid;
  v_product uuid;
BEGIN
  SELECT p.org_id, p.id
    INTO v_org, v_product
    FROM products p
    JOIN orgs o ON o.id = p.org_id AND o.is_default
   WHERE p.code = 'card-stacking-dfy'
   LIMIT 1;

  IF v_org IS NULL OR v_product IS NULL THEN
    RETURN;
  END IF;

  -- The old closer deposit rule is replaced, including any flat-$500 version.
  UPDATE commission_rules
     SET active = false,
         updated_at = now()
   WHERE org_id = v_org
     AND role = 'closer'
     AND basis = 'front_end'
     AND amount_basis = 'deposit_collected'
     AND effective_from = v_start
     AND effective_to IS NULL
     AND (calc_method <> 'percent' OR percent IS DISTINCT FROM 16.67);

  UPDATE commission_rules
     SET effective_to = v_start,
         updated_at = now()
   WHERE org_id = v_org
     AND role = 'closer'
     AND basis = 'front_end'
     AND amount_basis = 'deposit_collected'
     AND active
     AND effective_to IS NULL
     AND effective_from < v_start;

  INSERT INTO commission_rules (
    org_id, name, description, basis, stacking, product_id, role,
    calc_method, percent, amount_basis, effective_from, active, notes
  )
  SELECT v_org, 'Closer — funding deposit', 'Owner-set closer share of a collected funding deposit.',
         'front_end', 'base', v_product, 'closer',
         'percent', 16.67, 'deposit_collected', v_start, true,
         'Owner-set 2026-08-20. Replaces the flat $500 deposit rule.'
   WHERE NOT EXISTS (
     SELECT 1 FROM commission_rules
      WHERE org_id = v_org
        AND (product_id IS NULL OR product_id = v_product)
        AND role = 'closer'
        AND basis = 'front_end'
        AND amount_basis = 'deposit_collected'
        AND effective_from = v_start
        AND percent = 16.67
   );

  -- The remaining rates stay at their owner-set values. Keep a matching open
  -- row; close only a conflicting value before inserting the dated replacement.
  UPDATE commission_rules
     SET effective_to = v_start,
         updated_at = now()
   WHERE org_id = v_org
     AND role = 'sales_manager'
     AND basis = 'front_end'
     AND amount_basis = 'deposit_collected'
     AND active
     AND effective_to IS NULL
     AND effective_from < v_start
     AND percent IS DISTINCT FROM 5.00;

  INSERT INTO commission_rules (
    org_id, name, description, basis, stacking, product_id, role,
    calc_method, percent, amount_basis, effective_from, active, notes
  )
  SELECT v_org, 'Manager — funding deposit', 'Owner-set manager share of a collected funding deposit.',
         'front_end', 'base', v_product, 'sales_manager',
         'percent', 5.00, 'deposit_collected', v_start, true,
         'Owner-set 2026-08-20.'
   WHERE NOT EXISTS (
     SELECT 1 FROM commission_rules
      WHERE org_id = v_org
        AND (product_id IS NULL OR product_id = v_product)
        AND role = 'sales_manager'
        AND basis = 'front_end'
        AND amount_basis = 'deposit_collected'
        AND effective_to IS NULL
        AND percent = 5.00
   );

  INSERT INTO commission_rules (
    org_id, name, description, basis, stacking, product_id, role,
    calc_method, percent, amount_basis, effective_from, active, notes
  )
  SELECT v_org, 'Closer — funded amount', 'Owner-set closer share of funded amount.',
         'back_end', 'base', v_product, 'closer',
         'percent', 0.25, 'amount_funded', v_start, true,
         'Owner-set 2026-08-20.'
   WHERE NOT EXISTS (
     SELECT 1 FROM commission_rules
      WHERE org_id = v_org
        AND (product_id IS NULL OR product_id = v_product)
        AND role = 'closer'
        AND basis = 'back_end'
        AND amount_basis = 'amount_funded'
        AND effective_to IS NULL
        AND percent = 0.25
   );

  INSERT INTO commission_rules (
    org_id, name, description, basis, stacking, product_id, role,
    calc_method, percent, amount_basis, effective_from, active, notes
  )
  SELECT v_org, 'Manager — funded amount', 'Owner-set manager share of funded amount.',
         'back_end', 'base', v_product, 'sales_manager',
         'percent', 0.25, 'amount_funded', v_start, true,
         'Owner-set 2026-08-20.'
   WHERE NOT EXISTS (
     SELECT 1 FROM commission_rules
      WHERE org_id = v_org
        AND (product_id IS NULL OR product_id = v_product)
        AND role = 'sales_manager'
        AND basis = 'back_end'
        AND amount_basis = 'amount_funded'
        AND effective_to IS NULL
        AND percent = 0.25
   );
END $$;
