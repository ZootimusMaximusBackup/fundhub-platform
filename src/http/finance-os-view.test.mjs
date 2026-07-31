/* Tests for src/http/finance-os-view.mjs — the Finance OS subscription
 * screen's decision logic, as pure functions.
 *
 * WHY THESE TESTS EXIST AT ALL. The screen is a static page and there is no
 * browser harness in this repo; npm test globs src/** and scripts/** only, so
 * a test placed under public/ or api/ would silently never run. The logic that
 * decides what a consumer is told about their own credit utilization therefore
 * lives in a module here, and the screen carries a verbatim copy of it. The
 * last two tests are what makes that copy safe: they read
 * public/app/finance-os.html and fail if it has drifted a character.
 *
 * The utilization block is the reason for the whole file. A NULL credit limit
 * rendered as 0% is a lie about somebody's credit, and it is the kind of lie
 * that looks like good news.
 */
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import {
  CARD_FIELDS, NOT_SOURCED, PENDING_SOURCES, ROADMAP_CODE,
  rows, num, esc, usd, utilization, utilizationText, whyUnknown,
  cardRow, portfolioTotals, classify,
  buildCards, buildSubscription, buildAlerts, buildRoadmap,
  softPullState, summarize, VIEW
} from "./finance-os-view.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODULE_PATH = path.resolve(HERE, "finance-os-view.mjs");
const HTML_PATH = path.resolve(HERE, "../../public/app/finance-os.html");

/* ── the v1 field list ─────────────────────────────────────────────────────── */

test("CARD_FIELDS is exactly the four fields addendum §8 names for a card", () => {
  assert.deepEqual(CARD_FIELDS, ["issuer", "limit", "balance", "utilization"]);
});

test("NOT_SOURCED names the v2 fields this screen refuses to render", () => {
  ["bills", "business_vs_personal", "payment_reminders", "cash_flow_projection"]
    .forEach((k) => {
      assert.ok(NOT_SOURCED[k], k + " must be listed as unsourced");
      assert.equal(typeof NOT_SOURCED[k], "string");
    });
});

/* ── num: node-pg hands bigints back as strings ────────────────────────────── */

test("num: a bigint column arriving as a string is still a number", () => {
  assert.equal(num("500000"), 500000);
  assert.equal(num(500000), 500000);
});

test("num: null, undefined and empty string are all unknown", () => {
  assert.equal(num(null), null);
  assert.equal(num(undefined), null);
  assert.equal(num(""), null);
});

test("num: garbage is unknown rather than NaN leaking into arithmetic", () => {
  assert.equal(num("not a number"), null);
  assert.equal(num(NaN), null);
  assert.equal(num(Infinity), null);
});

test("num: a real zero survives as zero, not as unknown", () => {
  assert.equal(num(0), 0);
  assert.equal(num("0"), 0);
});

/* ── usd ───────────────────────────────────────────────────────────────────── */

test("usd: cents become dollars at the boundary", () => {
  assert.equal(usd(500000), "$5,000");
  assert.equal(usd("1234500"), "$12,345");
});

test("usd: an unknown amount is an em dash and never $0", () => {
  assert.equal(usd(null), "—");
  assert.equal(usd(undefined), "—");
  assert.equal(usd(""), "—");
});

test("usd: a real zero balance renders as $0, because that is true", () => {
  assert.equal(usd(0), "$0");
});

/* ── rows: the two real response shapes ────────────────────────────────────── */

test("rows: readHandler endpoints answer under `items`", () => {
  assert.deepEqual(rows({ ok: true, count: 1, items: [{ a: 1 }] }), [{ a: 1 }]);
});

test("rows: the hand-rolled tradelines endpoint answers under `data`", () => {
  assert.deepEqual(rows({ ok: true, data: [{ a: 1 }], funding: {} }), [{ a: 1 }]);
});

