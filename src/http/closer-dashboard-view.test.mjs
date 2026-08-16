/* Tests for src/http/closer-dashboard-view.mjs — the pure half of the Closer
 * Dashboard's wiring, and for the verbatim copy of it that the page carries.
 *
 * THE FIXTURES ARE NOT HAND-WRITTEN RESPONSE SHAPES. Every payload below is
 * built the way api/read/tradelines.mjs builds one: real `tradelines` rows →
 * toCalculatorCards() → calcFunding(), plus the dollars-at-the-boundary mapping
 * the handler does. AUDIT-FINDINGS is explicit that a fake modelling the shape
 * you WISH you had cannot fail when the real thing moves — so if calcFunding's
 * output changes, or the handler's projection does, these go red instead of the
 * screen going quietly wrong.
 *
 * Row values arrive as STRINGS on purpose: node-pg returns bigint and
 * numeric(6,5) as strings, so `credit_limit_cents` and `apr` are strings on the
 * real wire and anything that assumes numbers breaks in production only.
 */
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import {
  usd, numText, pctText, esc, classify, buildView, bannerText, NOT_SOURCED
} from "./closer-dashboard-view.mjs";
import { calcFunding } from "../calculators/deal-funding.mjs";
import { toCalculatorCards, fromCents } from "../tradelines/index.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCREEN = path.resolve(HERE, "../../public/app/closer-dashboard.html");
const HTML = fs.readFileSync(SCREEN, "utf8");

/* ── fixtures ─────────────────────────────────────────────────────────────── */

const line = (lender, limit, balance, apr, extra = {}) => ({
  id: `id-${lender}`,
  lender,
  kind: "revolving",
  credit_limit_cents: limit == null ? null : String(limit * 100),
  balance_cents: balance == null ? null : String(balance * 100),
  apr: apr == null ? null : String(apr),
  closed_at: null,
  ...extra
});

/* The five cards the screen ships as sample markup, as they would be stored. */
const FIVE = [
  line("Capital One Spark", 15000, 4000, "0.14990"),
  line("Amex Blue Business", 18000, 8200, "0.16990"),
  line("Citi Costco", 12000, 4700, "0.18990"),
  line("Barclays View", 9000, 3600, "0.19990"),
  line("Chase Sapphire", 22000, 8400, "0.22990")
];

/** apiResponse — exactly what api/read/tradelines.mjs returns for these rows. */
function apiResponse(rows, { requestedAmount, utilizationThreshold } = {}) {
  const cards = toCalculatorCards(rows);
  const funding = calcFunding({
    cards,
    requestedAmount,
    ...(utilizationThreshold ? { utilizationThreshold } : {})
  });
  return {
    ok: true,
    data: rows.map((r) => ({
      ...r,
      credit_limit: fromCents(r.credit_limit_cents),
      balance: fromCents(r.balance_cents),
      available: Math.max(0, (fromCents(r.credit_limit_cents) ?? 0) - (fromCents(r.balance_cents) ?? 0))
    })),
    funding
  };
}

const okRead = (body) => ({ ok: true, source: "api", data: body, error: null });
const failRead = (source, error) => ({ ok: false, source, data: null, error });
const CID = "f3263bdb-45da-4056-8d6c-7c999d944fee";

/* ── formatting ───────────────────────────────────────────────────────────── */

test("usd: null is unknown and renders as a dash, never as $0", () => {
  assert.equal(usd(null), "—");
  assert.equal(usd(undefined), "—");
  assert.equal(usd(""), "—");
  assert.equal(usd(0), "$0", "an actual zero is still zero");
});

test("usd: garbage renders as a dash rather than $NaN", () => {
  assert.equal(usd("not money"), "—");
  assert.equal(usd(Infinity), "—");
});

test("usd: a numeric string from node-pg formats the same as a number", () => {
  assert.equal(usd("47100"), "$47,100");
  assert.equal(usd(47100), "$47,100");
});

test("numText: the waterfall's bare form carries no dollar sign", () => {
  assert.equal(numText(15000), "15,000");
  assert.equal(numText(null), "—");
});

test("pctText: APR is a fraction in the column and a percentage only on screen", () => {
  assert.equal(pctText("0.14990", 2), "14.99%");
  assert.equal(pctText(0.3, 0), "30%");
  assert.equal(pctText(null, 2), "—", "an unknown rate must not become 0.00%");
});

test("esc: a lender name containing markup cannot become markup", () => {
  assert.equal(esc('<img src=x onerror="1">'), "&lt;img src=x onerror=&quot;1&quot;&gt;");
});

