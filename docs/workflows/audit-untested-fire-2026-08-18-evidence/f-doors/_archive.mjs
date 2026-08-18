/**
 * F-DOORS archive — TEST card 5410b98b-… only.
 * Never opens 9af65808-… . Evidence only.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-untested-fire-2026-08-18-evidence/f-doors");
const BASE = "https://fundhub.ai";
const TEST = "8556bedc-46e1-4d85-b0cd-a24adfee1521";
const FORBIDDEN = "9af65808-a619-4e65-ae91-239766a006b7";
const CARD = "5410b98b-4e78-47e4-9737-b662da097740";

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

async function shot(page, slug) {
  const file = path.join(OUT, `${slug}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return path.relative(ROOT, file);
}

async function qArchive() {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();
  async function q(sql, params = []) {
    try {
      const r = await client.query(sql, params);
      return { ok: true, n: r.rows.length, rows: r.rows };
    } catch (err) {
      return { ok: false, error: String(err.message || err).slice(0, 220) };
    }
  }
  const test_cards = await q(
    `SELECT c.id, c.client_id, c.is_demo, ps.key AS stage, p.name AS pipeline
       FROM cards c
       JOIN pipeline_stages ps ON ps.id = c.stage_id
       JOIN pipelines p ON p.id = c.pipeline_id
      WHERE c.client_id = $1`,
    [TEST]
  );
  const named_card = await q(
    `SELECT id, client_id FROM cards WHERE id = $1`,
    [CARD]
  );
  const client_row = await q(
    `SELECT id,
            (custom_fields->>'crm_archived_at') AS crm_archived_at
       FROM clients
      WHERE id = $1`,
    [TEST]
  );
  const live_cards = await q(`SELECT count(*)::int AS n FROM cards`);
  await client.end();
  return { test_cards, named_card, client_row, live_cards };
}

const before = await qArchive();
fs.writeFileSync(path.join(OUT, "archive-before.json"), JSON.stringify({
  at: new Date().toISOString(),
  ...before
}, null, 2));

const writes = [];
const browser = await chromium.launch({ headless: true, executablePath: chromeExe() });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.on("dialog", async (d) => { await d.dismiss(); });
page.on("response", (res) => {
  const req = res.request();
  const url = res.url();
  if (/\/api\//.test(url) && ["POST", "PUT", "PATCH", "DELETE"].includes(req.method())) {
    writes.push({
      method: req.method(),
      status: res.status(),
      path: url.replace(BASE, "").replace(/[?#].*$/, "").slice(0, 180)
    });
  }
});

await page.goto(BASE + "/login.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.locator('input[type="email"], #email, input[name="email"]').first().fill("chris@fundhub.ai");
await page.locator('input[type="password"], #password, input[name="password"]').first().fill(PASSWORD);
await page.locator('button[type="submit"], button:has-text("Sign"), button:has-text("Log")').first().click();
await page.waitForFunction(() => !/login\.html|portal-login\.html/i.test(location.pathname), null, { timeout: 30000 });
if (page.url().includes(FORBIDDEN)) throw new Error("opened forbidden client");
await shot(page, "00-owner-login");

await page.goto(BASE + "/app/pipeline.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(2500);
if (page.url().includes(FORBIDDEN)) throw new Error("opened forbidden client");

const ui = await page.evaluate(({ test, card, forbidden }) => {
  if (location.href.includes(forbidden)) return { forbidden: true };
  const testEl = document.querySelector(`[data-client-id="${test}"]`);
  const cardEl = document.querySelector(`[data-card-id="${card}"]`);
  return {
    path: location.pathname,
    testOnBoard: !!testEl,
    namedCardOnBoard: !!cardEl,
    testCardId: testEl?.getAttribute("data-card-id") || null,
    archiveDelOnCard: !!(cardEl || testEl)?.querySelector(".c-btn.del")
  };
}, { test: TEST, card: CARD, forbidden: FORBIDDEN });

const beforeShot = await shot(page, "archive-before");

const cardStillOurs = before.named_card.n === 1
  && before.named_card.rows[0].client_id === TEST
  && before.test_cards.n >= 1
  && before.test_cards.rows.some((r) => r.id === CARD);

let how = null;
let archiveApi = null;

if (!cardStillOurs) {
  how = "skip_card_missing_or_not_test";
} else {
  const del = page.locator(`[data-card-id="${CARD}"] .c-btn.del`).first();
  if (await del.count()) {
    await del.click();
    await page.waitForTimeout(400);
    await shot(page, "archive-confirm");
    const input = page.locator("#fhDelInput, input[placeholder*='DELETE' i], #fhDelModal input").first();
    if (await input.count()) {
      await input.fill("DELETE");
      await page.waitForTimeout(200);
      const go = page.locator("#fhDelGo").first();
      if (await go.count()) {
        await go.click();
        how = "ui_del_confirm_DELETE";
        await page.waitForTimeout(1800);
      } else {
        how = "ui_confirm_missing_go";
      }
    } else {
      how = "ui_confirm_missing_input";
    }
  } else {
    how = "ui_del_missing_fallback_api";
  }

  if (how !== "ui_del_confirm_DELETE") {
    archiveApi = await page.evaluate(async ({ clientId }) => {
      const tok = localStorage.getItem("fh_token") || "";
      const r = await fetch("/api/dashboard/client-archive", {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: tok ? "Bearer " + tok : "",
          "content-type": "application/json"
        },
        body: JSON.stringify({ client_id: clientId, confirm: "DELETE" })
      });
      let data = null;
      try { data = await r.json(); } catch { data = { raw: true }; }
      return { status: r.status, ok: data && data.ok === true, archived: data && data.archived, cards_removed: data && data.cards_removed, error: data && data.error };
    }, { clientId: TEST });
    how = how + "+api";
  }
}

await page.waitForTimeout(800);
if (page.url().includes(FORBIDDEN)) throw new Error("opened forbidden client");
const afterShot = await shot(page, "archive-after");

const afterUi = await page.evaluate(({ test, card }) => {
  return {
    path: location.pathname,
    testOnBoard: !!document.querySelector(`[data-client-id="${test}"]`),
    namedCardOnBoard: !!document.querySelector(`[data-card-id="${card}"]`),
    banner: (document.body?.innerText || "").match(/Archived[\s\S]{0,80}/)?.[0] || null
  };
}, { test: TEST, card: CARD });

await context.close();
await browser.close();

const after = await qArchive();
const walk = {
  at: new Date().toISOString(),
  test_client: TEST,
  card: CARD,
  opened_forbidden: false,
  how,
  ui,
  afterUi,
  archiveApi,
  writes,
  shots: { before: beforeShot, after: afterShot },
  before,
  after
};
fs.writeFileSync(path.join(OUT, "archive-walk.json"), JSON.stringify(walk, null, 2));
console.log(JSON.stringify({
  how,
  card_before: before.named_card.n,
  card_after: after.named_card.n,
  test_cards_after: after.test_cards.n,
  archived_at: after.client_row.rows?.[0]?.crm_archived_at || null,
  writes,
  opened_forbidden: false
}, null, 2));
