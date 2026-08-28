/* T10-02 — the partner Home screen must not print money it made up.
 *
 * WHAT A PARTNER SAW. public/app/partner-galaxy.html is the first screen a
 * partner lands on. Along the bottom sat six labelled tiles:
 *
 *     Cash Collected Today · Funded Today · Close Rate
 *     Show Rate · Movement Today · Cost / Funded Client
 *
 * Every one of them started at zero, and the only thing that ever changed one
 * was a dice roll. A scheduled event called evMoney() picked an amount out of
 * Math.random() — either about three thousand dollars or a multiple of
 * twenty-five hundred on top of eight and a half thousand — labelled it
 * "Deposit paid" or "Round funded", printed that figure over the sky, and flew
 * it into a tile. The strip of captions above the sky called the effect
 * "money landing".
 *
 * A live capture of the screen signed in as a partner recorded its only network
 * reads as /api/auth/session, /api/read/partners, /api/health and
 * /api/org-brand. Not one of them fetches a dollar. Every figure on the screen
 * came from the dice, and nothing on the screen said so.
 *
 * THE OWNER'S RULE, 2026-08-19: wire a tile to real data if the read already
 * exists; if it does not, delete the tile. Never a zero, never a dash, never a
 * "demo" label on a money surface.
 *
 * WHAT WAS DONE. Every endpoint a partner principal can actually reach was
 * checked, and checked twice: it had to admit a partner (not only staff), and
 * it had to be scoped to that one partner (an org-wide staff figure shown to a
 * partner is a different untruth, not a fix). None of the six had such a
 * source. So all six tiles are gone, and so is the flare machinery that fed
 * them. The moving sky stays — the owner objected to invented numbers, not to
 * the animation.
 *
 * HOW THIS TESTS. It reads the shipped file as text, the way
 * src/http/brand-studio-screen.test.mjs does, because what must never come back
 * is a SHAPE of source: a tile with no named source, or a random number reaching
 * a dollar sign. It opens no browser and touches no database, so it runs in the
 * blocking CI job, which runs with no database on purpose.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");

/* The file under test is overridable so the same assertions can be pointed at
   the pre-fix copy to prove they actually go red. Nothing in CI sets it. */
const TARGET = process.env.T10_GALAXY_FILE || path.join(APP, "partner-galaxy.html");
const HTML = fs.readFileSync(TARGET, "utf8");

/* ------------------------------------------------------------------ *
 * Code, not commentary.
 *
 * The comment block at the top of the screen QUOTES the deleted dice roll, on
 * purpose, so the next person reading the file learns what went wrong. A quote
 * of the bug is not the bug. Every check below runs on the script with its
 * comments blanked out — line breaks kept, so a failure still points at a real
 * line number.
 * ------------------------------------------------------------------ */

function inlineScripts(src) {
  const out = [];
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(src)) !== null) out.push(m[1]);
  assert.ok(out.length, "partner-galaxy.html has no inline script at all — test is stale");
  return out;
}

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/^\s*\/\/.*$/gm, (m) => m.replace(/[^\n]/g, " "));
}

const BLOCKS = inlineScripts(HTML);
const RAW_SCRIPT = BLOCKS.join("\n");
const CODE = stripComments(RAW_SCRIPT);

/* ------------------------------------------------------------------ *
 * The two halves of this screen, and why the line between them matters.
 *
 * The canvas — the starfield, the rails, the tiles that used to sit under it —
 * is one self-running block that ASKS THE SERVER FOR NOTHING. It has no fetch
 * in it and never had one. So every figure it could possibly draw is a figure
 * it made up. That is the whole defect in one sentence, and it is why the
 * strictest checks in this file are aimed at that block alone.
 *
 * A separate block lower down DOES read the server, and it is allowed to print
 * a dollar figure, because it has one: the partner's own accrued balance out of
 * /api/read/partners. Holding both blocks to the same rule would either let the
 * canvas invent money or force the honest read to stop reporting it.
 * ------------------------------------------------------------------ */

const CANVAS = stripComments(
  BLOCKS.find((b) => b.includes("FUNDHUB GALAXY")) ||
  assert.fail("the galaxy canvas script is gone from partner-galaxy.html — test is stale")
);

