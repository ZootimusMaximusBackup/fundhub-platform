// THE CALCULATOR. Given a sale or a funding event, what is owed and to whom.
//
// Pure functions. No database, no clock, no event bus, no writes. Everything —
// prices, rates, splits, dates — arrives as an argument, because every one of
// those is a row a person edits in the admin screen. There is not a single
// product name, dollar amount or percentage hard-coded in this file, and there
// must never be one.
//
// Output is an array of LEDGER DRAFTS: plain objects shaped like
// commission_ledger rows. Writing them is somebody else's job.
//
// The two kinds:
//   front_end — on the sale. Closer earns on deposit COLLECTED, money in the
//               door, not the agreed price at signature (CHRIS PROVISIONAL #4).
//   back_end  — on funding. Earned at round.funded, on THAT round's funded
//               amount, regardless of whether the success fee has been
//               collected yet — that is AR's problem, not the rep's
//               (CHRIS PROVISIONAL #2, #3).

import { toCents, fromCents, percentOf, applySplit, wholeUnits, clampAmount, roundHalfUp } from "./money.mjs";
import { selectRules } from "./rules.mjs";
import { computeTiered } from "./tiers.mjs";

export const FRONT_END = "front_end";
export const BACK_END = "back_end";

/** amount_basis values, split by which basis may use them. Mirrors the CHECK
 *  constraint in 013_commission_rules.sql — these are formulas, not config. */
export const AMOUNT_BASES = Object.freeze({
  [FRONT_END]: ["sale_price", "deposit_collected", "cash_collected"],
  [BACK_END]: ["amount_funded", "amount_approved", "success_fee"]
});

const iso = (v) => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());

/**
 * Derive every amount basis, in cents, from the raw records.
 *
 *   sale_price        — sales.agreed_price. The agreed number for THIS client.
 *   deposit_collected — sum of sale_payments where kind='deposit'
 *   cash_collected    — every payment less refunds
 *   amount_funded     — this round's funded_amount (per round, not lifetime)
 *   amount_approved   — this round's approved_amount
 *   success_fee       — this round's funded amount at the percent frozen on the
 *                       SALE, never the product's current default
 *
 * `payments` and `round` may be omitted; the bases they feed come back as 0.
 */
export function resolveAmounts({ sale = null, payments = [], round = null } = {}) {
  const deposits = payments
    .filter((p) => p.kind === "deposit")
    .reduce((a, p) => a + toCents(p.amount), 0);

  const cash = payments.reduce(
    (a, p) => a + (p.kind === "refund" ? -toCents(p.amount) : toCents(p.amount)),
    0
  );

  const funded = round ? toCents(round.funded_amount) : 0;
  const feePct = sale?.agreed_success_fee_percent;

  return {
    sale_price: sale ? toCents(sale.agreed_price) : 0,
    deposit_collected: deposits,
    cash_collected: cash,
    amount_funded: funded,
    amount_approved: round ? toCents(round.approved_amount) : 0,
    success_fee: feePct === null || feePct === undefined ? 0 : percentOf(funded, feePct)
  };
}

/**
 * Apply one rule to one base amount. Returns integer cents, before the split.
 * Guardrails (min_amount / max_amount) are applied last.
 */
export function computeRuleAmount(rule, baseCents) {
  let gross;

  switch (rule.calc_method) {
    case "percent":
      gross = percentOf(baseCents, rule.percent);
      break;

    case "flat":
      // Fires once, whole, whenever the base is non-zero. "$500 per $3K deposit"
      // is this: one deposit, one $500 (CHRIS PROVISIONAL #1). It does not scale
      // with the size of the deposit.
      gross = toCents(rule.flat_amount);
      break;

    case "flat_per_unit":
      // Kept for products that genuinely pay per increment. Partial units do not
      // pay: $5,999 against a $3,000 unit is one unit, not 1.99.
      gross = wholeUnits(baseCents, toCents(rule.per_unit_amount)) * toCents(rule.flat_amount);
      break;

    case "tiered":
      // Default marginal (CHRIS PROVISIONAL #6a): only the dollars above a
      // bracket pay the higher rate.
      gross = computeTiered(rule.tiers || [], baseCents, rule.tier_mode || "marginal");
      break;

    default:
      throw new Error(`computeRuleAmount: unknown calc_method: ${rule.calc_method}`);
  }

  return clampAmount(
    roundHalfUp(gross),
    rule.min_amount === null || rule.min_amount === undefined ? null : toCents(rule.min_amount),
    rule.max_amount === null || rule.max_amount === undefined ? null : toCents(rule.max_amount)
  );
}

/**
 * Deterministic idempotency key. A replayed round.funded regenerates the same
 * key, hits commission_ledger_idem_uniq, and nobody gets paid twice (Rule 9).
 *
 * Default granularity is ONE EARNING PER (event, basis, deal, person, rule) —
 * which is what "one deposit, one $500" needs. Pass `eventRef` (a payment id, a
 * transaction id) when a rule should be able to earn again on a later payment.
 */
