#!/usr/bin/env node
// REVERIFY spot-check (read-only, live site) for role-funding-advisor.
// Signs in through the real login form (password from gitignored .env, never
// printed), then records:
//   (a) every /api/demo/mode call and its status on login, landing, and
//       ops-admin / sample-data / a demo-client-bootstrap screen;
//   (b) the exact status + body shape of GET /api/read/messages?status=blocked
//       on ops-admin.html and what the compliance panel + footer strip say;
//   (d) which localStorage keys login wrote (fh_account / fh_role / fh_token
//       presence only — never values of tokens).
// Nothing is clicked except the login button. No forms other than login.
//
// Usage: node docs/workflows/e2e-verify-run5-evidence/role-funding-advisor/reverify/spot-check.mjs
// Output: reverify/spot-check.json, reverify/spot-check.md, reverify/shots/spot-*.png

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = process.cwd();
const BASE = process.env.BASE_URL || "https://fundhub.ai";
const EMAIL = "advisor@fundhub.ai";
const OUT_DIR = path.join(ROOT, "docs/workflows/e2e-verify-run5-evidence/role-funding-advisor/reverify");
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
const out = { email: EMAIL, base: BASE, ranAt: new Date().toISOString(), screens: {} };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 } });
const page = await ctx.newPage();

let apiLog = [];
let consoleErrors = [];
page.on("response", async (res) => {
  const u = res.url();
  if (!u.includes("/api/")) return;
  const rec = { method: res.request().method(), url: u.replace(BASE, ""), status: res.status() };
  if (/\/api\/read\/messages\?/.test(u)) {
    try {
      const j = await res.json();
      rec.bodyShape = { ok: j?.ok, keys: Object.keys(j || {}).slice(0, 8), itemsLen: Array.isArray(j?.items) ? j.items.length : (Array.isArray(j?.messages) ? j.messages.length : null), error: j?.error || null };
    } catch { rec.bodyShape = "non-json"; }
  }
  apiLog.push(rec);
});
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(String(m.text()).slice(0, 160)); });
page.on("pageerror", (e) => consoleErrors.push("pageerror: " + String(e?.message || e).slice(0, 160)));

function snapshot(name) {
  const demo = apiLog.filter((r) => r.url.startsWith("/api/demo/mode"));
  const fails = apiLog.filter((r) => r.status >= 400);
  out.screens[name] = {
    url: page.url().replace(BASE, ""),
    apiCalls: apiLog.length,
    demoModeCalls: demo.map((r) => `${r.method} ${r.url} -> ${r.status}`),
    api4xx5xx: fails.map((r) => `${r.method} ${r.url} -> ${r.status}`),
    consoleErrors: consoleErrors.slice(0, 8)
  };
  return out.screens[name];
}
async function settle(ms = 2500) {
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(ms);
}

// login
await page.goto(`${BASE}/login.html`, { waitUntil: "domcontentloaded" });
await settle(1000);
apiLog = []; consoleErrors = [];
await page.locator('input[type="email"], #email, input[name="email"]').first().fill(EMAIL);
await page.locator('input[type="password"], #password, input[name="password"]').first().fill(password);
await page.locator('button[type="submit"], button:has-text("Sign"), button:has-text("Log")').first().click();
try { await page.waitForURL((u) => !/login\.html/.test(u.toString()), { timeout: 30_000 }); } catch { /* fallthrough */ }
await settle();
const landing = snapshot("login+landing");
landing.leftLogin = !/login\.html/.test(page.url());
// (d) localStorage keys — presence + shape only, never token values
landing.localStorage = await page.evaluate(() => {
  const keys = Object.keys(localStorage).filter((k) => k.startsWith("fh_")).sort();
  const acct = localStorage.getItem("fh_account");
  let acctShape = null;
  if (acct !== null) {
    try { const j = JSON.parse(acct); acctShape = { type: typeof j, keys: j && typeof j === "object" ? Object.keys(j) : null, clientIdPresent: !!(j && j.clientId) }; }
    catch { acctShape = { type: "unparseable", length: acct.length }; }
  }
  return {
    fhKeys: keys,
    fh_role: localStorage.getItem("fh_role"),
    fh_token_present: !!localStorage.getItem("fh_token"),
    fh_account_present: acct !== null,
    fh_account_shape: acctShape
  };
}).catch((e) => ({ error: String(e) }));
await page.screenshot({ path: path.join(SHOTS, "spot-01-landing.png") });

