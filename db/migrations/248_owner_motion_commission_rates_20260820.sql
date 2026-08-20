-- 248_owner_motion_commission_rates_20260820.sql
--
-- COMPLIANCE REVIEW REQUIRED — commission timing on paid transactions.
--
-- OWNER-SET, effective 2026-08-20:
--   closer        20% of each downsell paid amount
--   closer        20% of each upsell paid amount
--   sales_manager  5% of each downsell paid amount
--
-- There is deliberately no sales-manager upsell rule.
-- Migration 247 supplies the durable motion, product, and exact-payment path.

DO $$
DECLARE
  v_start timestamptz := '2026-08-20T00:00:00Z';
  v_org uuid;
  v record;
BEGIN
  SELECT id INTO v_org FROM orgs WHERE is_default LIMIT 1;
  IF v_org IS NULL THEN
    RETURN;
  END IF;

  FOR v IN
    SELECT *
      FROM (VALUES
        ('Closer — downsell paid', 'closer', 'downsell', 20.00::numeric,
         'Owner-set closer share of each exact downsell payment.'),
        ('Closer — upsell paid', 'closer', 'upsell', 20.00::numeric,
         'Owner-set closer share of each exact upsell payment.'),
        ('Manager — downsell paid', 'sales_manager', 'downsell', 5.00::numeric,
         'Owner-set sales-manager share of each exact downsell payment.')
      ) AS x(name, role, sale_motion, percent, description)
  LOOP
    -- Close an older live version at the owner-set boundary. Never update its
    -- percentage, and never touch commission_ledger history.
    UPDATE commission_rules
       SET effective_to = v_start,
           updated_at = now()
     WHERE org_id = v_org
       AND role = v.role
       AND basis = 'front_end'
       AND sale_motion = v.sale_motion
       AND amount_basis = 'paid_amount'
       AND active
       AND effective_to IS NULL
       AND effective_from < v_start;

    INSERT INTO commission_rules (
      org_id, name, description, basis, stacking, product_id, role,
      calc_method, percent, amount_basis, sale_motion,
      effective_from, active, notes
    )
    SELECT
      v_org, v.name, v.description, 'front_end', 'base', NULL, v.role,
      'percent', v.percent, 'paid_amount', v.sale_motion,
      v_start, true, 'Owner-set 2026-08-20. Exact paid transaction only.'
    WHERE NOT EXISTS (
      SELECT 1
        FROM commission_rules r
       WHERE r.org_id = v_org
         AND r.product_id IS NULL
         AND r.role = v.role
         AND r.basis = 'front_end'
         AND r.sale_motion = v.sale_motion
         AND r.amount_basis = 'paid_amount'
         AND r.effective_from = v_start
         AND r.effective_to IS NULL
         AND r.calc_method = 'percent'
         AND r.percent = v.percent
         AND r.active
    );
  END LOOP;
END $$;
