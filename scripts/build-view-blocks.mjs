// Injects a view module into its screen, verbatim, between the FH-VIEW markers.
//
// WHY THIS EXISTS. There is no bundler in this repo and a <script> in a page
// cannot import from src/. The established convention (closer-dashboard.html)
// is that the page carries a hand-copied ES5 duplicate of its view module, with
// a drift test that runs both through the same fixtures and fails if they
// disagree.
//
// The drift test is the real control and it stays. This script removes the
// hand-copying, which is the part that goes wrong: a copy made by a person
// drifts silently between the moment it is edited and the moment somebody runs
// the tests, and the diff a reviewer sees is a wall of duplicated code either
// way. Generated, the two texts are identical by construction and the test
// becomes a check on the generator rather than on somebody's diligence.
//
// The transform is deliberately dumb — strip `export `, append one window
// assignment — because a clever transform is a second implementation with its
// own bugs, and the whole point is that the browser runs the same text the
// tests do. Modules fed to it must therefore already be written in ES5: var,
// function, no template literals, no arrow functions, no let/const in the
// exported surface.
//
// Usage:  node scripts/build-view-blocks.mjs [--check]
//   --check  exit non-zero if any page is out of date, and change nothing.
//            Suitable for CI; the drift test covers the same ground from the
//            other direction.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

const BEGIN = "/* FH-VIEW-BEGIN */";
const END = "/* FH-VIEW-END */";

/* Which module is inlined into which page, and under which global. */
const TARGETS = [
  { module: "src/http/finance-os-view.mjs", page: "public/app/finance-os.html", global: "FHFinanceView" },
  { module: "src/http/bank-view.mjs", page: "public/app/banking-surface.html", global: "FHBankView" }
];

/* The names a module exports, in source order. Read off the source rather than
   imported, because importing would run the module and this script must work on
   a file that does not parse in Node's module loader for any reason. */
function exportedNames(src) {
  const names = [];
  const re = /^export\s+(?:function|var|const|let)\s+([A-Za-z_$][\w$]*)/gm;
  let m;
  while ((m = re.exec(src)) !== null) names.push(m[1]);
  return names;
}

function block(modulePath, globalName) {
  const src = fs.readFileSync(path.join(ROOT, modulePath), "utf8");
  const names = exportedNames(src);
  if (!names.length) throw new Error(`${modulePath}: no exports found`);

  // `export ` is the only thing removed. Everything else — including every
  // comment — is carried across unchanged, so the browser copy and the module
  // are the same text.
  const body = src.replace(/^export\s+/gm, "");

  return [
    BEGIN,
    `/* INJECTED VERBATIM FROM ${modulePath} — DO NOT EDIT BY HAND.`,
    "   Regenerate with: node scripts/build-view-blocks.mjs",
    `   ${path.basename(modulePath, ".mjs")}.test.mjs runs the same fixtures through this copy`,
    "   and the module and fails if they disagree. */",
    body.trimEnd(),
    "",
    `window.${globalName} = { ${names.join(", ")} };`,
    END
  ].join("\n");
}

function apply({ module: modulePath, page, global: globalName }) {
  const pagePath = path.join(ROOT, page);
  const html = fs.readFileSync(pagePath, "utf8");
  const a = html.indexOf(BEGIN);
  const b = html.indexOf(END);
  if (a === -1 || b <= a) throw new Error(`${page}: the FH-VIEW markers are missing or out of order`);

  const next = html.slice(0, a) + block(modulePath, globalName) + html.slice(b + END.length);
  return { pagePath, page, html, next, changed: next !== html };
}

const check = process.argv.includes("--check");
let stale = 0;

for (const target of TARGETS) {
  if (!fs.existsSync(path.join(ROOT, target.page))) {
    console.log(`· skip ${target.page} (not present)`);
    continue;
  }
  const r = apply(target);
  if (!r.changed) { console.log(`· ok   ${r.page}`); continue; }
  if (check) { console.error(`✗ STALE ${r.page} — run node scripts/build-view-blocks.mjs`); stale += 1; continue; }
  fs.writeFileSync(r.pagePath, r.next);
  console.log(`✔ wrote ${r.page}`);
}

if (check && stale) process.exit(1);