test("rows: anything else is an empty list rather than a throw", () => {
  assert.deepEqual(rows(null), []);
  assert.deepEqual(rows(undefined), []);
  assert.deepEqual(rows({ ok: true }), []);
  assert.deepEqual(rows("nope"), []);
});

test("buildRoadmap: reads the `items` shape /api/read/entitlements actually returns", () => {
  // Regression: this read res.body.data and found nothing against a healthy
  // server, because readHandler answers `items`.
  const out = buildRoadmap({
    status: 200,
    body: { ok: true, count: 1, items: [
      { entitlement_code: "credit-optimization-roadmap", entitlement_name: "Credit Optimization Roadmap", active: true }
    ] }
  });
  assert.equal(out.held, true);
  assert.equal(out.name, "Credit Optimization Roadmap");
});

test("buildAlerts and buildSubscription read the `items` shape too", () => {
  assert.equal(buildAlerts({ status: 200, body: { ok: true, items: [{ message: "hi" }] } }).count, 1);
  assert.equal(buildSubscription({ status: 200, body: { ok: true, items: [{ tier: "Growth" }] } }).tier, "Growth");
});

/* ── utilization — the rule this module exists for ─────────────────────────── */

test("utilization: a NULL credit limit yields NULL, not 0", () => {
  assert.equal(utilization(null, 250000), null);
});

test("utilization: a NULL balance yields NULL, not 0", () => {
  assert.equal(utilization(500000, null), null);
});

test("utilization: both unknown yields NULL", () => {
  assert.equal(utilization(null, null), null);
  assert.equal(utilization(undefined, undefined), null);
  assert.equal(utilization("", ""), null);
});

test("utilization: a ZERO limit yields NULL — x/0 is undefined, not 0% and not infinity", () => {
  assert.equal(utilization(0, 0), null);
  assert.equal(utilization(0, 100), null);
  assert.equal(utilization("0", "5000"), null);
});

test("utilization: a negative limit yields NULL rather than a negative percentage", () => {
  assert.equal(utilization(-1, 100), null);
});

test("utilization: a KNOWN limit with a KNOWN zero balance is a real 0, not unknown", () => {
  assert.equal(utilization(500000, 0), 0);
  assert.notEqual(utilization(500000, 0), null);
});

test("utilization: the ordinary case", () => {
  assert.equal(utilization(500000, 250000), 0.5);
  assert.equal(utilization("1000000", "185000"), 0.185);
});

test("utilization: over-limit is NOT clamped to 100% — it is the worst number on the page", () => {
  assert.equal(utilization(100000, 118000), 1.18);
});

test("utilization: unknown and zero are different values, which is the whole point", () => {
  const unknown = utilization(null, 0);
  const realZero = utilization(500000, 0);
  assert.equal(unknown, null);
  assert.equal(realZero, 0);
  assert.notEqual(unknown, realZero);
});

/* ── utilizationText ───────────────────────────────────────────────────────── */

test("utilizationText: NULL prints an em dash, never '0%'", () => {
  assert.equal(utilizationText(null), "—");
  assert.equal(utilizationText(undefined), "—");
});

test("utilizationText: a real zero prints 0%", () => {
  assert.equal(utilizationText(0), "0%");
});

test("utilizationText: fractions round to whole percent", () => {
  assert.equal(utilizationText(0.5), "50%");
  assert.equal(utilizationText(0.185), "19%");
  assert.equal(utilizationText(1.18), "118%");
});

/* ── whyUnknown — show the blank AND say why ───────────────────────────────── */

test("whyUnknown: names which of the two numbers is missing", () => {
  assert.equal(whyUnknown(null, 100), "no credit limit on file");
  assert.equal(whyUnknown(100, null), "no balance on file");
  assert.equal(whyUnknown(null, null), "no limit or balance on file");
  assert.equal(whyUnknown(0, 100), "credit limit is zero");
});

