// Postgres entry for the definitive verification harness.
// Skips without DATABASE_URL. Writes docs/END-TO-END-VERIFICATION.md.
//
// This is VERIFICATION, not unit testing. Failures in the report are findings.
// The node:test wrapper only asserts that the harness itself completed.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { close } from "../db.mjs";
import { runVerification } from "./run-all.mjs";

const HAS_DB = !!process.env.DATABASE_URL;

describe("end-to-end verification harness", {
  skip: !HAS_DB ? "no DATABASE_URL" : false
}, () => {
  test("runs all data-layer journeys and writes the report", async () => {
    const result = await runVerification({ write: true });
    assert.ok(result.summary.total > 0, "harness produced assertions");
    assert.ok(result.reportPath, "report path returned");
    // Do NOT assert all PASS — the point is to surface FAIL/SILENT findings.
    console.log("[verify] tallies", result.summary.tallies, "p0", result.summary.p0);
  });

  test("closes db pool", async () => {
    await close();
  });
});
