#!/usr/bin/env node
// Auditor REVERIFY one-off — READ-ONLY spot-checks on the live site as inquiry@fundhub.ai.
// Checks the side effects of ship commit 2b1eed0 on this role:
//   (a) which screens still call GET /api/demo/mode (shell.js should no longer call it for staff)
//   (b) ops-admin.html GET /api/read/messages?status=blocked status (was 400) + panel text
//   (d) localStorage fh_account / fh_role after login (staff role) — values recorded as shape only
// Nothing is clicked except the login form. No writes.
//
// Usage: node docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/reverify/spot-check.mjs
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = process.cwd();
const BASE = process.env.BASE_URL || "https://fundhub.ai";
const EMAIL = "inquiry@fundhub.ai";
const OUT_DIR = path.join(ROOT, "docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/reverify");
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
const out = { email: EMAIL, base: BASE, ranAt: new Date().toISOString(), login: {}, localStorage: {}, demoMode: {}, opsAdminMessages: {}, screens: {} };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 } });
const page = await ctx.newPage();

// collect every /api/ response with the page URL it came from
let apiLog = [];
page.on("response", async (res) => {
  const u = res.url();
  if (!u.includes("/api/")) return;
  const entry = { page: page.url().replace(BASE, ""), method: res.request().method(), url: u.replace(BASE, ""), status: res.status() };
  if (u.includes("/api/read/messages")) {
    try {
      const j = await res.json();
      entry.shape = { ok: j?.ok, error: j?.error || null, itemsLen: Array.isArray(j?.data?.items) ? j.data.items.length : (Array.isArray(j?.items) ? j.items.length : null), keys: Object.keys(j?.data || j || {}).slice(0, 8) };
    } catch { entry.shape = "non-json"; }
  }
  apiLog.push(entry);
});

// login via the form
await page.goto(`${BASE}/login.html`, { waitUntil: "domcontentloaded" });
await page.locator('input[type="email"], #email, input[name="email"]').first().fill(EMAIL);
await page.locator('input[type="password"], #password, input[name="password"]').first().fill(password);
await page.locator('button[type="submit"], button:has-text("Sign"), button:has-text("Log")').first().click();
try { await page.waitForURL((u) => !/login\.html/.test(u.toString()), { timeout: 30_000 }); out.login.ok = true; } catch { out.login.ok = false; }
await page.waitForLoadState("networkidle").catch(() => {});
await page.waitForTimeout(1500);
out.login.landedAt = page.url().replace(BASE, "");

// (d) localStorage — shape only, never the token value
out.localStorage = await page.evaluate(() => {
  const acc = localStorage.getItem("fh_account");
  let accShape = null;
  if (acc !== null) { try { const j = JSON.parse(acc); accShape = { type: typeof j, keys: j && typeof j === "object" ? Object.keys(j) : null }; } catch { accShape = { type: "unparseable", length: acc.length }; } }
  return {
    fh_account_present: acc !== null,
    fh_account_shape: accShape,
    fh_role: localStorage.getItem("fh_role"),
    fh_token_present: !!localStorage.getItem("fh_token"),
    keys: Object.keys(localStorage).sort()
  };
});

// (a)+(b) walk the screens that matter
const targets = [
  "inquiry-remover.html", "command-center.html", "pipeline.html", "ops-admin.html",
  "closer-dashboard.html", "finance-os.html", "client-control-panel.html", "documents.html", "sample-data.html",
  "staff-teams.html", "messaging.html"
];
for (const t of targets) {
  apiLog = [];
  await page.goto(`${BASE}/app/${t}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const demo = apiLog.filter((e) => e.url.startsWith("/api/demo/mode"));
  const fails = apiLog.filter((e) => e.status >= 400).map((e) => `${e.method} ${e.url.split("?")[0]} -> ${e.status}`);
  out.screens[t] = { finalUrl: page.url().replace(BASE, ""), apiCalls: apiLog.length, demoModeCalls: demo.map((d) => d.status), fails };
  if (t === "ops-admin.html") {
    const msg = apiLog.filter((e) => e.url.startsWith("/api/read/messages"));
    out.opsAdminMessages.requests = msg;
    out.opsAdminMessages.panelText = await page.locator("#compliance-blocked-table").innerText().then((s) => s.replace(/\s+/g, " ").trim().slice(0, 300)).catch(() => null);
    const shot = path.join(SHOTS, "spot-ops-admin.png");
    await page.screenshot({ path: shot, fullPage: false });
    out.opsAdminMessages.shot = rel(shot);
  }
  if (t === "inquiry-remover.html") {
    const shot = path.join(SHOTS, "spot-inquiry-remover-landing.png");
    await page.screenshot({ path: shot });
    out.screens[t].shot = rel(shot);
    out.screens[t].systemAlertVisible = await page.locator("#systemAlert").isVisible().catch(() => null);
    out.screens[t].demoBannerPresent = await page.locator("#fh-demo-banner").count().then((n) => n > 0);
  }
}
out.demoMode.screensStillCalling = Object.entries(out.screens).filter(([, v]) => v.demoModeCalls.length).map(([k, v]) => `${k}: ${v.demoModeCalls.join(",")}`);
out.demoMode.screensClean = Object.entries(out.screens).filter(([, v]) => !v.demoModeCalls.length).map(([k]) => k);

await browser.close();
fs.writeFileSync(path.join(OUT_DIR, "spot-check.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
