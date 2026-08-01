/* The virtual clock, and the acceptance criterion it exists for:
 *
 *   "n-06's 180-day sleep resolves instantly, and an opt-out recorded at
 *    virtual day 90 blocks the day-180 message."
 *
 * The last test in this file drives the REAL n-06 workflow body — not a copy,
 * not a stub — through the real sendTemplated, and asserts exactly that.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { createClock, fakeStep, parseDuration, sleptMs, DurationError } from "./fake-step.mjs";
import { pgFake, ev } from "../../workflows/test-support.mjs";
import { handle as n06, SMS_TEMPLATE_KEY, EMAIL_TEMPLATE_KEY } from "../../workflows/n-06-renewal-second-wave.mjs";

const DAY = 24 * 60 * 60 * 1000;

// ── duration parsing ──────────────────────────────────────────────────────

test("parses every duration string the 47 workflows actually use", () => {
  // Inventoried from src/workflows/: these are the real arguments, not a
  // guess at the format.
  assert.equal(parseDuration("20m"), 20 * 60 * 1000);
  assert.equal(parseDuration("30m"), 30 * 60 * 1000);
  assert.equal(parseDuration("1h"), 60 * 60 * 1000);
  assert.equal(parseDuration("2h"), 2 * 60 * 60 * 1000);
  assert.equal(parseDuration("3h"), 3 * 60 * 60 * 1000);
  assert.equal(parseDuration("4h"), 4 * 60 * 60 * 1000);
  assert.equal(parseDuration("12h"), 12 * 60 * 60 * 1000);
  assert.equal(parseDuration("24h"), DAY);
  assert.equal(parseDuration("48h"), 2 * DAY);
  assert.equal(parseDuration("72h"), 3 * DAY);
  assert.equal(parseDuration("2d"), 2 * DAY);
  assert.equal(parseDuration("180d"), 180 * DAY);
});

test("refuses a duration it cannot parse rather than treating it as zero", () => {
  // A silently-zero sleep turns "waits three days" into "waits not at all"
  // without anything going red. That is the false green this runner exists to
  // catch, so it must not be able to produce one itself.
  for (const bad of ["soon", "", "3 fortnights", "1x", null, undefined, {}]) {
    assert.throws(() => parseDuration(bad), DurationError, `${JSON.stringify(bad)} must throw`);
  }
});

// ── the clock ─────────────────────────────────────────────────────────────

test("the clock genuinely advances, and a 180-day sleep is instant", async () => {
  const clock = createClock(0);
  const step = fakeStep(clock);

  const wall = Date.now();
  await step.sleep("wait-6-months", "180d");
  const wallElapsed = Date.now() - wall;

  assert.equal(clock.now(), 180 * DAY, "virtual time must be 180 days later");
  assert.ok(wallElapsed < 1000, `real time must barely move, took ${wallElapsed}ms`);
});

test("the clock never runs backward on sleepUntil", async () => {
  const clock = createClock(10 * DAY);
  const step = fakeStep(clock);

  // dpc-02 and ai-set-04 both call sleepUntil with an absolute Date computed
  // from event data, which can already be in the past at virtual now.
  await step.sleepUntil("wake-in-the-past", new Date(DAY));
  assert.equal(clock.now(), 10 * DAY, "a past target must not rewind the clock");

  await step.sleepUntil("wake-later", new Date(12 * DAY));
  assert.equal(clock.now(), 12 * DAY);
});

test("step.run executes immediately and returns the callback's value", async () => {
  const clock = createClock(0);
  const step = fakeStep(clock);
  const out = await step.run("compute", async () => 41 + 1);
  assert.equal(out, 42);
  assert.equal(clock.now(), 0, "running a step costs no virtual time");
});

test("step.run rethrows, and records the failure", async () => {
  const clock = createClock(0);
  const step = fakeStep(clock);
  await assert.rejects(() => step.run("boom", async () => { throw new Error("nope"); }), /nope/);
  assert.equal(step.record[0].ok, false);
  assert.match(step.record[0].error, /nope/);
});

test("the record captures what slept, for how long, and in what order", async () => {
  const clock = createClock(0);
  const step = fakeStep(clock);
  await step.run("a", async () => 1);
  await step.sleep("wait-24h", "24h");
  await step.run("b", async () => 2);
  await step.sleep("wait-48h", "48h");

  assert.deepEqual(step.record.map((e) => e.id), ["a", "wait-24h", "b", "wait-48h"]);
  assert.equal(sleptMs(step.record), 3 * DAY);
  // The step that ran between the two sleeps observed the clock mid-way.
  assert.equal(step.record[2].at, DAY);
});

// ── the acceptance criterion, against the real workflow ───────────────────

/* pgFake has no opt_outs table — unmatched SQL falls through to { rows: [] },
   so isOptedOut() always answers false. This wraps it with a clock-aware
   opt_outs branch: an opt-out counts only once virtual time has reached the
   moment it was recorded. That is what makes "recorded at day 90, read at day
   180" a real sequence rather than a flag set before the run.

   Wrapping rather than editing src/workflows/test-support.mjs on purpose:
   20+ suites share that module. */
