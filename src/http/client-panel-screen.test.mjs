/* Tests for public/app/client-control-panel.html's two load-bearing decisions,
 * plus the one rule it has to share with public/app/pipeline.html.
 *
 * COMPLIANCE REVIEW REQUIRED — the first describe below is compliance GATE A
 * as it reaches the screen. Gate A says a client with no recorded consent is
 * NEVER shown "Pull CRS". src/fulfillment/next-action.mjs enforces that in the
 * derivation, but the screen used to undo it: when the derivation came back
 * degraded (which is exactly what a consent read failing produces), the page
 * painted custom_fields.employee_next_action into the big Next Action slot,
 * and that stored string is written without any consent check by
 * src/workflows/s-06-post-call-funding-purchased.mjs:42 and
 * src/workflows/c-05-pre-funding-review.mjs:44 — both of them the literal
 * "Pull CRS". These tests fail if that comes back.
 *
 * WHY IT LIVES HERE. package.json's test glob is "src/**" and "scripts/**", so
 * a test under api/ or public/ is silently never collected (CLAUDE.md §12).
 * The decisions are pulled out of the page between the FH-CCP-BEGIN/END
 * markers and run with no DOM, the same technique
 * src/http/pipeline-screen.test.mjs uses on that page's FH-LENS block.
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { sanitizeBlockerLabels } from "../fulfillment/next-action.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PANEL = path.resolve(HERE, "../../public/app/client-control-panel.html");
const PIPELINE = path.resolve(HERE, "../../public/app/pipeline.html");
const PANEL_HTML = fs.readFileSync(PANEL, "utf8");
const PIPELINE_HTML = fs.readFileSync(PIPELINE, "utf8");

function runBlock(html, file, begin, end, pick) {
  const a = html.indexOf(begin);
  const b = html.indexOf(end);
  assert.ok(a !== -1 && b > a, "the " + begin.trim() + " markers are gone from " + file);
  const sandbox = { window: {} };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  // From `a`, not past it: FH-CCP-BEGIN opens a block comment that closes
  // further down, so cutting the marker off would leave dangling text.
  vm.runInContext(html.slice(a, b), sandbox, { filename: file + "#" + begin.trim() });
  const out = pick(sandbox.window);
  assert.ok(out, file + " stopped exposing its tested block");
  return out;
}

const loadPanel = () =>
  runBlock(PANEL_HTML, PANEL, "/* FH-CCP-BEGIN", "/* FH-CCP-END */", (w) => w.FHClientPanel);

const loadLens = () =>
  runBlock(PIPELINE_HTML, PIPELINE, "/* FH-LENS-BEGIN */", "/* FH-LENS-END */", (w) => w.FHFulfillmentLens);

/* The shape GET /api/dashboard/client sends when the derivation could not be
   worked out. deriveNextAction() never returns a label beside degraded:true —
   see the guards at src/fulfillment/next-action.mjs:598-608. */
const DEGRADED = { next_action: null, active_blockers: [], funding_round: null, degraded: true };
const STORED_PULL = { employee_next_action: "Pull CRS" };

/* ────────────────────────────────────────────────────────────────────────────
   GATE A ON SCREEN
   ──────────────────────────────────────────────────────────────────────────── */

