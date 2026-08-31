/* Tests for the Commission column on public/app/affiliate.html.
 *
 * THE BUG THESE TESTS EXIST TO STOP. The screen carried `var RATE=0.12` and
 * multiplied each row's basis by it. The real Tier 1 rate is 20%, owner-set
 * 2026-08-24 (db/migrations/261_affiliate_tier1_20pct_20260824.sql), so every
 * affiliate would have been shown a commission 40% short of what they are owed
 * the moment the leads table had a row in it. It was dormant only because
 * `var LEADS = []` is fetched by nothing.
 *
 * The fix: commission is READ from affiliate_referrals.commission_due, which
 * convert() in src/affiliates/economics.mjs already worked out and stamped with
 * the exact rule that produced it. Nothing is recomputed in the browser, and a
 * NULL commission_due — a conversion with no rate in force — survives to the
 * screen as a dash. Never $0.
 *
 * Two halves, the same shape as pipeline-screen.test.mjs and search-screen.test.mjs:
 *   THE VIEW MODEL — the FH-AFFILIATE-COMMISSION-BEGIN/END block, driven in a vm.
 *   THE WIRING     — the screen's render path and markup actually use it.
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCREEN = path.resolve(HERE, "../../public/app/affiliate.html");
const HTML = fs.readFileSync(SCREEN, "utf8");

const BEGIN = "/* FH-AFFILIATE-COMMISSION-BEGIN */";
const END = "/* FH-AFFILIATE-COMMISSION-END */";

function loadCommission() {
  const a = HTML.indexOf(BEGIN);
  const b = HTML.indexOf(END);
  assert.ok(a !== -1 && b > a, "the FH-AFFILIATE-COMMISSION markers are gone from affiliate.html");
  const sandbox = { window: {} };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(HTML.slice(a + BEGIN.length, b), sandbox, { filename: SCREEN + "#FH-AFFILIATE-COMMISSION" });
  assert.ok(sandbox.window.FHAffiliateCommission, "FHAffiliateCommission did not attach");
  return sandbox.window.FHAffiliateCommission;
}

/* The leads script — the first inline <script> on the page, the one holding
 * renderLeads. Block comments are stripped so the prose about the old 12% rate
 * cannot make a test pass or fail. */
