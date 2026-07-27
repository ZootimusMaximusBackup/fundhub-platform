import { test } from "node:test";
import assert from "node:assert";
import {
  resolveAmounts, computeRuleAmount, computeCommission, computeFrontEnd, computeBackEnd,
  reverseDraft, idempotencyKey, snapshotRule, FRONT_END, BACK_END
} from "./calculate.mjs";
import { toCents } from "./money.mjs";

// ---------------------------------------------------------------------------
// Fixtures. Every rate below is an arbitrary test number, not a Fundhub rate —
// the point of the model is that real rates are rows Chris edits, never code.
// ---------------------------------------------------------------------------
const ORG = "org-fundhub";
const CLOSER = "staff-closer";
const CLOSER_2 = "staff-closer-2";
const ADVISOR = "staff-advisor";
const PRODUCT_ID = "prod-card-stacking";

const SOLD_AT = "2026-07-01T12:00:00Z";
const FUNDED_AT = "2026-10-15T09:00:00Z";

const product = { id: PRODUCT_ID, name: "Card Stacking DFY" };
const client = { id: "client-1", client_code: "FH-000042" };

const sale = (over = {}) => ({
  id: "sale-1",
  org_id: ORG,
  client_id: client.id,
  product_id: PRODUCT_ID,
  agreed_price: "3000.00",
  agreed_success_fee_percent: "10.0000",
  currency: "USD",
  sold_at: SOLD_AT,
  status: "active",
  ...over
});

const round = (over = {}) => ({
  id: "round-1",
  funded_amount: "50000.00",
  approved_amount: "55000.00",
  ...over
});

const attribution = (over = {}) => ({
  staff_id: CLOSER,
  employee_code: "EMP-000001",
  role: "closer",
  basis: FRONT_END,
  split_percent: 100,
  ...over
});

const rule = (over = {}) => ({
  id: "rule-1",
  name: "fixture rule",
  basis: FRONT_END,
  stacking: "base",
  product_id: null,
  role: null,
  staff_id: null,
  calc_method: "flat",
  flat_amount: "500.00",
  amount_basis: "deposit_collected",
  effective_from: "2026-01-01T00:00:00Z",
  effective_to: null,
  active: true,
  tiers: [],
  ...over
});

const deposit = (amount = "3000.00") => ({ kind: "deposit", amount });

// ---------------------------------------------------------------------------
// resolveAmounts
// ---------------------------------------------------------------------------
test("resolveAmounts: deposit_collected is money in the door, not the agreed price", () => {
  const a = resolveAmounts({ sale: sale(), payments: [deposit("1500.00")] });
  assert.equal(a.sale_price, toCents(3000), "agreed price is still available");
  assert.equal(a.deposit_collected, toCents(1500), "but only $1,500 actually arrived");
});

test("resolveAmounts: multiple deposits accumulate", () => {
  const a = resolveAmounts({ sale: sale(), payments: [deposit("1500.00"), deposit("1500.00")] });
  assert.equal(a.deposit_collected, toCents(3000));
});

test("resolveAmounts: refunds subtract from cash_collected but not from deposits", () => {
  const a = resolveAmounts({
    sale: sale(),
    payments: [deposit("3000.00"), { kind: "refund", amount: "1000.00" }]
  });
  assert.equal(a.cash_collected, toCents(2000));
  assert.equal(a.deposit_collected, toCents(3000));
});

test("resolveAmounts: back end reads THIS round's funded amount, not a lifetime total", () => {
  const a = resolveAmounts({ sale: sale(), round: round({ funded_amount: "50000.00" }) });
  assert.equal(a.amount_funded, toCents(50000));
  assert.equal(a.amount_approved, toCents(55000));
});

test("resolveAmounts: success fee uses the percent frozen on the SALE", () => {
  const a = resolveAmounts({ sale: sale({ agreed_success_fee_percent: "10.0000" }), round: round() });
  assert.equal(a.success_fee, toCents(5000), "10% of $50,000 funded");
});

test("resolveAmounts: no success fee agreed means no success fee owed", () => {
  const a = resolveAmounts({ sale: sale({ agreed_success_fee_percent: null }), round: round() });
  assert.equal(a.success_fee, 0);
});