describe("client-control-panel.html — the big Next Action slot never carries stored text", () => {

  test("it loads and exposes the two decisions", () => {
    const P = loadPanel();
    assert.equal(typeof P.money, "function");
    assert.equal(typeof P.nextAction, "function");
  });

  test("GATE A: a degraded answer carrying a stored 'Pull CRS' must not put it in the big slot", () => {
    const P = loadPanel();
    const out = P.nextAction(DEGRADED, STORED_PULL);
    assert.notEqual(out.main, "Pull CRS",
      "the compliance leak is back: a client whose consent could not be established " +
      "is being told to pull their credit");
    assert.ok(!/pull crs/i.test(out.main),
      "the big slot must not contain the stored instruction in any form: " + out.main);
  });

  test("GATE A: no derivation sent at all is the same refusal", () => {
    const P = loadPanel();
    for (const fx of [null, undefined]) {
      const out = P.nextAction(fx, STORED_PULL);
      assert.ok(!/pull crs/i.test(out.main),
        "with nothing worked out the big slot fell back to the stored instruction");
    }
  });

  test("GATE A: a broken payload cannot smuggle the stored text through either", () => {
    const P = loadPanel();
    for (const fx of [{}, { degraded: true }, { degraded: "yes" }, "degraded", 7, []]) {
      const out = P.nextAction(fx, STORED_PULL);
      assert.ok(!/pull crs/i.test(out.main),
        "a payload of " + JSON.stringify(fx) + " leaked the stored instruction into the big slot");
    }
  });

  test("nothing worked out says so in plain words — never blank, never a bare dash", () => {
    const P = loadPanel();
    for (const fx of [null, undefined, DEGRADED]) {
      const out = P.nextAction(fx, STORED_PULL);
      assert.equal(out.main, P.NOT_WORKED_OUT);
      assert.ok(out.main.trim().length > 0, "the big slot went blank");
      assert.notEqual(out.main.trim(), "—", "a bare dash with no explanation is not an answer");
    }
  });

  test("the stored value is kept, below, labelled as saved rather than as the instruction", () => {
    const P = loadPanel();
    const out = P.nextAction(DEGRADED, STORED_PULL);
    assert.ok(out.saved.indexOf("Pull CRS") !== -1,
      "staff lost the information that used to be on screen");
    assert.ok(/saved on the record/i.test(out.saved),
      "the saved line must say what it is, or it reads as an instruction again: " + out.saved);
    assert.notEqual(out.saved, out.main);
  });

  test("a worked-out step is what the big slot shows", () => {
    const P = loadPanel();
    const out = P.nextAction(
      { next_action: { key: "get_consent", label: "Get Consent", why: "no consent on file" },
        active_blockers: [], funding_round: null, degraded: false },
      STORED_PULL
    );
    assert.equal(out.main, "Get Consent");
    assert.ok(out.saved.indexOf("Pull CRS") !== -1, "the saved value still has to be visible somewhere");
  });

  /* This slot used to go blank here, and the page painted the blank as an em
     dash. Beside a "Saved on the record: Pull CRS" line that read as a heading,
     a dash, and then the forbidden words — the worst of the three renderings.
     Chris asked for derived truth "or plainly says none applies", so it says
     so in words. */
  const WORKED_NO_STEP =
    { next_action: null, active_blockers: [], funding_round: null, degraded: false };

  test("a worked-out answer with no step says none applies, in words — never blank, never a bare dash", () => {
    const P = loadPanel();
    const out = P.nextAction(WORKED_NO_STEP, {});
    assert.equal(out.main, P.NONE_APPLIES);
    assert.notEqual(out.main, "", "the big slot went blank and the page painted a bare dash");
    assert.ok(out.main.trim().length > 0, "the big slot went blank");
    assert.notEqual(out.main.trim(), "—", "a bare dash with no explanation is not an answer");
    assert.equal(out.saved, "");
  });

  test("none applies is still not an invitation to do the saved value", () => {
    const P = loadPanel();
    const out = P.nextAction(WORKED_NO_STEP, STORED_PULL);
    assert.equal(out.main, P.NONE_APPLIES);
    assert.ok(!/pull crs/i.test(out.main), "the big slot leaked the stored instruction: " + out.main);
    assert.ok(/saved on the record/i.test(out.saved),
      "the stored value must stay, labelled as what is on the record: " + out.saved);
  });

  /* The three answers have to be three different sentences. Two of them
     reading the same is how "we could not work it out" gets mistaken for
     "there is nothing to do", which are opposite instructions to staff. */
  test("the three cases are three different sentences, each of them plain words", () => {
    const P = loadPanel();
    const step = P.nextAction(
      { next_action: { key: "get_consent", label: "Get Consent" },
        active_blockers: [], funding_round: null, degraded: false }, {}).main;
    const none = P.nextAction(WORKED_NO_STEP, {}).main;
    const notYet = P.nextAction(DEGRADED, {}).main;
    assert.equal(step, "Get Consent");
    assert.equal(none, P.NONE_APPLIES);
    assert.equal(notYet, P.NOT_WORKED_OUT);
    assert.equal(new Set([step, none, notYet]).size, 3,
      "two of the three answers read the same: " + JSON.stringify([step, none, notYet]));
    for (const words of [none, notYet]) {
      assert.ok(/^[A-Z]/.test(words) && /[a-z]{3}/.test(words) && words.trim() !== "—",
        "this has to read as a sentence a non-coder understands, not a symbol: " + JSON.stringify(words));
    }
  });

  test("no saved line when there is nothing saved, or when it matches the worked-out step", () => {
    const P = loadPanel();
    const worked = { next_action: { key: "get_consent", label: "Get Consent" },
      active_blockers: [], funding_round: null, degraded: false };
    assert.equal(P.nextAction(worked, {}).saved, "");
    assert.equal(P.nextAction(worked, null).saved, "");
    assert.equal(P.nextAction(worked, { employee_next_action: "   " }).saved, "");
    assert.equal(P.nextAction(worked, { employee_next_action: "Get Consent" }).saved, "",
      "the same words twice is noise, not information");
  });

  test("it never throws, whatever it is handed", () => {
    const P = loadPanel();
    const nasty = { get employee_next_action() { throw new Error("boom"); } };
    for (const args of [[undefined, undefined], [DEGRADED, nasty], [nasty, nasty], [0, ""], [[], []]]) {
      const out = P.nextAction(args[0], args[1]);
      assert.equal(typeof out.main, "string");
      assert.equal(typeof out.saved, "string");
      assert.ok(!/pull crs/i.test(out.main));
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   THE SAME PAGE, THE SAME SOURCE — the leak has to stay shut in the page
   itself, not only in the block pulled out of it.
   ──────────────────────────────────────────────────────────────────────────── */

describe("client-control-panel.html — the page wires both slots to the guarded rule", () => {

  test("both big slots are painted by paintNextAction and nothing else", () => {
    for (const id of ["ccp-next-action", "ccp-cp-action"]) {
      const painted = new RegExp('paintNextAction\\("' + id + '"');
      assert.match(PANEL_HTML, painted, id + " is no longer painted through the guarded rule");
      const direct = new RegExp('setText\\("' + id + '"');
      assert.ok(!direct.test(PANEL_HTML),
        id + " is being set directly again, which is how the stored text got in");
    }
  });

  /* A typo in one of these ids would fail silently in the browser: the saved
     line would simply never appear and nobody would know the value was lost. */
  test("each big slot has a saved line under it, and the class it needs", () => {
    for (const pair of [["ccp-next-action", "ccp-saved"], ["ccp-cp-action", "ccp-cp-saved"]]) {
      assert.match(PANEL_HTML, new RegExp('id="' + pair[0] + '"'), pair[0] + " is gone from the page");
      assert.match(PANEL_HTML, new RegExp('class="na-saved" id="' + pair[1] + '" hidden'),
        pair[1] + " is missing, so the saved value would vanish instead of moving below");
      assert.match(PANEL_HTML, new RegExp('paintNextAction\\("' + pair[0] + '", "' + pair[1] + '"'),
        pair[0] + " and " + pair[1] + " are no longer painted together");
    }
    assert.match(PANEL_HTML, /\.na-saved\{/, "the saved line lost its styling and would read as body text");
  });

  test("employee_next_action is read in exactly one place — the saved line", () => {
    // Block comments are stripped first: this file explains the rule in prose
    // several times, and prose is not a read.
    const code = PANEL_HTML.replace(/\/\*[\s\S]*?\*\//g, "");
    const hits = code.split("\n").filter((line) => /\.employee_next_action\b/.test(line));
    assert.equal(hits.length, 1,
      "the stored next action is read in " + hits.length + " places; it must only feed the " +
      "labelled saved line. Found: " + JSON.stringify(hits));
    assert.match(hits[0], /stored =/,
      "employee_next_action is being used for something other than the saved line");
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   GATE A IN THE PRE-EXISTING BLOCKERS PANEL — the one that was still leaking

   THE DEFECT THIS CLOSES. Gate A was enforced inside the derivation, so the
   new control block below was safe. The Blockers panel at the TOP of this page
   is older and is painted straight from the endpoint's raw `open_blockers`
   array — paintBlockers(d.open_blockers, hold) — and so is the new block's
   fallback when no derivation arrives. Both printed the task title verbatim.
   On a real client with no recorded permission the top panel read "Funding
   intake — pull CRS" while the block below it read "waiting on written
   permission": two panels, one screen, contradicting each other.

   Patching each panel is what failed three times. The fix is that the API
   never emits the raw words — api/dashboard/client.mjs runs
   sanitizeBlockerLabels() on the array it sends. These tests paint the REAL
   pre-existing panel function, lifted out of the page, with the REAL sanitizer
   output, so the panel is proved safe without the page being touched at all.
   That the endpoint actually runs the sanitizer is proved in
   src/http/dashboard-next-action.test.mjs.
   ──────────────────────────────────────────────────────────────────────────── */

/* The page's own paintBlockers(), lifted out by source. Its two helpers ($ and
   dash) and `document` are supplied below, so this paints the page's code and
   not a copy of it — reword the function in the page and this test paints the
   new wording. */
function paintBlockersSource() {
  const start = PANEL_HTML.indexOf("  function paintBlockers(");
  assert.ok(start !== -1, "paintBlockers is gone from client-control-panel.html");
  const end = PANEL_HTML.indexOf("\n  }\n", start);
  assert.ok(end > start, "could not find the end of paintBlockers");
  return PANEL_HTML.slice(start, end + 4);
}

/* The smallest DOM paintBlockers touches: textContent, className, hidden and
   appendChild. Setting textContent to "" empties a node, which is how the
   panel clears itself between paints. */
function fakeNode() {
  const node = {
    className: "", hidden: false, children: [], _text: "",
    appendChild(child) { node.children.push(child); return child; },
    get textContent() { return node._text; },
    set textContent(v) {
      node._text = String(v);
      if (node._text === "") node.children.length = 0;
    }
  };
  return node;
}

const allText = (node) =>
  [node.textContent].concat(node.children.map(allText)).filter(Boolean).join(" | ");

/** Runs the page's paintBlockers over `blockers` and reports what a human
 *  would read. The rows are stringified into the script the same way they
 *  reach the browser — as JSON off the endpoint. */
function paintPanel(blockers, holdReason = "") {
  const list = fakeNode();
  const why = fakeNode();
  const sandbox = {
    document: { createElement: () => fakeNode() },
    $: (id) => (id === "ccp-blocker-list" ? list : id === "ccp-why-label" ? why : null),
    // The page's own dash(), which paintBlockers calls on every label.
    dash: (v) => {
      if (v == null || v === "") return "—";
      const s = String(v).trim();
      return s || "—";
    }
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(
    paintBlockersSource() +
    "\npaintBlockers(" + JSON.stringify(blockers) + ", " + JSON.stringify(holdReason) + ");",
    sandbox,
    { filename: PANEL + "#paintBlockers" }
  );
  return {
    cards: list.children.map((card) => ({
      label: card.children[0] ? card.children[0].textContent : "",
      detail: card.children[1] ? card.children[1].textContent : ""
    })),
    text: allText(list)
  };
}

describe("client-control-panel.html — the pre-existing Blockers panel", () => {

  // Exactly the row openBlockers() builds from the one workflow that raises a
  // pull-credit task (src/workflows/s-06-post-call-funding-purchased.mjs:25).
  const pullTask = () => ({
    kind: "task", severity: "normal",
    label: "Funding intake — pull CRS",
    detail: "owned by closer",
    source: "s-06-post-call-funding-purchased",
    id: "t9"
  });

  test("it paints whatever it is handed — which is why the words must be right before they arrive", () => {
    // Not a complaint about the panel. This is the reason the fix belongs in
    // the API: the panel has no consent verdict and cannot make this call.
    const out = paintPanel([pullTask()]);
    assert.equal(out.cards[0].label, "Funding intake — pull CRS");
  });

  test("GATE A: a no-consent client's blocker reads as waiting on permission, never as pull credit", () => {
    const out = paintPanel(sanitizeBlockerLabels([pullTask()], { consentValid: false }));
    assert.equal(out.cards.length, 1, "the blocker was dropped — hiding it is a lie by omission");
    assert.equal(out.cards[0].label, "Funding intake — waiting on written permission");
    assert.ok(!/pull/i.test(out.text),
      "the pre-existing panel still shows a client with no written permission the words " +
      "'pull CRS': " + out.text);
    assert.equal(out.cards[0].detail, "owned by closer", "the blocker lost the detail staff act on");
  });

  test("GATE A: a consent read that failed says we could not check", () => {
    const out = paintPanel(sanitizeBlockerLabels([pullTask()], { consentValid: null }));
    assert.equal(out.cards[0].label, "Funding intake — we could not check written permission");
    assert.ok(!/pull/i.test(out.text));
    assert.ok(!/waiting on/i.test(out.text),
      "we told staff they are waiting on permission, and we never managed to look: " + out.text);
  });

  test("live permission: the real task title is painted byte for byte", () => {
    const out = paintPanel(sanitizeBlockerLabels([pullTask()], { consentValid: true }));
    assert.equal(out.cards[0].label, "Funding intake — pull CRS",
      "with written permission on file there is nothing to keep from anyone");
  });

  test("nothing else is touched — an ordinary blocker paints as written", () => {
    const ordinary = { kind: "task", severity: "normal", label: "Chase docs",
                       detail: "owned by funding_advisor", source: "f-02-doc-chase", id: "t1" };
    const out = paintPanel(sanitizeBlockerLabels([ordinary], { consentValid: false }));
    assert.equal(out.cards[0].label, "Chase docs");
    assert.equal(out.cards[0].detail, "owned by funding_advisor");
  });

  /* The wiring is the load-bearing half. If either route is ever pointed at a
     different array, the sanitizer at the endpoint stops covering it. */
  test("both blocker routes read open_blockers, which is the array the API sanitizes", () => {
    const code = PANEL_HTML.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.match(code, /paintBlockers\(d\.open_blockers, hold\)/,
      "the pre-existing Blockers panel is being fed something other than the sanitized array");
    assert.match(code, /rows = d\.open_blockers\.slice\(\)/,
      "the control block's fallback is being fed something other than the sanitized array");
    const reads = code.split("\n").filter((line) => /\.open_blockers\b/.test(line));
    assert.equal(reads.length, 2,
      "open_blockers is read in " + reads.length + " places on this page; every one of them " +
      "has to be the array api/dashboard/client.mjs sanitizes. Found: " + JSON.stringify(reads));
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   MONEY — ONE RULE, BOTH SCREENS
   ──────────────────────────────────────────────────────────────────────────── */

describe("client-control-panel.html — money is whole dollars", () => {

  test("a numeric string from a numeric(14,2) column is dollars", () => {
    const P = loadPanel();
    assert.equal(P.money("50000.00"), "$50,000");
    assert.equal(P.money("47500.00"), "$47,500");
  });

  test("a number out of custom_fields is dollars too, not cents", () => {
    const P = loadPanel();
    assert.equal(P.money(50000), "$50,000");
    assert.equal(P.money(80000), "$80,000");
  });

  test("unknown is an em dash — never 0, never a guess", () => {
    const P = loadPanel();
    for (const v of [null, undefined, "", "   ", "unknown", {}, [], NaN, true, false, "1,000", "$5"]) {
      assert.equal(P.money(v), "—", "unknown money must not become a number: " + JSON.stringify(v));
    }
  });

  test("a recorded zero is a fact and prints as $0", () => {
    const P = loadPanel();
    assert.equal(P.money(0), "$0");
    assert.equal(P.money("0.00"), "$0");
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   THE TILES THAT WERE ALREADY HERE KEEP THE RULE THEY ALREADY HAD

   Prequal, Total Approved and the two income-per-year lines are not part of
   the fulfillment work. The shared money() rule above was briefly wired to
   them, which changed what they printed: a recorded zero became "$0" where it
   had been a dash, and a negative became "$-500". tileMoney() is the rule
   those three displays shipped with on main, restored byte for byte.

   Whether a recorded zero on those tiles ought to read "$0" or a dash is
   Chris's call. Until he makes it they read exactly as they read on main.
   ──────────────────────────────────────────────────────────────────────────── */

describe("client-control-panel.html — the tiles that were already here are unchanged", () => {

  /* main's rule, copied from `git show main:public/app/client-control-panel.html`
     (the money() at line 724 there). If tileMoney ever stops agreeing with
     this, a tile nobody asked to change has changed. */
  const mainRule = (n) => {
    if (n == null || n === "") return "—";
    const v = Number(n);
    if (!isFinite(v) || v <= 0) return "—";
    return "$" + Math.round(v).toLocaleString("en-US");
  };

  test("tileMoney matches main's rule on every value, including the awkward ones", () => {
    const P = loadPanel();
    const vals = [null, undefined, "", "   ", 0, "0", "0.00", -1, -500, "-500", "-500.00", 1,
      0.4, 0.6, 50000, "50000.00", "47500.00", 80000, NaN, Infinity, -Infinity, true, false,
      [], [5], {}, "abc", "1e3", " 42 ", "42px"];
    for (const v of vals) {
      assert.equal(P.tileMoney(v), mainRule(v),
        "a tile nobody asked to change has changed for " + JSON.stringify(String(v)));
    }
  });

  test("the two regressions are gone: no $0 and no $-500 on these tiles", () => {
    const P = loadPanel();
    assert.equal(P.tileMoney(0), "—", "a recorded zero used to be a dash on these tiles");
    assert.equal(P.tileMoney("0.00"), "—");
    assert.equal(P.tileMoney(-500), "—", "$-500 is not something to put in front of staff");
    assert.equal(P.tileMoney("-500.00"), "—");
    assert.equal(P.tileMoney("50000.00"), "$50,000", "the tiles still show real money");
  });

  /* The wiring is the load-bearing half: the right rule has to reach the right
     display. Comments are stripped first — this file explains both rules in
     prose and prose is not a call. */
  test("the old tiles use the old rule and the new funding-round amount uses the shared one", () => {
    const code = PANEL_HTML.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.match(code, /var money = FHCP\.tileMoney;/,
      "the tiles that were already here are no longer on main's rule");
    assert.match(code, /var roundMoney = FHCP\.money;/,
      "the shared whole-dollars rule is no longer wired to the new funding-round amount");
    assert.match(code, /setText\("ccp-prequal", money\(prequal\)\)/, "the Prequal tile is wired somewhere new");
    assert.match(code, /var approved = money\(c\.funded_amount\)/, "the Total Approved tile is wired somewhere new");
    assert.match(code, /setText\("ccp-cp-round-amount", roundMoney\(amount\)\)/,
      "the funding-round amount is no longer on the shared rule");
    assert.ok(!/setText\("ccp-cp-round-amount", money\(/.test(code),
      "the funding-round amount fell back onto the old tile rule");
  });
});

describe("the two screens agree about money", () => {

  /* THE DEFECT THIS CLOSES. pipeline.html divided a number by 100 and
     client-control-panel.html did not, so funding_rounds.approved_amount and
     the total_prequal rollup could render as two different numbers on two
     screens. Both are dollars — traced in the comment above each formatter.
     pipeline.html returns null where the panel returns the dash, so null is
     mapped to the dash before comparing. */
  const SAME = [
    "50000.00", "47500.00", "82000.00", "0.00", "1.00", "12.49", "5000000",
    50000, 80000, 0, 12.5, 5000000, 1,
    null, undefined, "", "   ", "unknown", {}, [], NaN, true, false, "1,000", "$5"
  ];

  test("every value formats identically on both screens", () => {
    const P = loadPanel();
    const L = loadLens();
    for (const v of SAME) {
      const panel = P.money(v);
      const lens = L.moneyText(v);
      const pipeline = lens === null ? P.UNKNOWN : lens;
      assert.equal(panel, pipeline,
        "the two screens disagree about " + JSON.stringify(v) +
        ": the client panel says " + panel + " and the pipeline says " + pipeline);
    }
  });

  test("the one value that started this reads $50,000 on both, not $500 on one", () => {
    const P = loadPanel();
    const L = loadLens();
    assert.equal(P.money(50000), "$50,000");
    assert.equal(L.moneyText(50000), "$50,000");
  });

  test("unknown is a dash on both, and 0 is only ever a recorded 0", () => {
    const P = loadPanel();
    const L = loadLens();
    assert.equal(P.money(null), "—");
    assert.equal(L.moneyText(null), null, "the pipeline caller prints the dash from null");
    assert.equal(P.money(0), "$0");
    assert.equal(L.moneyText(0), "$0");
  });
});

describe("the two screens agree about the answer that is not a step", () => {

  /* THE DEFECT THIS CLOSES. The client file said "No step applies right now."
     while the pipeline list said "Not enough information" about the same
     client at the same moment — the list never read the degraded flag, so it
     gave one chip to both answers. Six real clients read that way, Chris's
     repair-only one among them, which made behaviour he signed off look like
     a fault. One client, one answer, whichever screen it is read on. */
  const WORKED_NO_STEP = { next_action: null, active_blockers: [], funding_round: null, next_action_degraded: false };
  const NOT_WORKED = { next_action: null, active_blockers: [], funding_round: null, next_action_degraded: true };
  const PANEL_WORKED_NO_STEP = { next_action: null, active_blockers: [], funding_round: null, degraded: false };

  test("worked out and no step applies: both screens say the same words", () => {
    const P = loadPanel();
    const L = loadLens();
    const panel = P.nextAction(PANEL_WORKED_NO_STEP, {}).main;
    const lens = L.chipOf(WORKED_NO_STEP).label;
    assert.equal(panel, P.NONE_APPLIES);
    assert.equal(lens, panel,
      "the client file says " + JSON.stringify(panel) + " and the list says " + JSON.stringify(lens));
  });

  test("not worked out at all: both screens say the same words", () => {
    const P = loadPanel();
    const L = loadLens();
    const panel = P.nextAction(DEGRADED, {}).main;
    const lens = L.chipOf(NOT_WORKED).label;
    assert.equal(panel, P.NOT_WORKED_OUT);
    assert.equal(lens, panel,
      "the client file says " + JSON.stringify(panel) + " and the list says " + JSON.stringify(lens));
  });

  test("neither screen collapses the two answers into one", () => {
    const P = loadPanel();
    const L = loadLens();
    assert.notEqual(P.NONE_APPLIES, P.NOT_WORKED_OUT);
    assert.notEqual(L.chipOf(WORKED_NO_STEP).key, L.chipOf(NOT_WORKED).key);
    assert.equal(new Set([
      P.nextAction(PANEL_WORKED_NO_STEP, {}).main,
      P.nextAction(DEGRADED, {}).main,
      L.chipOf(WORKED_NO_STEP).label,
      L.chipOf(NOT_WORKED).label
    ]).size, 2, "the four readings should be two answers, each said the same way on both screens");
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   GATE B ON SCREEN — no funding money on a client who did not buy funding

   The funding round in the control panel carries an approved amount, and an
   approved amount is funding-shaped money. src/fulfillment/next-action.mjs
   refuses to hand a round back on any tier outside the three funding tiers —
   the same whitelist, the same helper, that refuses a funding chip. These
   tests keep BOTH screens reading only that gated answer. A raw
   funding_rounds row read here or on pipeline.html would walk around it.
   ──────────────────────────────────────────────────────────────────────────── */

describe("both screens paint only the gated funding round", () => {

  test("the control panel's round block reads the derived round and nothing else", () => {
    const code = PANEL_HTML.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const start = code.indexOf('setText("ccp-cp-round-number"');
    const end = code.indexOf('setText("ccp-cp-round-final"');
    assert.ok(start !== -1 && end > start, "the control panel's funding round block is gone");
    // Walk back to where the block gathers its values.
    const from = code.lastIndexOf("var round =", start);
    assert.ok(from !== -1 && from < start, "the round block no longer starts from a single round value");
    const block = code.slice(from, end);
    assert.match(block, /var round = fx \? fx\.funding_round : null;/,
      "the round block is reading something other than the gated answer");
    for (const raw of ["round_number", "funding_rounds", "latestRound"]) {
      assert.ok(!new RegExp("\\b" + raw + "\\b").test(block),
        "the round block reads the raw " + raw + ", which walks around the tier gate: " + block);
    }
  });

  test("the pipeline lens row builds its round line from the gated answer only", () => {
    const code = PIPELINE_HTML.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const calls = code.split("\n").filter((line) => /L\.roundText\(/.test(line));
    assert.equal(calls.length, 1, "roundText is called in " + calls.length + " places: " + JSON.stringify(calls));
    assert.match(calls[0], /L\.roundText\(client && client\.funding_round\)/,
      "the lens row is feeding roundText something other than the gated answer: " + calls[0]);
    assert.ok(!/roundText\([^)]*funding_rounds/.test(code),
      "the lens row reads a raw funding_rounds row, which walks around the tier gate");
  });

  test("no round means no line and no money on either screen", () => {
    const L = loadLens();
    assert.equal(L.roundText(null), null, "a gated-off round must paint nothing at all");
    assert.equal(L.roundText(undefined), null);
  });
});

test("client-control-panel can save a company birth month/year", () => {
  assert.match(PANEL_HTML, /stamp_incorporated/);
  assert.match(PANEL_HTML, /type = "month"/);
  assert.match(PANEL_HTML, /Age \(months\)/);
});
