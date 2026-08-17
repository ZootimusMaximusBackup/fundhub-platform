#!/usr/bin/env node
// Auditor re-verify (role-owner-B), READ-ONLY, LIVE site.
// Ticket 2: /app/staff-teams.html footer strip must be a real roster sentence,
// not "[object Promise]". Signs in via /login.html as owner, opens the screen,
// reads #fh-data-banner, counts roster rows, records GET /api/read/staff status.
// Password from gitignored .env, never printed. No names written to output.
//
// Run from repo root:
//   node docs/workflows/e2e-verify-run5-evidence/role-owner/reverify/staff-teams-capture.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const OUT = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(OUT, "../../../../..");
const BASE = "https://fundhub.ai";
const EMAIL = "owner@fundhub.ai";

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
if (!password) { console.error("STAFF_E2E_PASSWORD missing"); process.exit(2); }

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 860 } });

const apiCalls = [];
const consoleErrors = [];
page.on("response", (res) => {
  const u = res.url();
  if (u.includes("/api/")) apiCalls.push({ method: res.request().method(), url: u.replace(BASE, ""), status: res.status() });
});
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(String(m.text()).slice(0, 160)); });
page.on("pageerror", (e) => consoleErrors.push("pageerror: " + String(e?.message || e).slice(0, 160)));

await page.goto(`${BASE}/login.html`, { waitUntil: "domcontentloaded" });
await page.locator('input[type="email"], #email, input[name="email"]').first().fill(EMAIL);
await page.locator('input[type="password"], #password, input[name="password"]').first().fill(password);
await page.locator('button[type="submit"], button:has-text("Sign"), button:has-text("Log")').first().click();
let loginOk = true;
try { await page.waitForURL((u) => !/login\.html/.test(u.toString()), { timeout: 30_000 }); } catch { loginOk = false; }
const loginApi = apiCalls.slice();

apiCalls.length = 0; consoleErrors.length = 0;
const staffWait = page.waitForResponse((r) => r.url().includes("/api/read/staff") && r.request().method() === "GET", { timeout: 25_000 })
  .then((r) => r.status()).catch(() => 0);
await page.goto(`${BASE}/app/staff-teams.html`, { waitUntil: "domcontentloaded" });
const staffStatus = await staffWait;
await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
await page.waitForTimeout(2000);
// give the paint callback a moment past "loading roster…"
await page.waitForFunction(() => {
  const el = document.getElementById("fh-data-banner");
  const t = el ? String(el.textContent || "").trim() : "";
  return t.length > 0 && t !== "loading roster…";
}, { timeout: 10_000 }).catch(() => {});

const footer = await page.evaluate(() => {
  const el = document.getElementById("fh-data-banner");
  return {
    present: !!el,
    text: el ? String(el.textContent || "").trim() : "",
    visible: !!(el && (el.offsetParent !== null || getComputedStyle(el).position === "fixed"))
  };
});
// roster row count only (no names): count table body rows on the page
const roster = await page.evaluate(() => {
  const tables = [...document.querySelectorAll("table")];
  const counts = tables.map((t) => ({ id: t.id || null, rows: t.querySelectorAll("tbody tr").length }));
  return { tables: counts, totalRows: counts.reduce((a, c) => a + c.rows, 0) };
});

const shot = path.join(OUT, "staff-teams-shot.png");
await page.screenshot({ path: shot, fullPage: false });
const finalUrl = page.url().replace(BASE, "");
await browser.close();

const payload = {
  agent: "role-owner-B (claude-fable-5 reverify)",
  email: EMAIL,
  base: BASE,
  ranAt: new Date().toISOString(),
  loginLeftLoginPage: loginOk,
  loginApi,
  finalUrl,
  staffGetStatus: staffStatus,
  apiCalls,
  consoleErrors,
  footer,
  isObjectPromise: footer.text.includes("[object Promise]"),
  startsWithLiveRoster: /^live roster/i.test(footer.text),
  roster,
  shot: "docs/workflows/e2e-verify-run5-evidence/role-owner/reverify/staff-teams-shot.png",
  verdict: (!footer.text.includes("[object Promise]") && /^live roster/i.test(footer.text) && staffStatus === 200) ? "CONFIRMED-FIXED" : "REGRESSION"
};
fs.writeFileSync(path.join(OUT, "staff-teams-footer.json"), JSON.stringify(payload, null, 2) + "\n");
console.log(JSON.stringify({ verdict: payload.verdict, staffGetStatus: staffStatus, footerText: footer.text, roster: roster.totalRows, apiCalls: apiCalls.length, consoleErrors }, null, 2));