/* ── classify: the fallback decision ──────────────────────────────────────── */

test("classify: with no client id the screen stays on sample and says how to load one", () => {
  const d = classify(null, {});
  assert.equal(d.mode, "sample");
  assert.equal(d.tone, "sample");
  assert.match(d.text, /\?client_id=/);
});

test("classify: an unrouted endpoint and a signed-out session are different sentences", () => {
  // The whole point of the requirement: "backend not deployed" and "you are not
  // logged in" are two different people's problems.
  const offline = classify(failRead("offline", "/api/* not deployed"), { clientId: CID });
  const auth = classify(failRead("unauthorized", "not signed in"), { clientId: CID });
  assert.notEqual(offline.text, auth.text);
  assert.match(offline.text, /not deployed or not routed/);
  assert.match(offline.text, /not a sign-in problem/);
  assert.match(auth.text, /not signed in \(401\)/);
  assert.equal(offline.tone, "error");
  assert.equal(auth.tone, "error");
});

test("classify: a database outage is reported as one, not as a missing route", () => {
  const d = classify(failRead("nodb", "database unreachable"), { clientId: CID });
  assert.equal(d.tone, "error");
  assert.match(d.text, /the API answered but the database did not/);
});

test("classify: a stale client id is NOT an outage — the backend answered honestly", () => {
  const notfound = classify(failRead("notfound", "no such record"), { clientId: CID });
  const bad = classify(failRead("badrequest", "client_id is required and must be a uuid"), { clientId: CID });
  assert.equal(notfound.tone, "sample");
  assert.equal(bad.tone, "sample");
});

test("classify: a demo session never claims the backend failed", () => {
  const d = classify(failRead("demo", "demo session"), { clientId: CID });
  assert.equal(d.tone, "sample");
  assert.match(d.text, /demo session/);
});

test("classify: an unknown failure still resolves to a sample screen, never to live", () => {
  const d = classify(failRead("teapot", "???"), { clientId: CID });
  assert.equal(d.mode, "sample");
  assert.equal(d.tone, "error");
});

test("classify: rows present means live", () => {
  const d = classify(okRead(apiResponse(FIVE, { requestedAmount: 35000 })), { clientId: CID });
  assert.equal(d.mode, "live");
  assert.equal(d.tone, "real");
});

test("classify: a client with no tradelines is empty, and empty keeps dashes", () => {
  const d = classify(okRead(apiResponse([], { requestedAmount: 35000 })), { clientId: CID });
  assert.equal(d.mode, "empty");
  assert.equal(d.tone, "sample");
  assert.match(d.text, /funding numbers stay dashes/);
  assert.ok(!/sample markup/.test(d.text));
});

test("classify: tradelines that exist but cannot be drawn against are empty, with the reason", () => {
  // An installment loan is stored, excluded from the waterfall by
  // toCalculatorCards, and must not leave the screen showing a blank table.
  const rows = [line("Ally Auto", 30000, 21000, "0.07990", { kind: "installment" })];
  const d = classify(okRead(apiResponse(rows, { requestedAmount: 5000 })), { clientId: CID });
  assert.equal(d.mode, "empty");
  assert.match(d.text, /none of them drawable/);
  assert.match(d.text, /funding numbers stay dashes/);
});

/* ── buildView: the numbers ───────────────────────────────────────────────── */

test("buildView: total available credit is the calculator's, not a browser sum", () => {
  const v = buildView(apiResponse(FIVE, { requestedAmount: 35000 }));
  assert.equal(v.totalAvailableText, "$47,100");
  assert.equal(v.totalAvailable, 47100);
});

test("buildView: the waterfall is the calculator's own draw order, cheapest money first", () => {
  const v = buildView(apiResponse(FIVE, { requestedAmount: 35000 }));
  assert.deepEqual(v.rows.map((r) => r.lender), [
    "Capital One Spark", "Amex Blue Business", "Citi Costco", "Barclays View", "Chase Sapphire"
  ]);
  assert.deepEqual(v.rows.map((r) => r.drawText),
    ["11,000", "9,800", "7,300", "5,400", "1,500"]);
  assert.equal(v.totalDrawnText, "35,000");
});

test("buildView: a card the waterfall did not reach is marked unused with a dash, not a zero", () => {
  const v = buildView(apiResponse(FIVE, { requestedAmount: 11000 }));
  assert.equal(v.rows[0].drawText, "11,000");
  assert.equal(v.rows[0].unused, false);
  assert.equal(v.rows[1].drawText, "—");
  assert.equal(v.rows[1].unused, true);
});

