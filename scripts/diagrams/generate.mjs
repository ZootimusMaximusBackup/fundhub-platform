#!/usr/bin/env node
// Regenerate docs/diagrams/ from the code.
//
//   node scripts/diagrams/generate.mjs          write the files
//   node scripts/diagrams/generate.mjs --check  exit 1 if any file is stale
//
// --check is what stops the diagrams drifting: it is wired into `npm test`, so
// renaming an event or adding a workflow fails the suite until the diagrams are
// regenerated. Stale documentation that nobody notices is the failure mode this
// exists to prevent.

import fs from "node:fs";
import path from "node:path";
import { extractAll, REPO } from "./extract.mjs";
import { renderAll } from "./render.mjs";

export const OUT_DIR = path.resolve(REPO, "docs/diagrams");

/** Build every diagram. Returns { "<relative path>": "<contents>" }. */
export async function build() {
  return renderAll(await extractAll());
}

/** Files whose committed contents differ from what the code now produces. */
export async function stale(files) {
  const out = [];
  for (const [rel, contents] of Object.entries(files || (await build()))) {
    const abs = path.join(OUT_DIR, rel);
    const current = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
    if (current !== contents) out.push({ rel, reason: current === null ? "missing" : "outdated" });
  }
  return out;
}

export async function write(files) {
  const written = [];
  for (const [rel, contents] of Object.entries(files || (await build()))) {
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
  const files = await build();

  if (check) {
    const bad = await stale(files);
    if (bad.length) {
      console.error(`docs/diagrams is stale — ${bad.length} file(s) out of date:`);
      for (const b of bad) console.error(`  ${b.reason.padEnd(8)} docs/diagrams/${b.rel}`);
      console.error("\nRun `npm run diagrams` and commit the result.");
      process.exit(1);
    }
    console.log(`docs/diagrams is up to date (${Object.keys(files).length} files).`);
  } else {
    const written = await write(files);
    console.log(`Wrote ${written.length} files to docs/diagrams/:`);
    for (const w of written) console.log(`  ${w}`);
  }
}
