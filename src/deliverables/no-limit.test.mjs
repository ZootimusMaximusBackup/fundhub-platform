// A CARD WITH NO REPORTED CREDIT LIMIT, THROUGH THE HOSTED WEB PAGES.
//
// This is the THIRD renderer. src/underwrite/black-report-node.mjs (the pdf-lib
// printer) and scripts/black-reports/fundhub_gen.py (the WeasyPrint printer)
// were repaired for this on 2026-09-04 and 2026-09-06; these four documents were
// not, and carried the identical defect in three of them:
//
//   "Pay AMEX PLATINUM (NPSL) from $5,200 down to "   funding_snapshot.html
//   "Pay AMEX PLATINUM (NPSL) from $5,200 to "        credit_analysis_report.html
//   "Pay AMEX PLATINUM (NPSL) from $5,200 down to "   optimization_roadmap.html
//
// plus the worse one underneath it: with NO open card reporting a limit at all,
// the vendor engine's total limit is 0, ten percent of 0 is 0, and the roadmap
// printed the client's ENTIRE balance (Node) or $0 (Python and here) as the
// amount to pay — three lines under the same card's row that correctly printed
// dashes.
//
// NULL MEANS UNKNOWN. Absence of data produces no claim. Every assertion below
// is about a sentence that must NOT appear, or a sentence that says plainly that
// the figure is not on the file.
//
// COMPLIANCE REVIEW REQUIRED — credit-repair messaging. Marker only.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildBlackReportClient } from "../underwrite/black-report-client.mjs";
import { renderAllDeliverables } from "./index.mjs";
import { buildCreditAnalysis } from "./credit-analysis.mjs";
import { buildFundingSnapshot } from "./funding-snapshot.mjs";
import { buildLenderList } from "./lender-list.mjs";
import { buildRoadmap } from "./roadmap.mjs";
import { targetText, paydownSentence, heroCard, utilTotalsKnown, lenderBuckets,
  cardsWithNoTarget } from "./derive.mjs";

const PULLED_AT = "2026-07-25T12:00:00.000Z";
const PERSONAL = Object.freeze({
  name: "Fixture Client",
  address: "100 Test Ave\nDenton, TX 76205",
  city: "Denton", state: "TX", zip: "76205"
});

/** NOTHING on the file reports a limit. This is the shape that produced $0. */
const NO_LIMIT_ANYWHERE = Object.freeze({
  outcome: "FULL_FUNDING",
  pulledAt: PULLED_AT,
  consumerSignals: {
    scores: { median: 700, perBureau: { ex: 700, eq: 705, tu: 695 } },
    /* Exactly what derive-consumer-signals.js:185-187 emits for this file: it
       sums `effectiveLimit || 0`, and returns pct null because the total is 0. */
    utilization: { totalBalance: 5200, totalLimit: 0, pct: null }
  },
  preapprovals: { totalCombined: 50000 },
  projectedPreapproval: { totalCombined: 60000 },
  businessSignals: { available: false },
  findings: [],
  normalized: {
    tradelines: [
      { source: "experian", creditorName: "AMEX PLATINUM (NPSL)", accountIdentifier: "AMEX-1",
        accountType: "revolving", status: "open", isAU: false, isDerogatory: false,
        currentBalance: 5200, effectiveLimit: null, openedDate: null,
        currentRatingType: "AsAgreed" }
    ],
    inquiries: [],
    identity: {}
  }
});

/** One card reports a limit, one does not. The total is real but partial. */
const MIXED = Object.freeze({
  ...NO_LIMIT_ANYWHERE,
  consumerSignals: {
    scores: { median: 700, perBureau: { ex: 700, eq: 705, tu: 695 } },
    utilization: { totalBalance: 13500, totalLimit: 30000, pct: 45 }
  },
  normalized: {
    tradelines: [
      ...["transunion", "experian", "equifax"].map((source) => ({
        source, creditorName: "TEST CARD", accountIdentifier: "TEST-CARD-1234",
        accountType: "revolving", status: "open", isAU: false, isDerogatory: false,
        currentBalance: 4500, effectiveLimit: 10000, openedDate: null,
        currentRatingType: "AsAgreed"
      })),
      { source: "experian", creditorName: "AMEX PLATINUM (NPSL)", accountIdentifier: "AMEX-1",
        accountType: "revolving", status: "open", isAU: false, isDerogatory: false,
        currentBalance: 5200, effectiveLimit: null, openedDate: null,
        currentRatingType: "AsAgreed" }
    ],
    inquiries: [],
    identity: {}
  }
});