test("resolveAmounts: missing payments and round give zeroes, not crashes", () => {
  const a = resolveAmounts({ sale: sale() });
  assert.equal(a.deposit_collected, 0);
  assert.equal(a.amount_funded, 0);
});

// ---------------------------------------------------------------------------
// computeRuleAmount — the four methods
// ---------------------------------------------------------------------------
test("computeRuleAmount percent: 0.25% of funded", () => {
  const r = rule({ calc_method: "percent", percent: 0.25, flat_amount: null });
  assert.equal(computeRuleAmount(r, toCents(50000)), toCents(125));
});

test("computeRuleAmount flat: one deposit, one flat amount — it does not scale", () => {
  const r = rule({ calc_method: "flat", flat_amount: "500.00" });
  assert.equal(computeRuleAmount(r, toCents(3000)), toCents(500));
  assert.equal(computeRuleAmount(r, toCents(6000)), toCents(500), "a bigger deposit is still one flat");
});

test("computeRuleAmount flat_per_unit: pays per whole increment, partials do not count", () => {
  const r = rule({ calc_method: "flat_per_unit", flat_amount: "500.00", per_unit_amount: "3000.00" });
  assert.equal(computeRuleAmount(r, toCents(3000)), toCents(500));
  assert.equal(computeRuleAmount(r, toCents(6000)), toCents(1000));
  assert.equal(computeRuleAmount(r, toCents(5999)), toCents(500));
});

const LADDER = [
  { min_amount: 0, max_amount: 50000, percent: 0.25 },
  { min_amount: 50000, max_amount: null, percent: 0.5 }
];

test("computeRuleAmount tiered: reads the rule's brackets", () => {
  const r = rule({ calc_method: "tiered", flat_amount: null, tier_mode: "whole", tiers: LADDER });
  assert.equal(computeRuleAmount(r, toCents(60000)), toCents(300));
  assert.equal(computeRuleAmount(r, toCents(20000)), toCents(50));
});

test("computeRuleAmount tiered: a rule with no tier_mode set is marginal", () => {
  const r = rule({ calc_method: "tiered", flat_amount: null, tier_mode: null, tiers: LADDER });
  // 50,000 @ 0.25% = 125, plus the 10,000 above it @ 0.5% = 50. Only the
  // dollars above the bracket pay the higher rate.
  assert.equal(computeRuleAmount(r, toCents(60000)), toCents(175));
});

test("computeRuleAmount: min and max guardrails clamp the result", () => {
  const capped = rule({ calc_method: "percent", percent: 10, flat_amount: null, max_amount: "1000.00" });
  assert.equal(computeRuleAmount(capped, toCents(50000)), toCents(1000), "5000 capped to 1000");

  const floored = rule({ calc_method: "percent", percent: 1, flat_amount: null, min_amount: "100.00" });
  assert.equal(computeRuleAmount(floored, toCents(1000)), toCents(100), "10 floored to 100");
});

test("computeRuleAmount: an unknown method throws instead of paying zero", () => {
  assert.throws(() => computeRuleAmount(rule({ calc_method: "vibes" }), 1000), /unknown calc_method/);
});

// ---------------------------------------------------------------------------
// FRONT END — the closer
// ---------------------------------------------------------------------------
test("front end: closer earns the flat on the deposit collected", () => {
  const { drafts, warnings } = computeFrontEnd({
    org_id: ORG,
    sale: sale(), product, client,
    payments: [deposit("3000.00")],
    attributions: [attribution()],
    rules: [rule({ role: "closer" })],
    occurredAt: SOLD_AT,
    sourceEvent: "deposit.paid"
  });

  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].amount, "500.00");
  assert.equal(drafts[0].basis, FRONT_END);
  assert.equal(drafts[0].staff_id, CLOSER);
  assert.equal(drafts[0].base_amount, "3000.00");
  assert.equal(drafts[0].status, "earned");
  assert.deepEqual(warnings, []);
});

test("front end: no deposit means no commission, even on a flat rule", () => {
  const { drafts, warnings } = computeFrontEnd({
    org_id: ORG,
    sale: sale(), product, client,
    payments: [],                                  // nothing arrived
    attributions: [attribution()],
    rules: [rule({ role: "closer" })],
    occurredAt: SOLD_AT,
    sourceEvent: "sale.closed"
  });

  assert.equal(drafts.length, 0, "the flat $500 does not fire on a deposit that never landed");
  assert.equal(warnings.filter((w) => w.code === "zero_base").length, 1);
});

