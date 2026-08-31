// The billing sweeper's shape and its ORDER OF GUARDS, with no database.
//
// The double-charge guarantee itself is a database race and is proved against a
// real Postgres in src/subscriptions/billing-replay.pg.test.mjs. What this file
// guards is the part a fake `db` CAN prove honestly: that the sweeper never
// reaches a processor without first holding a claim, that a skip writes nothing,
// and that a pass cannot throw.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  sweep, chargeOne, SWEEP_CRON, SOURCE_WORKFLOW, DEFAULT_BATCH, subscriptionBillingSweeper
} from "./subscription-billing-sweeper.mjs";
import { registerCharger, BILLING_ENABLED_ENV } from "../subscriptions/charger.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENV_ON = { [BILLING_ENABLED_ENV]: "true" };
const NOW = new Date("2026-08-15T09:00:00Z");

const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const PARTNER = "33333333-3333-4333-8333-333333333333";
const CARD = "55555555-5555-4555-8555-555555555555";

function subscription(over = {}) {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    org_id: ORG, client_id: CLIENT, partner_id: null,
    tier: "creative-intelligence", status: "active",
    price_cents: "29700", currency: "USD", card_id: CARD, provider: "commas",
    current_period_start: "2026-07-15T00:00:00Z",
    current_period_end: "2026-08-15T00:00:00Z",
    next_charge_at: "2026-08-15T00:00:00Z",
    billing_interval: "monthly",
    cancelled_at: null, effective_from: "2026-06-15T00:00:00Z", effective_to: null,
    ...over
  };
}

/**
 * A `db` that records every statement and answers from a script. It is NOT a
 * Postgres emulator and does not pretend to be one — the claim it returns is
 * whatever the test says, so these tests are about what the sweeper DOES with
 * an answer, never about which answer is correct.
 */
function fakeDb(script = {}) {
  const sql = [];
  return {
    sql,
    async query(text, params) {
      sql.push({ text: text.replace(/\s+/g, " ").trim(), params });
      const t = text.replace(/\s+/g, " ");
      if (/FROM subscriptions WHERE effective_to IS NULL/.test(t)) return { rows: script.due ?? [] };
      if (/INSERT INTO subscription_charges/.test(t)) return { rows: script.claim ?? [] };
      if (/SELECT .* FROM subscription_charges WHERE subscription_id/.test(t)) return { rows: script.existing ?? [] };
      return { rows: script.rows ?? [{}] };
    }
  };
}

const charged = (n = 1) => sql => sql.filter((q) => /INSERT INTO subscription_charges/.test(q.text)).length === n;

