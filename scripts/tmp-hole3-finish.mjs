#!/usr/bin/env node
/**
 * Hole 3 FINISH. Open live Pipeline R-08 twice for Sim WL Book E2e27.
 * No CRS. No charge. No remint.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const EVIDENCE = path.join(ROOT, "docs/workflows/e2e-round-2026-08-27-evidence/hole3");
const BASE = "https://fundhub.ai";
const NAME = "Sim WL Book E2e27";

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

async function walkOnce(page, token, pass) {
  await page.goto(`${BASE}/login.html`, { waitUntil: "domcontentloaded" });
  await page.evaluate((t) => {
    localStorage.setItem("fh_token", t);
    localStorage.setItem("fh_role", "owner");
  }, token);
  await page.goto(`${BASE}/app/pipeline.html`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-rail="R-08"]').click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(EVIDENCE, `finish-${pass}-r08.png`), fullPage: true });
  const body = await page.locator("body").innerText();
  await page.locator("#q").fill(NAME);
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(EVIDENCE, `finish-${pass}-search.png`), fullPage: true });
  const afterSearch = await page.locator("body").innerText();
  const visibleCards = await page.locator(".card:not(.filtered) .c-name").allTextContents();
  return {
    has_name: body.includes(NAME),
    search_has_name: afterSearch.includes(NAME),
    visible_card_names: visibleCards,
    empty_banner: /nobody has been placed here/i.test(body)
  };
}

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
  const searchRes = await request.get(`${BASE}/api/read/search?q=${encodeURIComponent(NAME)}`, { headers });
  const search = await searchRes.json();
  const names = (board.stages || []).flatMap((s) => (s.cards || []).map((c) => ({ stage: s.key, name: c.name })));

  const page = await context.newPage();
  const pass1 = await walkOnce(page, token, "1");
  await page.goto(`${BASE}/app/pipeline.html`, { waitUntil: "domcontentloaded" });
  const pass2 = await walkOnce(page, token, "2");

  const groups = search.groups || {};
  const out = {
    login_ok: true,
    board_status: boardRes.status(),
    board_total: board.total,
    named_cards: names,
    search_cards: (groups.cards || []).map((c) => c.title),
    search_clients: (groups.clients || []).length,
    pass1,
    pass2
  };
  fs.writeFileSync(path.join(EVIDENCE, "finish.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
}

main().catch((err) => {
  console.error(String(err && err.message ? err.message : err));
  process.exit(1);
});