test("front end: the product name at the time of earning is snapshotted onto the row", () => {
  const { drafts } = computeFrontEnd({
    org_id: ORG,
    sale: sale(), product, client,
    payments: [deposit()],
    attributions: [attribution()],
    rules: [rule({ role: "closer" })],
    occurredAt: SOLD_AT
  });
  assert.equal(drafts[0].product_name_at_earning, "Card Stacking DFY");
  assert.equal(drafts[0].product_id, PRODUCT_ID, "and the record it points at, for the live name");
});

test("front end: client and employee codes are carried onto the ledger row", () => {
  const { drafts } = computeFrontEnd({
    org_id: ORG,
    sale: sale(), product, client,
    payments: [deposit()],
    attributions: [attribution()],
    rules: [rule({ role: "closer" })],
    occurredAt: SOLD_AT
  });
  assert.equal(drafts[0].client_code, "FH-000042");
  assert.equal(drafts[0].employee_code, "EMP-000001");
});

// ---------------------------------------------------------------------------
// BACK END — the advisor, months later
// ---------------------------------------------------------------------------
test("back end: advisor earns a percentage of THIS round's funded amount", () => {
  const { drafts } = computeBackEnd({
    org_id: ORG,
    sale: sale(), product, client,
    round: round({ funded_amount: "50000.00" }),
    attributions: [attribution({ staff_id: ADVISOR, role: "funding_advisor", basis: BACK_END })],
    rules: [rule({
      basis: BACK_END, role: "funding_advisor",
      calc_method: "percent", percent: 0.25, flat_amount: null,
      amount_basis: "amount_funded"
    })],
    occurredAt: FUNDED_AT,
    sourceEvent: "round.funded"
  });

  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].amount, "125.00");
  assert.equal(drafts[0].funding_round_id, "round-1");
  assert.equal(drafts[0].earned_at, new Date(FUNDED_AT).toISOString());
});

test("back end: pays on funding whether or not the success fee has been collected", () => {
  const input = {
    org_id: ORG,
    sale: sale(), product, client,
    round: round(),
    attributions: [attribution({ staff_id: ADVISOR, role: "funding_advisor", basis: BACK_END })],
    rules: [rule({
      basis: BACK_END, role: "funding_advisor",
      calc_method: "percent", percent: 0.25, flat_amount: null,
      amount_basis: "amount_funded"
    })],
    occurredAt: FUNDED_AT,
    sourceEvent: "round.funded"
  };

  const noFeePaid = computeBackEnd({ ...input, payments: [] });
  const feePaid = computeBackEnd({ ...input, payments: [{ kind: "success_fee", amount: "5000.00" }] });

  assert.equal(noFeePaid.drafts[0].amount, feePaid.drafts[0].amount,
    "collection is AR's problem, not the rep's");
});

test("back end: a rule can pay on the success fee itself", () => {
  const { drafts } = computeBackEnd({
    org_id: ORG,
    sale: sale({ agreed_success_fee_percent: "10.0000" }), product, client,
    round: round({ funded_amount: "50000.00" }),
    attributions: [attribution({ staff_id: ADVISOR, role: "funding_advisor", basis: BACK_END })],
    rules: [rule({
      basis: BACK_END, role: "funding_advisor",
      calc_method: "percent", percent: 20, flat_amount: null,
      amount_basis: "success_fee"
    })],
    occurredAt: FUNDED_AT
  });
  // success fee = 10% of 50,000 = 5,000. 20% of that = 1,000.
  assert.equal(drafts[0].base_amount, "5000.00");
  assert.equal(drafts[0].amount, "1000.00");
});

test("back end: computeBackEnd without a round is a programming error, not a zero", () => {
  assert.throws(() => computeBackEnd({ org_id: ORG, occurredAt: FUNDED_AT }), /round is required/);
});

