// The billing cycle's arithmetic, and what migration 275 must still say.
//
// No database needed. The behaviour against a real Postgres — which is where
// the double-charge guarantee actually lives — is proved in
// billing-replay.pg.test.mjs. This file exists because that one skips without
// DATABASE_URL, and a guard that skips is not a guard (the argument
// src/security/superuser-guard.test.mjs makes in its own header).

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BILLING_INTERVALS, MAX_ATTEMPTS, RETRY_BACKOFF_MINUTES,
  advancePeriod, chargeIdempotencyKey, notBillableReason, planCharge,
  retryAt, classifyChargeResult
} from "./billing.mjs";
import {
  resolveCharger, registerCharger, registeredChargers, instrumentRefusal,
  BILLING_ENABLED_ENV
} from "./charger.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MIGRATION = path.join(ROOT, "db", "migrations", "275_subscription_billing.sql");
const sql = () => fs.readFileSync(MIGRATION, "utf8");

const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const PARTNER = "33333333-3333-4333-8333-333333333333";
const SUB = "44444444-4444-4444-8444-444444444444";
const CARD = "55555555-5555-4555-8555-555555555555";

/** A subscription that is billable, so each test can spoil exactly one thing. */
function billable(over = {}) {
  return {
    id: SUB, org_id: ORG, client_id: CLIENT, partner_id: null,
    tier: "creative-intelligence", status: "active",
    price_cents: "29700", currency: "USD", card_id: CARD, provider: "commas",
    current_period_start: "2026-07-15T00:00:00.000Z",
    current_period_end: "2026-08-15T00:00:00.000Z",
    next_charge_at: "2026-08-15T00:00:00.000Z",
    billing_interval: "monthly",
    cancelled_at: null,
    effective_from: "2026-06-15T00:00:00.000Z", effective_to: null,
    ...over
  };
}
const NOW = new Date("2026-08-15T09:00:00.000Z");

