// The live dashboard's numbers.
//
// THE THREE RULES UNDER TEST, and all three are about honesty rather than
// arithmetic:
//   1. zero booked calls renders as zero, never as an empty state
//   2. NULL is not zero — an unsynced platform and a platform reporting no
//      spend are different facts with different conversations attached
//   3. every read is scoped to org AND partner; these tables have no RLS, so
//      the predicate written in the module IS the tenancy boundary

import { test, describe } from "node:test";
import assert from "node:assert";

import { trialDashboard, trialWindow } from "./dashboard.mjs";
import { TRIAL_STATUS } from "./constants.mjs";

const ORG = "11111111-1111-1111-1111-111111111111";
const PARTNER = "22222222-2222-2222-2222-222222222222";
const STARTED = new Date("2026-09-01T00:00:00Z");
const ENDS = new Date("2026-09-08T00:00:00Z");

function trialRow(over = {}) {
  return {
    id: "trial-1", org_id: ORG, partner_id: PARTNER, affiliate_id: "aff-1",
    contact_email: "buyer@example.test",
    status: TRIAL_STATUS.RUNNING, price_cents: 29700, held_start: false,
    started_at: STARTED, ends_at: ENDS, frozen_until: new Date("2026-10-08T00:00:00Z"),
    ...over
  };
}

function fakeDb({ trial = trialRow(), leads = 3, spend = null, bookings = [], events = [] } = {}) {
  const seen = [];
  return {
    seen,
    query: async (sql, params = []) => {
      seen.push({ sql: sql.replace(/\s+/g, " ").trim(), params });
      if (/FROM live_trials/i.test(sql)) return { rows: trial ? [trial] : [] };
      if (/FROM clients/i.test(sql) && /count\(\*\)/i.test(sql)) return { rows: [{ n: leads }] };
      if (/FROM ad_metrics_daily/i.test(sql)) {
        return { rows: [spend || { spend_cents: null, impressions: null, clicks: null, days_synced: 0 }] };
      }
      if (/FROM bookings/i.test(sql)) return { rows: bookings };
      if (/FROM live_trial_events/i.test(sql)) return { rows: events };
      return { rows: [] };
    }
  };
}

describe("trialWindow", () => {
  test("no clock, no window — the counts are not 'everything ever'", () => {
    assert.equal(trialWindow(trialRow({ started_at: null, ends_at: null })), null);
    assert.equal(trialWindow(null), null);
  });

  test("first impression to the end of the seventh day", () => {
    const w = trialWindow(trialRow());
    assert.equal(w.from, STARTED);
    assert.equal(w.to, ENDS);
  });
});

