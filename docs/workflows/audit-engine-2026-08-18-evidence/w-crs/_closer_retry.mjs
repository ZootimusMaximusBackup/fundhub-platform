// W-CRS closer paint retry — wait for live tradeline banner / oCredit.
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
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "chris@fundhub.ai", password: PASSWORD })
  });
  const loginJson = await loginRes.json().catch(() => ({}));
  const token = loginJson.token;
  const headers = {
    accept: "application/json",
    authorization: `Bearer ${token}`,
    cookie: `fundhub_session=${token}`
  };
  const tlRes = await fetch(`${BASE}/api/read/tradelines?client_id=${CLIENT_ID}`, { headers });
  const tlJson = await tlRes.json().catch(() => ({}));
  const data = tlJson.data;
  const dump = {
    status: tlRes.status,
    ok: tlJson.ok,
    data_is_array: Array.isArray(data),
    data_length: Array.isArray(data) ? data.length : null,
    data_type: data == null ? "null" : Array.isArray(data) ? "array" : typeof data,
    data_keys: data && !Array.isArray(data) ? Object.keys(data) : null,
    first_row: Array.isArray(data) && data[0]
      ? { creditor_name: data[0].creditor_name || data[0].lender || data[0].name || null, credit_limit: data[0].credit_limit ?? null, balance: data[0].balance ?? null }
      : null,
    funding: {
      totalAvailableCredit: tlJson.funding?.totalAvailableCredit ?? null,
      has_allocation: Boolean(tlJson.funding?.allocation),
      draw_count: Array.isArray(tlJson.funding?.allocation?.draws) ? tlJson.funding.allocation.draws.length : null
    }
  };
  fs.writeFileSync(path.join(OUT, "dumps/07-closer-tradelines-shape.json"), JSON.stringify(dump, null, 2));

  const browser = await chromium.launch({ headless: true, executablePath: chromeExe(), args: ["--disable-dev-shm-usage"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  try {
    await page.goto(BASE + "/login.html", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.locator('input[type="email"], #email').first().fill("chris@fundhub.ai");
    await page.locator('input[type="password"], #password').first().fill(PASSWORD);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForFunction(() => !/login\.html/i.test(location.pathname), null, { timeout: 30000 });
    await page.evaluate((t) => { try { localStorage.setItem("fh_token", t); } catch (e) {} }, token);

    await page.goto(`${BASE}/app/closer-dashboard.html?client_id=${CLIENT_ID}`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForFunction(() => {
      const credit = document.getElementById("oCredit");
      const banner = document.querySelector(".statusbar, [data-fh-banner], .banner, .fh-banner");
      const txt = (credit && credit.textContent || "") + " " + (document.body.innerText || "");
      return /37[,.]?150|Chase|no tradelines|drawable|live tradelines|loading tradelines/i.test(txt)
        || (credit && credit.textContent && credit.textContent.trim() !== "—" && credit.textContent.trim() !== "-");
    }, null, { timeout: 20000 }).catch(() => null);
    await page.waitForTimeout(1500);

    const closerDom = await page.evaluate(() => ({
      url: location.href,
      oCredit: document.getElementById("oCredit")?.textContent || null,
      oDrawn: document.getElementById("oDrawn")?.textContent || null,
      oUtil: document.getElementById("oUtil")?.innerText || null,
      banner: document.querySelector("[data-fh-banner], .fh-banner, .banner")?.textContent || null,
      statusbar: document.querySelector(".statusbar")?.innerText || null,
      live: Boolean(window.__fhCloserLive),
      has_718: /718/.test(document.body.innerText),
      has_125000: /125,?000/.test(document.body.innerText),
      has_37150: /37[,.]?150/.test(document.body.innerText),
      has_chase: /Chase/i.test(document.body.innerText),
      deal_rows: Array.from(document.querySelectorAll("table.deal tr[data-fh-row]")).map((tr) => tr.innerText.trim())
    }));
    await page.screenshot({ path: path.join(OUT, "07-closer-dashboard.png"), fullPage: false });
    fs.writeFileSync(path.join(OUT, "dumps/07-closer-dom.json"), JSON.stringify(closerDom, null, 2));
    console.log(JSON.stringify({ dump, closerDom }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(String(err && err.stack ? err.stack : err));
  process.exit(1);
});
