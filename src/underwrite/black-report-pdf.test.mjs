import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { buildBlackReportClient } from "./black-report-client.mjs";
import { printBlackReports, resolveWeasyprintPython } from "./black-report-pdf.mjs";

const FIXTURE = {
  outcome: "FULL_FUNDING",
  consumerSignals: {
    scores: { median: 610, perBureau: { ex: 600, eq: 610, tu: 620 } },
    utilization: { totalBalance: 800, totalLimit: 2000, pct: 40 }
  },
  preapprovals: { totalCombined: 5000 },
  projectedPreapproval: { totalCombined: 9000 },
  normalized: {
    tradelines: [{
      source: "experian",
      creditorName: "TEST CARD BANK",
      accountType: "revolving",
      status: "open",
      currentBalance: 800,
      effectiveLimit: 2000
    }],
    inquiries: [],
    identity: {}
  }
};

test("printer writes four real PDFs from mapped UnderwriteIQ data — no LLM", async (t) => {
  const python = resolveWeasyprintPython();
  if (!python) {
    t.skip("WeasyPrint not on this machine");
    return;
  }
  const client = buildBlackReportClient({
    crsResult: FIXTURE,
    personal: { name: "Fixture Client", address: "100 Test Ave", state: "TX" }
  });
  const outDir = mkdtempSync(join(tmpdir(), "fh-black-test-"));
  const printed = await printBlackReports({ client, outDir });
  assert.equal(printed.skip, null);
  assert.equal(printed.files.length, 4);
  for (const file of printed.files) {
    assert.equal(file.content.subarray(0, 4).toString(), "%PDF");
    assert.ok(file.content.length > 5000, file.filename);
  }
  const analysis = join(outDir, "credit_analysis_report.pdf");
  const txt = join(outDir, "credit_analysis_report.txt");
  const r = spawnSync("pdftotext", [analysis, txt], { encoding: "utf8" });
  assert.equal(r.status, 0);
  const text = readFileSync(txt, "utf8");
  assert.match(text, /Fixture Client/);
  assert.match(text, /TEST CARD BANK/);
  assert.doesNotMatch(text, /Jordan Sample/);
  assert.doesNotMatch(text, /```json/);
  assert.doesNotMatch(text, /Output as JSON/);
});
