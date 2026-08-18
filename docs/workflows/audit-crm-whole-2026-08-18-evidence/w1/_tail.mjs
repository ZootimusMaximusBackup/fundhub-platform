import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-crm-whole-2026-08-18-evidence/w1");
const BASE = "https://fundhub.ai";
const TEST_CLIENT = "8556bedc-46e1-4d85-b0cd-a24adfee1521";
const MATH_CLIENT = "9af65808-a619-4e65-ae91-239766a006b7";

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
const PASSWORD = process.env.STAFF_E2E_PASSWORD || "";
function chromeExe() {
  const root = path.join(process.env.HOME || "", "Library/Caches/ms-playwright");
  const dirs = fs.existsSync(root) ? fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1])) : [];
  for (const d of dirs) {
    const exe = path.join(root, d, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
    if (fs.existsSync(exe)) return exe;
  }
}
function db() {
  return new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
}
const proofs = [];
function rec(row) {
  proofs.push(row);
  console.log(JSON.stringify({ id: row.id, result: row.result, happened: row.happened }));
}
async function shot(page, slug) {
  const file = path.join(OUT, `${slug}.png`);
  await page.screenshot({ path: file });
  return path.relative(ROOT, file);
}
async function query(sql, params = []) {
  const c = db();
  await c.connect();
  try { return (await c.query(sql, params)).rows; }
  finally { await c.end(); }
}

async function main() {
  const browser = await chromium.launch({ headless: false, executablePath: chromeExe() });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true })).newPage();
  try {
    await page.goto(BASE + "/login.html", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.locator('input[type="email"], #email').first().fill("chris@fundhub.ai");
    await page.locator('input[type="password"], #password').first().fill(PASSWORD);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForFunction(() => !/login\.html/i.test(location.pathname), null, { timeout: 30000 });

    await page.goto(`${BASE}/app/closer-dashboard.html?client_id=${MATH_CLIENT}`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(2500);
    await page.locator("#iDraw").fill("5000").catch(() => {});
    await page.locator("#iDraw").dispatchEvent("input").catch(() => {});
    await page.waitForTimeout(1200);
    const vals = await page.evaluate(() => ({
      credit: (document.getElementById("oCredit") || {}).textContent || "",
      draw: (document.getElementById("iDraw") || {}).value || "",
      live: !!window.__fhCloserLive,
      hrefHasClient: /client_id=/.test(location.search)
    }));
    rec({
      id: "p6-closer-math",
      result: vals.credit.trim() !== "—" ? "WORKS" : "BROKEN",
      claimed: "Calculators show real numbers after a $5000 draw.",
      clicked: "Opened the live file. Typed 5000.",
      happened: vals.credit.trim() === "—" ? "Credit stayed blank. File id was in the URL." : "Numbers filled.",
      db: vals,
      shot: await shot(page, "06-closer-math")
    });

    const row = (await query(
      `SELECT status, provider, provider_ref, template_key FROM messages
        WHERE client_id = $1 AND channel = 'email' ORDER BY created_at DESC LIMIT 1`,
      [TEST_CLIENT]
    ))[0];
    let outside = { checked: false };
    if (row && row.provider_ref && process.env.RESEND_API_KEY) {
      const r = await fetch("https://api.resend.com/emails/" + encodeURIComponent(row.provider_ref), {
        headers: { Authorization: "Bearer " + process.env.RESEND_API_KEY, accept: "application/json" }
      });
      const b = await r.json().catch(() => ({}));
      outside = { checked: true, http: r.status, last_event: b.last_event || null };
    }
    const landed = ["delivered", "opened", "clicked"].includes(outside.last_event);
    rec({
      id: "p7-email",
      result: row && row.status === "sent" && landed ? "WORKS" : "BROKEN",
      claimed: "An email actually lands in an inbox.",
      clicked: "Checked this morning's mail row and the provider.",
      happened: !row ? "No email row." : (landed ? `Provider says ${outside.last_event}.` : `Row is ${row.status} via ${row.provider}. Last event: ${outside.last_event || "none"}.`),
      db: row ? { status: row.status, provider: row.provider, has_ref: !!row.provider_ref, key: row.template_key } : null,
      mail: outside
    });

    const recent = await query(`SELECT status, provider FROM messages WHERE channel='sms' ORDER BY created_at DESC LIMIT 3`);
    await page.goto(BASE + "/app/messaging.html", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(1000);
    rec({
      id: "p8-sms",
      result: "BROKEN",
      claimed: "An SMS actually lands on a phone.",
      clicked: "Opened Messaging. Did not send a new text. Test client has no phone.",
      happened: recent[0] ? `Older texts exist as ${recent[0].status} via ${recent[0].provider}. No new send.` : "No SMS rows.",
      db: recent,
      shot: await shot(page, "08-messaging")
    });
  } finally {
    const prev = path.join(OUT, "proofs.json");
    let old = [];
    try { old = JSON.parse(fs.readFileSync(prev, "utf8")).proofs || []; } catch {}
    fs.writeFileSync(prev, JSON.stringify({ at: new Date().toISOString(), proofs: old.concat(proofs) }, null, 2));
    await browser.close();
  }
}

main().catch((err) => {
  console.error(String(err && err.message ? err.message : err));
  process.exit(1);
});
