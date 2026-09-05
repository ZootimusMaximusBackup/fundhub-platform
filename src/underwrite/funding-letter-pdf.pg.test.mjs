// F46, END TO END: FIVE deliverable rows must land in `documents`, not four.
//
// Nothing here is stubbed. It seeds a client, puts the repo's own `academy`
// simulated credit file behind it (scripts/sim/push-credit.mjs — the profile the
// 2026-09-03 manual walkthrough used, which tiers FULL_FUNDING), runs the REAL
// buildLetterPackForClient, and hands the pack to the REAL
// persistFundingLetterFiles. Then it reads the table.
//
// MEASURED before the fix, on a scratch Postgres 2026-09-05: the pack carried
// five analysis files including funding_summary / Capital-Readiness-Summary.pdf,
// and exactly four rows landed. The fifth was built and dropped.
//
// WHY THE `academy` PROFILE AND NOT src/demo/simulate-client.mjs's OWN FILE:
// the demo client tiers MANUAL_REVIEW, and buildDocuments() emits hold_notice +
// operator_checklist for that tier (build-documents.js:34-55) — no funding
// summary at all. The Capital Readiness Summary only exists on a funding tier,
// so a test that does not reach one proves nothing about F46.
//
// SKIPS with no DATABASE_URL, the convention every .pg.test.mjs here follows.
// Lives under src/ so npm test's glob actually runs it (CLAUDE.md §12).

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { buildPayload } from "../../scripts/sim/push-credit.mjs";
import { runTierEngineFromCrsResult } from "../finance/crs-tier.mjs";
import { buildLetterPackForClient } from "./letter-pack.mjs";
import { persistFundingLetterFiles } from "./funding-letter-pdf.mjs";
import { memoryProvider, createStore } from "../documents/store.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const EMAIL_TAG = "f46.fixture";

/** The five the client is promised. Four is the defect. */
const EXPECTED_SUBTYPES = [
  "bank_lender_match_list",
  "credit_analysis_report",
  "credit_optimization_roadmap",
  "funding_snapshot",
  "funding_summary"
];

describe("F46 end to end — five deliverables reach the documents table",
  { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
    let org, clientId, pack, stored;

    before(async () => {
      org = await resolveDefaultOrg(db);
      const email = `${EMAIL_TAG}.${Date.now()}@example.com`;
      // is_demo so the append-only document_versions trigger lets the fixture be
      // removed afterwards (db/migrations/150_demo_wipe_allow.sql).
      clientId = (await db.query(
        `INSERT INTO clients (org_id, email, first_name, last_name, is_demo)
         VALUES ($1,$2,'F46','Fixture',true) RETURNING id`, [org, email])).rows[0].id;

      const payload = buildPayload("academy", { email, name: "F46 Fixture" });
      const tier = runTierEngineFromCrsResult(payload, {
        submittedName: "F46 Fixture", submittedAddress: ""
      });
      assert.equal(tier.outcome, "FULL_FUNDING",
        "the academy profile must tier for funding or this proves nothing");
      await db.query(
        `INSERT INTO crs_results (org_id, client_id, result, outcome_tier)
         VALUES ($1,$2,$3::jsonb,$4)`,
        [org, clientId, JSON.stringify(payload), tier.outcome]);

      pack = await buildLetterPackForClient(db, { clientId, pack: "funding" });
      stored = await persistFundingLetterFiles(db, createStore(memoryProvider()), {
        orgId: org, clientId, files: pack.files || [], generatedBy: "f46-pg-test"
      });
    });

    after(async () => {
      if (!HAVE_DB) return;
      await db.query(`DELETE FROM clients WHERE id = $1`, [clientId]).catch(() => {});
      await close();
    });

    test("the pack itself carries the Capital Readiness Summary", () => {
      assert.equal(pack.reason, null, `pack failed: ${pack.reason}`);
      const types = (pack.files || []).map((f) => f.type);
      assert.ok(types.includes("funding_summary"),
        `the pack has no funding_summary file — types were ${JSON.stringify(types)}`);
      const summary = pack.files.find((f) => f.type === "funding_summary");
      assert.equal(summary.filename, "Capital-Readiness-Summary.pdf");
    });

    test("the saver stores five, not four", () => {
      assert.equal(stored.skipped, null);
      assert.equal(stored.stored.length, 5);
    });

    test("five deliverable rows are in the table, one per subtype", async () => {
      const { rows } = await db.query(
        `SELECT subtype, title, mime_type FROM documents
          WHERE org_id = $1 AND client_id = $2 AND kind = 'deliverable'
          ORDER BY subtype`, [org, clientId]);
      assert.deepEqual(rows.map((r) => r.subtype), EXPECTED_SUBTYPES);
      const summary = rows.find((r) => r.subtype === "funding_summary");
      assert.equal(summary.title, "Capital Readiness Summary");
      assert.equal(summary.mime_type, "application/pdf");
    });

    test("the stored summary has real bytes behind it", async () => {
      const { rows } = await db.query(
        `SELECT byte_size, storage_key FROM documents
          WHERE org_id = $1 AND client_id = $2 AND subtype = 'funding_summary'`,
        [org, clientId]);
      assert.equal(rows.length, 1);
      assert.ok(rows[0].storage_key, "no storage key — nothing was actually stored");
      assert.ok(Number(rows[0].byte_size) > 0, "the summary was stored empty");
    });
  });
