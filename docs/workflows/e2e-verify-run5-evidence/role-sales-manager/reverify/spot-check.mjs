#!/usr/bin/env node
// Auditor re-verify spot-check — READ-ONLY against the live app as sales@fundhub.ai.
// Written for the 2b1eed0 fix-regression pass. Nothing is clicked except the
// login form. No POST/PUT/DELETE except the login itself.
//
// Records:
//   (a) every /api/demo/mode call per screen (method + status) — shell.js fix
//   (b) ops-admin.html GET /api/read/messages?status=blocked status + panel text
//   (c) n/a for this role (white-label only)
//   (d) localStorage fh_account / fh_role / fh_token presence after login
//   plus: landing url, header chip text, sales-floor summary text
//
// Usage: node docs/workflows/e2e-verify-run5-evidence/role-sales-manager/reverify/spot-check.mjs
// Output: spot-check.json, spot-check.md, shots/spot-*.png (all under reverify/)

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = process.cwd();
const BASE = process.env.BASE_URL || "https://fundhub.ai";
const EMAIL = "sales@fundhub.ai";
const OUT_DIR = path.join(ROOT, "docs/workflows/e2e-verify-run5-evidence/role-sales-manager/reverify");
const SHOTS = path.join(OUT_DIR, "shots");
fs.mkdirSync(SHOTS, { recursive: true });

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
if (!password) { console.error("STAFF_E2E_PASSWORD missing"); process.exit(2); }

const rel = (p) => path.relative(ROOT, p);
const out = { email: EMAIL, base: BASE, ranAt: new Date().toISOString(), login: {}, storage: {}, landing: {}, screens: {} };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 } });
const page = await ctx.newPage();

let apiLog = [];
page.on("response", (res) => {
  const u = res.url();
  if (u.includes("/api/")) apiLog.push({ url: u.replace(BASE, ""), status: res.status(), method: res.request().method() });
});
let consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(String(m.text()).slice(0, 160)); });
page.on("pageerror", (e) => consoleErrors.push("pageerror: " + String(e?.message || e).slice(0, 160)));

// --- login ------------------------------------------------------------------
await page.goto(`${BASE}/login.html`, { waitUntil: "domcontentloaded" });
await page.locator('input[type="email"], #email, input[name="email"]').first().fill(EMAIL);
await page.locator('input[type="password"], #password, input[name="password"]').first().fill(password);
apiLog = []; consoleErrors = [];
await page.locator('button[type="submit"], button:has-text("Sign"), button:has-text("Log")').first().click();
try { await page.waitForURL((u) => !/login\.html/.test(u.toString()), { timeout: 30_000 }); out.login.leftLogin = true; }
catch { out.login.leftLogin = false; }
await page.waitForLoadState("networkidle").catch(() => {});
await page.waitForTimeout(1500);
out.login.apiCalls = apiLog.slice();
out.login.demoModeCalls = apiLog.filter((r) => r.url.startsWith("/api/demo/mode"));
out.login.consoleErrors = consoleErrors.slice();

// (d) localStorage — presence + shape only, no values that could be a token
out.storage = await page.evaluate(() => {
  const keys = Object.keys(localStorage).sort();
  const acct = localStorage.getItem("fh_account");
  let acctShape = null;
  if (acct !== null) {
    try { const j = JSON.parse(acct); acctShape = { type: typeof j, keys: j && typeof j === "object" ? Object.keys(j) : null }; }
    catch { acctShape = { type: "unparseable", length: acct.length }; }
  }
  return {
    keys,
    fh_role: localStorage.getItem("fh_role"),
    fh_token_present: !!localStorage.getItem("fh_token"),
    fh_token_len: (localStorage.getItem("fh_token") || "").length,
    fh_account_present: acct !== null,
    fh_account_shape: acctShape
  };
}).catch((e) => ({ error: String(e) }));

// --- landing ----------------------------------------------------------------
out.landing.url = page.url().replace(BASE, "");
out.landing.title = await page.title().catch(() => "");
out.landing.headerChip = await page.evaluate(() => {
  const cands = [...document.querySelectorAll("header *, #fh-topbar *, .topbar *, .chip, [class*='chip'], [class*='role']")];
  const hit = cands.map((e) => (e.textContent || "").trim().replace(/\s+/g, " ")).filter((t) => /sales_manager|Sales Manager/i.test(t) && t.length < 200);
  return hit.slice(0, 3);
}).catch(() => []);
out.landing.bodySnippet = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 400);
out.landing.demoBannerPresent = await page.locator("#fh-demo-banner, .fh-demo-banner, [data-demo-banner]").count().catch(() => 0);
const landShot = path.join(SHOTS, "spot-01-landing.png");
await page.screenshot({ path: landShot });
out.landing.shot = rel(landShot);

