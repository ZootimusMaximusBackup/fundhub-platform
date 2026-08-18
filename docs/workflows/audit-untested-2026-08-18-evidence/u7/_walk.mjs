/**
 * U7 — record Mark Cleared exists. Do not press it. TEST case only.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-untested-2026-08-18-evidence/u7");
const BASE = "https://fundhub.ai";
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
fs.mkdirSync(OUT, { recursive: true });

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

const findings = [];
function rec(row) {
  findings.push(row);
  console.log(JSON.stringify({ id: row.id, verdict: row.verdict, happened: String(row.happened || "").slice(0, 240) }));
}

const browser = await chromium.launch({ headless: true, executablePath: chromeExe() });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.on("dialog", async (d) => { await d.dismiss(); });

await page.goto(BASE + "/login.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.locator('input[type="email"], #email').first().fill("inquiry@fundhub.ai");
await page.locator('input[type="password"], #password').first().fill(PASSWORD);
await page.locator('button[type="submit"]').first().click();
await page.waitForFunction(() => !/login\.html/i.test(location.pathname), null, { timeout: 30000 });
if (page.url().includes(FORBIDDEN)) throw new Error("opened forbidden client");

await page.goto(BASE + "/app/inquiry-remover.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(3000);
const testRow = page.locator("tr.case-main, tr").filter({ hasText: /TEST Client|8556bedc|client@fundhub/i }).first();
if (await testRow.count()) await testRow.click();
await page.waitForTimeout(1000);
if (page.url().includes(FORBIDDEN)) throw new Error("opened forbidden client");

const ui = await page.evaluate(() => {
  const cleared = document.querySelector('button[data-act="cleared"]');
  const send = document.querySelector('button[data-act="send"]');
  return {
    path: location.pathname,
    forbidden: /9af65808/i.test(location.href),
    has_mark_cleared: !!cleared,
    mark_cleared_text: cleared ? (cleared.innerText || "").trim() : "",
    pressed: false,
    has_send: !!send
  };
});
await page.screenshot({ path: path.join(OUT, "01-mark-cleared-left.png"), fullPage: false });
rec({
  id: "mark-cleared",
  claim: "Mark Cleared exists on TEST case. Did not press. Pressing would write inquiry.removed with no bureau work.",
  happened: JSON.stringify(ui),
  shot: "docs/workflows/audit-untested-2026-08-18-evidence/u7/01-mark-cleared-left.png",
  verdict: ui.has_mark_cleared ? "OBSERVED" : "MISSING"
});

await context.close();
await browser.close();
fs.writeFileSync(path.join(OUT, "walk.json"), JSON.stringify({ at: new Date().toISOString(), findings }, null, 2));
console.log(JSON.stringify({ wrote: "u7/walk.json" }, null, 2));