function withOptOuts(base, clock, optOuts = []) {
  return {
    ...base,
    query: async (sql, params = []) => {
      if (/FROM opt_outs/.test(sql)) {
        const [clientId, channel] = params;
        const hit = optOuts.find(
          (o) => o.clientId === clientId && o.channel === channel && o.at <= clock.now() && !o.optedInAt
        );
        return { rows: hit ? [{ "?column?": 1 }] : [] };
      }
      return base.query(sql, params);
    }
  };
}

const n06Seed = () => ({
  clients: [{ id: "cl-1", org_id: "org-1", email: "renewal@fundhub.test", first_name: "Dana" }],
  fundingRounds: [{ client_id: "cl-1", funded_amount: 50000 }],
  templates: [
    { org_id: "org-1", template_key: EMAIL_TEMPLATE_KEY, body: "Time for round two, {contact.first_name}.", compliance_passed: true },
    { org_id: "org-1", template_key: SMS_TEMPLATE_KEY, body: "Round two? Reply STOP to opt out.", compliance_passed: true }
  ]
});

test("ACCEPTANCE: n-06's 180-day sleep resolves instantly and the clock really reads day 180", async () => {
  const clock = createClock(0);
  const step = fakeStep(clock);
  const base = pgFake(n06Seed());
  const db = withOptOuts(base, clock, []);

  const wall = Date.now();
  const res = await n06({ event: ev("round.funded", {}, { clientId: "cl-1" }), db, step });
  const wallElapsed = Date.now() - wall;

  assert.equal(res.sent, true);
  assert.equal(clock.now(), 180 * DAY, "the workflow's own sleep moved the clock 180 days");
  assert.ok(wallElapsed < 1000, `must not actually wait, took ${wallElapsed}ms`);
  // Both messages went out: no opt-out was recorded.
  assert.equal(base.messages.length, 2);
  assert.deepEqual(base.messages.map((m) => m.channel).sort(), ["email", "sms"]);
});

test("ACCEPTANCE: an opt-out recorded at virtual day 90 blocks the day-180 SMS", async () => {
  const clock = createClock(0);
  const step = fakeStep(clock);
  const base = pgFake(n06Seed());
  const db = withOptOuts(base, clock, [{ clientId: "cl-1", channel: "sms", at: 90 * DAY }]);

  const res = await n06({ event: ev("round.funded", {}, { clientId: "cl-1" }), db, step });

  assert.equal(res.sent, true);
  assert.equal(res.sms.sent, false, "the SMS must be suppressed");
  assert.equal(res.sms.reason, "opted_out");
  // The email still goes: sendTemplated's suppression guard is SMS-only, which
  // is a real and separate finding, not something this test should paper over.
  assert.equal(res.email.sent, true);
  assert.deepEqual(base.messages.map((m) => m.channel), ["email"]);
});

test("the day-90 opt-out matters BECAUSE of the clock — one recorded at day 200 does not block", async () => {
  // The control. Without it, the test above would pass just as well against a
  // clock that never moved and an opt-out that was simply always present.
  const clock = createClock(0);
  const step = fakeStep(clock);
  const base = pgFake(n06Seed());
  const db = withOptOuts(base, clock, [{ clientId: "cl-1", channel: "sms", at: 200 * DAY }]);

  const res = await n06({ event: ev("round.funded", {}, { clientId: "cl-1" }), db, step });

  assert.equal(res.sms.sent, true, "an opt-out in the virtual future must not suppress");
  assert.equal(base.messages.length, 2);
});