export function idempotencyKey({ sourceEvent, basis, saleId, roundId, staffId, ruleId, eventRef }) {
  return [
    sourceEvent || "manual",
    basis,
    saleId || "-",
    roundId || "-",
    staffId,
    ruleId || "-",
    eventRef || "-"
  ].join("|");
}

/**
 * Compute every commission owed for one basis on one deal.
 *
 * input:
 *   org_id        required
 *   basis         'front_end' | 'back_end'
 *   sale          sales row
 *   product       products row (for the name snapshot)
 *   client        clients row (for the code snapshot)
 *   round         funding_rounds row — back end only
 *   payments      sale_payments rows — front end
 *   amounts       optional; overrides resolveAmounts()
 *   attributions  sale_attributions rows. Only the matching basis is used.
 *   rules         commission_rules rows, tiers attached as rule.tiers
 *   occurredAt    business time of the triggering event -> earned_at
 *   asOf          rule-version date. Defaults to the SALE date (CHRIS
 *                 PROVISIONAL #9): a deal sold in July pays July's rate even if
 *                 it funds in October. A raise must not retroactively reprice
 *                 deals people have already closed, and a rep has to be able to
 *                 predict their own commission at the moment they close.
 *                 Pass asOf = occurredAt for earned-date behaviour instead.
 *   sourceEvent   'deposit.paid' | 'round.funded' | ...
 *   eventRef      optional idempotency discriminator
 *
 * Returns { drafts, warnings, allocatedPercent, unallocatedPercent }.
 *
 * Warnings are returned, never thrown, and never silently absorbed. A missing
 * rate produces a warning and NO row — the system does not invent a default and
 * does not quietly pay zero. Somebody has to go fix the setup.
 */
export function computeCommission(input) {
  const {
    org_id,
    basis,
    sale = null,
    product = null,
    client = null,
    round = null,
    payments = [],
    attributions = [],
    rules = [],
    occurredAt,
    sourceEvent = null,
    eventRef = null
  } = input;

  if (!org_id) throw new TypeError("computeCommission: org_id is required");
  if (basis !== FRONT_END && basis !== BACK_END) {
    throw new TypeError(`computeCommission: basis must be ${FRONT_END} or ${BACK_END}, got ${basis}`);
  }
  if (!occurredAt) throw new TypeError("computeCommission: occurredAt is required");

  // Rate version is picked by the SALE date, not the earning date. Falls back to
  // occurredAt only when there is no sale to date it from (a manual adjustment).
  const asOf = input.asOf || sale?.sold_at || occurredAt;
  const amounts = input.amounts || resolveAmounts({ sale, payments, round });

  const drafts = [];
  const warnings = [];
  const mine = attributions.filter((a) => a.basis === basis);

  const allocatedPercent = mine.reduce((a, x) => a + Number(x.split_percent ?? 100), 0);
  if (mine.length > 0 && allocatedPercent < 99.9999) {
    warnings.push({
      code: "unallocated_split",
      message: `only ${allocatedPercent}% of ${basis} credit is attributed on this deal`,
      sale_id: sale?.id ?? null,
      basis
    });
  }
  if (mine.length === 0) {
    warnings.push({
      code: "no_attribution",
      message: `no ${basis} attribution on this deal — nobody is credited`,
      sale_id: sale?.id ?? null,
      basis
    });
  }

  for (const attribution of mine) {
    const ctx = {
      basis,
      product_id: sale?.product_id ?? product?.id ?? null,
      role: attribution.role,
      staff_id: attribution.staff_id
    };

    const { base, applied } = selectRules(rules, ctx, asOf);

    if (!base) {
      warnings.push({
        code: "no_base_rule",
        message: `no ${basis} rate configured for role ${attribution.role} on this product as of ${iso(asOf)}`,
        staff_id: attribution.staff_id,
        employee_code: attribution.employee_code ?? null,
        role: attribution.role,
        sale_id: sale?.id ?? null,
        basis
      });
    }

    for (const rule of applied) {
      if (!AMOUNT_BASES[basis].includes(rule.amount_basis)) {
        warnings.push({
          code: "incoherent_amount_basis",
          message: `rule "${rule.name}" is ${basis} but pays on ${rule.amount_basis}`,
          rule_id: rule.id,
          basis
        });
        continue;
      }

      const baseCents = amounts[rule.amount_basis];
      if (baseCents === undefined) {
        warnings.push({
          code: "unknown_amount_basis",
          message: `no value available for amount_basis ${rule.amount_basis}`,
          rule_id: rule.id,
          basis
        });
        continue;
      }

      // No base, no commission. A flat rule does not pay $500 on a deposit that
      // never arrived.
      if (baseCents === 0) {
        warnings.push({
          code: "zero_base",
          message: `rule "${rule.name}" pays on ${rule.amount_basis}, which is zero — no commission earned`,
          rule_id: rule.id,
          staff_id: attribution.staff_id,
          basis
        });
        continue;
      }

      const grossCents = computeRuleAmount(rule, baseCents);
      const split = Number(attribution.split_percent ?? 100);
      const amountCents = applySplit(grossCents, split);

      drafts.push({
        org_id,
        staff_id: attribution.staff_id,
        employee_code: attribution.employee_code ?? null,
        client_id: client?.id ?? sale?.client_id ?? null,
        client_code: client?.client_code ?? null,
        sale_id: sale?.id ?? null,
        funding_round_id: round?.id ?? null,
        product_id: ctx.product_id,
        product_name_at_earning: product?.name ?? null,
        basis,
        role: attribution.role,
        rule_id: rule.id,
        rule_snapshot: snapshotRule(rule),
        stacking: rule.stacking || "base",
        base_amount: fromCents(baseCents),
        split_percent: split,
        amount: fromCents(amountCents),
        amount_cents: amountCents,
        currency: sale?.currency || "USD",
        status: "earned",
        earned_at: iso(occurredAt),
        source_event: sourceEvent,
        idempotency_key: idempotencyKey({
          sourceEvent,
          basis,
          saleId: sale?.id,
          roundId: round?.id,
          staffId: attribution.staff_id,
          ruleId: rule.id,
          eventRef
        })
      });
    }
  }

  return {
    drafts,
    warnings,
    amounts,
    allocatedPercent,
    unallocatedPercent: mine.length === 0 ? 100 : Math.max(0, 100 - allocatedPercent)
  };
}

