// A CARD WHOSE CREDIT LIMIT IS REPORTED AS $0. ZERO IS NOT NULL.
//
// THE DEFECT. targetBal() asked one question — "is the limit null?" — of a cell
// that holds one of THREE things:
//
//   a positive number   the file states a ceiling. 10% of it is a target.
//   the number ZERO     the file states a ceiling of nothing. That is a KNOWN
//                       value, not a missing one, and 10% of it is $0.
//   null / ""           the file does not say. A charge card, or an account with
//                       no preset spending limit.
//
// Zero is not null, so the middle case computed Math.round(0 * 0.1) = 0 and
// printed it as an instruction a client cannot follow:
//
//   "Pay SECURED CARD from $900 down to $0"
//
// in credit_analysis_report.html, funding_snapshot.html AND
// optimization_roadmap.html, and in all four bodies of the WeasyPrint printer —
// three lines under the same card's own row, which correctly printed dashes.
// A card with a genuine $0 limit cannot have a paydown target.
//
// AND THE SECOND HALF, WHICH IS ITS OWN FALSE STATEMENT. The repair is NOT to
// route a reported zero into the missing-limit sentence. Telling the holder of a
// card whose limit IS reported, as $0, that "no credit limit is reported for this
// card" is a different untrue sentence about the same account. The two cases
// share the OUTCOME — no target — and not the WORDS.
//
// THE FIXTURE is the reviewer's own reproduction, built through the real mapper:
// one open revolving card, SECURED CARD, balance 900, effectiveLimit 0, engine
// utilization { totalBalance: 900, totalLimit: 0, pct: null }.
//
// COMPLIANCE REVIEW REQUIRED — credit-repair messaging. Marker only.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildBlackReportClient } from "../underwrite/black-report-client.mjs";
import { renderAllDeliverables } from "./index.mjs";
import { limitState, targetBal, targetText, paydownSentence, noTargetReason, noTargetCell,
  utilTotalsKnown, heroCard } from "./derive.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const fx = (n) => JSON.parse(readFileSync(join(HERE, "fixtures", n), "utf8"));

/** The exact shape the reviewer ran. effectiveLimit is the number 0, not null. */
const ZERO_LIMIT_CRS = Object.freeze({
  outcome: "FULL_FUNDING",
  pulledAt: "2026-07-25T12:00:00.000Z",
  consumerSignals: {
    scores: { median: 700, perBureau: { ex: 700, eq: 705, tu: 695 } },
    utilization: { totalBalance: 900, totalLimit: 0, pct: null }
  },
  preapprovals: { totalCombined: 50000 },
  projectedPreapproval: { totalCombined: 60000 },
  businessSignals: { available: false },
  findings: [],
  normalized: {
    tradelines: [
      { source: "experian", creditorName: "SECURED CARD", accountIdentifier: "SEC-1",
        accountType: "revolving", status: "open", isAU: false, isDerogatory: false,
        currentBalance: 900, effectiveLimit: 0, openedDate: null,
        currentRatingType: "AsAgreed" }
    ],
    inquiries: [],
    identity: {}
  }
});

const PERSONAL = Object.freeze({
  name: "Fixture Client",
  address: "100 Test Ave\nDenton, TX 76205",
  city: "Denton", state: "TX", zip: "76205"
});

const POSITIVE_ROW = ["TEST CARD", "Experian", 4500, 10000, "45%", "$1,000", "MONITOR"];
const ZERO_ROW = ["SECURED CARD", "Experian", 900, 0, "", "", "MONITOR"];
const UNKNOWN_ROW = ["AMEX PLATINUM (NPSL)", "Experian", 5200, null, "", "", "MONITOR"];

