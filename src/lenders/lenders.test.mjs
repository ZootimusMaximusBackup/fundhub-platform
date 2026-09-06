import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLenderCsv, serializeLenderCsv } from "./csv.mjs";
import {
  parseBureaus,
  stateEligible,
  sensitiveBureaus,
  matchLenders,
  lenderMatchCount
} from "./match.mjs";
import { matchForClient } from "./store.mjs";
import { isBureauMismatch, buildObservation } from "./observations.mjs";
import { LENDER_TABLES } from "./tables.mjs";

test("LENDER_TABLES match Airtable APPLICATIONS single-select exactly", () => {
  assert.deepEqual([...LENDER_TABLES], [
    "OnlineBizCC",
    "InBranchBizCC",
    "BizLOC_Stated",
    "BizLOC_Documented",
    "PersonalCC",
    "PersonalLoans",
    "PersonalLOC"
  ]);
});

test("parseBureaus normalizes EX/EQ/TU aliases", () => {
  assert.deepEqual(parseBureaus("EX/EQ"), ["EX", "EQ"]);
  assert.deepEqual(parseBureaus("Experian, TransUnion"), ["EX", "TU"]);
});

test("stateEligible includes unknown coverage and rejects clear misses", () => {
  assert.equal(stateEligible("", "AZ"), true);
  assert.equal(stateEligible("AZ, CA, NV", "AZ"), true);
  assert.equal(stateEligible("CA, NV", "AZ"), false);
  assert.equal(stateEligible("All States", "AZ"), true);
});

test("sensitiveBureaus flags open inquiry bureaus", () => {
  const s = sensitiveBureaus([
    { bureau: "EX", status: "open" },
    { bureau: "EQ", status: "cleared" }
  ]);
  assert.equal(s.has("EX"), true);
  assert.equal(s.has("EQ"), false);
});

test("matchLenders skips inquiry-sensitive and inactive, ranks by tier then rotation", () => {
  const lenders = [
    { id: "1", name: "A", lender_table: "OnlineBizCC", active: true, priority_tier: 2, bureaus_pulled: "EX", eligible_states: "AZ" },
    { id: "2", name: "B", lender_table: "OnlineBizCC", active: true, priority_tier: 1, bureaus_pulled: "EQ", eligible_states: "AZ" },
    { id: "3", name: "C", lender_table: "OnlineBizCC", active: true, priority_tier: 1, bureaus_pulled: "EX", eligible_states: "AZ" },
    { id: "4", name: "D", lender_table: "OnlineBizCC", active: false, priority_tier: 1, bureaus_pulled: "TU", eligible_states: "AZ" },
    { id: "5", name: "E", lender_table: "PersonalCC", active: true, priority_tier: 1, bureaus_pulled: "TU", eligible_states: "AZ" }
  ];
  const r = matchLenders({
    lenders,
    clientState: "AZ",
    inquiryLog: [{ bureau: "EX", status: "open" }],
    lenderTable: "OnlineBizCC"
  });
  assert.equal(r.summary.match_count, 1);
  assert.equal(r.matches[0].name, "B");
  assert.ok(r.skipped.some((s) => s.reason === "inquiry_sensitive"));
  assert.ok(r.skipped.some((s) => s.reason === "inactive"));
  assert.equal(lenderMatchCount({
    lenders,
    clientState: "AZ",
    inquiryLog: [{ bureau: "EX", status: "open" }],
    lenderTable: "OnlineBizCC"
  }), 1);
});

test("matchLenders never invents rows — empty list stays empty", () => {
  const r = matchLenders({ lenders: [], clientState: "AZ" });
  assert.equal(r.summary.match_count, 0);
  assert.deepEqual(r.matches, []);
});

