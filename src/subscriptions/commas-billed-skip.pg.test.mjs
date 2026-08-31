// THE PROOF, AGAINST REAL POSTGRES, THAT A SUBSCRIPTION COMMAS BILLS IS NEVER
// BILLED BY US — AND THAT A REPLAYED RENEWAL IS RECORDED EXACTLY ONCE.
//
// COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7): payment rails and fee timing.
//
// SKIPS unless DATABASE_URL is set, like every other .pg.test.mjs here. The
// half that needs no database is in commas-billed-skip.test.mjs, so the locks
// are still guarded when this file skips.
//
// Run live against a THROWAWAY database only:
//   DATABASE_URL=postgres://... npm run migrate && DATABASE_URL=... npm test
//
// ═══════════════════════════════════════════════════════════════════════════
// WHAT THIS PROVES THAT THE UNIT TEST CANNOT
//
// Two things, and both of them are the database's answer rather than
// JavaScript's:
//
//   1. THE SQL IS REAL. Every lock in the unit test that reads statement TEXT
//      is here executed. A predicate that matches a regular expression and
//      then throws a syntax error at runtime is worse than no predicate.
//
//   2. A REPLAY AFTER THE PERIOD MOVED. This is the one that would actually
//      cost money to get wrong. recordProcessorCharge() advances the
//      subscription's window, so running the SAME renewal a second time reads
//      an already-advanced row and computes a LATER period. A guard anchored on
//      the period alone would happily write a second charge, for a month
//      nobody paid for, and the books would show revenue that does not exist.
//      The guard is anchored on the processor's own payment id instead, and
//      this file runs the whole thing twice to prove it.

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, close } from "../db.mjs";
import { startSubscription, getSubscriptionAt } from "./store.mjs";
import {
  listDueSubscriptions, listCharges, scheduleBilling,
  recordProcessorCharge, markProcessorPastDue
} from "./billing-store.mjs";
import { registerCharger, BILLING_ENABLED_ENV } from "./charger.mjs";
import { sweep } from "../workflows/subscription-billing-sweeper.mjs";
import { PROCESSOR_BILLED_PROVIDER, COMMAS_FREQUENCY_DAYS, addDays } from "./billing.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const EMAIL = "commas_billed_skip_pg_test@example.com";
const PARTNER_SLUG = "commas-billed-skip-pg-test-partner";
const ENV_ON = { [BILLING_ENABLED_ENV]: "true" };

const START = new Date("2026-09-01T00:00:00.000Z");
const FIRST_END = addDays(START, COMMAS_FREQUENCY_DAYS);   // 2026-10-01
const SECOND_END = addDays(FIRST_END, COMMAS_FREQUENCY_DAYS); // 2026-10-31