// ---------------------------------------------------------------------------
// The whole point: role-based credit and split credit on one deal
// ---------------------------------------------------------------------------
test("closer takes the front end and advisor takes the back end on the same client", () => {
  const attributions = [
    attribution({ staff_id: CLOSER, role: "closer", basis: FRONT_END }),
    attribution({ staff_id: ADVISOR, role: "funding_advisor", basis: BACK_END, employee_code: "EMP-000002" })
  ];
  const rules = [
    rule({ id: "front", role: "closer", basis: FRONT_END, calc_method: "flat", flat_amount: "500.00",
           amount_basis: "deposit_collected" }),
    rule({ id: "back", role: "funding_advisor", basis: BACK_END, calc_method: "percent", percent: 0.25,
           flat_amount: null, amount_basis: "amount_funded" })
  ];

  const front = computeFrontEnd({
    org_id: ORG, sale: sale(), product, client, payments: [deposit()],
    attributions, rules, occurredAt: SOLD_AT, sourceEvent: "deposit.paid"
  });
  const back = computeBackEnd({
    org_id: ORG, sale: sale(), product, client, round: round(),
    attributions, rules, occurredAt: FUNDED_AT, sourceEvent: "round.funded"
  });

  assert.equal(front.drafts.length, 1);
  assert.equal(front.drafts[0].staff_id, CLOSER);
  assert.equal(front.drafts[0].amount, "500.00");

  assert.equal(back.drafts.length, 1);
  assert.equal(back.drafts[0].staff_id, ADVISOR);
  assert.equal(back.drafts[0].amount, "125.00");
});

test("split credit: two closers on one deal each get their share", () => {
  const { drafts, warnings } = computeFrontEnd({
    org_id: ORG, sale: sale(), product, client, payments: [deposit()],
    attributions: [
      attribution({ staff_id: CLOSER, split_percent: 60 }),
      attribution({ staff_id: CLOSER_2, split_percent: 40, employee_code: "EMP-000003" })
    ],
    rules: [rule({ role: "closer" })],
    occurredAt: SOLD_AT
  });

  assert.equal(drafts.length, 2);
  assert.equal(drafts.find((d) => d.staff_id === CLOSER).amount, "300.00");
  assert.equal(drafts.find((d) => d.staff_id === CLOSER_2).amount, "200.00");
  assert.equal(drafts.reduce((a, d) => a + d.amount_cents, 0), toCents(500), "the split is exact");
  assert.deepEqual(warnings, []);
});

test("a partly attributed deal pays only what is attributed and says so", () => {
  const { drafts, warnings, unallocatedPercent } = computeFrontEnd({
    org_id: ORG, sale: sale(), product, client, payments: [deposit()],
    attributions: [attribution({ split_percent: 50 })],
    rules: [rule({ role: "closer" })],
    occurredAt: SOLD_AT
  });

  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].amount, "250.00", "half, not inflated to cover the gap");
  assert.equal(unallocatedPercent, 50);
  assert.equal(warnings.filter((w) => w.code === "unallocated_split").length, 1);
});

test("nobody attributed: no rows, and a warning that says nobody is credited", () => {
  const { drafts, warnings } = computeFrontEnd({
    org_id: ORG, sale: sale(), product, client, payments: [deposit()],
    attributions: [], rules: [rule({ role: "closer" })], occurredAt: SOLD_AT
  });
  assert.equal(drafts.length, 0);
  assert.equal(warnings[0].code, "no_attribution");
});

// ---------------------------------------------------------------------------
// Attribution frozen at the sale, read months later
// ---------------------------------------------------------------------------
test("attribution survives the calendar: the July closer is still paid on the October funding", () => {
  // Attribution rows are exactly those written at the sale in July. Nothing about
  // who owns the client in October is passed in, because nothing about it matters.
  const julyAttributions = [
    attribution({ staff_id: CLOSER, role: "closer", basis: FRONT_END }),
    attribution({ staff_id: ADVISOR, role: "funding_advisor", basis: BACK_END })
  ];

  const { drafts } = computeBackEnd({
    org_id: ORG, sale: sale({ sold_at: SOLD_AT }), product, client,
    round: round(),
    attributions: julyAttributions,
    rules: [rule({ basis: BACK_END, role: "funding_advisor", calc_method: "percent", percent: 0.25,
                   flat_amount: null, amount_basis: "amount_funded" })],
    occurredAt: FUNDED_AT, sourceEvent: "round.funded"
  });

  assert.equal(drafts[0].staff_id, ADVISOR);
  assert.equal(drafts[0].sale_id, "sale-1", "the chain back to the original deal is on the row");
});

