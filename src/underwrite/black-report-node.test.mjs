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

/* A file with one ordinary card and one card that reports NO CREDIT LIMIT — an
   AMEX with no preset spending limit. This is the client the 6-month checklist
   lied to. */
const NO_LIMIT_CARD = {
  ...FIXTURE,
  normalized: {
    ...FIXTURE.normalized,
    tradelines: [
      { source: "experian", creditorName: "TEST CARD BANK", accountType: "revolving",
        status: "open", currentBalance: 800, effectiveLimit: 2000 },
      { source: "experian", creditorName: "AMEX PLATINUM (NPSL)", accountIdentifier: "AMEX-1",
        accountType: "revolving", status: "open", currentBalance: 5200, effectiveLimit: null }
    ]
  }
};

test("a card with no credit limit reads as unknown in the checklist, not only in the table", async () => {
  /* THE DEFECT: the Month 1 paydown table printed "AMEX PLATINUM (NPSL) $5,200 - - -",
     which is right. Five pages later the 6-month checklist printed "Month 1 - Pay
     AMEX PLATINUM (NPSL) from $5,200 down to under 10% of its limit." — naming a
     limit the file does not have, in the same document, about the same card.
     Unknown has to read as unknown in EVERY place the value is rendered. */
  const client = buildBlackReportClient({
    crsResult: NO_LIMIT_CARD,
    personal: { name: "Fixture Client", address: "100 Test Ave", state: "TX" }
  });
  const amex = client.revolving.find((row) => row[0] === "AMEX PLATINUM (NPSL)");
  assert.equal(amex[3], null, "the limit is unknown, never 0");
  assert.equal(amex[5], "", "and there is no 10% target to print");

  const printed = await printBlackReports({ client, engine: "node" });
  const dir = mkdtempSync(join(tmpdir(), "fh-black-nolimit-"));

  /* EVERY document, not just the one the defect was first found in. Checking
     only the roadmap is how the same sentence survived in the Bank and Lender
     Match List's application-order section. */
  const read = (file) => {
    const pdfPath = join(dir, file.filename);
    writeFileSync(pdfPath, file.content);
    const txtPath = `${pdfPath}.txt`;
    const r = spawnSync("pdftotext", ["-layout", pdfPath, txtPath], { encoding: "utf8" });
    return r.status === 0 ? readFileSync(txtPath, "utf8") : null;
  };

  let sawRoadmap = false;
  for (const file of printed.files) {
    const text = read(file);
    if (text === null) continue; // pdftotext absent: the assertions above still ran
    // The card with no limit is never given a target, in any document.
    assert.doesNotMatch(text, /AMEX PLATINUM \(NPSL\)[^\n]*down to under 10% of its limit/,
      `${file.filename} names a 10% target for a card with no limit`);
    assert.doesNotMatch(text, /Pay AMEX PLATINUM \(NPSL\) down to +before any application/,
      `${file.filename} tells the client to pay to nothing`);
    if (file.type === "roadmap") {
      sawRoadmap = true;
      // What the 6-month checklist says instead.
      assert.match(text, /AMEX PLATINUM \(NPSL\) - \$5,200 owed\. No credit limit is reported/,
        "the checklist has to say the limit is unknown");
      // The card with a real limit still gets its real target.
      assert.match(text, /Pay TEST CARD BANK from \$800 down to \$200 or less\./);
      // And the paydown table two pages earlier still prints dashes for it.
      assert.match(text, /AMEX PLATINUM \(NPSL\)\s+\$5,200\s+-\s+-\s+-/);
    }
    if (file.type === "lender_match") {
      // The application-order rule names the card it CAN state a target for.
      assert.match(text, /Pay TEST CARD BANK down to \$200 or less before any application\./);
    }
  }
  assert.ok(sawRoadmap || printed.files.length === 0,
    "the roadmap must be among the printed documents");
});

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
