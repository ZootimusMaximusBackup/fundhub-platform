// EVERY CRM SCREEN IS FLUID. Owner rule, set 2026-08-27.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHAT THIS PREVENTS
//
// The owner works zoomed out on a 2560px monitor so he can see a whole screen
// at once. Zooming out does not shrink the page — it makes the browser report a
// WIDER page in CSS pixels. A fluid layout spends that width on content. A
// capped layout throws it away as side margin.
//
// Until 2026-08-27 the app was capped at 1800px, so zooming out bought nothing:
// 532px of dead margin at 2560, 1412px at 3440. Before that it was 1280px. Both
// values were set in good faith and both failed the same way, which is the
// reason this file exists rather than a third number.
//
// The cap lived in THREE places at once, and removing any two of them looked
// like it worked while the third kept a screen narrow. That is the failure mode
// this pins. It also pins the two things that must NOT be "cleaned up" along
// with it, both of which look redundant and are not.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY A TEST AND NOT JUST THE CSS
//
// The owner's actual requirement is not "wide". It is that every tab looks the
// same as every other tab when he switches between them. That is a property no
// single file owns, so nothing in the codebase would notice it decaying — one
// screen quietly re-adding `max-width: 1200px` to its own .content is invisible
// in review and obvious to the person using it all day.
//
// If a screen genuinely needs a narrower measure, cap the BLOCK that needs it
// (a paragraph, a form), never the page. That keeps the shell consistent, which
// is the whole point.

import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..", "..");
const APP = path.join(ROOT, "public", "app");

const SIDEBAR = fs.readFileSync(path.join(APP, "crm-sidebar.css"), "utf8");
const BRAND = fs.readFileSync(path.join(APP, "fundhub-brand.css"), "utf8");

/** Screens that carry the shared shell. These are the tabs the owner switches between. */
function shellScreens() {
  return fs.readdirSync(APP)
    .filter((f) => f.endsWith(".html"))
    .filter((f) => fs.readFileSync(path.join(APP, f), "utf8").includes("crm-sidebar.css"))
    .sort();
}

/**
 * Walk CSS and yield every { selector, body } pair at any nesting depth.
 * Written by hand rather than with a regex because a regex cannot tell
 * `@media (max-width:1000px)` — a CONDITION, which is fine — from
 * `.shell{max-width:1000px}` — a DECLARATION, which is not. Everything whose
 * selector starts with `@` is skipped, and its inner rules are still visited.
 */
function* rules(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  let buf = "";
  const stack = [];
  for (const ch of clean) {
    if (ch === "{") { stack.push(buf.trim()); buf = ""; continue; }
    if (ch === "}") {
      const sel = stack.pop();
      if (sel !== undefined && !sel.startsWith("@")) yield { selector: sel, body: buf };
      buf = "";
      continue;
    }
    buf += ch;
  }
}

/** Layout containers — the page column itself, not a card inside it. */
const LAYOUT = /(^|[\s,>])(\.shell|\.content|\.main|main)\b/;

describe("every CRM screen is fluid (owner-set 2026-08-27)", () => {
  test("the shell rule uncaps the page instead of capping it", () => {
    const hit = [...rules(SIDEBAR)].find(
      (r) => r.selector.includes(".shell, .content, .main") || r.selector.includes(".app-shell main")
    );
    assert.ok(hit, "the shell width rule vanished from crm-sidebar.css");
    assert.match(
      hit.body, /max-width:\s*none\s*!important/,
      "crm-sidebar.css must say `max-width: none !important`. A number here re-caps EVERY screen at once."
    );
    assert.match(
      hit.body, /margin-inline:\s*0\s*!important/,
      "margin-inline must be pinned to 0. `auto` on a flex item cancels the stretch and shrink-wraps the page to its widest child."
    );
  });

  test("DO NOT DELETE the shell rule — it is what beats two hardcoded caps", () => {
    // Deleting the rule reads as 'removing the cap' and does the opposite:
    // sales-floor and my-numbers would fall back to their own numbers.
    const sel = [...rules(SIDEBAR)].some((r) => /max-width:\s*none\s*!important/.test(r.body));
    assert.ok(sel, "the !important uncap is gone; screens with their own max-width will go narrow again");
  });

  test(".fh-maxw no longer caps anything", () => {
    const hit = [...rules(BRAND)].find((r) => r.selector.trim() === ".fh-maxw");
    assert.ok(hit, ".fh-maxw rule vanished from fundhub-brand.css");
    assert.match(hit.body, /max-width:\s*none/, ".fh-maxw must not carry a width cap");
    assert.match(hit.body, /width:\s*100%/, "width:100% is load-bearing — see the note above the rule");
  });

  test("--fh-maxw still EXISTS, because the client portal reads it", () => {
    // It is no longer a cap, and it still must not be deleted:
    // client-portal.html uses min(780px, var(--fh-maxw)) for its reading column.
    // Remove the token and that min() is invalid, max-width falls back to none,
    // and the client's portal goes full width.
    assert.match(BRAND, /--fh-maxw:\s*\d+px/, "--fh-maxw was deleted; client-portal.html depends on it");
    const portal = fs.readFileSync(path.join(APP, "client-portal.html"), "utf8");
    assert.ok(portal.includes("var(--fh-maxw)"), "client-portal stopped using the token — then this guard can be dropped");
  });

  test("the phone pin survives (UI-STANDARDS §11, no sideways scroll)", () => {
    assert.match(
      SIDEBAR, /@media[^{]*max-width:\s*860px/,
      "the 860px block is gone; phones will scroll sideways"
    );
    const pinned = [...rules(SIDEBAR)].some(
      (r) => LAYOUT.test(r.selector) && /max-width:\s*100%\s*!important/.test(r.body)
    );
    assert.ok(pinned, "the phone pin (max-width:100%) is gone from the layout selectors");
  });

  test("no screen re-caps its own page column", () => {
    const offenders = [];
    for (const file of shellScreens()) {
      const html = fs.readFileSync(path.join(APP, file), "utf8");
      for (const block of html.match(/<style[^>]*>[\s\S]*?<\/style>/gi) || []) {
        for (const r of rules(block)) {
          if (!LAYOUT.test(r.selector)) continue;
          const m = r.body.match(/max-width:\s*(\d+)px/);
          if (m) offenders.push(`${file}: ${r.selector.trim()} { max-width: ${m[1]}px }`);
        }
      }
    }
    assert.deepEqual(
      offenders, [],
      "These screens cap their own page column, so they will look narrower than every other tab:\n  " +
      offenders.join("\n  ") +
      "\nCap the block that needs a reading measure, not the page."
    );
  });

  test("every shell screen is actually covered by this guard", () => {
    const screens = shellScreens();
    assert.ok(screens.length >= 29, `expected the full set of shell screens, found ${screens.length}`);
    assert.ok(screens.includes("pipeline.html") && screens.includes("journeys.html"));
  });
});
