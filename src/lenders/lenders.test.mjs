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
