#!/usr/bin/env node
// Live prove for the three named fixes. Writes shots + prove.json.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = process.cwd();
const BASE = process.env.BASE_URL || "https://fundhub.ai";
const OUT = path.join(ROOT, "docs/workflows/fixer-three-2026-08-17-evidence");
const SHOTS = path.join(OUT, "shots");
fs.mkdirSync(SHOTS, { recursive: true });

function loadEnv(key) {
  if (process.env[key]) return process.env[key];
  const p = path.join(ROOT, ".env");
  if (!fs.existsSync(p)) return "";
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(new RegExp("^\\s*(?:export\\s+)?" + key + "\\s*=\\s*(.*)\\s*$"));
    if (m) return m[1].replace(/^["']|["']$/g, "");
  }
  return "";
}

const password = loadEnv("STAFF_E2E_PASSWORD");
if (!password) {
  console.error("STAFF_E2E_PASSWORD missing");
  process.exit(2);
}

const email = process.env.STAFF_E2E_EMAIL || "owner@fundhub.ai";
const out = { ranAt: new Date().toISOString(), base: BASE, email, items: {} };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

await page.goto(`${BASE}/login.html`, { waitUntil: "domcontentloaded" });
await page.locator('input[type="email"], #email, input[name="email"]').first().fill(email);
await page.locator('input[type="password"], #password, input[name="password"]').first().fill(password);
await page.locator('button[type="submit"], button:has-text("Sign"), button:has-text("Log")').first().click();
await page.waitForURL((u) => !/login\.html/.test(u.href), { timeout: 30_000 });
out.loginUrl = page.url();

/* 1 — Campaigns partner dropdown */
await page.goto(`${BASE}/app/campaign-manager.html`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
const partnerSel = page.locator("#partnerSel");
const partnerHtml = await partnerSel.innerHTML().catch(() => "");
const partnerDisabled = await partnerSel.isDisabled().catch(() => true);
const partnerOptions = await partnerSel.locator("option").allTextContents().catch(() => []);
await page.screenshot({ path: path.join(SHOTS, "01-campaigns-dropdown.png"), fullPage: true });
out.items.campaigns = {
  optionCount: partnerOptions.length,
  options: partnerOptions.slice(0, 12),
  disabled: partnerDisabled,
  couldNotLoad: /Could not load partners/i.test(partnerHtml)
};

const firstReal = partnerOptions.find((t, i) => i > 0 && t && !/could not|no partners|choose/i.test(t));
if (firstReal && !out.items.campaigns.couldNotLoad) {
  const val = await partnerSel.locator("option").nth(1).getAttribute("value");
  if (val) {
    await partnerSel.selectOption(val);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(SHOTS, "01b-campaigns-after-pick.png"), fullPage: true });
    out.items.campaigns.afterPickUrl = page.url();
    out.items.campaigns.afterPickHasPartner = /partner_id=/.test(page.url());
  }
}

/* 2 — Command Center tiles */
const kpiRes = await page.evaluate(async () => {
  const t = localStorage.getItem("fh_token") || "";
  const r = await fetch("/api/dashboard/kpis?period=today", {
    headers: t ? { accept: "application/json", authorization: "Bearer " + t } : { accept: "application/json" }
  });
  const body = await r.json().catch(() => ({}));
  return { ok: body.ok === true, display: body.display || null, kpis: body.kpis || null };
});
await page.goto(`${BASE}/app/command-center.html`, { waitUntil: "networkidle" });
await page.waitForTimeout(2000);
const tileVals = await page.locator(".kpi-grid .kpi-tile .kpi-value").allTextContents();
const tileLabels = await page.locator(".kpi-grid .kpi-tile .kpi-label").allTextContents();
await page.screenshot({ path: path.join(SHOTS, "02-command-center-kpis.png") });
out.items.commandCenter = {
  apiOk: kpiRes.ok,
  apiDisplay: kpiRes.display,
  apiKpis: kpiRes.kpis && {
    cash_collected_cents: kpiRes.kpis.cash_collected_cents,
    close_rate: kpiRes.kpis.close_rate,
    funded_count: kpiRes.kpis.funded_count,
    booked_count: kpiRes.kpis.booked_count
  },
  painted: tileLabels.map((l, i) => ({ label: l, value: tileVals[i] ?? "" }))
};

/* 3 — Content */
const contentRes = await page.evaluate(async () => {
  const t = localStorage.getItem("fh_token") || "";
  const r = await fetch("/api/content/tiles", {
    headers: t ? { accept: "application/json", authorization: "Bearer " + t } : { accept: "application/json" }
  });
  const body = await r.json().catch(() => ({}));
  return { ok: body.ok === true, message: body.message || body.error || null, tileCount: (body.tiles || []).length };
});
await page.goto(`${BASE}/app/content-admin.html`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
const saveVisible = await page.locator("#saveBtn").isVisible().catch(() => false);
const uploadVisible = await page.locator("#uploadBox").isVisible().catch(() => false);
const notice = await page.locator("#noticeTxt").textContent().catch(() => "");
await page.screenshot({ path: path.join(SHOTS, "03-content.png"), fullPage: true });
out.items.content = { apiOk: contentRes.ok, apiMessage: contentRes.message, tileCount: contentRes.tileCount, saveVisible, uploadVisible, notice };

fs.writeFileSync(path.join(OUT, "prove.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await browser.close();
