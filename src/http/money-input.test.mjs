/* Tests for public/app/money-input.js — the ONE rule that turns a dollar
 * amount a staff member typed into something the backend can store.
 *
 * WHY THIS MATTERS MORE THAN MOST PARSERS. Two screens ask for money:
 * pipeline.html asks what actually funded when a card lands on Funded, and
 * client-control-panel.html asks how much a bank approved on "Bank yes". Both
 * numbers become the basis a client is billed from
 * (docs/CLOSEOUT-FEE-BASIS.md). The failure this file exists to prevent is not
 * a crash — it is a blank box quietly becoming $0, or 450.10 quietly becoming
 * 450.09. Both look right on the screen and are wrong in the invoice.
 *
 * WHY IT LIVES HERE. package.json's test glob is "src/**" and "scripts/**", so
 * a test under public/ is silently never collected (CLAUDE.md §12). The module
 * is loaded with no DOM, the same technique src/http/pipeline-screen.test.mjs
 * and src/http/client-panel-screen.test.mjs use on those pages.
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODULE = path.resolve(HERE, "../../public/app/money-input.js");
const PANEL = path.resolve(HERE, "../../public/app/client-control-panel.html");
const PIPELINE = path.resolve(HERE, "../../public/app/pipeline.html");

function load() {
  const sandbox = { window: {} };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(MODULE, "utf8"), sandbox, { filename: MODULE });
  assert.ok(sandbox.window.FHMoneyInput, "money-input.js did not expose FHMoneyInput");
  return sandbox.window.FHMoneyInput;
}

const parse = (v) => load().parseAmount(v);

describe("public/app/money-input.js — blank is never zero", () => {
  // The whole reason this module exists. A missing amount must refuse, so the
  // caller abandons the save. If any of these ever return ok:true with 0, a
  // client gets billed off an amount nobody entered.
  for (const blank of [undefined, null, "", "   ", "\t", "\n"]) {
    test(`refuses ${JSON.stringify(blank)} as unknown, not as zero`, () => {
      const r = parse(blank);
      assert.equal(r.ok, false);
      assert.equal(r.reason, "blank");
      assert.equal(r.cents, undefined, "a refused amount must carry no number at all");
      assert.match(r.message, /not the same as zero/i);
    });
  }

  test("an explicit zero is refused too — nothing funded is not a funding", () => {
    for (const z of ["0", "0.00", "$0", "0.0"]) {
      const r = parse(z);
      assert.equal(r.ok, false, `${z} should be refused`);
      assert.equal(r.reason, "zero");
    }
  });
});

describe("public/app/money-input.js — no floating point drift", () => {
  // 450.10 * 100 is 45009.999999999996 in JavaScript. Anything that multiplies
  // turns a $450.10 approval into $450.09. These pin the exact cents.
  const exact = [
    ["450.10", 45010, "450.10"],
    ["0.01", 1, "0.01"],
    ["0.07", 7, "0.07"],
    ["1.005", null, null],       // three decimals: refused, never rounded
    ["8.20", 820, "8.20"],
    ["1234.56", 123456, "1234.56"],
    ["45000.50", 4500050, "45000.50"],
    ["99999999.99", 9999999999, "99999999.99"]
  ];
  for (const [input, cents, dollars] of exact) {
    test(`${input} -> ${cents === null ? "refused" : cents + " cents"}`, () => {
      const r = parse(input);
      if (cents === null) {
        assert.equal(r.ok, false);
        assert.equal(r.reason, "too_precise");
        return;
      }
      assert.equal(r.ok, true, r.message);
      assert.equal(r.cents, cents);
      assert.equal(r.dollars, dollars);
      assert.ok(Number.isInteger(r.cents), "cents must be a whole number");
    });
  }

  test("more than two decimals is refused, not rounded", () => {
    // Silently turning 45000.999 into 45001.00 is a wrong number that looks
    // right, which is worse than making someone retype it.
    const r = parse("45000.999");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "too_precise");
  });
});

describe("public/app/money-input.js — what people actually type", () => {
  const same = ["45000", "$45,000", "45,000", " $45,000 ", "45000.00", "+45000", "$45000.0"];
  for (const input of same) {
    test(`${JSON.stringify(input)} is $45,000`, () => {
      const r = parse(input);
      assert.equal(r.ok, true, r.message);
      assert.equal(r.cents, 4500000);
      assert.equal(r.dollars, "45000.00");
    });
  }

  test("the dollar string is always fixed 2dp, ready for numeric(14,2)", () => {
    for (const input of ["45000", "45000.5", "0.01", "7"]) {
      const r = parse(input);
      assert.equal(r.ok, true);
      assert.match(r.dollars, /^\d+\.\d{2}$/, `${input} -> ${r.dollars}`);
    }
  });
});

describe("public/app/money-input.js — refuses what is not an amount", () => {
  test("negatives are refused", () => {
    for (const n of ["-500", "-$500", "-0.01"]) {
      const r = parse(n);
      assert.equal(r.ok, false, `${n} should be refused`);
      assert.equal(r.reason, "negative");
    }
  });

  test("words and junk are refused, never coerced", () => {
    for (const junk of ["abc", "forty thousand", "45k", "1e5", "4.5.6", "$", "--", "NaN", "Infinity"]) {
      const r = parse(junk);
      assert.equal(r.ok, false, `${junk} should be refused`);
      assert.equal(r.cents, undefined);
    }
  });

  test("an amount past the $1bn ceiling is refused", () => {
    const r = parse("1000000000.01");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "too_large");
  });

  test("every refusal carries a sentence a person can act on", () => {
    for (const bad of ["", "abc", "-5", "0", "45000.999", "1000000000.01"]) {
      const r = parse(bad);
      assert.equal(r.ok, false);
      assert.equal(typeof r.message, "string");
      assert.ok(r.message.length > 10, `bare code leaked for ${JSON.stringify(bad)}`);
      assert.ok(!/^[a-z][a-z0-9_]*$/.test(r.message), "message must not be a snake_case code");
    }
  });
});

describe("both screens actually load and use the shared rule", () => {
  // A parser nothing calls fixes nothing. These fail if a screen stops loading
  // the module or stops sending the field the backend reads.
  const panel = fs.readFileSync(PANEL, "utf8");
  const pipeline = fs.readFileSync(PIPELINE, "utf8");

  test("client-control-panel.html loads money-input.js", () => {
    assert.match(panel, /<script src="money-input\.js"><\/script>/);
  });

  test("pipeline.html loads money-input.js", () => {
    assert.match(pipeline, /<script src="money-input\.js"><\/script>/);
  });

  test("Bank yes sends approved_amount, the field api/applications.mjs reads", () => {
    assert.match(panel, /FHMoneyInput\.parseAmount/);
    assert.match(panel, /approved_amount/);
  });

  test("a move onto Funded sends funded_amount, the field the guard wants", () => {
    assert.match(pipeline, /FHMoneyInput\.parseAmount/);
    assert.match(pipeline, /funded_amount/);
    // The guard only fires on this pipeline + stage pair; if either string
    // drifts, the box stops appearing and every Funded drag bounces again.
    assert.match(pipeline, /funding_card_stacking/);
  });

  test("neither screen sends a zero when the box is empty", () => {
    // parseAmount is the only path to the field, and it never returns ok on a
    // blank — so a literal `funded_amount: 0` or `|| 0` fallback is the bug.
    assert.ok(!/funded_amount\s*:\s*0\b/.test(pipeline), "pipeline.html hardcodes a zero funded_amount");
    assert.ok(!/approved_amount\s*:\s*0\b/.test(panel), "client-control-panel.html hardcodes a zero approved_amount");
  });
});

/* ── APPROVAL AND AMOUNT ARE TWO SEPARATE MOMENTS (owner-set 2026-08-29) ─────
   A bank can say yes before anyone knows the limit — the fulfillment team has
   to ask the client or wait for the bank's approval email — so "Bank yes" with
   an empty amount box must SAVE. These pin the three halves of that rule that
   can each be silently undone by a one-line edit. */