test("matchForClient uses company state when the person row has none", async () => {
  const lenders = [
    { id: "1", name: "All", lender_table: "OnlineBizCC", active: true, priority_tier: 1, bureaus_pulled: "EQ", eligible_states: "All States", is_demo: false },
    { id: "2", name: "Texas", lender_table: "OnlineBizCC", active: true, priority_tier: 1, bureaus_pulled: "EQ", eligible_states: "TX", is_demo: false },
    { id: "3", name: "NewYork", lender_table: "OnlineBizCC", active: true, priority_tier: 1, bureaus_pulled: "EQ", eligible_states: "NY", is_demo: false }
  ];
  const db = {
    async query(sql) {
      const s = String(sql);
      if (s.includes("FROM clients")) return { rows: [{ id: "c1", custom_fields: {} }] };
      if (s.includes("FROM businesses")) return { rows: [{ entity_data: { state: "TX" } }] };
      if (s.includes("FROM crs_results")) return { rows: [] };
      if (s.includes("FROM inquiry_log")) return { rows: [] };
      if (s.includes("FROM inquiry_removal_cases")) return { rows: [] };
      if (s.includes("demo_mode_enabled")) return { rows: [{ demo_mode_enabled: false }] };
      if (s.includes("FROM lenders")) return { rows: lenders };
      throw new Error("unexpected sql: " + s);
    }
  };
  const r = await matchForClient(db, { orgId: "o1", clientId: "c1" });
  assert.equal(r.summary.client_state, "TX");
  assert.deepEqual(r.matches.map((m) => m.name).sort(), ["All", "Texas"]);
  assert.equal(r.summary.credit.available, false, "no crs row is not a credit file");
});

/* matchForClient must carry the credit file into the match, not just the state
   (funding finding 7). The crs payload shape here is the one the analyzer
   really stores — src/handlers/client-lifecycle.mjs writes the
   analysis.completed payload into crs_results.result. */
test("matchForClient reads the newest credit pull and screens on it", async () => {
  const lenders = [
    { id: "hi", name: "Prime", lender_table: "OnlineBizCC", active: true, priority_tier: 1, eligible_states: "All States", stated_requirements: "Minimum credit score 700.", is_demo: false },
    { id: "lo", name: "Starter", lender_table: "OnlineBizCC", active: true, priority_tier: 1, eligible_states: "All States", stated_requirements: "Minimum credit score 560.", is_demo: false }
  ];
  const db = {
    async query(sql) {
      const s = String(sql);
      if (s.includes("FROM clients")) {
        return { rows: [{ id: "c1", custom_fields: { total_funding_estimate: 199350 } }] };
      }
      if (s.includes("FROM businesses")) return { rows: [{ entity_data: { state: "TX" } }] };
      if (s.includes("FROM crs_results")) {
        return {
          rows: [{
            outcome_tier: "Tier 3",
            created_at: "2026-09-01T00:00:00Z",
            result: { scores: { ex: 588, eq: 592, tu: 585 }, utilization: 84 }
          }]
        };
      }
      if (s.includes("FROM inquiry_log")) return { rows: [] };
      if (s.includes("FROM inquiry_removal_cases")) return { rows: [] };
      if (s.includes("demo_mode_enabled")) return { rows: [{ demo_mode_enabled: false }] };
      if (s.includes("FROM lenders")) return { rows: lenders };
      throw new Error("unexpected sql: " + s);
    }
  };
  const r = await matchForClient(db, { orgId: "o1", clientId: "c1" });
  assert.equal(r.summary.credit.available, true);
  assert.equal(r.summary.credit.best_score, 592);
  assert.equal(r.summary.credit.tier, "Tier 3");
  assert.equal(r.summary.credit.utilization_pct, 84);
  assert.equal(r.summary.credit.funding_estimate, 199350);
  assert.deepEqual(r.matches.map((m) => m.name), ["Starter"]);
  assert.equal(r.skipped.find((x) => x.id === "hi").reason, "score_below_minimum");
});

/* TWO LANES, END TO END from the database shapes matchForClient really reads:
   the personal address the soft-pull consent form stores on pii_identity, and
   the business row the same form writes. Lives in Arizona, business in
   Florida — both lanes must open. */
