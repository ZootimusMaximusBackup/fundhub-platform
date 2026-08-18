// U18 — Plaid Connect bank. Do not open Plaid Link. Do not attach a bank.
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-untested-2026-08-18-evidence/u18");
const BASE = "https://fundhub.ai";

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

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const name of fs.readdirSync(dir)) {
    if (name === "node_modules" || name === ".git") continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (/\.(mjs|js|html|ts)$/.test(name)) acc.push(p);
  }
  return acc;
}

const needles = ["Plaid.create", "link_token", "Connect bank", "cdn.plaid.com"];
const hits = { Plaid_create: [], link_token: [], Connect_bank: [], cdn_plaid: [] };
for (const file of [...walk(path.join(ROOT, "src")), ...walk(path.join(ROOT, "api")), ...walk(path.join(ROOT, "public"))]) {
  const txt = fs.readFileSync(file, "utf8");
  const rel = path.relative(ROOT, file);
  if (txt.includes("Plaid.create")) hits.Plaid_create.push(rel);
  if (txt.includes("link_token")) hits.link_token.push(rel);
  if (/Connect bank/i.test(txt)) hits.Connect_bank.push(rel);
  if (txt.includes("cdn.plaid.com")) hits.cdn_plaid.push(rel);
}

let gitHistory = null;
try {
  const out = execFileSync("git", ["log", "--all", "-S", "Plaid.create", "--oneline"], {
    cwd: ROOT, encoding: "utf8", timeout: 20000
  }).trim();
  gitHistory = { searched: "Plaid.create", commits: out ? out.split("\n").length : 0, sample: out.split("\n").slice(0, 5) };
} catch (err) {
  gitHistory = { error: String(err.message).slice(0, 160) };
}
fs.writeFileSync(path.join(OUT, "repo-search.json"), JSON.stringify({ hits, gitHistory }, null, 2));

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
await c.connect();
const items = await c.query(`SELECT count(*)::int AS n FROM plaid_items`);
await c.end();
fs.writeFileSync(path.join(OUT, "db.json"), JSON.stringify({ plaid_items: items.rows[0] }, null, 2));

const hookRes = await fetch(BASE + "/api/webhooks/plaid", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: "{}"
});
const hookText = await hookRes.text();
let hookJson = null;
try { hookJson = JSON.parse(hookText); } catch { /* not json */ }
fs.writeFileSync(path.join(OUT, "webhook.json"), JSON.stringify({
  route: "POST https://fundhub.ai/api/webhooks/plaid",
  note: "Empty JSON only. Not a Plaid Link session. Not a bank attach.",
  status: hookRes.status,
  error: hookJson && (hookJson.error || hookJson.message) || null,
  bodyPreview: String(hookText).slice(0, 240)
}, null, 2));

const browser = await chromium.launch({ headless: true, executablePath: chromeExe() });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
page.on("dialog", (d) => d.dismiss());
await page.goto(BASE + "/login.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.locator('input[type="email"], #email, input[name="email"]').first().fill("chris@fundhub.ai");
await page.locator('input[type="password"], #password, input[name="password"]').first().fill(PASSWORD);
await page.locator('button[type="submit"], button:has-text("Sign"), button:has-text("Log")').first().click();
await page.waitForFunction(() => !/login\.html|portal-login\.html/i.test(location.pathname), null, { timeout: 30000 });
await page.goto(BASE + "/app/finance-os.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: path.join(OUT, "01-finance-os.png"), fullPage: false });
const ui = await page.evaluate(() => {
  const text = document.body?.innerText || "";
  const buttons = [...document.querySelectorAll("button, a")].map((el) => (el.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean);
  return {
    path: location.pathname + location.search,
    title: document.title,
    hasConnectBank: /connect bank/i.test(text),
    connectLike: buttons.filter((t) => /connect|plaid|link bank|add account/i.test(t)),
    buckets: ["Personal", "Business", "Investment", "Subscriptions"].filter((b) => new RegExp(b, "i").test(text)),
    bodyHasNotLinked: /bank is not linked/i.test(text),
    bodyPreview: text.slice(0, 700)
  };
});
fs.writeFileSync(path.join(OUT, "finance-os.json"), JSON.stringify({
  ...ui,
  clicked_connect: false,
  opened_plaid_link: false
}, null, 2));
await browser.close();

console.log(JSON.stringify({
  hits,
  gitHistory,
  plaid_items: items.rows[0],
  webhook: { status: hookRes.status, error: hookJson && (hookJson.error || hookJson.message) },
  ui: { hasConnectBank: ui.hasConnectBank, connectLike: ui.connectLike, bodyHasNotLinked: ui.bodyHasNotLinked }
}));