let orgId = null;
let clientId = null;
let partnerId = null;

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
     VALUES ($1,$2,'Commas','Board') RETURNING id`, [orgId, EMAIL]
  )).rows[0].id;

  partnerId = (await db.query(
    `INSERT INTO partners (org_id, name, slug, status)
     VALUES ($1,'Commas Billed Partner',$2,'active') RETURNING id`,
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

/** The mirror a Commas subscription webhook opens: no interval, no next charge. */
function openMirror(over = {}) {
  return startSubscription(db, {
    orgId,
    clientId,
    tier: "winners-board",
    priceCents: 4700,
    currency: "USD",
    provider: PROCESSOR_BILLED_PROVIDER,
    at: START,
    periodStart: START,
    periodEnd: FIRST_END,
    notes: "Billed by Commas every 30 days",
    ...over
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE REPLAY — the one that would cost money
   ═════════════════════════════════════════════════════════════════════════ */

test("a renewal replayed AFTER the period advanced writes no second charge", { skip: !HAS_DB }, async () => {
  const sub = await openMirror();

  const first = await recordProcessorCharge(db, {
    orgId, subscriptionId: sub.id,
    periodStart: FIRST_END, periodEnd: SECOND_END,
    amountCents: 4700, currency: "USD",
    provider: PROCESSOR_BILLED_PROVIDER, providerRef: "pay_renewal_1",
    chargedAt: FIRST_END
  });
  assert.equal(first.recorded, true);
  assert.equal(first.advanced, true);

  const moved = await getSubscriptionAt(db, { orgId, clientId, at: FIRST_END });
  assert.equal(new Date(moved.current_period_start).toISOString(), FIRST_END.toISOString());
  assert.equal(new Date(moved.current_period_end).toISOString(), SECOND_END.toISOString());

  /* THE SECOND RUN IS THE POINT. The handler re-reads the row, which now ends a
     period later, so it computes [SECOND_END, +30d) — a DIFFERENT period, which
     276's unique index would happily accept. What refuses it is the payment id. */
  const replay = await recordProcessorCharge(db, {
    orgId, subscriptionId: sub.id,
    periodStart: SECOND_END, periodEnd: addDays(SECOND_END, COMMAS_FREQUENCY_DAYS),
    amountCents: 4700, currency: "USD",
    provider: PROCESSOR_BILLED_PROVIDER, providerRef: "pay_renewal_1",
    chargedAt: FIRST_END
  });
  assert.equal(replay.recorded, false);
  assert.equal(replay.reason, "already_recorded");
  assert.equal(replay.charge.id, first.charge.id);

  const charges = await listCharges(db, { orgId, subscriptionId: sub.id });
  assert.equal(charges.length, 1, "ONE renewal, ONE row — a second is revenue that never arrived");
  assert.equal(charges[0].status, "succeeded");
  assert.equal(Number(charges[0].amount_cents), 4700);
  assert.equal(charges[0].provider, PROCESSOR_BILLED_PROVIDER);

  const still = await getSubscriptionAt(db, { orgId, clientId, at: FIRST_END });
  assert.equal(new Date(still.current_period_end).toISOString(), SECOND_END.toISOString(),
    "a replay must not walk the window forward either");
});

test("two different renewals both land, and each advances the window once", { skip: !HAS_DB }, async () => {
  const sub = await openMirror();
  await recordProcessorCharge(db, {
    orgId, subscriptionId: sub.id, periodStart: FIRST_END, periodEnd: SECOND_END,
    amountCents: 4700, providerRef: "pay_a", chargedAt: FIRST_END
  });
  const second = await recordProcessorCharge(db, {
    orgId, subscriptionId: sub.id,
    periodStart: SECOND_END, periodEnd: addDays(SECOND_END, COMMAS_FREQUENCY_DAYS),
    amountCents: 4700, providerRef: "pay_b", chargedAt: SECOND_END
  });
  assert.equal(second.recorded, true);
  const charges = await listCharges(db, { orgId, subscriptionId: sub.id });
  assert.equal(charges.length, 2);
});

test("two deliveries racing on ONE period collide on 276's index", { skip: !HAS_DB }, async () => {
  const sub = await openMirror();
  const [a, b] = await Promise.all([
    recordProcessorCharge(db, {
      orgId, subscriptionId: sub.id, periodStart: FIRST_END, periodEnd: SECOND_END,
      amountCents: 4700, providerRef: "pay_race_1", chargedAt: FIRST_END
    }),
    recordProcessorCharge(db, {
      orgId, subscriptionId: sub.id, periodStart: FIRST_END, periodEnd: SECOND_END,
      amountCents: 4700, providerRef: "pay_race_2", chargedAt: FIRST_END
    })
  ]);
  const charges = await listCharges(db, { orgId, subscriptionId: sub.id });
  assert.equal(charges.length, 1, "one period, one charge, whichever delivery won");
  assert.equal([a.recorded, b.recorded].filter(Boolean).length, 1,
    "exactly one caller may be told it wrote the row");
});

/* ═══════════════════════════════════════════════════════════════════════════
   THE LOCKS, EXECUTED
   ═════════════════════════════════════════════════════════════════════════ */

test("listDueSubscriptions never returns a Commas-billed row", { skip: !HAS_DB }, async () => {
  /* Give it a next_charge_at by hand — scheduleBilling refuses to, which is
     the point of the next test. This is the row that WOULD be due. */
  const sub = await openMirror();
  await db.query(
    `UPDATE subscriptions SET next_charge_at = $2::timestamptz, billing_interval = 'monthly'
      WHERE id = $1`, [sub.id, FIRST_END]
  );

  const due = await listDueSubscriptions(db, { orgId, now: SECOND_END, limit: 500 });
  assert.equal(due.some((r) => r.id === sub.id), false,
    "the sweeper must not even see it");

  await db.query(`UPDATE subscriptions SET provider = 'commas' WHERE id = $1`, [sub.id]);
  const nowDue = await listDueSubscriptions(db, { orgId, now: SECOND_END, limit: 500 });
  assert.equal(nowDue.some((r) => r.id === sub.id), true,
    "…and the provider marker is the ONLY thing that was keeping it out");
});

test("the sweeper, handed a real Commas-billed row, calls nobody", { skip: !HAS_DB }, async () => {
  const sub = await openMirror();
  await db.query(
    `UPDATE subscriptions SET next_charge_at = $2::timestamptz, billing_interval = 'monthly'
      WHERE id = $1`, [sub.id, FIRST_END]
  );

  let calls = 0;
  const undo = registerCharger("commas", async () => { calls += 1; return { ok: true, providerRef: "no" }; });
  const undo2 = registerCharger(PROCESSOR_BILLED_PROVIDER, async () => { calls += 1; return { ok: true, providerRef: "no" }; });
  try {
    const tally = await sweep(db, { orgId, env: ENV_ON, now: SECOND_END, limit: 100 });
    assert.equal(calls, 0, "COMMAS ALREADY CHARGED THIS CARD");
    assert.equal(tally.charged, 0);
  } finally {
    undo();
    undo2();
  }

  const charges = await listCharges(db, { orgId, subscriptionId: sub.id });
  assert.equal(charges.length, 0, "no ledger row — we never tried to move money");
});

test("scheduleBilling refuses to put a Commas-billed row on the rail", { skip: !HAS_DB }, async () => {
  const sub = await openMirror();
  await assert.rejects(
    () => scheduleBilling(db, {
      orgId, subscriptionId: sub.id, interval: "monthly", firstChargeAt: FIRST_END
    }),
    /billed_by_processor/
  );
  const after = await getSubscriptionAt(db, { orgId, clientId, at: START });
  assert.equal(after.next_charge_at, null, "nothing was scheduled");
});

test("the OTHER double-billing shape is refused by the database itself", { skip: !HAS_DB }, async () => {
  /* THE WORRY: one arrangement, two rows. Commas bills the mirror; a caller
     that does not know that opens an ordinary row for the same customer and the
     same add-on and puts it on our cycle. Two charges a month, under two
     subscription ids, so nothing downstream sees a duplicate.
     THE ANSWER IS NOT JAVASCRIPT. 271's `subscriptions_partner_no_overlap`
     (org, partner, lower(btrim(tier)), period) refuses the second INSERT — two
     rows with effective_to NULL always overlap and the constraint carries no
     status predicate. So the second row never exists to be scheduled, which is
     why scheduleBilling() adds no check of its own: it could never fire. */
  await startSubscription(db, {
    orgId, partnerId, tier: "creative-intelligence", priceCents: 29700,
    provider: PROCESSOR_BILLED_PROVIDER, at: START, periodStart: START, periodEnd: FIRST_END
  });

  await assert.rejects(
    () => startSubscription(db, {
      orgId, partnerId, tier: "creative-intelligence", priceCents: 29700,
      provider: "commas", at: FIRST_END
    }),
    /already has "creative-intelligence" running/,
    "the second row must not be creatable at all"
  );

  const rows = await db.query(
    `SELECT id FROM subscriptions
      WHERE partner_id = $1 AND lower(btrim(tier)) = 'creative-intelligence'
        AND effective_to IS NULL`, [partnerId]
  );
  assert.equal(rows.rows.length, 1, "one arrangement, one live row");

  /* And a partner's OTHER add-ons are untouched by any of it — W6's menu is
     "stack freely", and 271 keys on the add-on for exactly that reason. */
  const other = await startSubscription(db, {
    orgId, partnerId, tier: "dfy-marketing", priceCents: 249700,
    provider: "commas", at: START
  });
  const scheduled = await scheduleBilling(db, {
    orgId, subscriptionId: other.id, interval: "monthly", firstChargeAt: SECOND_END
  });
  assert.ok(scheduled?.next_charge_at, "ordinary billing on a different add-on is untouched");
});

test("markProcessorPastDue flips the mirror, and refuses a row we bill", { skip: !HAS_DB }, async () => {
  const sub = await openMirror();
  const flagged = await markProcessorPastDue(db, { orgId, subscriptionId: sub.id });
  assert.equal(flagged.status, "past_due");
  assert.equal(flagged.next_charge_at, null, "no retry of ours is scheduled");

  /* Idempotent: it only ever moves an active row. */
  assert.equal(await markProcessorPastDue(db, { orgId, subscriptionId: sub.id }), null);

  /* And a renewal that recovers puts it back. */
  const rec = await recordProcessorCharge(db, {
    orgId, subscriptionId: sub.id, periodStart: FIRST_END, periodEnd: SECOND_END,
    amountCents: 4700, providerRef: "pay_recovered", chargedAt: FIRST_END
  });
  assert.equal(rec.recorded, true);
  const back = await getSubscriptionAt(db, { orgId, clientId, at: FIRST_END });
  assert.equal(back.status, "active", "subscription.recovered is what clears past_due");

  await db.query(`UPDATE subscriptions SET provider = 'commas' WHERE id = $1`, [sub.id]);
  assert.equal(await markProcessorPastDue(db, { orgId, subscriptionId: sub.id }), null,
    "a row on our own rail goes past_due only from a real failed attempt");
});