test("matchForClient opens both lanes: home state from the stored personal address", async () => {
  const lenders = [
    { id: "n", name: "National", lender_table: "OnlineBizCC", active: true, priority_tier: 1, bureaus_pulled: "EQ", eligible_states: "All States", is_demo: false },
    { id: "a", name: "Arizona Local", lender_table: "OnlineBizCC", active: true, priority_tier: 1, bureaus_pulled: "EQ", eligible_states: "AZ", is_demo: false },
    { id: "f", name: "Florida Local", lender_table: "OnlineBizCC", active: true, priority_tier: 1, bureaus_pulled: "EQ", eligible_states: "FL", is_demo: false },
    { id: "t", name: "Texas Local", lender_table: "OnlineBizCC", active: true, priority_tier: 1, bureaus_pulled: "EQ", eligible_states: "TX", is_demo: false }
  ];
  const db = {
    async query(sql) {
      const s = String(sql);
      if (s.includes("FROM clients")) return { rows: [{ id: "c1", custom_fields: {} }] };
      if (s.includes("FROM businesses")) return { rows: [{ entity_data: { state: "FL", city: "Miami" } }] };
      if (s.includes("FROM pii_identity")) {
        return { rows: [{ addresses: [{ addressLine1: "1 Main St", city: "Phoenix", state: "AZ" }] }] };
      }
      if (s.includes("FROM crs_results")) return { rows: [] };
      if (s.includes("FROM inquiry_log")) return { rows: [] };
      if (s.includes("FROM inquiry_removal_cases")) return { rows: [] };
      if (s.includes("demo_mode_enabled")) return { rows: [{ demo_mode_enabled: false }] };
      if (s.includes("FROM lenders")) return { rows: lenders };
      throw new Error("unexpected sql: " + s);
    }
  };
  const r = await matchForClient(db, { orgId: "o1", clientId: "c1" });
  assert.equal(r.summary.home_state, "AZ");
  assert.equal(r.summary.business_state, "FL");
  assert.deepEqual(
    r.matches.map((m) => m.name).sort(),
    ["Arizona Local", "Florida Local", "National"]
  );
  assert.equal(r.skipped.find((x) => x.id === "t").reason, "state_ineligible");
  assert.deepEqual(r.lanes.home.lenders.map((m) => m.name), ["Arizona Local"]);
  assert.deepEqual(r.lanes.business.lenders.map((m) => m.name), ["Florida Local"]);
});

test("matchForClient with no identity row loses no lender — unknown home is not a block", async () => {
  const lenders = [
    { id: "f", name: "Florida Local", lender_table: "OnlineBizCC", active: true, priority_tier: 1, bureaus_pulled: "EQ", eligible_states: "FL", is_demo: false }
  ];
  const db = {
    async query(sql) {
      const s = String(sql);
      if (s.includes("FROM clients")) return { rows: [{ id: "c1", custom_fields: {} }] };
      if (s.includes("FROM businesses")) return { rows: [{ entity_data: { state: "FL" } }] };
      if (s.includes("FROM pii_identity")) return { rows: [] };
      if (s.includes("FROM crs_results")) return { rows: [] };
      if (s.includes("FROM inquiry_log")) return { rows: [] };
      if (s.includes("FROM inquiry_removal_cases")) return { rows: [] };
      if (s.includes("demo_mode_enabled")) return { rows: [{ demo_mode_enabled: false }] };
      if (s.includes("FROM lenders")) return { rows: lenders };
      throw new Error("unexpected sql: " + s);
    }
  };
  const r = await matchForClient(db, { orgId: "o1", clientId: "c1" });
  assert.equal(r.summary.home_state, null, "unknown stays unknown");
  assert.equal(r.summary.client_state, "FL");
  assert.deepEqual(r.matches.map((m) => m.name), ["Florida Local"]);
});

test("CSV round-trip keeps lender_table and name", () => {
  const csv = serializeLenderCsv([
    {
      lender_table: "BizLOC_Stated",
      name: "Example Bank",
      logo_path: "/assets/lenders/example-bank.png",
      bureaus_pulled: "EQ",
      priority_tier: 2,
      active: true
    }
  ]);
  const { rows, errors } = parseLenderCsv(csv);
  assert.equal(errors.length, 0);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].lender_table, "BizLOC_Stated");
  assert.equal(rows[0].name, "Example Bank");
  assert.equal(rows[0].logo_path, "/assets/lenders/example-bank.png");
  assert.equal(rows[0].priority_tier, 2);
});

test("CSV rejects unknown lender_table without inventing a row", () => {
  const { rows, errors } = parseLenderCsv(
    "lender_table,name\nNotARealTable,Fake Bank\n"
  );
  assert.equal(rows.length, 0);
  assert.ok(errors.some((e) => /invalid lender_table/i.test(e)));
});

test("observation mismatch when observed bureau not in expected", () => {
  assert.equal(isBureauMismatch("EX/EQ", "TU"), true);
  assert.equal(isBureauMismatch("EX/EQ", "EX"), false);
  const row = buildObservation({
    expected_bureaus_raw: "EX",
    observed_bureau: "TU",
    observation_source: "bank_response"
  });
  assert.equal(row.mismatch_flag, true);
  assert.equal(row.review_status, "pending");
});
