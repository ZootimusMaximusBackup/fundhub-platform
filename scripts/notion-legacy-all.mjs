#!/usr/bin/env node
/**
 * Run the full Notion scrape pipeline: pull → transcribe → organize.
 *
 *   npm run notion:all
 *
 * Skips --login (run notion:login once first).
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function runStep(label, script, extraArgs = []) {
  console.log(`\n========== ${label} ==========\n`);
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", script), ...extraArgs], {
    stdio: "inherit",
    cwd: ROOT,
  });
  if (r.status !== 0) {
    console.error(`\n${label} failed (exit ${r.status})`);
    process.exit(r.status || 1);
  }
}

const profileDir = path.join(ROOT, "credentials/notion-scrape/profile");
if (!fs.existsSync(profileDir)) {
  console.error("No saved Notion login. Run first: npm run notion:login");
  process.exit(1);
}

runStep("PULL", "notion-legacy-pull.mjs", ["--pull"]);
runStep("TRANSCRIBE", "notion-legacy-transcribe.mjs");
runStep("ORGANIZE", "notion-legacy-organize.mjs");

console.log("\nAll done. Open credentials/notion-scrape/output/INDEX.md");
