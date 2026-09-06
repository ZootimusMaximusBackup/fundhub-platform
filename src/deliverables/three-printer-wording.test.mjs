// THREE PRINTERS, ONE SET OF WORDS.
//
// THE SET, ENUMERATED FROM THE FILESYSTEM ON 2026-09-06 — not from memory, and
// not by grepping for a marker only one family uses. Every path in the tree that
// turns a client dict into one of the four funding documents:
//
//   1. src/deliverables/*.mjs                 the hosted WEB PAGES (HTML)
//   2. scripts/black-reports/fundhub_gen.py   the WeasyPrint PDF printer (HTML -> PDF)
//   3. src/underwrite/black-report-node.mjs   the pdf-lib PDF printer (draws text)
//
// AND THE THINGS THAT LOOK LIKE A FOURTH AND ARE NOT, each checked by opening it:
//
//   render-service/            NOT a renderer. render-service/Dockerfile:47 copies
//                              scripts/black-reports/ into the image and
//                              render-service/wsgi.py:75 shells out to
//                              fundhub_gen.py. The render service IS printer 2.
//   vendor/underwriteiq-crs/optimization-findings.js  and its byte-identical twin
//   vendor/underwriteiq-full/api/lite/crs/optimization-findings.js
//                              the vendor ENGINE, not a printer. It does take 10%
//                              of a limit (:121, :146, :167) but its per-card
//                              finding is gated on `tl.effectiveLimit > 0` (:115)
//                              and its two overall findings on
//                              `cs.utilization.pct != null`, which is null when
//                              the total limit is 0. It invents no $0 target.
//   src/optimize-page/roadmap.mjs
//                              a JSON endpoint for the public /optimize page. It
//                              passes the mapper's own `row[5]` through (:153) and
//                              computes no target of its own.
//   src/waypoints/definitions.mjs
//                              the Month 1 paydown checklist. Its target is
//                              `limitCents > 0 ? ... : null` (:235, :324), so a
//                              reported $0 produces no waypoint. Correct already.
//   docs/workflows/gold-deliverables-v5/fundhub_pdf_template.py
//   docs/workflows/gold-deliverables-v5/compare/*.txt
//   src/deliverables/fixtures/*.json
//                              captured OUTPUT and reference material under docs/.
//                              Nothing imports them at runtime.
//
// WHY THIS FILE EXISTS. Round 2 shipped a guard that compared printers 1 and 2
// word for word and a changelog line that said the comparison covered all three.
// It did not. Printer 3 — the pdf-lib one — was in no word-for-word comparison
// with either, and a third variant of the $0-limit defect survived in two
// printers because nobody had enumerated the set.
//
// WHAT THIS FILE LOCKS, EXACTLY. Not whole documents: printer 3 draws text into a
// PDF and has no HTML body to diff. It locks the SENTENCES this lane is about,
// byte for byte, in all three at once. Printer 2's answers are captured into
// fixtures/zero-limit-python-bodies.json by
// scripts/black-reports/recapture-fixtures.py, and that capture carries the
// sha256 of fundhub_gen.py, so a change to the Python that is not recaptured
// fails here rather than drifting quietly.
//
// COMPLIANCE REVIEW REQUIRED — credit-repair messaging. Marker only.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// printer 1
import { noTargetReason as webNoTargetReason, noTargetCell as webNoTargetCell,
  paydownSentence as webPaydownSentence } from "./derive.mjs";
import { ctaPage } from "./chrome.mjs";
import { buildRoadmap } from "./roadmap.mjs";
import { buildLenderList } from "./lender-list.mjs";
// printer 3
import { noTargetReason as pdfNoTargetReason, paydownInstruction as pdfPaydownInstruction,
  totalPaydownSentence as pdfTotalPaydownSentence, ctaLead as pdfCtaLead,
  cleanBureaus as pdfCleanBureaus } from "../underwrite/black-report-node.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const fx = (n) => JSON.parse(readFileSync(join(HERE, "fixtures", n), "utf8"));
const GEN = join(HERE, "..", "..", "scripts", "black-reports", "fundhub_gen.py");

const PY = fx("zero-limit-python-bodies.json");
const ZERO_CLIENT = fx("zero-limit-client.json");
const NO_LIMIT_CLIENT = fx("no-limit-client.json");
const PY_NO_LIMIT = fx("no-limit-python-bodies.json");

const POSITIVE_ROW = ["TEST CARD", "Experian", 4500, 10000, "45%", "$1,000", "MONITOR"];
const ZERO_ROW = ["SECURED CARD", "Experian", 900, 0, "", "", "MONITOR"];
const UNKNOWN_ROW = ["AMEX PLATINUM (NPSL)", "Experian", 5200, null, "", "", "MONITOR"];

