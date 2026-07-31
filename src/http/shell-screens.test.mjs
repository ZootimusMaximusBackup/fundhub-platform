// Every screen on disk is reachable, and every screen in the router exists.
//
// WHY THIS TEST EXISTS. public/app/shell.js decides which screens a role may
// open, and it derives EVERY role's list from one array, ALL. A page that is not
// in ALL is therefore in nobody's list: it fails the `ok.indexOf(PAGE) === -1`
// check and location.replace()s to the role's home. The symptom is not a 404 or
// a blank page — it is "the app opens the screen and throws me straight back",
// which reads like an auth bug and is not one.
//
// That has taken the app down before. Adding an HTML file under public/app/ is
// not enough, and nothing else in the build notices. So this test walks the
// directory and the array and fails on any disagreement in either direction:
//
//   on disk, not in ALL   → unreachable; the bounce above
//   in ALL, not on disk    → a nav link and a role grant pointing at nothing
//
// PURE, NO DATABASE, no browser. shell.js is plain ES5 and is read as text
// rather than executed, because executing it would need a DOM, a location and a
// fetch — and the array is what is being checked, not the router.

import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(HERE, "../../public/app");
const SHELL = path.join(APP_DIR, "shell.js");

/* Pages that are deliberately NOT screens. Each needs a reason, and the reason
   is not decoration: the next person needs to know whether an entry is a
   decision or a debt.

   index.html — the router page itself. shell.js computes PAGE as "" for /app/
                and comments that the router "is not a screen and is never in
                ALL". Putting it in the array would make the router a
                destination and give every role a link to a redirect. */
const NOT_SCREENS = {
  "index.html": "the router page — shell.js excludes it by design (see PAGE)"
};

function screensOnDisk() {
  return fs.readdirSync(APP_DIR)
    .filter((f) => f.endsWith(".html"))
    .filter((f) => !Object.prototype.hasOwnProperty.call(NOT_SCREENS, f))
    .sort();
}

/* Read the ALL array out of shell.js as text. A regex rather than a parser
   because the target is one literal array of string literals, and a parser here
   would be more code than the thing it inspects. */
function screensInAll() {
  const src = fs.readFileSync(SHELL, "utf8");
  const m = /var\s+ALL\s*=\s*\[([\s\S]*?)\]\s*;/.exec(src);
  assert.ok(m, "the ALL array is gone from shell.js, or is no longer a literal");
  return m[1].match(/"([^"]+\.html)"/g)?.map((s) => s.slice(1, -1)).sort() ?? [];
}

test("every screen on disk is in shell.js's ALL array", () => {
  const missing = screensOnDisk().filter((f) => !screensInAll().includes(f));
  assert.deepEqual(missing, [],
    `these screens exist but no role can open them — they will bounce to the role's home: ${missing.join(", ")}`);
});

test("every screen in ALL exists on disk", () => {
  const onDisk = screensOnDisk();
  const orphans = screensInAll().filter((f) => !onDisk.includes(f));
  assert.deepEqual(orphans, [],
    `ALL grants access to screens that are not there: ${orphans.join(", ")}`);
});

test("ALL has no duplicates", () => {
  const all = screensInAll();
  const dupes = all.filter((f, i) => all.indexOf(f) !== i);
  assert.deepEqual(dupes, [], `duplicated in ALL: ${dupes.join(", ")}`);
});

test("the Finance OS screens specifically are reachable", () => {
  // Named explicitly rather than left to the sweep above: these two are the
  // reason this file exists, and a named test says so in the failure output.
  const all = screensInAll();
  for (const screen of ["finance-os.html", "banking-surface.html"]) {
    assert.ok(all.includes(screen), `${screen} is not in ALL and will bounce to command-center.html`);
    assert.ok(fs.existsSync(path.join(APP_DIR, screen)), `${screen} is in ALL but not on disk`);
  }
});

/* EVERY INLINE SCRIPT ON EVERY SCREEN MUST PARSE.
 *
 * This caught a real one during the banking screen's smoke test: a string
 * opened with ' and closed with ", which is a SyntaxError that takes the WHOLE
 * <script> block out. The symptom was not an error anybody would notice — the
 * page rendered perfectly, in its sample markup, with no console error visible
 * to the harness and no failed request, because the block that would have
 * fetched and painted the real data never ran. A screen silently showing
 * fiction is worse than a screen showing an error.
 *
 * `npm test` globs src/ and scripts/ only, so nothing else in this repo ever
 * looks at the JavaScript inside a page. This is cheap and it closes that hole
 * for every screen at once, not just the two this workflow added.
 */
test("every inline script on every screen parses", () => {
  const broken = [];
  for (const file of screensOnDisk()) {
    const html = fs.readFileSync(path.join(APP_DIR, file), "utf8");
    const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    blocks.forEach((body, i) => {
      if (!body.trim()) return;
      try {
        // eslint-disable-next-line no-new-func
        new Function(body);
      } catch (e) {
        broken.push(`${file} inline block ${i}: ${e.message}`);
      }
    });
  }
  assert.deepEqual(broken, [],
    `a screen with a broken script block renders its sample markup and never says so:\n${broken.join("\n")}`);
});

test("every screen shell.js gates is actually loading shell.js", () => {
  // A screen in ALL that never loads the shell is ungated: it renders for
  // anybody who knows the URL, and the role map silently does not apply to it.
  const ungated = screensInAll().filter((f) => {
    const p = path.join(APP_DIR, f);
    if (!fs.existsSync(p)) return false;          // covered by the orphan test
    return !/<script[^>]+src="shell\.js"/.test(fs.readFileSync(p, "utf8"));
  });
  assert.deepEqual(ungated, [], `these screens are in the role map but never load it: ${ungated.join(", ")}`);
});
