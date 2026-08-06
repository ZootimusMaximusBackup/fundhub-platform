import test from "node:test";
import assert from "node:assert/strict";
import {
  parseBureaus,
  stateEligible,
  sensitiveBureaus,
  matchLenders,
  lenderMatchCount
} from "./match.mjs";
import { isBureauMismatch, buildObservation } from "./observations.mjs";

test("parseBureaus normalizes common aliases", () => {
  assert.deepEqual(parseBureaus("EX / EQ"), ["EX", "EQ"]);
  assert.deepEqual(parseBureaus("experian, TransUnion"), ["EX", "TU"]);
});

test("stateEligible allows unknown sides", () => {
  assert.equal(stateEligible(null, "AZ"), true);
  assert.equal(stateEligible("AZ, NV", null), true);
  assert.equal(stateEligible("AZ, NV", "az"), true);
  assert.equal(stateEligible("CA", "AZ"), false);
});

test("sensitiveBureaus marks open inquiries", () => {
  const set = sensitiveBureaus([
    { bureau: "EX", status: "open" },
    { bureau: "TU", status: "cleared" }
  ]);
  assert.ok(set.has("EX"));
  assert.equal(set.has("TU"), false);
});

test("sensitiveBureaus: active case marks bureau hot; override clears it", () => {
  const hot = sensitiveBureaus([], {
    cases: [
      { selected_bureaus_raw: "TU", case_status: "Blocked" },
      { selected_bureaus_raw: "EX", case_status: "Queued", gate_override_by: "s1", gate_override_at: "2026-08-01" }
    ]
  });
  assert.ok(hot.has("TU"));
  assert.equal(hot.has("EX"), false, "owner override clears EX");
});

test("matchLenders: TU-blocked client still matches EQ lenders", () => {
  const result = matchLenders({
    lenders: [
      { id: "1", name: "EQ Bank", lender_table: "OnlineBizCC", active: true, priority_tier: 1, bureaus_pulled: "EQ", eligible_states: "AZ" },
      { id: "2", name: "TU Bank", lender_table: "OnlineBizCC", active: true, priority_tier: 1, bureaus_pulled: "TU", eligible_states: "AZ" }
    ],
    clientState: "AZ",
    inquiryLog: [],
    cases: [{ selected_bureaus_raw: "TU", case_status: "In Progress" }]
  });
  assert.equal(result.summary.match_count, 1);
  assert.equal(result.matches[0].name, "EQ Bank");
  assert.equal(result.skipped.find((s) => s.name === "TU Bank")?.reason, "inquiry_sensitive");
});

test("matchLenders filters by inquiry sensitivity and ranks by tier", () => {
  const result = matchLenders({
    lenders: [
      { id: "1", name: "A", lender_table: "OnlineBizCC", active: true, priority_tier: 2, bureaus_pulled: "EX", eligible_states: "AZ" },
      { id: "2", name: "B", lender_table: "OnlineBizCC", active: true, priority_tier: 1, bureaus_pulled: "TU", eligible_states: "AZ" },
      { id: "3", name: "C", lender_table: "OnlineBizCC", active: true, priority_tier: 1, bureaus_pulled: "EX", eligible_states: "AZ" }
    ],
    clientState: "AZ",
    inquiryLog: [{ bureau: "EX", status: "open" }]
  });
  assert.equal(result.summary.match_count, 1);
  assert.equal(result.matches[0].name, "B");
  assert.equal(lenderMatchCount({
    lenders: result.matches,
    clientState: "AZ",
    inquiryLog: []
  }), 1);
});

test("isBureauMismatch flags observed outside expected", () => {
  assert.equal(isBureauMismatch("EX/EQ", "TU"), true);
  assert.equal(isBureauMismatch("EX/EQ", "EX"), false);
  assert.equal(isBureauMismatch("", "EX"), true);
});

test("buildObservation sets mismatch_flag", () => {
  const row = buildObservation({
    expected_bureaus_raw: "EX",
    observed_bureau: "TU",
    observation_source: "manual"
  });
  assert.equal(row.mismatch_flag, true);
  assert.equal(row.review_status, "pending");
});
