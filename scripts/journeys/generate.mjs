#!/usr/bin/env node
// Regenerate docs/journeys/ from the code.
//
//   node scripts/journeys/generate.mjs          write the files
//   node scripts/journeys/generate.mjs --check  exit 1 if any file is stale
//
// Same shape as scripts/diagrams/generate.mjs, deliberately — that generator
// already set the convention in this repo ("GENERATED ... do not edit by hand"),
// and a second one that behaved differently would just be a thing to remember.
//
// --check is what stops these drifting: it is wired into `npm test`, so adding a
// route, changing a role gate, or renaming a role fails the suite until the
// journeys are regenerated. Stale documentation that nobody notices is the whole
// failure mode this exists to prevent — and for these pages it is worse than
// stale diagrams, because a journey that is out of date makes a false claim about
// who can reach a client's data.
//
// SEPARATE FROM scripts/diagrams/, ON PURPOSE. scripts/diagrams/generate.test.mjs
// asserts the adapter population is exactly 8, and folding journeys into that
// generator would put a shared, brittle test in the path of every journey change.

import fs from "node:fs";
import path from "node:path";
import { extractAll, REPO } from "./extract.mjs";
import { renderAll } from "./render.mjs";

export const OUT_DIR = path.resolve(REPO, "docs/journeys");

/** Build every journey page. Returns { "<relative path>": "<contents>" }. */
export function build() {
  return renderAll(extractAll());
}

/** Files whose committed contents differ from what the code now produces. */
export function stale(files) {
  const out = [];
  for (const [rel, contents] of Object.entries(files || build())) {
    const abs = path.join(OUT_DIR, rel);
    const current = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
    if (current !== contents) out.push({ rel, reason: current === null ? "missing" : "outdated" });
  }
  return out;
}

export function write(files) {
  const written = [];
  for (const [rel, contents] of Object.entries(files || build())) {
    const abs = path.join(OUT_DIR, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
    written.push(rel);
  }
  return written;
}

// Run only when invoked directly, so importing this from a test is side-effect free.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const check = process.argv.includes("--check");
  const files = build();

  if (check) {
    const bad = stale(files);
    if (bad.length) {
      console.error(`docs/journeys is stale — ${bad.length} file(s) out of date:`);
      for (const b of bad) console.error(`  ${b.reason.padEnd(8)} docs/journeys/${b.rel}`);
      console.error("\nRun `npm run journeys` and commit the result.");
      process.exit(1);
    }
    console.log(`docs/journeys is up to date (${Object.keys(files).length} files).`);
  } else {
    const written = write(files);
    console.log(`Wrote ${written.length} files to docs/journeys/:`);
    for (const w of written) console.log(`  ${w}`);
  }
}
