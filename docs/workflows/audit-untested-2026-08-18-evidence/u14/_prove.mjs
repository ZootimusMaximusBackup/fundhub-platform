// U14 — background jobs. Read-only. Does not set INNGEST_EVENT_KEY. Does not send events.
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-untested-2026-08-18-evidence/u14");
const BASE = "https://fundhub.ai";
const DIR = path.join(ROOT, "src/workflows");

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

const PASSWORD = process.env.STAFF_E2E_PASSWORD || "";
if (!PASSWORD) throw new Error("STAFF_E2E_PASSWORD missing");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL missing");
fs.mkdirSync(OUT, { recursive: true });

function chromeExe() {
  const home = process.env.HOME || "";
  const root = path.join(home, "Library/Caches/ms-playwright");
  if (!fs.existsSync(root)) return undefined;
  const dirs = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const d of dirs) {
    const exe = path.join(root, d, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
    if (fs.existsSync(exe)) return exe;
  }
  return undefined;
}

const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs"));
const indexSrc = fs.readFileSync(path.join(DIR, "index.mjs"), "utf8");
const functions = [];
for (const file of files) {
  const src = fs.readFileSync(path.join(DIR, file), "utf8");
  if (!src.includes("inngest.createFunction")) continue;
  const idM = src.match(/inngest\.createFunction\(\s*\{\s*id:\s*"([^"]+)"/);
  const exportM = src.match(/export const (\w+) = inngest\.createFunction/);
  const exportName = exportM ? exportM[1] : null;
  const eventMs = [...src.matchAll(/\{\s*event:\s*"([^"]+)"\s*\}/g)].map((m) => m[1]);
  const cronM = src.match(/\{\s*cron:\s*([^}]+)\}/);
  functions.push({
    file,
    exportName,
    id: idM ? idM[1] : null,
    listenEvents: [...new Set(eventMs)],
    cron: cronM ? cronM[1].trim() : null,
    registeredInIndex: Boolean(exportName && new RegExp(`\\b${exportName}\\b`).test(indexSrc) && /export const functions = \[/.test(indexSrc))
  });
}
functions.sort((a, b) => (a.id || a.file).localeCompare(b.id || b.file));
const inventory = {
  createFunctionCount: functions.length,
  registeredInIndexCount: functions.filter((f) => f.registeredInIndex).length,
  definedNotRegistered: functions.filter((f) => !f.registeredInIndex).map((f) => ({ id: f.id, file: f.file })),
  ids: functions.map((f) => ({ id: f.id, registered: f.registeredInIndex, events: f.listenEvents, cron: f.cron }))
};
fs.writeFileSync(path.join(OUT, "inventory.json"), JSON.stringify(inventory, null, 2));

fs.writeFileSync(path.join(OUT, "env-presence.json"), JSON.stringify({
  INNGEST_EVENT_KEY: { present: Boolean(String(process.env.INNGEST_EVENT_KEY || "").trim()) },
  INNGEST_SIGNING_KEY: { present: Boolean(String(process.env.INNGEST_SIGNING_KEY || "").trim()) },
  did_set_or_flip_key: false,
  did_send_test_event: false,
  did_demo_mode: false
}, null, 2));

const namedEvents = [
  "deposit.paid",
  "inquiry.removed",
  "message.inbound",
  "mail.response",
  "docs.received",
  "diagnostic.paid",
  "payment.received",
  "contract.signed"
];

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
await c.connect();

const runTables = await c.query(`
  SELECT table_schema, table_name
    FROM information_schema.tables
   WHERE table_schema IN ('public','marketing')
     AND (
       table_name ILIKE '%inngest%'
       OR table_name ILIKE '%workflow_run%'
       OR table_name ILIKE '%function_run%'
       OR table_name IN ('failed_events','events')
     )
   ORDER BY 1, 2
`);

const eventCounts = [];
for (const name of namedEvents) {
  const r = await c.query(
    `SELECT count(*)::int AS n, min(created_at) AS first_at, max(created_at) AS last_at
       FROM events WHERE name = $1`,
    [name]
  );
  eventCounts.push({ name, ...r.rows[0] });
}

const failed = await c.query(`
  SELECT event_name, count(*)::int AS n
    FROM failed_events
   GROUP BY 1
   ORDER BY n DESC
   LIMIT 40
`).catch((err) => ({ rows: [{ error: String(err.message).slice(0, 160) }] }));

await c.end();

fs.writeFileSync(path.join(OUT, "db-events.json"), JSON.stringify({
  run_or_inngest_tables: runTables.rows,
  named_event_counts: eventCounts,
  failed_events: failed.rows,
  note: "events rows are our own log. They are written even if Inngest never ran the job."
}, null, 2));

async function probe(method, urlPath, headers = {}) {
  const res = await fetch(BASE + urlPath, { method, headers, redirect: "manual" });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return {
    method,
    path: urlPath,
    status: res.status,
    keys: json && typeof json === "object" ? Object.keys(json) : [],
    message: json && json.message ? json.message : null,
    error: json && json.error ? json.error : null,
    bodyPreview: String(text).slice(0, 240)
  };
}

const inngestGet = await probe("GET", "/api/inngest");
const inngestHead = await probe("HEAD", "/api/inngest");
const inngestPut = { skipped: true, reason: "PUT is the Inngest sync. Did not PUT. Did not demo-mode." };

const loginRes = await fetch(BASE + "/api/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "chris@fundhub.ai", password: PASSWORD })
});
const loginJson = await loginRes.json().catch(() => ({}));
const token = loginJson.token || null;

let workflows = null;
if (token) {
  const wfRes = await fetch(BASE + "/api/read/workflows?limit=100&offset=0", {
    headers: { authorization: "Bearer " + token, accept: "application/json" }
  });
  const wfBody = await wfRes.json().catch(() => ({}));
  const items = wfBody.items || wfBody.workflows || wfBody.rows || [];
  workflows = {
    status: wfRes.status,
    count: wfBody.count ?? items.length,
    engine_active_values: [...new Set(items.map((w) => w.engine_active))],
    status_counts: items.reduce((acc, w) => {
      acc[w.status] = (acc[w.status] || 0) + 1;
      return acc;
    }, {}),
    sample: items.slice(0, 8).map((w) => ({
      id: w.id,
      engine_active: w.engine_active,
      status: w.status,
      last_triggered_at: w.last_triggered_at || null,
      events: w.events || [],
      crons: w.crons || []
    })),
    never_triggered: items.filter((w) => w.status === "never_triggered").map((w) => w.id),
    live: items.filter((w) => w.status === "live").map((w) => w.id),
    note: "status live/never_triggered is from events table + INNGEST_EVENT_KEY being set. Not an Inngest run row."
  };
}

fs.writeFileSync(path.join(OUT, "live-doors.json"), JSON.stringify({
  inngestGet,
  inngestHead,
  inngestPut,
  login: { status: loginRes.status, ok: loginJson.ok === true, hasToken: Boolean(token) },
  workflows
}, null, 2));

const browser = await chromium.launch({ headless: true, executablePath: chromeExe() });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
page.on("dialog", (d) => d.dismiss());
await page.goto(BASE + "/login.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.locator('input[type="email"], #email, input[name="email"]').first().fill("chris@fundhub.ai");
await page.locator('input[type="password"], #password, input[name="password"]').first().fill(PASSWORD);
await page.locator('button[type="submit"], button:has-text("Sign"), button:has-text("Log")').first().click();
await page.waitForFunction(() => !/login\.html|portal-login\.html/i.test(location.pathname), null, { timeout: 30000 });
await page.goto(BASE + "/app/automations.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: path.join(OUT, "01-automations.png"), fullPage: false });
const auto = await page.evaluate(() => ({
  title: document.title,
  path: location.pathname,
  bodyPreview: (document.body?.innerText || "").slice(0, 800)
}));
fs.writeFileSync(path.join(OUT, "automations-ui.json"), JSON.stringify(auto, null, 2));
await browser.close();

console.log(JSON.stringify({
  inventory: {
    defined: inventory.createFunctionCount,
    listed: inventory.registeredInIndexCount,
    leftOff: inventory.definedNotRegistered
  },
  inngestGet: { status: inngestGet.status, message: inngestGet.message },
  workflows: workflows && {
    count: workflows.count,
    engine_active_values: workflows.engine_active_values,
    status_counts: workflows.status_counts
  },
  eventCounts,
  runTables: runTables.rows
}));