/** Front end. Convenience wrapper — the closer's side of the deal. */
export function computeFrontEnd(input) {
  return computeCommission({ ...input, basis: FRONT_END });
}

/**
 * Back end. Convenience wrapper — the advisor's side, earned at round.funded,
 * weeks or months after the sale, on attribution frozen at the sale.
 */
export function computeBackEnd(input) {
  if (!input.round) throw new TypeError("computeBackEnd: round is required");
  return computeCommission({ ...input, basis: BACK_END });
}

/**
 * The frozen copy of the rule that produced a ledger row. This is the answer to
 * "why is this number what it is" six months later, and it does not depend on
 * the rule row surviving unedited.
 */
export function snapshotRule(rule) {
  return {
    id: rule.id,
    name: rule.name,
    basis: rule.basis,
    stacking: rule.stacking || "base",
    calc_method: rule.calc_method,
    percent: rule.percent ?? null,
    flat_amount: rule.flat_amount ?? null,
    per_unit_amount: rule.per_unit_amount ?? null,
    tier_mode: rule.tier_mode ?? null,
    tiers: (rule.tiers || []).map((t) => ({
      min_amount: t.min_amount ?? null,
      max_amount: t.max_amount ?? null,
      percent: t.percent ?? null,
      flat_amount: t.flat_amount ?? null,
      per_unit_amount: t.per_unit_amount ?? null
    })),
    amount_basis: rule.amount_basis,
    min_amount: rule.min_amount ?? null,
    max_amount: rule.max_amount ?? null,
    product_id: rule.product_id ?? null,
    role: rule.role ?? null,
    staff_id: rule.staff_id ?? null,
    effective_from: rule.effective_from ?? null,
    effective_to: rule.effective_to ?? null
  };
}

/**
 * Clawback. Produces the negative row that reverses an existing ledger row.
 *
 * Full reversal by default (CHRIS PROVISIONAL #7). `portion` takes a fraction
 * for the partial case, because prorating is a case-by-case call a human makes
 * — but the default is the whole thing, and nothing is ever deleted or edited.
 *
 * A partial reversal needs an explicit `key`, since the default key identifies
 * "the reversal of row X" and there can only be one of those.
 */
export function reverseDraft(row, { reason, portion = 1, occurredAt = null, key = null } = {}) {
  if (!row?.id) throw new TypeError("reverseDraft: the row being reversed must have an id");
  if (!reason) throw new TypeError("reverseDraft: a reason is required");
  if (!(portion > 0 && portion <= 1)) throw new RangeError(`reverseDraft: portion out of range: ${portion}`);
  if (portion !== 1 && !key) {
    throw new TypeError("reverseDraft: a partial reversal needs an explicit idempotency key");
  }

  const originalCents = row.amount_cents ?? toCents(row.amount);
  const reversedCents = -roundHalfUp(originalCents * portion);

  return {
    org_id: row.org_id,
    staff_id: row.staff_id,
    employee_code: row.employee_code ?? null,
    client_id: row.client_id ?? null,
    client_code: row.client_code ?? null,
    sale_id: row.sale_id ?? null,
    funding_round_id: row.funding_round_id ?? null,
    product_id: row.product_id ?? null,
    product_name_at_earning: row.product_name_at_earning ?? null,
    basis: row.basis,
    role: row.role ?? null,
    rule_id: row.rule_id ?? null,
    rule_snapshot: row.rule_snapshot ?? {},
    stacking: row.stacking || "base",
    base_amount: row.base_amount ?? null,
    split_percent: row.split_percent ?? 100,
    amount: fromCents(reversedCents),
    amount_cents: reversedCents,
    currency: row.currency || "USD",
    status: "earned",
    earned_at: iso(occurredAt || row.earned_at),
    reverses_ledger_id: row.id,
    source_event: "reversal",
    notes: reason,
    idempotency_key: key || `reversal|${row.id}`
  };
}