// ---------------------------------------------------------------------------
describe("migration 275 — the schedule and the ledger", () => {
  test("the file is still there", () => {
    assert.ok(fs.existsSync(MIGRATION),
      "db/migrations/275_subscription_billing.sql is gone — supersede it with a new numbered "
      + "migration rather than deleting it: db/migrate.mjs keys schema_migrations by "
      + "'<dir>/<file>', so editing or removing an applied file is a silent no-op.");
  });

  test("THE ANTI-DOUBLE-CHARGE INDEX IS STILL DECLARED", () => {
    const s = sql().replace(/\s+/g, " ");
    assert.match(s, /CREATE UNIQUE INDEX IF NOT EXISTS subscription_charges_period_uq ON subscription_charges \(subscription_id, period_start\)/,
      "UNIQUE (subscription_id, period_start) is the whole double-charge guarantee. Without it a "
      + "replayed billing sweep can take the same period's money twice.");
  });

  test("the ledger cannot record a charge for nothing, or a negative one", () => {
    assert.match(sql(), /amount_cents\s+bigint NOT NULL CHECK \(amount_cents > 0\)/);
  });

  test("a reversal is recorded and there is no clawback column", () => {
    const s = sql();
    assert.match(s, /reversed_at\s+timestamptz/, "a reversal must be recordable");
    // Comments stripped: the header says the word "clawback" in order to say
    // there is not one, and the check is about the SCHEMA, not the prose.
    const body = s.replace(/^\s*--.*$/gm, "");
    assert.doesNotMatch(body, /clawback|claw_back|recoup/i,
      "owner-set: a post-payment reversal is FundHub's loss and is never recovered — "
      + "there is no clawback anywhere in this product");
  });

  test("only a succeeded charge can carry a charged_at or a reversal", () => {
    const s = sql().replace(/\s+/g, " ");
    assert.match(s, /\(status = 'succeeded'\) = \(charged_at IS NOT NULL\)/);
    assert.match(s, /reversed_at IS NULL OR status = 'succeeded'/);
  });

  test("billing_interval is frozen once set, and next_charge_at is not", () => {
    const s = sql();
    assert.match(s, /billing_interval is immutable once set/,
      "moving a monthly plan to annual restates what somebody agreed to — it must close the "
      + "row and open a new one, like every other term");
    assert.doesNotMatch(s, /NEW\.next_charge_at IS DISTINCT FROM OLD\.next_charge_at/,
      "next_charge_at must move every period — freezing it would stop the cycle advancing");
  });

  test("the migration writes no backfill: nothing existing joins the rail by accident", () => {
    const body = sql().split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    assert.doesNotMatch(body, /\bUPDATE\s+subscriptions\b/i,
      "no existing subscription may be put on a billing schedule by a migration");
    assert.doesNotMatch(body, /next_charge_at\s+timestamptz\s+(NOT NULL|DEFAULT)/i,
      "next_charge_at must default to NULL — NULL means 'not on a schedule', not 'due at the epoch'");
  });

  test("the interval CHECK and BILLING_INTERVALS agree", () => {
    const s = sql().replace(/\s+/g, " ");
    const m = s.match(/billing_interval IN \(([^)]*)\)/);
    assert.ok(m, "the billing_interval CHECK is gone");
    const inSql = m[1].split(",").map((x) => x.trim().replace(/'/g, "")).sort();
    assert.deepEqual(inSql, [...BILLING_INTERVALS].sort(),
      "billing.mjs and the database must allow the same cadences, or one of them rejects a "
      + "row the other accepted");
  });
});

// ---------------------------------------------------------------------------
describe("advancePeriod — the end-of-month clamp", () => {
  test("a plain month", () => {
    assert.equal(advancePeriod("2026-08-15T00:00:00.000Z", "monthly").toISOString(),
      "2026-09-15T00:00:00.000Z");
  });

  test("31 January does NOT become 3 March", () => {
    // setUTCMonth would roll 31 Feb over into March and the anniversary would
    // drift a day or two every year, billing on a date nobody agreed to.
    assert.equal(advancePeriod("2026-01-31T12:00:00.000Z", "monthly").toISOString(),
      "2026-02-28T12:00:00.000Z");
  });

  test("a leap February takes the 29th", () => {
    assert.equal(advancePeriod("2028-01-31T00:00:00.000Z", "monthly").toISOString(),
      "2028-02-29T00:00:00.000Z");
  });

  test("the anniversary comes back after a clamp, given the true anchor", () => {
    // Feb 28 + 1 month, anchored on the 31st the customer actually signed on.
    assert.equal(advancePeriod("2026-02-28T00:00:00.000Z", "monthly", { anchorDay: 31 }).toISOString(),
      "2026-03-31T00:00:00.000Z");
  });

  test("December rolls the year", () => {
    assert.equal(advancePeriod("2026-12-15T00:00:00.000Z", "monthly").toISOString(),
      "2027-01-15T00:00:00.000Z");
  });

  test("annual, including 29 February", () => {
    assert.equal(advancePeriod("2026-08-15T00:00:00.000Z", "annual").toISOString(),
      "2027-08-15T00:00:00.000Z");
    assert.equal(advancePeriod("2028-02-29T00:00:00.000Z", "annual").toISOString(),
      "2029-02-28T00:00:00.000Z");
  });

  test("an interval nobody sells is refused, not guessed", () => {
    assert.throws(() => advancePeriod("2026-08-15T00:00:00.000Z", "weekly"), /interval must be one of/);
    assert.throws(() => advancePeriod("2026-08-15T00:00:00.000Z", null), /interval must be one of/);
  });
});

// ---------------------------------------------------------------------------
describe("chargeIdempotencyKey — the same period always makes the same key", () => {
  test("deterministic across calls and Date round-trips", () => {
    const a = chargeIdempotencyKey({ subscriptionId: SUB, periodStart: "2026-08-15T00:00:00.000Z" });
    const b = chargeIdempotencyKey({ subscriptionId: SUB, periodStart: new Date("2026-08-15T00:00:00.000Z") });
    assert.equal(a, b);
    assert.equal(a, `sub:${SUB}:period:2026-08-15T00:00:00Z`);
  });

  test("millisecond noise cannot mint a second key for one period", () => {
    assert.equal(
      chargeIdempotencyKey({ subscriptionId: SUB, periodStart: "2026-08-15T00:00:00.412Z" }),
      chargeIdempotencyKey({ subscriptionId: SUB, periodStart: "2026-08-15T00:00:00.000Z" })
    );
  });

  test("different periods and different subscriptions differ", () => {
    const base = chargeIdempotencyKey({ subscriptionId: SUB, periodStart: "2026-08-15T00:00:00Z" });
    assert.notEqual(base, chargeIdempotencyKey({ subscriptionId: SUB, periodStart: "2026-09-15T00:00:00Z" }));
    assert.notEqual(base, chargeIdempotencyKey({ subscriptionId: CARD, periodStart: "2026-08-15T00:00:00Z" }));
  });
});

// ---------------------------------------------------------------------------
describe("notBillableReason — fails closed and names the reason", () => {
  test("a healthy row is billable", () => {
    assert.equal(notBillableReason(billable(), { now: NOW }), null);
  });

  const cases = [
    ["no_subscription", null],
    ["closed", billable({ effective_to: "2026-08-01T00:00:00Z" })],
    ["cancelled", billable({ status: "cancelled", cancelled_at: "2026-08-01T00:00:00Z" })],
    ["no_single_owner", billable({ partner_id: PARTNER })],
    ["no_single_owner", billable({ client_id: null })],
    ["price_unknown", billable({ price_cents: null })],
    ["price_not_chargeable", billable({ price_cents: 0 })],
    ["no_billing_interval", billable({ billing_interval: null })],
    ["unknown_billing_interval", billable({ billing_interval: "weekly" })],
    ["not_scheduled", billable({ next_charge_at: null })],
    ["not_due", billable({ next_charge_at: "2026-09-15T00:00:00Z" })]
  ];
  for (const [reason, row] of cases) {
    test(`${reason}`, () => assert.equal(notBillableReason(row, { now: NOW }), reason));
  }

  test("A NULL PRICE IS NEVER A FREE CHARGE — it is unknown and it is refused", () => {
    // 075's rule. Defaulting it to 0 would create a subscription that reads as
    // free, which is a decision nobody made.
    assert.equal(notBillableReason(billable({ price_cents: null }), { now: NOW }), "price_unknown");
  });

  test("past_due is still billable — that is how a customer recovers", () => {
    assert.equal(notBillableReason(billable({ status: "past_due" }), { now: NOW }), null);
  });
});

// ---------------------------------------------------------------------------
describe("planCharge", () => {
  test("the period charged starts at next_charge_at", () => {
    const p = planCharge(billable(), { now: NOW });
    assert.equal(p.periodStart.toISOString(), "2026-08-15T00:00:00.000Z");
    assert.equal(p.periodEnd.toISOString(), "2026-09-15T00:00:00.000Z");
    assert.equal(p.amountCents, 29700);
    assert.equal(p.currency, "USD");
    assert.equal(p.idempotencyKey, `sub:${SUB}:period:2026-08-15T00:00:00Z`);
  });

  test("price_cents arrives from pg as a string and becomes integer cents", () => {
    // node-postgres returns bigint as a string; a float would be refused by
    // assertPriceCents, which is the point.
    const p = planCharge(billable({ price_cents: "249700" }), { now: NOW });
    assert.equal(p.amountCents, 249700);
    assert.equal(Number.isInteger(p.amountCents), true);
  });

  test("the anniversary is taken from the period start, so a clamp does not stick", () => {
    const p = planCharge(billable({
      current_period_start: "2026-01-31T00:00:00Z",
      next_charge_at: "2026-02-28T00:00:00Z"
    }), { now: new Date("2026-02-28T06:00:00Z") });
    assert.equal(p.periodEnd.toISOString(), "2026-03-31T00:00:00.000Z");
  });

  test("it refuses a row it should not charge instead of charging it", () => {
    assert.throws(() => planCharge(billable({ price_cents: null }), { now: NOW }), /price_unknown/);
    assert.throws(() => planCharge(billable({ next_charge_at: "2027-01-01T00:00:00Z" }), { now: NOW }), /not_due/);
  });
});

// ---------------------------------------------------------------------------
describe("retryAt — bounded", () => {
  const from = new Date("2026-08-15T09:00:00.000Z");

  test("the backoff grows", () => {
    assert.equal(retryAt(1, from).toISOString(), "2026-08-15T09:15:00.000Z");
    assert.equal(retryAt(2, from).toISOString(), "2026-08-15T13:00:00.000Z");
    assert.equal(retryAt(3, from).toISOString(), "2026-08-16T09:00:00.000Z");
  });

  test("THERE IS NO RETRY AFTER THE CEILING", () => {
    assert.equal(retryAt(MAX_ATTEMPTS, from), null);
    assert.equal(retryAt(MAX_ATTEMPTS + 5, from), null);
  });

  test("the backoff table is never indexed past its end", () => {
    assert.ok(RETRY_BACKOFF_MINUTES.length >= 1);
    const wide = retryAt(RETRY_BACKOFF_MINUTES.length + 1, from, { maxAttempts: 99 });
    assert.ok(wide instanceof Date && !Number.isNaN(wide.getTime()));
  });

  test("a nonsense attempt number is refused", () => {
    assert.throws(() => retryAt(0, from), /positive integer/);
  });
});

// ---------------------------------------------------------------------------
describe("classifyChargeResult — who gets blamed", () => {
  const now = new Date("2026-08-15T09:00:00.000Z");

  test("ok true advances the cycle and blames nobody", () => {
    const v = classifyChargeResult({ ok: true, providerRef: "pay_1" }, { attempt: 1, now });
    assert.equal(v.outcome, "succeeded");
    assert.equal(v.providerRef, "pay_1");
    assert.equal(v.pastDue, false);
  });

  test("A SHAPE WE DO NOT UNDERSTAND IS OUR FAULT, NOT THE CUSTOMER'S", () => {
    for (const bad of [null, undefined, {}, "nope", { ok: false }]) {
      const v = classifyChargeResult(bad, { attempt: 1, now });
      assert.equal(v.outcome, "retry", `${JSON.stringify(bad)} should not be read as a decline`);
      assert.equal(v.pastDue, false, "nothing about the customer changed");
      assert.ok(v.retryAt instanceof Date);
    }
  });

  test("retryable:false is the only way to say declined, and it goes past_due at once", () => {
    const v = classifyChargeResult({ ok: false, retryable: false, code: "card_declined", reason: "no funds" },
      { attempt: 1, now });
    assert.equal(v.outcome, "declined");
    assert.equal(v.pastDue, true);
    assert.equal(v.abandoned, false, "a decline still gets its remaining attempts — cards get fixed");
    assert.ok(v.retryAt instanceof Date);
  });

  test("the last attempt abandons, whatever the error was, and goes past_due", () => {
    const v = classifyChargeResult({ ok: false, reason: "timeout" }, { attempt: MAX_ATTEMPTS, now });
    assert.equal(v.abandoned, true);
    assert.equal(v.retryAt, null, "nothing may pick an abandoned period up again");
    assert.equal(v.pastDue, true, "spent retries is itself a reason to stop calling the plan paid");
  });

  test("failure text is bounded so a provider cannot write a novel into the ledger", () => {
    const v = classifyChargeResult({ ok: false, reason: "x".repeat(5000), code: "y".repeat(500) }, { attempt: 1, now });
    assert.ok(v.failureReason.length <= 300);
    assert.ok(v.failureCode.length <= 60);
  });
});

// ---------------------------------------------------------------------------
describe("the processor seam — empty, and locked twice", () => {
  test("NO CHARGER SHIPS REGISTERED", () => {
    assert.deepEqual(registeredChargers(), [],
      "Commas exposes no confirmed merchant-initiated charge endpoint. A charger here would be "
      + "a guessed API moving real money.");
  });

  test("the module contains no outbound call of its own", () => {
    const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "charger.mjs"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(code, /\bfetch\s*\(/,
      "outbound transmission belongs behind a provider module (CLAUDE.md §12), never here");
  });

  test("with the flag off, nothing resolves even if a charger exists", () => {
    const undo = registerCharger("commas", async () => ({ ok: true }));
    try {
      const off = resolveCharger({ provider: "commas", env: {} });
      assert.equal(off.ok, false);
      assert.equal(off.code, "billing_disabled");
      // Surrounding whitespace is trimmed — an env var pasted with a trailing
      // space is the same intent. Everything else means off.
      for (const v of ["1", "yes", "TRUE", "on", "enabled", ""]) {
        assert.equal(resolveCharger({ provider: "commas", env: { [BILLING_ENABLED_ENV]: v } }).ok, false,
          `"${v}" must not switch live billing on — only the exact string "true" does`);
      }
      assert.equal(resolveCharger({ provider: "commas", env: { [BILLING_ENABLED_ENV]: "true" } }).ok, true);
    } finally {
      undo();
    }
    assert.deepEqual(registeredChargers(), [], "the test charger leaked into the registry");
  });

  test("with the flag on and nothing registered, it still refuses and says why", () => {
    const r = resolveCharger({ provider: "commas", env: { [BILLING_ENABLED_ENV]: "true" } });
    assert.equal(r.ok, false);
    assert.equal(r.code, "no_charger");
    assert.match(r.reason, /no confirmed/);
  });
});

// ---------------------------------------------------------------------------
describe("instrumentRefusal — a partner has no card, and that is a skip", () => {
  test("a client with a card on file has an instrument", () => {
    assert.equal(instrumentRefusal(billable()), null);
  });

  test("a client with no card is refused", () => {
    assert.equal(instrumentRefusal(billable({ card_id: null })), "no_card_on_file");
  });

  test("EVERY PARTNER ROW IS REFUSED — 271 forbids a card on one", () => {
    // subscriptions_partner_card_chk: partner_id IS NULL OR card_id IS NULL.
    // There is no partner instrument table in this repository, so this is the
    // honest state and it must never become a decline.
    assert.equal(instrumentRefusal(billable({ client_id: null, partner_id: PARTNER, card_id: null })),
      "no_partner_instrument");
  });
});
