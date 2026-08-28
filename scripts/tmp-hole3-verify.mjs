#!/usr/bin/env node
/**
 * Hole 3 VERIFY only. Live Pipeline R-08 + search for Sim WL Book E2e27.
 * No CRS. No charge. No remint. Credentials from gitignored .env.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const EVIDENCE = path.join(ROOT, "docs/workflows/e2e-round-2026-08-27-evidence/hole3");
const BASE = "https://fundhub.ai";
const PARTNER_ID = "ed962d4b-e373-444d-8e47-8a156446d5be";

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

  const headers = { Authorization: `Bearer ${token}` };
  const boardRes = await request.get(`${BASE}/api/dashboard/pipeline?key=affiliates_white_label`, { headers });
  const board = await boardRes.json();
  const countsRes = await request.get(`${BASE}/api/dashboard/pipeline-counts`, { headers });
  const counts = await countsRes.json();
  const searchRes = await request.get(`${BASE}/api/read/search?q=${encodeURIComponent("Sim WL Book E2e27")}`, { headers });
  const search = await searchRes.json();
  const search2Res = await request.get(`${BASE}/api/read/search?q=${encodeURIComponent("Sim Wlabel E2e27")}`, { headers });
  const search2 = await search2Res.json();

  const page = await context.newPage();
  await page.goto(`${BASE}/login.html`, { waitUntil: "domcontentloaded" });
  await page.evaluate((t) => {
    localStorage.setItem("fh_token", t);
    localStorage.setItem("fh_role", "owner");
  }, token);
  await page.goto(`${BASE}/app/pipeline.html`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const r08 = page.locator('[data-rail="R-08"]');
  await r08.click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(EVIDENCE, "verify-r08-empty.png"), fullPage: true });
  const boardText = await page.locator("body").innerText();

  await page.locator("#q").fill("Sim WL Book E2e27");
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(EVIDENCE, "verify-r08-search.png"), fullPage: true });
  const searchText = await page.locator("body").innerText();

  const stages = Array.isArray(board.stages) ? board.stages.map((s) => ({
    key: s.key,
    name: s.name,
    count: s.count,
    cards: (s.cards || []).map((c) => c.name)
  })) : [];
  const totalCards = stages.reduce((n, s) => n + (s.count || 0), 0);
  const groups = search.groups || {};
  const groupCounts = {
    clients: (groups.clients || []).length,
    contracts: (groups.contracts || []).length,
    documents: (groups.documents || []).length,
    conversations: (groups.conversations || []).length,
    cards: (groups.cards || []).length
  };

  const out = {
    partner_id: PARTNER_ID,
    login_ok: true,
    board_status: boardRes.status(),
    board_ok: !!board.ok,
    board_total: board.total,
    stages,
    total_cards: totalCards,
    rail_count: counts.counts && counts.counts.affiliates_white_label,
    search_book: groupCounts,
    search_person_clients: ((search2.groups || {}).clients || []).length,
    search_person_cards: ((search2.groups || {}).cards || []).length,
    board_says_empty: /nobody has been placed here/i.test(boardText),
    search_ui: searchText.includes("Sim WL Book") ? "name_visible" : "name_not_on_cards"
  };
  fs.writeFileSync(path.join(EVIDENCE, "verify.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));

  await browser.close();
}

main().catch((err) => {
  console.error(String(err && err.message ? err.message : err));
  process.exit(1);
});
