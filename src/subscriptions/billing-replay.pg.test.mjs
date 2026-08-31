// THE PROOF THAT A REPLAYED BILLING SWEEP CANNOT CHARGE THE SAME PERIOD TWICE.
//
// Real Postgres. SKIPS unless DATABASE_URL is set, like every other
// .pg.test.mjs here — and the arithmetic half, which needs no database, is in
// billing.test.mjs so that the rules are still guarded when this one skips.
//
// Run live against a THROWAWAY database only:
//   DATABASE_URL=postgres://... npm run migrate && DATABASE_URL=... npm test
//
// ═══════════════════════════════════════════════════════════════════════════
// WHAT THIS PROVES THAT A UNIT TEST CANNOT
//
// Double-charging is a race, and a race is decided by the database. A fake `db`
// object can be written to return whatever the test needs and would prove only
// that the fake behaves. What has to be true is that 275's
// `UNIQUE (subscription_id, period_start)` refuses the second claim, for every
// writer that ever exists — a replayed cron, two overlapping passes, a
// restarted container, a hand-run script.
//
// So the charger here COUNTS ITS CALLS. Every assertion below is ultimately
// about that counter.

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, close } from "../db.mjs";
import { registerCharger, BILLING_ENABLED_ENV } from "./charger.mjs";
import {
  listDueSubscriptions, listCharges, recordReversal, scheduleBilling, listStuckCharges
} from "./billing-store.mjs";
import { sweep } from "../workflows/subscription-billing-sweeper.mjs";
import { MAX_ATTEMPTS, chargeIdempotencyKey } from "./billing.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const EMAIL = "billing_replay_pg_test@example.com";
const PARTNER_SLUG = "billing-replay-pg-test-partner";
const ENV_ON = { [BILLING_ENABLED_ENV]: "true" };

let orgId = null;
let clientId = null;
let partnerId = null;
let cardId = null;

/** A charger that never touches a network and counts every call it gets. */
function countingCharger(reply = () => ({ ok: true, providerRef: "pay_test" })) {
  const calls = [];
  const fn = async (args) => {
    calls.push(args);
    return reply(args, calls.length);
  };
  return { fn, calls };
}

async function wipe() {
  await db.query(
    `DELETE FROM subscription_charges WHERE subscription_id IN (
       SELECT id FROM subscriptions
        WHERE client_id IN (SELECT id FROM clients WHERE email = $1)
           OR partner_id IN (SELECT id FROM partners WHERE slug = $2))`,
    [EMAIL, PARTNER_SLUG]
  );
  await db.query(
    `DELETE FROM subscriptions
      WHERE client_id IN (SELECT id FROM clients WHERE email = $1)
         OR partner_id IN (SELECT id FROM partners WHERE slug = $2)`,
    [EMAIL, PARTNER_SLUG]
  );
  await db.query(`DELETE FROM client_cards WHERE client_id IN (SELECT id FROM clients WHERE email = $1)`, [EMAIL]);
  await db.query(`DELETE FROM clients WHERE email = $1`, [EMAIL]);
  await db.query(`DELETE FROM partners WHERE slug = $1`, [PARTNER_SLUG]);
}

before(async () => {
  if (!HAS_DB) return;
  await wipe();
  orgId = (await db.query(`SELECT id FROM orgs ORDER BY created_at LIMIT 1`)).rows[0]?.id;
  assert.ok(orgId, "an org must exist — run the seed");

  clientId = (await db.query(
    `INSERT INTO clients (org_id, email, first_name, last_name)
     VALUES ($1,$2,'Billing','Replay') RETURNING id`, [orgId, EMAIL]
  )).rows[0].id;

  cardId = (await db.query(
    `INSERT INTO client_cards (org_id, client_id, provider, provider_token, brand, last4)
     VALUES ($1,$2,'commas','tok_billing_replay','visa','4242') RETURNING id`, [orgId, clientId]
  )).rows[0].id;

  partnerId = (await db.query(
    `INSERT INTO partners (org_id, name, slug, status) VALUES ($1,'Billing Replay Partner',$2,'active') RETURNING id`,
    [orgId, PARTNER_SLUG]
  )).rows[0].id;
});

