// Unit tests for the banking surface's view model.
//
// The three rules from the module header are the three things worth testing,
// and each has a section below:
//
//   1. UNKNOWN IS NOT PERSONAL — an unclassified account gets its own group and
//      is in neither total.
//   2. A GUESS MUST NOT LOOK LIKE A FACT — a low-confidence detected bill is
//      presented differently from a reported due date.
//   3. A NULL PAYMENT WINDOW RENDERS ITS REASON — never a date the engine did
//      not produce.
//
// Plus the banner mapping, which must keep 401, 403, 404 and 5xx apart, and the
// drift check that the copy inside the page is the same text as this module.

import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import {
  DASH, ENTITY_GROUPS, esc, usd, usdCents, pctText, dateText,
  confidenceView, classify, groupByEntity, buildView, bannerText
} from "./bank-view.mjs";
import { confidenceLabel } from "../banking/recurring.mjs";
import { WINDOW_REASONS, WINDOW_REASON_TEXT } from "../banking/cashflow.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCREEN = path.resolve(HERE, "../../public/app/banking-surface.html");
const HTML = fs.readFileSync(SCREEN, "utf8");

const CID = "11111111-1111-4111-8111-111111111111";

const account = (over = {}) => ({
  id: "acct-" + Math.random().toString(36).slice(2),
  name: "An Account", official_name: null, mask: "4821",
  type: "depository", subtype: "checking",
  entity_kind: "unknown", entity_kind_source: "unset",
  balance_current_cents: 100000, balance_as_of: "2026-07-30T00:00:00Z",
  status: "open", ...over
});

const payload = (over = {}) => ({
  client: { id: CID, first_name: "Dana", last_name: "Reed", email: "dana@example.com" },
  plaidEnabled: true, itemStatus: "good", lastSyncedAt: "2026-07-30T00:00:00Z",
  accounts: [], cards: [], bills: [], paymentWindows: [], ...over
});

const okRead = (data) => ({ ok: true, source: "api", data, error: null, status: 200 });
const failRead = (source, error, status = null) => ({ ok: false, source, data: null, error, status });

const groupFor = (view, key) =>
  view.rows.find((r) => r.id === "detail").groups.find((g) => g.key === key);

/* ═════════ RULE 1 — unknown is not personal ═════════ */

test("THE THREE GROUPS ALWAYS COME BACK, IN ORDER, EVEN WHEN EMPTY", () => {
  const groups = groupByEntity([]);
  assert.deepEqual(groups.map((g) => g.key), ["business", "personal", "unknown"],
    "a group that vanishes lets somebody assume we looked and found nothing");
  assert.deepEqual(ENTITY_GROUPS.map((g) => g.key), ["business", "personal", "unknown"]);
});

test("AN UNCLASSIFIED ACCOUNT LANDS IN 'unknown', NEVER IN 'personal'", () => {
  const groups = groupByEntity([account({ entity_kind: "unknown", name: "Chase Checking" })]);
  const byKey = Object.fromEntries(groups.map((g) => [g.key, g]));
  assert.equal(byKey.unknown.count, 1);
  assert.equal(byKey.personal.count, 0,
    "putting somebody's personal account under their business is the failure that matters");
  assert.equal(byKey.business.count, 0);
});

test("an entity_kind the view does not recognise also lands in unknown", () => {
  const groups = groupByEntity([account({ entity_kind: "sole_trader", entity_kind_source: "inferred" })]);
  const byKey = Object.fromEntries(groups.map((g) => [g.key, g]));
  assert.equal(byKey.unknown.count, 1,
    "the safe destination for something we cannot classify is the group that already means that");
  assert.equal(byKey.unknown.accounts[0].entityKind, "unknown");
});

