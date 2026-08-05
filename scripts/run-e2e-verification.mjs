#!/usr/bin/env node
// Orchestrates the definitive verification harness:
//   1) Playwright role + security UI specs → /tmp/fundhub-verify-ui.json
//   2) Data-layer pg journeys → docs/END-TO-END-VERIFICATION.md
//
// Usage:
//   DATABASE_URL=... node scripts/run-e2e-verification.mjs
//   npm run verify:e2e

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UI_OUT = "/tmp/fundhub-verify-ui.json";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

// Fresh UI accumulator
fs.writeFileSync(UI_OUT, JSON.stringify({ assertions: [], verdicts: [], notes: [] }, null, 2));

console.log("[verify] Playwright role + security specs…");
const e2e = spawnSync(
  process.execPath,
  [
    path.join(ROOT, "node_modules/@playwright/test/cli.js"),
    "test",
    "e2e/verification-roles.spec.mjs",
    "e2e/verification-security.spec.mjs"
  ],
  { cwd: ROOT, stdio: "inherit", env: process.env }
);
if (e2e.status !== 0) {
  console.warn("[verify] Playwright exited", e2e.status, "— continuing to data-layer (UI findings still merged if file exists)");
}

console.log("[verify] Data-layer journeys…");
const data = spawnSync(
  process.execPath,
  [path.join(ROOT, "src/verification/run-all.mjs")],
  { cwd: ROOT, stdio: "inherit", env: process.env }
);

const report = path.join(ROOT, "docs/END-TO-END-VERIFICATION.md");
if (fs.existsSync(report)) {
  console.log("[verify] Report written:", report);
} else {
  console.error("[verify] Report missing after run");
}

process.exit(data.status ?? 1);