// ---------------------------------------------------------------------------
// Rate changes never rewrite history
// ---------------------------------------------------------------------------
const VERSIONED_RATES = () => [
  rule({ id: "v1", role: "closer", calc_method: "flat", flat_amount: "500.00",
         effective_from: "2026-01-01T00:00:00Z", effective_to: "2026-08-01T00:00:00Z" }),
  rule({ id: "v2", role: "closer", calc_method: "flat", flat_amount: "750.00",
         effective_from: "2026-08-01T00:00:00Z", effective_to: null })
];

test("a deal is paid at the rate in effect when it was SOLD, not when it was earned", () => {
  // Sold 1 July. Rate goes up 1 August. Funds 15 October.
  // The August raise must not reach backwards and reprice a deal already closed —
  // a rep has to be able to predict their commission at the moment they close.
  const { drafts } = computeBackEnd({
    org_id: ORG,
    sale: sale({ sold_at: "2026-07-01T00:00:00Z" }), product, client,
    round: round(),
    attributions: [attribution({ role: "funding_advisor", basis: BACK_END })],
    rules: [
      rule({ id: "v1", basis: BACK_END, role: "funding_advisor", calc_method: "percent",
             percent: 0.25, flat_amount: null, amount_basis: "amount_funded",
             effective_from: "2026-01-01T00:00:00Z", effective_to: "2026-08-01T00:00:00Z" }),
      rule({ id: "v2", basis: BACK_END, role: "funding_advisor", calc_method: "percent",
             percent: 0.5, flat_amount: null, amount_basis: "amount_funded",
             effective_from: "2026-08-01T00:00:00Z", effective_to: null })
    ],
    occurredAt: "2026-10-15T00:00:00Z",
    sourceEvent: "round.funded"
  });

  assert.equal(drafts[0].rule_id, "v1", "July's rate, applied to an October funding");
  assert.equal(drafts[0].amount, "125.00", "0.25% of 50,000 — not the August 0.5%");
});

test("a deal sold after the raise gets the new rate", () => {
  const { drafts } = computeFrontEnd({
    org_id: ORG, sale: sale({ sold_at: "2026-09-15T00:00:00Z" }), product, client,
    payments: [deposit()], attributions: [attribution()], rules: VERSIONED_RATES(),
    occurredAt: "2026-09-15T00:00:00Z"
  });
  assert.equal(drafts[0].rule_id, "v2");
  assert.equal(drafts[0].amount, "750.00");
});

test("the sale date drives the rate even when the earning date would pick differently", () => {
  const soldJuly = { sold_at: "2026-07-01T00:00:00Z" };
  const { drafts } = computeFrontEnd({
    org_id: ORG, sale: sale(soldJuly), product, client, payments: [deposit()],
    attributions: [attribution()], rules: VERSIONED_RATES(),
    occurredAt: "2026-09-15T00:00:00Z"   // earned in September, sold in July
  });
  assert.equal(drafts[0].rule_id, "v1", "sold date wins");
  assert.equal(drafts[0].earned_at, new Date("2026-09-15T00:00:00Z").toISOString(),
    "but earned_at is still the real business time of the event");
});

test("earned-date versioning is still available, by passing asOf explicitly", () => {
  const { drafts } = computeFrontEnd({
    org_id: ORG, sale: sale({ sold_at: "2026-07-01T00:00:00Z" }), product, client,
    payments: [deposit()], attributions: [attribution()], rules: VERSIONED_RATES(),
    occurredAt: "2026-09-15T00:00:00Z",
    asOf: "2026-09-15T00:00:00Z"          // opt in to the earned-date reading
  });
  assert.equal(drafts[0].rule_id, "v2");
});

test("with no sale to date from, versioning falls back to the earning date", () => {
  const { drafts } = computeCommission({
    org_id: ORG, basis: FRONT_END, product, client,
    amounts: { deposit_collected: toCents(3000) },
    attributions: [attribution()], rules: VERSIONED_RATES(),
    occurredAt: "2026-09-15T00:00:00Z"
  });
  assert.equal(drafts[0].rule_id, "v2");
});

