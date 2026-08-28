// UnderwriteIQ OUTPUT BASELINE — the tripwire.
//
// WHAT THIS FILE IS FOR
// Somebody is about to merge changes that touch UnderwriteIQ. This file records
// exactly what UnderwriteIQ produces TODAY, from inputs that never change. If a
// merge, a refactor or an upstream refresh alters what a client is told — a
// number, a sentence, a document that appears or disappears — one of these tests
// goes red and names the surface that moved.
//
// It does not judge whether a change is good. It only makes a change impossible
// to miss. A red test here means: a human has to look and decide.
//
// WHEN ONE OF THESE FAILS
// Do NOT edit the recorded value to make it green. That deletes the alarm. Find
// out what moved, confirm the new output is intended, then update the recorded
// value in the SAME commit as the change that caused it, and say so in the
// commit message.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY EVERY INPUT HERE IS CLOCK-STABLE
//
// Three things in this pipeline read the system clock, and each one would turn
// this file into a false alarm on a future date:
//
//   1. computeUnderwrite ages tradelines through monthsSince(tl.opened) and calls
//      a line "seasoned" at >= 24 months. Same rule as ./fixtures.test.mjs: every
//      `opened` here is either null (never seasoned) or "1990-01" (seasoned for
//      centuries). Never a date near the 24-month line.
//   2. black-report-client's monthsOpen() ages the AU account. Every openedDate
//      in the fixture is null, so au_account.age is "" forever.
//   3. The WeasyPrint printer stamps today's date into the PDF. That is why the
//      byte/text pin below runs against the pdf-lib printer (engine: "node"),
//      which leaves DATE blank, and the WeasyPrint path is pinned by its INPUT
//      (the CLIENT dict) and its TEMPLATE (the generator script), not its output.
//      See NOT LOCKED, below.
//
// ─────────────────────────────────────────────────────────────────────────────
// NOT LOCKED BY THIS FILE — stated so nobody mistakes green here for total cover
//
//   * The WeasyPrint PDF text itself. It carries today's date and depends on a
//     Python install that is not on every machine. Locked instead: the CLIENT
//     dict handed to it, and the sha256 of scripts/black-reports/fundhub_gen.py.
//   * A real database. buildLetterPackForClient is exercised below through a
//     read-only stub of its two queries — that is deliberate, because building
//     the repair pack WITHOUT a stored credit pull skips the whole escalation
//     path and pins nothing. Real Postgres behaviour stays in
//     ./underwriteiq.pg.test.mjs.
//   * The exact dispute-letter list produced from the vendored sandbox pull.
//     Which accounts the scoring engine calls derogatory can move with the
//     calendar, and this file must never turn into a dated false alarm. What IS
//     pinned for that pull: that dispute letters exist at all, and the exact
//     escalation tail that follows them.
//   * Live Claude summary text. ANTHROPIC_API_KEY is removed below, exactly as
//     ./letter-pack.test.mjs does, so the letter pack never calls out.
//   * PDF byte size. PDFs embed timestamps, so byte length is not a stable pin.
//     Extracted TEXT is.
// ─────────────────────────────────────────────────────────────────────────────

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { computeUnderwrite, buildSuggestions } from "./engine.mjs";
import { buildBlackReportClient, emptyBlackReportClient } from "./black-report-client.mjs";
import { printBlackReports, BLACK_REPORT_SCRIPT } from "./black-report-pdf.mjs";
import { printBlackReportsNode } from "./black-report-node.mjs";
import { buildLetterPack, buildLetterPackForClient, PACK_REASON } from "./letter-pack.mjs";
import { mergeBureauReports } from "../finance/crs-map.mjs";
import { extractPdfText } from "../company-brain/pdf-text.mjs";

// Never call live Claude from a unit test. Same guard as ./letter-pack.test.mjs.
delete process.env.ANTHROPIC_API_KEY;
// buildBlackReportClient copies BOOKING_URL straight into the client dict, so a
// developer with it set locally would otherwise see a different digest than CI.
delete process.env.BOOKING_URL;

/* ─────────────── digest helpers ─────────────── */

/** Key-order-independent JSON. Reordering object keys must not fire the alarm. */
function canon(value) {
  if (Array.isArray(value)) return "[" + value.map(canon).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort()
      .map((k) => JSON.stringify(k) + ":" + canon(value[k])).join(",") + "}";
  }
  return JSON.stringify(value === undefined ? null : value);
}
const sha256 = (input) => createHash("sha256").update(input).digest("hex");
const digest = (value) => sha256(canon(value));

