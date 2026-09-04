import test from "node:test";
import assert from "node:assert/strict";
import {
  parseBureaus,
  stateEligible,
  resolveMatchState,
  resolveCreditProfile,
  lenderMinScore,
  mentionsCreditScore,
  scoreForLender,
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

/* ─────────────────── THE CREDIT FILE (funding finding 7) ───────────────────
   Before this, a 588 repair file and a 780 funding file got the identical
   lender list, and a lender who only takes 700+ matched both. */

const CREDIT_588 = resolveCreditProfile({ scores: { EX: 588, EQ: 592, TU: 585 } });
const CREDIT_780 = resolveCreditProfile({ scores: { EX: 780, EQ: 776, TU: 782 } });

function lender(over = {}) {
  return {
    id: "L", name: "Bank", lender_table: "OnlineBizCC", active: true,
    priority_tier: 1, eligible_states: "AZ", ...over
  };
}

test("resolveCreditProfile: a tier with no score is not an available file", () => {
  const none = resolveCreditProfile({ tier: "Tier 2", fundingEstimate: 199350 });
  assert.equal(none.available, false, "a tier alone cannot exclude a lender on score");
  assert.equal(none.best_score, null);
  assert.equal(none.funding_estimate, 199350, "the estimate still survives");
});

test("resolveCreditProfile keeps the best bureau and drops out-of-range numbers", () => {
  const p = resolveCreditProfile({ scores: { ex: 701, eq: 42, tu: null }, utilizationPct: 65 });
  assert.equal(p.available, true);
  assert.equal(p.best_score, 701);
  assert.equal(p.scores.EQ, null, "42 is not a FICO score");
  assert.equal(p.utilization_pct, 65);
});

test("lenderMinScore reads a stated floor, in several wordings", () => {
  assert.equal(lenderMinScore({ stated_requirements: "Minimum credit score 700." }).min, 700);
  assert.equal(lenderMinScore({ stated_requirements: "Requires a FICO of 680" }).min, 680);
  assert.equal(lenderMinScore({ stated_requirements: "FICO 720+" }).min, 720);
  assert.equal(lenderMinScore({ stated_requirements: "credit score 660 or higher" }).min, 660);
  assert.equal(lenderMinScore({ stated_requirements: "700+ FICO preferred" }).min, 700);
});

test("lenderMinScore prefers a real numeric column when one exists", () => {
  const r = lenderMinScore({ minimum_credit_score: 690, stated_requirements: "FICO 720+" });
  assert.equal(r.min, 690);
  assert.equal(r.source, "column");
});

test("lenderMinScore takes the LOWEST readable floor — never over-exclude", () => {
  const r = lenderMinScore({
    stated_requirements: "FICO 720+ for the best limits; minimum credit score 660 to apply."
  });
  assert.equal(r.min, 660);
});

/* THE REAL TABLE. These are the wordings that are actually in
   credentials/lenders-audit/lenders-audited.csv. None of them is a credit
   floor, and reading one as a number would hide a real lender from a real
   client. */
test("lenderMinScore refuses to invent a floor out of the wording we really have", () => {
  for (const text of [
    "Checking account + 30-day seasoning required.",
    "2+ years business age recommended. Checking helps.",
    "No business checking required. Do NOT use a VPN.",
    "The 1 in 8 Rule & 2 in 65 Rule set by Citi ensures a controlled application process",
    "First Citizens Bank – 0% for 9 months, must apply in branch. Optional BLOC if $5k–$25k is deposited.",
    "",
    null
  ]) {
    const r = lenderMinScore({ stated_requirements: text });
    assert.equal(r.min, null, `invented a floor from: ${text}`);
    assert.equal(r.unreadable, false, `wrongly called it a score mention: ${text}`);
  }
});

test("a negated minimum is not a minimum", () => {
  assert.equal(lenderMinScore({ stated_requirements: "No minimum credit score 700 rule here" }).min, null);
});

test("wording that talks about a score but will not parse is flagged, not guessed", () => {
  const r = lenderMinScore({ stated_requirements: "Credit score band 640-700 depending on branch mood" });
  assert.equal(r.min, null, "an unreadable requirement must never become a number");
  assert.equal(r.unreadable, true);
  assert.equal(mentionsCreditScore("Credit score band 640-700"), true);
  assert.equal(mentionsCreditScore("Business checking required"), false);
});

test("scoreForLender uses the bureau the lender pulls, else the best score", () => {
  assert.equal(scoreForLender(["EQ"], CREDIT_588), 592, "EQ lender is judged on EQ");
  assert.equal(scoreForLender([], CREDIT_588), 592, "no bureau named — best score");
  assert.equal(scoreForLender(["EX"], null), null, "no credit file, no score");
});

test("matchLenders keeps a lender above the file and skips one below it", () => {
  const lenders = [
    lender({ id: "hi", name: "Prime Bank", stated_requirements: "Minimum credit score 700." }),
    lender({ id: "lo", name: "Starter Bank", stated_requirements: "Minimum credit score 560." })
  ];
  const r = matchLenders({ lenders, clientState: "AZ", credit: CREDIT_588 });
  assert.deepEqual(r.matches.map((m) => m.id), ["lo"]);
  const refused = r.skipped.find((s) => s.id === "hi");
  assert.equal(refused.reason, "score_below_minimum");
  assert.equal(refused.minimum_score, 700);
  assert.equal(refused.file_score, 592);
  assert.equal(r.summary.credit.lenders_excluded_on_score, 1);
  assert.equal(r.summary.credit.lenders_with_stated_minimum, 2);
});

test("the 588 file and the 780 file no longer get the identical list", () => {
  const lenders = [
    lender({ id: "hi", name: "Prime Bank", stated_requirements: "Minimum credit score 700." }),
    lender({ id: "lo", name: "Starter Bank", stated_requirements: "Minimum credit score 560." })
  ];
  const repair = matchLenders({ lenders, clientState: "AZ", credit: CREDIT_588 });
  const funding = matchLenders({ lenders, clientState: "AZ", credit: CREDIT_780 });
  assert.equal(repair.summary.match_count, 1);
  assert.equal(funding.summary.match_count, 2);
});

test("an unreadable requirement KEEPS the lender", () => {
  const lenders = [
    lender({ id: "u", name: "Vague Bank", stated_requirements: "Credit score band 640-700, ask the branch" })
  ];
  const r = matchLenders({ lenders, clientState: "AZ", credit: CREDIT_588 });
  assert.deepEqual(r.matches.map((m) => m.id), ["u"], "a lender we cannot read is not one we may exclude");
  assert.equal(r.summary.credit.lenders_with_unreadable_requirement, 1);
  assert.equal(r.summary.credit.lenders_excluded_on_score, 0);
});

test("no credit file means the score gate does not run, and the summary says so", () => {
  const lenders = [
    lender({ id: "hi", name: "Prime Bank", stated_requirements: "Minimum credit score 700." })
  ];
  const r = matchLenders({ lenders, clientState: "AZ" });
  assert.equal(r.summary.match_count, 1, "no pull cannot silently exclude anyone");
  assert.equal(r.summary.credit.available, false);
  assert.equal(r.summary.credit.lenders_excluded_on_score, 0);
});

/* Today's table, in miniature: nothing states a minimum, so the count is
   exactly what it was before this change. That is the correct result and the
   summary has to make it visible rather than imply a screen happened. */
test("with no stated minimums the credit gate excludes nobody", () => {
  const lenders = [
    lender({ id: "a", name: "A", stated_requirements: "No business checking required." }),
    lender({ id: "b", name: "B", stated_requirements: "" })
  ];
  const r = matchLenders({ lenders, clientState: "AZ", credit: CREDIT_588 });
  assert.equal(r.summary.match_count, 2);
  assert.equal(r.summary.credit.lenders_with_stated_minimum, 0);
  assert.equal(r.summary.credit.available, true);
});

test("a state-refused lender is never also reported as a credit refusal", () => {
  const lenders = [
    lender({ id: "x", name: "CA Only", eligible_states: "CA", stated_requirements: "Minimum credit score 700." })
  ];
  const r = matchLenders({ lenders, clientState: "AZ", credit: CREDIT_588 });
  assert.equal(r.skipped.length, 1);
  assert.equal(r.skipped[0].reason, "state_ineligible");
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
