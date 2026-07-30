// Optimisation rule tests — the thresholds and their off-by-one neighbours.
//
// These are pure functions over a fabricated metrics series, so "3 consecutive
// days above target" can be tested against 2 days, 3 days, and 3-days-but-not-
// the-last-3 without a database. That last case is the one that matters: a rule
// counting any 3 good days in the window would scale a campaign that had a good
// week last month and has been losing money since.
//
// The ROAS-suppression tests are the other half. A campaign making money at a
// high CPM must not be throttled by a secondary metric — that is the single most
// common way an automated optimiser destroys a working campaign, and the spec
// calls it out explicitly.

import { test, describe } from "node:test";
import assert from "node:assert";
import { evaluate, stepBackUp, refreshCadenceFor } from "./rules.mjs";

const day = (over = {}) => ({
  date: "2026-07-01", spend_cents: 10000, roas: 1, cpa_cents: 5000,
  ctr: 3, frequency: 1.5, conversions: 2, ...over
});
const adSet = (over = {}) => ({ id: "as1", budget_cents: 10000, learning_until: null, rotated_at: null, ...over });

const rule = (params, active = true) => ({ active, params });
const byKey = (proposals, key) => proposals.find((p) => p.rule_key === key);

describe("the learning phase is never touched", () => {
  test("no rule fires while the ad set is learning", () => {
    const out = evaluate({
      adSet: adSet({ learning_until: "2099-01-01T00:00:00Z" }),
      series: [day({ roas: 5 }), day({ roas: 5 }), day({ roas: 5 })],
      rules: { scale_winner: rule({ target_roas: 1, consecutive_days: 3 }) },
      maxIncreasePct: 20
    });
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].rule_key, "learning_phase");
    assert.strictEqual(out[0].action, "none");
  });

  test("rules fire once the learning window has passed", () => {
    const out = evaluate({
      adSet: adSet({ learning_until: "2020-01-01T00:00:00Z" }),
      series: [day({ roas: 5 }), day({ roas: 5 }), day({ roas: 5 })],
      rules: { scale_winner: rule({ target_roas: 1, consecutive_days: 3 }) },
      maxIncreasePct: 20
    });
    assert.strictEqual(byKey(out, "scale_winner")?.action, "increase_budget");
  });
});

describe("scale_winner", () => {
  const rules = { scale_winner: rule({ target_roas: 2, consecutive_days: 3 }) };

  test("fires on exactly 3 consecutive days above target", () => {
    const out = evaluate({ adSet: adSet(), series: [day({ roas: 3 }), day({ roas: 3 }), day({ roas: 3 })], rules, maxIncreasePct: 20 });
    const p = byKey(out, "scale_winner");
    assert.strictEqual(p.action, "increase_budget");
    assert.strictEqual(p.to_budget_cents, 12000);   // 20% of 10000
  });

  test("does NOT fire on 2 days", () => {
    const out = evaluate({ adSet: adSet(), series: [day({ roas: 3 }), day({ roas: 3 })], rules, maxIncreasePct: 20 });
    assert.strictEqual(byKey(out, "scale_winner"), undefined);
  });

  test("does NOT fire when the good days are not the most recent ones", () => {
    // The case a sloppier implementation gets wrong: three good days followed by a
    // bad one is not a winner.
    const out = evaluate({
      adSet: adSet(),
      series: [day({ roas: 3 }), day({ roas: 3 }), day({ roas: 3 }), day({ roas: 0.5 })],
      rules, maxIncreasePct: 20
    });
    assert.strictEqual(byKey(out, "scale_winner"), undefined);
  });

  test("at-target counts as above target", () => {
    const out = evaluate({ adSet: adSet(), series: [day({ roas: 2 }), day({ roas: 2 }), day({ roas: 2 })], rules, maxIncreasePct: 20 });
    assert.strictEqual(byKey(out, "scale_winner")?.action, "increase_budget");
  });

  test("respects the partner's max_daily_increase_pct", () => {
    const out = evaluate({ adSet: adSet(), series: [day({ roas: 3 }), day({ roas: 3 }), day({ roas: 3 })], rules, maxIncreasePct: 10 });
    assert.strictEqual(byKey(out, "scale_winner").to_budget_cents, 11000);
  });

  test("never exceeds the hard cap of 30 even if config asks for more", () => {
    const out = evaluate({
      adSet: adSet(),
      series: [day({ roas: 3 }), day({ roas: 3 }), day({ roas: 3 })],
      rules: { scale_winner: rule({ target_roas: 2, consecutive_days: 3, hard_cap_pct: 80 }) },
      maxIncreasePct: 80
    });
    assert.strictEqual(byKey(out, "scale_winner").increase_pct, 30);
    assert.strictEqual(byKey(out, "scale_winner").to_budget_cents, 13000);
  });

  test("does nothing when no target is configured", () => {
    const out = evaluate({
      adSet: adSet(), series: [day({ roas: 9 }), day({ roas: 9 }), day({ roas: 9 })],
      rules: { scale_winner: rule({ consecutive_days: 3, target_roas: null }) }, maxIncreasePct: 20
    });
    assert.strictEqual(byKey(out, "scale_winner"), undefined);
  });

  test("an inactive rule does not run", () => {
    const out = evaluate({
      adSet: adSet(), series: [day({ roas: 9 }), day({ roas: 9 }), day({ roas: 9 })],
      rules: { scale_winner: rule({ target_roas: 2, consecutive_days: 3 }, false) }, maxIncreasePct: 20
    });
    assert.strictEqual(byKey(out, "scale_winner"), undefined);
  });
});