test("the rule as applied is frozen onto the row, so the number stays explainable", () => {
  const r = rule({ role: "closer", calc_method: "flat", flat_amount: "500.00" });
  const { drafts } = computeFrontEnd({
    org_id: ORG, sale: sale(), product, client, payments: [deposit()],
    attributions: [attribution()], rules: [r], occurredAt: SOLD_AT
  });

  assert.equal(drafts[0].rule_snapshot.flat_amount, "500.00");
  assert.equal(drafts[0].rule_snapshot.calc_method, "flat");
  assert.equal(drafts[0].rule_snapshot.amount_basis, "deposit_collected");

  // Editing the live rule object afterwards cannot reach the snapshot.
  r.flat_amount = "9999.00";
  assert.equal(drafts[0].rule_snapshot.flat_amount, "500.00");
});

test("asOf overrides the sale date entirely, for a deliberate correction", () => {
  const { drafts } = computeFrontEnd({
    org_id: ORG, sale: sale({ sold_at: "2026-09-15T00:00:00Z" }), product, client,
    payments: [deposit()], attributions: [attribution()], rules: VERSIONED_RATES(),
    occurredAt: "2026-09-15T00:00:00Z",
    asOf: "2026-07-15T00:00:00Z"        // sold in September, honour the July rate
  });
  assert.equal(drafts[0].rule_id, "v1");
  assert.equal(drafts[0].amount, "500.00");
});

// ---------------------------------------------------------------------------
// Bonus stacking (Sarah's structuring)
// ---------------------------------------------------------------------------
test("bonus rules stack on top of the base rather than competing with it", () => {
  const { drafts } = computeFrontEnd({
    org_id: ORG, sale: sale(), product, client, payments: [deposit()],
    attributions: [attribution()],
    rules: [
      rule({ id: "base", role: "closer", calc_method: "flat", flat_amount: "500.00" }),
      rule({ id: "bonus", stacking: "bonus", role: "closer", calc_method: "percent",
             percent: 2, flat_amount: null, amount_basis: "deposit_collected" })
    ],
    occurredAt: SOLD_AT
  });

  assert.equal(drafts.length, 2, "a base row and a bonus row, both on the ledger");
  assert.equal(drafts.find((d) => d.stacking === "base").amount, "500.00");
  assert.equal(drafts.find((d) => d.stacking === "bonus").amount, "60.00");
  assert.equal(drafts.reduce((a, d) => a + d.amount_cents, 0), toCents(560));
});

test("a more specific base rule replaces the base but leaves bonuses stacking", () => {
  const { drafts } = computeFrontEnd({
    org_id: ORG, sale: sale(), product, client, payments: [deposit()],
    attributions: [attribution()],
    rules: [
      rule({ id: "base-role", role: "closer", flat_amount: "500.00" }),
      rule({ id: "base-person", staff_id: CLOSER, flat_amount: "800.00" }),
      rule({ id: "bonus", stacking: "bonus", role: "closer", calc_method: "percent",
             percent: 2, flat_amount: null, amount_basis: "deposit_collected" })
    ],
    occurredAt: SOLD_AT
  });

  const base = drafts.find((d) => d.stacking === "base");
  assert.equal(base.rule_id, "base-person", "the override wins the base slot");
  assert.equal(base.amount, "800.00");
  assert.ok(drafts.some((d) => d.stacking === "bonus"), "the bonus still applies on top");
});

test("splits apply to bonuses too", () => {
  const { drafts } = computeFrontEnd({
    org_id: ORG, sale: sale(), product, client, payments: [deposit()],
    attributions: [attribution({ split_percent: 50 })],
    rules: [
      rule({ id: "base", role: "closer", flat_amount: "500.00" }),
      rule({ id: "bonus", stacking: "bonus", role: "closer", calc_method: "percent",
             percent: 2, flat_amount: null, amount_basis: "deposit_collected" })
    ],
    occurredAt: SOLD_AT
  });
  assert.equal(drafts.find((d) => d.stacking === "base").amount, "250.00");
  assert.equal(drafts.find((d) => d.stacking === "bonus").amount, "30.00");
});