test("buildView: headroom left is the two totals the API reported, differenced", () => {
  const v = buildView(apiResponse(FIVE, { requestedAmount: 35000 }));
  assert.equal(v.headroomLeftLabel, "Total drawn · $12,100 headroom left");
});

test("buildView: an unpriced card says so instead of pretending to be 0% APR", () => {
  // A null APR sorts LAST in calcFunding precisely because the price is unknown;
  // printing 0.00% would make the cheapest-first table look wrong.
  const rows = [line("Mystery Card", 5000, 1000, null), line("Citi Costco", 12000, 4700, "0.18990")];
  const v = buildView(apiResponse(rows, { requestedAmount: 1000 }));
  const mystery = v.rows.find((r) => r.lender === "Mystery Card");
  assert.equal(mystery.aprText, "APR not on file");
  assert.equal(mystery.aprOnly, "—");
  assert.equal(v.rows[0].lender, "Citi Costco", "the priced card is drawn first");
});

test("buildView: a missing number anywhere in a draw renders as a dash, never as $0", () => {
  const v = buildView({
    data: [{}],
    funding: {
      totalAvailableCredit: null,
      allocation: { requestedAmount: null, totalDrawn: null, shortfall: null, draws: [
        { lender: null, creditLimit: null, currentBalance: null, availableHeadroom: null, apr: null, draw: null }
      ] }
    }
  });
  assert.equal(v.totalAvailableText, "—");
  assert.equal(v.totalDrawnText, "—");
  assert.equal(v.rows[0].limitText, "—");
  assert.equal(v.rows[0].balanceText, "—");
  assert.equal(v.rows[0].headroomText, "—");
  assert.equal(v.rows[0].lender, "(no lender recorded)");
  assert.equal(v.headroomLeftLabel, "Total drawn · — headroom left");
});

test("buildView: the per-card minimum payment is blank because no API field carries it", () => {
  const v = buildView(apiResponse(FIVE, { requestedAmount: 35000 }));
  assert.deepEqual([...new Set(v.rows.map((r) => r.minPaymentText))], ["—"]);
});

test("buildView: pay-method cells are keyed by the horizon the response names, not by position", () => {
  const v = buildView(apiResponse(FIVE, { requestedAmount: 35000 }));
  assert.ok(v.payMethods[12] && v.payMethods[24] && v.payMethods[36]);
  for (const m of [12, 24, 36]) {
    for (const k of ["lump", "min", "io"]) {
      assert.match(v.payMethods[m][k], /^\$[\d,]+/, `${m}mo ${k} is not money: ${v.payMethods[m][k]}`);
    }
  }
  assert.match(v.payMethods[36].io, / \+ balloon$/,
    "interest-only leaves the principal owed at the horizon and the design says so");
  assert.ok(!/balloon/.test(v.payMethods[12].io));
});

test("buildView: with nothing drawn there is no pay-method comparison to show", () => {
  const v = buildView(apiResponse(FIVE, { requestedAmount: 0 }));
  assert.equal(v.payMethods, null);
  assert.equal(v.totalDrawnText, "0");
});

test("buildView: a draw that crosses the threshold renders the calculator's hard stop verbatim", () => {
  const res = apiResponse(FIVE, { requestedAmount: 35000 });
  const v = buildView(res);
  assert.equal(res.funding.guardrail.hardStop, true, "fixture no longer trips the guardrail");
  assert.equal(v.guardrail.cls, "alert-box");
  assert.match(v.guardrail.title, /Hard Stop/);
  assert.equal(v.guardrail.bodyHtml, esc(res.funding.guardrail.message),
    "the guardrail wording is the calculator's, not the screen's paraphrase");
});

test("buildView: a draw that clears the threshold renders the clear state with the real percentages", () => {
  const rows = [line("Big Limit", 100000, 10000, "0.10990")];
  const res = apiResponse(rows, { requestedAmount: 5000 });
  const v = buildView(res);
  assert.equal(res.funding.guardrail.hardStop, false);
  assert.equal(v.guardrail.cls, "alert-box clear");
  assert.match(v.guardrail.bodyHtml, /<b>15%<\/b>/);
  assert.match(v.guardrail.bodyHtml, /under the 30% threshold/);
});