describe("Bank yes saves with no amount, and the missing amount stays visible", () => {
  const panel = fs.readFileSync(PANEL, "utf8");
  const pipeline = fs.readFileSync(PIPELINE, "utf8");

  test("an empty box only skips the amount — it does not refuse the save", () => {
    // The guard reads the typed value FIRST and only parses a non-empty one.
    // If this ever becomes `if (status === "Approved") { parse... }` again, a
    // blank box goes back to refusing and the two moments collapse into one.
    assert.match(panel, /status === "Approved" && typed !== ""/,
      "the amount is parsed only when something was actually typed");
    assert.ok(!/if \(status === "Approved"\) \{\s*\n\s*if \(!window\.FHMoneyInput/.test(panel),
      "a bare Approved branch would refuse an empty box again");
  });

  test("a wrong amount is still refused — a typo is not an unknown", () => {
    assert.match(panel, /FHMoneyInput\.parseAmount\(typed\)/);
    assert.match(panel, /if \(!parsed\.ok\)/);
  });

  test("the amount can be filled in later: the box is painted back from what is saved", () => {
    // The screen reads the application rows, not just the named plays, and puts
    // the saved dollars back in the same box someone types into.
    assert.match(panel, /pack && pack\.applications/,
      "the panel must read back the saved applications");
    assert.match(panel, /data-amount-lender-id/);
    assert.match(panel, /amountForBox/);
  });

  test("an approval with no amount is marked, per row and as a count", () => {
    assert.match(panel, /isWaitingOnAmount/);
    assert.match(panel, /fh-funding-amounts-waiting/);
    assert.match(panel, /still waiting on (its|their) dollar amount/);
    assert.match(panel, /data-amount-needed-lender-id/);
  });

  test("the board says it too, and only on an explicit true", () => {
    // A reply that never carried the key is not evidence of a clean file.
    assert.match(pipeline, /c\.approval_amount_missing === true/);
    assert.match(pipeline, /c-needs-amount/);
  });

  test("nothing coalesces an unknown amount to zero on either screen", () => {
    assert.ok(!/approved_amount\s*\|\|\s*0/.test(panel));
    assert.ok(!/approval_amount_missing\s*\|\|\s*0/.test(pipeline));
  });
});
