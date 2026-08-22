#!/usr/bin/env node
// Definitive end-to-end verification harness entrypoint.
// Real DB. Real handlers. Adapters dry-run. Nothing transmits. Report only.

import fs from "node:fs";
import { db, close } from "../db.mjs";
import { createCollector } from "./assert.mjs";
import { writeReport } from "./report.mjs";
import { setupContext, wipeVerifyArtifacts, wipeClientTree, applyDryRunEnv } from "./fixtures.mjs";
import { assertHarnessSafe } from "./scratch-guard.mjs";
import { runFundingJourney } from "./journeys/funding.mjs";
import { runDiyJourney } from "./journeys/diy.mjs";
import { runInquiryJourney } from "./journeys/inquiry.mjs";
import { runAgentJourney } from "./journeys/agent.mjs";
import { runIdempotencyJourney } from "./journeys/idempotency.mjs";
import { runAdversarialJourney } from "./journeys/adversarial.mjs";
import { runWorkflowJourney } from "./journeys/workflows.mjs";
import { runSecurityJourney } from "./journeys/security.mjs";
import { runCrossCutting } from "./journeys/cross-cutting.mjs";

function dbHostLabel() {
  try {
    const u = process.env.DATABASE_URL || "";
    const parsed = new URL(u.replace(/^postgresql:/, "http:").replace(/^postgres:/, "http:"));
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return "(unparsed)";
  }
}

export async function runVerification({ write = true } = {}) {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL required for verification harness");
  }
  applyDryRunEnv();
  const collector = createCollector();
  const journeyNotes = [];
  const verdicts = [];
  const allClientIds = [];
  let ctx;

  try {
    // Refuse live companies and privileged logins BEFORE setupContext writes.
    await assertHarnessSafe(db);
    ctx = await setupContext(db);

    const runners = [
      ["funding", runFundingJourney],
      ["diy", runDiyJourney],
      ["inquiry", runInquiryJourney],
      ["agent", runAgentJourney],
      ["idempotency", runIdempotencyJourney],
      ["adversarial", runAdversarialJourney],
      ["workflows", runWorkflowJourney],
      ["security", runSecurityJourney],
      ["cross", runCrossCutting]
    ];

    for (const [name, fn] of runners) {
      process.stderr.write(`[verify] running ${name}…\n`);
      try {
        const result = await fn(db, ctx, collector);
        if (result?.note) journeyNotes.push(result.note);
        if (result?.clientIds) allClientIds.push(...result.clientIds);
        if (result?.verdicts) verdicts.push(...result.verdicts);
        if (result && "usableToday" in result && result.note) {
          verdicts.push({
            role: "system",
            journey: result.note.title || name,
            usableToday: result.usableToday,
            why: result.usableToday === false
              ? "see journey account"
              : result.usableToday === true
                ? "money/data spine held in this run"
                : "partial"
          });
        }
      } catch (err) {
        collector.fail({
          section: "HARNESS",
          journey: name,
          role: "system",
          id: `harness-${name}-crash`,
          claim: `Journey ${name} completed without harness crash`,
          detail: String(err && err.stack || err)
        });
        journeyNotes.push({
          title: `${name} (CRASHED)`,
          usableToday: false,
          steps: [],
          body: String(err && err.stack || err)
        });
      }
    }

    // Role usability stubs for Part 2 (Playwright fills these when run)
    const uiReportPath = "/tmp/fundhub-verify-ui.json";
    if (fs.existsSync(uiReportPath)) {
      try {
        const ui = JSON.parse(fs.readFileSync(uiReportPath, "utf8"));
        for (const v of ui.verdicts || []) verdicts.push(v);
        for (const n of ui.notes || []) journeyNotes.push(n);
        for (const a of ui.assertions || []) {
          collector.items.push(a);
        }
      } catch (err) {
        collector.unverified({
          section: "UI",
          journey: "PLAYWRIGHT",
          role: "system",
          id: "ui-report-parse",
          claim: "Playwright UI report merged",
          detail: String(err.message || err)
        });
      }
    } else {
      collector.unverified({
        section: "UI",
        journey: "PLAYWRIGHT",
        role: "system",
        id: "ui-not-run",
        claim: "Part 2/3 Playwright role+security UI pass not merged yet",
        detail: "Run: npm run test:e2e -- e2e/verification-roles.spec.mjs e2e/verification-security.spec.mjs"
      });
      for (const role of [
        "owner", "admin", "sales_manager", "closer", "funding_advisor",
        "inquiry_specialist", "setter", "client", "affiliate", "partner"
      ]) {
        verdicts.push({
          role,
          journey: "daily UI workflow",
          usableToday: null,
          why: "Playwright UI pass not run in this invocation"
        });
      }
    }

    let reportPath = null;
    if (write) {
      reportPath = writeReport({
        collector,
        meta: {
          dbHost: dbHostLabel(),
          operatorNotes: [
            "Skeptical operator stance. PASS means a write path was exercised and the persisted value matched.",
            "SILENTLY-DID-NOTHING means the operation returned without error and left no useful row — the recurring Fundhub failure mode.",
            "UNVERIFIED means this run could not honestly prove the claim (missing credential, empty corpus, or UI not run).",
            "Adapters used mock secrets. ANTHROPIC_API_KEY unset. messaging_settings.outbound_enabled=false. Nothing transmitted.",
            "Money checked via src/verification/fixtures.mjs MONEY constants (hand-calc), not by calling commission helpers under test."
          ].join("\n\n")
        },
        journeyNotes,
        verdicts
      });
    }

    return {
      collector,
      summary: collector.summary(),
      reportPath,
      verdicts,
      journeyNotes
    };
  } finally {
    try {
      if (allClientIds.length) await wipeClientTree(db, allClientIds);
      if (ctx) await wipeVerifyArtifacts(db, ctx);
    } catch (err) {
      process.stderr.write(`[verify] cleanup warning: ${err.message}\n`);
    }
  }
}

// CLI
const isMain = process.argv[1] && process.argv[1].endsWith("run-all.mjs");
if (isMain) {
  runVerification({ write: true })
    .then((r) => {
      const s = r.summary;
      console.log(JSON.stringify({
        reportPath: r.reportPath,
        tallies: s.tallies,
        p0: s.p0,
        total: s.total
      }, null, 2));
      // Non-zero if any FAIL or P0 non-pass — harness reports; does not "fix".
      // Exit 0 so CI can still archive the report; use VERIFY_STRICT=1 to fail.
      if (process.env.VERIFY_STRICT === "1" && ((s.tallies.FAIL || 0) + (s.p0 || 0)) > 0) {
        process.exit(2);
      }
      return close();
    })
    .catch(async (err) => {
      console.error(err);
      await close().catch(() => {});
      process.exit(1);
    });
}