test("the canvas script asks the server for nothing — the premise of this file", () => {
  /* If a read is ever added to the canvas block, the checks below become too
     strict and must be re-thought rather than relaxed in place. Failing here
     says exactly that, instead of failing somewhere confusing. */
  const reads = lines(CANVAS, /\bfetch\s*\(|XMLHttpRequest|FHData\.|EventSource/);
  assert.deepEqual(reads, [],
    "the canvas block now reads the server. Good, possibly — but this file assumes " +
    "it does not, so rewrite the checks below around the new read.");
});

function lines(src, re) {
  return src
    .split("\n")
    .map((line, i) => [i + 1, line])
    .filter(([, line]) => re.test(line))
    .map(([n, line]) => `${n}: ${line.trim()}`);
}

test("the comment stripper really strips — otherwise every check below is theatre", () => {
  /* If this ever fails, the checks under it are reading prose instead of code
     and would pass on a file that prints dice-rolled dollars. */
  const marker = "/* ---------- palette ---------- */";
  assert.ok(RAW_SCRIPT.includes(marker), "the palette comment moved — this canary is stale");
  assert.ok(!CODE.includes("palette"),
    "comments survived the stripper, so the checks below are not reading code");
  assert.equal(RAW_SCRIPT.split("\n").length, CODE.split("\n").length,
    "the stripper changed the line count, so failure messages point at the wrong lines");
});

/* ------------------------------------------------------------------ *
 * 1. No tile without a named source.
 * ------------------------------------------------------------------ */

/* Tiles were plain objects in an array, each with an `id` and a `label`. That
   is the shape this looks for, wherever it is declared and whatever the array
   is called, so renaming KPIS does not slip a tile past. */
const TILE_RE = /\{[^{}]*\bid\s*:\s*['"][a-z0-9_-]+['"][^{}]*\blabel\s*:\s*['"][^'"]+['"][^{}]*\}/gi;

function tiles() {
  return CODE.match(TILE_RE) || [];
}

test("every tile on this screen names the read it comes from", () => {
  /* THE HEART OF IT. A tile may exist only if it can say where its number came
     from. The six that shipped could not, so there are none — and this stays
     the gate the moment somebody adds one back. */
  const undocumented = tiles().filter((t) => !/\bsource\s*:\s*['"]\/api\//.test(t));
  assert.deepEqual(undocumented, [],
    "a tile is on the partner's Home screen with no `source:'/api/...'` naming where " +
    "its value is read from. Either wire it to a partner-scoped read, or delete it. " +
    "Never show a number a partner cannot trace.");
});

test("the six invented tiles are gone by name", () => {
  /* Named individually so a failure says which one came back rather than
     "a tile matched a pattern". */
  const gone = [
    "Cash Collected Today",
    "Funded Today",
    "Close Rate",
    "Show Rate",
    "Movement Today",
    "Cost / Funded Client"
  ];
  const back = gone.filter((label) => CODE.includes(label));
  assert.deepEqual(back, [],
    "these tile labels are back on the partner Home screen. None of them has a " +
    "partner-scoped read behind it — see the audit comment in the file.");
});

test("the machinery that fed the tiles is gone, not merely unused", () => {
  /* bumpKPI was the only writer of a tile value and the only place a dollar
     delta was formatted. Leaving it lying about is how the tiles come back. */
  const ghosts = ["bumpKPI", "fmtK", "drawKPIs", "evMoney"].filter((n) =>
    new RegExp("\\b" + n + "\\b").test(CODE));
  assert.deepEqual(ghosts, [],
    "the tile machinery is still in the file. Dormant today is shipped tomorrow.");
});

/* ------------------------------------------------------------------ *
 * 2. No dice roll may reach a number a partner reads.
 * ------------------------------------------------------------------ */

test("the canvas never builds a dollar amount", () => {
  /* The flares printed '+$' + amount over the sky and the tile deltas printed
     '+$' / '-$' the same way. A dollar sign glued to a value is the exact shape
     that let a dice roll read as a ledger fact. The canvas has no money read, so
     it has no honest reason to compose one. */
  const built = lines(CANVAS, /\$['"]\s*\+|\+\s*['"][^'"]*\$/);
  assert.deepEqual(built, [],
    "the canvas is assembling a dollar amount. It reads no money from anywhere, " +
    "so whatever it prints is invented.");
});

test("the canvas announces no money events", () => {
  /* The two phrases the flares printed, plus the number-grouping call that put
     the comma in "$11,000". The clock on this screen also calls toLocaleString,
     but always with an options object — the bare one-argument form is the one
     that formats a plain number, and that is what is banned here. */
  const words = lines(CANVAS,
    /Deposit paid|Round funded|money landing|toLocaleString\(\s*['"]en-US['"]\s*\)/i);
  assert.deepEqual(words, [],
    "the canvas still announces money events it did not read from anywhere");
});

test("no dice roll feeds a money figure on the canvas", () => {
  /* Drift, twinkle and timing may be random; that is what an animation is. A
     random number that lands in something a partner READS as a figure is the
     defect. This names the variables the dice were assigned to.

     SCOPE, STATED HONESTLY: this checks MONEY-shaped names only. It does NOT
     catch every random-fed number. One survives on purpose and is recorded on
     the board: `n.out += 1 + ((Math.random()*3)|0)` invents a worker's "Total
     events" count. It cannot run today — NODES is initialised empty and nothing
     fills it — so nobody can read it, and rewriting the swarm was out of scope
     for this change. Do not widen this test's name without widening its check. */
  const bad = lines(CANVAS,
    /\b(amt|amount|value|total|cash|revenue|dollars|owed|accrued|rate)\b\s*=\s*[^;]*Math\.random/i);
  assert.deepEqual(bad, [],
    "a random number is being assigned to something that reads as a figure");

  /* Belt and braces: the exact shape of the deleted funding roll. */
  assert.ok(!/Math\.round\(Math\.random\(\)\s*\*\s*\d+\)\s*\*\s*\d{3,}/.test(CANVAS),
    "the dice-rolled funding amount is back: a random multiplied up into thousands");
  assert.ok(!/\d{3,}\s*\+\s*\(?\s*Math\.random\(\)\s*<\s*0?\.\d+\s*\?/.test(CANVAS),
    "the dice-rolled deposit amount is back");
});

test("the one dollar figure left on this screen is read, not invented", () => {
  /* Deleting six invented figures is only half the job. The screen does print
     one real money figure — the partner's own accrued balance — and it must keep
     coming from the server. If this read is ever dropped, the screen would be
     honest and empty, which is fine, but nobody should discover that by
     accident: this test is what makes it a decision. */
  const reader = BLOCKS.find((b) => b.includes("FHData.partners"));
  assert.ok(reader,
    "the partner census read is gone. Nothing on this screen reads money any more — " +
    "if that was deliberate, delete this test and say so on the board.");
  const code = stripComments(reader);
  assert.match(code, /balance_accrued/,
    "the accrued figure is no longer taken from the server's balance_accrued column");
  assert.match(code, /accrued/,
    "the figure is printed without saying it is an accrued balance");
});

/* ------------------------------------------------------------------ *
 * 3. The captions must match what is actually on screen.
 * ------------------------------------------------------------------ */

test("the legend no longer calls anything on the sky money", () => {
  /* The caption strip is markup, not script, so it is checked against the raw
     file. It read "flare = money landing" while nothing on the screen was money. */
  const legend = /<div class="legend">([\s\S]*?)<\/div>/.exec(HTML);
  assert.ok(legend, "the legend strip is gone from partner-galaxy.html — test is stale");
  assert.ok(!/money/i.test(legend[1]),
    "the legend still describes part of this screen as money. Caption was: " +
    legend[1].replace(/\s+/g, " ").trim());
  assert.ok(!/flare/i.test(legend[1]),
    "the legend still explains flares, which no longer exist");
});

test("the screen still opens for a partner — the parts that must not break", () => {
  /* T10-07 records that this screen opens and stays open for a partner. Deleting
     the tiles must not have taken the canvas, the sidebar or the honest banner
     with it. */
  assert.match(HTML, /<canvas id="sky">/, "the sky canvas is gone — the screen is blank");
  assert.match(CODE, /requestAnimationFrame\(draw\)/, "the animation loop is gone");
  assert.match(CODE, /function drawDust\(/, "the starfield is gone");
  assert.match(HTML, /id="wl-own-url"/,
    "the 'Your page' banner is gone — that is T10-01's fix, and it is real data");
});

test("the bottom band was closed up, not left as a blank strip", () => {
  /* The tiles lived in a reserved band KPI_H pixels tall at the foot of the
     canvas. With no tiles, that reservation would be an empty gap. */
  assert.ok(!/\bKPI_H\b/.test(CODE),
    "the canvas is still reserving the tile band at the bottom, which is now empty");
  assert.match(CODE, /GH\s*=\s*H\s*;/,
    "the sky is not using the full height of the canvas");
});

test("the gift Download button is not under the header", () => {
  /* Live walk 2026-08-25: .topbar-right (own-url + shell chip) overflowed the
     44px header and ate clicks on #blasterBtn. Keep the header in its box. */
  assert.match(HTML, /header\.topbar\{[^}]*overflow:hidden/,
    "header overflow can sit on the Download button");
  assert.match(HTML, /\.gift-strip\{[^}]*z-index:6/,
    "gift strip must sit above leftover header overflow");
});
