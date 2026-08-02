/* Guards the phone-width sidebar treatment added across the app's nine main
 * screens (dashboard, pipeline, client, messaging, finance-os, journeys,
 * agents, workflows, template editor).
 *
 * Every one of these screens used to be desktop-only: no @media rule ever
 * touched .side, so at phone width the 228-230px sidebar sat permanently in
 * the layout, eating most of a 375-414px screen. The fix reuses the existing
 * collapse/expand button (side.classList.toggle('mini')) rather than adding a
 * second control: below 860px the sidebar starts in its compact icon-rail
 * state, and expanding it opens as a floating overlay (with a scrim behind
 * it) instead of an in-flow column, since a phone has no spare width to give
 * a permanently-widened column the way a desktop does.
 *
 * Read as text, same convention as app-nav-reachability.test.mjs and
 * pipeline-screen.test.mjs — these are static HTML/CSS/JS files with no
 * server, so a source-level check that the mechanism is wired is what a
 * screen-level test can verify without a browser. The actual rendered
 * result (no page ever scrolls horizontally, nothing sits invisibly past the
 * screen edge, the drawer opens and closes) was checked by hand against the
 * real dev server + a phone-width Playwright page — that is not repeatable
 * here without introducing a browser test harness this repo does not have.
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");

const SCREENS = [
  "command-center.html", "pipeline.html", "client-control-panel.html",
  "messaging.html", "finance-os.html", "journeys.html",
  "agent-editor.html", "automations.html", "template-editor.html"
];

describe("mobile sidebar — the nine main screens", () => {
  for (const screen of SCREENS) {
    const html = fs.readFileSync(path.join(APP, screen), "utf8");

    test(`${screen}: the sidebar defaults to the compact icon rail below 860px`, () => {
      assert.match(html, /@media\s*\(max-width:860px\)\s*\{/,
        `${screen} has no phone-width breakpoint for .side`);
      assert.match(html, /\.side:not\(\.mini\)\{[^}]*position:fixed/,
        `${screen}: the expanded sidebar does not become a floating overlay below 860px`);
    });

    test(`${screen}: a scrim sits behind the open drawer and is wired to close it`, () => {
      assert.match(html, /<div class="side-scrim" id="sideScrim">/,
        `${screen} has no scrim element`);
      assert.match(html, /getElementById\('sideScrim'\)/,
        `${screen}'s script never reads #sideScrim`);
    });

    test(`${screen}: the collapse button starts a phone in the compact state, not the desktop default`, () => {
      assert.match(html, /matchMedia\('\(max-width:860px\)'\)/,
        `${screen} never checks viewport width before deciding the sidebar's initial state`);
      assert.match(html, /classList\.add\('mini'\)/,
        `${screen} never forces the compact state on a narrow load`);
    });
  }
});
