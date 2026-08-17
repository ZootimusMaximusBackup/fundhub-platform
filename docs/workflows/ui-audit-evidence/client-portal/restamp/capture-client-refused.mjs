#!/usr/bin/env node
// One-shot live capture: a signed-in client is refused by staff-only file routes.
// Writes status + error only. Never writes the token or password.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../../../../");
const BASE = "https://fundhub.ai";
const EMAIL = "client@fundhub.ai";
const CLIENT_ID = "8556bedc-46e1-4d85-b0cd-a24adfee1521";
const OUT = path.join(HERE, "client-refused.json");
const SHOT = path.join(HERE, "client-refused.png");

function loadEnvPassword() {
  if (process.env.STAFF_E2E_PASSWORD) return process.env.STAFF_E2E_PASSWORD;
  const p = path.join(ROOT, ".env");
  if (!fs.existsSync(p)) return "";
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?STAFF_E2E_PASSWORD\s*=\s*(.*)\s*$/);
    if (m) return m[1].replace(/^["']|["']$/g, "");
  }
  return "";
}

const password = loadEnvPassword();
if (!password) {
  console.error("STAFF_E2E_PASSWORD missing");
  process.exit(2);
}

const login = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password })
});
const loginBody = await login.json().catch(() => ({}));
if (!login.ok || !loginBody.token) {
  console.error("login failed", login.status, loginBody.error || "");
  process.exit(2);
}

const token = loginBody.token;
const principal = loginBody.principal || null;

async function probe(url) {
  const r = await fetch(`${BASE}${url}`, {
    headers: { authorization: `Bearer ${token}` }
  });
  let body = null;
  try { body = await r.json(); } catch { body = null; }
  return {
    url,
    status: r.status,
    ok: body && body.ok,
    error: body && body.error,
    message: body && body.message,
    leakedKeys: body && typeof body === "object"
      ? Object.keys(body).filter((k) => ["items", "client", "transactions", "messages"].includes(k))
      : []
  };
}

const routes = await Promise.all([
  probe(`/api/read/documents?client_id=${CLIENT_ID}&limit=200`),
  probe(`/api/dashboard/client?id=${CLIENT_ID}`)
]);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${BASE}/login.html`, { waitUntil: "domcontentloaded" });
await page.locator('input[type="email"], #email, input[name="email"]').first().fill(EMAIL);
await page.locator('input[type="password"], #password, #pw, input[name="password"]').first().fill(password);
await page.locator('button[type="submit"], button:has-text("Sign"), button:has-text("Log")').first().click();
await page.waitForURL((u) => !/login\.html/.test(u.toString()), { timeout: 30_000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: SHOT, fullPage: false });
const banner = await page.evaluate(() => (document.body && document.body.innerText) || "");
await browser.close();

const evidence = {
  ranAt: new Date().toISOString(),
  base: BASE,
  email: EMAIL,
  login: { status: login.status, principal, landedAt: "/app/client-portal.html" },
  routes,
  refused: routes.every((r) => r.status === 401 || r.status === 403) &&
    routes.every((r) => r.ok === false) &&
    routes.every((r) => r.leakedKeys.length === 0),
  bannerHasNotSignedIn: /not signed in for real data/i.test(banner),
  shot: "docs/workflows/ui-audit-evidence/client-portal/restamp/client-refused.png"
};

fs.writeFileSync(OUT, JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify({
  refused: evidence.refused,
  routes: routes.map((r) => ({ url: r.url.split("?")[0], status: r.status, error: r.error })),
  bannerHasNotSignedIn: evidence.bannerHasNotSignedIn,
  out: "docs/workflows/ui-audit-evidence/client-portal/restamp/client-refused.json"
}));
if (!evidence.refused) process.exit(1);
