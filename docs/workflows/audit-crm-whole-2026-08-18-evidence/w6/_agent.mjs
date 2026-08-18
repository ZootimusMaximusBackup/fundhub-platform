/**
 * Save a no-op on draft AG-01 only. Never touch Setter Josh / Inquiry Removal AI.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-crm-whole-2026-08-18-evidence/w6");
const BASE = "https://fundhub.ai";

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

function chromeExe() {
  const home = process.env.HOME || "";
  const root = path.join(home, "Library/Caches/ms-playwright");
  const dirs = fs.existsSync(root) ? fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1])) : [];
  for (const d of dirs) {
    const exe = path.join(root, d, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
    if (fs.existsSync(exe)) return exe;
  }
}

const browser = await chromium.launch({ headless: true, executablePath: chromeExe() });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
page.on("dialog", (d) => d.dismiss());
await page.goto(BASE + "/login.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.locator('input[type="email"]').first().fill("chris@fundhub.ai");
await page.locator('input[type="password"]').first().fill(process.env.STAFF_E2E_PASSWORD);
await page.locator('button[type="submit"]').first().click();
await page.waitForFunction(() => !/login\.html/i.test(location.pathname), null, { timeout: 30000 });
await page.goto(BASE + "/app/agent-editor.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(2000);
await page.locator('.aitem[data-a="AG-01"]').click();
await page.waitForTimeout(400);
const name = await page.locator("#a_name").inputValue();
if (/josh|inquiry removal/i.test(name)) {
  console.log(JSON.stringify({ withheld: true, name }));
  await browser.close();
  process.exit(0);
}
const writes = [];
page.on("response", (res) => {
  if (res.request().method() === "POST" && /\/api\/agents/.test(res.url())) {
    writes.push({ status: res.status(), url: res.url().replace(BASE, "") });
  }
});
await page.locator("#saveBtn").click();
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(OUT, "01-agent-save.png") });
const note = await page.evaluate(() => document.body.innerText.includes("SAVED") || document.body.innerText.includes("Saved"));
await browser.close();
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const row = (await c.query(`SELECT code, status, updated_at FROM agents WHERE code='AG-01'`)).rows[0];
await c.end();
const out = { name, note, writes, db: row };
fs.writeFileSync(path.join(OUT, "agent-save.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out));
