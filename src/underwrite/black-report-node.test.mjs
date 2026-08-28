import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildBlackReportClient } from "./black-report-client.mjs";
import { printBlackReports } from "./black-report-pdf.mjs";

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

test("live pdf-lib printer writes four real PDFs — no Python, no LLM", async () => {
  const client = buildBlackReportClient({
    crsResult: FIXTURE,
    personal: { name: "Fixture Client", address: "100 Test Ave", state: "TX" }
  });
  const printed = await printBlackReports({ client, engine: "node" });
  assert.equal(printed.skip, null);
  assert.equal(printed.engine, "pdf-lib");
  assert.equal(printed.files.length, 4);
  const dir = mkdtempSync(join(tmpdir(), "fh-black-node-"));
  for (const file of printed.files) {
    assert.equal(file.content.subarray(0, 4).toString(), "%PDF");
    assert.ok(file.content.length > 2000, file.filename);
    const pdfPath = join(dir, file.filename);
    writeFileSync(pdfPath, file.content);
    const txtPath = `${pdfPath}.txt`;
    const r = spawnSync("pdftotext", [pdfPath, txtPath], { encoding: "utf8" });
    if (r.status !== 0) continue;
    const text = readFileSync(txtPath, "utf8");
    assert.match(text, /Fixture Client/);
    assert.doesNotMatch(text, /Jordan Sample/);
    assert.doesNotMatch(text, /```json/);
    assert.doesNotMatch(text, /Output as JSON/);
    if (file.type === "credit_analysis") {
      assert.match(text, /TEST CARD/);
      assert.match(text, /BANK/);
    }
  }
});