test("THE UNKNOWN BALANCE IS IN NEITHER THE BUSINESS NOR THE PERSONAL TOTAL", () => {
  const groups = groupByEntity([
    account({ entity_kind: "business", entity_kind_source: "manual", balance_current_cents: 500000 }),
    account({ entity_kind: "personal", entity_kind_source: "manual", balance_current_cents: 200000 }),
    account({ entity_kind: "unknown", balance_current_cents: 900000 })
  ]);
  const byKey = Object.fromEntries(groups.map((g) => [g.key, g]));
  assert.equal(byKey.business.totalCents, 500000);
  assert.equal(byKey.personal.totalCents, 200000);
  assert.equal(byKey.unknown.totalCents, 900000, "it is counted, separately, and named");
});

test("a group with no known balances totals null, not zero", () => {
  const groups = groupByEntity([account({ entity_kind: "business", entity_kind_source: "plaid", balance_current_cents: null, balance_as_of: null })]);
  const business = groups.find((g) => g.key === "business");
  assert.equal(business.totalCents, null, "three accounts with no balances is not a group holding zero dollars");
  assert.equal(business.totalText, DASH);
  assert.equal(business.unknownBalances, 1);
});

test("the classification's provenance survives to the screen", () => {
  const groups = groupByEntity([
    account({ entity_kind: "business", entity_kind_source: "manual" }),
    account({ entity_kind: "business", entity_kind_source: "inferred" })
  ]);
  const sources = groups.find((g) => g.key === "business").accounts.map((a) => a.entitySource);
  assert.deepEqual(sources, ["manual", "inferred"],
    "a human's decision and a string match on the word Business must not look identical");
});

test("the headline gives the unknown bucket a tile of its own, flagged for attention", () => {
  const view = buildView(payload({ accounts: [account({ entity_kind: "unknown" })] }));
  const tiles = view.rows.find((r) => r.id === "headline").tiles;
  const unknownTile = tiles.find((t) => t.label === "Not yet classified");
  assert.ok(unknownTile, "it must not be a rounding error at the bottom of the screen");
  assert.equal(unknownTile.tone, "attention");
  assert.match(unknownTile.note, /in neither total/);
});

test("with nothing unclassified the tile is present and calm", () => {
  const view = buildView(payload({
    accounts: [account({ entity_kind: "personal", entity_kind_source: "manual" })]
  }));
  const tile = view.rows.find((r) => r.id === "headline").tiles.find((t) => t.label === "Not yet classified");
  assert.equal(tile.tone, "normal");
});

test("unclassified accounts produce an action a human can take", () => {
  const view = buildView(payload({ accounts: [account(), account()] }));
  const actions = view.rows.find((r) => r.id === "actions").items;
  assert.equal(actions.length, 1);
  assert.equal(actions[0].count, 2);
});

test("the banner names the unclassified accounts first", () => {
  const view = buildView(payload({ accounts: [account(), account({ entity_kind: "personal", entity_kind_source: "manual" })] }));
  assert.match(bannerText(view), /1 of 2 account\(s\) are not yet classified/);
});

/* ═════════ RULE 2 — a guess must not look like a fact ═════════ */

test("a reported due date is presented as a fact", () => {
  const c = confidenceView("reported", null);
  assert.equal(c.certain, true);
  assert.equal(c.tone, "fact");
  assert.equal(c.label, "Reported");
});

test("A LOW-CONFIDENCE BILL IS NEVER PRESENTED AS CERTAIN", () => {
  const c = confidenceView("inferred", 0.32);
  assert.equal(c.certain, false);
  assert.equal(c.tone, "guess");
  assert.equal(c.label, "Low confidence");
  assert.match(c.note, /not reported by anyone/);
});

test("even the top confidence band never claims certainty", () => {
  const c = confidenceView("inferred", 0.94);
  assert.equal(c.certain, false, "086 caps the column below 1 so nothing here can claim certainty");
  assert.equal(c.tone, "guess");
  assert.notEqual(c.label, "Confirmed");
  assert.match(c.note, /Detected/);
});

