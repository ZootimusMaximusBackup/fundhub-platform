/**
 * W13 screenshots only. Does not Save, promote, demote, or create.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-crm-whole-2026-08-18-evidence/w13");
const BASE = "https://fundhub.ai";

function loadDotEnv() {
  const p = path.join(ROOT, ".env");
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

const PASSWORD = process.env.STAFF_E2E_PASSWORD || "";
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

const browser = await chromium.launch({
  headless: true,
  executablePath: chromeExe()
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });

await page.goto(BASE + "/login.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.locator('input[type="email"], #email, input[name="email"]').first().fill("chris@fundhub.ai");
await page.locator('input[type="password"], #password, input[name="password"]').first().fill(PASSWORD);
await page.locator('button[type="submit"], button:has-text("Sign"), button:has-text("Log")').first().click();
await page.waitForFunction(() => !/login\.html|portal-login\.html/i.test(location.pathname), null, { timeout: 30000 });

await page.goto(BASE + "/app/agent-editor.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForFunction(() => {
  const el = document.getElementById("kAll");
  return el && Number(el.textContent) >= 20;
}, null, { timeout: 20000 });
await page.waitForTimeout(600);

const facts = await page.evaluate(() => {
  const body = (document.body && document.body.innerText) || "";
  const liveRows = [...document.querySelectorAll(".aitem")].map((el) => ({
    name: (el.querySelector(".an")?.textContent || "").trim(),
    mode: (el.querySelector(".ast")?.textContent || "").trim(),
    trig: (el.querySelector(".atr")?.textContent || "").trim()
  }));
  return {
    url: location.href,
    kAll: document.getElementById("kAll")?.textContent || null,
    kLive: document.getElementById("kLive")?.textContent || null,
    snippet: body.replace(/\s+/g, " ").slice(0, 900),
    rows: liveRows
  };
});
fs.writeFileSync(path.join(OUT, "screen.json"), JSON.stringify({ at: new Date().toISOString(), facts }, null, 2));

await page.screenshot({ path: path.join(OUT, "01-list-two-live.png"), fullPage: false });

const josh = page.locator('.aitem[data-a="AG-04"], .aitem:has-text("Setter Josh")').first();
await josh.click();
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(OUT, "02-ag-04-setter-josh.png"), fullPage: false });

const ira = page.locator('.aitem[data-a="AG-09"], .aitem:has-text("Inquiry Removal")').first();
await ira.click();
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(OUT, "03-ag-09-inquiry-removal.png"), fullPage: false });

await browser.close();
console.log(JSON.stringify({
  shots: ["01-list-two-live.png", "02-ag-04-setter-josh.png", "03-ag-09-inquiry-removal.png"],
  kAll: facts.kAll,
  kLive: facts.kLive,
  liveRows: facts.rows.filter((r) => r.mode === "live")
}, null, 2));
