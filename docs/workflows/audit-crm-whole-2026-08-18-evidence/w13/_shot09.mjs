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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (k && process.env[k] == null) process.env[k] = v;
  }
}
loadDotEnv();

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

const browser = await chromium.launch({ headless: true, executablePath: chromeExe() });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
await page.goto(BASE + "/login.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.locator('input[type="email"]').first().fill("chris@fundhub.ai");
await page.locator('input[type="password"]').first().fill(process.env.STAFF_E2E_PASSWORD);
await page.locator('button[type="submit"]').first().click();
await page.waitForFunction(() => !/login\.html/i.test(location.pathname), null, { timeout: 30000 });
await page.goto(BASE + "/app/agent-editor.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForFunction(() => Number(document.getElementById("kAll")?.textContent || 0) >= 20, null, { timeout: 20000 });
await page.locator('.aitem[data-a="AG-09"]').first().click();
await page.waitForFunction(() => {
  const name = document.getElementById("a_name")?.value || "";
  const code = document.getElementById("a_code")?.value || "";
  return /AG-09|Inquiry/i.test(name + code);
}, null, { timeout: 8000 });
const sel = await page.evaluate(() => ({
  name: document.getElementById("a_name")?.value || null,
  code: document.getElementById("a_code")?.value || null,
  promptLen: document.getElementById("a_prompt")?.value?.length ?? null,
  guardLen: document.getElementById("a_guard")?.value?.length ?? null,
  modeTitle: document.getElementById("modeTitle")?.textContent || null,
  modeSub: document.getElementById("modeSub")?.textContent || null
}));
await page.screenshot({ path: path.join(OUT, "03-ag-09-inquiry-removal.png"), fullPage: false });
fs.writeFileSync(path.join(OUT, "screen-ag09.json"), JSON.stringify({ at: new Date().toISOString(), sel }, null, 2));
await browser.close();
console.log(JSON.stringify(sel));
