// U17 — PostGrid capture. GET the door only. No fake webhook POST. No letter send.
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-untested-2026-08-18-evidence/u17");
const SITE = "https://fundhub.ai";

function loadDotEnv() {
  const p = path.join(ROOT, ".env");
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (k && process.env[k] == null) process.env[k] = v;
  }
}
loadDotEnv();
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL missing");
fs.mkdirSync(OUT, { recursive: true });

fs.writeFileSync(path.join(OUT, "env-names.json"), JSON.stringify({
  POSTGRID_API_KEY: { present: Boolean(String(process.env.POSTGRID_API_KEY || "").trim()) },
  POSTGRID_WEBHOOK_SECRET: { present: Boolean(String(process.env.POSTGRID_WEBHOOK_SECRET || "").trim()) },
  did_send_letter: false,
  did_post_fake_webhook: false,
  did_sandbox: false
}, null, 2));

const router = fs.readFileSync(path.join(ROOT, "src/http/router.mjs"), "utf8");
const mail = fs.readFileSync(path.join(ROOT, "src/messaging/providers/mail-letter.mjs"), "utf8");
fs.writeFileSync(path.join(OUT, "route-code.json"), JSON.stringify({
  live_url: "https://fundhub.ai/api/webhooks/postgrid",
  router_has_postgrid_branch: /if \(provider === "postgrid"\)/.test(router),
  sendLetter_posts_postgrid: /api\.postgrid\.com\/print-mail\/v1/.test(mail),
  send_callers: [
    "src/metro2/delivery/send.mjs → mailBureauLetter → sendLetter",
    "api/repair/send.mjs → mailBureauLetter → sendLetter",
    "src/inquiry-ops/call-scheduler.mjs imports mail-letter (onMailDelivered / send)"
  ]
}, null, 2));

async function probe(method, urlPath) {
  const res = await fetch(SITE + urlPath, { method, redirect: "manual" });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return {
    method,
    path: urlPath,
    status: res.status,
    error: json && (json.error || json.message) || null,
    keys: json && typeof json === "object" ? Object.keys(json) : [],
    bodyPreview: String(text).slice(0, 200)
  };
}

const getDoor = await probe("GET", "/api/webhooks/postgrid");
const getGhlCompare = await probe("GET", "/api/webhooks/ghl");
fs.writeFileSync(path.join(OUT, "door.json"), JSON.stringify({
  note: "GET only. Did not POST a fake webhook body.",
  postgrid_get: getDoor,
  ghl_get: getGhlCompare
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
const postgridCaptures = await c.query(`
  SELECT count(*)::int AS n
    FROM webhook_captures
   WHERE lower(provider) LIKE '%postgrid%'
      OR lower(provider) LIKE '%mail-letter%'
`);

const letterTables = await c.query(`
  SELECT table_name
    FROM information_schema.tables
   WHERE table_schema = 'public'
     AND (
       table_name ILIKE '%letter%'
       OR table_name ILIKE '%postgrid%'
     )
   ORDER BY 1
`);

let letterStats = [];
for (const t of letterTables.rows) {
  const cols = await c.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1`,
    [t.table_name]
  );
  const names = cols.rows.map((r) => r.column_name);
  const hasProvider = names.some((n) => /provider/i.test(n));
  const hasDelivery = names.some((n) => /deliver/i.test(n));
  let extra = {};
  if (hasProvider) {
    const r = await c.query(
      `SELECT count(*)::int AS n,
              count(*) FILTER (WHERE COALESCE(provider_id, provider_letter_id, provider_ref)::text IS NOT NULL)::int AS with_provider
         FROM ${t.table_name}`
    ).catch(async () => {
      const r2 = await c.query(`SELECT count(*)::int AS n FROM ${t.table_name}`);
      return { rows: [{ n: r2.rows[0].n, with_provider: null }] };
    });
    extra = r.rows[0];
  } else {
    const r = await c.query(`SELECT count(*)::int AS n FROM ${t.table_name}`);
    extra = r.rows[0];
  }
  letterStats.push({ table: t.table_name, hasProvider, hasDelivery, ...extra });
}

const inquiryLetters = await c.query(`
  SELECT
    count(*)::int AS cases,
    count(*) FILTER (WHERE first_delivery_at IS NOT NULL)::int AS with_first_delivery
    FROM inquiry_removal_cases
`).catch((err) => ({ rows: [{ error: String(err.message).slice(0, 160) }] }));

await c.end();

fs.writeFileSync(path.join(OUT, "db.json"), JSON.stringify({
  captures_by_provider: captures.rows,
  postgrid_captures: postgridCaptures.rows[0],
  letter_tables: letterStats,
  inquiry_cases: inquiryLetters.rows[0]
}, null, 2));

console.log(JSON.stringify({
  door: getDoor,
  postgridCaptures: postgridCaptures.rows[0],
  letterTables: letterStats,
  inquiry: inquiryLetters.rows[0]
}));