beforeEach(async () => {
  if (!HAS_DB) return;
  await db.query(
    `DELETE FROM subscription_charges WHERE subscription_id IN (
       SELECT id FROM subscriptions WHERE client_id = $1 OR partner_id = $2)`,
    [clientId, partnerId]
  );
  await db.query(`DELETE FROM subscriptions WHERE client_id = $1 OR partner_id = $2`, [clientId, partnerId]);
});

after(async () => {
  if (!HAS_DB) return;
  await wipe();
  await close();
});

/** A live, scheduled, billable client subscription. */
async function makeSubscription(over = {}) {
  const {
    priceCents = 29700, tier = "creative-intelligence",
    nextChargeAt = "2026-08-15T00:00:00Z", interval = "monthly",
    withCard = true, status = "active"
  } = over;
  const row = (await db.query(
    `INSERT INTO subscriptions
       (org_id, client_id, tier, status, price_cents, currency, card_id, provider,
        current_period_start, current_period_end, next_charge_at, billing_interval, effective_from)
     VALUES ($1,$2,$3,$4,$5,'USD',$6,'commas',
             '2026-07-15T00:00:00Z','2026-08-15T00:00:00Z',$7::timestamptz,$8,'2026-06-15T00:00:00Z')
     RETURNING *`,
    [orgId, clientId, tier, status, priceCents, withCard ? cardId : null, nextChargeAt, interval]
  )).rows[0];
  return row;
}

const NOW = new Date("2026-08-15T09:00:00Z");

// ═══════════════════════════════════════════════════════════════════════════
// THE HEADLINE
// ═══════════════════════════════════════════════════════════════════════════

test("FIVE REPLAYED SWEEPS CHARGE THE PERIOD EXACTLY ONCE", { skip: !HAS_DB && "DATABASE_URL not set" }, async () => {
  await makeSubscription();
  const { fn, calls } = countingCharger();
  const undo = registerCharger("commas", fn);
  try {
    const passes = [];
    for (let i = 0; i < 5; i += 1) {
      // The SAME clock every time. A replay is not "an hour later" — it is the
      // same pass run again, which is the case a wall clock would hide.
      passes.push(await sweep(db, { env: ENV_ON, now: NOW, orgId }));
    }

    assert.equal(calls.length, 1,
      `the processor was called ${calls.length} times for one period — this is the double charge`);
    assert.equal(passes[0].charged, 1, "the first pass should have charged once");
    for (const p of passes.slice(1)) {
      assert.equal(p.charged, 0, "a replay must charge nothing");
    }

    const ledger = await listCharges(db, { orgId, subscriptionId: calls[0].subscriptionId });
    assert.equal(ledger.length, 1, "one period, one ledger row");
    assert.equal(ledger[0].status, "succeeded");
    assert.equal(Number(ledger[0].attempt), 1, "a replay must not burn an attempt");
    assert.equal(Number(ledger[0].amount_cents), 29700);
  } finally {
    undo();
  }
});

test("TWO CONCURRENT SWEEPS CHARGE THE PERIOD EXACTLY ONCE", { skip: !HAS_DB && "DATABASE_URL not set" }, async () => {
  await makeSubscription();
  // The charger holds both callers open together, so if the claim were a
  // check-then-insert in JavaScript both would be inside it at once.
  let release;
  const gate = new Promise((r) => { release = r; });
  const { fn, calls } = countingCharger(async () => {
    await gate;
    return { ok: true, providerRef: "pay_concurrent" };
  });
  const undo = registerCharger("commas", fn);
  try {
    const a = sweep(db, { env: ENV_ON, now: NOW, orgId });
    const b = sweep(db, { env: ENV_ON, now: NOW, orgId });
    setTimeout(() => release(), 40);
    const [ra, rb] = await Promise.all([a, b]);
    assert.equal(calls.length, 1, `the processor was called ${calls.length} times by two overlapping passes`);
    assert.equal(ra.charged + rb.charged, 1, "exactly one pass may charge");
  } finally {
    release();
    undo();
  }
});

