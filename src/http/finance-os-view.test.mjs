// Unit tests for the Finance OS view model, and the drift check against the
// copy the page carries.
//
// The screen shows a client's credit limits and balances. The two things worth
// testing are the ones a human would not notice going wrong: a missing number
// quietly becoming a zero, and a failed read quietly becoming a blank screen.

import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import { DASH, esc, usd, pctText, dateText, classify, buildView, bannerText } from "./finance-os-view.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCREEN = path.resolve(HERE, "../../public/app/finance-os.html");
const HTML = fs.readFileSync(SCREEN, "utf8");

const CID = "11111111-1111-4111-8111-111111111111";

const line = (over = {}) => ({
  id: "tl-" + Math.random().toString(36).slice(2),
  lender: "Amex Blue Business", kind: "revolving",
  credit_limit_cents: 1200000, balance_cents: 410000,
  apr: "0.18990", source: "pull", as_of: "2026-06-30T00:00:00Z", ...over
});

const payload = (rows, funding = {}) => ({
  client: { id: CID, first_name: "Dana", last_name: "Reed", email: "dana@example.com" },
  tradelines: { rows, funding }
});

const okRead = (data) => ({ ok: true, source: "api", data, error: null, status: 200 });
const failRead = (source, error, status = null) => ({ ok: false, source, data: null, error, status });

const rowOf = (view, id) => view.rows.find((r) => r.id === id);

/* ───────────────────────── the seven rows ───────────────────────── */

test("the view is seven rows in the approved order", () => {
  const view = buildView(payload([line()]));
  assert.deepEqual(view.rows.map((r) => r.id),
    ["identity", "blockers", "headline", "detail", "timing", "actions", "system"]);
});

test("BLOCKERS AND ACTIONS ARE DECLARED ABSENT, NOT OMITTED", () => {
  const view = buildView(payload([line()]));
  assert.equal(rowOf(view, "blockers").present, false);
  assert.equal(rowOf(view, "actions").present, false,
    "declaring them keeps the grammar stable when the banking screen fills them");
});

test("the timing row says WHY it is empty rather than just being empty", () => {
  const timing = rowOf(buildView(payload([line()])), "timing");
  assert.equal(timing.present, false);
  assert.match(timing.absentReason, /carry no payment dates/,
    "a bureau tradeline has no due date — the screen says so instead of showing a blank");
});

/* ───────────────────────── the numbers ───────────────────────── */

test("a complete line produces its limit, balance, available and APR", () => {
  const l = rowOf(buildView(payload([line()])), "detail").lines[0];
  assert.equal(l.limitText, "$12,000.00");
  assert.equal(l.balanceText, "$4,100.00");
  assert.equal(l.availableText, "$7,900.00");
  assert.equal(l.aprText, "18.99%");
  assert.equal(l.incomplete, false);
});

test("A MISSING LIMIT IS A DASH, AND AVAILABLE IS UNKNOWN — NOT ZERO HEADROOM", () => {
  const l = rowOf(buildView(payload([line({ credit_limit_cents: null })])), "detail").lines[0];
  assert.equal(l.limitText, DASH);
  assert.equal(l.availableText, DASH, "no limit is not 'no headroom'");
  assert.equal(l.incomplete, true);
});

test("a missing balance is a dash, and available is unknown — not full headroom", () => {
  const l = rowOf(buildView(payload([line({ balance_cents: null })])), "detail").lines[0];
  assert.equal(l.balanceText, DASH);
  assert.equal(l.availableText, DASH);
  assert.equal(l.incomplete, true);
});

test("a missing APR is a dash, not 0%", () => {
  const l = rowOf(buildView(payload([line({ apr: null })])), "detail").lines[0];
  assert.equal(l.aprText, DASH, "0% is a real rate and would be a claim about this card");
});

test("UTILIZATION IS COMPUTED OVER COMPLETE LINES ONLY", () => {
  const view = buildView(payload([
    line({ credit_limit_cents: 1000000, balance_cents: 500000 }),
    line({ credit_limit_cents: null, balance_cents: 900000 })
  ]));
  const tiles = rowOf(view, "headline").tiles;
  assert.equal(tiles.find((t) => t.label === "Utilization").value, "50.0%",
    "the incomplete line's balance must not leak into the numerator");
  assert.equal(tiles.find((t) => t.label === "Total balance").value, "$5,000.00");
  assert.equal(view.counts.unknown, 1);
});

test("with no complete lines the totals are dashes, not zeros", () => {
  const tiles = rowOf(buildView(payload([line({ credit_limit_cents: null, balance_cents: null })])), "headline").tiles;
  assert.equal(tiles.find((t) => t.label === "Total limit").value, DASH);
  assert.equal(tiles.find((t) => t.label === "Utilization").value, DASH);
});

test("available credit comes from the calculator, not from a second sum here", () => {
  const tiles = rowOf(buildView(payload([line()], { totalAvailableCredit: 7900 })), "headline").tiles;
  assert.equal(tiles.find((t) => t.label === "Available credit").value, "$7,900.00");
});

test("a calculator that reported nothing shows a dash", () => {
  const tiles = rowOf(buildView(payload([line()], {})), "headline").tiles;
  assert.equal(tiles.find((t) => t.label === "Available credit").value, DASH);
});

test("row 7 names what was left out", () => {
  const facts = rowOf(buildView(payload([line(), line({ balance_cents: null })])), "system").facts;
  assert.ok(facts.some((f) => f.label === "Not counted" && /1 line/.test(f.value)));
});

