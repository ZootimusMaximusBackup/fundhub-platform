/**
 * U10: owner Calendar screen. Read only. No booking created here.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-untested-2026-08-18-evidence/u10");
const CRM = "https://fundhub.ai";

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
  const p = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  return fs.existsSync(p) ? p : undefined;
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: chromeExe(),
    args: ["--disable-blink-features=AutomationControlled"]
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 980 } });
  const page = await context.newPage();
  await page.goto(CRM + "/login.html", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(800);
  await page.locator('input[type="email"], #email, input[name="email"]').first().fill("chris@fundhub.ai");
  await page.locator('input[type="password"], #password, input[name="password"]').first().fill(PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForFunction(() => !/login\.html|portal-login\.html/i.test(location.pathname), null, { timeout: 30000 });
  await page.goto(CRM + "/app/calendar.html", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(4000);
  const file = path.join(OUT, "u10-owner-calendar.png");
  await page.screenshot({ path: file, fullPage: true });
  const ui = await page.evaluate(() => {
    const text = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
    return {
      href: location.href,
      text: text.slice(0, 1800),
      nothingBooked: /nothing booked/i.test(text)
    };
  });
  fs.writeFileSync(path.join(OUT, "calendar.json"), JSON.stringify({ at: new Date().toISOString(), ui }, null, 2));
  await browser.close();
  console.log(JSON.stringify({ href: ui.href, nothingBooked: ui.nothingBooked, textSlice: ui.text.slice(0, 220) }));
})().catch((e) => {
  console.error(String((e && e.stack) || e).slice(0, 900));
  process.exit(1);
});
