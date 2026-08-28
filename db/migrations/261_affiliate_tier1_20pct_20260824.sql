-- 261_affiliate_tier1_20pct_20260824.sql
--
-- OWNER-SET (Chris 2026-08-24): Tier 1 (direct referral) is 20%, not 15%.
-- Tier 2 (downline override) stays 5%.
-- Close live 15% direct rows, open 20% replacements. Never UPDATE the percent.

DO $$
DECLARE
  v_start timestamptz := '2026-08-24T17:00:00Z';
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

    IF v_funding IS NOT NULL THEN
      UPDATE affiliate_commission_rules
         SET effective_to = v_start,
             active = false,
             updated_at = now()
       WHERE org_id = r.org_id
         AND tier = 'direct'
         AND product_id = v_funding
         AND affiliate_id IS NULL
         AND active
         AND effective_to IS NULL
         AND percent = 15
         AND amount_basis = 'deposit_collected';

      INSERT INTO affiliate_commission_rules (
        org_id, name, description, tier, product_id,
        calc_method, percent, amount_basis, scope_rule,
        effective_from, active, notes
      )
      SELECT r.org_id,
             'Affiliate — direct funding',
             'Owner-set Tier 1: 20% of funding deposit collected when the engagement funds.',
             'direct', v_funding,
             'percent', 20, 'deposit_collected', 'first_paid_product',
             v_start, true,
             'Owner-set 2026-08-24 AF-04. Tier1 20% / Tier2 5%.'
       WHERE NOT EXISTS (
         SELECT 1 FROM affiliate_commission_rules
          WHERE org_id = r.org_id
            AND tier = 'direct'
            AND product_id = v_funding
            AND affiliate_id IS NULL
            AND active
            AND effective_to IS NULL
            AND percent = 20
            AND amount_basis = 'deposit_collected'
       );
    END IF;

    IF v_repair IS NOT NULL THEN
      UPDATE affiliate_commission_rules
         SET effective_to = v_start,
             active = false,
             updated_at = now()
       WHERE org_id = r.org_id
         AND tier = 'direct'
         AND product_id = v_repair
         AND affiliate_id IS NULL
         AND active
         AND effective_to IS NULL
         AND percent = 15
         AND amount_basis = 'sale_price';

      INSERT INTO affiliate_commission_rules (
        org_id, name, description, tier, product_id,
        calc_method, percent, amount_basis, scope_rule,
        effective_from, active, notes
      )
      SELECT r.org_id,
             'Affiliate — direct repair',
             'Owner-set Tier 1: 20% of repair enrollment fee.',
             'direct', v_repair,
             'percent', 20, 'sale_price', 'first_paid_product',
             v_start, true,
             'Owner-set 2026-08-24 AF-04. Tier1 20% / Tier2 5%.'
       WHERE NOT EXISTS (
         SELECT 1 FROM affiliate_commission_rules
          WHERE org_id = r.org_id
            AND tier = 'direct'
            AND product_id = v_repair
            AND affiliate_id IS NULL
            AND active
            AND effective_to IS NULL
            AND percent = 20
            AND amount_basis = 'sale_price'
       );
    END IF;

    -- Retag live Tier 2 rows so wipe/tests match the current owner note.
    UPDATE affiliate_commission_rules
       SET notes = 'Owner-set 2026-08-24 AF-04. Tier1 20% / Tier2 5%.',
           updated_at = now()
     WHERE org_id = r.org_id
       AND tier = 'downline'
       AND active
       AND effective_to IS NULL
       AND percent = 5
       AND notes LIKE 'Owner-set 2026-08-24 AF-04%';
  END LOOP;
END $$;