test("a crash between the charge and the cycle advance repairs, and never re-charges",
  { skip: !HAS_DB && "DATABASE_URL not set" }, async () => {
    const sub = await makeSubscription();
    // Simulate the crash: the ledger row is succeeded, but the subscription was
    // never advanced — exactly what a container dying mid-settle would leave if
    // the two writes were not one statement.
    await db.query(
      `INSERT INTO subscription_charges
         (org_id, subscription_id, idempotency_key, period_start, period_end,
          amount_cents, currency, status, attempt, provider, charged_at)
       VALUES ($1,$2,$3,'2026-08-15T00:00:00Z','2026-09-15T00:00:00Z',29700,'USD','succeeded',1,'commas',now())`,
      [orgId, sub.id, chargeIdempotencyKey({ subscriptionId: sub.id, periodStart: "2026-08-15T00:00:00Z" })]
    );

    const { fn, calls } = countingCharger();
    const undo = registerCharger("commas", fn);
    try {
      const res = await sweep(db, { env: ENV_ON, now: NOW, orgId });
      assert.equal(calls.length, 0, "the money already moved — nothing may be charged again");
      assert.equal(res.repaired, 1);

      const after = (await db.query(`SELECT * FROM subscriptions WHERE id = $1`, [sub.id])).rows[0];
      assert.equal(new Date(after.next_charge_at).toISOString(), "2026-09-15T00:00:00.000Z",
        "the window must advance so the customer's plan is not stuck on a paid period");
      assert.equal(new Date(after.current_period_start).toISOString(), "2026-08-15T00:00:00.000Z");
    } finally {
      undo();
    }
  });

test("AN IN-FLIGHT CHARGE IS NEVER RETRIED — we do not know if the money moved",
  { skip: !HAS_DB && "DATABASE_URL not set" }, async () => {
    const sub = await makeSubscription();
    await db.query(
      `INSERT INTO subscription_charges
         (org_id, subscription_id, idempotency_key, period_start, period_end,
          amount_cents, currency, status, attempt, provider)
       VALUES ($1,$2,$3,'2026-08-15T00:00:00Z','2026-09-15T00:00:00Z',29700,'USD','in_flight',1,'commas')`,
      [orgId, sub.id, chargeIdempotencyKey({ subscriptionId: sub.id, periodStart: "2026-08-15T00:00:00Z" })]
    );

    const { fn, calls } = countingCharger();
    const undo = registerCharger("commas", fn);
    try {
      const res = await sweep(db, { env: ENV_ON, now: NOW, orgId });
      assert.equal(calls.length, 0, "retrying an in-flight charge is the one action that can take the money twice");
      assert.equal(res.stuck, 1, "it must be reported, not silently dropped");
      const stuck = await listStuckCharges(db, { orgId, olderThan: new Date("2030-01-01Z") });
      assert.ok(stuck.some((r) => r.subscription_id === sub.id), "a human has to be able to find it");
    } finally {
      undo();
    }
  });

test("the database itself refuses a second row for one period, whoever writes it",
  { skip: !HAS_DB && "DATABASE_URL not set" }, async () => {
    const sub = await makeSubscription();
    const insert = () => db.query(
      `INSERT INTO subscription_charges
         (org_id, subscription_id, idempotency_key, period_start, period_end,
          amount_cents, currency, status, attempt, provider)
       VALUES ($1,$2,$3,'2026-08-15T00:00:00Z','2026-09-15T00:00:00Z',29700,'USD','failed',1,'commas')`,
      [orgId, sub.id, `raw-key-${Math.random()}`]
    );
    await insert();
    await assert.rejects(insert, (err) => err.code === "23505",
      "raw SQL must not be able to open a second charge for the same period either");
  });

// ═══════════════════════════════════════════════════════════════════════════
// THE CYCLE
// ═══════════════════════════════════════════════════════════════════════════

