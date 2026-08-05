#!/usr/bin/env node
/* Sync the canonical sidebar into every CRM screen and into shell.js.
 *
 * Source of truth: public/app/sidebar.fragment.html
 *   → replaces <aside class="side" …>…</aside> in every public/app/*.html
 *     that already has one (leaves client-portal / index alone)
 *   → rewrites the SIDEBAR_HTML = "…" constant between markers in shell.js
 *
 * Run after editing the fragment. app-nav-reachability.test.mjs fails if any
 * screen's sidebar drifts from the others; this is how you keep them equal.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APP = join(ROOT, "public", "app");
const FRAGMENT = join(APP, "sidebar.fragment.html");
const SHELL = join(APP, "shell.js");

const START = "/* ==SIDEBAR_HTML_START== */";
const END = "/* ==SIDEBAR_HTML_END== */";

function stripComment(html) {
  return html.replace(/^<!--[\s\S]*?-->\s*/, "").trim() + "\n";
}

function jsString(html) {
  return JSON.stringify(html);
}

const aside = stripComment(readFileSync(FRAGMENT, "utf8"));
if (!aside.startsWith("<aside")) {
  console.error("sidebar.fragment.html must start with <aside after the comment");
  process.exit(1);
}

let pages = 0;
for (const file of readdirSync(APP).filter((f) => f.endsWith(".html")).sort()) {
  if (file === "sidebar.fragment.html") continue;
  const path = join(APP, file);
  const text = readFileSync(path, "utf8");
  if (!/<aside\s+class="side"/.test(text)) continue;

  /* Match the CRM rail only — it always ends with side-foot then </aside>.
     A bare [\s\S]*?<\/aside> can stop on an </aside> inside a <script> string
     (sample-data.html) and delete half the page. */
  const next = text.replace(
    /<aside\s+class="side"[^>]*>[\s\S]*?<div class="side-foot"[\s\S]*?<\/aside>/,
    aside.trim()
  );
  if (next === text) {
    // Already identical (trim-level). Still rewrite to normalize whitespace.
  }
  // Preserve the "on" class for the current screen.
  let stamped = next;
  const on = file;
  stamped = stamped.replace(
    new RegExp(`(<a class="navitem)( on)?(" href="${on.replace(".", "\\.")}")`, "g"),
    `$1 on$3`
  );
  // Clear "on" from others that the fragment never has — already clean.
  // If this page isn't a nav target (consent-capture), no on class — fine.
  writeFileSync(path, stamped);
  pages++;
}

let shell = readFileSync(SHELL, "utf8");
const block = `${START}\n  var SIDEBAR_HTML = ${jsString(aside.trim())};\n  ${END}`;
if (shell.includes(START) && shell.includes(END)) {
  shell = shell.replace(
    new RegExp(`${START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
    block
  );
} else {
  // Insert after PAGE declaration.
  shell = shell.replace(
    /(var PAGE = location\.pathname\.split\("\/"\)\.pop\(\);)/,
    `$1\n\n  ${block}`
  );
}
writeFileSync(SHELL, shell);

console.log(`sync-sidebar: wrote aside into ${pages} screens + shell.js`);