test("row 7 reports the age of the figures", () => {
  const facts = rowOf(buildView(payload([
    line({ as_of: "2026-01-15T00:00:00Z" }), line({ as_of: "2026-06-30T00:00:00Z" })
  ])), "system").facts;
  assert.equal(facts.find((f) => f.label === "Oldest figure").value, "2026-01-15");
  assert.equal(facts.find((f) => f.label === "Newest figure").value, "2026-06-30");
});

test("the banner names incomplete lines and is silent when there are none", () => {
  assert.match(bannerText(buildView(payload([line(), line({ apr: null, balance_cents: null })]))),
    /1 of 2 credit line\(s\)/);
  assert.equal(bannerText(buildView(payload([line()]))), null,
    "a screen with nothing to say says nothing");
});

/* ───────────────────────── the fallbacks ───────────────────────── */

test("401, 403, 404 AND 5xx ARE FOUR DIFFERENT ANSWERS", () => {
  const signedOut = classify(failRead("unauthorized", "not signed in", 401), { clientId: CID });
  assert.equal(signedOut.httpStatus, 401);
  assert.match(signedOut.text, /not signed in/);

  const forbidden = classify(failRead("unauthorized", "not permitted", 403), { clientId: CID });
  assert.equal(forbidden.httpStatus, 403);
  assert.match(forbidden.text, /signing in again will not help/);

  const missing = classify(failRead("notfound", "no such record", 404), { clientId: CID });
  assert.equal(missing.tone, "sample", "a 404 on a stale id is not an outage");

  const down = classify(failRead("nodb", "database unreachable", 503), { clientId: CID });
  assert.equal(down.tone, "error");
});

test("NO FAILURE EVER BLANKS THE SCREEN", () => {
  for (const source of ["unauthorized", "offline", "nodb", "notfound", "badrequest", "demo", "teapot"]) {
    const r = classify(failRead(source, "x"), { clientId: CID });
    assert.notEqual(r.mode, "live");
    assert.ok(r.text && r.text.length > 10, `${source} must explain itself`);
  }
});

test("no client id asks for one", () => {
  assert.match(classify(null, {}).text, /client_id=/);
});

test("a client with no lines is empty, not broken", () => {
  const r = classify(okRead(payload([])), { clientId: CID });
  assert.equal(r.mode, "empty");
  assert.equal(r.tone, "sample");
});

test("a live read paints", () => {
  const r = classify(okRead(payload([line()])), { clientId: CID });
  assert.equal(r.mode, "live");
  assert.equal(r.text, null);
});

/* ───────────────────────── formatting ───────────────────────── */

test("money and percentages format, and absences dash", () => {
  assert.equal(usd(1250.5), "$1,250.50");
  assert.equal(usd(null), DASH);
  assert.equal(usd(-40), "-$40.00");
  assert.equal(pctText(0.1899, 2), "18.99%");
  assert.equal(pctText(null), DASH);
  assert.equal(dateText("2026-06-30T00:00:00Z"), "2026-06-30");
  assert.equal(dateText(null), DASH);
  assert.equal(esc('<b>"x"</b>'), "&lt;b&gt;&quot;x&quot;&lt;/b&gt;");
});

/* ───────────────────── the copy the page carries ───────────────────── */

const BEGIN = "/* FH-VIEW-BEGIN */";
const END = "/* FH-VIEW-END */";

function browserCopy() {
  const a = HTML.indexOf(BEGIN);
  const b = HTML.indexOf(END);
  assert.ok(a !== -1 && b > a, "the FH-VIEW markers are gone from finance-os.html");
  const sandbox = { window: {} };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(HTML.slice(a + BEGIN.length, b), sandbox, { filename: SCREEN + "#FH-VIEW" });
  return sandbox.window.FHFinanceView;
}

test("the page's inlined view model exposes the same surface as the module", () => {
  const B = browserCopy();
  for (const fn of ["esc", "usd", "pctText", "dateText", "classify", "buildView", "bannerText"]) {
    assert.equal(typeof B[fn], "function", `the page's copy is missing ${fn}()`);
  }
  assert.equal(B.DASH, DASH);
});

test("the page's copy and the module agree on every fallback decision", () => {
  const B = browserCopy();
  const cases = [
    [null, {}],
    [failRead("unauthorized", "not signed in", 401), { clientId: CID }],
    [failRead("unauthorized", "not permitted", 403), { clientId: CID }],
    [failRead("notfound", "no such record", 404), { clientId: CID }],
    [failRead("nodb", "database unreachable", 503), { clientId: CID }],
    [failRead("offline", "/api/* not deployed", 404), { clientId: CID }],
    [failRead("badrequest", "bad request", 400), { clientId: CID }],
    [failRead("demo", "demo session"), { clientId: CID }],
    [okRead(payload([])), { clientId: CID }],
    [okRead(payload([line()])), { clientId: CID }]
  ];
  for (const [res, opts] of cases) {
    assert.deepEqual(B.classify(res, opts), classify(res, opts),
      `the screen and the module disagree about ${res && res.source}`);
  }
});

test("THE PAGE'S COPY AND THE MODULE BUILD THE SAME VIEW", () => {
  const B = browserCopy();
  const payloads = [
    payload([]),
    payload([line()], { totalAvailableCredit: 7900 }),
    payload([line(), line({ credit_limit_cents: null })]),
    payload([line({ balance_cents: null, apr: null })]),
    payload([line({ credit_limit_cents: 0, balance_cents: 0 })])
  ];
  for (const p of payloads) {
    assert.deepEqual(B.buildView(p), buildView(p), "the screen would render different numbers");
    assert.equal(B.bannerText(B.buildView(p)), bannerText(buildView(p)));
  }
});
