// Calendar screenshots only. No booking create. No Move. No email.
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-gaps-2026-08-18-evidence/g5");
const BASE = "https://fundhub.ai";

for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i < 1) continue;
  const k = t.slice(0, i).trim();
  const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  if (!process.env[k]) process.env[k] = v;
}

const PASSWORD = process.env.STAFF_E2E_PASSWORD;
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

await page.goto(BASE + "/app/calendar.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(1500);
const loadState = await page.evaluate(async () => {
  const tokenOn = Boolean(localStorage.getItem("fh_token"));
  const hasFH = typeof FHData !== "undefined";
  let queue = null;
  if (hasFH && FHData.taskQueue) {
    try {
      const open = await FHData.taskQueue({ done: false, limit: 200 });
      queue = {
        ok: open && open.ok,
        source: open && open.source,
        error: open && open.error,
        n: open && open.data && open.data.tasks ? open.data.tasks.length : 0,
        dated: open && open.data && open.data.tasks
          ? open.data.tasks.filter((t) => t && t.due_at).length
          : 0
      };
    } catch (e) {
      queue = { error: String(e && e.message ? e.message : e).slice(0, 160) };
    }
  }
  const banner = (document.querySelector(".fh-banner, .banner, [data-banner]") || {}).textContent || "";
  return {
    tokenOn,
    hasFH,
    queue,
    banner: String(banner).replace(/\s+/g, " ").trim().slice(0, 200),
    foot: document.getElementById("footView")?.textContent || "",
    booked: document.getElementById("statBooked")?.textContent || ""
  };
});
try {
  await page.waitForFunction(() => {
    const el = document.getElementById("statBooked");
    return el && el.textContent && el.textContent !== "—";
  }, null, { timeout: 12000 });
} catch (_) { /* still unloaded — recorded below */ }

const factsToday = await page.evaluate(() => {
  const foot = document.getElementById("footView")?.textContent || "";
  const booked = document.getElementById("statBooked")?.textContent || "";
  const demoOpen = !document.getElementById("demoBody")?.hidden;
  const evts = document.querySelectorAll(".evt-client").length;
  const openSlot = [...document.querySelectorAll(".open-slot")].map((el) => (el.textContent || "").trim());
  const demoLabel = document.getElementById("demoToggle")?.innerText || "";
  return {
    url: location.href,
    title: document.title,
    foot,
    booked,
    demoOpen,
    demoLabel: demoLabel.replace(/\s+/g, " ").trim(),
    eventCountOnScreen: evts,
    openSlot,
    hasDemonstrationCopy: /Demonstration states/i.test(document.body.innerText)
  };
});

await page.screenshot({ path: path.join(OUT, "01-calendar-today.png"), fullPage: false });

await page.locator(".navbtn").first().click();
await page.waitForTimeout(200);
await page.locator(".navbtn").first().click();
await page.waitForTimeout(200);
await page.locator(".navbtn").first().click();
await page.waitForTimeout(200);
await page.locator(".navbtn").first().click();
await page.waitForTimeout(400);
const day14 = page.locator('.ws-day[data-ymd="2026-08-14"]');
if (await day14.count()) {
  await day14.click();
  await page.waitForTimeout(800);
}
const facts14 = await page.evaluate(() => ({
  ymd: document.querySelector(".ws-day.today")?.getAttribute("data-ymd") || null,
  booked: document.getElementById("statBooked")?.textContent || "",
  foot: document.getElementById("footView")?.textContent || "",
  eventCountOnScreen: document.querySelectorAll(".evt-client").length,
  dayTitle: document.querySelector(".day-title")?.textContent || ""
}));
await page.screenshot({ path: path.join(OUT, "02-calendar-aug14.png"), fullPage: false });

await page.evaluate(() => {
  const zone = document.getElementById("demozone");
  if (zone) zone.scrollIntoView({ block: "end" });
  const tog = document.getElementById("demoToggle");
  if (tog) tog.click();
});
await page.waitForTimeout(400);
const factsDemo = await page.evaluate(() => ({
  demoOpen: document.getElementById("demoToggle")?.getAttribute("aria-expanded") === "true",
  demoText: (document.getElementById("demoBody")?.innerText || "").replace(/\s+/g, " ").slice(0, 400)
}));
const demoBox = await page.locator("#demozone").boundingBox();
if (demoBox) {
  await page.screenshot({ path: path.join(OUT, "03-calendar-demo-drawer.png"), clip: demoBox });
} else {
  await page.screenshot({ path: path.join(OUT, "03-calendar-demo-drawer.png"), fullPage: false });
}

await browser.close();

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
await c.connect();
const proxyAfter = (await c.query(`SELECT count(*)::int AS n FROM proxy_sessions`)).rows[0];
await c.end();

const out = {
  at: new Date().toISOString(),
  loadState,
  factsToday,
  facts14,
  factsDemo,
  proxyAfter,
  shots: ["01-calendar-today.png", "02-calendar-aug14.png", "03-calendar-demo-drawer.png"]
};
fs.writeFileSync(path.join(OUT, "shots.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
