// Rule selection: which commission rule version applies, to whom, when.
//
// Pure. Rules arrive as plain rows (from commission_rules, tiers attached).
// Nothing here knows a rate, a product name or a dollar amount — every one of
// those is data passed in from the database.
//
// Two stacking modes, resolved differently on purpose:
//
//   base  — COMPETE. Exactly one wins, by scope specificity. This is the
//           person's commission for that basis.
//   bonus — STACK. Every match applies, on top of the base. This is where
//           Sarah's bonus structuring lives (spec §14).

/** Scope specificity weights. Chosen so the ordering is exactly:
 *
 *    staff-scoped rules beat every non-staff rule; within either group,
 *    motion beats product, product beats role, and each scope stacks.
 *
 *  i.e. a rule naming a person always beats a rule that does not, and within
 *  each level a product-specific rule beats a role-specific one.
 */
export const SCOPE_WEIGHT = Object.freeze({ staff: 8, motion: 4, product: 2, role: 1 });

const norm = (v) => (v === null || v === undefined ? null : String(v).toLowerCase());
const time = (v) => (v instanceof Date ? v.getTime() : new Date(v).getTime());

/** Integer specificity score for a rule's scope. Higher = more specific. */
export function ruleSpecificity(rule) {
  return (
    (rule.staff_id ? SCOPE_WEIGHT.staff : 0) +
    (rule.sale_motion ? SCOPE_WEIGHT.motion : 0) +
    (rule.product_id ? SCOPE_WEIGHT.product : 0) +
    (rule.role ? SCOPE_WEIGHT.role : 0)
  );
}

/**
 * Is this rule in force at `asOf`?
 * Window is [effective_from, effective_to) — half open, so closing one rate at
 * the same instant a new one opens leaves no gap and no overlap.
 */
export function isEffective(rule, asOf) {
  if (rule.active === false) return false;
  const t = time(asOf);
  if (!Number.isFinite(t)) throw new TypeError(`isEffective: bad asOf: ${asOf}`);
  if (rule.effective_from && t < time(rule.effective_from)) return false;
  if (rule.effective_to && t >= time(rule.effective_to)) return false;
  return true;
}

/**
 * Does the rule's scope cover this person on this deal?
 * A NULL scope column means "all", so it matches anything.
 * ctx: { product_id, sale_motion, role, staff_id }
 */
export function matchesScope(rule, ctx) {
  if (rule.product_id && norm(rule.product_id) !== norm(ctx.product_id)) return false;
  if (rule.sale_motion && norm(rule.sale_motion) !== norm(ctx.sale_motion)) return false;
  if (rule.role && norm(rule.role) !== norm(ctx.role)) return false;
  if (rule.staff_id && norm(rule.staff_id) !== norm(ctx.staff_id)) return false;
  return true;
}

/** Candidates for one (basis, stacking), scoped and in force, most specific first. */
export function candidateRules(rules, { basis, stacking }, ctx, asOf) {
  return rules
    .filter((r) => r.basis === basis)
    .filter((r) => (r.stacking || "base") === stacking)
    .filter((r) => matchesScope(r, ctx))
    .filter((r) => isEffective(r, asOf))
    .sort(compareRules);
}

/**
 * Ordering: specificity desc, then most recently effective, then id — so the
 * result is deterministic even if the data somehow contains a tie the
 * commission_rules_no_overlap exclusion constraint should have prevented.
 */
export function compareRules(a, b) {
  const s = ruleSpecificity(b) - ruleSpecificity(a);
  if (s !== 0) return s;
  const f = time(b.effective_from || 0) - time(a.effective_from || 0);
  if (f !== 0) return f;
  return String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0;
}

/**
 * The one base rule that applies. null if this person has no rate configured
 * for this basis — which the calculator reports as a warning rather than
 * inventing a default. A missing rate is a setup problem for a human to fix,
 * never a zero we quietly pay.
 */
export function selectBaseRule(rules, ctx, asOf) {
  return candidateRules(rules, { basis: ctx.basis, stacking: "base" }, ctx, asOf)[0] || null;
}

/** Every bonus rule that applies. All of them stack on top of the base. */
export function selectBonusRules(rules, ctx, asOf) {
  return candidateRules(rules, { basis: ctx.basis, stacking: "bonus" }, ctx, asOf);
}

/**
 * Both, in application order: base first, then bonuses.
 * Returns { base, bonuses, applied } where `applied` is the full list to compute.
 */
export function selectRules(rules, ctx, asOf) {
  const base = selectBaseRule(rules, ctx, asOf);
  const bonuses = selectBonusRules(rules, ctx, asOf);
  return { base, bonuses, applied: base ? [base, ...bonuses] : [...bonuses] };
}