test("a detected bill with no confidence is shown as unverified, not as a low number", () => {
  const c = confidenceView("inferred", null);
  assert.equal(c.label, "Unverified");
  assert.equal(c.pct, null);
  assert.equal(c.certain, false);
});

test("the confidence bands match src/banking/recurring.mjs", () => {
  for (const c of [0, 0.2, 0.39, 0.4, 0.55, 0.69, 0.7, 0.9]) {
    const band = confidenceLabel(c);
    const view = confidenceView("inferred", c);
    const expected = { low: "Low confidence", medium: "Possible", high: "Likely" }[band];
    assert.equal(view.label, expected, `confidence ${c} disagrees between the two modules`);
  }
});

test("a bill carries how much evidence it rests on", () => {
  const view = buildView(payload({
    bills: [{ id: "b1", merchant_name: "Insurance Co", amount_cents: 8740, confidence: 0.32,
              occurrence_count: 2, cadence: "monthly", next_expected_date: "2026-08-01", source: "detected" }]
  }));
  const bill = view.rows.find((r) => r.id === "timing").bills[0];
  assert.equal(bill.basisText, "Based on 2 payment(s)",
    "'based on 2 payments' must be visible, not buried");
  assert.equal(bill.confidence.certain, false);
});

test("a confirmed bill is presented as confirmed, not as a guess", () => {
  const view = buildView(payload({
    bills: [{ id: "b1", merchant_name: "Rent", amount_cents: 150000, confidence: 0.9,
              occurrence_count: 12, cadence: "monthly", next_expected_date: "2026-08-01", source: "confirmed" }]
  }));
  const bill = view.rows.find((r) => r.id === "timing").bills[0];
  assert.equal(bill.confidence.tone, "fact");
  assert.equal(bill.basisText, "Confirmed");
});

test("A VARYING BILL IS NOT RENDERED AT ONE FIXED NUMBER", () => {
  const view = buildView(payload({
    bills: [{ id: "b1", merchant_name: "Water Co", amount_cents: 12000, amount_variance_cents: 1500,
              confidence: 0.5, occurrence_count: 6, cadence: "monthly", next_expected_date: "2026-08-08", source: "detected" }]
  }));
  const bill = view.rows.find((r) => r.id === "timing").bills[0];
  assert.equal(bill.varies, true);
  assert.equal(bill.varianceText, "$15.00");
});

test("a bill with no projectable next date says so", () => {
  const view = buildView(payload({
    bills: [{ id: "b1", merchant_name: "Chaos Co", amount_cents: 4000, confidence: 0.2,
              occurrence_count: 3, cadence: "irregular", next_expected_date: null, source: "detected" }]
  }));
  const bill = view.rows.find((r) => r.id === "timing").bills[0];
  assert.equal(bill.nextDate, DASH);
  assert.equal(bill.nextUnknown, true);
});

/* ═════════ RULE 3 — a null payment window renders its reason ═════════ */

const card = (over = {}) => ({
  bank_account_id: "acct-1", account_name: "Amex Blue", mask: "1005",
  entity_kind: "business", last_statement_balance_cents: 125050,
  minimum_payment_cents: 3500, next_payment_due_date: "2026-07-28",
  apr: "0.18990", is_overdue: false, as_of: "2026-07-20T00:00:00Z", ...over
});

test("a real window is shown with its recommended day", () => {
  const view = buildView(payload({
    cards: [card()],
    paymentWindows: [{ bankAccountId: "acct-1", window: { earliest: "2026-07-21", latest: "2026-07-28", recommended: "2026-07-21" }, reason: null }]
  }));
  const c = view.rows.find((r) => r.id === "timing").cards[0];
  assert.equal(c.window.recommended, "2026-07-21");
  assert.equal(c.windowReason, null);
});