describe("trialDashboard", () => {
  test("no trial is a named reason, never an empty dashboard", async () => {
    const out = await trialDashboard(fakeDb({ trial: null }), { orgId: ORG, partnerId: PARTNER });
    assert.equal(out.ok, false);
    assert.equal(out.reason, "no_trial");
  });

  test("refuses to run unscoped", async () => {
    await assert.rejects(() => trialDashboard(fakeDb(), { partnerId: PARTNER }), /orgId is required/);
    await assert.rejects(() => trialDashboard(fakeDb(), { orgId: ORG }), /partnerId is required/);
  });

  /* ZERO IS A REAL ANSWER AND IT SURVIVES. A trial that booked nothing shows
     nothing booked; that number is what the day-8 conversation turns on. */
  test("zero booked calls is zero, not null and not hidden", async () => {
    const db = fakeDb({ bookings: [], spend: { spend_cents: "50000", impressions: "1000", clicks: "20", days_synced: 3 } });
    const out = await trialDashboard(db, { orgId: ORG, partnerId: PARTNER });
    assert.equal(out.numbers.booked_calls, 0);
    assert.equal(out.numbers.spend_cents, 50000);
  });

  /* NULL IS NOT ZERO. "Nothing has synced" and "the platform says you spent
     nothing" are different facts, and only one of them has a refund argument. */
  test("unsynced metrics are null, not zero", async () => {
    const out = await trialDashboard(fakeDb(), { orgId: ORG, partnerId: PARTNER });
    assert.equal(out.numbers.spend_cents, null);
    assert.equal(out.numbers.impressions, null);
    assert.equal(out.numbers.clicks, null);
    assert.equal(out.numbers.days_synced, 0);
  });

  test("money comes back as integer cents, never a formatted string", async () => {
    const db = fakeDb({ spend: { spend_cents: "123456", impressions: "9", clicks: "2", days_synced: 1 } });
    const out = await trialDashboard(db, { orgId: ORG, partnerId: PARTNER });
    assert.equal(typeof out.numbers.spend_cents, "number");
    assert.equal(out.numbers.spend_cents, 123456);
  });

  test("a held-start trial reports null counts and says why", async () => {
    const db = fakeDb({ trial: trialRow({ status: TRIAL_STATUS.HELD_START, started_at: null, ends_at: null }) });
    const out = await trialDashboard(db, { orgId: ORG, partnerId: PARTNER });
    assert.equal(out.numbers.booked_calls, null);
    assert.equal(out.numbers.leads, null);
    assert.equal(out.trial.phase, "held_start");
    assert.match(out.notes[0].text, /start the day Meta verifies/i);
    // And it must not pretend to know how long Meta takes.
    assert.match(out.notes[0].text, /cannot tell you how long/i);
    // No count queries were run at all — there is no window to count over.
    assert.equal(db.seen.some((s) => /FROM bookings/i.test(s.sql)), false);
  });

  test("a provisioned-but-unstarted trial says the clock has not started", async () => {
    const db = fakeDb({ trial: trialRow({ status: TRIAL_STATUS.PROVISIONED, started_at: null, ends_at: null }) });
    const out = await trialDashboard(db, { orgId: ORG, partnerId: PARTNER });
    assert.equal(out.trial.phase, "waiting_for_first_impression");
    assert.match(out.notes[0].text, /begin the moment your first ad is served/i);
  });

  test("every count is scoped to this org and this partner", async () => {
    const db = fakeDb({ bookings: [{ id: "b1", display_name: "Lead" }] });
    await trialDashboard(db, { orgId: ORG, partnerId: PARTNER });
    const scoped = db.seen.filter((s) => /FROM (clients|ad_metrics_daily|bookings)/i.test(s.sql));
    assert.ok(scoped.length >= 3);
    for (const s of scoped) {
      assert.equal(s.params[0], ORG, `unscoped org in: ${s.sql}`);
      assert.equal(s.params[1], PARTNER, `unscoped partner in: ${s.sql}`);
    }
  });

  /* bookings has no partner column. Ownership is reached through
     clients.partner_id — 042 calls that "the whole tenancy model" — and the
     join must carry org_id too. */
  test("booked calls are reached through clients.partner_id, with org on the join", async () => {
    const db = fakeDb({ bookings: [] });
    await trialDashboard(db, { orgId: ORG, partnerId: PARTNER });
    const q = db.seen.find((s) => /FROM bookings/i.test(s.sql));
    assert.match(q.sql, /JOIN clients c ON c\.id = b\.client_id AND c\.org_id = b\.org_id/);
    assert.match(q.sql, /c\.partner_id = \$2/);
  });

  test("the shaped trial carries the day, the phase and when it stops being readable", async () => {
    const db = fakeDb();
    const out = await trialDashboard(db, {
      orgId: ORG, partnerId: PARTNER, now: new Date("2026-09-03T12:00:00Z")
    });
    assert.equal(out.trial.day, 3);
    assert.equal(out.trial.of_days, 7);
    assert.equal(out.trial.days_remaining, 5);
    assert.equal(out.trial.phase, "running");
    assert.equal(out.trial.live, true);
    assert.equal(out.trial.readable_until.toISOString(), "2026-10-08T00:00:00.000Z");
  });

  test("an ended trial is not live, so the screen stops polling", async () => {
    const db = fakeDb({ trial: trialRow({ status: TRIAL_STATUS.ENDED }) });
    const out = await trialDashboard(db, {
      orgId: ORG, partnerId: PARTNER, now: new Date("2026-09-09T00:00:00Z")
    });
    assert.equal(out.trial.live, false);
  });

  test("no lender data, no payout percentage, no other partner's rows are selected", async () => {
    const db = fakeDb({ bookings: [{ id: "b1" }] });
    await trialDashboard(db, { orgId: ORG, partnerId: PARTNER });
    for (const s of db.seen) {
      assert.ok(!/\blenders?\b|lender_|revenue_share_pct|partner_revenue|payout/i.test(s.sql),
        `dashboard read touches something a partner must never see: ${s.sql}`);
    }
  });
});