// ---------------------------------------------------------------------------
// Missing configuration is surfaced, never invented
// ---------------------------------------------------------------------------
test("no rate configured: no row, and a warning naming the role and the date", () => {
  const { drafts, warnings } = computeFrontEnd({
    org_id: ORG, sale: sale(), product, client, payments: [deposit()],
    attributions: [attribution({ role: "setter" })],
    rules: [rule({ role: "closer" })],
    occurredAt: SOLD_AT
  });

  assert.equal(drafts.length, 0, "nothing is paid on a guess");
  const w = warnings.find((x) => x.code === "no_base_rule");
  assert.ok(w);
  assert.match(w.message, /setter/);
});

test("a back end rule paying on a front end basis is rejected as incoherent", () => {
  const { drafts, warnings } = computeCommission({
    org_id: ORG, basis: BACK_END,
    sale: sale(), product, client, round: round(),
    attributions: [attribution({ basis: BACK_END, role: "funding_advisor" })],
    rules: [rule({ basis: BACK_END, role: "funding_advisor", amount_basis: "deposit_collected" })],
    occurredAt: FUNDED_AT
  });
  assert.equal(drafts.length, 0);
  assert.ok(warnings.some((w) => w.code === "incoherent_amount_basis"));
});

test("computeCommission validates its own inputs rather than producing nonsense", () => {
  assert.throws(() => computeCommission({ basis: FRONT_END, occurredAt: SOLD_AT }), /org_id is required/);
  assert.throws(() => computeCommission({ org_id: ORG, basis: "sideways", occurredAt: SOLD_AT }), /basis must be/);
  assert.throws(() => computeCommission({ org_id: ORG, basis: FRONT_END }), /occurredAt is required/);
});

// ---------------------------------------------------------------------------
// Idempotency — a replayed event must not pay twice
// ---------------------------------------------------------------------------
test("idempotency key is deterministic across identical computations", () => {
  const input = {
    org_id: ORG, sale: sale(), product, client, payments: [deposit()],
    attributions: [attribution()], rules: [rule({ role: "closer" })],
    occurredAt: SOLD_AT, sourceEvent: "deposit.paid"
  };
  assert.equal(computeFrontEnd(input).drafts[0].idempotency_key,
               computeFrontEnd(input).drafts[0].idempotency_key);
});

test("idempotency key separates people, rules, bases and rounds", () => {
  const k = (over) => idempotencyKey({
    basis: BACK_END, saleId: "sale-1",
    roundId: "round-1", staffId: ADVISOR, ruleId: "rule-1", ...over
  });
  const baseline = k({});
  assert.notEqual(baseline, k({ staffId: CLOSER }));
  assert.notEqual(baseline, k({ ruleId: "rule-2" }));
  assert.notEqual(baseline, k({ roundId: "round-2" }));
  assert.notEqual(baseline, k({ basis: FRONT_END }));
  assert.equal(baseline, k({}), "and stable for the same inputs");
});

test("different sourceEvents for the same commission produce the same idempotency key (no double-pay)", () => {
  // deposit.paid and payment.received for the same commission must dedup
  const base = {
    org_id: ORG, sale: sale(), product, client, payments: [deposit()],
    attributions: [attribution()], rules: [rule({ role: "closer" })]
  };
  const fromDeposit  = computeFrontEnd({ ...base, occurredAt: SOLD_AT, sourceEvent: "deposit.paid"     }).drafts[0];
  const fromPayment  = computeFrontEnd({ ...base, occurredAt: SOLD_AT, sourceEvent: "payment.received" }).drafts[0];
  assert.equal(fromDeposit.idempotency_key, fromPayment.idempotency_key,
    "same commission triggered by two different events must share the same key");
});

test("base and bonus on the same deal get distinct keys, so both can be written", () => {
  const { drafts } = computeFrontEnd({
    org_id: ORG, sale: sale(), product, client, payments: [deposit()],
    attributions: [attribution()],
    rules: [
      rule({ id: "base", role: "closer" }),
      rule({ id: "bonus", stacking: "bonus", role: "closer", calc_method: "percent",
             percent: 2, flat_amount: null, amount_basis: "deposit_collected" })
    ],
    occurredAt: SOLD_AT, sourceEvent: "deposit.paid"
  });
  assert.notEqual(drafts[0].idempotency_key, drafts[1].idempotency_key);
});

