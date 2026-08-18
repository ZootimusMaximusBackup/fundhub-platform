// Re-shot CCP AFTER consent. Do not press pull.
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-engine-2026-08-18-evidence/w-consent");
const BASE = "https://fundhub.ai";
const CLIENT = "41a3199f-1835-4ac8-91c0-d4f37bd92037";

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

const loginRes = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "chris@fundhub.ai", password: PASSWORD })
});
const loginJson = await loginRes.json();
const token = loginJson.token;
if (!token) throw new Error("login failed");

const browser = await chromium.launch({ headless: true, executablePath: chromeExe() });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
await context.addCookies([{
  name: "fundhub_session", value: token, domain: "fundhub.ai", path: "/", httpOnly: true, secure: true
}]);
const page = await context.newPage();
await page.addInitScript((t) => { try { localStorage.setItem("fh_token", t); } catch {} }, token);
await page.route("**/api/finance/crs-pull", (route) => route.abort());
await page.goto(`${BASE}/app/client-control-panel.html?id=${CLIENT}`, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(2500);
await page.locator("#ccp-pull-tu").scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
const state = await page.evaluate(() => {
  const email = document.body.innerText.includes("sim+1787079946953@demo.fundhub.local");
  const name = document.body.innerText.includes("Simulated Client");
  const btn = document.getElementById("ccp-pull-tu");
  const status = document.getElementById("ccp-issue-ir-status");
  return {
    url: location.href,
    has_sim_email: email,
    has_sim_name: name,
    pull_tu_disabled: btn ? btn.disabled : null,
    status_copy: status ? status.textContent.trim() : null
  };
});
await page.locator("#ccp-pull-tu").screenshot({ path: path.join(OUT, "ccp-after-pull-button.png") });
await page.screenshot({ path: path.join(OUT, "ccp-after-consent.png"), fullPage: false });
await page.locator("#ccp-actions-desk-note").evaluate((el) => {
  const g = el.closest(".group");
  if (g) g.scrollIntoView({ block: "start" });
});
await page.screenshot({ path: path.join(OUT, "ccp-after-actions.png"), fullPage: false });
fs.writeFileSync(path.join(OUT, "ccp-after-state.json"), JSON.stringify(state, null, 2));
console.log(JSON.stringify(state));
await browser.close();
