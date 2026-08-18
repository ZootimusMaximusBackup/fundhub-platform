// U15 — GHL live list. GET only to GHL. No catch-door POST. No key rotate. No sandbox.
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-untested-2026-08-18-evidence/u15");
const BASE = "https://services.leadconnectorhq.com";
const VERSION = "2021-07-28";
const SITE = "https://fundhub.ai";

function loadDotEnv() {
  const p = path.join(ROOT, ".env");
  const out = {};
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (k) out[k] = v;
    if (k && process.env[k] == null) process.env[k] = v;
  }
  return out;
}
const env = loadDotEnv();
fs.mkdirSync(OUT, { recursive: true });

try {
  const { execFileSync } = await import("node:child_process");
  for (const name of ["GHL_API_KEY", "GHL_PRIVATE_API_KEY", "GHL_LOCATION_ID"]) {
    if (env[name]) continue;
    try {
      const v = execFileSync("netlify", ["env:get", name, "--context", "production"], {
        encoding: "utf8",
        timeout: 20000
      }).trim();
      if (v && !/error|not found|undefined/i.test(v)) env[name] = v;
    } catch {
      /* name missing or CLI blocked — stay with local */
    }
  }
} catch {
  /* no netlify CLI */
}

const loc = env.GHL_LOCATION_ID || env.GHL_LOCATION || "ORh91GeY4acceSASSnLR";
const keys = [
  { name: "GHL_RELAY_API_KEY", value: env.GHL_RELAY_API_KEY || "" },
  { name: "GHL_API_KEY", value: env.GHL_API_KEY || "" },
  { name: "GHL_PRIVATE_API_KEY", value: env.GHL_PRIVATE_API_KEY || "" }
];

const envNames = {
  GHL_API_KEY: Boolean(env.GHL_API_KEY),
  GHL_RELAY_API_KEY: Boolean(env.GHL_RELAY_API_KEY),
  GHL_LOCATION_ID: Boolean(env.GHL_LOCATION_ID),
  GHL_LOCATION: Boolean(env.GHL_LOCATION),
  GHL_PRIVATE_API_KEY: Boolean(env.GHL_PRIVATE_API_KEY)
};
fs.writeFileSync(path.join(OUT, "env-names.json"), JSON.stringify({
  source: "local .env; Netlify production names loaded only when local missing (values not printed)",
  names: envNames,
  location_id_source: env.GHL_LOCATION_ID ? "GHL_LOCATION_ID" : env.GHL_LOCATION ? "GHL_LOCATION" : "repo_hardcoded_ORh91GeY4acceSASSnLR",
  did_rotate: false,
  did_sandbox: false,
  did_post_catch_door: false
}, null, 2));

async function ghlGet(keyValue, urlPath) {
  const res = await fetch(BASE + urlPath, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${keyValue}`,
      Version: VERSION,
      Accept: "application/json"
    }
  });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* not json */ }
  const snippet = String(text).slice(0, 240).replace(/[A-Za-z0-9_\-]{20,}/g, "[redacted]");
  return {
    path: urlPath,
    status: res.status,
    ok: res.ok,
    error: (body && (body.message || body.error || body.msg)) || null,
    keys: body && typeof body === "object" ? Object.keys(body) : [],
    snippet: res.ok ? undefined : snippet,
    listCount: Array.isArray(body?.workflows)
      ? body.workflows.length
      : Array.isArray(body?.pipelines)
        ? body.pipelines.length
        : Array.isArray(body?.phones)
          ? body.phones.length
          : Array.isArray(body?.data)
            ? body.data.length
            : null
  };
}

const listPaths = [
  `/locations/${loc}`,
  `/workflows/?locationId=${loc}`,
  `/locations/${loc}/workflows`,
  `/opportunities/pipelines?locationId=${loc}`,
  `/locations/${loc}/phoneNumbers`,
  `/phone-system/numbers?locationId=${loc}`
];

const ghl = [];
for (const key of keys) {
  if (!key.value) {
    ghl.push({ key_name: key.name, present: false, calls: [] });
    continue;
  }
  const calls = [];
  for (const p of listPaths) {
    calls.push(await ghlGet(key.value, p));
  }
  ghl.push({ key_name: key.name, present: true, calls });
}
fs.writeFileSync(path.join(OUT, "ghl-list.json"), JSON.stringify({ at: new Date().toISOString(), ghl }, null, 2));

const hookRes = await fetch(SITE + "/api/webhooks/ghl", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: "{}"
});
const hookText = await hookRes.text();
let hookJson = null;
try { hookJson = JSON.parse(hookText); } catch { /* not json */ }
fs.writeFileSync(path.join(OUT, "platform-webhook.json"), JSON.stringify({
  route: "POST https://fundhub.ai/api/webhooks/ghl",
  note: "Empty JSON only. Not a fake GHL workflow body. Not a catch-door.",
  status: hookRes.status,
  error: hookJson && (hookJson.error || hookJson.message) || null,
  bodyPreview: String(hookText).slice(0, 240)
}, null, 2));

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
await c.connect();
const captures = await c.query(`
  SELECT provider, count(*)::int AS n, max(created_at) AS last_at
    FROM webhook_captures
   GROUP BY 1
   ORDER BY n DESC
`);
const ghlCaptures = await c.query(`
  SELECT count(*)::int AS n
    FROM webhook_captures
   WHERE lower(provider) LIKE '%ghl%'
      OR lower(provider) LIKE '%highlevel%'
      OR lower(provider) LIKE '%leadconnector%'
`);
await c.end();
fs.writeFileSync(path.join(OUT, "db-captures.json"), JSON.stringify({
  by_provider: captures.rows,
  ghl_like: ghlCaptures.rows[0]
}, null, 2));

const anyOk = ghl.some((k) => k.calls.some((c) => c.ok));
console.log(JSON.stringify({
  envNames,
  anyListOk: anyOk,
  calls: ghl.map((k) => ({
    key: k.key_name,
    present: k.present,
    statuses: k.calls.map((c) => `${c.status} ${c.path.split("?")[0]} ${c.error || ""}`.trim())
  })),
  webhook: { status: hookRes.status, error: hookJson && (hookJson.error || hookJson.message) },
  ghlCaptures: ghlCaptures.rows[0]
}));
