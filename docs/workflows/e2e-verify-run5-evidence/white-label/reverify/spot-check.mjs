#!/usr/bin/env node
// Auditor REVERIFY spot-check (read-only) — white-label / partner@fundhub.ai.
//
// Fix-induced side effects of commit 2b1eed0 on the partner role:
//   (a) is /api/demo/mode called on any partner screen (landing, Brand Studio, ops-admin direct)?
//   (b) GET /api/read/messages?status=blocked with the partner token (ops-admin gate)
//   (c) POST {} /api/read/company-brain-affiliate with the partner token (expect 400 question_required)
//   (d) localStorage fh_account after browser login (shape only — keys, kind, id-present flags)
// Also: full API call log per screen (every status, not just 4xx) so a new failing
// endpoint on a screen that was clean in the original ui-walk shows up.
//
// One browser login. Token is read from localStorage into a variable and used for
// three GET/empty-POST calls; it is never printed or written.
//
// Usage: node docs/workflows/e2e-verify-run5-evidence/white-label/reverify/spot-check.mjs
// Output: <this dir>/spot-check.json, spot-check.md, shots/sc-*.png

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = process.cwd();
const BASE = process.env.BASE_URL || "https://fundhub.ai";
const EMAIL = "partner@fundhub.ai";
const OUT_DIR = path.join(ROOT, "docs/workflows/e2e-verify-run5-evidence/white-label/reverify");
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
const mask = (u) => u.replace(BASE, "").replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>");

const out = { ranAt: new Date().toISOString(), base: BASE, email: EMAIL, login: {}, storage: {}, screens: [], api: [] };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 } });
const page = await ctx.newPage();

let calls = [];
let consoleErrors = [];
page.on("response", (res) => {
  const u = res.url();
  if (u.includes("/api/")) calls.push({ method: res.request().method(), url: mask(u), status: res.status() });
});
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(String(m.text()).slice(0, 160)); });
page.on("pageerror", (e) => consoleErrors.push("pageerror: " + String(e?.message || e).slice(0, 160)));

// --- login (the only form submitted) ---------------------------------------
await page.goto(`${BASE}/login.html`, { waitUntil: "domcontentloaded" });
await page.locator('input[type="email"], #email, input[name="email"]').first().fill(EMAIL);
await page.locator('input[type="password"], #password, input[name="password"]').first().fill(password);
calls = []; consoleErrors = [];
await page.locator('button[type="submit"], button:has-text("Sign"), button:has-text("Log")').first().click();
try { await page.waitForURL((u) => !/login\.html/.test(u.toString()), { timeout: 30_000 }); out.login.ok = true; } catch { out.login.ok = false; }
await page.waitForLoadState("networkidle").catch(() => {});
await page.waitForTimeout(2000);
out.login.landedAt = mask(page.url());
out.login.calls = calls.slice();
out.login.consoleErrors = consoleErrors.slice();
out.login.demoModeCalled = calls.some((c) => c.url.startsWith("/api/demo/mode"));

// (d) localStorage shape — keys only, no values except role/kind
out.storage = await page.evaluate(() => {
  const r = { fh_role: localStorage.getItem("fh_role"), fh_token_present: !!localStorage.getItem("fh_token") };
  const raw = localStorage.getItem("fh_account");
  if (raw === null) { r.fh_account = null; }
  else {
    try {
      const a = JSON.parse(raw);
      r.fh_account = {
        keys: Object.keys(a || {}).sort(),
        kind: a && a.kind,
        partnerId_present: !!(a && a.partnerId),
        clientId_present: !!(a && a.clientId),
        affiliateId_present: !!(a && a.affiliateId),
        accountId_present: !!(a && a.accountId),
        orgId_present: !!(a && a.orgId)
      };
    } catch { r.fh_account = { parseError: true }; }
  }
  r.allKeys = Object.keys(localStorage).sort();
  return r;
}).catch((e) => ({ error: String(e) }));

