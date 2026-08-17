#!/usr/bin/env node
// Auditor re-verify (role-owner-B), READ-ONLY, LIVE site.
// Ticket 4: Ops & Admin compliance gate panel. Two checks:
//   A) Browser: sign in via /login.html as owner, open /app/ops-admin.html,
//      record every /api call + status, read #compliance-blocked-table text
//      (assert "Loading blocked messages" gone; rows or empty state), count rows.
//   B) Direct API: POST /api/auth/login (JSON) → bearer token →
//      GET /api/read/messages?status=blocked&limit=30 ; record status + shape only.
// Password from gitignored .env, never printed. No message contents/PII saved.
//
// Run from repo root:
//   node docs/workflows/e2e-verify-run5-evidence/role-owner/reverify/messages-capture.mjs

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

// ---------- A) browser ----------
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 860 } });
const apiCalls = [];
const consoleErrors = [];
page.on("response", async (res) => {
  const u = res.url();
  if (!u.includes("/api/")) return;
  const rec = { method: res.request().method(), url: u.replace(BASE, ""), status: res.status() };
  if (u.includes("/api/read/messages")) {
    try {
      const b = await res.json();
      rec.shape = { ok: !!(b && b.ok), keys: b && typeof b === "object" ? Object.keys(b).slice(0, 10) : [], itemsLength: b && Array.isArray(b.items) ? b.items.length : null, count: b && typeof b.count === "number" ? b.count : null };
    } catch { rec.shape = null; }
  }
  apiCalls.push(rec);
});
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(String(m.text()).slice(0, 160)); });
page.on("pageerror", (e) => consoleErrors.push("pageerror: " + String(e?.message || e).slice(0, 160)));

await page.goto(`${BASE}/login.html`, { waitUntil: "domcontentloaded" });
await page.locator('input[type="email"], #email, input[name="email"]').first().fill(EMAIL);
await page.locator('input[type="password"], #password, input[name="password"]').first().fill(password);
await page.locator('button[type="submit"], button:has-text("Sign"), button:has-text("Log")').first().click();
let loginOk = true;
try { await page.waitForURL((u) => !/login\.html/.test(u.toString()), { timeout: 30_000 }); } catch { loginOk = false; }

apiCalls.length = 0; consoleErrors.length = 0;
await page.goto(`${BASE}/app/ops-admin.html`, { waitUntil: "domcontentloaded" });
await page.waitForLoadState("networkidle", { timeout: 25_000 }).catch(() => {});
await page.waitForTimeout(3000);
// wait a little longer if the panel is still Loading (fetch may lag)
await page.waitForFunction(() => {
  const t = document.getElementById("compliance-blocked-table");
  return !!t && !/Loading blocked messages/i.test(t.innerText || "");
}, { timeout: 15_000 }).catch(() => {});

const panel = await page.evaluate(() => {
  const t = document.getElementById("compliance-blocked-table");
  const text = t ? (t.innerText || "") : "";
  const bodyRows = t ? [...t.querySelectorAll("tbody tr")] : [];
  // a data row = a tbody tr with more than one cell (empty/loading states use a single spanning cell)
  const dataRows = bodyRows.filter((tr) => tr.querySelectorAll("td").length > 1).length;
  return {
    present: !!t,
    headerText: text.split("\n")[0]?.trim() || "",
    hasLoading: /Loading blocked messages/i.test(text),
    hasEmpty: /No messages stopped by the compliance gate/i.test(text),
    hasError: /Could not load stopped messages/i.test(text),
    tbodyRows: bodyRows.length,
    dataRows,
    // only the state sentence, never message contents
    stateSentence: (text.match(/No messages stopped by the compliance gate|Could not load stopped messages[^\n]*|Loading blocked messages[^\n]*/i) || [""])[0]
  };
});
const shot = path.join(OUT, "ops-admin-shot.png");
await page.screenshot({ path: shot, fullPage: true });
const finalUrl = page.url().replace(BASE, "");
await browser.close();

const network = {
  agent: "role-owner-B (claude-fable-5 reverify)",
  email: EMAIL, base: BASE, ranAt: new Date().toISOString(),
  loginLeftLoginPage: loginOk, finalUrl,
  apiCalls, apiFails: apiCalls.filter((c) => c.status >= 400),
  messagesBlockedCall: apiCalls.find((c) => /\/api\/read\/messages\?[^ ]*status=blocked/.test(c.url)) || null,
  consoleErrors, panel,
  shot: "docs/workflows/e2e-verify-run5-evidence/role-owner/reverify/ops-admin-shot.png"
};
fs.writeFileSync(path.join(OUT, "messages-network.json"), JSON.stringify(network, null, 2) + "\n");

// ---------- B) direct API ----------
const loginRes = await fetch(BASE + "/api/auth/login", {
  method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
  body: JSON.stringify({ email: EMAIL, password })
});
const loginBody = await loginRes.json().catch(() => ({}));
const token = loginBody?.token || "";
const api = { agent: "role-owner-B (claude-fable-5 reverify)", base: BASE, ranAt: new Date().toISOString(), login: { status: loginRes.status, ok: !!loginBody?.ok, tokenPresent: !!token, role: loginBody?.staff?.role || null } };
if (token) {
  const r = await fetch(BASE + "/api/read/messages?status=blocked&limit=30", { headers: { authorization: "Bearer " + token, accept: "application/json" } });
  const b = await r.json().catch(() => null);
  api.messagesBlocked = {
    url: "/api/read/messages?status=blocked&limit=30",
    status: r.status,
    ok: !!(b && b.ok),
    topLevelKeys: b && typeof b === "object" ? Object.keys(b).slice(0, 12) : [],
    itemsLength: b && Array.isArray(b.items) ? b.items.length : null,
    count: b && typeof b.count === "number" ? b.count : null,
    error: b && b.error ? String(b.error).slice(0, 80) : null
  };
} else {
  api.messagesBlocked = { error: "no token from login" };
}
api.verdict = (api.messagesBlocked.status === 200 && !panel.hasLoading && (panel.hasEmpty || panel.dataRows > 0)) ? "CONFIRMED-FIXED" : "REGRESSION";
fs.writeFileSync(path.join(OUT, "messages-api.json"), JSON.stringify(api, null, 2) + "\n");

console.log(JSON.stringify({ verdict: api.verdict, api: api.messagesBlocked, panel, browserMessagesCall: network.messagesBlockedCall, apiFails: network.apiFails, consoleErrors }, null, 2));