test("A NULL WINDOW CARRIES THE ENGINE'S REASON AND NO DATE", () => {
  for (const code of Object.values(WINDOW_REASONS)) {
    const view = buildView(payload({
      cards: [card()],
      paymentWindows: [{ bankAccountId: "acct-1", window: null, reason: code, reasonText: WINDOW_REASON_TEXT[code] }]
    }));
    const c = view.rows.find((r) => r.id === "timing").cards[0];
    assert.equal(c.window, null, `a window appeared for ${code}`);
    assert.equal(c.windowReasonCode, code);
    assert.equal(c.windowReason, WINDOW_REASON_TEXT[code],
      "the reason must be the engine's own wording, not the screen's paraphrase");
  }
});

test("a card with no window entry at all is different from one that refused", () => {
  const view = buildView(payload({ cards: [card()], paymentWindows: [] }));
  const c = view.rows.find((r) => r.id === "timing").cards[0];
  assert.equal(c.windowAbsent, true, "nobody asked is not the same as the engine answering 'I cannot'");
  assert.equal(c.windowReason, null);
});

test("A MISSING DUE DATE IS A DASH, NOT TODAY AND NOT THE 15th", () => {
  const view = buildView(payload({ cards: [card({ next_payment_due_date: null })] }));
  const c = view.rows.find((r) => r.id === "timing").cards[0];
  assert.equal(c.dueDate, DASH);
  assert.equal(c.dueUnknown, true);
});

test("is_overdue keeps its three states", () => {
  const of = (v) => buildView(payload({ cards: [card({ is_overdue: v })] })).rows.find((r) => r.id === "timing").cards[0].overdue;
  assert.equal(of(true), "yes");
  assert.equal(of(false), "no");
  assert.equal(of(null), "unknown", "a NULL rendered as 'not overdue' is a reassurance nobody earned");
});

test("only a genuinely overdue card becomes a blocker", () => {
  const blockersFor = (v) => buildView(payload({ cards: [card({ is_overdue: v })] })).rows.find((r) => r.id === "blockers").items;
  assert.equal(blockersFor(true).length, 1);
  assert.equal(blockersFor(false).length, 0);
  assert.equal(blockersFor(null).length, 0, "unknown is not a blocker — we do not know that it is one");
});

test("BLOCKERS ARE EMPTY WHEN THERE ARE NONE — no empty state is manufactured", () => {
  const view = buildView(payload({ accounts: [account()] }));
  assert.deepEqual(view.rows.find((r) => r.id === "blockers").items, []);
});

test("a connection needing re-authentication is a blocker in plain words", () => {
  const view = buildView(payload({ itemStatus: "login_required" }));
  const items = view.rows.find((r) => r.id === "blockers").items;
  assert.equal(items[0].kind, "reconnect");
  assert.match(items[0].text, /signing in again/);
});

test("a missing money value is a dash, never $0.00", () => {
  const view = buildView(payload({ cards: [card({ minimum_payment_cents: null, last_statement_balance_cents: null, apr: null })] }));
  const c = view.rows.find((r) => r.id === "timing").cards[0];
  assert.equal(c.minimumText, DASH);
  assert.equal(c.statementText, DASH);
  assert.equal(c.aprText, DASH);
});

/* ═════════ the seven-row grammar ═════════ */

test("the rows are the same seven, in the same order, as the Finance OS screen", () => {
  const view = buildView(payload());
  assert.deepEqual(view.rows.map((r) => r.id),
    ["identity", "blockers", "headline", "detail", "timing", "actions", "system"]);
});

test("row 7 carries the unflattering facts, not just the flattering ones", () => {
  const view = buildView(payload({
    accounts: [account(), account({ entity_kind: "personal", entity_kind_source: "manual", balance_current_cents: null, balance_as_of: null })]
  }));
  const labels = view.rows.find((r) => r.id === "system").facts.map((f) => f.label);
  assert.ok(labels.includes("Unclassified"));
  assert.ok(labels.includes("No balance on file"),
    "a screen that reports only what it knows reads as complete");
});