describe("the mapper keeps a reported zero as a reported zero", () => {
  const c = buildBlackReportClient({ crsResult: ZERO_LIMIT_CRS, personal: PERSONAL });

  test("the limit cell holds 0, not null and not a substitute", () => {
    assert.deepEqual(c.revolving, [["SECURED CARD", "Experian", 900, 0, "", "", "MONITOR"]]);
  });

  test("no overall total is built out of a ceiling of nothing", () => {
    assert.equal(c.util_total_limit, null, "a total limit of 0 is not a real ceiling");
    assert.equal(c.util_target_balance, null);
    assert.equal(c.util_pct, "", "the engine returns pct null on the same condition");
    assert.equal(utilTotalsKnown(c), false);
  });

  test("the checked-in fixture is this client", () => {
    const saved = fx("zero-limit-client.json");
    assert.deepEqual(saved.revolving, c.revolving);
    assert.equal(saved.util_total_limit, null);
    assert.equal(saved.util_target_balance, null);
  });
});

describe("three limit states, three answers", () => {
  test("limitState tells them apart", () => {
    assert.equal(limitState(POSITIVE_ROW), "known");
    assert.equal(limitState(ZERO_ROW), "zero");
    assert.equal(limitState(UNKNOWN_ROW), "unknown");
  });

  test("only a POSITIVE limit produces a target", () => {
    assert.equal(targetBal(POSITIVE_ROW), 1000);
    assert.equal(targetBal(ZERO_ROW), null, "10% of $0 is not a paydown target");
    assert.equal(targetBal(UNKNOWN_ROW), null);
    assert.equal(targetText(ZERO_ROW), null);
  });

  test("a reported zero and a missing limit do NOT get the same sentence", () => {
    assert.equal(noTargetReason(POSITIVE_ROW), "");
    assert.equal(noTargetReason(ZERO_ROW), "The credit limit reported for this card is $0");
    assert.equal(noTargetReason(UNKNOWN_ROW), "No credit limit is reported for this card");
    assert.notEqual(noTargetReason(ZERO_ROW), noTargetReason(UNKNOWN_ROW));
  });

  test("and the table cell says which it is", () => {
    assert.equal(noTargetCell(POSITIVE_ROW), "");
    assert.equal(noTargetCell(ZERO_ROW), "limit reported as $0");
    assert.equal(noTargetCell(UNKNOWN_ROW), "no limit reported");
  });

  test("the paydown sentence is complete and true in all three states", () => {
    assert.equal(paydownSentence(POSITIVE_ROW), "Pay TEST CARD from $4,500 down to $1,000");
    assert.equal(paydownSentence(ZERO_ROW),
      "SECURED CARD - $900 owed. The credit limit reported for this card is $0, "
      + "so there is no 10% target to pay down to");
    assert.equal(paydownSentence(UNKNOWN_ROW),
      "AMEX PLATINUM (NPSL) - $5,200 owed. No credit limit is reported for this card, "
      + "so there is no 10% target to pay down to");
  });

  test("heroCard will not nominate a card whose target is $0", () => {
    assert.equal(heroCard(fx("zero-limit-client.json")), null);
  });
});

