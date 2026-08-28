#!/usr/bin/env node
/**
 * Hole 1 VERIFY only. Live click CCP + Fulfillment for Sim Fund Horse27.
 * No CRS. No charge. No outbound. Credentials from gitignored .env.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const EVIDENCE = path.join(ROOT, "docs/workflows/e2e-round-2026-08-27-evidence/hole1");
const BASE = "https://fundhub.ai";
const CLIENT_ID = "89f1a12f-f824-4451-9a53-5705b55374ca";

function loadDotEnv() {
  const p = path.join(ROOT, ".env");
  if (!fs.existsSync(p)) throw new Error(".env missing");
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (k && process.env[k] == null) process.env[k] = v;
  }
}
loadDotEnv();

function chromiumPath() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const homeCache = path.join(process.env.HOME || "", "Library/Caches/ms-playwright");
  if (!fs.existsSync(homeCache)) return undefined;
  const dirs = fs.readdirSync(homeCache)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  const rels = [
    "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    "chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
  ];
  for (const d of dirs) {
    for (const rel of rels) {
      const exe = path.join(homeCache, d, rel);
      if (fs.existsSync(exe)) return exe;
    }
  }
  return undefined;
}

fs.mkdirSync(EVIDENCE, { recursive: true });

async function main() {
  const password = process.env.STAFF_E2E_PASSWORD;
  if (!password) throw new Error("STAFF_E2E_PASSWORD missing");

  const browser = await chromium.launch({
    headless: true,
    executablePath: chromiumPath()
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const request = context.request;

  const loginRes = await request.post(`${BASE}/api/auth/login`, {
    data: { email: "chris@fundhub.ai", password }
  });
  const loginBody = await loginRes.json();
  const token = loginBody.token;
  if (!token) {
    console.log(JSON.stringify({ login_ok: false, status: loginRes.status() }));
    await browser.close();
    process.exit(1);
  }

  const dashRes = await request.get(`${BASE}/api/dashboard/client?id=${CLIENT_ID}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const dash = await dashRes.json();
  const c = dash.client || {};
  const cf = c.custom_fields || {};
  const tm = dash.tri_merge || {};
  const apiFacts = {
    dash_status: dashRes.status(),
    name: [c.first_name, c.last_name].filter(Boolean).join(" "),
    lifecycle_status: cf.lifecycle_status || null,
    employee_next_action: cf.employee_next_action || null,
    round_hold_reason: cf.round_hold_reason || null,
    crs_status: cf.crs_status || null,
    next_action: dash.next_action || dash.fulfillment?.next_action || null,
    degraded: dash.next_action_degraded ?? dash.fulfillment?.degraded ?? dash.degraded ?? null,
    blockers: dash.active_blockers || dash.open_blockers || dash.fulfillment?.active_blockers || [],
    scores: {
      experian: tm.experian ?? null,
      equifax: tm.equifax ?? null,
      transunion: tm.transunion ?? null
    },
    tasks: (dash.tasks || []).map((t) => t.title).slice(0, 12)
  };

  const listRes = await request.get(`${BASE}/api/dashboard/clients?limit=200&fulfillment=1`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const listBody = await listRes.json();
  const items = listBody.clients || listBody.items || listBody.data || [];
  const listRow = items.find((row) => row.id === CLIENT_ID) || null;
  apiFacts.list_row = listRow
    ? {
      name: [listRow.first_name, listRow.last_name].filter(Boolean).join(" "),
      next_action: listRow.next_action || null,
      degraded: listRow.next_action_degraded ?? null,
      blockers: listRow.active_blockers || listRow.blockers || [],
      lifecycle_status: listRow.custom_fields?.lifecycle_status || listRow.lifecycle_status || null
    }
    : { missing: true, list_status: listRes.status(), n: items.length };

  const page = await context.newPage();
  await page.goto(`${BASE}/login.html`, { waitUntil: "domcontentloaded" });
  await page.evaluate((t) => {
    localStorage.removeItem("fh_demo");
    localStorage.removeItem("fh_demo_staff");
    localStorage.setItem("fh_token", t);
    localStorage.setItem("fh_session", t);
  }, token);

  await page.goto(`${BASE}/app/client-control-panel.html?id=${CLIENT_ID}`, {
    waitUntil: "domcontentloaded"
  });
  await page.waitForFunction(() => {
    const n = document.getElementById("ccp-name");
    return n && /Horse27/i.test(n.textContent || "");
  }, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.screenshot({
    path: path.join(EVIDENCE, "verify-ccp-1.png"),
    fullPage: true
  });

  const ccp = await page.evaluate(() => {
    function txt(id) {
      const el = document.getElementById(id);
      return el ? (el.innerText || el.textContent || "").trim() : "";
    }
    const body = document.body ? document.body.innerText : "";
    return {
      url: location.href,
      title: document.title,
      name: txt("ccp-name"),
      status: txt("ccp-status"),
      next: txt("ccp-next-action"),
      saved: txt("ccp-saved"),
      hold: txt("ccp-hold-reason"),
      credit: txt("ccp-credit-status"),
      scores: txt("ccp-scores"),
      facts_scores: txt("ccp-facts-scores"),
      blockers: txt("ccp-blocker-list"),
      body_snip: body.replace(/\s+/g, " ").slice(0, 4000)
    };
  });

  await page.goto(`${BASE}/app/pipeline.html`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  const fulfillBtn = page.locator("#lensFulfillment");
  if (await fulfillBtn.count()) {
    await fulfillBtn.click();
  }
  await page.waitForFunction(() => {
    return document.querySelectorAll(".fh-lens-row").length > 0;
  }, { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(1000);

  const fulfill = await page.evaluate((id) => {
    const row = document.querySelector(`.fh-lens-row[data-client-id="${id}"]`);
    const body = document.body ? document.body.innerText : "";
    return {
      url: location.href,
      lens_on: document.getElementById("lensFulfillment")?.getAttribute("aria-pressed") || "",
      row_count: document.querySelectorAll(".fh-lens-row").length,
      horse_text: row ? (row.innerText || "").trim() : "",
      horse_chip: row ? (row.querySelector(".fh-chip")?.textContent || "").trim() : "",
      horse_why: row ? (row.querySelector(".lr-why")?.textContent || "").trim() : "",
      horse_blockers: row
        ? Array.from(row.querySelectorAll(".lr-blocker")).map((el) => (el.textContent || "").trim())
        : [],
      body_has_horse: /Horse27/i.test(body)
    };
  }, CLIENT_ID);

  if (fulfill.horse_text) {
    await page.locator(`.fh-lens-row[data-client-id="${CLIENT_ID}"]`).first().scrollIntoViewIfNeeded();
  }
  await page.screenshot({
    path: path.join(EVIDENCE, "verify-fulfillment-1.png"),
    fullPage: true
  });

  const out = {
    at: new Date().toISOString(),
    login_ok: true,
    apiFacts,
    ccp,
    fulfill
  };
  fs.writeFileSync(path.join(EVIDENCE, "verify.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify({
    login_ok: true,
    apiFacts,
    ccp: {
      url: ccp.url,
      name: ccp.name,
      status: ccp.status,
      next: ccp.next,
      saved: ccp.saved,
      hold: ccp.hold,
      credit: ccp.credit,
      scores: ccp.scores,
      blockers: ccp.blockers,
      has_new_lead: /New Lead/i.test(ccp.body_snip || ""),
      has_pull_crs: /Pull CRS/i.test(ccp.body_snip || ""),
      has_no_step: /No step applies/i.test(ccp.body_snip || ""),
      has_crs_incomplete: /CRS incomplete/i.test(ccp.body_snip || "")
    },
    fulfill
  }, null, 2));

  await browser.close();
}

main().catch((err) => {
  console.error(String(err && err.message ? err.message : err));
  process.exit(1);
});
