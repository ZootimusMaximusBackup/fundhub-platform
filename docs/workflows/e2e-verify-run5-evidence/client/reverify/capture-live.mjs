#!/usr/bin/env node
// Auditor re-verify (read-only) — client S4 landing, on the LIVE site.
// Opens https://fundhub.ai/login.html in real Chromium, signs in as the
// client login (password from gitignored .env, never printed, token never
// written), waits to leave login.html + network idle, then records:
//   (a) final URL  (b) localStorage fh_account presence + clientId UUID check
//   (c) every /api/ request+status made by the portal  (d) greeting / who-name /
//   banner text  (e) "Open this from a client file" absent from body innerText
//   (f) screenshot 01-landing.png
// Nothing is clicked except the login form. No other form is submitted.
//
// Usage: node docs/workflows/e2e-verify-run5-evidence/client/reverify/capture-live.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const OUT = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(OUT, "../../../../..");
const BASE = "https://fundhub.ai"; // LIVE only — never localhost
const EMAIL = "client@fundhub.ai";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 } });
const page = await ctx.newPage();

const network = [];        // every /api/ response (url without host, method, status)
const consoleErrors = [];
let portalSummary = null;  // last GET /api/read/portal-summary response (status + shape only)

page.on("response", async (res) => {
  const u = res.url();
  if (!u.includes("/api/")) return;
  const rec = { method: res.request().method(), url: u.replace(BASE, ""), status: res.status() };
  network.push(rec);
  if (u.includes("/api/read/portal-summary") && res.request().method() === "GET") {
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    portalSummary = {
      url: rec.url,
      status: rec.status,
      topLevelKeys: body && typeof body === "object" ? Object.keys(body) : null,
      ok: body?.ok ?? null,
      prequal_amount: body?.prequal_amount ?? null,
      prequal_display: body?.prequal_display ?? null,
      soft_pull_complete: body?.soft_pull_complete ?? null,
      error: body?.error ?? null
    };
  }
});
page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(String(msg.text()).slice(0, 160)); });
page.on("pageerror", (err) => consoleErrors.push("pageerror: " + String(err?.message || err).slice(0, 160)));

// Step 1 — live login page, sign in
await page.goto(`${BASE}/login.html`, { waitUntil: "domcontentloaded" });
const loginPageUrl = page.url();
await page.locator('input[type="email"], #email, input[name="email"]').first().fill(EMAIL);
await page.locator('input[type="password"], #password, #pw, input[name="password"]').first().fill(password);
await page.locator('button[type="submit"], button:has-text("Sign"), button:has-text("Log")').first().click();
let leftLogin = false;
try {
  await page.waitForURL((u) => !/login\.html/.test(u.toString()), { timeout: 30_000 });
  leftLogin = true;
} catch { leftLogin = false; }
await page.waitForLoadState("networkidle").catch(() => {});
// give the portal one more beat to finish its reads
await page.waitForResponse((r) => r.url().includes("/api/read/portal-summary"), { timeout: 15_000 }).catch(() => {});
await page.waitForLoadState("networkidle").catch(() => {});
await page.waitForTimeout(1500);

// (a) final URL
const finalUrl = page.url().replace(BASE, "");

// (b) localStorage fh_account
const storage = await page.evaluate(() => {
  const raw = localStorage.getItem("fh_account");
  let parsed = null, parseError = null;
  try { parsed = raw ? JSON.parse(raw) : null; } catch (e) { parseError = String(e && e.message); }
  return {
    fh_role: localStorage.getItem("fh_role"),
    fh_token_present: !!localStorage.getItem("fh_token"),
    fh_account_present: raw !== null,
    fh_account_rawLength: raw ? raw.length : 0,
    fh_account_keys: parsed && typeof parsed === "object" ? Object.keys(parsed) : null,
    clientId: parsed ? (parsed.clientId ?? parsed.client_id ?? null) : null,
    kind: parsed ? (parsed.kind ?? null) : null,
    parseError
  };
});
const clientIdIsUuid = typeof storage.clientId === "string" && UUID_RE.test(storage.clientId);

// (d) page text
const landing = await page.evaluate(() => {
  const t = (id) => ((document.getElementById(id) || {}).textContent || "").trim().replace(/\s+/g, " ");
  const bannerEl = document.getElementById("fh-data-banner");
  return {
    title: document.title,
    greeting: t("greeting"),
    greetingSubPre: t("greeting-sub-pre"),
    greetingSub: t("greeting-sub"),
    whoName: t("who-name"),
    prequal: t("sb-prequal-amt"),
    banner: bannerEl ? (bannerEl.textContent || "").trim().replace(/\s+/g, " ") : "",
    bannerPresent: !!bannerEl
  };
});

// (e) forbidden text
const bodyText = await page.locator("body").innerText().catch(() => "");
const openFromClientFilePresent = /Open this from a client file/i.test(bodyText);

// (f) screenshot
const shot = path.join(OUT, "01-landing.png");
await page.screenshot({ path: shot, fullPage: false });

await browser.close();

const apiFails = network.filter((r) => r.status >= 400);
const summaryHits = network.filter((r) => r.url.includes("/api/read/portal-summary"));

fs.writeFileSync(path.join(OUT, "portal-network.json"), JSON.stringify({ base: BASE, requests: network, fails: apiFails }, null, 2) + "\n");
fs.writeFileSync(path.join(OUT, "portal-summary.json"), JSON.stringify(portalSummary, null, 2) + "\n");

const verdictOk = clientIdIsUuid && portalSummary?.status === 200 && !openFromClientFilePresent && /client-portal\.html/.test(finalUrl);
const capture = {
  email: EMAIL,
  html: "LIVE " + BASE + "/login.html (real Chromium, no local files, no proxy)",
  base: BASE,
  ranAt: new Date().toISOString(),
  loginPageUrl: loginPageUrl.replace(BASE, ""),
  leftLogin,
  finalUrl,
  storage,
  clientIdIsUuid,
  landing,
  openFromClientFilePresent,
  api: { total: network.length, fails: apiFails, portalSummaryHits: summaryHits.length, portalSummaryStatus: portalSummary?.status ?? null },
  consoleErrors: consoleErrors.slice(0, 10),
  verdict: verdictOk ? "CONFIRMED-FIXED" : "REGRESSION",
  shot: "docs/workflows/e2e-verify-run5-evidence/client/reverify/01-landing.png"
};
fs.writeFileSync(path.join(OUT, "capture.json"), JSON.stringify(capture, null, 2) + "\n");
console.log(JSON.stringify(capture, null, 2));
