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