/** One line of plain English on every failure, so the red test explains itself. */
function pinned(actual, expected, surface) {
  assert.equal(actual, expected,
    `UNDERWRITEIQ OUTPUT CHANGED — ${surface}. What this client is shown is not what ` +
    `it was when this baseline was recorded (2026-08-28, branch audit/baseline-wf, ` +
    `origin/main 4d6cf31b). Do not edit the expected value to go green: find what moved, ` +
    `confirm it was meant, then update this line in the same commit.`);
}

/* ═══════════════ THE PINNED INPUTS ═══════════════ */

const PERSONAL = Object.freeze({
  name: "Fixture Client",
  address: "100 Test Ave\nDenton, TX 76205",
  state: "TX"
});

/** The shape a stored credit pull arrives in, trimmed to what these surfaces read. */
const ENGINE_RESULT = Object.freeze({
  outcome: "FUNDING_PLUS_REPAIR",
  suggestions: ["Pay balances down."],
  consumerSignals: {
    scores: { median: 610, perBureau: { ex: 600, eq: 610, tu: 620 } },
    utilization: { totalBalance: 800, totalLimit: 2000, pct: 40 },
    bureauNegatives: {
      experian: {
        pulled: true, clean: false, count: 1,
        items: [{ creditorName: "TEST CARD BANK", source: "experian", currentRatingType: "ChargeOff", balance: 400 }]
      },
      equifax: { pulled: true, clean: true, count: 0, items: [] },
      transunion: { pulled: true, clean: true, count: 0, items: [] }
    }
  },
  preapprovals: { totalCombined: 5000 },
  projectedPreapproval: { totalCombined: 9000 },
  businessSignals: { available: false },
  normalized: {
    // buildDocuments reads normalized.meta.availableBureaus. Without it the
    // summary documents throw and buildLetterPack reports summarySkip. Present
    // here on purpose so the summary document is exercised rather than skipped.
    meta: { availableBureaus: ["experian", "equifax", "transunion"], bureauCount: 3 },
    tradelines: [
      { source: "experian", creditorName: "TEST CARD BANK", accountType: "revolving", status: "open",
        isDerogatory: true, isAU: false, currentBalance: 800, effectiveLimit: 2000,
        currentRatingType: "ChargeOff", openedDate: null, accountIdentifier: "1234567890" },
      { source: "transunion", creditorName: "TEST AUTO LENDER", accountType: "installment", status: "open",
        isDerogatory: false, isAU: false, currentBalance: 12000, openedDate: null }
    ],
    inquiries: [{ source: "experian", creditorName: "TEST PULL A", date: "2024-04-01" }],
    identity: {
      names: [{ first: "FIXTURE", last: "CLIENT", source: "experian" }],
      addresses: [{ line1: "100 TEST AVE", city: "DENTON", state: "TX", zip: "76205", source: "experian" }],
      employers: [], ssns: [], dobs: []
    }
  }
});

/** Bureau input for the scoring engine. 1990 open dates = seasoned forever. */
const BUREAUS_MAXED = Object.freeze({
  experian: {
    score: 720, utilization_pct: 85, inquiries: 14, negatives: 6, late_payment_events: 2,
    tradelines: [
      { type: "revolving", status: "open", limit: 20000, balance: 17000, opened: "1990-01" },
      { type: "revolving", status: "open", limit: 5000, balance: 4000, opened: "1990-02" },
      { type: "installment", status: "open", limit: 30000, balance: 12000, opened: "1990-03" }
    ]
  }
});
const BUREAUS_SCORE_ONLY = Object.freeze({
  experian: { score: 700, utilization_pct: null, inquiries: null, negatives: null, late_payment_events: null, tradelines: [] }
});
const BUREAUS_NONE = Object.freeze({});

/* ═══════════════ THE RECORDED BASELINE ═══════════════
   Every value below was measured on 2026-08-28 on branch audit/baseline-wf,
   cut from origin/main at commit 4d6cf31b, on macOS with Node 26. */