describe("the four hosted pages, for a card reporting a $0 limit", () => {
  const client = fx("zero-limit-client.json");
  const docs = {};
  for (const d of renderAllDeliverables({ client, fontsHref: "/assets/fonts" })) {
    docs[d.filename] = d.html;
  }

  test("no page invents a paydown target of $0", () => {
    for (const [name, html] of Object.entries(docs)) {
      assert.ok(!/down to \$0/.test(html), `${name} still says "down to $0"`);
      assert.ok(!/to \$0 or less/.test(html), `${name} targets $0`);
      assert.ok(!/balances to \$0/.test(html), `${name} targets $0`);
      assert.ok(!/Total paydown to reach 10% utilization: \$0/.test(html), `${name}: $0 total`);
    }
  });

  test("no sentence runs off the end at a target the file cannot state", () => {
    for (const [name, html] of Object.entries(docs)) {
      const rest = html.split("so there is no 10% target to pay down to").join("[HONEST]");
      assert.ok(!/from \$[\d,]+ (down )?to\s*[<.]/.test(rest), `${name}: sentence runs off the end`);
      assert.ok(!/pay down to\s*<\/?/.test(rest), `${name}: empty "pay down to"`);
    }
  });

  test("no page calls this card's limit unreported — it IS reported, as $0", () => {
    for (const [name, html] of Object.entries(docs)) {
      assert.ok(!/No credit limit is reported for this card/.test(html),
        `${name} calls a reported $0 limit unreported`);
      assert.ok(!/owed, no limit reported/.test(html), `${name} calls a reported $0 limit unreported`);
    }
  });

  test("the pages that do explain it use the one shared phrase", () => {
    for (const name of ["credit_analysis_report.html", "funding_snapshot.html",
      "optimization_roadmap.html"]) {
      assert.ok(docs[name].includes("The credit limit reported for this card is $0, so there is "
        + "no 10% target to pay down to"), `${name} does not explain the missing target`);
    }
  });

  test("the roadmap's Month 1 row still prints dashes, and its total says why", () => {
    const flat = docs["optimization_roadmap.html"].replace(/\s+/g, " ");
    assert.ok(/SECURED CARD<\/td><td[^>]*>\$900<\/td><td[^>]*>\$0<\/td><td[^>]*>-<\/td><td[^>]*>-<\/td>/
      .test(flat), "the Month 1 row must read $900 $0 - -");
    assert.ok(docs["optimization_roadmap.html"].includes(
      "No open card on this file reports a credit limit above $0, so there is no 10% total to "
      + "work back to"), "and the total says above $0, which is true of both states");
  });

  test("the month 6 column names the state, not a blank and not a wrong state", () => {
    const html = docs["optimization_roadmap.html"];
    assert.ok(html.includes("$900 owed, limit reported as $0"));
    assert.ok(html.includes("Limit reported as $0 - no target"));
  });
});

describe("the WeasyPrint printer prints the same words for this client", () => {
  const captured = fx("zero-limit-python-bodies.json");
  const client = fx("zero-limit-client.json");
  const docs = {};
  for (const d of renderAllDeliverables({ client, fontsHref: "/assets/fonts" })) {
    docs[d.filename] = d.html;
  }

  test("the capture is of the fundhub_gen.py that is in the tree right now", async () => {
    const { createHash } = await import("node:crypto");
    const gen = readFileSync(join(HERE, "..", "..", "scripts", "black-reports", "fundhub_gen.py"));
    assert.equal(createHash("sha256").update(gen).digest("hex"), captured.generatorSha256,
      "fundhub_gen.py moved — re-run: python3 scripts/black-reports/recapture-fixtures.py");
  });

  test("its own helpers answer all three limit states identically", () => {
    assert.deepEqual(captured.helpers.no_target_reason, {
      positive: noTargetReason(POSITIVE_ROW),
      zero: noTargetReason(ZERO_ROW),
      unknown: noTargetReason(UNKNOWN_ROW)
    });
    assert.deepEqual(captured.helpers.no_target_cell, {
      positive: noTargetCell(POSITIVE_ROW),
      zero: noTargetCell(ZERO_ROW),
      unknown: noTargetCell(UNKNOWN_ROW)
    });
    assert.deepEqual(captured.helpers.paydown_sentence, {
      zero: paydownSentence(ZERO_ROW),
      unknown: paydownSentence(UNKNOWN_ROW)
    });
  });

  test("its four bodies carry none of the defects either", () => {
    for (const [name, html] of Object.entries(captured.bodies)) {
      assert.ok(!/down to \$0/.test(html), `${name} still says "down to $0"`);
      assert.ok(!/to \$0 or less/.test(html), `${name} targets $0`);
      assert.ok(!/No credit limit is reported for this card/.test(html),
        `${name} calls a reported $0 limit unreported`);
      assert.ok(!/Total paydown to reach 10% utilization: \$0/.test(html), `${name}: $0 total`);
      const rest = html.split("so there is no 10% target to pay down to").join("[HONEST]");
      assert.ok(!/from \$[\d,]+ (down )?to\s*[<.]/.test(rest), `${name}: sentence runs off the end`);
    }
  });
});
