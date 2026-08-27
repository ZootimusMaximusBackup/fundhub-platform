// Postgres entry for the definitive verification harness.
// Skips without DATABASE_URL. Writes docs/END-TO-END-VERIFICATION.md.
//
// This is VERIFICATION, not unit testing. Failures in the report are findings.
// The node:test wrapper only asserts that the harness itself completed.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { db, close } from "../db.mjs";
import { runVerification } from "./run-all.mjs";

const HAS_DB = !!process.env.DATABASE_URL;

/* src/verification/scratch-guard.mjs REFUSES a superuser or BYPASSRLS login, on
   purpose: "isolation checks would pass even when isolation is broken". The main
   pg suite connects as the table OWNER because ~14 files need ALTER TABLE, so
   this harness cannot run there and was reporting that refusal as a failure.

   Skipping with the reason stated is the honest outcome — the harness is run for
   real as fundhub_app, which is exactly what the guard is protecting. A silent
   `skip: true` would be the bad version; this names the identity it needs. */
async function privilegedLogin() {
  if (!HAS_DB) return false;
  try {
    const { rows } = await db.query(
      `SELECT EXISTS (
         SELECT 1 FROM pg_roles
          WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
       ) AS privileged`
    );
    return rows[0]?.privileged === true;
  } catch {
    return false;
  }
}

describe("end-to-end verification harness", {
  skip: !HAS_DB ? "no DATABASE_URL" : false
}, () => {
  test("runs all data-layer journeys and writes the report", async (t) => {
    if (await privilegedLogin()) {
      t.skip("this login is a superuser or bypasses RLS; the harness refuses it "
        + "by design (scratch-guard.mjs). Run as fundhub_app to exercise it.");
      return;
    }
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