test("buildView: utilisation already over the line before any draw is a note, not a hard stop", () => {
  const rows = [line("Maxed Card", 10000, 5000, "0.21990")];
  const res = apiResponse(rows, { requestedAmount: 1000 });
  const v = buildView(res);
  assert.equal(res.funding.guardrail.hardStop, false, "a pre-existing balance is not this deal's doing");
  assert.equal(v.guardrail.cls, "alert-box warn");
  assert.match(v.guardrail.bodyHtml, /pre-existing/i);
});

test("buildView: the utilisation line quotes the guardrail's own percentage and threshold", () => {
  const res = apiResponse(FIVE, { requestedAmount: 35000, utilizationThreshold: 0.45 });
  const v = buildView(res);
  assert.match(v.utilizationHtml, /threshold 45%$/);
  assert.match(v.utilizationHtml, /of \$76,000 total limit/);
  assert.match(v.utilizationHtml,
    new RegExp("<b>" + Math.round(res.funding.guardrail.aggregateUtilization * 100) + "%</b>"));
});

test("buildView: no guardrail in the response means the line says so rather than showing 0%", () => {
  const v = buildView(apiResponse(FIVE));   // no requested amount → no allocation, no guardrail
  assert.equal(v.guardrail, null);
  assert.match(v.utilizationHtml, /not computed/);
  assert.equal(v.requestedText, null);
});

test("buildView: lines the waterfall cannot use are counted, not silently dropped", () => {
  const rows = FIVE.concat([line("Ally Auto", 30000, 21000, "0.07990", { kind: "installment" })]);
  const v = buildView(apiResponse(rows, { requestedAmount: 35000 }));
  assert.equal(v.cardCount, 6);
  assert.equal(v.drawableCount, 5);
  assert.equal(v.excludedCount, 1);
});

/* ── the banner ───────────────────────────────────────────────────────────── */

test("bannerText: every region with no source in this response is named on screen", () => {
  const text = bannerText(buildView(apiResponse(FIVE, { requestedAmount: 35000 })));
  assert.ok(text.includes(NOT_SOURCED));
  for (const region of ["pipeline", "shift stats", "Deal Math", "per-card minimums"]) {
    assert.ok(text.includes(region), `the banner does not mention ${region}: ${text}`);
  }
});

test("bannerText: a draw the cards cannot cover reports the shortfall", () => {
  const text = bannerText(buildView(apiResponse(FIVE, { requestedAmount: 60000 })));
  assert.match(text, /shortfall \$12,900/);
});

test("bannerText: a fully covered draw claims no shortfall", () => {
  const text = bannerText(buildView(apiResponse(FIVE, { requestedAmount: 35000 })));
  assert.ok(!/shortfall/.test(text));
  assert.match(text, /5 lines on file/);
  assert.match(text, /\$47,100 available/);
});

/* ── the copy the page carries ────────────────────────────────────────────── */

const BEGIN = "/* FH-VIEW-BEGIN */";
const END = "/* FH-VIEW-END */";

function browserCopy() {
  const a = HTML.indexOf(BEGIN);
  const b = HTML.indexOf(END);
  assert.ok(a !== -1 && b > a, "the FH-VIEW markers are gone from closer-dashboard.html");
  const sandbox = { window: {} };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(HTML.slice(a + BEGIN.length, b), sandbox, { filename: SCREEN + "#FH-VIEW" });
  return sandbox.window.FHCloserView;
}

test("the page's inlined view model exposes the same surface as the module", () => {
  const B = browserCopy();
  assert.equal(typeof B, "object");
  for (const fn of ["usd", "numText", "pctText", "esc", "classify", "buildView", "bannerText"]) {
    assert.equal(typeof B[fn], "function", `the page's copy is missing ${fn}()`);
  }
  assert.equal(B.NOT_SOURCED, NOT_SOURCED);
});

test("the page's copy and the module agree on every fallback decision", () => {
  const B = browserCopy();
  const cases = [
    [null, {}],
    [failRead("offline", "/api/* not deployed"), { clientId: CID }],
    [failRead("unauthorized", "not signed in"), { clientId: CID }],
    [failRead("nodb", "database unreachable"), { clientId: CID }],
    [failRead("notfound", "no such record"), { clientId: CID }],
    [failRead("badrequest", "bad request"), { clientId: CID }],
    [failRead("demo", "demo session"), { clientId: CID }],
    [failRead("teapot", "???"), { clientId: CID }],
    [okRead(apiResponse([], { requestedAmount: 1000 })), { clientId: CID }],
    [okRead(apiResponse(FIVE, { requestedAmount: 35000 })), { clientId: CID }]
  ];
  for (const [res, opts] of cases) {
    assert.deepEqual(B.classify(res, opts), classify(res, opts),
      `the screen and the module disagree about ${res && res.source}`);
  }
});

