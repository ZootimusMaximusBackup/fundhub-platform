import test from "node:test";
import assert from "node:assert/strict";
import {
  parseBureaus,
  stateEligible,
  resolveMatchState,
  sensitiveBureaus,
  matchLenders,
  lenderMatchCount
} from "./match.mjs";
import { isBureauMismatch, buildObservation } from "./observations.mjs";

test("parseBureaus normalizes common aliases", () => {
  assert.deepEqual(parseBureaus("EX / EQ"), ["EX", "EQ"]);
  assert.deepEqual(parseBureaus("experian, TransUnion"), ["EX", "TU"]);
});

test("resolveMatchState reads company state before person custom fields", () => {
  assert.equal(
    resolveMatchState({ business_state: "AZ" }, [{ entity_data: { state: "TX" } }]),
    "TX"
  );
  assert.equal(
    resolveMatchState({}, [{ entity_data: { city: "Austin" } }, { entity_data: { state: "TX" } }]),
    "TX"
  );
  assert.equal(resolveMatchState({ business_state: "TX" }, []), "TX");
  assert.equal(resolveMatchState({ home_state: "OK" }, []), "OK");
  assert.equal(resolveMatchState({}, []), null);
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

/* The gate. Default is exclude — a real client on a real call must never be
   read a sample lender, whatever assembled the array. */
const DEMO_AND_REAL = [
  { id: "r1", name: "Real Bank", lender_table: "OnlineBizCC", active: true, priority_tier: 1, bureaus_pulled: "EQ", eligible_states: "AZ" },
  { id: "d1", name: "Sample Bank", lender_table: "OnlineBizCC", active: true, priority_tier: 1, bureaus_pulled: "EX", eligible_states: "AZ", is_demo: true },
  { id: "d2", name: "Sample Card Co", lender_table: "OnlineBizCC", active: true, priority_tier: 2, bureaus_pulled: "TU", eligible_states: "AZ", is_demo: true }
];

test("matchLenders excludes is_demo rows by default", () => {
  const r = matchLenders({ lenders: DEMO_AND_REAL, clientState: "AZ" });
  assert.equal(r.summary.match_count, 1);
  assert.deepEqual(r.matches.map((m) => m.id), ["r1"]);
  assert.equal(r.summary.lender_count, 1, "demo rows are not counted as considered");
});

test("matchLenders never names an excluded demo row in `skipped`", () => {
  const r = matchLenders({ lenders: DEMO_AND_REAL, clientState: "AZ" });
  const leaked = [...r.matches, ...r.skipped].filter((x) => String(x.id).startsWith("d"));
  assert.deepEqual(leaked, [], "a demo lender must be absent, not listed as refused");
});

test("matchLenders includes is_demo rows when Demo Mode is on", () => {
  const r = matchLenders({ lenders: DEMO_AND_REAL, clientState: "AZ", includeDemo: true });
  assert.equal(r.summary.match_count, 3);
  assert.deepEqual(r.matches.map((m) => m.id).sort(), ["d1", "d2", "r1"]);
});

test("matchLenders demo gate composes with the bureau gate, not around it", () => {
  // Demo Mode on, TU hot: the demo TU row is dropped for the inquiry, not for
  // being demo, and the demo EX row still comes back.
  const r = matchLenders({
    lenders: DEMO_AND_REAL,
    clientState: "AZ",
    includeDemo: true,
    inquiryLog: [{ bureau: "TU", status: "open" }]
  });
  assert.deepEqual(r.matches.map((m) => m.id).sort(), ["d1", "r1"]);
  assert.equal(r.skipped.find((s) => s.id === "d2")?.reason, "inquiry_sensitive");
});

test("lenderMatchCount honours the demo gate", () => {
  assert.equal(lenderMatchCount({ lenders: DEMO_AND_REAL, clientState: "AZ" }), 1);
  assert.equal(lenderMatchCount({ lenders: DEMO_AND_REAL, clientState: "AZ", includeDemo: true }), 3);
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
