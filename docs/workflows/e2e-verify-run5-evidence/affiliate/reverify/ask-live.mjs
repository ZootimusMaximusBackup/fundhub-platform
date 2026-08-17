#!/usr/bin/env node
// AUDITOR re-verify (read-only) — affiliate Company Brain "Ask" on LIVE https://fundhub.ai
//
// (1) POST /api/auth/login as affiliate@fundhub.ai → token (password from gitignored .env, never printed)
// (2) POST /api/read/company-brain-affiliate {} WITH token   → expect 400 question_required
// (3) POST /api/read/company-brain-affiliate {} WITHOUT token → expect 401
// (4) real Chromium: /login.html → sign in → /app/affiliate.html; record every /api call + status;
//     confirm the Ask control (#brainBtn / "Ask approved partner docs") is visible; screenshot.
// No real question is sent. Nothing is clicked except the login submit. No writes.
//
// Output (this dir): ask-network.json, landing-network.json, ask-shot.png
// Written fresh by the auditor; not copied from ../fixed/.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const OUT = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(OUT, "../../../../..");
const BASE = "https://fundhub.ai"; // LIVE only — never localhost
const EMAIL = "affiliate@fundhub.ai";
const ASK_ROUTE = "/api/read/company-brain-affiliate";

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
if (!password) { console.error("STAFF_E2E_PASSWORD missing from env/.env"); process.exit(2); }

const shape = (j) => {
  const o = {};
  if (j && typeof j === "object") { if ("ok" in j) o.ok = j.ok; if ("error" in j) o.error = j.error; o.keys = Object.keys(j); }
  return o;
};

const ranAt = new Date().toISOString();
const ask = { base: BASE, email: EMAIL, ranAt, route: ASK_ROUTE, login: null, withToken: null, withoutToken: null };

// (1) login — one attempt only (successful logins do not count toward the rate limit)
const loginRes = await fetch(`${BASE}/api/auth/login`, {
  method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
  body: JSON.stringify({ email: EMAIL, password })
});
const loginJson = await loginRes.json().catch(() => ({}));
const token = loginJson?.token || "";
ask.login = { status: loginRes.status, ok: !!loginJson?.ok, tokenPresent: !!token, principalKind: loginJson?.principal?.kind ?? loginJson?.principal?.role ?? null, keys: Object.keys(loginJson || {}) };
if (!token) { fs.writeFileSync(path.join(OUT, "ask-network.json"), JSON.stringify(ask, null, 2) + "\n"); console.error("login_failed", ask.login); process.exit(2); }

// (2) with token, empty body
{
  const r = await fetch(`${BASE}${ASK_ROUTE}`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json", authorization: `Bearer ${token}` }, body: "{}" });
  const j = await r.json().catch(() => ({}));
  ask.withToken = { status: r.status, body: shape(j), expected: "400 question_required" };
}
// (3) without token, empty body
{
  const r = await fetch(`${BASE}${ASK_ROUTE}`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: "{}" });
  const j = await r.json().catch(() => ({}));
  ask.withoutToken = { status: r.status, body: shape(j), expected: "401" };
}
ask.verdictHint = ask.withToken.status === 400 && ask.withToken.body.error === "question_required" && ask.withoutToken.status === 401
  ? "CONFIRMED-FIXED" : (ask.withToken.status === 401 ? "REGRESSION" : "CHANGED — inspect");
fs.writeFileSync(path.join(OUT, "ask-network.json"), JSON.stringify(ask, null, 2) + "\n");
console.log(JSON.stringify({ withToken: ask.withToken, withoutToken: ask.withoutToken, verdictHint: ask.verdictHint }));

// (4) real Chromium landing
const landing = { base: BASE, email: EMAIL, ranAt: new Date().toISOString(), loginLeftForm: false, finalUrl: "", apiCalls: [], consoleErrors: [], ask: {} };
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 860 } });
page.on("response", (res) => {
  const u = res.url();
  if (u.includes("/api/")) landing.apiCalls.push({ method: res.request().method(), url: u.replace(BASE, "").split("?")[0] + (u.includes("?") ? "?…" : ""), status: res.status() });
});
page.on("console", (m) => { if (m.type() === "error") landing.consoleErrors.push(String(m.text()).slice(0, 160)); });
page.on("pageerror", (e) => landing.consoleErrors.push("pageerror: " + String(e?.message || e).slice(0, 160)));

await page.goto(`${BASE}/login.html`, { waitUntil: "domcontentloaded" });
await page.locator('input[type="email"], #email, input[name="email"]').first().fill(EMAIL);
await page.locator('input[type="password"], #password, #pw, input[name="password"]').first().fill(password);
await page.locator('button[type="submit"], #go, button:has-text("Sign")').first().click();
try { await page.waitForURL((u) => !/login\.html/.test(u.toString()), { timeout: 30_000 }); landing.loginLeftForm = true; } catch { landing.loginLeftForm = false; }
await page.waitForLoadState("networkidle").catch(() => {});
await page.waitForTimeout(1500);
if (!/\/app\/affiliate\.html/.test(page.url())) {
  landing.redirectedTo = page.url().replace(BASE, "");
  await page.goto(`${BASE}/app/affiliate.html`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1500);
}
landing.finalUrl = page.url().replace(BASE, "");
landing.title = await page.title().catch(() => "");
landing.roleStored = await page.evaluate(() => localStorage.getItem("fh_role")).catch(() => null);

const brainBtn = page.locator("#brainBtn");
const brainCard = page.locator("#brainCard");
landing.ask.brainBtnCount = await brainBtn.count();
landing.ask.brainBtnVisible = landing.ask.brainBtnCount ? await brainBtn.first().isVisible().catch(() => false) : false;
landing.ask.brainBtnText = landing.ask.brainBtnCount ? (await brainBtn.first().textContent().catch(() => "") || "").trim() : "";
landing.ask.brainCardText = (await brainCard.first().innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
landing.ask.askDocsTextVisible = await page.getByText("Ask approved partner docs").first().isVisible().catch(() => false);
landing.ask.brainQPlaceholder = await page.locator("#brainQ").first().getAttribute("placeholder").catch(() => null);
await brainCard.first().scrollIntoViewIfNeeded().catch(() => {});
await page.screenshot({ path: path.join(OUT, "ask-shot.png"), fullPage: false });
await page.screenshot({ path: path.join(OUT, "landing-full.png"), fullPage: true });
landing.bodyText = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 400);
landing.apiFails = landing.apiCalls.filter((c) => c.status >= 400);
landing.askRouteCalledOnLoad = landing.apiCalls.some((c) => c.url.startsWith(ASK_ROUTE));
await browser.close();
fs.writeFileSync(path.join(OUT, "landing-network.json"), JSON.stringify(landing, null, 2) + "\n");
console.log(JSON.stringify({ loginLeftForm: landing.loginLeftForm, finalUrl: landing.finalUrl, title: landing.title, roleStored: landing.roleStored, apiCalls: landing.apiCalls, apiFails: landing.apiFails.length, consoleErrors: landing.consoleErrors, ask: landing.ask }, null, 2));
