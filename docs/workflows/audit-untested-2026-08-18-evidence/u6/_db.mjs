/**
 * U6 read-only DB snapshot. Evidence only. Never prints secrets or PII.
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-untested-2026-08-18-evidence/u6");
const TEST_CLIENT = "8556bedc-46e1-4d85-b0cd-a24adfee1521";
const FORBIDDEN = "9af65808-a619-4e65-ae91-239766a006b7";

function loadDotEnv() {
  const p = path.join(ROOT, ".env");
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (k && process.env[k] == null) process.env[k] = v;
  }
}
loadDotEnv();
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL missing");
fs.mkdirSync(OUT, { recursive: true });

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

async function q(sql, params = []) {
  try {
    const r = await c.query(sql, params);
    return { ok: true, n: r.rows.length, rows: r.rows };
  } catch (err) {
    return { ok: false, error: String(err.message || err).slice(0, 220) };
  }
}

const tag = process.argv.includes("--after") ? "db-after.json" : "db.json";
const out = {
  at: new Date().toISOString(),
  test_client: TEST_CLIENT,
  opened_forbidden: false,
  env_names: {
    INQUIRY_API_BASE: !!String(process.env.INQUIRY_API_BASE || "").trim(),
    INQUIRY_API_SECRET: !!String(process.env.INQUIRY_API_SECRET || "").trim()
  }
};

out.cases = await q(
  `SELECT id, case_status, call_fired_at IS NOT NULL AS call_fired,
          first_delivery_at IS NOT NULL AS delivered,
          request_source, selected_bureaus_raw, created_at
     FROM inquiry_removal_cases WHERE client_id = $1 ORDER BY created_at DESC`,
  [TEST_CLIENT]
);

out.forbidden_cases = await q(
  `SELECT count(*)::int AS n FROM inquiry_removal_cases WHERE client_id = $1`,
  [FORBIDDEN]
);

out.events = await q(
  `SELECT name, count(*)::int AS n, max(created_at) AS last
     FROM events
     WHERE client_id = $1 AND name ILIKE '%inquir%'
     GROUP BY name ORDER BY name`,
  [TEST_CLIENT]
);

out.messages = await q(
  `SELECT id, channel, status, created_at
     FROM messages WHERE client_id = $1 ORDER BY created_at DESC LIMIT 8`,
  [TEST_CLIENT]
);

await c.end();
fs.writeFileSync(path.join(OUT, tag), JSON.stringify(out, null, 2));
console.log(JSON.stringify({
  wrote: `u6/${tag}`,
  cases: out.cases.rows || out.cases,
  events: out.events.rows || [],
  env_names: out.env_names
}, null, 2));
