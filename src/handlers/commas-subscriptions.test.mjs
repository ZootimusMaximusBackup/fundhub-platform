// The Winner's Board renews, and this is the file that proves we hear about it.
//
// COMPLIANCE REVIEW REQUIRED. What is asserted here is the fee-timing surface
// of a recurring charge: that a renewal is recorded once, that a replay records
// nothing, that a past-due card is visible the day it fails, that a cancellation
// closes the arrangement, and — the one that matters most — that NONE of it can
// reach a charge. This handler mirrors; it never bills.
//
// NO DATABASE. Every statement is answered by a fake, so this runs in every CI
// pass (CLAUDE.md §12, trap 2). The database's own guarantees — 276's unique
// index on (subscription_id, period_start), 271's partner overlap constraint —
// are proved against real Postgres elsewhere and are not re-asserted here.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  onSubscriptionStarted, onSubscriptionRenewed, onSubscriptionPastDue,
  onSubscriptionEnded, resolveArrangement, register, FUNNEL_ASK_EVENT
} from "./commas-subscriptions.mjs";
import { getHandlers } from "../events/registry.mjs";
import { CANONICAL_EVENTS } from "../events/canonical.mjs";
import { PROCESSOR_BILLED_PROVIDER, COMMAS_FREQUENCY_DAYS } from "../subscriptions/billing.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const PARTNER = "33333333-3333-4333-8333-333333333333";
const SUB = "44444444-4444-4444-8444-444444444444";

/** A subscription.* event as the Commas adapter emits it. */
function event(name, over = {}) {
  return {
    id: "evt_1",
    name,
    orgId: ORG,
    clientId: CLIENT,
    /* `over` first so a test can null out orgId or clientId; `payload` is
       merged AFTER it so overriding one field does not drop the other ten. */
    ...over,
    payload: {
      product: "unmatched",
      productName: "Consulting Services Insights",
      amount: 47,
      email: "dana@example.com",
      providerRef: "pay_1",
      paymentId: "pay_1",
      ref: "fn_deadbeef",
      paymentLinkId: null,
      itemId: null,
      source: "commas",
      ...(over.payload || {})
    }
  };
}

/** The `funnel.checkout_started` row the public till writes before minting. */
const FUNNEL_ASK = {
  ref: "fn_deadbeef",
  item: "board",
  offer_key: "WINNERS_BOARD",
  product_code: "winners-board",
  amount_cents: 4700,
  currency: "USD",
  billing: "monthly",
  frequency_days: 30,
  email: "dana@example.com"
};

/** The mirror row, once it exists. */
function mirrorRow(over = {}) {
  return {
    id: SUB, org_id: ORG, client_id: CLIENT, partner_id: null,
    tier: "winners-board", status: "active",
    price_cents: "4700", currency: "USD", card_id: null,
    provider: PROCESSOR_BILLED_PROVIDER, provider_ref: null,
    current_period_start: "2026-08-15T00:00:00Z",
    current_period_end: "2026-09-14T00:00:00Z",
    next_charge_at: null, billing_interval: null,
    cancelled_at: null, effective_from: "2026-08-15T00:00:00Z", effective_to: null,
    ...over
  };
}