const BASELINE = Object.freeze({
  engineMaxed:            "0581c1b9b5f713dc7958b5e3e1e961b0be245beac174814d9a04068e1a692d0a",
  engineMaxedSuggestions: "d06e816746ef7dddb015f77ebf605b9a7f30f15df1d233b8e47702f4577f2d19",
  engineScoreOnly:        "0fe3f24ebe0560a04fe24fdb14afc974e0725f3e96571ab12b34c5a7e8a589e7",
  engineNoBureaus:        "79f0c7c1d8eb1853e314681051005eeafd3b07550da2855ab9eb6bbffe8a8260",
  blackReportClient:      "4a0f0fe651ddfa21bdb5c632ef7c80a9fd6778e1632aba56d7344657b9c75f0a",
  emptyBlackReportClient: "feb8f216fb06c85d9dc0a95170fb71a167ee0963221ff24aef858f681b03009b",
  generatorScript:        "9d0babe55544aa695cca8505a6a2d0af1370f50d01817c0f8e51af35ba62259d"
});

/** The four PDFs the in-process printer produces, and the words inside each. */
const BASELINE_NODE_PDFS = Object.freeze([
  { filename: "Credit-Analysis-Report.pdf",     type: "credit_analysis",  pages: 4, textSha: "2a263c90866720920345e355b02dac8991dab9ce746756585a334dbd44a88eb2" },
  { filename: "Funding-Snapshot.pdf",           type: "funding_snapshot", pages: 3, textSha: "8c6414699579bb25847d33bc6e44beec88339a9650e978c67c575ffe9de05c42" },
  { filename: "Bank-Lender-Match-List.pdf",     type: "lender_match",     pages: 6, textSha: "5985d2dcfb4a563ee0fd55bc3d12ab9b66d4ff82e7f0188e919987c9e8a744fc" },
  { filename: "Credit-Optimization-Roadmap.pdf", type: "roadmap",         pages: 3, textSha: "c44be557e52ac6070fc9cd0eba4ce5560dcab012acd0a61e09ae4ae71a929cc8" }
]);

/** Every document a client receives, in order. [filename, type, bureau]. */
const BASELINE_FUNDING_PACK = Object.freeze([
  ["Credit-Analysis-Report.pdf",     "credit_analysis",  null],
  ["Funding-Snapshot.pdf",           "funding_snapshot", null],
  ["Bank-Lender-Match-List.pdf",     "lender_match",     null],
  ["Credit-Optimization-Roadmap.pdf", "roadmap",         null],
  ["Capital-Readiness-Summary.pdf",  "funding_summary",  null],
  ["inquiry_ex.pdf",                 "inquiry_removal",  "experian"],
  ["ex_round1.pdf",                  "dispute",          "experian"]
]);
const BASELINE_REPAIR_PACK = Object.freeze([
  ["ex_round1.pdf", "dispute", "experian"]
]);

/**
 * The escalation tail of a repair pack built from a stored credit pull. The
 * folder name and the cover sheet are part of the document, not decoration:
 * both complaints are sworn under penalty of perjury and are out of order
 * before Round 3. If this tail ever ships loose, or ships without the cover,
 * this baseline goes red.
 */
const BASELINE_ESCALATION_TAIL = Object.freeze([
  ["06-complaints-CONDITIONAL/COVER.txt",                            null,                 null],
  ["06-complaints-CONDITIONAL/CFPB-Complaint.pdf",                   "cfpb_complaint",     null],
  ["06-complaints-CONDITIONAL/State-Attorney-General-Complaint.pdf", "state_ag_complaint", null]
]);

const manifest = (pack) => pack.files.map((f) => [f.filename, f.type ?? null, f.bureau ?? null]);

/* ─────────────── stored credit pulls, for the repair pack ───────────────
   buildLetterPackForClient makes exactly two reads and writes nothing, so a
   read-only stub is enough to run the real entry point the app calls. */

const SANDBOX = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../vendor/underwriteiq-full/api/lite/crs/sandbox"
);
const loadSandbox = (name) => JSON.parse(readFileSync(path.join(SANDBOX, name), "utf8"));

/** A real three-bureau pull the scoring engine can read. */
const STORED_SCOREABLE = mergeBureauReports({
  reports: { TU: loadSandbox("tu.json"), EX: loadSandbox("exp.json"), EQ: loadSandbox("efx.json") },
  requestIds: { TU: "tu-1", EX: "ex-1", EQ: "eq-1" },
  environment: "sandbox"
});

/**
 * A pull stored as one bare bureau file, with no `bureaus` key. The scoring
 * engine throws on this shape (../finance/crs-tier.test.mjs pins the throw),
 * so the pack can write no dispute letters at all.
 */
