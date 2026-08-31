/* Pins the Repair desk tab in public/app/inquiry-remover.html for WS-E.
 * Spec §10 E1 / E2 / E3 — structure only (no live browser here).
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCREEN = path.resolve(HERE, "../../public/app/inquiry-remover.html");
const HTML = fs.readFileSync(SCREEN, "utf8");

/* reloadPath — the body of loadRepairDesk(), which runs again after every Send,
 * Stage, Enroll and drawer Send. Sliced rather than parsed because there is no
 * JS parser in this suite; the two markers are stable strings the screen keeps
 * on purpose. */
function reloadPath() {
  const a = HTML.indexOf("function loadRepairDesk() {");
  const b = HTML.indexOf("window.loadRepairDesk = loadRepairDesk;");
  assert.ok(a !== -1 && b > a, "loadRepairDesk markers missing");
  return HTML.slice(a, b);
}

function slice(from, to) {
  const a = HTML.indexOf(from);
  assert.ok(a !== -1, `missing: ${from}`);
  const b = HTML.indexOf(to, a + from.length);
  assert.ok(b > a, `missing: ${to}`);
  return HTML.slice(a, b);
}

function occurrences(needle, haystack = HTML) {
  return haystack.split(needle).length - 1;
}

function repairPaneSlice() {
  const a = HTML.indexOf('id="pane-repair"');
  const b = HTML.indexOf("</main>");
  assert.ok(a !== -1 && b > a, "repair pane markers missing");
  return HTML.slice(a, b);
}

function loadLens() {
  const begin = "/* FH-REPAIR-LENS-BEGIN";
  const end = "/* FH-REPAIR-LENS-END */";
  const a = HTML.indexOf(begin);
  const b = HTML.indexOf(end);
  assert.ok(a !== -1 && b > a, "FHRepairLens markers missing");
  const sandbox = { window: {} };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(HTML.slice(a, b), sandbox, { filename: SCREEN + "#FHRepairLens" });
  return sandbox.window.FHRepairLens;
}

describe("Repair desk screen — E1 four states", () => {
  test("tiles start on em-dash and include Trial ending", () => {
    assert.match(HTML, /id="repairNeedMe">—</);
    assert.match(HTML, /id="repairReady">—</);
    assert.match(HTML, /id="repairWaiting">—</);
    assert.match(HTML, /id="repairStalled">—</);
    assert.match(HTML, /id="repairTrial">—</);
    assert.match(HTML, /Trial ending/);
  });

  test("empty and error copy match the wireframe contract", () => {
    assert.match(HTML, /No repair clients yet\./);
    assert.match(HTML, /Couldn\\'t load|Couldn't load/);
    assert.match(HTML, /id="repairRetry"|repairRetry/);
  });

  test("table columns are Client | Program | Round | Stage | Needs | Due", () => {
    const pane = repairPaneSlice();
    assert.match(pane, /<th>Client<\/th>/);
    assert.match(pane, /<th>Program<\/th>/);
    assert.match(pane, /<th>Round<\/th>/);
    assert.match(pane, /<th>Stage<\/th>/);
    assert.match(pane, /<th>Needs<\/th>/);
    assert.match(pane, /<th>Due<\/th>/);
  });
});

describe("Repair desk screen — E2 tile filters", () => {
  test("each tile is a pressable filter with aria-pressed", () => {
    for (const key of ["need", "ready", "wait", "stuck", "trial"]) {
      assert.match(
        HTML,
        new RegExp('role="button"[^>]*data-filter="' + key + '"|data-filter="' + key + '"[^>]*role="button"')
      );
      assert.match(HTML, new RegExp('data-filter="' + key + '"[^>]*aria-pressed="false"|aria-pressed="false"[^>]*data-filter="' + key + '"'));
    }
  });
});