test("a successful charge advances the window by exactly one interval",
  { skip: !HAS_DB && "DATABASE_URL not set" }, async () => {
    const sub = await makeSubscription();
    const { fn } = countingCharger();
    const undo = registerCharger("commas", fn);
    try {
      await sweep(db, { env: ENV_ON, now: NOW, orgId });
      const a = (await db.query(`SELECT * FROM subscriptions WHERE id=$1`, [sub.id])).rows[0];
      assert.equal(new Date(a.current_period_start).toISOString(), "2026-08-15T00:00:00.000Z");
      assert.equal(new Date(a.current_period_end).toISOString(), "2026-09-15T00:00:00.000Z");
      assert.equal(new Date(a.next_charge_at).toISOString(), "2026-09-15T00:00:00.000Z");

      // Next month it is due again, once.
      const next = await sweep(db, { env: ENV_ON, now: new Date("2026-09-15T09:00:00Z"), orgId });
      assert.equal(next.charged, 1);
      const ledger = await listCharges(db, { orgId, subscriptionId: sub.id });
      assert.equal(ledger.length, 2, "two periods, two rows");
      assert.equal(Number(ledger[0].amount_cents) + Number(ledger[1].amount_cents), 59400);
    } finally {
      undo();
    }
  });

test("the price and the tier survive a charge — 075's trigger is not disturbed",
  { skip: !HAS_DB && "DATABASE_URL not set" }, async () => {
    const sub = await makeSubscription({ priceCents: 249700, tier: "dfy-marketing" });
    const { fn } = countingCharger();
    const undo = registerCharger("commas", fn);
    try {
      await sweep(db, { env: ENV_ON, now: NOW, orgId });
      const a = (await db.query(`SELECT * FROM subscriptions WHERE id=$1`, [sub.id])).rows[0];
      assert.equal(Number(a.price_cents), 249700);
      assert.equal(a.tier, "dfy-marketing");
      assert.equal(new Date(a.effective_from).toISOString(), "2026-06-15T00:00:00.000Z");
    } finally {
      undo();
    }
  });

// ═══════════════════════════════════════════════════════════════════════════
// FAILURE, PAST_DUE AND THE BOUNDED RETRY
// ═══════════════════════════════════════════════════════════════════════════

test("a decline goes past_due at once and the cycle does NOT advance",
  { skip: !HAS_DB && "DATABASE_URL not set" }, async () => {
    const sub = await makeSubscription();
    const { fn, calls } = countingCharger(() => ({ ok: false, retryable: false, code: "card_declined", reason: "no funds" }));
    const undo = registerCharger("commas", fn);
    try {
      const res = await sweep(db, { env: ENV_ON, now: NOW, orgId });
      assert.equal(calls.length, 1);
      assert.equal(res.failed, 1);
      const a = (await db.query(`SELECT * FROM subscriptions WHERE id=$1`, [sub.id])).rows[0];
      assert.equal(a.status, "past_due");
      assert.equal(new Date(a.next_charge_at).toISOString(), "2026-08-15T00:00:00.000Z",
        "the period is still owed — moving next_charge_at would skip a period nobody paid for");
      const [row] = await listCharges(db, { orgId, subscriptionId: sub.id });
      assert.equal(row.status, "failed");
      assert.equal(row.failure_code, "card_declined");
      assert.ok(row.next_retry_at, "a decline still gets its remaining attempts — cards get fixed");
    } finally {
      undo();
    }
  });

test("a transport failure does NOT blame the customer", { skip: !HAS_DB && "DATABASE_URL not set" }, async () => {
  const sub = await makeSubscription();
  const { fn } = countingCharger(() => ({ ok: false, code: "timeout", reason: "gateway timeout" }));
  const undo = registerCharger("commas", fn);
  try {
    await sweep(db, { env: ENV_ON, now: NOW, orgId });
    const a = (await db.query(`SELECT * FROM subscriptions WHERE id=$1`, [sub.id])).rows[0];
    assert.equal(a.status, "active", "our timeout is not their decline");
  } finally {
    undo();
  }
});

test("a charger that throws is treated as retryable, not as a decline",
  { skip: !HAS_DB && "DATABASE_URL not set" }, async () => {
    const sub = await makeSubscription();
    const undo = registerCharger("commas", async () => { throw new Error("socket hang up"); });
    try {
      const res = await sweep(db, { env: ENV_ON, now: NOW, orgId });
      assert.equal(res.failed, 1);
      const a = (await db.query(`SELECT * FROM subscriptions WHERE id=$1`, [sub.id])).rows[0];
      assert.equal(a.status, "active");
      const [row] = await listCharges(db, { orgId, subscriptionId: sub.id });
      assert.equal(row.failure_code, "charger_threw");
      assert.equal(row.status, "failed", "the ledger row must not be left in_flight by a throw");
    } finally {
      undo();
    }
  });

