-- 293_csm_collections_basis.sql — a third commission basis, so the CSM can be
-- paid for money recovered on a deal somebody else closed.
--
-- COMPLIANCE REVIEW REQUIRED: this is fee timing and staff compensation on
-- collected consumer money. It moves no money and sets no rate.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY A THIRD BASIS, WHEN THE UPSELL HALF NEEDS NOTHING AT ALL
--
-- The CSM (290) earns on two different things and only ONE of them is new:
--
--   UPSELL — the CSM sells Capital Blueprint on a check-in call. That is a
--     new sale, so it is front_end, and it already works: commission_rules
--     scopes on `role` (a staff_roles.key) and 013's first line is "every rate
--     is a row, there are no rates in code". A front_end rule with
--     role = 'csm' is a config row, not a migration. NOTHING IS ADDED HERE
--     FOR IT, deliberately — adding a basis for work an existing basis already
--     describes is how a money model grows two ways to say one thing.
--
--   COLLECTIONS — the CSM recovers a balance on a deal a CLOSER closed. That
--     fits neither basis. front_end is wrong twice over: it is not a sale, and
--     the closer has already earned front_end on that same deal, so paying it
--     again pays two people for one event. back_end is funding, which this is
--     not. Hence 'collections'.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- IT REUSES cash_collected AND INVENTS NO NEW FORMULA
--
-- 013 pairs each basis with the amount bases it may compute on. cash_collected
-- already exists and already means "every payment less refunds"
-- (src/commissions/calculate.mjs resolveAmounts). That is exactly the number a
-- collections commission is a percentage of, so collections pairs to it and
-- resolveAmounts is not touched. No new money math ships in this file.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- NO RATE IS SET HERE, AND THAT IS NOT A GAP
--
-- Chris confirmed on 2026-09-05 that the CSM is commissioned. He did not name
-- a number, and 013's design is that a number is a row with effective dates,
-- never a literal in code or in a migration. So this file opens the basis and
-- stops. Until an owner adds a commission_rules row scoped role='csm', a CSM
-- earns nothing and the calculator reports "no base rule for this basis" as a
-- warning — which is the model working, not failing.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THE JAVASCRIPT HALF MOVES IN THE SAME COMMIT
--
-- src/commissions/calculate.mjs holds FRONT_END / BACK_END, an AMOUNT_BASES
-- map whose comment says it "mirrors the CHECK constraint in
-- 013_commission_rules.sql", and a guard that THROWS on any other basis.
-- Widening the database without it means a stored collections rule the
-- calculator refuses to read. They are one unit.
--
-- DEPENDS ON: 012_attribution.sql, 013_commission_rules.sql, 290_csm_role.sql.

-- 1. Who may be credited. Without this a CSM cannot hold an attribution row on
--    the deal, and an uncredited person is never paid.
ALTER TABLE sale_attributions DROP CONSTRAINT IF EXISTS sale_attributions_basis_check;
ALTER TABLE sale_attributions
  ADD CONSTRAINT sale_attributions_basis_check
  CHECK (basis IN ('front_end', 'back_end', 'collections'));

-- 2. The rule's basis.
ALTER TABLE commission_rules DROP CONSTRAINT IF EXISTS commission_rules_basis_check;
ALTER TABLE commission_rules
  ADD CONSTRAINT commission_rules_basis_check
  CHECK (basis IN ('front_end', 'back_end', 'collections'));

-- 3. The basis/amount_basis pairing.
--
-- MEASURED, NOT RECONSTRUCTED. The first draft of this file rebuilt the rule
-- from 013's two arms and a scratch migration run rejected it: a seeded rule
-- pays front_end on `paid_amount`, an amount basis 013 never listed. 247
-- widened this constraint and kept its name, so the live shape is 247's, not
-- 013's, and the name is stable enough to drop by directly.
--
-- The lesson is the file, not the fix: read the constraint out of a live
-- database before re-adding it. A rebuilt CHECK that drops an arm somebody
-- else added is a silent unpaying of whoever was on it.
ALTER TABLE commission_rules DROP CONSTRAINT IF EXISTS commission_rules_basis_coherent;
ALTER TABLE commission_rules
  ADD CONSTRAINT commission_rules_basis_coherent CHECK (
    (basis = 'front_end'   AND amount_basis IN ('sale_price', 'deposit_collected',
                                                'cash_collected', 'paid_amount')) OR
    (basis = 'back_end'    AND amount_basis IN ('amount_funded', 'amount_approved',
                                                'success_fee'))                   OR
    (basis = 'collections' AND amount_basis IN ('cash_collected'))
  );

COMMENT ON CONSTRAINT commission_rules_basis_coherent ON commission_rules IS
  'Which amount a basis may be a percentage of. collections pairs only to cash_collected — money actually received, net of refunds — because a collections commission on an amount merely invoiced would pay for work not yet done. front_end and back_end arms are 247''s, unchanged. Extended with collections by 293_csm_collections_basis.sql.';