const STORED_UNSCOREABLE = Object.freeze({
  requestedBureaus: { transunion: false, experian: false, equifax: true },
  responseDetail: { dateRequested: "2026-03-01T21:46:24.834278Z" },
  creditFiles: [{ creditFileDetail: { creditFileInfileDate: "2026-03-01", creditFileResultStatusType: "FileReturned", sourceType: "Equifax" } }],
  tradelines: [{
    accountIdentifier: "5121080011112222", accountOpenedDate: "2019-06-12",
    accountOwnershipType: "Individual", accountReportedDate: "2024-01-01",
    accountStatusType: "Open", accountType: "Revolving", creditorName: "EXAMPLE BANK NA",
    currentBalanceAmount: "1842", currentRatingType: "AsAgreed", sourceType: "Equifax"
  }]
});

function fakeClientDb(storedCrs) {
  return {
    async query(sql) {
      if (/FROM clients/i.test(sql)) {
        return {
          rows: [{
            first_name: "Fixture",
            last_name: "Client",
            custom_fields: { address: "100 Test Ave", city: "Denton", state: "TX", zip: "76205" },
            outcome_tier: "REPAIR_ONLY"
          }]
        };
      }
      if (/FROM crs_results/i.test(sql)) return { rows: storedCrs ? [{ result: storedCrs }] : [] };
      return { rows: [] };
    }
  };
}

/* ═══════════════ 1. THE SCORING ENGINE ═══════════════ */

describe("baseline — the scoring engine's whole answer", () => {
  test("maxed-out file: every number and every sentence is unchanged", () => {
    const uw = computeUnderwrite(BUREAUS_MAXED, 30);
    pinned(digest(uw), BASELINE.engineMaxed, "the funding assessment for a maxed-out file");
    pinned(digest(buildSuggestions(uw)), BASELINE.engineMaxedSuggestions,
      "the advice sentences shown to a client with a maxed-out file");

    // Spelled out in plain terms so a failure above can be read without a debugger.
    assert.equal(uw.fundable, false);
    assert.equal(uw.metrics.score, 720);
    assert.equal(uw.metrics.utilization_pct, 85);
    assert.equal(uw.personal.highest_revolving_limit, 20000);
    assert.equal(uw.personal.card_funding, 110000);
  });

  test("a score and nothing else: unknown must not read as clean", () => {
    const uw = computeUnderwrite(BUREAUS_SCORE_ONLY, null);
    pinned(digest(uw), BASELINE.engineScoreOnly,
      "the funding assessment for a client where only a credit score was entered");
    // The rule this baseline exists to protect: blanks stay blank, never zero.
    assert.equal(uw.metrics.negative_accounts, null);
    assert.equal(uw.metrics.late_payment_events, null);
    assert.equal(uw.metrics.utilization_pct, null);
    assert.equal(uw.fundable, false);
  });

  test("no credit pull at all", () => {
    const uw = computeUnderwrite(BUREAUS_NONE, null);
    pinned(digest(uw), BASELINE.engineNoBureaus,
      "the funding assessment for a client with no credit pull on file");
    assert.equal(uw.fundable, false);
    assert.equal(uw.lite_banner_funding, null);
  });
});

/* ═══════════════ 2. THE BLACK REPORT CLIENT DICT ═══════════════
   This object is the single input to both PDF printers. If it moves, every
   document a client receives moves with it. */

describe("baseline — the black report client record", () => {
  test("the whole record is unchanged", () => {
    const client = buildBlackReportClient({ crsResult: ENGINE_RESULT, personal: PERSONAL });
    pinned(digest(client), BASELINE.blackReportClient,
      "the record that fills every client-facing funding document");

    // The handful a human would actually check on a printed report.
    assert.equal(client.applicant, "Fixture Client");
    assert.deepEqual(client.scores, { experian: 600, equifax: 610, transunion: 620 });
    assert.equal(client.preapproval_now, 5000);
    assert.equal(client.preapproval_after, 9000);
    assert.equal(client.util_pct, "40%");
    assert.equal(client.negatives.length, 1);
    // Clock-stable check: no open dates in the fixture, so no aged field is set.
    assert.equal(client.au_account.age, "");
  });

  test("the empty record stays empty — no invented client", () => {
    const empty = buildBlackReportClient({});
    pinned(digest(empty), BASELINE.emptyBlackReportClient,
      "the blank record used when there is no credit pull");
    assert.equal(empty.applicant, "Client");
    assert.equal(digest(empty), digest({ ...emptyBlackReportClient(), applicant: "Client" }),
      "a blank pull must produce the blank record, with nothing filled in");
  });
});

