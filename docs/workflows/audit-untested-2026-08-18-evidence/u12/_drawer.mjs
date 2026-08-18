/**
 * U12 follow-up: open a DEMO application drawer. Read only.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-untested-2026-08-18-evidence/u12");
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

async function shot(page, slug) {
  const file = path.join(OUT, `${slug}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return path.relative(ROOT, file);
}

const browser = await chromium.launch({ headless: true, executablePath: chromeExe() });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("dialog", async (d) => { await d.dismiss(); });

await page.goto(BASE + "/login.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.locator('input[type="email"], #email, input[name="email"]').first().fill("chris@fundhub.ai");
await page.locator('input[type="password"], #password, input[name="password"]').first().fill(PASSWORD);
await page.locator('button[type="submit"], button:has-text("Sign"), button:has-text("Log")').first().click();
await page.waitForFunction(() => !/login\.html|portal-login\.html/i.test(location.pathname), null, { timeout: 30000 });
if (page.url().includes(FORBIDDEN)) throw new Error("opened forbidden client");

await page.goto(BASE + "/app/hiring.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForFunction(() => /candidates: loaded/i.test(document.getElementById("footNote")?.innerText || ""), null, { timeout: 20000 });
await page.waitForTimeout(800);

const boardInfo = await page.evaluate(() => {
  const board = document.getElementById("board");
  if (board) board.scrollIntoView({ block: "center" });
  const cards = [...document.querySelectorAll("#board button.ccard, #board [data-app]")].map((b) => ({
    app: b.getAttribute("data-app"),
    demo: /demo row/i.test(b.innerText || "")
  }));
  return {
    cards: cards.length,
    demoCards: cards.filter((c) => c.demo).length,
    showDemo: typeof SHOW_DEMO_ROWS === "boolean" ? SHOW_DEMO_ROWS : null,
    apps: typeof APPS === "object" ? APPS.length : null
  };
});
const boardShot = await shot(page, "u12-board-scroll");

const opened = await page.evaluate(() => {
  const demo = (typeof APPS !== "undefined" ? APPS : []).find((a) => a.is_demo_row);
  if (!demo || typeof openDrawer !== "function") {
    return { ok: false, reason: demo ? "no_openDrawer" : "no_demo_in_APPS", id: demo?.id || null };
  }
  openDrawer(demo.id);
  return { ok: true, id: demo.id, stage: demo.stage_key || null };
});
await page.waitForTimeout(1800);
const drawerShot = await shot(page, "u12-drawer-demo");
const drawer = await page.evaluate(() => {
  const body = (document.getElementById("dwBody")?.innerText || "").replace(/\s+/g, " ");
  const title = (document.getElementById("dwTitle")?.innerText || "").slice(0, 24);
  const buttons = [...document.querySelectorAll("#drawer button, #dwBody button")].map((b) => (b.innerText || "").trim()).filter(Boolean);
  return {
    title_prefix: title,
    buttons,
    notice: /nothing in this panel can be changed/i.test(body),
    advisory: /scores are advisory/i.test(body),
    snippet: body.slice(0, 320)
  };
});

const out = {
  at: new Date().toISOString(),
  boardInfo,
  opened,
  drawer,
  shots: { board: boardShot, drawer: drawerShot }
};
fs.writeFileSync(path.join(OUT, "drawer.json"), JSON.stringify(out, null, 2));
await browser.close();
console.log(JSON.stringify({
  boardInfo,
  opened: { ok: opened.ok, stage: opened.stage || null },
  notice: drawer.notice,
  buttons: drawer.buttons,
  shots: out.shots
}, null, 2));