test("THE RETRY IS BOUNDED: the ceiling abandons and nothing picks it up again",
  { skip: !HAS_DB && "DATABASE_URL not set" }, async () => {
    const sub = await makeSubscription();
    const { fn, calls } = countingCharger(() => ({ ok: false, code: "timeout", reason: "down" }));
    const undo = registerCharger("commas", fn);
    try {
      // Each pass moves the clock past the backoff, so every remaining attempt
      // is genuinely available. Ten passes, four attempts.
      let clock = NOW;
      for (let i = 0; i < 10; i += 1) {
        await sweep(db, { env: ENV_ON, now: clock, orgId });
        clock = new Date(clock.getTime() + 3 * 24 * 60 * 60 * 1000);
      }
      assert.equal(calls.length, MAX_ATTEMPTS,
        `the processor was called ${calls.length} times — the retry is not bounded at ${MAX_ATTEMPTS}`);
      const [row] = await listCharges(db, { orgId, subscriptionId: sub.id });
      assert.equal(row.status, "abandoned");
      assert.equal(row.next_retry_at, null, "an abandoned period must have no schedule at all");
      const a = (await db.query(`SELECT * FROM subscriptions WHERE id=$1`, [sub.id])).rows[0];
      assert.equal(a.status, "past_due");
    } finally {
      undo();
    }
  });

test("the backoff is honoured — a retry before it elapses is not attempted",
  { skip: !HAS_DB && "DATABASE_URL not set" }, async () => {
    await makeSubscription();
    const { fn, calls } = countingCharger(() => ({ ok: false, code: "timeout", reason: "down" }));
    const undo = registerCharger("commas", fn);
    try {
      await sweep(db, { env: ENV_ON, now: NOW, orgId });
      // One minute later: the first backoff is fifteen.
      const res = await sweep(db, { env: ENV_ON, now: new Date(NOW.getTime() + 60000), orgId });
      assert.equal(calls.length, 1, "the backoff was ignored — this is a hot loop against a payments API");
      assert.equal(res.skipped, 1);
    } finally {
      undo();
    }
  });

