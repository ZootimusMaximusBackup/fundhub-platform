// U8 — bank-app launcher to the first error only. Does not file. Does not open a bank.
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-untested-2026-08-18-evidence/u8");
const BASE = "https://fundhub.ai";
const TEST = "8556bedc-46e1-4d85-b0cd-a24adfee1521";
const LIVE = "9af65808-a619-4e65-ae91-239766a006b7";
const DUMMY_LENDER = "00000000-0000-4000-8000-000000000001";

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
if (TEST === LIVE) throw new Error("refusing live credit file");
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

async function query(sql, params = []) {
  const c = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  await c.connect();
  try {
    return (await c.query(sql, params)).rows;
  } finally {
    await c.end();
  }
}

const oxylabs = {
  OXYLABS_USERNAME: { present: Boolean(String(process.env.OXYLABS_USERNAME || "").trim()) },
  OXYLABS_PASSWORD: { present: Boolean(String(process.env.OXYLABS_PASSWORD || "").trim()) }
};
oxylabs.ready = oxylabs.OXYLABS_USERNAME.present && oxylabs.OXYLABS_PASSWORD.present;
fs.writeFileSync(path.join(OUT, "oxylabs-cred-names.json"), JSON.stringify({
  source: "local .env names only — values not printed",
  ...oxylabs
}, null, 2));

const sessionsBefore = await query(
  `SELECT
     count(*)::int AS n_all,
     count(*) FILTER (WHERE client_id = $1::uuid)::int AS n_test,
     count(*) FILTER (WHERE client_id = $2::uuid)::int AS n_live
     FROM proxy_sessions`,
  [TEST, LIVE]
);
fs.writeFileSync(path.join(OUT, "proxy-sessions-before.json"), JSON.stringify(sessionsBefore[0], null, 2));

const loginRes = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "chris@fundhub.ai", password: PASSWORD })
});
const loginJson = await loginRes.json().catch(() => ({}));
const token = loginJson.token || null;
fs.writeFileSync(path.join(OUT, "login.json"), JSON.stringify({
  status: loginRes.status,
  ok: loginJson.ok === true,
  hasToken: Boolean(token),
  error: loginJson.error || null
}, null, 2));
if (!token) throw new Error("owner login failed");

const launchRes = await fetch(`${BASE}/api/proxy/launch`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: "Bearer " + token
  },
  body: JSON.stringify({ client_id: TEST, lender_id: DUMMY_LENDER })
});
const launchJson = await launchRes.json().catch(() => ({}));
const launchDump = {
  route: "POST /api/proxy/launch",
  client_id: TEST,
  lender_id: DUMMY_LENDER,
  filed: false,
  bank_login_typed: false,
  oxylabs_put_in_sandbox: false,
  status: launchRes.status,
  ok: launchJson.ok === true,
  error: launchJson.error || null,
  message: launchJson.message || null,
  session_id: launchJson.session_id || null,
  keys: Object.keys(launchJson)
};
fs.writeFileSync(path.join(OUT, "proxy-launch.json"), JSON.stringify(launchDump, null, 2));

const sessionsAfter = await query(
  `SELECT
     count(*)::int AS n_all,
     count(*) FILTER (WHERE client_id = $1::uuid)::int AS n_test,
     count(*) FILTER (WHERE client_id = $2::uuid)::int AS n_live
     FROM proxy_sessions`,
  [TEST, LIVE]
);
fs.writeFileSync(path.join(OUT, "proxy-sessions-after.json"), JSON.stringify({
  before: sessionsBefore[0],
  after: sessionsAfter[0],
  delta_all: sessionsAfter[0].n_all - sessionsBefore[0].n_all,
  delta_test: sessionsAfter[0].n_test - sessionsBefore[0].n_test
}, null, 2));

const browser = await chromium.launch({ headless: true, executablePath: chromeExe() });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
page.on("dialog", (d) => d.dismiss());
await page.goto(BASE + "/login.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.locator('input[type="email"], #email, input[name="email"]').first().fill("chris@fundhub.ai");
await page.locator('input[type="password"], #password, input[name="password"]').first().fill(PASSWORD);
await page.locator('button[type="submit"], button:has-text("Sign"), button:has-text("Log")').first().click();
await page.waitForFunction(() => !/login\.html|portal-login\.html/i.test(location.pathname), null, { timeout: 30000 });

await page.goto(`${BASE}/app/client-control-panel.html?id=${TEST}`, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(2000);
if (page.url().includes(LIVE)) throw new Error("refusing live credit file URL");
await page.screenshot({ path: path.join(OUT, "01-ccp-test.png"), fullPage: false });
const ccp = await page.evaluate(() => {
  const text = document.body?.innerText || "";
  const buttons = [...document.querySelectorAll("button, a")].map((el) => (el.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean);
  return {
    path: location.pathname + location.search,
    hasProxyApply: Boolean(window.FHProxyApply),
    applyLike: buttons.filter((t) => /apply|launch|lender|proxy/i.test(t)).slice(0, 20),
    bodyHasApply: /apply/i.test(text),
    title: document.title
  };
});
fs.writeFileSync(path.join(OUT, "ccp-doors.json"), JSON.stringify(ccp, null, 2));

await page.goto(`${BASE}/app/lenders.html?client_id=${TEST}`, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(2000);
await page.screenshot({ path: path.join(OUT, "02-lenders-test.png"), fullPage: false });
const lenders = await page.evaluate(() => {
  const buttons = [...document.querySelectorAll("button, a")].map((el) => (el.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean);
  const applyBtns = [...document.querySelectorAll("button")].filter((el) => /^apply$/i.test((el.textContent || "").trim()));
  return {
    path: location.pathname + location.search,
    hasProxyApply: Boolean(window.FHProxyApply),
    applyButtonCount: applyBtns.length,
    applyLike: buttons.filter((t) => /apply|launch|proxy/i.test(t)).slice(0, 20),
    title: document.title,
    emptyPreview: (document.querySelector(".empty")?.textContent || "").trim().slice(0, 200)
  };
});
fs.writeFileSync(path.join(OUT, "lenders-doors.json"), JSON.stringify(lenders, null, 2));

await page.goto(`${BASE}/app/pipeline.html`, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(OUT, "03-pipeline.png"), fullPage: false });

await browser.close();

console.log(JSON.stringify({
  launch: launchDump,
  sessions: { before: sessionsBefore[0], after: sessionsAfter[0] },
  oxylabs,
  ccp: { hasProxyApply: ccp.hasProxyApply, applyLike: ccp.applyLike },
  lenders: { applyButtonCount: lenders.applyButtonCount, applyLike: lenders.applyLike }
}));