/* ═════════ the banner mapping ═════════ */

test("401, 403, 404 AND 5xx ARE FOUR DIFFERENT ANSWERS", () => {
  const signedOut = classify(failRead("unauthorized", "not signed in", 401), { clientId: CID });
  assert.equal(signedOut.httpStatus, 401);
  assert.match(signedOut.text, /not signed in/);

  const forbidden = classify(failRead("unauthorized", "not permitted", 403), { clientId: CID });
  assert.equal(forbidden.httpStatus, 403);
  assert.match(forbidden.text, /not allowed/);
  assert.match(forbidden.text, /signing in again will not help/,
    "telling somebody who is already signed in to sign in is a lie");

  const missing = classify(failRead("notfound", "no such record", 404), { clientId: CID });
  assert.equal(missing.httpStatus, 404);
  assert.equal(missing.tone, "sample", "a 404 on a stale id is not an outage");

  const down = classify(failRead("nodb", "database unreachable", 503), { clientId: CID });
  assert.equal(down.tone, "error");
  assert.match(down.text, /the database did not/);
});

test("no failure ever puts the screen into live mode", () => {
  for (const source of ["unauthorized", "offline", "nodb", "notfound", "badrequest", "demo", "teapot"]) {
    assert.notEqual(classify(failRead(source, "x"), { clientId: CID }).mode, "live");
  }
});

test("an unroutable endpoint says so, and says it is not a sign-in problem", () => {
  const r = classify(failRead("offline", "/api/* not deployed", 404), { clientId: CID });
  assert.match(r.text, /not deployed or not routed/);
  assert.match(r.text, /not a sign-in problem/);
});

test("PLAID BEING SWITCHED OFF IS NOT AN ERROR", () => {
  const r = classify(okRead(payload({ plaidEnabled: false })), { clientId: CID });
  assert.equal(r.tone, "sample", "a red banner would send somebody to debug a configuration decision");
  assert.match(r.text, /not switched on/);
});

test("REAL ACCOUNTS ARE PAINTED EVEN WHEN SYNCING IS SWITCHED OFF", () => {
  // Caught by the live smoke test: a client with four connected accounts was
  // shown sample markup because PLAID_CLIENT_ID was unset on that box. Hiding
  // somebody's actual balances behind a configuration flag leaves the screen
  // looking populated with fiction.
  const r = classify(okRead(payload({ plaidEnabled: false, accounts: [account()] })), { clientId: CID });
  assert.equal(r.mode, "live");
  assert.equal(r.text, null, "the inability to refresh is a note in row 7, not a reason to withhold the data");
});

test("with no accounts, 'not connected' and 'not switched on' are different sentences", () => {
  const off = classify(okRead(payload({ plaidEnabled: false, accounts: [] })), { clientId: CID });
  const on = classify(okRead(payload({ plaidEnabled: true, accounts: [] })), { clientId: CID });
  assert.match(off.text, /not switched on for this deployment/);
  assert.match(on.text, /no bank accounts connected for this client/);
  assert.notEqual(off.text, on.text, "the two send a reader to two different places");
});

test("no accounts is empty, not an error", () => {
  const r = classify(okRead(payload({ accounts: [] })), { clientId: CID });
  assert.equal(r.mode, "empty");
  assert.equal(r.tone, "sample");
});

test("a live read with accounts paints", () => {
  const r = classify(okRead(payload({ accounts: [account()] })), { clientId: CID });
  assert.equal(r.mode, "live");
  assert.equal(r.text, null);
});

test("no client id asks for one rather than reporting a failure", () => {
  const r = classify(null, {});
  assert.equal(r.mode, "sample");
  assert.match(r.text, /client_id=/);
});

/* ═════════ formatting ═════════ */

test("cents become dollars exactly once", () => {
  assert.equal(usdCents(125050), "$1,250.50");
  assert.equal(usdCents(null), DASH);
  assert.equal(usdCents(-12500), "-$125.00");
  assert.equal(usd(1250.5), "$1,250.50");
});