/** Every sentence below must appear, verbatim, in all three printers. */
const SHARED = Object.freeze({
  reasonZero: "The credit limit reported for this card is $0",
  reasonUnknown: "No credit limit is reported for this card",
  noTotalAboveZero: "No open card on this file reports a credit limit above $0, so there is no "
    + "10% total to work back to.",
  tail: ", so there is no 10% target to pay down to"
});

describe("the capture of printer 2 is current", () => {
  test("fundhub_gen.py has not moved since the fixtures were taken", () => {
    const sha = createHash("sha256").update(readFileSync(GEN)).digest("hex");
    assert.equal(sha, PY.generatorSha256,
      "fundhub_gen.py changed — re-run: python3 scripts/black-reports/recapture-fixtures.py");
  });
});

describe("the reason a card has no 10% target", () => {
  test("printer 1 and printer 3 agree, character for character", () => {
    assert.equal(webNoTargetReason(POSITIVE_ROW), pdfNoTargetReason(POSITIVE_ROW));
    assert.equal(webNoTargetReason(ZERO_ROW), pdfNoTargetReason(ZERO_ROW));
    assert.equal(webNoTargetReason(UNKNOWN_ROW), pdfNoTargetReason(UNKNOWN_ROW));
  });

  test("printer 2 agrees with both", () => {
    assert.equal(PY.helpers.no_target_reason.positive, webNoTargetReason(POSITIVE_ROW));
    assert.equal(PY.helpers.no_target_reason.zero, webNoTargetReason(ZERO_ROW));
    assert.equal(PY.helpers.no_target_reason.unknown, webNoTargetReason(UNKNOWN_ROW));
  });

  test("and the words are the ones this lane fixed", () => {
    assert.equal(webNoTargetReason(POSITIVE_ROW), "", "a card WITH a target gets no reason");
    assert.equal(webNoTargetReason(ZERO_ROW), SHARED.reasonZero);
    assert.equal(webNoTargetReason(UNKNOWN_ROW), SHARED.reasonUnknown);
    assert.notEqual(SHARED.reasonZero, SHARED.reasonUnknown,
      "a reported $0 and an unreported limit are two different facts");
  });
});

describe("the paydown sentence for a card with no target", () => {
  for (const [label, row, reason] of [
    ["a $0 limit", ZERO_ROW, SHARED.reasonZero],
    ["no limit at all", UNKNOWN_ROW, SHARED.reasonUnknown]
  ]) {
    test(`${label}: all three say the same thing`, () => {
      const expected = `${reason}${SHARED.tail}`;
      assert.ok(webPaydownSentence(row).endsWith(expected),
        `printer 1: ${webPaydownSentence(row)}`);
      assert.ok(pdfPaydownInstruction(row).includes(expected),
        `printer 3: ${pdfPaydownInstruction(row)}`);
      assert.ok(PY.helpers.paydown_sentence[row === ZERO_ROW ? "zero" : "unknown"]
        .endsWith(expected), "printer 2");
    });
  }

  /* The one difference between printers, stated so a FOURTH one is a failure
     rather than a surprise: printer 3 draws a paragraph and closes the sentence
     with a full stop plus the follow-up line; printers 1 and 2 build a table cell
     and stop. Same words, different terminator. */
  test("printer 3's only divergence is its terminator, and it is written down", () => {
    const web = webPaydownSentence(ZERO_ROW);
    const pdf = pdfPaydownInstruction(ZERO_ROW);
    assert.equal(pdf, `${web}. Keep the balance moving down and we will set a target when a `
      + "limit reports.");
  });
});

describe("the overall total, when no open card reports a limit above $0", () => {
  test("all three print the identical sentence", () => {
    const roadmap = buildRoadmap(ZERO_CLIENT);
    assert.ok(roadmap.includes(SHARED.noTotalAboveZero), "printer 1");
    assert.ok(PY.bodies.roadmap.includes(SHARED.noTotalAboveZero), "printer 2");
    assert.ok(pdfTotalPaydownSentence(ZERO_CLIENT).startsWith(SHARED.noTotalAboveZero),
      `printer 3: ${pdfTotalPaydownSentence(ZERO_CLIENT)}`);
  });

  test("and it holds for the missing-limit file too, not just the $0 one", () => {
    assert.ok(buildRoadmap(NO_LIMIT_CLIENT).includes(SHARED.noTotalAboveZero), "printer 1");
    assert.ok(PY_NO_LIMIT.roadmap.includes(SHARED.noTotalAboveZero), "printer 2");
    assert.ok(pdfTotalPaydownSentence(NO_LIMIT_CLIENT).startsWith(SHARED.noTotalAboveZero),
      "printer 3");
  });

  test("no printer says 'reports a credit limit' without 'above $0'", () => {
    const bad = /reports a credit limit,/;
    assert.ok(!bad.test(buildRoadmap(ZERO_CLIENT)), "printer 1 roadmap");
    assert.ok(!bad.test(buildLenderList(ZERO_CLIENT)), "printer 1 lender list");
    for (const [name, html] of Object.entries(PY.bodies)) {
      assert.ok(!bad.test(html), `printer 2 ${name}`);
    }
    assert.ok(!bad.test(pdfTotalPaydownSentence(ZERO_CLIENT)), "printer 3");
  });
});

