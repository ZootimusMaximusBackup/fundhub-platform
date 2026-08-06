// Load repo-root .env into process.env for local scripts.
// Uses Node's built-in process.loadEnvFile — no dotenv package.
// Existing process.env values win (never overwrite). Missing .env is fine.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = path.join(ROOT, ".env");

export function loadEnv({ path: envPath = ENV_PATH } = {}) {
  if (!fs.existsSync(envPath)) return { loaded: false, path: envPath };
  if (typeof process.loadEnvFile === "function") {
    // Node 22+: load without clobbering already-set vars.
    const before = { ...process.env };
    process.loadEnvFile(envPath);
    for (const [k, v] of Object.entries(before)) {
      if (v !== undefined) process.env[k] = v;
    }
    return { loaded: true, path: envPath };
  }
  // Fallback parser (same shape as Node's .env rules, no expansion).
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
  return { loaded: true, path: envPath };
}

loadEnv();
