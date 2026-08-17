#!/usr/bin/env node
// Reverify (auditor, read-only): log EVERY request to /api/demo/mode (not just
// failures) while a closer visits five screens on the LIVE site.
// Password from gitignored .env, never printed. Nothing clicked except the
// login form. No writes.
//
// Usage: node docs/workflows/e2e-verify-run5-evidence/role-closer/reverify/demo-mode-requests.mjs
// Output: docs/workflows/e2e-verify-run5-evidence/role-closer/reverify/demo-mode-requests.json

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = process.cwd();
const BASE = process.env.BASE_URL || "https://fundhub.ai";
const EMAIL = "closer@fundhub.ai";
const OUT_DIR = path.join(ROOT, "docs/workflows/e2e-verify-run5-evidence/role-closer/fixed-callers/live");
fs.mkdirSync(OUT_DIR, { recursive: true });

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
  console.error("STAFF_E2E_PASSWORD missing from env/.env — cannot log in");
  process.exit(2);
}

// First five = the screens the parent asked for. The rest = every screen the
// reverify ui-walk still saw calling /api/demo/mode, so the initiator (which
// script fired it) is on record.
const SCREENS = [
  "/dashboard.html",
  "/app/pipeline.html",
  "/app/command-center.html",
  "/app/ops-admin.html",
  "/app/staff-teams.html",
  "/app/closer-dashboard.html",
  "/app/closer-call.html",
  "/app/finance-os.html",
  "/app/client-control-panel.html",
  "/app/documents.html",
  "/app/sample-data.html"
];

const out = { base: BASE, email: EMAIL, ranAt: new Date().toISOString(), login: {}, screens: [], totalDemoModeRequests: 0 };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 } });
const page = await ctx.newPage();

let demoRequests = [];   // every request to /api/demo/mode
let demoResponses = [];  // status of every response to /api/demo/mode
let demoInitiators = []; // which script fired it (CDP initiator stack, top frame)
let allApiRequests = 0;  // sanity: proves the listener is alive
let consoleErrors = [];
page.on("request", (req) => {
  const u = req.url();
  if (u.includes("/api/")) allApiRequests++;
  if (u.includes("/api/demo/mode")) demoRequests.push({ url: u.replace(BASE, ""), method: req.method(), page: page.url().replace(BASE, "") });
});
// CDP: capture the initiator (script url + line) of every /api/demo/mode request
const cdp = await ctx.newCDPSession(page);
await cdp.send("Network.enable");
cdp.on("Network.requestWillBeSent", (ev) => {
  const u = ev.request?.url || "";
  if (!u.includes("/api/demo/mode")) return;
  const frames = ev.initiator?.stack?.callFrames || [];
  const top = frames.find((f) => f.url) || frames[0] || null;
  demoInitiators.push({
    url: u.replace(BASE, ""),
    initiatorType: ev.initiator?.type || null,
    script: top ? `${(top.url || "").replace(BASE, "")}:${top.lineNumber + 1}` : (ev.initiator?.url ? ev.initiator.url.replace(BASE, "") : null),
    fn: top?.functionName || null
  });
});
page.on("response", (res) => {
  const u = res.url();
  if (u.includes("/api/demo/mode")) demoResponses.push({ url: u.replace(BASE, ""), status: res.status() });
});
page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(String(msg.text()).slice(0, 160)); });
page.on("pageerror", (err) => consoleErrors.push("pageerror: " + String(err?.message || err).slice(0, 160)));

// sign in via the real form
await page.goto(`${BASE}/login.html`, { waitUntil: "domcontentloaded" });
await page.locator('input[type="email"], #email, input[name="email"]').first().fill(EMAIL);
await page.locator('input[type="password"], #password, input[name="password"]').first().fill(password);
await page.locator('button[type="submit"], button:has-text("Sign"), button:has-text("Log")').first().click();
try {
  await page.waitForURL((u) => !/login\.html/.test(u.toString()), { timeout: 30_000 });
  out.login.ok = true;
} catch {
  out.login.ok = false;
}
await page.waitForLoadState("networkidle").catch(() => {});
await page.waitForTimeout(1500);
out.login.roleStored = await page.evaluate(() => localStorage.getItem("fh_role")).catch(() => null);
out.login.landedAt = page.url().replace(BASE, "");
out.login.demoModeRequestsDuringLogin = demoRequests.slice();
out.login.apiRequestsSeen = allApiRequests;

for (const s of SCREENS) {
  demoRequests = []; demoResponses = []; demoInitiators = []; allApiRequests = 0; consoleErrors = [];
  const rec = { screen: s };
  try {
    const resp = await page.goto(`${BASE}${s}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    rec.httpStatus = resp ? resp.status() : null;
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(2000);
    rec.finalUrl = page.url().replace(BASE, "");
    rec.title = await page.title().catch(() => "");
    const shot = path.join(OUT_DIR, `demo-mode-${s.replace(/[^a-z0-9.-]/gi, "_")}.png`);
    await page.screenshot({ path: shot });
    rec.shot = path.relative(ROOT, shot);
  } catch (e) {
    rec.error = String(e?.message || e).slice(0, 200);
  }
  rec.apiRequestsSeen = allApiRequests;
  rec.demoModeRequests = demoRequests.slice();
  rec.demoModeResponses = demoResponses.slice();
  rec.demoModeInitiators = demoInitiators.slice();
  rec.consoleErrorsMentioningDemoOr403 = consoleErrors.filter((c) => /demo\/mode|403/i.test(c));
  rec.consoleErrorsAll = consoleErrors.slice(0, 8);
  out.totalDemoModeRequests += demoRequests.length;
  out.screens.push(rec);
}

await browser.close();
fs.writeFileSync(path.join(OUT_DIR, "demo-mode-requests.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify({
  login: out.login,
  totalDemoModeRequests: out.totalDemoModeRequests,
  screens: out.screens.map((r) => ({ screen: r.screen, http: r.httpStatus, finalUrl: r.finalUrl, apiRequestsSeen: r.apiRequestsSeen, demoModeRequests: r.demoModeRequests.length, demoModeResponses: r.demoModeResponses, initiators: r.demoModeInitiators, consoleDemoOr403: r.consoleErrorsMentioningDemoOr403.length, error: r.error }))
}, null, 2));