test("whyUnknown: returns null when utilization is knowable, so it doubles as the presence test", () => {
  assert.equal(whyUnknown(500000, 250000), null);
  assert.equal(whyUnknown(500000, 0), null);
});

/* ── cardRow ───────────────────────────────────────────────────────────────── */

test("cardRow: maps a full tradelines row onto the four §8 fields", () => {
  const c = cardRow({
    id: "t1", lender: "Amex Blue Business", kind: "revolving", source: "crs",
    credit_limit_cents: 500000, balance_cents: 125000
  });
  assert.equal(c.issuer, "Amex Blue Business");
  assert.equal(c.limitText, "$5,000");
  assert.equal(c.balanceText, "$1,250");
  assert.equal(c.utilizationText, "25%");
  assert.equal(c.utilizationKnown, true);
  assert.equal(c.whyUnknown, null);
  assert.equal(c.overLimit, false);
});

test("cardRow: a card with no limit shows the balance but a blank utilization with a reason", () => {
  const c = cardRow({ lender: "Chase", credit_limit_cents: null, balance_cents: 125000 });
  assert.equal(c.balanceText, "$1,250");
  assert.equal(c.limitText, "—");
  assert.equal(c.limitKnown, false);
  assert.equal(c.utilization, null);
  assert.equal(c.utilizationText, "—");
  assert.equal(c.utilizationKnown, false);
  assert.equal(c.whyUnknown, "no credit limit on file");
});

test("cardRow: a blank issuer is named rather than rendered as an empty cell", () => {
  assert.equal(cardRow({ lender: "   " }).issuer, "(no issuer recorded)");
  assert.equal(cardRow({ lender: null }).issuer, "(no issuer recorded)");
  assert.equal(cardRow({}).issuer, "(no issuer recorded)");
});

test("cardRow: an entirely empty row does not throw and claims no numbers", () => {
  const c = cardRow({});
  assert.equal(c.limitText, "—");
  assert.equal(c.balanceText, "—");
  assert.equal(c.utilizationText, "—");
  assert.equal(c.utilizationKnown, false);
});

test("cardRow: null and undefined input do not throw", () => {
  assert.equal(cardRow(null).utilizationText, "—");
  assert.equal(cardRow(undefined).issuer, "(no issuer recorded)");
});

test("cardRow: a manually typed line is flagged, because it is not bureau-authoritative", () => {
  assert.equal(cardRow({ source: "manual" }).typedByHand, true);
  assert.equal(cardRow({ source: "crs" }).typedByHand, false);
});

test("cardRow: an over-limit card is flagged", () => {
  const c = cardRow({ credit_limit_cents: 100000, balance_cents: 118000 });
  assert.equal(c.overLimit, true);
  assert.equal(c.utilizationText, "118%");
});

/* ── portfolioTotals ───────────────────────────────────────────────────────── */

test("portfolioTotals: an empty book totals nothing rather than $0", () => {
  const t = portfolioTotals([]);
  assert.equal(t.limitText, "—");
  assert.equal(t.balanceText, "—");
  assert.equal(t.utilizationText, "—");
  assert.equal(t.cardCount, 0);
});

test("portfolioTotals: aggregate utilization is weighted, not the mean of the percentages", () => {
  // $50,000 at 10% and $500 at 100% is 11% overall, NOT 55%.
  const t = portfolioTotals([
    { credit_limit_cents: 5000000, balance_cents: 500000 },
    { credit_limit_cents: 50000, balance_cents: 50000 }
  ]);
  assert.equal(t.utilizationText, "11%");
});

test("portfolioTotals: cards with an unknown limit are EXCLUDED and the exclusion is stated", () => {
  const t = portfolioTotals([
    { credit_limit_cents: 500000, balance_cents: 250000 },
    { credit_limit_cents: null, balance_cents: 900000 }
  ]);
  assert.equal(t.cardCount, 2);
  assert.equal(t.countedCount, 1);
  assert.equal(t.excludedCount, 1);
  assert.equal(t.missingLimit, 1);
  assert.match(t.caveat, /1 of 2 cards left out/);
});