function leadsCode() {
  const scripts = [...HTML.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const leads = scripts.find((s) => s.includes("function renderLeads"));
  assert.ok(leads, "the renderLeads script is gone from affiliate.html");
  return leads.replace(/\/\*[\s\S]*?\*\//g, "");
}

/* A pg numeric column arrives in JSON as a string ("600.00"), which is what a
 * read of affiliate_referrals.commission_due will hand this screen. */
const row = (commission_due) => ({ d: "2026-08-24", biz: "—", st: "Funded", prod: "Consulting Services Deposit", basis: 3000, pay: "Accrued", commission_due });

describe("affiliate.html — the Commission column reads the row", () => {

  test("the block loads and exposes the three helpers", () => {
    const C = loadCommission();
    assert.equal(typeof C.due, "function");
    assert.equal(typeof C.text, "function");
    assert.equal(typeof C.totals, "function");
  });

  test("a row with a commission renders that exact figure", () => {
    const C = loadCommission();
    assert.equal(C.text(row("600.00")), "$600.00");
    assert.equal(C.text(row(600)), "$600.00");
    assert.equal(C.text(row("1250.50")), "$1,250.50");
    assert.equal(C.text(row("51.25")), "$51.25");
  });

  test("it prints the ledger's figure, not 12% of the basis", () => {
    // The exact regression. Basis 3000 with the owner-set 20% rule is $600.00.
    // The deleted `basis * 0.12` would have printed $360.00 — 40% short.
    const C = loadCommission();
    const cell = C.text(row("600.00"));
    assert.equal(cell, "$600.00");
    assert.notEqual(cell, "$360.00");
  });

  test("a NULL commission renders the unknown state, and never $0", () => {
    // A referral that converted with no rate in force. NULL is unknown and has
    // to survive: "$0.00" would tell an affiliate they earned nothing, which
    // this screen has no way to know.
    const C = loadCommission();
    for (const missing of [null, undefined, ""]) {
      assert.equal(C.due(row(missing)), null);
      assert.equal(C.text(row(missing)), "—");
      assert.notEqual(C.text(row(missing)), "$0.00");
      assert.notEqual(C.text(row(missing)), "$0");
    }
  });

  test("a field that is not a number is unknown, not zero", () => {
    const C = loadCommission();
    assert.equal(C.text(row("not a number")), "—");
    assert.equal(C.text({}), "—");
  });

  test("a commission the ledger really recorded as zero prints as zero", () => {
    // The other half of the same rule: a measured 0 is a measurement, and
    // showing it as a dash would hide a real answer behind "unknown".
    const C = loadCommission();
    assert.equal(C.due(row("0.00")), 0);
    assert.equal(C.text(row("0.00")), "$0.00");
  });

  test("the total adds up only the rows it actually knows", () => {
    const C = loadCommission();
    const t = C.totals([row("600.00"), row("400.00"), row("51.25")]);
    assert.equal(t.text, "$1,051.25");
    assert.equal(t.counted, 3);
    assert.equal(t.unknown, 0);
    assert.equal(t.label, "Total shown");
  });

  test("a row with no rate set is left out of the total and named", () => {
    const C = loadCommission();
    const t = C.totals([row("600.00"), row(null), row("400.00")]);
    assert.equal(t.text, "$1,000.00");
    assert.equal(t.counted, 2);
    assert.equal(t.unknown, 1);
    assert.equal(t.label, "Total shown · 1 row with no rate set is not counted");
    const t2 = C.totals([row("600.00"), row(null), row(null)]);
    assert.equal(t2.label, "Total shown · 2 rows with no rate set are not counted");
  });

  test("a total with nothing known is the dash, not $0.00", () => {
    const C = loadCommission();
    assert.equal(C.totals([row(null), row(undefined)]).text, "—");
    assert.equal(C.totals([]).text, "—");
    assert.equal(C.totals(null).text, "—");
  });
});

describe("affiliate.html — no money is worked out in the browser", () => {

  test("the hardcoded rate and the recompute are gone", () => {
    const code = leadsCode();
    assert.ok(!/\bRATE\b/.test(code), "a commission rate constant is back in the leads script");
    assert.ok(!/0\.12/.test(code), "the 12% rate is back in the leads script");
    assert.ok(!/function\s+commission\s*\(/.test(code), "the browser-side commission() is back");
    assert.ok(!/\bbasis\b[^;]*\*/.test(code), "the basis is being multiplied again");
  });

  test("the leads script multiplies nothing at all", () => {
    // Comments are already stripped, and this code has no legitimate use for a
    // multiply. If one appears, someone is doing arithmetic on money again.
    const code = leadsCode();
    assert.ok(!code.includes("*"), "the leads script now contains a multiplication");
  });

  test("the cell and the total both come from the row helpers", () => {
    const code = leadsCode();
    assert.match(code, /commission_due/, "the screen must read commission_due");
    assert.match(code, /commissionText\(l\)/, "the Commission cell must use commissionText");
    assert.match(code, /commissionTotals\(list\)/, "the Total shown cell must use commissionTotals");
  });

  test("the total row can carry the count of what it could not add", () => {
    assert.match(HTML, /id="leadTotalLabel"/, "the Total shown label needs an id to say what it skipped");
    // Shipped before any script runs. A $0 sitting there is the same lie the
    // dash exists to stop, and it is what stays on screen if the read fails.
    assert.match(HTML, /id="leadTotal"[^>]*>—</, "the empty total must ship as the dash, not $0");
  });

  test("the Business column is documented as never taking a person's name", () => {
    // The affiliate contract on this page grants a business name, a referral
    // date, a status and their own commission. `clients` has no business-name
    // column, so the next person to fill this table is one shortcut away from
    // putting first and last name in it and handing an outside partner contact
    // details the contract says they do not get.
    assert.match(HTML, /client_custom_fields\.business_name/);
    assert.match(HTML, /Contact details are outside the Affiliate role/);
  });
});
