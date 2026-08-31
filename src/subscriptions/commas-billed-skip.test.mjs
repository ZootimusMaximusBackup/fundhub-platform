// DOUBLE-BILLING A PARTNER IS THE WORST THING THIS CODEBASE CAN DO.
//
// Commas bills a `type: "subscription"` checkout on its own cadence: they hold
// the card, they run the retries, they charge every frequency_days. Our own
// recurring rail — listDueSubscriptions → claimCharge → a processor call —
// exists to charge cards on a cycle. If both ever ran on one arrangement, the
// customer pays twice a month for one $47 subscription and the second charge is
// invisible on our side until they dispute it.
//
// So a mirrored row carries `provider = 'commas_subscription'` and FOUR
// INDEPENDENT LOCKS refuse it. This file proves each one alone, and then proves
// the whole sweeper: given a Commas-billed row that is due, past its date,
// priced, scheduled, with a card and with a working charger registered and
// billing switched ON, nothing is called and nothing is written.
//
// NO DATABASE. Every lock here is either a pure function or a statement whose
// text this file reads, so it runs in every CI pass rather than only the ones
// with DATABASE_URL set (CLAUDE.md §12, trap 2).

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  notBillableReason, planCharge, isProcessorBilled, isProcessorBilledProvider,
  addDays, advancePeriod,
  PROCESSOR_BILLED_PROVIDER, PROCESSOR_BILLED_PROVIDERS, COMMAS_FREQUENCY_DAYS
} from "./billing.mjs";
import {
  listDueSubscriptions, claimCharge, scheduleBilling,
  recordProcessorCharge, markProcessorPastDue
} from "./billing-store.mjs";
import { instrumentRefusal, registerCharger, BILLING_ENABLED_ENV } from "./charger.mjs";
import { sweep } from "../workflows/subscription-billing-sweeper.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const PARTNER = "33333333-3333-4333-8333-333333333333";
const SUB = "44444444-4444-4444-8444-444444444444";
const CARD = "55555555-5555-4555-8555-555555555555";
const NOW = new Date("2026-09-15T09:00:00Z");

/** A row that is due, priced, scheduled and carded — billable in every respect
 *  except the one that matters. `provider` is the only field the tests move. */
function row(over = {}) {
  return {
    id: SUB, org_id: ORG, client_id: CLIENT, partner_id: null,
    tier: "winners-board", status: "active",
    price_cents: "4700", currency: "USD", card_id: CARD,
    provider: PROCESSOR_BILLED_PROVIDER, provider_ref: null,
    current_period_start: "2026-08-15T00:00:00Z",
    current_period_end: "2026-09-14T00:00:00Z",
    next_charge_at: "2026-09-14T00:00:00Z",
    billing_interval: "monthly",
    cancelled_at: null, effective_from: "2026-08-15T00:00:00Z", effective_to: null,
    ...over
  };
}