async function screen(label, target, opts = {}) {
  calls = []; consoleErrors = [];
  const rec = { label, target: mask(target) };
  try {
    const resp = await page.goto(target, { waitUntil: "domcontentloaded", timeout: 45_000 });
    rec.httpStatus = resp ? resp.status() : null;
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(2500);
    rec.finalUrl = mask(page.url());
    rec.title = await page.title().catch(() => "");
    if (opts.probeText) {
      for (const [k, sel] of Object.entries(opts.probeText)) {
        rec[k] = (await page.locator(sel).first().innerText({ timeout: 3000 }).catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
      }
    }
    const shot = path.join(SHOTS, `sc-${label}.png`);
    await page.screenshot({ path: shot });
    rec.shot = rel(shot);
  } catch (e) { rec.error = String(e?.message || e).slice(0, 200); }
  rec.calls = calls.slice();
  rec.apiFails = calls.filter((c) => c.status >= 400);
  rec.consoleErrors = consoleErrors.slice(0, 8);
  rec.demoModeCalled = calls.some((c) => c.url.startsWith("/api/demo/mode"));
  out.screens.push(rec);
  return rec;
}

await screen("partner-galaxy", `${BASE}/app/partner-galaxy.html`, { probeText: { footer: "body" } });
await screen("brand-studio", `${BASE}/app/brand-studio.html`, { probeText: { footerBar: "#fh-footer, footer, .footer, body" } });
// Brand Studio partner-mode marker (its footer bar reads "partner brand · <name> · draft" in partner mode)
const bs = out.screens[out.screens.length - 1];
bs.partnerModeMarker = await page.evaluate(() => /partner brand/i.test(document.body.innerText)).catch(() => null);
bs.brandNameField = await page.locator('input#brandName, input[name="brandName"], input[name="brand_name"]').first().inputValue({ timeout: 3000 }).catch(() => "");
// ops-admin: NOT in ROLE_TABS.partner — visited directly only to see whether the
// shell bounces and whether /api/read/messages?status=blocked or /api/demo/mode fires.
await screen("ops-admin-direct", `${BASE}/app/ops-admin.html`);

// --- token-bearing API calls (token stays in-process) ------------------------
const token = await page.evaluate(() => localStorage.getItem("fh_token") || "").catch(() => "");
out.tokenPresent = !!token;
async function call(method, route, body) {
  const headers = { accept: "application/json", authorization: "Bearer " + token };
  if (body !== undefined) headers["content-type"] = "application/json";
  try {
    const res = await fetch(BASE + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text().catch(() => "");
    let err = "", keys = [];
    try { const j = JSON.parse(text); err = j?.error || ""; keys = Object.keys(j || {}).slice(0, 12); } catch { /* not json */ }
    return { method, route, status: res.status, error: String(err).slice(0, 80), keys, bytes: text.length };
  } catch (e) { return { method, route, status: 0, error: String(e?.message || e).slice(0, 80) }; }
}
if (token) {
  out.api.push(await call("GET", "/api/read/messages?status=blocked&limit=30"));
  out.api.push(await call("GET", "/api/read/messages"));
  out.api.push(await call("GET", "/api/demo/mode"));
  out.api.push(await call("POST", "/api/read/company-brain-affiliate", {}));
  out.api.push(await call("GET", "/api/auth/session"));
}

await browser.close();

fs.writeFileSync(path.join(OUT_DIR, "spot-check.json"), JSON.stringify(out, null, 2));

const md = [];
md.push(`# white-label — reverify spot-check (fix side effects)`);
md.push(``);
md.push(`Ran ${out.ranAt} against ${BASE} as \`${EMAIL}\`. One browser login. Read-only (GET + empty-body POST only).`);
md.push(``);
md.push(`| Item | Result |`);
md.push(`|---|---|`);
md.push(`| Sign in | ${out.login.ok ? "left login.html" : "STILL ON login.html"} → ${out.login.landedAt}; api calls during login: ${out.login.calls.map((c) => `${c.method} ${c.url} → ${c.status}`).join(", ") || "—"}; console errors ${out.login.consoleErrors.length} |`);
md.push(`| /api/demo/mode called during login/landing | ${out.login.demoModeCalled ? "YES" : "no"} |`);
md.push(`| localStorage fh_role | ${out.storage.fh_role} |`);
md.push(`| localStorage fh_token present | ${out.storage.fh_token_present} |`);
md.push(`| localStorage fh_account | ${out.storage.fh_account === null ? "absent (null)" : JSON.stringify(out.storage.fh_account)} |`);
md.push(`| localStorage keys | ${(out.storage.allKeys || []).join(", ")} |`);
md.push(``);
md.push(`## Screens (every /api/ call, not just failures)`);
md.push(``);
md.push(`| Screen | HTTP | Final URL | demo/mode called | API calls | 4xx/5xx | Console errors | Shot |`);
md.push(`|---|---|---|---|---|---|---|---|`);
for (const s of out.screens) {
  md.push(`| ${s.label} | ${s.httpStatus ?? "—"} | ${s.finalUrl ?? s.error ?? "—"} | ${s.demoModeCalled ? "YES" : "no"} | ${s.calls.map((c) => `${c.method} ${c.url} → ${c.status}`).join("<br>") || "—"} | ${s.apiFails.length} | ${s.consoleErrors.length ? s.consoleErrors.join("<br>") : "—"} | ${s.shot ?? "—"} |`);
}
md.push(``);
md.push(`Brand Studio partner-mode marker ("partner brand" text present): ${bs.partnerModeMarker} · brand name field: ${bs.brandNameField ? "filled" : "empty"}`);
md.push(``);
md.push(`## Token-bearing API calls (partner token)`);
md.push(``);
md.push(`| Method | Route | Status | Error | Body keys |`);
md.push(`|---|---|---|---|---|`);
for (const a of out.api) md.push(`| ${a.method} | \`${a.route}\` | ${a.status} | ${a.error || "—"} | ${(a.keys || []).join(", ")} |`);
fs.writeFileSync(path.join(OUT_DIR, "spot-check.md"), md.join("\n") + "\n");

console.log(JSON.stringify({ login: { ok: out.login.ok, landedAt: out.login.landedAt, demoModeCalled: out.login.demoModeCalled, calls: out.login.calls }, storage: out.storage, screens: out.screens.map((s) => ({ label: s.label, http: s.httpStatus, finalUrl: s.finalUrl, demoModeCalled: s.demoModeCalled, calls: s.calls, consoleErrors: s.consoleErrors, partnerModeMarker: s.partnerModeMarker, brandNameField: s.brandNameField ? "filled" : undefined })), api: out.api }, null, 2));