describe("the closing page's opening sentence", () => {
  /* F53. Printers 1 and 2 both told EVERY client "You have clean bureaus ready
     for funding now." Printer 3 never made that claim — it led on lenders — so
     for the same client the pack's last page said two different things depending
     on which printer made it. All three now run the same order. */
  const cases = [
    ["a file with clean bureaus", ZERO_CLIENT],
    ["a file with clean bureaus and a missing limit", NO_LIMIT_CLIENT],
    ["a file with no clean bureau and no lender open today", {
      ...ZERO_CLIENT,
      bureaus: [["Experian", "DIRTY", 3, "Three derogatory items."]],
      lenders_now: [], lenders_after: [], lenders: []
    }],
    ["a file with no clean bureau but lenders open today", {
      ...ZERO_CLIENT,
      bureaus: [["Experian", "DIRTY", 3, "Three derogatory items."]]
    }]
  ];

  for (const [label, client] of cases) {
    test(`${label}: printer 1 and printer 3 lead with the same sentence`, () => {
      const lead = pdfCtaLead(client);
      assert.ok(ctaPage(client).includes(lead.replace(/&/g, "&amp;")),
        `printer 1 does not carry: ${lead}`);
    });
  }

  test("no printer claims a clean bureau the file does not show", () => {
    const dirty = { ...ZERO_CLIENT, bureaus: [["Experian", "DIRTY", 3, "Three items."]] };
    assert.deepEqual(pdfCleanBureaus(dirty), []);
    assert.ok(!/clean bureaus? ready for funding/.test(ctaPage(dirty)));
    assert.ok(!/clean bureaus? ready for funding/.test(pdfCtaLead(dirty)));
  });

  test("printer 2 carries the same sentence for the captured client", () => {
    const lead = pdfCtaLead(ZERO_CLIENT);
    assert.ok(PY.bodies.roadmap.includes(lead), `printer 2 does not carry: ${lead}`);
    assert.ok(PY.bodies.funding_snapshot.includes(lead), "printer 2 funding snapshot");
    assert.ok(PY.bodies.credit_analysis.includes(lead), "printer 2 credit analysis");
    assert.ok(PY.bodies.lender_match.includes(lead), "printer 2 lender list");
  });
});

describe("no printer asserts an account, a bureau or a history the file does not carry", () => {
  /* F53. Every one of these was a hardcoded literal printed for every client.
     They are listed here by their own words so that re-introducing one fails. */
  const INVENTED = [
    "You have a mortgage. You have paid-off auto loans. You have a clean TransUnion.",
    "paid-off auto loans",
    "your two revolving cards",
    "Those three moves alone",
    "TransUnion holding at 725",
    "charge-offs removed, lates addressed, utilization under",
    "Secretary of State for -",
    "Secretary of State for .",
    "your utilization is -.",
    "You have clean bureaus ready for funding now. Apply on those"
  ];
  const EMPTY_FILE = Object.freeze({
    ...ZERO_CLIENT,
    bureaus: [], revolving: [], negatives: [], installments: [], mortgages: [],
    public_obligations: [], personal_data: [], inquiries: [], inquiry_total: 0,
    au_account: { creditor: "", bureau: "", limit: null, balance: null, util: "", age: "" },
    lenders: [], lenders_now: [], lenders_after: [],
    util_total_balance: null, util_total_limit: null, util_target_balance: null, util_pct: ""
  });

  test("printer 1 carries none of them, on a file that supports none of them", () => {
    const html = buildRoadmap(EMPTY_FILE) + buildLenderList(EMPTY_FILE) + ctaPage(EMPTY_FILE);
    for (const phrase of INVENTED) {
      assert.ok(!html.includes(phrase), `printer 1 still prints: ${phrase}`);
    }
  });

  test("printer 2 carries none of them either", () => {
    for (const [name, body] of Object.entries(PY.bodies)) {
      for (const phrase of INVENTED) {
        assert.ok(!body.includes(phrase), `printer 2 ${name} still prints: ${phrase}`);
      }
    }
  });

  test("printer 3 carries none of them in its own source", () => {
    /* Printer 3 draws into a PDF, so there is no HTML body to grep. Its source is
       the next best thing — but the comments in that file QUOTE the defects they
       fixed, so the comments come out first and only code is searched. */
    const src = readFileSync(join(HERE, "..", "underwrite", "black-report-node.mjs"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");
    assert.ok(code.includes("function ctaLead"), "the comment strip removed too much");
    for (const phrase of INVENTED) {
      assert.ok(!code.includes(phrase), `printer 3 still prints: ${phrase}`);
    }
  });
});