test("portfolioTotals: with every card unknown the totals are blank, not zero", () => {
  const t = portfolioTotals([
    { credit_limit_cents: null, balance_cents: null },
    { credit_limit_cents: null, balance_cents: 100 }
  ]);
  assert.equal(t.limitText, "—");
  assert.equal(t.balanceText, "—");
  assert.equal(t.utilization, null);
  assert.equal(t.countedCount, 0);
});

test("portfolioTotals: a complete book carries no caveat", () => {
  const t = portfolioTotals([{ credit_limit_cents: 500000, balance_cents: 0 }]);
  assert.equal(t.caveat, null);
  assert.equal(t.utilizationText, "0%");
});

test("portfolioTotals: a zero-limit card is excluded rather than dividing by zero", () => {
  const t = portfolioTotals([{ credit_limit_cents: 0, balance_cents: 0 }]);
  assert.equal(t.countedCount, 0);
  assert.equal(t.utilization, null);
});

test("portfolioTotals: non-array input does not throw", () => {
  assert.equal(portfolioTotals(null).cardCount, 0);
  assert.equal(portfolioTotals(undefined).cardCount, 0);
});

/* ── classify — four failures, four sentences ──────────────────────────────── */

test("classify: no answer at all is 'offline' and never blames the session", () => {
  const s = classify({ transport: true, detail: "network down" }, { what: "your cards" });
  assert.equal(s.code, "offline");
  assert.equal(s.live, false);
  assert.match(s.text, /could not reach/);
});

test("classify: 401 says the session expired", () => {
  const s = classify({ status: 401, body: null }, { what: "your cards" });
  assert.equal(s.code, "signedout");
  assert.match(s.text, /session has expired/);
});

test("classify: 403 says the role is not permitted — NOT 'sign in again'", () => {
  const s = classify({ status: 403, body: null }, { what: "your cards" });
  assert.equal(s.code, "forbidden");
  assert.match(s.text, /not permitted/);
  assert.equal(/sign in/.test(s.text), false);
});

test("classify: 401 and 403 never collapse into the same answer", () => {
  const a = classify({ status: 401 }, { what: "x" });
  const b = classify({ status: 403 }, { what: "x" });
  assert.notEqual(a.code, b.code);
  assert.notEqual(a.text, b.text);
});

test("classify: a router-fallthrough 404 means NOT DEPLOYED, and names the missing migration", () => {
  const s = classify(
    { status: 404, body: { error: "not_found", path: "/api/read/subscriptions" } },
    { what: "your subscription", pending: "075_subscriptions.sql" }
  );
  assert.equal(s.code, "unrouted");
  assert.match(s.text, /075_subscriptions\.sql/);
  assert.match(s.text, /not available yet/);
});

test("classify: an endpoint's own 404 means no such row, and does NOT claim the backend is down", () => {
  const s = classify({ status: 404, body: { ok: false, error: "no such client" } }, { what: "your cards" });
  assert.equal(s.code, "notfound");
  assert.equal(/not deployed/.test(s.text), false);
  assert.equal(s.text, "nothing on file yet for your cards");
});

/* Copy that reads as English. Every branch interpolates the same possessive
   noun phrase, so a template that only works for one section is a bug the
   browser check found once already ("no your cards on file", "your alerts is
   not available"). These pin the wording of both shapes. */
test("classify: every failure sentence reads correctly for a plural section name", () => {
  ["your cards", "your alerts", "your subscription details"].forEach((what) => {
    [401, 403, 400, 500, 503].forEach((status) => {
      const t = classify({ status: status, body: null }, { what: what }).text;
      assert.equal(/\bno your\b|\balerts is\b|\bdetails is\b/.test(t), false,
        "ungrammatical copy for " + what + " at " + status + ": " + t);
    });
    const nf = classify({ status: 404, body: { ok: false } }, { what: what }).text;
    assert.equal(/\bno your\b/.test(nf), false, "ungrammatical 404 copy: " + nf);
  });
});