test("a card fixed after a decline clears past_due", { skip: !HAS_DB && "DATABASE_URL not set" }, async () => {
  const sub = await makeSubscription({ status: "past_due" });
  const { fn } = countingCharger();
  const undo = registerCharger("commas", fn);
  try {
    await sweep(db, { env: ENV_ON, now: NOW, orgId });
    const a = (await db.query(`SELECT * FROM subscriptions WHERE id=$1`, [sub.id])).rows[0];
    assert.equal(a.status, "active", "a successful charge is what clears a past-due plan");
  } finally {
    undo();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// WHAT MUST NEVER BE CHARGED
// ═══════════════════════════════════════════════════════════════════════════

test("with no charger registered, a due subscription is skipped and nothing is written",
  { skip: !HAS_DB && "DATABASE_URL not set" }, async () => {
    const sub = await makeSubscription();
    const res = await sweep(db, { env: ENV_ON, now: NOW, orgId });   // registry is empty
    assert.equal(res.considered, 1);
    assert.equal(res.skipped, 1);
    assert.equal(res.charged, 0);
    assert.deepEqual(await listCharges(db, { orgId, subscriptionId: sub.id }), [],
      "a ledger row means 'we tried to move money' — a skip must not burn an attempt");
  });

test("with the env flag off, nothing is charged even with a charger registered",
  { skip: !HAS_DB && "DATABASE_URL not set" }, async () => {
    await makeSubscription();
    const { fn, calls } = countingCharger();
    const undo = registerCharger("commas", fn);
    try {
      const res = await sweep(db, { env: {}, now: NOW, orgId });
      assert.equal(calls.length, 0);
      assert.equal(res.skipped, 1);
      assert.match(res.results[0].reason, /billing_disabled/);
    } finally {
      undo();
    }
  });

test("A PARTNER SUBSCRIPTION IS SELECTED AND SKIPPED — there is no partner instrument",
  { skip: !HAS_DB && "DATABASE_URL not set" }, async () => {
    // 271: subscriptions_partner_card_chk forbids a card on a partner row, and
    // there is no partner instrument table in this repository. The honest
    // outcome is a skip, never a decline: burning a retry and flipping a
    // partner to past_due would blame them for a gap on our side.
    const sub = (await db.query(
      `INSERT INTO subscriptions
         (org_id, partner_id, tier, status, price_cents, currency, provider,
          next_charge_at, billing_interval, effective_from)
       VALUES ($1,$2,'creative-intelligence','active',29700,'USD','commas',
               '2026-08-15T00:00:00Z','monthly','2026-06-15T00:00:00Z')
       RETURNING *`, [orgId, partnerId]
    )).rows[0];

    const { fn, calls } = countingCharger();
    const undo = registerCharger("commas", fn);
    try {
      const due = await listDueSubscriptions(db, { orgId, now: NOW });
      assert.ok(due.some((r) => r.id === sub.id), "a partner row must be visible to the sweeper, not invisible");

      const res = await sweep(db, { env: ENV_ON, now: NOW, orgId });
      assert.equal(calls.length, 0);
      assert.equal(res.skipped, 1);
      assert.equal(res.results.find((r) => r.subscriptionId === sub.id).reason, "no_partner_instrument");

      const a = (await db.query(`SELECT * FROM subscriptions WHERE id=$1`, [sub.id])).rows[0];
      assert.equal(a.status, "active", "our missing table must never make a partner past_due");
      assert.deepEqual(await listCharges(db, { orgId, subscriptionId: sub.id }), []);
    } finally {
      undo();
    }
  });

test("nothing on the rail today: a subscription with no next_charge_at is never selected",
  { skip: !HAS_DB && "DATABASE_URL not set" }, async () => {
    await db.query(
      `INSERT INTO subscriptions (org_id, client_id, tier, status, price_cents, currency, card_id, effective_from)
       VALUES ($1,$2,'legacy','active',29700,'USD',$3,'2026-06-15T00:00:00Z')`,
      [orgId, clientId, cardId]
    );
    const due = await listDueSubscriptions(db, { orgId, now: NOW });
    assert.equal(due.length, 0,
      "every subscription that exists today has no schedule and must stay exactly as unbilled as it is");
  });

test("a cancelled or closed subscription is never selected", { skip: !HAS_DB && "DATABASE_URL not set" }, async () => {
  const sub = await makeSubscription();
  await db.query(
    `UPDATE subscriptions SET status='cancelled', cancelled_at=now(), effective_to=now() WHERE id=$1`, [sub.id]
  );
  assert.equal((await listDueSubscriptions(db, { orgId, now: NOW })).length, 0);
});

test("an unknown price is never charged, and never becomes zero", { skip: !HAS_DB && "DATABASE_URL not set" }, async () => {
  const sub = (await db.query(
    `INSERT INTO subscriptions
       (org_id, client_id, tier, status, price_cents, currency, card_id, next_charge_at, billing_interval, effective_from)
     VALUES ($1,$2,'unpriced','active',NULL,'USD',$3,'2026-08-15T00:00:00Z','monthly','2026-06-15T00:00:00Z')
     RETURNING *`, [orgId, clientId, cardId]
  )).rows[0];
  const { fn, calls } = countingCharger();
  const undo = registerCharger("commas", fn);
  try {
    assert.equal((await listDueSubscriptions(db, { orgId, now: NOW })).length, 0);
    await sweep(db, { env: ENV_ON, now: NOW, orgId });
    assert.equal(calls.length, 0);
    const a = (await db.query(`SELECT price_cents FROM subscriptions WHERE id=$1`, [sub.id])).rows[0];
    assert.equal(a.price_cents, null, "NULL means unknown and must survive");
  } finally {
    undo();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// TERMS, SCHEDULING AND REVERSALS
// ═══════════════════════════════════════════════════════════════════════════

test("billing_interval can be set once and never changed", { skip: !HAS_DB && "DATABASE_URL not set" }, async () => {
  const sub = (await db.query(
    `INSERT INTO subscriptions (org_id, client_id, tier, status, price_cents, currency, card_id, effective_from)
     VALUES ($1,$2,'set-once','active',29700,'USD',$3,'2026-06-15T00:00:00Z') RETURNING *`,
    [orgId, clientId, cardId]
  )).rows[0];

  const scheduled = await scheduleBilling(db, {
    orgId, subscriptionId: sub.id, interval: "monthly", firstChargeAt: "2026-08-15T00:00:00Z"
  });
  assert.equal(scheduled.billing_interval, "monthly");

  await assert.rejects(
    db.query(`UPDATE subscriptions SET billing_interval='annual' WHERE id=$1`, [sub.id]),
    /immutable once set/,
    "changing the cadence restates what somebody agreed to — it must close the row and open a new one"
  );
});

test("scheduleBilling refuses a row that could never be charged", { skip: !HAS_DB && "DATABASE_URL not set" }, async () => {
  const sub = (await db.query(
    `INSERT INTO subscriptions (org_id, client_id, tier, status, price_cents, currency, card_id, effective_from)
     VALUES ($1,$2,'no-price','active',NULL,'USD',$3,'2026-06-15T00:00:00Z') RETURNING *`,
    [orgId, clientId, cardId]
  )).rows[0];
  await assert.rejects(
    () => scheduleBilling(db, { orgId, subscriptionId: sub.id, interval: "monthly", firstChargeAt: "2026-08-15T00:00:00Z" }),
    /price_unknown/
  );
});

test("a schedule cannot exist without a cadence", { skip: !HAS_DB && "DATABASE_URL not set" }, async () => {
  await assert.rejects(
    db.query(
      `INSERT INTO subscriptions (org_id, client_id, tier, status, price_cents, currency, card_id, next_charge_at, effective_from)
       VALUES ($1,$2,'half-configured','active',29700,'USD',$3,'2026-08-15T00:00:00Z','2026-06-15T00:00:00Z')`,
      [orgId, clientId, cardId]
    ),
    /subscriptions_schedule_coherent_chk/,
    "a due date with no cadence is a period whose end cannot be computed"
  );
});

test("A REVERSAL IS RECORDED AND NEVER RECOVERED, AND IT DOES NOT RE-OPEN THE PERIOD",
  { skip: !HAS_DB && "DATABASE_URL not set" }, async () => {
    const sub = await makeSubscription();
    const { fn, calls } = countingCharger();
    const undo = registerCharger("commas", fn);
    try {
      await sweep(db, { env: ENV_ON, now: NOW, orgId });
      const [charge] = await listCharges(db, { orgId, subscriptionId: sub.id });

      const reversed = await recordReversal(db, {
        orgId, chargeId: charge.id, at: "2026-08-20T00:00:00Z", reason: "chargeback"
      });
      assert.ok(reversed.reversed_at, "the reversal must be on the record");
      assert.equal(reversed.status, "succeeded", "the charge still happened — a reversal does not un-charge it");

      // Idempotent: the second call must not move the date a dispute turns on.
      const again = await recordReversal(db, { orgId, chargeId: charge.id, at: "2026-09-01T00:00:00Z", reason: "again" });
      assert.equal(new Date(again.reversed_at).toISOString(), "2026-08-20T00:00:00.000Z");
      assert.equal(again.reversal_reason, "chargeback");

      // And the period stays sold. Re-charging it would be the double charge.
      const before = calls.length;
      await sweep(db, { env: ENV_ON, now: NOW, orgId });
      assert.equal(calls.length, before, "a reversed period must never become chargeable again");
    } finally {
      undo();
    }
  });

test("a pass never throws, whatever one row does", { skip: !HAS_DB && "DATABASE_URL not set" }, async () => {
  // The scheduled function must survive its own bad day: the next pass is the
  // recovery, and a throw here would take the whole cron down.
  await makeSubscription();
  const undo = registerCharger("commas", async () => { throw new Error("boom"); });
  try {
    const res = await sweep(db, { env: ENV_ON, now: NOW, orgId });
    assert.equal(res.ok, true);
    assert.equal(res.considered, 1);
    assert.equal(res.failed, 1);
  } finally {
    undo();
  }

  // And a broken connection is returned, not raised.
  const broken = { query: async () => { throw new Error("connection reset"); } };
  const res = await sweep(broken, { env: ENV_ON, now: NOW, orgId });
  assert.equal(res.ok, false);
  assert.match(res.error, /connection reset/);
});