describe("ROAS is the primary trigger", () => {
  // The rule the spec states outright: do not pause or throttle on CPM or CTR
  // alone while ROAS is above target.
  const base = {
    adSet: adSet(),
    rules: {
      roas_primary: rule({ target_roas: 2 }),
      cpa_over_target: rule({ target_cpa_cents: 1000, cut_pct: 20 }),
      ctr_below_floor: rule({ floor_pct: 2, rotate_every_hours: 72 })
    },
    maxIncreasePct: 20
  };

  test("a budget cut is suppressed while ROAS is at or above target", () => {
    const out = evaluate({ ...base, series: [day({ roas: 5, cpa_cents: 9000, ctr: 0.5 })] });
    const cpa = byKey(out, "cpa_over_target");
    assert.strictEqual(cpa.action, "none");
    assert.match(cpa.reason, /ROAS is the primary trigger/);
  });

  test("the cut DOES happen when ROAS is below target", () => {
    const out = evaluate({ ...base, series: [day({ roas: 0.5, cpa_cents: 9000 })] });
    const cpa = byKey(out, "cpa_over_target");
    assert.strictEqual(cpa.action, "decrease_budget");
    assert.strictEqual(cpa.to_budget_cents, 8000);
  });

  test("creative rotation still fires while ROAS is healthy — it is not a throttle", () => {
    // Suppression covers pausing and cutting budget, not queueing creative.
    const out = evaluate({ ...base, series: [day({ roas: 5, ctr: 0.5, cpa_cents: 100 })] });
    assert.strictEqual(byKey(out, "ctr_below_floor")?.action, "rotate_creative");
  });

  test("an UNSET roas target suppresses nothing", () => {
    // "unknown" must not be read as "ROAS is fine", or an unconfigured partner
    // silently loses every secondary rule.
    const out = evaluate({
      ...base,
      rules: { ...base.rules, roas_primary: rule({ target_roas: null }) },
      series: [day({ roas: 5, cpa_cents: 9000 })]
    });
    assert.strictEqual(byKey(out, "cpa_over_target").action, "decrease_budget");
  });
});

describe("frequency bands", () => {
  const rules = { frequency_bands: rule({ no_action_below: 2, refresh_at_or_above: 3, sustained_days: 2 }) };

  test("under 2: no action", () => {
    const out = evaluate({ adSet: adSet(), series: [day({ frequency: 1.9 })], rules, maxIncreasePct: 20 });
    assert.strictEqual(byKey(out, "frequency_bands"), undefined);
  });

  test("2 to 3: queue fresh creative", () => {
    const out = evaluate({ adSet: adSet(), series: [day({ frequency: 2.5 })], rules, maxIncreasePct: 20 });
    assert.strictEqual(byKey(out, "frequency_bands").action, "queue_creative");
  });

  test("3+ on one day only is not yet sustained", () => {
    const out = evaluate({ adSet: adSet(), series: [day({ frequency: 1 }), day({ frequency: 3.5 })], rules, maxIncreasePct: 20 });
    assert.strictEqual(byKey(out, "frequency_bands").action, "queue_creative");
  });

  test("3+ sustained triggers a refresh", () => {
    const out = evaluate({ adSet: adSet(), series: [day({ frequency: 3.2 }), day({ frequency: 3.5 })], rules, maxIncreasePct: 20 });
    assert.strictEqual(byKey(out, "frequency_bands").action, "refresh_creative");
  });
});