test("classify: 400 reports the parameter problem", () => {
  const s = classify({ status: 400, body: { error: "client_id is required" } }, { what: "your cards" });
  assert.equal(s.code, "badrequest");
  assert.match(s.text, /client_id is required/);
});

test("classify: 503 and a db:down body both mean the database, not the network", () => {
  assert.equal(classify({ status: 503, body: null }, {}).code, "nodb");
  assert.equal(classify({ status: 200, body: { db: "down" } }, {}).code, "nodb");
});

test("classify: a 5xx names the status so a support ticket can quote it", () => {
  const s = classify({ status: 502, body: null }, { what: "your cards" });
  assert.equal(s.code, "servererror");
  assert.match(s.text, /502/);
});

test("classify: 200 with ok:true is the only live state", () => {
  const s = classify({ status: 200, body: { ok: true, data: [] } }, {});
  assert.equal(s.code, "live");
  assert.equal(s.live, true);
  assert.equal(s.text, null);
});

test("classify: a 200 that is not ok:true is a failure wearing a success code", () => {
  const s = classify({ status: 200, body: { ok: false, error: "boom" } }, { what: "your cards" });
  assert.equal(s.live, false);
  assert.equal(s.code, "badresponse");
});

test("classify: a missing response is offline rather than a throw", () => {
  assert.equal(classify(null, {}).code, "offline");
  assert.equal(classify(undefined, {}).code, "offline");
});

/* ── buildCards ────────────────────────────────────────────────────────────── */

test("buildCards: installment loans are not cards and are counted out of the table", () => {
  const out = buildCards({
    status: 200,
    body: {
      ok: true,
      data: [
        { lender: "Amex", kind: "revolving", credit_limit_cents: 500000, balance_cents: 100000 },
        { lender: "Toyota Financial", kind: "installment", credit_limit_cents: 2000000, balance_cents: 1500000 }
      ]
    }
  });
  assert.equal(out.cards.length, 1);
  assert.equal(out.installmentCount, 1);
  assert.equal(out.cards[0].issuer, "Amex");
});

test("buildCards: a failure yields no cards and no totals rather than an empty-looking book", () => {
  const out = buildCards({ status: 403, body: null });
  assert.deepEqual(out.cards, []);
  assert.equal(out.totals, null);
  assert.equal(out.state.code, "forbidden");
});

test("buildCards: a live response with no rows is an empty book, not a failure", () => {
  const out = buildCards({ status: 200, body: { ok: true, data: [] } });
  assert.equal(out.state.live, true);
  assert.equal(out.cards.length, 0);
  assert.equal(out.totals.cardCount, 0);
});

/* ── buildSubscription — W2 has not merged ─────────────────────────────────── */

test("buildSubscription: with 075 unshipped the tile says so and invents no tier", () => {
  const out = buildSubscription({ status: 404, body: { error: "not_found", path: "/api/read/subscriptions" } });
  assert.equal(out.state.code, "unrouted");
  assert.equal(out.tier, null);
  assert.equal(out.status, null);
  assert.match(out.state.text, /075_subscriptions\.sql/);
  assert.match(out.state.text, /not available yet/);
});

test("buildSubscription: a live row carries only the two fields §8 names", () => {
  const out = buildSubscription({
    status: 200,
    body: { ok: true, data: [{ tier: "Growth", status: "active", price_cents: 9900 }] }
  });
  assert.equal(out.tier, "Growth");
  assert.equal(out.status, "active");
  assert.equal(out.price_cents, undefined, "price is not a §8 v1 field and must not ride along");
});

test("buildSubscription: a live response with no row says no subscription, not 'not deployed'", () => {
  const out = buildSubscription({ status: 200, body: { ok: true, data: [] } });
  assert.equal(out.state.code, "empty");
  assert.equal(out.tier, null);
});

