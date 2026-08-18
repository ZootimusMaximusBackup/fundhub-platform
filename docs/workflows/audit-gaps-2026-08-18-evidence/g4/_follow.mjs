import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-gaps-2026-08-18-evidence/g4");
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
  const home = process.env.HOME || "";
  const sys = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (fs.existsSync(sys)) return sys;
  const root = path.join(home, "Library/Caches/ms-playwright");
  if (!fs.existsSync(root)) return undefined;
  const dirs = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const d of dirs) {
    const exe = path.join(root, d, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
    if (fs.existsSync(exe)) return exe;
  }
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: chromeExe(),
    args: ["--disable-blink-features=AutomationControlled"]
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 980 },
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
  });
  const page = await context.newPage();
  const hops = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) hops.push({ at: Date.now(), url: frame.url() });
  });

  const vsl = await page.request.get("https://fundhub.ai/funnel/vsl.mp4");
  const vslMeta = { status: vsl.status(), type: vsl.headers()["content-type"] || "", len: vsl.headers()["content-length"] || "" };

  await page.goto(CRM + "/login.html", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.locator('input[type="email"], #email').first().fill("chris@fundhub.ai");
  await page.locator('input[type="password"], #password').first().fill(PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForFunction(() => !/login\.html/i.test(location.pathname), null, { timeout: 30000 });

  hops.length = 0;
  const t0 = Date.now();
  const resp = await page.goto(CRM + "/app/content-admin.html", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(2500);
  const bounce = {
    httpStatus: resp ? resp.status() : null,
    afterMs: Date.now() - t0,
    finalUrl: page.url(),
    title: await page.title(),
    hops: hops.slice(),
    bouncedToPipeline: /pipeline\.html/i.test(page.url())
  };
  await page.screenshot({ path: path.join(OUT, "g4c-content-admin-bounce.png"), fullPage: false });

  const nav = await page.evaluate(() => {
    return [...document.querySelectorAll("a.navitem")]
      .filter((a) => {
        const st = getComputedStyle(a);
        return st.display !== "none" && !a.hasAttribute("data-fh-gated");
      })
      .map((a) => ({
        label: (a.textContent || "").replace(/\s+/g, " ").trim(),
        href: a.getAttribute("href") || ""
      }));
  });
  const contentNav = nav.filter((n) => /content/i.test(n.label + n.href));

  let marketingOpen = false;
  const mHead = page.locator('.navhead:has-text("Marketing")').first();
  if (await mHead.count()) {
    await mHead.click();
    marketingOpen = true;
    await page.waitForTimeout(300);
  }
  await page.screenshot({ path: path.join(OUT, "g4c-nav-marketing.png"), fullPage: false });
  const adminHead = page.locator('.navhead:has-text("Admin")').first();
  if (await adminHead.count()) {
    await adminHead.click();
    await page.waitForTimeout(300);
  }
  await page.screenshot({ path: path.join(OUT, "g4c-nav-admin.png"), fullPage: false });

  const tilesApi = await page.evaluate(async () => {
    const t = localStorage.getItem("fh_token") || "";
    const r = await fetch("/api/content/tiles", {
      headers: t ? { accept: "application/json", authorization: "Bearer " + t } : { accept: "application/json" }
    });
    const json = await r.json().catch(() => null);
    return {
      status: r.status,
      ok: json && json.ok,
      videos: json && json.videos,
      tiles: json && json.tiles,
      map: json && json.map,
      message: json && (json.message || json.error)
    };
  });

  const uploadProbe = await page.evaluate(async () => {
    const t = localStorage.getItem("fh_token") || "";
    const r = await fetch("/api/content/upload", {
      method: "OPTIONS",
      headers: t ? { authorization: "Bearer " + t } : {}
    });
    return { status: r.status };
  });

  const out = {
    at: new Date().toISOString(),
    vslMeta,
    bounce,
    navLabels: nav.map((n) => n.label),
    contentNav,
    marketingOpen,
    tilesApi: {
      status: tilesApi.status,
      ok: tilesApi.ok,
      videoCount: Array.isArray(tilesApi.videos) ? tilesApi.videos.length : null,
      tileCount: Array.isArray(tilesApi.tiles) ? tilesApi.tiles.length : null,
      tileCodes: Array.isArray(tilesApi.tiles) ? tilesApi.tiles.map((x) => x.code || x.name) : null,
      map: tilesApi.map || null,
      message: tilesApi.message || null
    },
    uploadProbe
  };
  fs.writeFileSync(path.join(OUT, "g4c-follow.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify({
    bounceTo: bounce.finalUrl,
    bounced: bounce.bouncedToPipeline,
    http: bounce.httpStatus,
    contentNav,
    videos: out.tilesApi.videoCount,
    vsl: vslMeta.status
  }));
  await browser.close();
})().catch((e) => {
  console.error(String(e && e.stack || e).slice(0, 600));
  process.exit(1);
});
