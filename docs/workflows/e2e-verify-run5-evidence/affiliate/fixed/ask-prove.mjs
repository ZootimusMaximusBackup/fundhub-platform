#!/usr/bin/env node
// Ticket 6 prove: affiliate POST /api/read/company-brain-affiliate {} is not 401.
// Local netlify already on BASE_URL. Password from gitignored .env. Never printed.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const OUT = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL || "http://localhost:8888";
const EMAIL = "affiliate@fundhub.ai";

function loadPassword() {
  if (process.env.STAFF_E2E_PASSWORD) return process.env.STAFF_E2E_PASSWORD;
  const p = path.join(ROOT, ".env");
  if (!fs.existsSync(p)) return "";
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?STAFF_E2E_PASSWORD\s*=\s*(.*)\s*$/);
    if (m) return m[1].replace(/^["']|["']$/g, "");
  }
  return "";
}

const password = loadPassword();
if (!password) {
  console.error("STAFF_E2E_PASSWORD missing");
  process.exit(2);
}

fs.mkdirSync(OUT, { recursive: true });

async function loginOnce() {
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ email: EMAIL, password })
  });
  const loginJson = await loginRes.json().catch(() => ({}));
  return { status: loginRes.status, token: loginJson.token || "" };
}

let token = "";
let loginStatus = 0;
for (let i = 0; i < 6; i++) {
  const out = await loginOnce();
  loginStatus = out.status;
  token = out.token;
  if (token) break;
  await new Promise((r) => setTimeout(r, 4000 * (i + 1)));
}
if (!token) {
  console.error("login_failed", loginStatus);
  process.exit(2);
}

const askRes = await fetch(`${BASE}/api/read/company-brain-affiliate`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    accept: "application/json",
    authorization: `Bearer ${token}`
  },
  body: "{}"
});
const askJson = await askRes.json().catch(() => ({}));
const network = { status: askRes.status };
if ("ok" in askJson) network.ok = askJson.ok;
if ("error" in askJson) network.error = askJson.error;
fs.writeFileSync(path.join(OUT, "ask-network.json"), JSON.stringify(network, null, 2) + "\n");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 860 } });
await page.goto(`${BASE}/login.html`, { waitUntil: "domcontentloaded" });
await page.locator("#email, input[type=email]").first().fill(EMAIL);
await page.locator("#pw, input[type=password]").first().fill(password);
const leftLogin = page.waitForURL((u) => !/login\.html/.test(u.toString()), { timeout: 30_000 });
await page.locator("#go, button[type=submit]").first().click();
try {
  await leftLogin;
} catch {
  console.error("login_did_not_leave_form");
  await browser.close();
  process.exit(2);
}
await page.goto(`${BASE}/app/affiliate.html`, { waitUntil: "domcontentloaded" });
await page.waitForLoadState("networkidle").catch(() => {});
await page.locator("#brainBtn, #brainCard").first().waitFor({ timeout: 15_000 });
await page.locator("#brainCard").first().scrollIntoViewIfNeeded().catch(() => {});
await page.screenshot({ path: path.join(OUT, "ask-shot.png"), fullPage: false });
await browser.close();

console.log(JSON.stringify(network));
if (network.status === 401) process.exit(1);