test("a date is read strictly and never invented", () => {
  assert.equal(dateText("2026-07-28T00:00:00Z"), "2026-07-28");
  assert.equal(dateText(null), DASH);
  assert.equal(dateText("soon"), DASH);
});

test("esc closes the obvious hole", () => {
  assert.equal(esc('<script>"x"</script>'), "&lt;script&gt;&quot;x&quot;&lt;/script&gt;");
});

test("pctText renders an APR fraction as a percentage", () => {
  assert.equal(pctText(0.1899, 2), "18.99%");
  assert.equal(pctText(null), DASH);
});

/* ═════════ the copy the page carries ═════════ */

const BEGIN = "/* FH-VIEW-BEGIN */";
const END = "/* FH-VIEW-END */";

function browserCopy() {
  const a = HTML.indexOf(BEGIN);
  const b = HTML.indexOf(END);
  assert.ok(a !== -1 && b > a, "the FH-VIEW markers are gone from banking-surface.html");
  const sandbox = { window: {} };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(HTML.slice(a + BEGIN.length, b), sandbox, { filename: SCREEN + "#FH-VIEW" });
  return sandbox.window.FHBankView;
}

test("the page's inlined view model exposes the same surface as the module", () => {
  const B = browserCopy();
  for (const fn of ["esc", "usd", "usdCents", "pctText", "dateText", "confidenceView", "classify", "groupByEntity", "buildView", "bannerText"]) {
    assert.equal(typeof B[fn], "function", `the page's copy is missing ${fn}()`);
  }
  assert.equal(B.DASH, DASH);
  assert.deepEqual(B.ENTITY_GROUPS, ENTITY_GROUPS);
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
    [failRead("teapot", "???"), { clientId: CID }],
    [okRead(payload({ plaidEnabled: false })), { clientId: CID }],
    [okRead(payload({ accounts: [] })), { clientId: CID }],
    [okRead(payload({ accounts: [account()] })), { clientId: CID }]
  ];
  for (const [res, opts] of cases) {
    assert.deepEqual(B.classify(res, opts), classify(res, opts),
      `the screen and the module disagree about ${res && res.source}`);
  }
});

test("THE PAGE'S COPY AND THE MODULE BUILD THE SAME VIEW FROM THE SAME RESPONSE", () => {
  const B = browserCopy();
  const payloads = [
    payload(),
    payload({ accounts: [account(), account({ entity_kind: "business", entity_kind_source: "manual" })] }),
    payload({ accounts: [account({ balance_current_cents: null, balance_as_of: null })] }),
    payload({ accounts: [account({ entity_kind: "sole_trader", entity_kind_source: "inferred" })] }),
    payload({
      accounts: [account({ entity_kind: "personal", entity_kind_source: "manual" })],
      cards: [card()],
      paymentWindows: [{ bankAccountId: "acct-1", window: null, reason: WINDOW_REASONS.NO_BALANCE, reasonText: WINDOW_REASON_TEXT[WINDOW_REASONS.NO_BALANCE] }]
    }),
    payload({
      cards: [card()],
      paymentWindows: [{ bankAccountId: "acct-1", window: { earliest: "2026-07-21", latest: "2026-07-28", recommended: "2026-07-21" }, reason: null }]
    }),
    payload({ bills: [{ id: "b1", merchant_name: "Insurance Co", amount_cents: 8740, confidence: 0.32, occurrence_count: 2, cadence: "monthly", next_expected_date: "2026-08-01", source: "detected" }] }),
    payload({ itemStatus: "login_required" })
  ];
  for (const p of payloads) {
    assert.deepEqual(B.buildView(p), buildView(p), "the screen would render different numbers");
    assert.equal(B.bannerText(B.buildView(p)), bannerText(buildView(p)));
  }
});