describe("ctr_below_floor", () => {
  const rules = { ctr_below_floor: rule({ floor_pct: 2, rotate_every_hours: 72 }) };

  test("rotates when CTR is under the floor", () => {
    const out = evaluate({ adSet: adSet(), series: [day({ ctr: 1.2 })], rules, maxIncreasePct: 20 });
    assert.strictEqual(byKey(out, "ctr_below_floor").action, "rotate_creative");
  });

  test("does nothing at exactly the floor", () => {
    const out = evaluate({ adSet: adSet(), series: [day({ ctr: 2 })], rules, maxIncreasePct: 20 });
    assert.strictEqual(byKey(out, "ctr_below_floor"), undefined);
  });

  test("respects the 72-hour cadence rather than firing every daily run", () => {
    const recent = new Date(Date.now() - 10 * 36e5).toISOString();
    const out = evaluate({ adSet: adSet({ rotated_at: recent }), series: [day({ ctr: 1 })], rules, maxIncreasePct: 20 });
    assert.strictEqual(byKey(out, "ctr_below_floor"), undefined);
  });

  test("fires again once the cadence has elapsed", () => {
    const old = new Date(Date.now() - 100 * 36e5).toISOString();
    const out = evaluate({ adSet: adSet({ rotated_at: old }), series: [day({ ctr: 1 })], rules, maxIncreasePct: 20 });
    assert.strictEqual(byKey(out, "ctr_below_floor").action, "rotate_creative");
  });
});

describe("kill_no_conversions — the rule the spec said not to invent a number for", () => {
  test("does nothing when the spend floor is unset, even if activated", () => {
    // The important one. Somebody enabling the row without setting the number must
    // not cause campaigns to be paused against a guessed threshold.
    const out = evaluate({
      adSet: adSet(),
      series: [day({ conversions: 0, spend_cents: 999999 })],
      rules: { kill_no_conversions: rule({ spend_floor_cents: null }) }, maxIncreasePct: 20
    });
    assert.strictEqual(byKey(out, "kill_no_conversions"), undefined);
  });

  test("pauses once a configured floor is passed with zero conversions", () => {
    const out = evaluate({
      adSet: adSet(),
      series: [day({ conversions: 0, spend_cents: 30000 })],
      rules: { kill_no_conversions: rule({ spend_floor_cents: 20000 }) }, maxIncreasePct: 20
    });
    assert.strictEqual(byKey(out, "kill_no_conversions").action, "pause");
  });

  test("does not pause when there has been a conversion", () => {
    const out = evaluate({
      adSet: adSet(),
      series: [day({ conversions: 1, spend_cents: 30000 })],
      rules: { kill_no_conversions: rule({ spend_floor_cents: 20000 }) }, maxIncreasePct: 20
    });
    assert.strictEqual(byKey(out, "kill_no_conversions"), undefined);
  });
});

describe("stepBackUp", () => {
  test("steps up by the conservative end of the band once CPA recovers", () => {
    const p = stepBackUp({
      adSet: adSet(), series: [day({ cpa_cents: 900 })],
      params: { target_cpa_cents: 1000, recovery_step_min_pct: 10, recovery_step_max_pct: 20 },
      maxIncreasePct: 20
    });
    assert.strictEqual(p.to_budget_cents, 11000);
  });

  test("does nothing while CPA is still over target", () => {
    const p = stepBackUp({
      adSet: adSet(), series: [day({ cpa_cents: 2000 })],
      params: { target_cpa_cents: 1000 }, maxIncreasePct: 20
    });
    assert.strictEqual(p, null);
  });
});

describe("refreshCadenceFor — the unset tier table", () => {
  test("returns null when the table is empty, rather than a guessed cadence", () => {
    assert.strictEqual(refreshCadenceFor(500000, { tiers: [] }), null);
    assert.strictEqual(refreshCadenceFor(500000, {}), null);
  });

  test("picks the highest matching tier once configured", () => {
    const tiers = { tiers: [
      { daily_spend_cents_min: 0, refresh_every_hours: 168 },
      { daily_spend_cents_min: 100000, refresh_every_hours: 72 },
      { daily_spend_cents_min: 500000, refresh_every_hours: 24 }
    ] };
    assert.strictEqual(refreshCadenceFor(50000, tiers), 168);
    assert.strictEqual(refreshCadenceFor(100000, tiers), 72);
    assert.strictEqual(refreshCadenceFor(900000, tiers), 24);
  });
});