const clientOf = (crsResult) => buildBlackReportClient({ crsResult, personal: PERSONAL });
const docsOf = (client) => {
  const out = {};
  for (const d of renderAllDeliverables({ client, fontsHref: "/assets/fonts" })) {
    out[d.filename] = d.html;
  }
  return out;
};

describe("the mapper refuses to build a total out of unknowns", () => {
  test("a zero total limit from the engine is unknown, not zero", () => {
    const c = clientOf(NO_LIMIT_ANYWHERE);
    assert.equal(c.util_total_balance, 5200, "the balance IS known and survives");
    assert.equal(c.util_total_limit, null, "10% of a limit the file does not have is not 0");
    assert.equal(c.util_target_balance, null);
    assert.equal(c.util_pct, "", "the engine returns pct null on the same condition");
    assert.equal(utilTotalsKnown(c), false);
  });

  test("a real total limit is still used, unchanged", () => {
    const c = clientOf(MIXED);
    assert.equal(c.util_total_limit, 10000, "the one card that reports a limit");
    assert.equal(c.util_target_balance, 1000);
    assert.equal(utilTotalsKnown(c), true);
    assert.equal(cardsWithNoTarget(c), 1, "and the NPSL card is counted as uncovered");
  });
});

describe("the shared helpers never invent a target", () => {
  const c = clientOf(MIXED);
  const npsl = c.revolving.find((r) => r[0] === "AMEX PLATINUM (NPSL)");
  const test_card = c.revolving.find((r) => r[0] === "TEST CARD");

  test("targetText is null for a card with no limit, and a figure for one with", () => {
    assert.equal(targetText(npsl), null);
    assert.equal(targetText(test_card), "$1,000");
  });

  test("paydownSentence is a complete sentence either way", () => {
    assert.equal(paydownSentence(test_card), "Pay TEST CARD from $4,500 down to $1,000");
    assert.equal(paydownSentence(npsl),
      "AMEX PLATINUM (NPSL) - $5,200 owed. No credit limit is reported for this card, "
      + "so there is no 10% target to pay down to");
    assert.ok(!paydownSentence(npsl).endsWith("down to "), "the sentence used to run off the end");
  });

  test("heroCard will not nominate a card it cannot state a target for", () => {
    assert.equal(heroCard(clientOf(NO_LIMIT_ANYWHERE)), null);
    assert.equal(heroCard(c)[0], "TEST CARD");
  });
});

describe("no open card reports a limit — the four pages", () => {
  const c = clientOf(NO_LIMIT_ANYWHERE);
  const docs = docsOf(c);

  test("no sentence runs off the end at a missing target", () => {
    for (const [name, html] of Object.entries(docs)) {
      /* The one legitimate sentence that ENDS on the words "pay down to" is the
         replacement itself, so it comes out before the check that nothing else
         does. */
      const rest = html.split("so there is no 10% target to pay down to").join("[HONEST]");
      assert.ok(!/from \$[\d,]+ (down )?to\s*[<.]/.test(rest),
        `${name} still ends a paydown sentence at a target it does not have`);
      // Lower case only: "PAY DOWN TO</th>" is the table's column heading.
      assert.ok(!/pay down to\s*<\/?/.test(rest), `${name} has an empty "pay down to"`);
    }
  });

  test("the roadmap does not name a paydown amount it cannot work out", () => {
    const html = docs["optimization_roadmap.html"];
    assert.ok(!/Total paydown to reach 10% utilization/.test(html),
      "there is no total when there is no limit anywhere");
    /* F52b. "reports a credit limit" was false for a card whose limit IS
       reported, as $0. "above $0" is true of both, and is the same sentence in
       all three printers. */
    assert.ok(html.includes("No open card on this file reports a credit limit above $0, so "
      + "there is no 10% total to work back to"), "and it says so instead of going quiet");
  });

  test("nothing is targeted at $0 anywhere", () => {
    for (const [name, html] of Object.entries(docs)) {
      assert.ok(!/pay down to under \$0/.test(html), `${name} targets $0`);
      assert.ok(!/balances to \$0/.test(html), `${name} targets $0`);
      assert.ok(!/down to under \$0/.test(html), `${name} targets $0`);
      assert.ok(!/of \$0 /.test(html), `${name} prints a $0 credit limit`);
    }
  });

  test("no verdict is passed on a utilization figure the file does not have", () => {
    for (const [name, html] of Object.entries(docs)) {
      assert.ok(!/utilization is at\s*-/.test(html), `${name} judged a dash`);
      assert.ok(!/Overall utilization:\s*<?\/?[a-z]*>?\s*-\s*- This is your #1 problem/.test(html),
        `${name} called a dash the #1 problem`);
      assert.ok(!/utilization penalty \(\)/.test(html), `${name} charged an empty penalty`);
    }
  });

  test("the lender list says what the file cannot tell the client", () => {
    const html = docs["lender_match_list.html"];
    assert.ok(html.includes("No open card on this file reports a credit limit above $0, so "
      + "there is no overall utilization figure to read"));
  });
});