/* ═══════════════ 3. THE PDFs THE APP PRINTS ITSELF ═══════════════
   printBlackReportsNode is the pdf-lib printer: pure JavaScript, no Python, no
   date stamp. That is what makes it safe to pin word for word. */

describe("baseline — the four PDFs the app prints in-process", () => {
  test("same four documents, same words in each", async () => {
    const client = buildBlackReportClient({ crsResult: ENGINE_RESULT, personal: PERSONAL });
    const printed = await printBlackReportsNode({ client });
    assert.equal(printed.skip, null, "the in-process printer must not skip");
    assert.equal(printed.engine, "pdf-lib");

    const actual = [];
    for (const file of printed.files) {
      assert.equal(file.content.subarray(0, 4).toString(), "%PDF", `${file.filename} is not a PDF`);
      const read = await extractPdfText(file.content);
      actual.push({
        filename: file.filename,
        type: file.type,
        pages: read.pageCount,
        textSha: sha256(read.text.replace(/\s+/g, " ").trim())
      });
    }
    assert.deepEqual(actual.map((f) => [f.filename, f.type]),
      BASELINE_NODE_PDFS.map((f) => [f.filename, f.type]),
      "UNDERWRITEIQ OUTPUT CHANGED — the set or order of client documents moved");
    for (let i = 0; i < BASELINE_NODE_PDFS.length; i++) {
      pinned(actual[i].pages, BASELINE_NODE_PDFS[i].pages, `page count of ${actual[i].filename}`);
      pinned(actual[i].textSha, BASELINE_NODE_PDFS[i].textSha, `the words printed in ${actual[i].filename}`);
    }
  });

  test("printBlackReports with engine 'node' takes the same path", async () => {
    const client = buildBlackReportClient({ crsResult: ENGINE_RESULT, personal: PERSONAL });
    const printed = await printBlackReports({ client, engine: "node" });
    assert.equal(printed.engine, "pdf-lib");
    assert.deepEqual(printed.files.map((f) => f.filename),
      BASELINE_NODE_PDFS.map((f) => f.filename));
  });
});

/* ═══════════════ 4. THE WEASYPRINT PRINTER ═══════════════
   Its output carries today's date, so the output cannot be pinned. Its TEMPLATE
   can. If anyone edits the printer, this fires. */

describe("baseline — the WeasyPrint document template", () => {
  test("the generator script is byte-for-byte unchanged", () => {
    assert.ok(existsSync(BLACK_REPORT_SCRIPT),
      `the black report generator is missing: ${BLACK_REPORT_SCRIPT}`);
    pinned(sha256(readFileSync(BLACK_REPORT_SCRIPT)), BASELINE.generatorScript,
      "scripts/black-reports/fundhub_gen.py, which lays out every printed funding document");
  });
});

/* ═══════════════ 5. THE LETTER PACK ═══════════════
   What a client actually receives, and in what order. */

describe("baseline — the document pack a client receives", () => {
  test("funding pack: same documents, same order", async () => {
    const pack = await buildLetterPack({ crsResult: ENGINE_RESULT, personal: PERSONAL, pack: "funding" });
    assert.deepEqual(manifest(pack), BASELINE_FUNDING_PACK.map((r) => [...r]),
      "UNDERWRITEIQ OUTPUT CHANGED — the funding pack a client receives is not the same " +
      "set of documents, or not in the same order, as when this baseline was recorded.");
    pinned(pack.reason, null, "the funding pack's reason code");
    pinned(pack.deliverableCount, 4, "the number of funding analysis documents");
    pinned(pack.deliverableSkip, null, "the funding analysis skip reason");
    pinned(pack.summarySkip, null, "the summary document skip reason");
    for (const file of pack.files) {
      assert.equal(file.contentType, "application/pdf", file.filename);
      assert.equal(file.content.subarray(0, 4).toString(), "%PDF", `${file.filename} is not a PDF`);
    }
  });

  test("repair pack, no stored credit pull: same documents, same order", async () => {
    const pack = await buildLetterPack({ crsResult: ENGINE_RESULT, personal: PERSONAL, pack: "repair" });
    assert.deepEqual(manifest(pack), BASELINE_REPAIR_PACK.map((r) => [...r]),
      "UNDERWRITEIQ OUTPUT CHANGED — the repair pack a client receives moved.");
    pinned(pack.reason, null, "the repair pack's reason code");
    pinned(pack.deliverableCount, 0, "funding analysis documents in a repair pack");
    pinned(pack.deliverableSkip, "not_funding", "why a repair pack has no funding analysis");
    // No stored pull means no findings to complain about. Recorded so nobody
    // reads this test as cover for the escalation path — it is not.
    pinned(pack.complaintCount, 0, "complaints in a repair pack built with no stored credit pull");
    pinned(pack.complaintSkip, "no_stored_crs", "why that pack has no complaints");
  });

  test("no credit pull: the pack says so, and says which kind of nothing", async () => {
    const pack = await buildLetterPack({ personal: { name: "Chris Sample", address: "1 Main St" }, pack: "funding" });
    pinned(pack.files.length, 0, "the pack for a client with no credit pull");
    pinned(pack.reason, PACK_REASON.NO_ENGINE_RESULT, "the reason code for a client with no credit pull");
    pinned(pack.deliverableSkip, "no_engine", "the funding analysis skip reason with no credit pull");
    pinned(pack.summarySkip, "no_normalized", "the summary skip reason with no credit pull");
  });
});

