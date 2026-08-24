-- 256_owner_closer_deposit_one_sixth_20260823.sql
--
-- OWNER-SET, effective 2026-08-23:
--   closer deposit_collected = one sixth (percent 16.6667)
--
-- Does not edit 246. That file is already applied; editing it is a no-op.
-- 16.67% of $3,000 is $500.10. One sixth is $500.00.
-- percent 16.6667 through percentOf yields exactly 50000 cents on 300000 cents.
-- No fraction calc_method exists on commission_rules.

DO $$
DECLARE
  v_start timestamptz := '2026-08-23T00:00:00Z';
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

  -- Same-day rows that are not one sixth do not stay as the live closer deposit rule.
  UPDATE commission_rules
     SET active = false,
         updated_at = now()
   WHERE org_id = v_org
     AND role = 'closer'
     AND basis = 'front_end'
     AND amount_basis = 'deposit_collected'
     AND effective_from = v_start
     AND effective_to IS NULL
     AND (calc_method <> 'percent' OR percent IS DISTINCT FROM 16.6667);

  -- Close the 16.67% closer deposit rule, and any other still-open closer deposit
  -- rule from before today, without rewriting those rows' percents.
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
         'percent', 16.6667, 'deposit_collected', v_start, true,
         'Owner-set 2026-08-23. One sixth. Supersedes the 16.67% closer deposit rule from 246.'
   WHERE NOT EXISTS (
     SELECT 1 FROM commission_rules
      WHERE org_id = v_org
        AND (product_id IS NULL OR product_id = v_product)
        AND role = 'closer'
        AND basis = 'front_end'
        AND amount_basis = 'deposit_collected'
        AND effective_from = v_start
        AND percent = 16.6667
   );
END $$;