describe("some cards report a limit and some do not — the four pages", () => {
  const c = clientOf(MIXED);
  const docs = docsOf(c);

  test("the total is stated AND says which cards it cannot cover", () => {
    const html = docs["optimization_roadmap.html"];
    assert.ok(html.includes("Total paydown to reach 10% utilization: $3,500."),
      "the cards that do report a limit still get a real total");
    assert.ok(html.includes("1 card on this file has no 10% target, so nothing for it is in "
      + "this number."), "and the client is told the total is partial");
  });

  test("the card with no limit prints dashes, not a target", () => {
    const html = docs["optimization_roadmap.html"];
    assert.ok(/AMEX PLATINUM \(NPSL\)<\/td><td[^>]*>\$5,200<\/td><td[^>]*>-<\/td><td[^>]*>-<\/td><td[^>]*>-<\/td>/
      .test(html.replace(/\s+/g, " ")), "the Month 1 row still reads $5,200 - - -");
  });

  test("no sentence runs off the end here either", () => {
    for (const [name, html] of Object.entries(docs)) {
      assert.ok(!/from \$[\d,]+ (down )?to\s*[<.]/.test(html), `${name}`);
    }
  });
});

describe("F45 — the lenders open to this client today reach all four pages", () => {
  const c = clientOf(MIXED);
  const docs = docsOf(c);
  const [now, after] = lenderBuckets(c);

  test("the matcher really did put lenders in the available-now bucket", () => {
    assert.ok(now.length > 0, "this fixture must have lenders open today for the rest to mean anything");
    assert.equal(now.length + after.length, (c.lenders || []).length);
  });

  test("the lender list stops telling him nobody will lend to him", () => {
    const html = docs["lender_match_list.html"];
    assert.ok(!html.includes("No lenders are matched for immediate funding right now"),
      "this client has lenders open to him today");
    assert.ok(html.includes(`${now.length} lenders are open to you today`));
  });

  test("every count of lenders available today is the real one, not 0", () => {
    for (const [name, html] of Object.entries(docs)) {
      const flat = html.replace(/\s+/g, " ");
      for (const label of ["Lenders Available", "Lenders on this shortlist"]) {
        const m = flat.match(new RegExp(`${label}</td><td[^>]*>([^<]*)</td>`));
        if (!m) continue;
        assert.equal(m[1].trim(), String(now.length),
          `${name} prints "${label}: ${m[1]}" for a client with ${now.length} open today`);
      }
    }
  });

  test("the locked list holds only the locked lenders", () => {
    const html = docs["funding_snapshot.html"];
    for (const row of now) {
      assert.ok(!html.includes(`>${row[0]}</td>`),
        `${row[0]} is open today and must not be filed under "after optimization"`);
    }
  });
});

