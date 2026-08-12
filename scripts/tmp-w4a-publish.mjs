#!/usr/bin/env node
/**
 * W4a publish wrapper: run schema-scratch smoke, always write public/w4a-smoke.txt,
 * always exit 0 so the log is published even when smoke fails.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(ROOT, "public");
const outFile = path.join(outDir, "w4a-smoke.txt");
fs.mkdirSync(outDir, { recursive: true });

const lines = [];
lines.push(`started_at ${new Date().toISOString()}`);
lines.push(`has_MIGRATION_DATABASE_URL ${Boolean(process.env.MIGRATION_DATABASE_URL)}`);
lines.push(`has_DATABASE_URL ${Boolean(process.env.DATABASE_URL)}`);

// Prefer migration URL for DDL; never print it
const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL || "";
if (url) {
  try {
    const u = new URL(url.replace(/^postgres(ql)?:/i, "http:"));
    lines.push(`DB_HOST ${u.hostname}`);
    lines.push(
      `DB_PROVIDER ${/supabase/i.test(u.hostname) ? "supabase" : /neon/i.test(u.hostname) ? "neon" : "other"}`
    );
    lines.push(`DB_NAME ${u.pathname.replace(/^\//, "")}`);
    lines.push(`DB_USER ${u.username}`);
  } catch (e) {
    lines.push(`DB_PARSE_FAIL ${String(e.message || e).slice(0, 80)}`);
  }
} else {
  lines.push("DB_URL_MISSING");
}

fs.writeFileSync(outFile, lines.join("\n") + "\n");

const r = spawnSync(
  process.execPath,
  [path.join(ROOT, "scripts/tmp-w4a-scratch-smoke.mjs")],
  {
    cwd: ROOT,
    env: process.env,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024
  }
);

const combined = [
  ...lines,
  `smoke_status ${r.status}`,
  "-----STDOUT-----",
  r.stdout || "",
  "-----STDERR-----",
  r.stderr || "",
  `finished_at ${new Date().toISOString()}`
].join("\n");

// Redact any accidental URLs
const redacted = combined.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[REDACTED_DATABASE_URL]");
fs.writeFileSync(outFile, redacted + "\n");
console.log("W4A_PUBLISH_WROTE", outFile, "bytes", redacted.length, "smoke_status", r.status);
process.exit(0);