test("buildSubscription: blank strings on the row are unknown, not empty labels", () => {
  const out = buildSubscription({ status: 200, body: { ok: true, data: [{ tier: "", status: null }] } });
  assert.equal(out.tier, null);
  assert.equal(out.status, null);
});

/* ── buildAlerts — W4 has not merged ───────────────────────────────────────── */

test("buildAlerts: with 078 unshipped the tile says so and shows no alerts", () => {
  const out = buildAlerts({ status: 404, body: { error: "not_found", path: "/api/read/alerts" } });
  assert.equal(out.state.code, "unrouted");
  assert.deepEqual(out.alerts, []);
  assert.match(out.state.text, /078_alerts\.sql/);
});

test("buildAlerts: live rows map to message and severity", () => {
  const out = buildAlerts({
    status: 200,
    body: { ok: true, data: [{ id: "a1", message: "Balance rose 40%", severity: "warn" }] }
  });
  assert.equal(out.count, 1);
  assert.equal(out.alerts[0].message, "Balance rose 40%");
  assert.equal(out.alerts[0].severity, "warn");
});

test("buildAlerts: an alert with no message is named rather than blank", () => {
  const out = buildAlerts({ status: 200, body: { ok: true, data: [{ id: "a1" }] } });
  assert.equal(out.alerts[0].message, "(no message)");
  assert.equal(out.alerts[0].severity, null);
});

/* ── buildRoadmap ──────────────────────────────────────────────────────────── */

test("ROADMAP_CODE is the entitlement identity from 032, not an invented one", () => {
  assert.equal(ROADMAP_CODE, "credit-optimization-roadmap");
});

test("buildRoadmap: an active grant is held", () => {
  const out = buildRoadmap({
    status: 200,
    body: { ok: true, data: [
      { entitlement_code: "credit-analysis-report", active: true },
      { entitlement_code: "credit-optimization-roadmap", entitlement_name: "Credit Optimization Roadmap",
        active: true, granted_at: "2026-07-01T00:00:00Z" }
    ] }
  });
  assert.equal(out.held, true);
  assert.equal(out.name, "Credit Optimization Roadmap");
  assert.equal(out.grantedAt, "2026-07-01T00:00:00Z");
});

test("buildRoadmap: no matching entitlement is 'not in your plan', not an error", () => {
  const out = buildRoadmap({ status: 200, body: { ok: true, data: [{ entitlement_code: "funding-snapshot", active: true }] } });
  assert.equal(out.held, false);
  assert.match(out.note, /not part of your plan/);
});

test("buildRoadmap: a revoked grant is present but not held", () => {
  const out = buildRoadmap({
    status: 200,
    body: { ok: true, data: [{ entitlement_code: "credit-optimization-roadmap", active: false }] }
  });
  assert.equal(out.held, false);
  assert.match(out.note, /not active/);
});

test("buildRoadmap: a failed read claims nothing", () => {
  const out = buildRoadmap({ status: 500, body: null });
  assert.equal(out.held, false);
  assert.equal(out.name, null);
});

/* ── softPullState — W3 has not merged ─────────────────────────────────────── */

test("softPullState: with no request path the button is disabled and says why", () => {
  const s = softPullState(false);
  assert.equal(s.enabled, false);
  assert.match(s.reason, /has not shipped/);
});

test("softPullState: available only when explicitly true", () => {
  assert.equal(softPullState(true).enabled, true);
  assert.equal(softPullState(true).reason, null);
  assert.equal(softPullState(undefined).enabled, false);
  assert.equal(softPullState(null).enabled, false);
});

/* ── summarize ─────────────────────────────────────────────────────────────── */

test("summarize: all live is a real banner", () => {
  const s = summarize([{ live: true, tone: "real" }, { live: true, tone: "real" }]);
  assert.equal(s.tone, "real");
  assert.match(s.text, /2 of 2/);
});

