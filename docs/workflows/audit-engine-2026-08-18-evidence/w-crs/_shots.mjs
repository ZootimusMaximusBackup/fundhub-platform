// W-CRS live paint — owner login, CCP + closer dashboard screenshots.
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-engine-2026-08-18-evidence/w-crs");
const BASE = "https://fundhub.ai";
const CLIENT_ID = "41a3199f-1835-4ac8-91c0-d4f37bd92037";

function loadDotEnv() {
  const p = path.join(ROOT, ".env");
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (k && process.env[k] == null) process.env[k] = v;
  }
}
loadDotEnv();
const PASSWORD = process.env.STAFF_E2E_PASSWORD || process.env.STAFF_INITIAL_PASSWORD || "";
if (!PASSWORD) throw new Error("STAFF_E2E_PASSWORD missing");

function chromeExe() {
  const home = process.env.HOME || "";
  const root = path.join(home, "Library/Caches/ms-playwright");
  if (!fs.existsSync(root)) return undefined;
  const dirs = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const d of dirs) {
    const exe = path.join(root, d, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
    if (fs.existsSync(exe)) return exe;
  }
  return undefined;
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: chromeExe(),
    args: ["--disable-dev-shm-usage"]
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true
  });
  const page = await context.newPage();
  try {
    await page.goto(BASE + "/login.html", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(600);
    if (/login\.html/i.test(page.url())) {
      await page.locator('input[type="email"], #email').first().fill("chris@fundhub.ai");
      const pass = page.locator('input[type="password"], #password').first();
      if (await pass.count()) await pass.fill(PASSWORD);
      await page.locator('button[type="submit"]').first().click();
      await page.waitForFunction(() => !/login\.html/i.test(location.pathname), null, { timeout: 30000 });
    }

    const ccpUrl = `${BASE}/app/client-control-panel.html?id=${CLIENT_ID}`;
    await page.goto(ccpUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForFunction(() => {
      const s = document.getElementById("ccp-scores");
      const p = document.getElementById("ccp-prequal");
      const n = document.getElementById("ccp-name");
      return n && n.textContent && n.textContent !== "Loading…";
    }, null, { timeout: 20000 }).catch(() => null);
    await page.waitForTimeout(800);
    const ccpDom = await page.evaluate(() => ({
      url: location.href,
      name: document.getElementById("ccp-name")?.textContent || null,
      email: document.getElementById("ccp-email")?.textContent || null,
      scores: document.getElementById("ccp-scores")?.textContent || null,
      facts_scores: document.getElementById("ccp-facts-scores")?.textContent || null,
      prequal: document.getElementById("ccp-prequal")?.textContent || null,
      approved: document.getElementById("ccp-approved")?.textContent || null,
      tier: document.getElementById("ccp-tier")?.textContent || null,
      footer_id: document.getElementById("ccp-footer-id")?.textContent || null
    }));
    await page.screenshot({ path: path.join(OUT, "07-ccp-scores.png"), fullPage: false });
    fs.writeFileSync(path.join(OUT, "dumps/07-ccp-dom.json"), JSON.stringify(ccpDom, null, 2));

    const closerUrl = `${BASE}/app/closer-dashboard.html?client_id=${CLIENT_ID}`;
    await page.goto(closerUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(2500);
    const closerDom = await page.evaluate(() => ({
      url: location.href,
      body_text_has_718: /718/.test(document.body.innerText),
      body_text_has_724: /724/.test(document.body.innerText),
      body_text_has_731: /731/.test(document.body.innerText),
      body_text_has_125000: /125,?000/.test(document.body.innerText),
      body_text_has_chase: /Chase/i.test(document.body.innerText),
      body_text_has_amex: /American Express|Amex/i.test(document.body.innerText),
      banner: document.querySelector(".banner, .live-banner, [data-fh-banner]")?.textContent || null,
      deal_rows: Array.from(document.querySelectorAll("table.deal tr[data-fh-row]")).map((tr) => tr.innerText.trim())
    }));
    await page.screenshot({ path: path.join(OUT, "07-closer-dashboard.png"), fullPage: false });
    fs.writeFileSync(path.join(OUT, "dumps/07-closer-dom.json"), JSON.stringify(closerDom, null, 2));

    console.log(JSON.stringify({ ccp: ccpDom, closer: closerDom }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(String(err && err.stack ? err.stack : err));
  process.exit(1);
});
