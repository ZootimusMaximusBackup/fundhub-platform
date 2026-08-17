#!/usr/bin/env node
// Auditor re-verify (read-only) — client portal screen detail on LIVE.
// One login. Records the visible text around the three reads that answered 401
// in capture-live.mjs (dashboard/client, consent/capture, read/documents), the
// chat widget, and re-asserts the "Open this from a client file" absence.
// Nothing clicked except the login form.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const OUT = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(OUT, "../../../../..");
const BASE = "https://fundhub.ai";
const EMAIL = "client@fundhub.ai";

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

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 860 } });
const api = [];
page.on("response", (res) => { const u = res.url(); if (u.includes("/api/")) api.push({ method: res.request().method(), url: u.replace(BASE, ""), status: res.status(), hasAuthHeader: !!res.request().headers()["authorization"] }); });

await page.goto(`${BASE}/login.html`, { waitUntil: "domcontentloaded" });
await page.locator('input[type="email"], #email').first().fill(EMAIL);
await page.locator('input[type="password"], #pw').first().fill(password);
await page.locator('button[type="submit"]').first().click();
await page.waitForURL((u) => !/login\.html/.test(u.toString()), { timeout: 30_000 });
await page.waitForLoadState("networkidle").catch(() => {});
await page.waitForTimeout(2000);

const detail = await page.evaluate(() => {
  const t = (sel) => { const el = document.querySelector(sel); return el ? (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 300) : null; };
  const vis = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  return {
    url: location.pathname,
    greeting: t("#greeting"),
    whoName: t("#who-name"),
    banner: t("#fh-data-banner"),
    disclosure: t("#cpDisclosure"),
    disclosureVisible: vis("#cpDisclosure"),
    chatWidgetText: t("#fh-chat, .fh-chat, [id*=chat]"),
    hasOpenFromClientFile: /Open this from a client file/i.test(document.body.innerText),
    hasWelcomeBack: /Welcome back, TEST/.test(document.body.innerText),
    hasSampleDocuments: /sample documents/i.test(document.body.innerText),
    signOutVisible: !!Array.from(document.querySelectorAll("button, a")).find((b) => /sign out/i.test(b.textContent || ""))
  };
});
await page.screenshot({ path: path.join(OUT, "02-landing-full.png"), fullPage: true });
await browser.close();

const fails = api.filter((r) => r.status >= 400);
const out = { ranAt: new Date().toISOString(), base: BASE, email: EMAIL, detail, apiTotal: api.length, apiFails: fails, shot: "docs/workflows/e2e-verify-run5-evidence/client/reverify/02-landing-full.png" };
fs.writeFileSync(path.join(OUT, "screen-detail.json"), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out, null, 2));