// ops-admin (b)
apiLog = []; consoleErrors = [];
await page.goto(`${BASE}/app/ops-admin.html`, { waitUntil: "domcontentloaded" });
await settle(3000);
const ops = snapshot("ops-admin.html");
ops.messagesBlocked = apiLog.filter((r) => /\/api\/read\/messages\?/.test(r.url));
ops.complianceTableText = (await page.locator("#compliance-blocked-table").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 300);
ops.bodyHasLoadingBlocked = /Loading blocked messages/i.test(await page.locator("body").innerText().catch(() => ""));
ops.footerStripText = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").match(/sample [^·]{0,80}(·[^·]{0,80}){0,4}/)?.[0]?.slice(0, 300) || null;
ops.bannerTexts = await page.evaluate(() => [...document.querySelectorAll("[data-fh-banner], .fh-banner, .banner, [role=status]")].map((e) => (e.textContent || "").trim().replace(/\s+/g, " ").slice(0, 120)).filter(Boolean).slice(0, 12)).catch(() => []);
await page.screenshot({ path: path.join(SHOTS, "spot-02-ops-admin.png"), fullPage: true });

// sample-data (a) — page-level demo/mode call
apiLog = []; consoleErrors = [];
await page.goto(`${BASE}/app/sample-data.html`, { waitUntil: "domcontentloaded" });
await settle();
const sd = snapshot("sample-data.html");
sd.limitedLine = /limited to owner, admin/i.test(await page.locator("body").innerText().catch(() => ""));
await page.screenshot({ path: path.join(SHOTS, "spot-03-sample-data.png") });

// closer-dashboard (a) — demo-client-bootstrap.js call
apiLog = []; consoleErrors = [];
await page.goto(`${BASE}/app/closer-dashboard.html`, { waitUntil: "domcontentloaded" });
await settle();
snapshot("closer-dashboard.html");

// pipeline (a) — a plain shell screen, should be 0 demo/mode calls now
apiLog = []; consoleErrors = [];
await page.goto(`${BASE}/app/pipeline.html`, { waitUntil: "domcontentloaded" });
await settle();
snapshot("pipeline.html");
await page.screenshot({ path: path.join(SHOTS, "spot-04-pipeline.png") });

await browser.close();
fs.writeFileSync(path.join(OUT_DIR, "spot-check.json"), JSON.stringify(out, null, 2));

const md = [];
md.push(`# role-funding-advisor — reverify spot-check`);
md.push(``);
md.push(`Ran ${out.ranAt} against ${BASE} as \`${EMAIL}\`.`);
md.push(``);
md.push(`| Screen | API calls | /api/demo/mode calls | API 4xx/5xx | Console errors |`);
md.push(`|---|---|---|---|---|`);
for (const [k, v] of Object.entries(out.screens)) md.push(`| ${k} | ${v.apiCalls} | ${v.demoModeCalls.length ? v.demoModeCalls.join("<br>") : "none"} | ${v.api4xx5xx.length ? v.api4xx5xx.join("<br>") : "none"} | ${v.consoleErrors.length} |`);
md.push(``);
md.push(`## login localStorage (presence only)`);
md.push(``);
md.push("```json\n" + JSON.stringify(out.screens["login+landing"].localStorage, null, 2) + "\n```");
md.push(``);
md.push(`## ops-admin GET /api/read/messages?status=blocked`);
md.push(``);
md.push("```json\n" + JSON.stringify({ messagesBlocked: ops.messagesBlocked, complianceTableText: ops.complianceTableText, bodyHasLoadingBlocked: ops.bodyHasLoadingBlocked, footerStripText: ops.footerStripText, bannerTexts: ops.bannerTexts }, null, 2) + "\n```");
md.push(``);
md.push(`Shots: ${rel(path.join(SHOTS, "spot-01-landing.png"))}, spot-02-ops-admin.png, spot-03-sample-data.png, spot-04-pipeline.png`);
fs.writeFileSync(path.join(OUT_DIR, "spot-check.md"), md.join("\n") + "\n");
console.log(fs.readFileSync(path.join(OUT_DIR, "spot-check.md"), "utf8"));