// --- per-screen: demo/mode calls + ops-admin messages ------------------------
const SCREENS = [
  "sales-floor.html", "command-center.html", "pipeline.html", "staff-teams.html", "hiring.html",
  "ops-admin.html", "sample-data.html", "closer-dashboard.html", "finance-os.html",
  "client-control-panel.html", "documents.html", "messaging.html", "products-commissions.html"
];
for (const s of SCREENS) {
  apiLog = []; consoleErrors = [];
  const rec = { href: s };
  try {
    const resp = await page.goto(`${BASE}/app/${s}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    rec.http = resp ? resp.status() : null;
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(1500);
    rec.finalUrl = page.url().replace(BASE, "");
    rec.demoModeCalls = apiLog.filter((r) => r.url.startsWith("/api/demo/mode"));
    rec.api4xx5xx = apiLog.filter((r) => r.status >= 400);
    rec.consoleErrors = consoleErrors.slice(0, 8);
    if (s === "ops-admin.html") {
      rec.messagesBlocked = apiLog.filter((r) => /\/api\/read\/messages\?/.test(r.url) && /status=blocked/.test(r.url));
      rec.failedEvents = apiLog.filter((r) => /\/api\/read\/failed-events/.test(r.url));
      rec.compliancePanelText = (await page.locator("#compliance-blocked-table").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 300);
      rec.bodyHasLoadingBlocked = /Loading blocked messages/i.test(await page.locator("body").innerText().catch(() => ""));
      rec.bodyHasRejected = /request was rejected/i.test(await page.locator("body").innerText().catch(() => ""));
      const shot = path.join(SHOTS, "spot-ops-admin.png");
      await page.screenshot({ path: shot, fullPage: true });
      rec.shot = rel(shot);
    }
    if (s === "sample-data.html") {
      rec.bodyLimitedText = /limited to owner, admin/i.test(await page.locator("body").innerText().catch(() => ""));
      const shot = path.join(SHOTS, "spot-sample-data.png");
      await page.screenshot({ path: shot });
      rec.shot = rel(shot);
    }
    if (s === "hiring.html") {
      rec.bodySnippet = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 300);
      const shot = path.join(SHOTS, "spot-hiring.png");
      await page.screenshot({ path: shot });
      rec.shot = rel(shot);
    }
    if (s === "staff-teams.html" || s === "command-center.html") {
      rec.bodySnippet = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 300);
      const shot = path.join(SHOTS, `spot-${s.replace(".html", "")}.png`);
      await page.screenshot({ path: shot });
      rec.shot = rel(shot);
    }
  } catch (e) {
    rec.error = String(e?.message || e).slice(0, 200);
  }
  out.screens[s] = rec;
}

await browser.close();

fs.writeFileSync(path.join(OUT_DIR, "spot-check.json"), JSON.stringify(out, null, 2));

const md = [];
md.push(`# role-sales-manager — reverify spot-check (2b1eed0 side effects)`);
md.push(``);
md.push(`Ran ${out.ranAt} against ${BASE} as \`${EMAIL}\`.`);
md.push(``);
md.push(`| Check | Result |`);
md.push(`|---|---|`);
md.push(`| Sign in | ${out.login.leftLogin ? "left login.html" : "STILL ON login.html"}; demo/mode calls during login: ${out.login.demoModeCalls.length}; api 4xx/5xx during login: ${out.login.apiCalls.filter((r) => r.status >= 400).map((r) => `${r.method} ${r.url} → ${r.status}`).join(", ") || "none"} |`);
md.push(`| localStorage keys | ${out.storage.keys?.join(", ") ?? out.storage.error} |`);
md.push(`| fh_role | ${out.storage.fh_role} |`);
md.push(`| fh_token | present=${out.storage.fh_token_present} |`);
md.push(`| fh_account | present=${out.storage.fh_account_present}; shape=${JSON.stringify(out.storage.fh_account_shape)} |`);
md.push(`| Landing | ${out.landing.url} (${out.landing.title}); header chip: ${JSON.stringify(out.landing.headerChip)}; demo banner nodes: ${out.landing.demoBannerPresent} |`);
md.push(``);
md.push(`## Per screen`);
md.push(``);
md.push(`| Screen | HTTP | Final URL | /api/demo/mode calls | API 4xx/5xx | Console errors | Notes |`);
md.push(`|---|---|---|---|---|---|---|`);
for (const [href, r] of Object.entries(out.screens)) {
  const dm = (r.demoModeCalls || []).map((c) => `${c.method} → ${c.status}`).join("; ") || "none";
  const bad = (r.api4xx5xx || []).map((c) => `${c.method} ${c.url} → ${c.status}`).join("<br>") || "—";
  const notes = [];
  if (r.messagesBlocked) notes.push(`messages?status=blocked: ${r.messagesBlocked.map((c) => c.status).join(",") || "not called"}`);
  if (r.failedEvents) notes.push(`failed-events: ${r.failedEvents.map((c) => c.status).join(",") || "not called"}`);
  if (r.compliancePanelText !== undefined) notes.push(`compliance panel: "${r.compliancePanelText}"`);
  if (r.bodyHasLoadingBlocked !== undefined) notes.push(`"Loading blocked messages" on page: ${r.bodyHasLoadingBlocked}`);
  if (r.bodyHasRejected !== undefined) notes.push(`"request was rejected" on page: ${r.bodyHasRejected}`);
  if (r.bodyLimitedText !== undefined) notes.push(`"limited to owner, admin" on page: ${r.bodyLimitedText}`);
  if (r.error) notes.push(`ERROR ${r.error}`);
  md.push(`| ${href} | ${r.http ?? "—"} | ${r.finalUrl ?? "—"} | ${dm} | ${bad} | ${(r.consoleErrors || []).length} | ${notes.join("; ") || "—"} |`);
}
fs.writeFileSync(path.join(OUT_DIR, "spot-check.md"), md.join("\n") + "\n");
console.log(md.join("\n"));
