-- 272_affiliate_success_fee_share_20260831.sql
--
-- OWNER-SET (Chris 2026-08-31, docs/specs/W0-decisions.md "Affiliates earn on the
-- back end"): an affiliate earns on the 10% success fee, not only on the deposit.
--
-- WHAT WAS TRUE UNTIL THIS FILE. 260/261 pay the funding schedule on
-- amount_basis = 'deposit_collected' — the $3,000 deposit, once. The success fee
-- that lands months later was worth nothing to the referrer.
--
-- WHAT IS TRUE AFTER IT. The same two rates — Tier 1 direct 20%, Tier 2 downline
-- 5% — apply to the PARTNER'S HALF of every non-refund payment on the funding
-- sale. The deposit and the success-fee balance are both in that number, so the
-- deposit is not double-counted and there is no special case anywhere:
--
--     $120,000 funded → 10% fee $12,000 collected ($3,000 deposit + $9,000 balance)
--       fundhub half              $6,000   ← never moves
--       partner half              $6,000
--         tier 1 affiliate  20%  -$1,200
--         tier 2 affiliate   5%    -$300
--       partner net               $4,500
--
-- WHY THE PARTNER'S HALF AND NOT THE WHOLE FEE. A sub-affiliate is paid out of
-- the partner's half (W0 "Sub-affiliates ... FundHub's 50% never moves"). Making
-- the partner's half the basis is what makes that structurally true rather than a
-- convention somebody has to remember: however many people sit under a partner,
-- fundhub's 50% is untouchable because it is not in the number the rate reads.
--
-- FOR A FUNDHUB-DIRECT CLIENT there is no partner half — fundhub owns the whole
-- of that cash and pays its own affiliate out of it — so the basis is the cash in
-- full. That is a real change for the direct book: the schedule used to pay on
-- the deposit alone and now pays on everything collected on the sale. It is the
-- same owner decision, applied to everyone.
--
-- REPAIR IS NOT TOUCHED. The repair rules still pay 20% / 5% of sale_price. The
-- success fee is a funding concept; changing repair was not asked for.
--
-- Percent units: 20 means 20%. Never UPDATE a live rate — close the row and open
-- a new one. That is what this file does, exactly as 261 did.

-- ---------------------------------------------------------------------------
-- A. The new basis value.
--
-- 033's note is explicit that amount_basis is a formula per value and that adding
-- one is a code change, not an admin edit. The code half is partnerShareOfCash()
-- in src/affiliates/economics.mjs; this is the database half.
--
-- The CHECK is found by its definition rather than by name, because 033 wrote it
-- inline and Postgres named it. Dropping and re-adding is idempotent: a re-run
-- drops the constraint this file added and puts the identical one back.
-- ---------------------------------------------------------------------------
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'affiliate_commission_rules'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%amount_basis%'
  LOOP
    EXECUTE format(
      'ALTER TABLE affiliate_commission_rules DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE affiliate_commission_rules
  ADD CONSTRAINT affiliate_commission_rules_amount_basis_ck
  CHECK (amount_basis IN (
    'sale_price',
    'deposit_collected',
    'cash_collected',
    'first_payment',
    'partner_share_of_cash'
  ));

COMMENT ON COLUMN affiliate_commission_rules.amount_basis IS
  'What the rate applies to. NOT admin-editable — each value is a formula '
  'basisFor() implements in src/affiliates/economics.mjs. '
  'sale_price · deposit_collected · cash_collected · first_payment · '
  'partner_share_of_cash (the partner''s revenue_share_pct of every non-refund '
  'payment on the sale; the whole of it when the client has no partner).';

-- ---------------------------------------------------------------------------
-- B. Close the live funding rows, open their replacements.
--
-- The two rows opened here carry effective_from = v_start and the rows they
-- replace are closed AT v_start, so the tstzrange windows abut and never overlap.
-- That matters: affiliate_commission_rules_no_overlap is an EXCLUDE constraint
-- over (org, tier, product, affiliate, window) WHERE active, and an overlap is a
-- hard failure rather than an ambiguity somebody discovers in a payout run.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_start timestamptz := '2026-08-31T00:00:00Z';
  v_note  text := 'Owner-set 2026-08-31 W0. Tier1 20% / Tier2 5% of the partner half, success fee included.';
  r RECORD;
  v_funding uuid;
BEGIN
  FOR r IN SELECT id AS org_id FROM orgs LOOP
    SELECT id INTO v_funding
      FROM products
     WHERE org_id = r.org_id AND code = 'card-stacking-dfy'
     LIMIT 1;

    CONTINUE WHEN v_funding IS NULL;

    -- Tier 1 direct: 20% of the deposit → 20% of the partner's half of all cash.
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
       AND amount_basis = 'deposit_collected';

    INSERT INTO affiliate_commission_rules (
      org_id, name, description, tier, product_id,
      calc_method, percent, amount_basis, scope_rule,
      effective_from, active, notes
    )
    SELECT r.org_id,
           'Affiliate — direct funding',
           'Owner-set Tier 1: 20% of the partner''s half of every non-refund payment on the funding sale — the deposit AND the 10% success fee.',
           'direct', v_funding,
           'percent', 20, 'partner_share_of_cash', 'first_paid_product',
           v_start, true,
           v_note
     WHERE NOT EXISTS (
       SELECT 1 FROM affiliate_commission_rules
        WHERE org_id = r.org_id
          AND tier = 'direct'
          AND product_id = v_funding
          AND affiliate_id IS NULL
          AND active
          AND effective_to IS NULL
          AND percent = 20
          AND amount_basis = 'partner_share_of_cash'
     );

    -- Tier 2 downline: 5% on the same basis.
    UPDATE affiliate_commission_rules
       SET effective_to = v_start,
           active = false,
           updated_at = now()
     WHERE org_id = r.org_id
       AND tier = 'downline'
       AND product_id = v_funding
       AND affiliate_id IS NULL
       AND active
       AND effective_to IS NULL
       AND amount_basis = 'deposit_collected';

    INSERT INTO affiliate_commission_rules (
      org_id, name, description, tier, product_id,
      calc_method, percent, amount_basis, scope_rule,
      effective_from, active, notes
    )
    SELECT r.org_id,
           'Affiliate — downline funding',
           'Owner-set Tier 2: 5% override on the partner''s half of every non-refund payment on the funding sale.',
           'downline', v_funding,
           'percent', 5, 'partner_share_of_cash', 'first_paid_product',
           v_start, true,
           v_note
     WHERE NOT EXISTS (
       SELECT 1 FROM affiliate_commission_rules
        WHERE org_id = r.org_id
          AND tier = 'downline'
          AND product_id = v_funding
          AND affiliate_id IS NULL
          AND active
          AND effective_to IS NULL
          AND percent = 5
          AND amount_basis = 'partner_share_of_cash'
     );
  END LOOP;
END $$;