test("the page's copy and the module build the same view model from the same response", () => {
  const B = browserCopy();
  const payloads = [
    apiResponse(FIVE, { requestedAmount: 35000 }),
    apiResponse(FIVE, { requestedAmount: 60000 }),
    apiResponse(FIVE, { requestedAmount: 0 }),
    apiResponse(FIVE),
    apiResponse([line("Big Limit", 100000, 10000, "0.10990")], { requestedAmount: 5000 }),
    apiResponse([line("Maxed Card", 10000, 5000, "0.21990")], { requestedAmount: 1000 }),
    apiResponse([line("Mystery Card", 5000, 1000, null)], { requestedAmount: 1000 })
  ];
  for (const p of payloads) {
    assert.deepEqual(B.buildView(p), buildView(p), "the screen would render different numbers");
    assert.equal(B.bannerText(B.buildView(p)), bannerText(buildView(p)));
  }
});

/* ── the screen itself ────────────────────────────────────────────────────── */

test("closer-dashboard.html loads data.js, without which every reader is undefined", () => {
  assert.match(HTML, /<script src="data\.js"><\/script>/);
});

test("closer-dashboard.html default markup is honest empty, not sample people", () => {
  assert.doesNotMatch(HTML, /Jordan Blake|Priya Nair|Marcus Webb/);
  assert.match(HTML, /Open from a client\./);
  assert.match(HTML, /table class="deal"/);
  assert.match(HTML, /id="oCredit"/);
});

test("the sample calculators stand down once live figures are on screen", () => {
  // Two implementations of one waterfall that can both paint is the bug the
  // endpoint's `funding` key exists to prevent.
  assert.match(HTML, /if\(window\.__fhCloserLive\) return;/);
  assert.match(HTML, /window\.__fhCloserLive = true;/);
});

test("the Closer Dashboard never asks for identity documents", () => {
  // SSN/DOB is /api/pii, a narrower role gate, and a different screen's job.
  assert.ok(!/api\/pii/.test(HTML));
  assert.ok(!/\bssn\b/i.test(HTML));
});

test("the screen asks the endpoint for a new allocation instead of recomputing one", () => {
  assert.match(HTML, /FHData\.read\("tradelines"/);
  assert.match(HTML, /requested_amount/);
  assert.match(HTML, /utilization_threshold/);
});

test("every DOM hook the wiring writes into is still in the markup", () => {
  /* The wiring is DOM writes against ids and labels in a 38 KB page, and a
     renamed hook fails SILENTLY — the read succeeds, the banner goes green, and
     the number on screen is still the sample one. That is the exact failure the
     last audit found on seven screens. These are the hooks; renaming one breaks
     this test instead of the closer's call. */
  for (const id of [
    "oCredit", "oDrawn", "oLeft", "oUtil",            // funding answers
    "guardBox", "guardTitle", "guardBody",            // guardrail
    "m12", "m24", "m36", "i12", "i24", "i36",         // CD-03 pay methods
    "iDraw", "iDrawRange", "iGuard",                  // inputs that re-ask the API
    "cliffBox", "cliffTitle", "cliffBody"             // the unsourced deal-math state
  ]) {
    assert.ok(new RegExp(`id="${id}"`).test(HTML), `#${id} is gone from the screen`);
  }
  assert.match(HTML, /<tr class="total">/, "the waterfall rebuild inserts before the totals row");
  assert.match(HTML, /<th>Method<\/th>/, "the pay-method table is found by its first header");
  assert.match(HTML, /<th>Card<\/th>/, "the per-card table is found by its first header");
  assert.match(HTML, /<td>Lump Sum<\/td>/, "the lump-sum row has no ids and is found by its label");
  assert.match(HTML, /class="res-note"/);
  assert.match(HTML, /class="bd-sub"[^>]*>D-04 /);
  assert.match(HTML, /class="bd-sub"[^>]*>D-03b /);
  assert.match(HTML, /CD-02 \/ Deal Calculators/);
});

test("the loading state is scoped to an attribute the wiring sets and clears", () => {
  assert.match(HTML, /\.calc-panel\[data-fh-busy\]/);
  assert.match(HTML, /setAttribute\("data-fh-busy", "1"\)/);
  assert.match(HTML, /removeAttribute\("data-fh-busy"\)/);
});
