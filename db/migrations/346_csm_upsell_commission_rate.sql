-- 346_csm_upsell_commission_rate.sql — the CSM earns 10% of cash collected on
-- what they sell. OWNER-SET 2026-09-05.
--
-- COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7) — staff compensation on collected
-- consumer money. This file moves no money and charges nothing; it stores a
-- rate the calculator reads.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT CHRIS DECIDED, AND WHAT HE DECIDED AGAINST
--
-- 10%, ON UPSELLS. Not on collections, not on retention, not on testimonials.
-- That last part is the whole design and it is deliberate: 293 opened a
-- `collections` basis and it is being left EMPTY. A CSM paid to collect leans
-- on a client in the middle of a conversation that is supposed to be about how
-- the client is doing; a CSM paid on the next sale is motivated to make this
-- one work first. The basis stays available if he ever changes his mind.
--
-- The number is his. It also happens to be the only commission figure
-- traceable to Cole Gordon himself (a placed closer: $13,000 cash collected,
-- $1,300 paid = 10.00%), and his published CSM guidance ties the commission
-- component to upsells only. Recorded because it is corroboration, not because
-- it is the authority — the decision is Chris's.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY THIS IS ROLE-SCOPED AND NOT MOTION-SCOPED, WHICH LOOKS WRONG AT FIRST
--
-- 247 added `sale_motion IN ('downsell','upsell')` and rules may scope to it,
-- which is the obvious home for "10% on upsells". It cannot be used here:
-- 247's own CHECK is `sale_motion IS NULL OR product_id IS NOT NULL`, so a
-- motion rule must also name ONE product. "10% on upsells" is not per-product,
-- and picking a product list would mean deciding which of Capital Blueprint,
-- Capital Academy, Decline Autopsy and the rest count as an upsell. Chris did
-- not say, so it is not guessed (CLAUDE.md §2).
--
-- Role scope reaches the same place by a different road: a CSM is only ever
-- attributed on a sale they made, closers own new business, so in practice
-- every front_end row a CSM holds IS an upsell. If Chris later names the
-- products, per-product motion rules are additive — they score higher on
-- specificity (motion 4 + product 2 beats role 1, src/commissions/rules.mjs)
-- and would simply win over this one. Nothing here has to be undone.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- CASH COLLECTED, NOT CONTRACT VALUE
--
-- Paying on money actually received, net of refunds. A percentage of an amount
-- somebody agreed to but has not paid pays for work that has not finished.
--
-- Percent units follow the schema: 10 means 10%, the same way 246 writes 16.67.
--
-- DEPENDS ON: 013_commission_rules.sql, 246 (the shape), 290_csm_role.sql.

DO $$
DECLARE
  v_start timestamptz := '2026-09-05T00:00:00Z';
  v_org   uuid;
BEGIN
  SELECT id INTO v_org FROM orgs WHERE is_default LIMIT 1;
  IF v_org IS NULL THEN RETURN; END IF;

  INSERT INTO commission_rules (
    org_id, name, description, basis, stacking, product_id, role,
    calc_method, percent, amount_basis, effective_from, active, notes
  )
  SELECT v_org,
         'CSM — upsell',
         'Owner-set CSM share of cash collected on a sale the CSM made.',
         'front_end', 'base', NULL, 'csm',
         'percent', 10, 'cash_collected', v_start, true,
         'Owner-set 2026-09-05. 10% on upsells only — the collections basis (293) is deliberately left with no rule, so a CSM is never paid to lean on a client about money. Role-scoped rather than motion-scoped because 247 requires a motion rule to name one product and no upsell product list was given.'
   WHERE NOT EXISTS (
     SELECT 1 FROM commission_rules
      WHERE org_id = v_org
        AND role = 'csm'
        AND basis = 'front_end'
        AND amount_basis = 'cash_collected'
        AND effective_from = v_start
        AND percent = 10
   );
END $$;