test("summarize: one error outranks three successes — a failure is never hidden", () => {
  const s = summarize([
    { live: true, tone: "real" },
    { live: true, tone: "real" },
    { live: true, tone: "real" },
    { live: false, tone: "error", text: "the database is unreachable" }
  ]);
  assert.equal(s.tone, "error");
  assert.match(s.text, /3 of 4/);
  assert.match(s.text, /database is unreachable/);
});

test("summarize: a non-error failure keeps the sample tone", () => {
  const s = summarize([{ live: true, tone: "real" }, { live: false, tone: "sample", text: "no subscription" }]);
  assert.equal(s.tone, "sample");
});

test("summarize: nothing at all does not throw", () => {
  assert.equal(summarize([]).tone, "sample");
  assert.equal(summarize(null).tone, "sample");
});

/* ── esc ───────────────────────────────────────────────────────────────────── */

test("esc: a lender name is never parsed as markup", () => {
  assert.equal(esc('<img src=x onerror="alert(1)">'),
    "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  assert.equal(esc(null), "");
});

/* ── the screen's embedded copy ────────────────────────────────────────────── */

const MODULE_SRC = fs.readFileSync(MODULE_PATH, "utf8");
const HTML_SRC = fs.readFileSync(HTML_PATH, "utf8");
const MARKERS = /\/\* ==FHVIEW-BEGIN== \*\/\n([\s\S]*?)\n\/\* ==FHVIEW-END== \*\//;
const EMBEDDED = (HTML_SRC.match(MARKERS) || [])[1];
const MODULE_BODY = (MODULE_SRC.match(MARKERS) || [])[1];

test("the screen's embedded copy of this module is this module, with `export ` stripped", () => {
  assert.ok(MODULE_BODY, "no FHVIEW markers found in finance-os-view.mjs");
  assert.ok(EMBEDDED, "no FHVIEW block found in public/app/finance-os.html");
  assert.equal(EMBEDDED, MODULE_BODY.replace(/^export /gm, ""),
    "public/app/finance-os.html has drifted from finance-os-view.mjs — " +
    "edit the module and paste it back between the FHVIEW markers");
});

test("the embedded copy runs in a browser-shaped sandbox and exposes every export", () => {
  const sandbox = {};
  vm.createContext(sandbox);
  const VIEW_IN_BROWSER = vm.runInContext(
    '(function () { "use strict";\n' + EMBEDDED + "\nreturn VIEW; })()",
    sandbox, { filename: "finance-os.html#FHVIEW" }
  );
  assert.deepEqual(Object.keys(VIEW_IN_BROWSER).sort(), Object.keys(VIEW).sort());

  // and it behaves the same, since it is the same source. The null-limit case
  // is checked in the browser copy specifically: it is the one that matters.
  assert.equal(VIEW_IN_BROWSER.utilization(null, 250000), null);
  assert.equal(VIEW_IN_BROWSER.utilization(500000, 0), 0);
  assert.equal(VIEW_IN_BROWSER.utilizationText(null), "—");
  assert.equal(VIEW_IN_BROWSER.classify({ status: 403 }, {}).code, "forbidden");
  assert.equal(VIEW_IN_BROWSER.classify({ status: 401 }, {}).code, "signedout");
  assert.deepEqual(VIEW_IN_BROWSER.CARD_FIELDS, CARD_FIELDS);
});

/* ── the screen is routed ──────────────────────────────────────────────────── */

test("finance-os.html is in shell.js's ALL array, or the gate bounces it to command-center", () => {
  const shell = fs.readFileSync(path.resolve(HERE, "../../public/app/shell.js"), "utf8");
  const all = (shell.match(/var ALL = \[([\s\S]*?)\];/) || [])[1];
  assert.ok(all, "could not find the ALL array in shell.js");
  assert.match(all, /"finance-os\.html"/,
    "finance-os.html is missing from shell.js ALL — shell.js:483 will redirect it away");
});
