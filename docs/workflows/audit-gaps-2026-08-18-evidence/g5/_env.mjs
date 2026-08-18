// Read-only: report whether named env keys exist. Never print values.
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const envText = fs.readFileSync(pathJoin(ROOT, ".env"), "utf8");

function pathJoin(a, b) {
  return a.replace(/\/$/, "") + "/" + b;
}

function parseEnvNames(text) {
  const map = {};
  for (const line of text.split(/\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 1) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    map[k] = { present: true, nonempty: v.length > 0 };
  }
  return map;
}

const local = parseEnvNames(envText);
const want = [
  "STAFF_E2E_PASSWORD",
  "INNGEST_EVENT_KEY",
  "INNGEST_SIGNING_KEY",
  "DATABASE_URL",
  "CALCOM_WEBHOOK_SECRET",
  "OXYLABS_USERNAME",
  "OXYLABS_PASSWORD",
  "OXYLABS_CUSTOMER_ID"
];

const localChecked = {};
for (const k of want) {
  localChecked[k] = local[k] || { present: false, nonempty: false };
}

let netlify = { attempted: true, error: null, names: {} };
try {
  const raw = execFileSync("netlify", ["env:list", "--context", "production", "--json"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 45000
  });
  const parsed = JSON.parse(raw);
  const bag = Array.isArray(parsed)
    ? Object.fromEntries(parsed.map((row) => [row.key || row.name, row]))
    : parsed;
  for (const k of ["INNGEST_EVENT_KEY", "INNGEST_SIGNING_KEY", "CALCOM_WEBHOOK_SECRET"]) {
    const hit = bag[k];
    netlify.names[k] = { present: Boolean(hit) };
  }
} catch (err) {
  netlify.error = String(err && err.message ? err.message : err).slice(0, 240);
}

const out = {
  at: new Date().toISOString(),
  local: localChecked,
  netlify
};
fs.writeFileSync(new URL("./env-presence.json", import.meta.url), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
