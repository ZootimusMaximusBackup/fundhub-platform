#!/usr/bin/env node
/** Wait for other notion jobs, then run final sweep + organize + verify */
import { spawnSync } from "node:child_process";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function running(name) {
  try {
    execSync(`pgrep -f "${name}"`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const waitFor = ["notion-pull-files", "notion-resume-pull", "notion-vimeo-captions", "notion-retry-failed"];
console.log("Waiting for in-flight notion jobs…");
while (waitFor.some(running)) {
  spawnSync("sleep", ["15"]);
}

const steps = [
  ["notion:sweep", "node", ["scripts/notion-final-sweep.mjs"]],
  ["notion:organize", "node", ["scripts/notion-legacy-organize.mjs"]],
  ["notion:verify", "node", ["scripts/notion-legacy-verify.mjs"]],
];

for (const [label, cmd, args] of steps) {
  console.log(`\n========== ${label} ==========\n`);
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd: ROOT });
  if (r.status !== 0) process.exit(r.status || 1);
}

console.log("\nFinal pass complete.");
