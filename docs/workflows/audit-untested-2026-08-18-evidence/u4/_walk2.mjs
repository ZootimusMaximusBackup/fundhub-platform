/**
 * U4 follow-up: closer Present with ?contact= TEST id. Do not press Send.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-untested-2026-08-18-evidence/u4");
const BASE = "https://fundhub.ai";
const TEST_CLIENT = "8556bedc-46e1-4d85-b0cd-a24adfee1521";
const FORBIDDEN = "9af65808-a619-4e65-ae91-239766a006b7";

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

const browser = await chromium.launch({ headless: true, executablePath: chromeExe() });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.on("dialog", async (d) => { await d.dismiss(); });

await page.goto(BASE + "/login.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.locator('input[type="email"], #email').first().fill("closer@fundhub.ai");
await page.locator('input[type="password"], #password').first().fill(PASSWORD);
await page.locator('button[type="submit"]').first().click();
await page.waitForFunction(() => !/login\.html/i.test(location.pathname), null, { timeout: 30000 });

await page.goto(BASE + `/app/present.html?contact=${TEST_CLIENT}`, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(2500);
if (page.url().includes(FORBIDDEN)) throw new Error("opened forbidden client");

const ui = await page.evaluate(() => {
  const text = (document.body?.innerText || "").replace(/\s+/g, " ");
  const payBtns = [...document.querySelectorAll("button, a")].map((b) => (b.innerText || "").replace(/\s+/g, " ").trim())
    .filter((t) => /pay|agreement|checkout|\$32|soft.pull|send/i.test(t));
  return { path: location.pathname + location.search, payish: payBtns.slice(0, 16), body: text.slice(0, 280) };
});
await page.screenshot({ path: path.join(OUT, "08-closer-present-contact.png"), fullPage: false });

const walkPath = path.join(OUT, "walk.json");
const walk = JSON.parse(fs.readFileSync(walkPath, "utf8"));
walk.findings.push({
  id: "closer-present-contact",
  claim: "Closer Present ?contact= TEST. Record pay button. Do not press Send.",
  happened: JSON.stringify(ui),
  shot: "docs/workflows/audit-untested-2026-08-18-evidence/u4/08-closer-present-contact.png",
  verdict: "OBSERVED",
  stop: "did_not_press_send_pay_link"
});
fs.writeFileSync(walkPath, JSON.stringify(walk, null, 2));
console.log(JSON.stringify({ id: "closer-present-contact", ...ui }, null, 2));

await context.close();
await browser.close();
