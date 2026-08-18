// U20 — Galaxy screens. No social connect. No publish. No marketing-enable.
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-untested-2026-08-18-evidence/u20");
const BASE = "https://fundhub.ai";
const LIVE = "9af65808-a619-4e65-ae91-239766a006b7";

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
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL missing");
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

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
await c.connect();
const pages = await c.query(`
  SELECT partner_id, slug, status, published_at IS NOT NULL AS published
    FROM partner_pages
   ORDER BY created_at DESC
   LIMIT 20
`).catch(async (err) => {
  const tables = await c.query(`
    SELECT table_name FROM information_schema.tables
     WHERE table_schema='public' AND table_name ILIKE '%partner%page%'
  `);
  return { rows: [], error: String(err.message).slice(0, 160), tables: tables.rows };
});
await c.end();
fs.writeFileSync(path.join(OUT, "db-pages.json"), JSON.stringify({
  note: "ids + slug + status only. No page body.",
  rows: pages.rows || pages,
  error: pages.error || null
}, null, 2));

const siteProbes = [];
const rows = pages.rows || [];
for (const r of rows.slice(0, 8)) {
  const url = `${BASE}/sites/${r.partner_id}/${r.slug}`;
  const res = await fetch(url, { redirect: "manual" });
  const text = await res.text();
  siteProbes.push({
    partner_id: r.partner_id,
    slug: r.slug,
    status: r.status,
    published: r.published,
    http: res.status,
    preview: String(text).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160)
  });
}
if (!siteProbes.length) {
  const fallback = `${BASE}/sites/9defaf28-47c5-43a0-8f5e-f41ef90f360a/apply`;
  const res = await fetch(fallback, { redirect: "manual" });
  const text = await res.text();
  siteProbes.push({
    partner_id: "9defaf28-47c5-43a0-8f5e-f41ef90f360a",
    slug: "apply",
    source: "g1_prior",
    http: res.status,
    preview: String(text).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160)
  });
}
fs.writeFileSync(path.join(OUT, "sites-probe.json"), JSON.stringify(siteProbes, null, 2));

const browser = await chromium.launch({ headless: true, executablePath: chromeExe() });

async function loginAs(email) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.on("dialog", (d) => d.dismiss());
  await page.goto(BASE + "/login.html", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.locator('input[type="email"], #email, input[name="email"]').first().fill(email);
  await page.locator('input[type="password"], #password, input[name="password"]').first().fill(PASSWORD);
  await page.locator('button[type="submit"], button:has-text("Sign"), button:has-text("Log")').first().click();
  await page.waitForFunction(() => !/login\.html|portal-login\.html/i.test(location.pathname), null, { timeout: 30000 }).catch(() => {});
  return page;
}

function pageFacts(page) {
  return page.evaluate(() => {
    const text = document.body?.innerText || "";
    const buttons = [...document.querySelectorAll("button, a")].map((el) => (el.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean);
    return {
      path: location.pathname + location.search,
      title: document.title,
      bounced: !/galaxy/i.test(location.pathname),
      connectLike: buttons.filter((t) => /connect|facebook|instagram|linkedin|publish/i.test(t)),
      visibleButtons: buttons.filter((t) => !/SALES|FUNDING|CLIENT|WATCH|AUTOMATION|MARKETING|ADMIN|PORTALS|▾|‹‹/.test(t)).slice(0, 30),
      bodyPreview: text.slice(0, 600)
    };
  });
}

const access = [];

const owner = await loginAs("chris@fundhub.ai");
await owner.goto(BASE + "/app/galaxy.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await owner.waitForTimeout(2500);
if (owner.url().includes(LIVE)) throw new Error("refusing live credit file");
await owner.screenshot({ path: path.join(OUT, "01-owner-galaxy-1440.png"), fullPage: false });
const ownerFacts = await pageFacts(owner);
access.push({ who: "owner chris@", claimed: "stay on galaxy.html", ...ownerFacts });

const canvas = owner.locator("#sky");
if (await canvas.count()) {
  const box = await canvas.boundingBox();
  if (box) {
    await owner.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.45);
    await owner.waitForTimeout(800);
  }
}
await owner.screenshot({ path: path.join(OUT, "02-owner-galaxy-click.png"), fullPage: false });
const ownerAfterClick = await pageFacts(owner);
access.push({ who: "owner after canvas click", claimed: "zoom only, no write", ...ownerAfterClick });
await owner.close();

const partner = await loginAs("partner@fundhub.ai");
await partner.goto(BASE + "/app/galaxy.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await partner.waitForTimeout(2000);
await partner.screenshot({ path: path.join(OUT, "03-partner-on-galaxy.png"), fullPage: false });
access.push({ who: "partner@ on galaxy.html", claimed: "bounce to partner-galaxy", ...await pageFacts(partner) });

await partner.goto(BASE + "/app/partner-galaxy.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await partner.waitForTimeout(2500);
await partner.screenshot({ path: path.join(OUT, "04-partner-galaxy-1440.png"), fullPage: false });
const partnerFacts = await pageFacts(partner);
access.push({ who: "partner@ on partner-galaxy.html", claimed: "stay", ...partnerFacts });

const download = partner.locator("#blasterBtn");
if (await download.count()) {
  await download.click({ timeout: 3000 }).catch((e) => ({ error: String(e.message).slice(0, 120) }));
  await partner.waitForTimeout(600);
}
access.push({
  who: "partner Download click",
  claimed: "safe download, not publish/connect",
  after: await pageFacts(partner)
});
await partner.close();

const closer = await loginAs("closer@fundhub.ai");
await closer.goto(BASE + "/app/galaxy.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await closer.waitForTimeout(2000);
await closer.screenshot({ path: path.join(OUT, "05-closer-galaxy.png"), fullPage: false });
access.push({ who: "closer@ on galaxy.html", claimed: "staff stay (galaxy is staff surface)", ...await pageFacts(closer) });
await closer.close();

await browser.close();

fs.writeFileSync(path.join(OUT, "access.json"), JSON.stringify({
  did_connect_social: false,
  did_publish: false,
  did_marketing_enable: false,
  access
}, null, 2));

console.log(JSON.stringify({
  access: access.map((a) => ({ who: a.who, path: a.path, bounced: a.bounced, connectLike: a.connectLike })),
  sites: siteProbes
}, null, 2));
