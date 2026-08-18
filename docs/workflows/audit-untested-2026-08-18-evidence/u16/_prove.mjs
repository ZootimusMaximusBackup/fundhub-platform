// U16 — Bland start from this site. No real call. No Save. No Promote.
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-untested-2026-08-18-evidence/u16");
const BASE = "https://fundhub.ai";
const TEST = "8556bedc-46e1-4d85-b0cd-a24adfee1521";
const LIVE = "9af65808-a619-4e65-ae91-239766a006b7";

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

function walkMjs(dir, acc = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walkMjs(p, acc);
    else if (name.endsWith(".mjs") || name.endsWith(".js")) acc.push(p);
  }
  return acc;
}

const srcHits = [];
for (const file of walkMjs(path.join(ROOT, "src"))) {
  const txt = fs.readFileSync(file, "utf8");
  if (/api\.bland\.ai/.test(txt)) srcHits.push(path.relative(ROOT, file));
}
const vendorHits = [];
for (const file of walkMjs(path.join(ROOT, "vendor"))) {
  const txt = fs.readFileSync(file, "utf8");
  if (/api\.bland\.ai/.test(txt)) vendorHits.push(path.relative(ROOT, file));
}
fs.writeFileSync(path.join(OUT, "repo-bland-hosts.json"), JSON.stringify({
  src_api_bland_ai: srcHits,
  vendor_api_bland_ai: vendorHits,
  note: "src/adapters/bland.mjs is webhook listen only. It does not POST /v1/calls."
}, null, 2));

fs.writeFileSync(path.join(OUT, "env-names.json"), JSON.stringify({
  BLAND_API_KEY: { present: Boolean(String(process.env.BLAND_API_KEY || "").trim()) },
  BLAND_WEBHOOK_SECRET: { present: Boolean(String(process.env.BLAND_WEBHOOK_SECRET || "").trim()) },
  INQUIRY_API_BASE: { present: Boolean(String(process.env.INQUIRY_API_BASE || "").trim()) },
  INQUIRY_API_SECRET: { present: Boolean(String(process.env.INQUIRY_API_SECRET || "").trim()) },
  did_start_call: false,
  did_save_or_promote: false,
  did_sandbox: false
}, null, 2));

const loginRes = await fetch(BASE + "/api/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "chris@fundhub.ai", password: PASSWORD })
});
const loginJson = await loginRes.json().catch(() => ({}));
const token = loginJson.token || null;
const inquiry = await fetch(BASE + "/api/inquiry?action=cases", {
  headers: { authorization: "Bearer " + token, accept: "application/json" }
});
const inquiryJson = await inquiry.json().catch(() => ({}));
fs.writeFileSync(path.join(OUT, "inquiry-door.json"), JSON.stringify({
  route: "GET /api/inquiry?action=cases",
  status: inquiry.status,
  ok: inquiryJson.ok === true,
  error: inquiryJson.error || null,
  message: inquiryJson.message || null,
  keys: Object.keys(inquiryJson),
  did_post_launch: false
}, null, 2));

let lastCall = { queried: false };
if (process.env.BLAND_API_KEY) {
  const r = await fetch("https://api.bland.ai/v1/calls?limit=1", {
    headers: { authorization: process.env.BLAND_API_KEY, "Content-Type": "application/json" }
  });
  const j = await r.json().catch(() => ({}));
  const call = Array.isArray(j.calls) ? j.calls[0] : null;
  lastCall = {
    queried: true,
    status: r.status,
    total_count: j.total_count ?? null,
    last_created_at: call && (call.created_at || call.createdAt) || null,
    last_date_only: call && String(call.created_at || call.createdAt || "").slice(0, 10) || null,
    from_this_crm: "not_proven — GET does not name fundhub.ai as source"
  };
}
fs.writeFileSync(path.join(OUT, "bland-last-call.json"), JSON.stringify(lastCall, null, 2));

const browser = await chromium.launch({ headless: true, executablePath: chromeExe() });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
page.on("dialog", (d) => d.dismiss());
await page.goto(BASE + "/login.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.locator('input[type="email"], #email, input[name="email"]').first().fill("chris@fundhub.ai");
await page.locator('input[type="password"], #password, input[name="password"]').first().fill(PASSWORD);
await page.locator('button[type="submit"], button:has-text("Sign"), button:has-text("Log")').first().click();
await page.waitForFunction(() => !/login\.html|portal-login\.html/i.test(location.pathname), null, { timeout: 30000 });

async function shot(url, file, extra = {}) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(1800);
  if (page.url().includes(LIVE)) throw new Error("refusing live credit file URL");
  await page.screenshot({ path: path.join(OUT, file), fullPage: false });
  return page.evaluate((x) => {
    const buttons = [...document.querySelectorAll("button, a")].map((el) => (el.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean);
    const dialLike = buttons.filter((t) => /start call|place call|dial|call now|launch call/i.test(t));
    return {
      path: location.pathname + location.search,
      title: document.title,
      dialLike,
      savePromote: buttons.filter((t) => /save agent|promote to live/i.test(t)),
      ...x
    };
  }, extra);
}

const editor = await shot(BASE + "/app/agent-editor.html", "01-agent-editor.png");
const specialist = await shot(BASE + "/app/inquiry-remover.html", "02-specialist.png");
const ccp = await shot(`${BASE}/app/client-control-panel.html?id=${TEST}`, "03-ccp.png");
fs.writeFileSync(path.join(OUT, "screens.json"), JSON.stringify({
  editor, specialist, ccp,
  clicked_start_call: false,
  clicked_save: false,
  clicked_promote: false
}, null, 2));
await browser.close();

console.log(JSON.stringify({
  srcHits,
  vendorHits: vendorHits.length,
  inquiry: { status: inquiry.status, error: inquiryJson.error },
  lastCall,
  dialButtons: {
    editor: editor.dialLike,
    specialist: specialist.dialLike,
    ccp: ccp.dialLike
  }
}));