/* ═════════ THE OTHER TWO PRINTERS ═════════
   There are THREE renderers of these four documents, enumerated from the
   filesystem on 2026-09-06 by grepping for the roadmap's own paydown line:

     $ grep -rln "Total paydown to reach" . --exclude-dir=node_modules --exclude-dir=.git
     scripts/black-reports/fundhub_gen.py     the WeasyPrint printer
     src/deliverables/roadmap.mjs             these hosted web pages
     src/underwrite/black-report-node.mjs     the pdf-lib printer
     docs/workflows/gold-deliverables-v5/compare/gold-optimization_roadmap.txt   (a
                                              captured document, not a renderer)
     src/deliverables/fixtures/python-bodies.json                (a captured body)

   render-service/ is NOT a fourth: render-service/Dockerfile:51 copies
   scripts/black-reports/ into the image verbatim and render-service/wsgi.py
   shells out to it, so the render service IS the WeasyPrint printer.

   The pdf-lib printer has its own guard in
   ../underwrite/black-report-node.test.mjs. The WeasyPrint printer is covered
   here: its four bodies for this exact client are captured in
   fixtures/no-limit-python-bodies.json, and the sha of the generator is pinned
   in ../underwrite/output-baseline.test.mjs, so neither can move unnoticed. */

const HERE = dirname(fileURLToPath(import.meta.url));
const fx = (n) => JSON.parse(readFileSync(join(HERE, "fixtures", n), "utf8"));
const NO_LIMIT_CLIENT = fx("no-limit-client.json");
const PY_NO_LIMIT = fx("no-limit-python-bodies.json");

/** The four already-documented Python/Node divergences, and only those. */
const DIVERGENCES = Object.freeze({
  credit_analysis: [["(Transunion 695)", "(TransUnion 695)"]],
  funding_snapshot: [],
  lender_match: [["BANK & LENDER MATCH LIST", "BANK &amp; LENDER MATCH LIST"]],
  roadmap: [
    ["Fixture's 6-Month Business Readiness Roadmap", "Fixture&#39;s 6-Month Business Readiness Roadmap"],
    ["Before &amp;amp; After", "Before &amp; After"]
  ]
});

const norm = (s) => String(s).replace(/(\d)\.0(?=["\s,L])/g, "$1").replace(/\s+/g, " ").trim();

function correctPython(name, html) {
  let out = html;
  for (const [from, to] of DIVERGENCES[name]) {
    assert.ok(out.includes(from), `python output no longer contains ${JSON.stringify(from)}`);
    out = out.split(from).join(to);
  }
  return out;
}

describe("the WeasyPrint printer prints the same words for this client", () => {
  const builders = {
    credit_analysis: buildCreditAnalysis,
    funding_snapshot: buildFundingSnapshot,
    lender_match: buildLenderList,
    roadmap: buildRoadmap
  };

  test("the captured Python bodies are for THIS client", () => {
    assert.equal(NO_LIMIT_CLIENT.util_total_limit, null);
    assert.equal(NO_LIMIT_CLIENT.util_target_balance, null);
    assert.equal(NO_LIMIT_CLIENT.util_total_balance, 5200);
    assert.deepEqual(Object.keys(PY_NO_LIMIT).sort(), Object.keys(builders).sort());
  });

  for (const [name, build] of Object.entries(builders)) {
    test(`${name} matches fundhub_gen.py for the no-limit client`, () => {
      assert.equal(norm(build(NO_LIMIT_CLIENT)), norm(correctPython(name, PY_NO_LIMIT[name])));
    });
  }

  test("the Python bodies carry none of the defects either", () => {
    for (const [name, html] of Object.entries(PY_NO_LIMIT)) {
      const rest = html.split("so there is no 10% target to pay down to").join("[HONEST]");
      assert.ok(!/from \$[\d,]+ (down )?to\s*[<.]/.test(rest), `${name}: sentence runs off the end`);
      assert.ok(!/pay down to\s*<\/?/.test(rest), `${name}: empty "pay down to"`);
      assert.ok(!/under \$0/.test(html), `${name}: targets $0`);
      assert.ok(!/Total paydown to reach 10% utilization: \$0/.test(html), `${name}: $0 total`);
      assert.ok(!/utilization penalty \(\)/.test(html), `${name}: empty penalty`);
      assert.ok(!/utilization is at\s+-/.test(html), `${name}: judged a dash`);
    }
    assert.ok(!PY_NO_LIMIT.lender_match.includes("No lenders are matched for immediate funding"),
      "F45: this client has five lenders open to him today");
    assert.ok(PY_NO_LIMIT.lender_match.includes("5 lenders are open to you today"));
  });
});