test("eventRef lets a rule earn again on a later payment when that is intended", () => {
  const input = {
    org_id: ORG, sale: sale(), product, client, payments: [deposit()],
    attributions: [attribution()], rules: [rule({ role: "closer" })],
    occurredAt: SOLD_AT, sourceEvent: "deposit.paid"
  };
  const first = computeFrontEnd({ ...input, eventRef: "pay-1" }).drafts[0];
  const second = computeFrontEnd({ ...input, eventRef: "pay-2" }).drafts[0];
  assert.notEqual(first.idempotency_key, second.idempotency_key);
});

// ---------------------------------------------------------------------------
// Clawback
// ---------------------------------------------------------------------------
const earned = () => ({
  id: "ledger-1", org_id: ORG, staff_id: CLOSER, employee_code: "EMP-000001",
  client_id: client.id, client_code: "FH-000042", sale_id: "sale-1",
  funding_round_id: null, product_id: PRODUCT_ID, product_name_at_earning: "Card Stacking DFY",
  basis: FRONT_END, role: "closer", rule_id: "rule-1", rule_snapshot: {}, stacking: "base",
  base_amount: "3000.00", split_percent: 100, amount: "500.00", amount_cents: toCents(500),
  currency: "USD", earned_at: SOLD_AT
});

test("clawback: a refund reverses in full, as a negative row that points at the original", () => {
  const rev = reverseDraft(earned(), { reason: "client refunded" });
  assert.equal(rev.amount, "-500.00");
  assert.equal(rev.reverses_ledger_id, "ledger-1");
  assert.equal(rev.source_event, "reversal");
  assert.equal(rev.notes, "client refunded");
  assert.equal(rev.staff_id, CLOSER);
});

test("clawback: original plus reversal nets to exactly zero", () => {
  const original = earned();
  const rev = reverseDraft(original, { reason: "refund" });
  assert.equal(original.amount_cents + rev.amount_cents, 0);
});

test("clawback: partial prorating is possible but never the default", () => {
  const rev = reverseDraft(earned(), { reason: "half refunded", portion: 0.5, key: "reversal|ledger-1|half" });
  assert.equal(rev.amount, "-250.00");
});

test("clawback: a partial reversal must carry its own key, since 'the reversal of X' is unique", () => {
  assert.throws(() => reverseDraft(earned(), { reason: "half", portion: 0.5 }), /explicit idempotency key/);
});

test("clawback: reason is mandatory — no unexplained money movement", () => {
  assert.throws(() => reverseDraft(earned(), {}), /reason is required/);
});

test("clawback: portion must be a real fraction", () => {
  assert.throws(() => reverseDraft(earned(), { reason: "x", portion: 0 }), RangeError);
  assert.throws(() => reverseDraft(earned(), { reason: "x", portion: 1.5 }), RangeError);
});

// ---------------------------------------------------------------------------
// Purity
// ---------------------------------------------------------------------------
test("the calculator mutates none of its inputs", () => {
  const s = sale();
  const rules = [rule({ role: "closer" })];
  const attributions = [attribution()];
  const payments = [deposit()];
  const before = JSON.stringify({ s, rules, attributions, payments });

  computeFrontEnd({ org_id: ORG, sale: s, product, client, payments, attributions, rules,
                    occurredAt: SOLD_AT });

  assert.equal(JSON.stringify({ s, rules, attributions, payments }), before);
});

test("the same inputs always produce the same output", () => {
  const input = {
    org_id: ORG, sale: sale(), product, client, payments: [deposit()],
    attributions: [attribution()], rules: [rule({ role: "closer" })],
    occurredAt: SOLD_AT, sourceEvent: "deposit.paid"
  };
  assert.deepEqual(computeFrontEnd(input).drafts, computeFrontEnd(input).drafts);
});

test("snapshotRule captures every field the number depends on", () => {
  const snap = snapshotRule(rule({ role: "closer" }));
  for (const k of ["calc_method", "percent", "flat_amount", "per_unit_amount",
                   "amount_basis", "min_amount", "max_amount", "effective_from", "effective_to"]) {
    assert.ok(k in snap, `snapshot is missing ${k}`);
  }
});