function fakeDb(script = {}) {
  const sql = [];
  return {
    sql,
    seen: (re) => sql.filter((q) => re.test(q.text)),
    async query(text, params) {
      const t = String(text).replace(/\s+/g, " ").trim();
      sql.push({ text: t, params });
      if (/FROM payment_links pl/i.test(t)) return { rows: script.link ? [script.link] : [] };
      if (/SELECT payload FROM events/i.test(t)) return { rows: script.ask ? [{ payload: script.ask }] : [] };
      if (/^WITH sub AS/i.test(t)) return { rows: script.mirror ?? [] };
      if (/^WITH cancelled AS/i.test(t)) return { rows: script.cancelled ?? [] };
      if (/^INSERT INTO subscriptions/i.test(t)) return { rows: script.started ?? [] };
      if (/^UPDATE subscriptions/i.test(t)) return { rows: script.updated ?? [] };
      if (/FROM subscriptions/i.test(t)) return { rows: script.live ?? [] };
      return { rows: [] };
    }
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE WIRING — without it, every subscription webhook is a crash
   ═════════════════════════════════════════════════════════════════════════ */

describe("the five names exist and reach this handler", () => {
  test("every subscription.* name the adapter emits is canonical", () => {
    /* emit() rejects any name not on the canonical list, and
       processCommasInboxRow does not catch it — so a missing name here means
       the inbox row is marked failed and retried forever, and a real renewal
       is never recorded. */
    for (const n of ["subscription.started", "subscription.renewed",
      "subscription.past_due", "subscription.canceled", "subscription.completed"]) {
      assert.ok(CANONICAL_EVENTS.includes(n), `emit() would throw on "${n}"`);
    }
  });

  test("register() listens to all five", () => {
    register();
    assert.equal(getHandlers("subscription.started").includes(onSubscriptionStarted), true);
    assert.equal(getHandlers("subscription.renewed").includes(onSubscriptionRenewed), true);
    assert.equal(getHandlers("subscription.past_due").includes(onSubscriptionPastDue), true);
    assert.equal(getHandlers("subscription.canceled").includes(onSubscriptionEnded), true);
    assert.equal(getHandlers("subscription.completed").includes(onSubscriptionEnded), true);
  });

  test("it is registered at boot, not only in this file", () => {
    const src = fs.readFileSync(path.join(HERE, "..", "register-all.mjs"), "utf8");
    assert.match(src, /commas-subscriptions\.mjs/,
      "an unregistered handler never runs — the same drift that has shipped twice with routes");
  });

  test("THIS HANDLER MAKES NO OUTBOUND CALL AND CHARGES NOTHING", () => {
    const src = fs.readFileSync(path.join(HERE, "commas-subscriptions.mjs"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(code, /\bfetch\s*\(/,
      "outbound transmission belongs in src/messaging/providers/* (CLAUDE.md §12)");
    assert.doesNotMatch(code, /claimCharge|resolveCharger|scheduleBilling/,
      "a mirror must not be able to reach the rail that asks for money");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   FINDING THE ARRANGEMENT
   ═════════════════════════════════════════════════════════════════════════ */

describe("which subscription is this webhook about", () => {
  test("a public funnel purchase is found by our own ref, off the ask we recorded", async () => {
    const db = fakeDb({ ask: FUNNEL_ASK });
    const a = await resolveArrangement(event("subscription.started"), db);
    assert.equal(a.ok, true);
    assert.equal(a.tier, "winners-board");
    assert.equal(a.clientId, CLIENT);
    assert.equal(a.partnerId, null);
    assert.equal(a.priceCents, 4700);
    assert.equal(a.frequencyDays, 30);
    assert.equal(a.source, "funnel_ask");

    const q = db.seen(/SELECT payload FROM events/)[0];
    assert.deepEqual(q.params, [ORG, FUNNEL_ASK_EVENT, "fn_deadbeef"]);
  });

  test("a partner add-on is found by its payment link, and the PARTNER owns it", async () => {
    const db = fakeDb({
      link: {
        id: "pl_1", org_id: ORG, partner_id: PARTNER, client_id: null,
        amount_cents: "29700", currency: "USD", product_code: "creative-intelligence"
      }
    });
    const a = await resolveArrangement(event("subscription.started"), db);
    assert.equal(a.ok, true);
    assert.equal(a.partnerId, PARTNER);
    assert.equal(a.clientId, null, "271: a subscription belongs to a client OR a partner, never both");
    assert.equal(a.tier, "creative-intelligence");
    assert.equal(a.priceCents, 29700, "bigint arrives as a string and is Number()'d exactly once");
    assert.equal(a.source, "payment_link");
  });

  test("the payment-link read is scoped to the event's org", async () => {
    const db = fakeDb({ link: null });
    await resolveArrangement(event("subscription.started"), db);
    const q = db.seen(/FROM payment_links pl/)[0];
    assert.equal(q.params[0], ORG);
    assert.match(q.text, /pl\.org_id = \$1/);
  });

  test("nothing to go on is reported, never guessed", async () => {
    const db = fakeDb({});
    const a = await resolveArrangement(event("subscription.started", { payload: { ref: null } }), db);
    assert.equal(a.ok, false);
    assert.equal(a.reason, "unresolved_subscription");
  });

  test("a funnel purchase the adapter could not attribute opens nothing", async () => {
    const db = fakeDb({ ask: FUNNEL_ASK });
    const a = await resolveArrangement(event("subscription.started", { clientId: null }), db);
    assert.equal(a.ok, false);
    assert.equal(a.reason, "no_owner");
  });

  test("an event with no org resolves to nothing and reads no table", async () => {
    const db = fakeDb({ ask: FUNNEL_ASK });
    const a = await resolveArrangement(event("subscription.started", { orgId: null }), db);
    assert.equal(a.ok, false);
    assert.equal(a.reason, "no_org");
    assert.equal(db.sql.length, 0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   subscription.created — open the mirror
   ═════════════════════════════════════════════════════════════════════════ */

describe("subscription.started opens a mirror that cannot be billed", () => {
  test("the row carries the processor marker and joins no rail of ours", async () => {
    const db = fakeDb({ ask: FUNNEL_ASK, live: [], started: [mirrorRow()] });
    const out = await onSubscriptionStarted(event("subscription.started"), db);
    assert.equal(out.opened, true);
    assert.equal(out.tier, "winners-board");

    const insert = db.seen(/^INSERT INTO subscriptions/)[0];
    assert.ok(insert, "a row was written");
    assert.ok(insert.params.includes(PROCESSOR_BILLED_PROVIDER),
      "without the marker, our sweeper would bill a card Commas is already billing");
    assert.ok(insert.params.includes(4700), "integer cents");

    /* next_charge_at and billing_interval are what put a row on the sweeper.
       A mirror is written with neither, so it is off that rail twice over.
       Read the INSERT's column list, not the RETURNING list — the row still
       HAS those columns, it just never has values in them. */
    const written = insert.text.split(") VALUES")[0];
    assert.doesNotMatch(written, /next_charge_at/);
    assert.doesNotMatch(written, /billing_interval/);
    assert.equal(db.seen(/INSERT INTO subscription_charges/).length, 0);
  });

  test("the first period is the cadence Commas was handed, in days", async () => {
    const db = fakeDb({ ask: FUNNEL_ASK, live: [], started: [mirrorRow()] });
    await onSubscriptionStarted(event("subscription.started"), db);
    const p = db.seen(/^INSERT INTO subscriptions/)[0].params;
    const start = p.find((v) => v instanceof Date);
    const dates = p.filter((v) => v instanceof Date).map((d) => d.getTime()).sort((a, b) => a - b);
    assert.ok(start, "a period start was written");
    assert.equal((dates[dates.length - 1] - dates[0]) / (24 * 60 * 60 * 1000), COMMAS_FREQUENCY_DAYS);
  });

  test("a redelivered created event does not open a second arrangement", async () => {
    const db = fakeDb({ ask: FUNNEL_ASK, live: [mirrorRow()] });
    const out = await onSubscriptionStarted(event("subscription.started"), db);
    assert.equal(out.opened, false);
    assert.equal(out.reason, "already_open");
    assert.equal(out.subscriptionId, SUB);
    assert.equal(db.seen(/^INSERT INTO subscriptions/).length, 0);
  });

  test("an ask with no price opens nothing — NULL means unknown and must survive", async () => {
    const db = fakeDb({ ask: { ...FUNNEL_ASK, amount_cents: null }, live: [] });
    const out = await onSubscriptionStarted(event("subscription.started"), db);
    assert.equal(out.opened, false);
    assert.equal(out.reason, "price_unknown");
    assert.equal(db.seen(/^INSERT INTO subscriptions/).length, 0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   subscription.renewed — write down money that already moved
   ═════════════════════════════════════════════════════════════════════════ */

describe("subscription.renewed records the money and advances the mirror", () => {
  test("the period is the one after the row's, and the amount is what Commas took", async () => {
    const db = fakeDb({
      ask: FUNNEL_ASK,
      live: [mirrorRow()],
      mirror: [{ id: "chg_1", recorded: true, outcome: "recorded", advanced_rows: "1" }]
    });
    const out = await onSubscriptionRenewed(event("subscription.renewed"), db);
    assert.equal(out.recorded, true);
    assert.equal(out.advanced, true);

    const q = db.seen(/^WITH sub AS/)[0];
    /* period_start = the row's current_period_end. Anchored on the row, never
       on a clock — a clock would mint a new period on every replay. */
    assert.equal(new Date(q.params[3]).toISOString(), "2026-09-14T00:00:00.000Z");
    assert.equal(new Date(q.params[4]).toISOString(), "2026-10-14T00:00:00.000Z");
    assert.equal(q.params[5], 4700, "$47 arrived as major units and is stored as integer cents");
    assert.equal(q.params[9], "pay_1", "the processor's payment id is the replay anchor");
  });

  test("a renewal never touches a subscription this system bills", async () => {
    const db = fakeDb({
      ask: FUNNEL_ASK,
      live: [mirrorRow({ provider: "commas", next_charge_at: "2026-09-14T00:00:00Z", billing_interval: "monthly" })]
    });
    const out = await onSubscriptionRenewed(event("subscription.renewed"), db);
    assert.equal(out.recorded, false);
    assert.equal(out.reason, "not_processor_billed");
    assert.equal(db.seen(/^WITH sub AS/).length, 0, "nothing was written to the ledger");
  });

  test("a renewal for an arrangement we never opened is reported, not invented", async () => {
    const db = fakeDb({ ask: FUNNEL_ASK, live: [] });
    const out = await onSubscriptionRenewed(event("subscription.renewed"), db);
    assert.equal(out.recorded, false);
    assert.equal(out.reason, "no_subscription");
    assert.equal(db.seen(/^INSERT INTO subscriptions/).length, 0,
      "a renewal must not conjure an arrangement whose start nobody saw");
  });

  test("a payload with no amount falls back to what the row says, never to zero", async () => {
    const db = fakeDb({
      ask: FUNNEL_ASK,
      live: [mirrorRow()],
      mirror: [{ id: "chg_1", recorded: true, outcome: "recorded", advanced_rows: "1" }]
    });
    await onSubscriptionRenewed(event("subscription.renewed", { payload: { amount: null } }), db);
    assert.equal(db.seen(/^WITH sub AS/)[0].params[5], 4700);
  });

  test("a replay is reported as already recorded and writes nothing new", async () => {
    const db = fakeDb({
      ask: FUNNEL_ASK,
      live: [mirrorRow()],
      mirror: [{ id: "chg_1", recorded: false, outcome: "already_recorded", advanced_rows: "0" }]
    });
    const out = await onSubscriptionRenewed(event("subscription.renewed"), db);
    assert.equal(out.recorded, false);
    assert.equal(out.reason, "already_recorded");
    assert.equal(out.chargeId, "chg_1");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   past_due, canceled, completed
   ═════════════════════════════════════════════════════════════════════════ */

describe("the rest of the lifecycle", () => {
  test("past_due flips the status and schedules no retry of our own", async () => {
    const db = fakeDb({ ask: FUNNEL_ASK, live: [mirrorRow()], updated: [mirrorRow({ status: "past_due" })] });
    const out = await onSubscriptionPastDue(event("subscription.past_due"), db);
    assert.equal(out.flagged, true);

    const q = db.seen(/^UPDATE subscriptions/)[0];
    assert.match(q.text, /SET status = 'past_due'/);
    const set = q.text.split("WHERE")[0];
    assert.doesNotMatch(set, /next_charge_at/,
      "Commas owns the dunning; scheduling our own retry is how a card gets hit twice");
    assert.doesNotMatch(set, /current_period/,
      "a failed charge on their side does not move the period we recorded");
  });

  test("past_due on a row we bill ourselves is refused", async () => {
    const db = fakeDb({ ask: FUNNEL_ASK, live: [mirrorRow({ provider: "commas" })] });
    const out = await onSubscriptionPastDue(event("subscription.past_due"), db);
    assert.equal(out.flagged, false);
    assert.equal(out.reason, "not_processor_billed");
    assert.equal(db.seen(/^UPDATE subscriptions/).length, 0);
  });

  test("canceled closes the arrangement", async () => {
    const db = fakeDb({
      ask: FUNNEL_ASK, live: [mirrorRow()],
      cancelled: [mirrorRow({ status: "cancelled", cancelled_at: "2026-10-01T00:00:00Z" })]
    });
    const out = await onSubscriptionEnded(event("subscription.canceled"), db);
    assert.equal(out.closed, true);
    assert.equal(out.ending, "canceled");
    assert.match(db.seen(/^WITH cancelled AS/)[0].text, /cancelled_at = COALESCE/,
      "a replay must not move the date a dispute turns on");
  });

  test("completed closes it too, and says which it was", async () => {
    const db = fakeDb({
      ask: FUNNEL_ASK, live: [mirrorRow()],
      cancelled: [mirrorRow({ status: "cancelled", cancelled_at: "2026-10-01T00:00:00Z" })]
    });
    const out = await onSubscriptionEnded(event("subscription.completed"), db);
    assert.equal(out.closed, true);
    assert.equal(out.ending, "completed",
      "075's status CHECK has no 'completed' — the distinction lives on the event, not the row");
  });

  test("nothing in the lifecycle throws on an event it cannot place", async () => {
    const db = fakeDb({});
    const blank = event("subscription.renewed", { payload: { ref: null } });
    assert.equal((await onSubscriptionStarted(blank, db)).opened, false);
    assert.equal((await onSubscriptionRenewed(blank, db)).recorded, false);
    assert.equal((await onSubscriptionPastDue(blank, db)).flagged, false);
    assert.equal((await onSubscriptionEnded(blank, db)).closed, false);
  });
});