describe("registration and shape", () => {
  test("it is a cron function with a stable id", () => {
    assert.equal(subscriptionBillingSweeper.id(), "subscription-billing-sweeper");
    assert.equal(SOURCE_WORKFLOW, "subscription-billing-sweeper");
    assert.match(SWEEP_CRON, /^\d+ \* \* \* \*$/, "hourly, and off the hour");
    assert.notEqual(SWEEP_CRON.split(" ")[0], "0",
      "midnight-and-on-the-hour is where every scheduled job in every system piles up, and a "
      + "payments API is the worst place to join that queue");
    assert.ok(Number.isInteger(DEFAULT_BATCH) && DEFAULT_BATCH > 0 && DEFAULT_BATCH <= 500);
  });

  test("it is served", async () => {
    const { functions } = await import("./index.mjs");
    assert.ok(functions.some((f) => f.id() === "subscription-billing-sweeper"),
      "an unregistered workflow can never run — that is the drift index.test.mjs exists to catch");
  });

  test("THE SWEEPER MAKES NO OUTBOUND CALL OF ITS OWN", () => {
    const src = fs.readFileSync(path.join(HERE, "subscription-billing-sweeper.mjs"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(code, /\bfetch\s*\(/,
      "outbound transmission belongs behind a provider module (CLAUDE.md §12)");
  });
});

describe("the order of guards — nothing is written for a charge we were never going to make", () => {
  test("no charger configured: skipped, and NO ledger row", async () => {
    const db = fakeDb();
    const res = await chargeOne(subscription(), { db, env: ENV_ON, now: NOW });  // registry empty
    assert.equal(res.outcome, "skipped");
    assert.equal(res.reason, "no_charger");
    assert.equal(db.sql.length, 0, "a skip must not touch the database at all");
  });

  test("billing switched off: skipped before anything is claimed", async () => {
    const undo = registerCharger("commas", async () => ({ ok: true }));
    try {
      const db = fakeDb();
      const res = await chargeOne(subscription(), { db, env: {}, now: NOW });
      assert.equal(res.reason, "billing_disabled");
      assert.equal(db.sql.length, 0);
    } finally { undo(); }
  });

  test("no instrument: skipped BEFORE the charger is even resolved", async () => {
    let called = false;
    const undo = registerCharger("commas", async () => { called = true; return { ok: true }; });
    try {
      const db = fakeDb();
      const partner = await chargeOne(subscription({ client_id: null, partner_id: PARTNER, card_id: null }),
        { db, env: ENV_ON, now: NOW });
      assert.equal(partner.reason, "no_partner_instrument");

      const noCard = await chargeOne(subscription({ card_id: null }), { db, env: ENV_ON, now: NOW });
      assert.equal(noCard.reason, "no_card_on_file");

      assert.equal(called, false);
      assert.equal(db.sql.length, 0, "burning a retry for a gap on our side blames the customer for it");
    } finally { undo(); }
  });
});

describe("what the sweeper does with each answer from the claim", () => {
  const claimed = [{
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    subscription_id: subscription().id, org_id: ORG, attempt: 1, status: "in_flight"
  }];

  test("claimed: the processor is called exactly once and the cycle advances", async () => {
    const calls = [];
    const undo = registerCharger("commas", async (a) => { calls.push(a); return { ok: true, providerRef: "pay_1" }; });
    try {
      const db = fakeDb({ claim: claimed, rows: [{ advanced_rows: "1" }] });
      const res = await chargeOne(subscription(), { db, env: ENV_ON, now: NOW });
      assert.equal(calls.length, 1);
      assert.equal(res.outcome, "charged");
      assert.equal(res.amountCents, 29700);
      assert.equal(calls[0].idempotencyKey, `sub:${subscription().id}:period:2026-08-15T00:00:00Z`);
      assert.equal(calls[0].amountCents, 29700, "integer cents, never dollars");
      assert.ok(charged(1)(db.sql));
    } finally { undo(); }
  });

  test("ALREADY CHARGED: the window is repaired and NOTHING is called", async () => {
    const calls = [];
    const undo = registerCharger("commas", async (a) => { calls.push(a); return { ok: true }; });
    try {
      const db = fakeDb({
        claim: [],
        existing: [{ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", status: "succeeded", attempt: 1 }]
      });
      const res = await chargeOne(subscription(), { db, env: ENV_ON, now: NOW });
      assert.equal(calls.length, 0, "the money already moved");
      assert.equal(res.outcome, "repaired");
      assert.ok(db.sql.some((q) => /UPDATE subscriptions s SET current_period_start/.test(q.text)));
    } finally { undo(); }
  });

  test("IN FLIGHT: reported as stuck, never retried", async () => {
    const calls = [];
    const undo = registerCharger("commas", async (a) => { calls.push(a); return { ok: true }; });
    try {
      const db = fakeDb({ claim: [], existing: [{ id: "x", status: "in_flight", attempt: 2 }] });
      const res = await chargeOne(subscription(), { db, env: ENV_ON, now: NOW });
      assert.equal(calls.length, 0,
        "we do not know whether the money moved — retrying is the one action that can take it twice");
      assert.equal(res.outcome, "stuck");
    } finally { undo(); }
  });

  for (const [status, reason] of [["abandoned", "abandoned"], ["failed", "retry_not_due"]]) {
    test(`${status}: skipped, and nothing is called`, async () => {
      const calls = [];
      const undo = registerCharger("commas", async (a) => { calls.push(a); return { ok: true }; });
      try {
        const db = fakeDb({ claim: [], existing: [{ id: "x", status, attempt: 1, next_retry_at: "2027-01-01T00:00:00Z" }] });
        const res = await chargeOne(subscription(), { db, env: ENV_ON, now: NOW });
        assert.equal(calls.length, 0);
        assert.equal(res.outcome, "skipped");
        assert.equal(res.reason, reason);
      } finally { undo(); }
    });
  }
});

describe("a pass never throws", () => {
  test("a broken connection is returned, not raised", async () => {
    const res = await sweep({ query: async () => { throw new Error("connection reset"); } },
      { env: ENV_ON, now: NOW });
    assert.equal(res.ok, false);
    assert.match(res.error, /connection reset/);
    assert.equal(res.charged, 0);
  });

  test("one row that throws does not stop the others", async () => {
    let n = 0;
    const undo = registerCharger("commas", async () => {
      n += 1;
      if (n === 1) throw new Error("boom");
      return { ok: true, providerRef: "pay_ok" };
    });
    try {
      const db = fakeDb({
        due: [subscription({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
              subscription({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" })],
        claim: [{ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", attempt: 1, status: "in_flight" }],
        rows: [{ advanced_rows: "1" }]
      });
      const res = await sweep(db, { env: ENV_ON, now: NOW });
      assert.equal(res.ok, true);
      assert.equal(res.considered, 2);
      assert.equal(res.charged, 1, "the second row must still be billed");
      assert.equal(res.failed, 1, "a charger that throws is a retryable failure, not a decline");
    } finally { undo(); }
  });

  test("an empty pass is a clean, honest zero", async () => {
    const res = await sweep(fakeDb({ due: [] }), { env: ENV_ON, now: NOW });
    assert.deepEqual(
      { ok: res.ok, considered: res.considered, charged: res.charged, skipped: res.skipped },
      { ok: true, considered: 0, charged: 0, skipped: 0 }
    );
  });

  test("the batch is bounded", async () => {
    const db = fakeDb({ due: [] });
    await sweep(db, { env: ENV_ON, now: NOW, limit: 7 });
    assert.ok(db.sql.some((q) => /LIMIT 7/.test(q.text)), "a pass must not drain an unbounded backlog");
  });
});