/** Records every statement; answers from a script. Not a Postgres emulator. */
function fakeDb(script = {}) {
  const sql = [];
  return {
    sql,
    inserts: () => sql.filter((q) => /INSERT INTO subscription_charges/i.test(q.text)),
    async query(text, params) {
      const t = String(text).replace(/\s+/g, " ").trim();
      sql.push({ text: t, params });
      /* ORDER MATTERS: the mirror statement CONTAINS an INSERT INTO
         subscription_charges, so it has to be recognised before the claim. */
      if (/^WITH sub AS/i.test(t)) return { rows: script.mirror ?? [] };
      if (/FROM subscriptions WHERE effective_to IS NULL/i.test(t)) return { rows: script.due ?? [] };
      if (/^SELECT .* FROM subscriptions WHERE id =/i.test(t)) return { rows: script.one ?? [] };
      if (/INSERT INTO subscription_charges/i.test(t)) return { rows: script.insert ?? [] };
      if (/^UPDATE subscriptions/i.test(t)) return { rows: script.updated ?? [] };
      return { rows: script.rows ?? [] };
    }
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE ONE THAT MATTERS
   ═════════════════════════════════════════════════════════════════════════ */

describe("the sweeper sees a Commas-billed row and calls nothing", () => {
  test("charger registered, billing ON, row due — no call, no ledger row", async () => {
    let calls = 0;
    const undo = registerCharger("commas_subscription", async () => {
      calls += 1;
      return { ok: true, providerRef: "must-never-happen" };
    });
    const undoPlain = registerCharger("commas", async () => {
      calls += 1;
      return { ok: true, providerRef: "must-never-happen" };
    });

    try {
      /* The db hands the sweeper the row even though the real SQL filters it
         out. That is deliberate: this proves the skip survives the read
         predicate being wrong, deleted or drifting. */
      const db = fakeDb({ due: [row()] });
      const tally = await sweep(db, { env: { [BILLING_ENABLED_ENV]: "true" }, now: NOW });

      assert.equal(calls, 0, "COMMAS ALREADY CHARGED THIS CARD — we must never charge it again");
      assert.equal(tally.charged, 0);
      assert.equal(tally.amountCents, 0);
      assert.equal(db.inserts().length, 0,
        "a subscription_charges row means 'we tried to move money', and we did not try");
      assert.equal(tally.considered, 1, "the row WAS seen — this is a refusal, not an empty read");

      const only = tally.results[0];
      assert.ok(/billed_by_processor/.test(JSON.stringify(only)),
        `the skip must name itself, not be silent — got ${JSON.stringify(only)}`);
    } finally {
      undo();
      undoPlain();
    }
  });

  test("the same row on the plain rail IS charged — the marker is what stops it", async () => {
    let calls = 0;
    const undo = registerCharger("commas", async () => {
      calls += 1;
      return { ok: true, providerRef: "pay_1" };
    });
    try {
      const db = fakeDb({
        due: [row({ provider: "commas" })],
        insert: [{ id: "chg_1", attempt: 1, status: "in_flight" }],
        rows: [{ id: "chg_1", advanced_rows: "1" }]
      });
      const tally = await sweep(db, { env: { [BILLING_ENABLED_ENV]: "true" }, now: NOW });
      assert.equal(calls, 1, "a normal subscription must still bill — this guard is narrow, not a freeze");
      assert.equal(tally.charged, 1);
    } finally {
      undo();
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   THE FOUR LOCKS, EACH ON ITS OWN
   ═════════════════════════════════════════════════════════════════════════ */

describe("lock 1 — the sweeper's read never returns one", () => {
  test("listDueSubscriptions excludes every processor-billed provider", async () => {
    const db = fakeDb({ due: [] });
    await listDueSubscriptions(db, { now: NOW });
    const q = db.sql[0];
    assert.match(q.text, /lower\(btrim\(provider\)\) <> ALL\(\$3::text\[\]\)/,
      "the predicate must be in the SQL, not only in JavaScript");
    assert.deepEqual(q.params[2], [...PROCESSOR_BILLED_PROVIDERS]);
    assert.ok(q.params[2].includes(PROCESSOR_BILLED_PROVIDER));
  });
});

describe("lock 2 — the pure billability rule", () => {
  test("notBillableReason names it, and names it FIRST", () => {
    assert.equal(notBillableReason(row(), { now: NOW }), "billed_by_processor");

    /* It must not be overturned by any later condition changing. A row that is
       cancelled, closed, unpriced and unscheduled is still Commas'. */
    for (const over of [
      { cancelled_at: "2026-09-01T00:00:00Z", status: "cancelled" },
      { effective_to: "2026-09-01T00:00:00Z" },
      { price_cents: null },
      { next_charge_at: null, billing_interval: null },
      { status: "past_due" }
    ]) {
      assert.equal(notBillableReason(row(over), { now: NOW }), "billed_by_processor",
        `"${JSON.stringify(over)}" must not change whose rail this is`);
    }
  });

  test("the marker is compared the way 271 compares a tier", () => {
    assert.equal(isProcessorBilledProvider(" Commas_Subscription "), true);
    assert.equal(isProcessorBilledProvider("commas"), false);
    assert.equal(isProcessorBilledProvider(null), false);
    assert.equal(isProcessorBilled(row()), true);
    assert.equal(isProcessorBilled(row({ provider: "commas" })), false);
    assert.equal(isProcessorBilled(null), false);
  });

  test("planCharge refuses to plan one at all", () => {
    assert.throws(() => planCharge(row(), { now: NOW }), /billed_by_processor/);
  });

  test("a plain commas row is untouched by any of it", () => {
    assert.equal(notBillableReason(row({ provider: "commas" }), { now: NOW }), null);
    const plan = planCharge(row({ provider: "commas" }), { now: NOW });
    assert.equal(plan.amountCents, 4700);
  });
});

describe("lock 3 — the ledger claim, which is the only door to a processor", () => {
  test("claimCharge refuses without writing anything at all", async () => {
    const db = fakeDb();
    const out = await claimCharge(db, {
      orgId: ORG, subscriptionId: SUB, idempotencyKey: "k",
      periodStart: NOW, periodEnd: addDays(NOW, 30),
      amountCents: 4700, provider: PROCESSOR_BILLED_PROVIDER
    });
    assert.equal(out.claimed, false);
    assert.equal(out.reason, "billed_by_processor");
    assert.equal(out.charge, null);
    assert.equal(db.sql.length, 0, "no statement — not even the attempt row");
  });
});

describe("lock 4 — the instrument check", () => {
  test("instrumentRefusal says whose card it is, not that we lack one", () => {
    assert.equal(instrumentRefusal(row()), "billed_by_processor");
    /* 'no_card_on_file' would read as a gap somebody should close by attaching
       a card. There is no gap. */
    assert.equal(instrumentRefusal(row({ card_id: null })), "billed_by_processor");
    assert.equal(instrumentRefusal(row({ partner_id: PARTNER, client_id: null, card_id: null })),
      "billed_by_processor");
    assert.equal(instrumentRefusal(row({ provider: "commas", card_id: null })), "no_card_on_file");
  });
});

describe("and it can never join the rail in the first place", () => {
  test("scheduleBilling refuses to give one a next_charge_at", async () => {
    const db = fakeDb({ one: [row({ next_charge_at: null, billing_interval: null })] });
    await assert.rejects(
      () => scheduleBilling(db, {
        orgId: ORG, subscriptionId: SUB, interval: "monthly", firstChargeAt: NOW
      }),
      /billed_by_processor/
    );
    assert.equal(db.sql.filter((q) => /^UPDATE subscriptions/i.test(q.text)).length, 0,
      "nothing was written");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   THE MIRROR — recording money Commas already took
   ═════════════════════════════════════════════════════════════════════════ */

describe("recordProcessorCharge writes down a charge and makes none", () => {
  test("a renewal with no processor reference is refused, not anchored on a guess", async () => {
    const db = fakeDb();
    const out = await recordProcessorCharge(db, {
      orgId: ORG, subscriptionId: SUB,
      periodStart: NOW, periodEnd: addDays(NOW, 30), amountCents: 4700
    });
    assert.equal(out.recorded, false);
    assert.equal(out.reason, "no_provider_ref");
    assert.equal(db.sql.length, 0);
  });

  test("the row it writes is already succeeded, and it is anchored on the payment id", async () => {
    const db = fakeDb({
      mirror: [{ id: "chg_9", status: "succeeded", recorded: true, outcome: "recorded", advanced_rows: "1" }]
    });
    const out = await recordProcessorCharge(db, {
      orgId: ORG, subscriptionId: SUB,
      periodStart: NOW, periodEnd: addDays(NOW, 30),
      amountCents: 4700, providerRef: "pay_abc"
    });
    assert.equal(out.recorded, true);
    assert.equal(out.advanced, true);

    const q = db.sql[0];
    assert.match(q.text, /'succeeded'/, "the money already moved; there is no in_flight state to be in");
    assert.doesNotMatch(q.text, /'in_flight'/, "an in_flight row would be a claim, and we claim nothing");
    assert.match(q.text, /ON CONFLICT \(subscription_id, period_start\) DO NOTHING/,
      "276's unique index is what adjudicates two deliveries racing on one period");
    assert.match(q.text, /already AS \(.*provider_ref = \$10/s,
      "a replay is caught by the processor's own payment id, which does not move when the period does");
    assert.ok(q.params.includes("pay_abc"));
    assert.equal(q.params[5], 4700, "integer cents, never dollars");
  });

  test("a replay reports the row it already wrote instead of writing a second", async () => {
    const db = fakeDb({
      mirror: [{ id: "chg_9", status: "succeeded", recorded: false, outcome: "already_recorded", advanced_rows: "0" }]
    });
    const out = await recordProcessorCharge(db, {
      orgId: ORG, subscriptionId: SUB,
      periodStart: NOW, periodEnd: addDays(NOW, 30),
      amountCents: 4700, providerRef: "pay_abc"
    });
    assert.equal(out.recorded, false);
    assert.equal(out.reason, "already_recorded");
    assert.equal(out.charge.id, "chg_9");
  });

  test("markProcessorPastDue only ever touches a processor-billed row", async () => {
    const db = fakeDb({ updated: [row({ status: "past_due" })] });
    await markProcessorPastDue(db, { orgId: ORG, subscriptionId: SUB });
    const q = db.sql[0];
    assert.match(q.text, /lower\(btrim\(provider\)\) = ANY\(\$3::text\[\]\)/,
      "flipping a plain subscription past_due is settleFailed's job and needs a real failed attempt behind it");
    assert.match(q.text, /status = 'active'/, "a cancelled arrangement is not made past-due");
    assert.deepEqual(q.params[2], [...PROCESSOR_BILLED_PROVIDERS]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   THE CADENCE — days, not calendar months
   ═════════════════════════════════════════════════════════════════════════ */

describe("a processor cadence is counted in days", () => {
  test("thirty days from 31 January is 2 March, and a calendar month is not", () => {
    const jan31 = new Date("2026-01-31T00:00:00Z");
    assert.equal(addDays(jan31, COMMAS_FREQUENCY_DAYS).toISOString(), "2026-03-02T00:00:00.000Z");
    assert.equal(advancePeriod(jan31, "monthly").toISOString(), "2026-02-28T00:00:00.000Z");
  });

  test("the cadence is one number with one home", () => {
    assert.equal(COMMAS_FREQUENCY_DAYS, 30);
    assert.equal(PROCESSOR_BILLED_PROVIDER, "commas_subscription");
  });

  test("addDays refuses a nonsense cadence rather than silently not moving", () => {
    assert.throws(() => addDays(NOW, 0), /positive integer/);
    assert.throws(() => addDays(NOW, 1.5), /positive integer/);
    assert.throws(() => addDays("not a date", 30), /not a date/);
  });
});
