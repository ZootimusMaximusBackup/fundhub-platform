-- 260_affiliate_commission_rates_20260824.sql
--
-- OWNER-SET (Chris 2026-08-24, "make it up" / dictator go) — AF-04 schedule:
--   Tier 1 (direct)   15% of funding deposit collected, or repair enrollment fee
--   Tier 2 (downline)  5% of the same basis on downline outcomes
--
-- Accrual still only on qualified completed outcomes (economics.mjs):
--   funded engagement (card-stacking-dfy + funded round)
--   repair enrolment  (repair-bundle)
-- A deposit alone still does not convert; the rate applies when the outcome lands.
--
-- Percent units: 15 means 15%. Never UPDATE a live rate — close and open a new row.

DO $$
DECLARE
  v_start timestamptz := '2026-08-24T00:00:00Z';
  r RECORD;
  v_funding uuid;
  v_repair uuid;
BEGIN
  FOR r IN SELECT id AS org_id FROM orgs LOOP
    SELECT id INTO v_funding
      FROM products
     WHERE org_id = r.org_id AND code = 'card-stacking-dfy'
     LIMIT 1;
    SELECT id INTO v_repair
      FROM products
     WHERE org_id = r.org_id AND code = 'repair-bundle'
     LIMIT 1;

    -- Funding · direct · 15% of deposit collected
    IF v_funding IS NOT NULL THEN
      INSERT INTO affiliate_commission_rules (
        org_id, name, description, tier, product_id,
        calc_method, percent, amount_basis, scope_rule,
        effective_from, active, notes
      )
      SELECT r.org_id,
             'Affiliate — direct funding',
             'Owner-set Tier 1: 15% of funding deposit collected when the engagement funds.',
             'direct', v_funding,
             'percent', 15, 'deposit_collected', 'first_paid_product',
             v_start, true,
             'Owner-set 2026-08-24 AF-04. Tier1 15% / Tier2 5%.'
       WHERE NOT EXISTS (
         SELECT 1 FROM affiliate_commission_rules
          WHERE org_id = r.org_id
            AND tier = 'direct'
            AND product_id = v_funding
            AND affiliate_id IS NULL
            AND active
            AND effective_to IS NULL
            AND percent = 15
            AND amount_basis = 'deposit_collected'
       );

      INSERT INTO affiliate_commission_rules (
        org_id, name, description, tier, product_id,
        calc_method, percent, amount_basis, scope_rule,
        effective_from, active, notes
      )
      SELECT r.org_id,
             'Affiliate — downline funding',
             'Owner-set Tier 2: 5% override on downline funded engagements.',
             'downline', v_funding,
             'percent', 5, 'deposit_collected', 'first_paid_product',
             v_start, true,
             'Owner-set 2026-08-24 AF-04. Tier1 15% / Tier2 5%.'
       WHERE NOT EXISTS (
         SELECT 1 FROM affiliate_commission_rules
          WHERE org_id = r.org_id
            AND tier = 'downline'
            AND product_id = v_funding
            AND affiliate_id IS NULL
            AND active
            AND effective_to IS NULL
            AND percent = 5
            AND amount_basis = 'deposit_collected'
       );
    END IF;

    -- Repair · direct · 15% of enrollment fee (sale_price)
    IF v_repair IS NOT NULL THEN
      INSERT INTO affiliate_commission_rules (
        org_id, name, description, tier, product_id,
        calc_method, percent, amount_basis, scope_rule,
        effective_from, active, notes
      )
      SELECT r.org_id,
             'Affiliate — direct repair',
             'Owner-set Tier 1: 15% of repair enrollment fee.',
             'direct', v_repair,
             'percent', 15, 'sale_price', 'first_paid_product',
             v_start, true,
             'Owner-set 2026-08-24 AF-04. Tier1 15% / Tier2 5%.'
       WHERE NOT EXISTS (
         SELECT 1 FROM affiliate_commission_rules
          WHERE org_id = r.org_id
            AND tier = 'direct'
            AND product_id = v_repair
            AND affiliate_id IS NULL
            AND active
            AND effective_to IS NULL
            AND percent = 15
            AND amount_basis = 'sale_price'
       );

      INSERT INTO affiliate_commission_rules (
        org_id, name, description, tier, product_id,
        calc_method, percent, amount_basis, scope_rule,
        effective_from, active, notes
      )
      SELECT r.org_id,
             'Affiliate — downline repair',
             'Owner-set Tier 2: 5% override on downline repair enrollments.',
             'downline', v_repair,
             'percent', 5, 'sale_price', 'first_paid_product',
             v_start, true,
             'Owner-set 2026-08-24 AF-04. Tier1 15% / Tier2 5%.'
       WHERE NOT EXISTS (
         SELECT 1 FROM affiliate_commission_rules
          WHERE org_id = r.org_id
            AND tier = 'downline'
            AND product_id = v_repair
            AND affiliate_id IS NULL
            AND active
            AND effective_to IS NULL
            AND percent = 5
            AND amount_basis = 'sale_price'
       );
    END IF;
  END LOOP;
END $$;