/* ═══════════════ 6. THE REPAIR PACK, THROUGH THE REAL ENTRY POINT ═══════════════

   COMPLIANCE REVIEW REQUIRED — dispute logic and credit-repair messaging.

   Section 5 builds the repair pack with no stored credit pull, so the escalation
   path exits at its first line and pins nothing about it. That is how the CFPB
   and state AG complaints once shipped with no dispute letters and no warning
   sheet while this file stayed green.

   These run buildLetterPackForClient — the function ds-02-diy-letters and
   closer-deck actually call — with a stored credit pull in the database stub. */

describe("baseline — the repair pack a client receives, with a credit pull on file", () => {
  test("a readable pull: dispute letters, then the conditional complaints", async () => {
    const pack = await buildLetterPackForClient(fakeClientDb(STORED_SCOREABLE), { clientId: "cl-1", pack: "repair" });
    pinned(pack.reason, null, "the repair pack's reason code with a readable credit pull");
    pinned(pack.engineSkip, null, "the engine skip reason for the sandbox pull");

    const rows = manifest(pack);
    const disputes = rows.filter(([name]) => /round\d/.test(name));
    assert.ok(disputes.length > 0,
      "UNDERWRITEIQ OUTPUT CHANGED — a readable credit pull stopped producing dispute letters.");
    assert.deepEqual(rows.slice(-3), BASELINE_ESCALATION_TAIL.map((r) => [...r]),
      "UNDERWRITEIQ OUTPUT CHANGED — the escalation tail moved. The two complaints must " +
      "come last, inside 06-complaints-CONDITIONAL, behind the cover sheet that says " +
      "DO NOT FILE WITH ROUND 1.");
    pinned(pack.complaintCount, 3, "the number of escalation files (cover sheet + two complaints)");
    pinned(pack.complaintSkip, null, "the escalation skip reason on a readable pull");
  });

  test("A PULL THE ENGINE CANNOT READ SHIPS NOTHING, AND SAYS WHY", async () => {
    // The regression. Complaint files must never make a failed pack look like it
    // produced something: ds-02-diy-letters and closer-deck both decide
    // Delivered vs Delivery Failed on nothing but "are there files?".
    const pack = await buildLetterPackForClient(fakeClientDb(STORED_UNSCOREABLE), { clientId: "cl-1", pack: "repair" });
    pinned(pack.files.length, 0, "the pack for a client whose stored credit pull cannot be read");
    pinned(pack.complaintCount, 0, "complaints on a pull the engine could not read");
    pinned(pack.complaintSkip, "no_dispute_letters", "why that pack has no complaints");
    pinned(pack.reason, "engine_error: rawResponsesFromMerged: no bureau reports to score",
      "the reason code for a stored credit pull the engine cannot read");
  });

  test("a readable pull with nothing to dispute: an empty pack, honestly empty", async () => {
    // The benign case. The engine ran, this client has no dispute to send, and
    // the complaints do not quietly fill the gap.
    const pack = await buildLetterPackForClient(
      fakeClientDb({ bureausPulled: ["EQ"], bureaus: { EQ: STORED_UNSCOREABLE } }),
      { clientId: "cl-1", pack: "repair" }
    );
    pinned(pack.files.length, 0, "the pack for a client with a clean readable pull");
    pinned(pack.reason, PACK_REASON.EMPTY_PACK, "the reason code for a clean readable pull");
    pinned(pack.complaintCount, 0, "complaints on a clean readable pull");
    pinned(pack.complaintSkip, "no_dispute_letters", "why a clean pull has no complaints");
  });
});