describe("Repair desk screen — E3 expand, soft pull, no dollars", () => {
  test("row expand, letter drawer, and PULL soft-pull modal exist", () => {
    assert.match(HTML, /repair-expand|toggleRepairRow/);
    assert.match(HTML, /id="repairLetterDrawer"/);
    assert.match(HTML, /id="repairPullModal"/);
    assert.match(HTML, /Type <b>PULL<\/b> to confirm|Type PULL/);
    assert.match(HTML, /id="repairPullGo"/);
    assert.match(HTML, /data-act="repair-stage"/);
    assert.match(HTML, /data-act="repair-send"/);
    assert.match(HTML, /no_authorization:\s*"This client has no signed repair agreement on file\."/);
    assert.match(HTML, /out\.message \|\| out\.reason \|\| out\.error/);
    assert.match(HTML, /Clean personal info/);
    assert.match(HTML, /data-act="repair-enroll"/);
  });

  test("no dollar amounts render in the Repair tab markup or lens helpers", () => {
    const pane = repairPaneSlice();
    assert.ok(!/\$/.test(pane), "Repair pane must not show $ amounts (§2.11)");
    const lens = HTML.slice(
      HTML.indexOf("/* FH-REPAIR-LENS-BEGIN"),
      HTML.indexOf("/* FH-REPAIR-LENS-END */")
    );
    assert.ok(!/\$/.test(lens), "inline FHRepairLens must not invent $ amounts");
  });

  test("the desk's one-time listeners are bound OUTSIDE the reload path", () => {
    /* loadRepairDesk() runs again after every Send, Stage, Enroll and drawer
     * Send. When these lived inside it, each reload stacked a second listener
     * on the same element and never removed the first — so one click on a tile
     * ran the toggle twice and the filter switched straight back off. The
     * browser proof is e2e/specialist-desk.spec.mjs; this is the source pin
     * that stops them being moved back in. */
    const reload = reloadPath();
    for (const needle of [
      "[data-repair-close-letter]",
      "[data-repair-close-pull]",
      'getElementById("repairPullInput")',
      'getElementById("repairPullGo")',
      'document.addEventListener("keydown"',
      "filterTiles.forEach"
    ]) {
      assert.ok(
        !reload.includes(needle),
        `${needle} is bound inside loadRepairDesk() — it will stack a duplicate listener on every reload`
      );
    }
    /* And exactly one of each exists in the repair desk block at all. Scoped to
     * that block because the inquiry queue above has its own applyFilter() for
     * the bureau chips, which is a different function with the same name. */
    const desk = slice("(function repairDesk() {", "window.loadRepairDesk = loadRepairDesk;");
    assert.equal(occurrences('document.addEventListener("keydown"', desk), 1);
    assert.equal(occurrences("function applyFilter(", desk), 1);
    assert.equal(occurrences("function closeLetterDrawer(", desk), 1);
    assert.equal(occurrences("function runSoftPull(", desk), 1);
  });

  test("the soft pull reads every answer instead of dropping it", () => {
    const fn = slice("function runSoftPull()", "function applyFilter(");
    // The exact shape of the bug: three POSTs, both arms discarded.
    assert.ok(
      !/\.then\(function \(\) \{ next\(\); \}\)\.catch\(function \(\) \{ next\(\); \}\)/.test(fn),
      "runSoftPull throws its answers away again"
    );
    assert.match(fn, /FHData\.write\("\/api\/finance\/crs-pull"/);
    assert.match(fn, /if \(res && res\.ok\) \{ next\(\); return; \}/);
    assert.match(fn, /FHData\.explain\(res, PULL_WHAT\)/);
    assert.match(fn, /showErr\(said\)/);
    // No hand-written failure sentence: the wording comes from FHData.
    assert.ok(
      !/showErr\("(?!The credit pull could not start)/.test(fn),
      "runSoftPull invents its own error copy instead of reusing FHData.explain's"
    );
  });

  test("Soft pull and Clean personal info do not render for a role the server refuses", () => {
    /* docs/UI-STANDARDS.md §5 — no control renders for a role that lacks
     * permission. A button that renders and 403s is the thing that forbids. */
    assert.match(HTML, /mayPullCredit\(\) \? '<button type="button" data-act="repair-pull">/);
    assert.match(HTML, /mayErase\(\) \? '<button type="button" data-act="repair-clean">/);
    assert.match(HTML, /function mayPullCredit\(\) \{ return CRS_PULL_ROLES\.indexOf\(viewerRole\) !== -1; \}/);
    assert.match(HTML, /function mayErase\(\) \{ return ERASURE_ROLES\.indexOf\(viewerRole\) !== -1; \}/);
    // Send, Stage and Enroll are not role-gated and must keep rendering.
    assert.match(HTML, /'<button type="button" data-act="repair-enroll">Enroll<\/button>'/);
  });

  test("the screen's role lists are the server's role lists", () => {
    /* The UI half of a gate drifting from the server half is how a button comes
     * back that only ever 403s. Read both handlers and compare. */
    const crs = fs.readFileSync(path.resolve(HERE, "../../api/finance/crs-pull.mjs"), "utf8");
    const erasure = fs.readFileSync(path.resolve(HERE, "../../api/privacy/erasure.mjs"), "utf8");

    const roles = (src, name) => {
      const m = src.match(new RegExp(name + "\\s*=\\s*new Set\\(\\[([^\\]]*)\\]\\)"));
      assert.ok(m, `${name} not found`);
      return m[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean).sort();
    };
    const screenRoles = (name) => {
      const m = HTML.match(new RegExp("var " + name + " = \\[([^\\]]*)\\]"));
      assert.ok(m, `${name} not found in the screen`);
      return m[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean).sort();
    };

    assert.deepEqual(screenRoles("CRS_PULL_ROLES"), roles(crs, "CRS_PULL_ROLES"));
    assert.deepEqual(screenRoles("ERASURE_ROLES"), roles(erasure, "ERASURE_ROLES"));

    // The decision itself, pinned: the Specialist does not order credit pulls.
    assert.ok(!screenRoles("CRS_PULL_ROLES").includes("inquiry_specialist"));
    assert.ok(!roles(crs, "CRS_PULL_ROLES").includes("inquiry_specialist"));
  });

  test("window.FHRepairLens exposes deriveChip, dueWords, roundLabel, tileSets, warningDots, timelineLine", () => {
    const L = loadLens();
    assert.equal(typeof L.deriveChip, "function");
    assert.equal(typeof L.dueWords, "function");
    assert.equal(typeof L.roundLabel, "function");
    assert.equal(typeof L.tileSets, "function");
    assert.equal(typeof L.warningDots, "function");
    assert.equal(typeof L.timelineLine, "function");
    assert.equal(L.deriveChip({ authorization_ok: false }).key, "needs_agreement");
    assert.equal(L.roundLabel({ round: "R1", rounds_cap: 2 }), "1 / 2");
  });
});
