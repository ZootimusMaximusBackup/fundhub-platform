#!/usr/bin/env node
// scripts/black-reports/regen-w10-pack.mjs
//
// REGENERATE THE COMMITTED PROOF DOCUMENTS FROM THE CODE AS IT STANDS.
//
// WHY THIS EXISTS. The proof pack under docs/workflows/w10-pack-2026-09-04/ is a
// set of real PDFs committed as evidence. On 2026-09-06 it was found to disagree
// with the code: its lender lists said "6 lenders are open to you today" and
// "11 lenders are open to you today", counts that included lenders stating a
// requirement this system has never checked. The pack had been produced by hand
// at one moment and the code moved afterwards. A committed artefact that
// contradicts its own write-up is worse than no artefact, so producing that pack
// is now one command instead of a memory.
//
//   node scripts/black-reports/regen-w10-pack.mjs
//   node scripts/black-reports/regen-w10-pack.mjs --check    (print what would
//        change, write nothing into the repo)
//   node scripts/black-reports/regen-w10-pack.mjs --engine=python
//
// NO DATABASE IS NEEDED. The earlier pack's top-level files were read back out
// of the `documents` table after a real `scripts/sim/push-credit.mjs --profile
// academy` run. That run proved the STORING. This script proves the PRINTING,
// which is the half that keeps moving: it takes push-credit's own exported
// buildPayload() for the same academy profile, runs the same real tier engine
// over it, and hands the result to the same buildLetterPack() the workflow
// calls. The numbers are the sim profile's own; nothing is retyped here.
//
// THE PRINTER. printBlackReports() prefers WeasyPrint when a local Python has
// it and falls back to the in-process pdf-lib printer otherwise. Netlify has no
// WeasyPrint, so production is the Node printer, so that is what this pack is
// printed with by default — same choice the 2026-09-04 pack made and said so.

import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const argv = process.argv.slice(2);
const CHECK_ONLY = argv.includes("--check");
const ENGINE = (argv.find((a) => a.startsWith("--engine=")) || "--engine=node").split("=")[1];
// Read by black-report-pdf.mjs at call time. Set before the pack is imported so
// there is no path where a default is captured first.
process.env.BLACK_REPORT_ENGINE = ENGINE;

const { buildLetterPack } = await import("../../src/underwrite/letter-pack.mjs");
const { runTierEngineFromCrsResult } = await import("../../src/finance/crs-tier.mjs");
const { buildPayload } = await import("../sim/push-credit.mjs");

const HERE = dirname(fileURLToPath(import.meta.url));
const PACK_DIR = join(HERE, "..", "..", "docs", "workflows", "w10-pack-2026-09-04");

/* A fixed pull date so the cover date on every page is a property of the input
   and not of the day this was run. Same date the 2026-09-04 pack carried. */
const PULLED_AT = "2026-07-25T12:00:00.000Z";

/* ─────────────────────────────────────────────────────────────────────────────
   1. THE SIM ACADEMY PROFILE — the client the 2026-09-03 walkthrough measured.

   Scores 762/770/758, clean, no inquiries, no `businesses` row. Straight out of
   PROFILES.academy in scripts/sim/push-credit.mjs, through the real tier engine.
   ───────────────────────────────────────────────────────────────────────────── */
const SIM_PERSONAL = Object.freeze({
  name: "Sim Five-Academy",
  address: "100 Test Ave\nDenton, TX 76205",
  city: "Denton",
  state: "TX",
  zip: "76205"
});

/* ─────────────────────────────────────────────────────────────────────────────
   2. THE SAME SIM CLIENT, WITH A COMPANY ON FILE.

   F44: a client with a real `businesses` row is judged on the entity that
   exists, so the documents stop telling a six-year-old business to go form an
   LLC. What this half now also proves is the other side of it — a business
   lender only reaches "available right now" when every gate it states is
   actually met.
   ───────────────────────────────────────────────────────────────────────────── */
const WITH_COMPANY = Object.freeze({
  hasEntity: true, ageMonths: 72, name: "Sim Five Holdings LLC"
});

/* ─────────────────────────────────────────────────────────────────────────────
   3. THE HARD CASES — hand-built, not from any profile, because they fire three
   things the sim academy file cannot:

     · one card at $4,500 of $10,000 reported by ALL THREE bureaus, so the
       engine's tri-merge totals ($13,500 of $30,000) are three times the real
       ones and the printed figures have to be the real ones;
     · one AMEX with NO PRESET SPENDING LIMIT, so there is no 10% target to
       print anywhere — the defect closed on 2026-09-06;
     · one authorized-user card at 80%, which belongs under "what does not
       affect your funding" and never under "what is costing you money".

   Every finding is the vendor engine's own wording
   (vendor/underwriteiq-full/api/lite/crs/optimization-findings.js). Nothing is
   authored here.
   ───────────────────────────────────────────────────────────────────────────── */
