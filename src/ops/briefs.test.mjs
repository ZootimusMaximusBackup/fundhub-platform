import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ceoBrief, ownerBrief, briefsFromPulse } from "./briefs.mjs";

const pulse = {
  kpis: {
    new_clients: 2,
    booked_count: 8,
    show_rate: 0.5,
    close_rate: 0.25,
    cash_collected_cents: 200000,
    funded_count: 1,
    funded_amount_cents: 1000000,
    cost_per_funded_cents: null,
    cost_per_funded_reason: "ad_spend_unavailable"
  },
  company_8: {
    new_clients: { value: 2, missing: false },
    booked_calls: { value: 8, missing: false },
    show_rate: { value: 0.5, missing: false },
    close_rate: { value: 0.25, missing: false },
    cash_cents: { value: 200000, missing: false },
    funded_count: { value: 1, missing: false },
    funded_dollars_cents: { value: 1000000, missing: false },
    cost_per_funded_cents: { value: null, missing: true, reason: "ad_spend_unavailable" }
  },
  bars: {
    closer: { target: 20, actual: 4, missing: null },
    funding_advisor: { target: 20, actual: null, missing: "funded_files_not_available" }
  },
  calendar: {
    packed: true,
    reason: "at_or_over_threshold",
    closer_count: 1,
    due_at_count: 45,
    slots_per_closer_day: 10,
    window_weekdays: 5,
    threshold: 45
  },
  hire: {
    recommend: true,
    existing_task_id: null,
    linkedin: { status: "not_configured" },
    profile: {
      seat: "closer",
      linkedin: true,
      lines: ["Seat: closer.", "Do not hire a setter."]
    }
  },
  gaps: {
    has_short: true,
    notes: ["Closer deposits this month 4 are under the starting bar of 20."]
  },
  ads: { status: "not_configured", spend_cents: null },
  fire: { auto_enqueue: false, rule_locked: false, note: "no fire rule yet" },
  raise: { auto_enqueue: false, rule_locked: false, note: "no raise rule yet" },
  bonus: { auto_enqueue: false, rule_locked: false, note: "no bonus rule yet" }
};

describe("briefs", () => {
  it("CEO voice asks what needs doing and does not invent a fire", () => {
    const text = ceoBrief(pulse);
    assert.match(text, /What needs doing today\?/);
    assert.match(text, /Hire a pod/);
    assert.match(text, /Do not hire a setter/);
    assert.match(text, /Cost per funded is missing/);
    assert.match(text, /no fire rule yet/);
    assert.match(text, /no raise rule yet/);
    assert.match(text, /no bonus rule yet/);
    assert.match(text, /starting bar of 20/);
    assert.match(text, /Ad spend is not_configured/);
    assert.match(text, /Discoveries: none yet/);
    assert.doesNotMatch(text, /fire this closer/i);
    assert.doesNotMatch(text, /under 20 deposits/);
  });

  it("owner voice says what will be done and keeps invite as the login path", () => {
    const text = ownerBrief(pulse);
    assert.match(text, /What will be done/);
    assert.match(text, /Create one hire-pod task/);
    assert.match(text, /LinkedIn: not_configured/);
    assert.match(text, /invite/);
    assert.match(text, /does not create a login/);
    assert.match(text, /No fire rule yet/);
    assert.match(text, /No raise rule yet/);
    assert.match(text, /No bonus rule yet/);
    assert.doesNotMatch(text, /suspend/);
  });

  it("says a number is missing instead of inventing it", () => {
    const empty = briefsFromPulse({
      company_8: {
        new_clients: { value: null, missing: true },
        booked_calls: { value: null, missing: true },
        show_rate: { value: null, missing: true },
        close_rate: { value: null, missing: true },
        cash_cents: { value: null, missing: true },
        funded_count: { value: null, missing: true },
        funded_dollars_cents: { value: null, missing: true },
        cost_per_funded_cents: { value: null, missing: true }
      },
      calendar: { packed: false, reason: "no_closer_due_at", window_weekdays: 5 },
      hire: { recommend: false, linkedin: { status: "none" } },
      fire: { rule_locked: false }
    });
    assert.match(empty.ceo, /New clients is missing/);
    assert.match(empty.ceo, /not packed/);
    assert.match(empty.owner, /Do not create a hire task/);
  });
});
