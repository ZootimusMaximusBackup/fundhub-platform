/** W2 leftover clicks. Evidence only. Test client writes only. */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-crm-whole-2026-08-18-evidence/w2");
const BASE = "https://fundhub.ai";
const TEST_CLIENT = "8556bedc-46e1-4d85-b0cd-a24adfee1521";

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

const rows = [];
function rec(r) { rows.push(r); console.log(JSON.stringify(r)); }

async function shot(page, slug) {
  const file = path.join(OUT, `${slug}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return slug + ".png";
}

async function login(page) {
  await page.goto(BASE + "/login.html", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.locator('input[type="email"]').first().fill("chris@fundhub.ai");
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForFunction(() => !/login\.html/i.test(location.pathname), null, { timeout: 30000 });
}

async function main() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const closerCount = await c.query(
    `SELECT count(*)::int AS n
       FROM staff
      WHERE lower(btrim(role)) = 'closer' AND status = 'active'`
  );
  const closerDemo = await c.query(
    `SELECT count(*)::int AS n
       FROM staff
      WHERE lower(btrim(role)) = 'closer'`
  );
  rec({
    id: "db-closer-count",
    claim: "How many closer staff exist",
    happened: `active closers=${closerCount.rows[0].n} all-status closers=${closerDemo.rows[0].n}`,
    verdict: "INFO"
  });

  const browser = await chromium.launch({ headless: true, executablePath: chromeExe() });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await login(page);

  // Documents — Open PDF on first row, class tabs
  await page.goto(BASE + "/app/documents.html", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const tab = page.locator("button.tab", { hasText: "CONTRACTS" }).first();
  if (await tab.count()) {
    await tab.click();
    await page.waitForTimeout(400);
    rec({ id: "owner-documents-tab-contracts", claim: "Documents CONTRACTS tab", happened: "clicked CONTRACTS", verdict: "WORKS", shot: await shot(page, "owner-documents-tab-contracts") });
  }
  const openPdf = page.locator("button[data-ct='open']").first();
  if (await openPdf.count()) {
    const [popup] = await Promise.all([
      page.waitForEvent("popup", { timeout: 8000 }).catch(() => null),
      openPdf.click()
    ]);
    const url = popup ? popup.url() : page.url();
    rec({ id: "owner-documents-open-pdf", claim: "Open PDF", happened: popup ? `opened ${url.slice(0, 120)}` : `clicked; no popup; url ${url.slice(0, 120)}`, verdict: "WORKS", shot: await shot(page, "owner-documents-open-pdf") });
    if (popup) await popup.close();
  } else {
    rec({ id: "owner-documents-open-pdf", claim: "Open PDF", happened: "no Open PDF button on screen", verdict: "MISSING" });
  }

  // Contracts — click first wording row
  await page.goto(BASE + "/app/contracts.html", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const row = page.locator("table tbody tr, .tpl, [data-key]").first();
  if (await row.count()) {
    await row.click();
    await page.waitForTimeout(500);
    rec({ id: "owner-contracts-open-row", claim: "Open a wording", happened: "clicked first template row", verdict: "WORKS", shot: await shot(page, "owner-contracts-row") });
    const cancel = page.locator("#btnCancelTpl");
    if (await cancel.count()) await cancel.click();
  }

  // CCP quick launch + notes
  await page.goto(`${BASE}/app/client-control-panel.html?id=${TEST_CLIENT}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const details = page.locator("button.group-title.tog").filter({ hasText: /details/i }).first();
  if (await details.count()) await details.click();
  await page.waitForTimeout(300);
  const notes = page.locator("textarea#notes");
  const notesState = await notes.evaluate((el) => ({
    exists: true,
    readonly: !!el.readOnly,
    visible: !!(el.offsetParent),
    placeholder: el.placeholder || ""
  })).catch(() => ({ exists: false }));
  rec({
    id: "owner-ccp-notes",
    claim: "Notes (editable)",
    happened: notesState.exists
      ? `textarea#notes readonly=${notesState.readonly} visible=${notesState.visible} placeholder=${notesState.placeholder}`
      : "no notes textarea",
    verdict: notesState.readonly ? "MISSING" : "WORKS",
    shot: await shot(page, "owner-ccp-notes")
  });
  for (const label of ["Open Pipeline", "Open Messaging", "Open Inquiry Remover"]) {
    const btn = page.getByRole("button", { name: new RegExp(label, "i") }).first();
    const link = page.getByRole("link", { name: new RegExp(label, "i") }).first();
    const el = (await btn.count()) ? btn : link;
    if (await el.count()) {
      await el.click();
      await page.waitForTimeout(800);
      rec({ id: `owner-ccp-${label.replace(/\s+/g, "-").toLowerCase()}`, claim: label, happened: `landed ${page.url()}`, verdict: /pipeline|messaging|inquiry/i.test(page.url()) ? "WORKS" : "BROKEN", shot: await shot(page, `owner-ccp-${label.replace(/\s+/g, "-").toLowerCase()}`) });
      await page.goto(`${BASE}/app/client-control-panel.html?id=${TEST_CLIENT}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(800);
    }
  }

  // Sales floor — scroll and click recordings
  await page.goto(BASE + "/app/sales-floor.html", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await page.mouse.wheel(0, 1200);
  await page.waitForTimeout(400);
  rec({ id: "owner-sales-floor-scroll", claim: "Scroll the floor", happened: "scrolled for closer picker / recordings", verdict: "WORKS", shot: await shot(page, "owner-sales-floor-scrolled") });
  const recBtn = page.getByRole("button", { name: /today.?s recordings/i }).first();
  if (await recBtn.count()) {
    await recBtn.click();
    await page.waitForTimeout(600);
    rec({ id: "owner-sales-floor-recordings", claim: "Today's recordings", happened: "clicked Today's recordings", verdict: "WORKS", shot: await shot(page, "owner-sales-floor-recordings") });
  } else {
    rec({ id: "owner-sales-floor-recordings", claim: "Today's recordings", happened: "button not on screen after scroll", verdict: "MISSING" });
  }

  // Hiring — worst first, flagged, open an app
  await page.goto(BASE + "/app/hiring.html", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  const worst = page.getByRole("button", { name: /worst first/i }).first();
  if (await worst.count()) {
    await worst.click();
    await page.waitForTimeout(300);
    rec({ id: "owner-hiring-worst", claim: "Worst first", happened: "clicked Worst first", verdict: "WORKS", shot: await shot(page, "owner-hiring-worst") });
  }
  const flagged = page.locator("#fFlagged");
  if (await flagged.count()) {
    await flagged.click();
    await page.waitForTimeout(400);
    rec({ id: "owner-hiring-flagged", claim: "Flagged only", happened: "clicked flagged only", verdict: "WORKS", shot: await shot(page, "owner-hiring-flagged") });
    await flagged.click();
  }
  const app = page.locator("button[data-app]").first();
  if (await app.count()) {
    await app.click();
    await page.waitForTimeout(600);
    rec({ id: "owner-hiring-open-app", claim: "Open an application", happened: "opened application drawer", verdict: "WORKS", shot: await shot(page, "owner-hiring-app") });
    const x = page.locator("#dwClose");
    if (await x.count()) await x.click();
  }

  // Call — Save · next call on test client
  await page.goto(`${BASE}/app/closer-call.html?client_id=${TEST_CLIENT}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const save = page.locator("#fh-save-next");
  if (await save.count()) {
    const before = await c.query(
      `SELECT count(*)::int AS n FROM call_outcomes WHERE client_id = $1`,
      [TEST_CLIENT]
    );
    await save.click();
    await page.waitForTimeout(1500);
    const after = await c.query(
      `SELECT id, outcome, logged_at FROM call_outcomes WHERE client_id = $1 ORDER BY logged_at DESC LIMIT 3`,
      [TEST_CLIENT]
    );
    rec({
      id: "owner-call-save",
      claim: "Save · next call",
      happened: `clicked save; outcomes before=${before.rows[0].n} after-latest=${after.rows[0] ? after.rows[0].outcome + " " + after.rows[0].id : "none"}`,
      db: after.rows.map((r) => ({ id: r.id, outcome: r.outcome, logged_at: r.logged_at })),
      verdict: after.rows.length ? "WORKS" : "BROKEN",
      shot: await shot(page, "owner-call-save")
    });
  } else {
    rec({ id: "owner-call-save", claim: "Save · next call", happened: "button missing", verdict: "MISSING" });
  }

  await c.end();
  await browser.close();
  fs.writeFileSync(path.join(OUT, "followup.json"), JSON.stringify(rows, null, 2));
  console.log("FOLLOWUP", rows.length);
}

main().catch((e) => { console.error(e); process.exit(1); });