const HARD_CASES = Object.freeze({
  outcome: "FULL_FUNDING",
  pulledAt: PULLED_AT,
  consumerSignals: {
    scores: { median: 700, perBureau: { ex: 700, eq: 705, tu: 695 } },
    utilization: { totalBalance: 13500, totalLimit: 30000, pct: 45 }
  },
  preapprovals: { totalCombined: 50000 },
  projectedPreapproval: { totalCombined: 60000 },
  businessSignals: { available: false },
  findings: [
    { code: "UTIL_OVERALL_HIGH", category: "utilization", severity: "high", customerSafe: true,
      plainEnglishProblem: "Across all your credit cards, you are using 45% of your available credit. That is $13,500 in balances against $30,000 in limits.",
      whyItMatters: "For the best scores and highest funding amounts, you want to be under 10% total.",
      whatToDoNext: "Get your total balances down to about $3,000. The lower your utilization, the higher your pre-approval amount and the better your approval odds.",
      targetState: "Overall utilization under 10%" },
    { code: "AU_HIGH_UTIL", category: "utilization", severity: "medium", customerSafe: true,
      plainEnglishProblem: "You are listed as an authorized user on a MOM CARD card, and it is at 80% utilization. You are not responsible for this debt - it is someone else's account.",
      whyItMatters: "Even though this is not your debt, it still counts against your credit utilization.",
      whatToDoNext: "Ask the main cardholder to pay it down, or call MOM CARD and ask to be removed from the card.",
      targetState: "Remove or reduce AU card utilization" },
    { code: "FUNDING_FIRST", category: "strategic", severity: "high", customerSafe: true,
      plainEnglishProblem: "You qualify for funding right now.",
      whyItMatters: "Opening new accounts before you apply drops your average account age.",
      whatToDoNext: "Get funded first, build after.",
      targetState: "Secure funding before new accounts" }
  ],
  normalized: {
    tradelines: [
      // The same physical card, reported by all three bureaus. ONE printed row.
      ...["transunion", "experian", "equifax"].map((source) => ({
        source, creditorName: "TEST CARD", accountIdentifier: "TEST-CARD-1234",
        accountType: "revolving", status: "open", isAU: false, isDerogatory: false,
        currentBalance: 4500, effectiveLimit: 10000, openedDate: null,
        currentRatingType: "AsAgreed"
      })),
      // NO PRESET SPENDING LIMIT. There is no 10% of a limit the file does not have.
      { source: "experian", creditorName: "AMEX PLATINUM (NPSL)", accountIdentifier: "AMEX-1",
        accountType: "revolving", status: "open", isAU: false, isDerogatory: false,
        currentBalance: 5200, effectiveLimit: null, openedDate: null,
        currentRatingType: "AsAgreed" },
      // Someone else's debt.
      { source: "experian", creditorName: "MOM CARD", accountIdentifier: "MOM-1",
        accountType: "revolving", status: "open", isAU: true, isDerogatory: false,
        currentBalance: 8000, effectiveLimit: 10000, openedDate: "2019-10-01",
        currentRatingType: "AsAgreed" }
    ],
    inquiries: [],
    identity: {}
  }
});

const HARD_CASES_PERSONAL = Object.freeze({
  name: "Fixture Client",
  address: "100 Test Ave\nDenton, TX 76205",
  city: "Denton",
  state: "TX",
  zip: "76205"
});

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function academyEngineResult() {
  const payload = buildPayload("academy", {
    email: null, name: SIM_PERSONAL.name, pulledAt: PULLED_AT
  });
  return runTierEngineFromCrsResult(payload);
}

async function main() {
  const academy = academyEngineResult();
  const cases = [
    { dir: ".", label: "sim academy, no company row",
      crsResult: academy, personal: SIM_PERSONAL, business: null },
    { dir: "with-company", label: "sim academy, one businesses row (72 months)",
      crsResult: academy, personal: SIM_PERSONAL, business: WITH_COMPANY },
    { dir: "hard-cases", label: "hand-built: tri-merge, no-limit card, AU card",
      crsResult: HARD_CASES, personal: HARD_CASES_PERSONAL, business: null }
  ];

  const outRoot = CHECK_ONLY ? mkdtempSync(join(tmpdir(), "w10-regen-")) : PACK_DIR;
  let differences = 0;
  for (const c of cases) {
    const pack = await buildLetterPack({
      crsResult: c.crsResult, personal: c.personal, pack: "funding", business: c.business
    });
    if (pack.reason) {
      console.error(`[${c.dir}] the pack came out empty: ${pack.reason}`);
      process.exitCode = 1;
      continue;
    }
    const analysis = pack.files.filter((f) => /\.pdf$/i.test(f.filename) && !f.filename.includes("/"));
    const dir = join(outRoot, c.dir);
    mkdirSync(dir, { recursive: true });
    console.log(`\n[${c.dir}] ${c.label}`);
    console.log(`  engine=${pack.deliverableEngine || ENGINE} analysis documents=${pack.deliverableCount}`);
    for (const file of analysis) {
      const committed = join(PACK_DIR, c.dir, file.filename);
      /* A PDF is not byte-reproducible — every one carries a creation timestamp
         — so an unequal hash tells you the bytes are new, never that the WORDS
         moved. The words are what a write-up quotes, so read the file. */
      const same = existsSync(committed)
        && sha256(readFileSync(committed)) === sha256(file.content);
      if (!same) differences += 1;
      // --check still writes — to the temporary directory, never into the repo —
      // because a proof you cannot open is not a proof.
      writeFileSync(join(dir, file.filename), file.content);
      const state = existsSync(committed)
        ? (same ? "identical to committed" : "differs from committed")
        : "new";
      console.log(`  ${file.filename.padEnd(34)} ${String(file.content.length).padStart(7)} bytes  (${state})`);
    }
  }
  if (CHECK_ONLY) {
    console.log(`\n--check: wrote to ${outRoot}; ${differences} file(s) differ from what is committed.`);
  } else {
    console.log(`\nWrote to ${PACK_DIR}. Open the PDFs and read them before you quote them.`);
  }
}

await main();
