/**
 * U11 live pipeline walk. Evidence only.
 * MOVE / Archive only if TEST client 8556bedc-… has a card.
 * Never opens the live credit file. Never prints secrets or names.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-untested-2026-08-18-evidence/u11");
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

const findings = [];
function rec(row) {
  findings.push(row);
  console.log(JSON.stringify({
    id: row.id,
    verdict: row.verdict || null,
    happened: String(row.happened || "").slice(0, 220)
  }));
}

async function shot(page, slug) {
  const file = path.join(OUT, `${slug}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return path.relative(ROOT, file);
}

async function apiFromPage(page, method, pathName, body) {
  return page.evaluate(async ({ method, pathName, body }) => {
    const tok = localStorage.getItem("fh_token") || "";
    const r = await fetch(pathName, {
      method,
      headers: {
        accept: "application/json",
        authorization: tok ? "Bearer " + tok : "",
        ...(body ? { "content-type": "application/json" } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    let data = null;
    try { data = await r.json(); } catch { data = { raw: true }; }
    const safe = JSON.parse(JSON.stringify(data, (k, v) => {
      if (/token|secret|password|authorization|cookie|checkout_url|payment_link|url|name|email|phone/i.test(k) && typeof v === "string" && v.length > 2) {
        return `[redacted len=${v.length}]`;
      }
      return v;
    }));
    return { status: r.status, data: safe };
  }, { method, pathName, body });
}

function netWatch(page) {
  const writes = [];
  page.on("response", (res) => {
    const req = res.request();
    const url = res.url();
    const method = req.method();
    if (/\/api\//.test(url) && ["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      writes.push({
        method,
        status: res.status(),
        path: url.replace(BASE, "").replace(/[?#].*$/, "").slice(0, 180)
      });
    }
  });
  return { writes };
}

async function waitQuiet(page, ms = 1400) {
  await page.waitForTimeout(ms);
}

async function qCards(clientId) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
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
    `SELECT c.id, c.client_id, c.is_demo, ps.key AS stage, p.name AS pipeline, c.created_at
       FROM cards c
       JOIN pipeline_stages ps ON ps.id = c.stage_id
       JOIN pipelines p ON p.id = c.pipeline_id
      WHERE c.client_id = $1`,
    [clientId]
  );
  const live_cards = await q(`SELECT count(*)::int AS n FROM cards`);
  await client.end();
  return { test_cards, live_cards };
}

const beforeDb = await qCards(TEST_CLIENT);
fs.writeFileSync(path.join(OUT, "before.json"), JSON.stringify({ at: new Date().toISOString(), ...beforeDb }, null, 2));

const browser = await chromium.launch({ headless: true, executablePath: chromeExe() });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const net = netWatch(page);
page.on("dialog", async (d) => { await d.dismiss(); });

await page.goto(BASE + "/login.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.locator('input[type="email"], #email, input[name="email"]').first().fill("chris@fundhub.ai");
await page.locator('input[type="password"], #password, input[name="password"]').first().fill(PASSWORD);
await page.locator('button[type="submit"], button:has-text("Sign"), button:has-text("Log")').first().click();
await page.waitForFunction(() => !/login\.html|portal-login\.html/i.test(location.pathname), null, { timeout: 30000 });
await shot(page, "00-owner-login");
rec({ id: "login", claim: "owner signs in", happened: page.url().replace(/[?#].*$/, ""), verdict: "WORKS" });
if (page.url().includes(FORBIDDEN)) throw new Error("opened forbidden client");

await page.goto(BASE + "/app/pipeline.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await waitQuiet(page, 2500);
if (page.url().includes(FORBIDDEN)) throw new Error("opened forbidden client");
try {
  await page.waitForSelector(`[data-client-id="${TEST_CLIENT}"]`, { timeout: 12000 });
} catch {
  /* TEST card may be absent — that is a finding, not a crash */
}

const pipe = await page.evaluate((id) => {
  const cards = document.querySelectorAll(".col-body .card, .board .card, [data-client-id]").length;
  const testEl = document.querySelector(`[data-client-id="${id}"]`);
  const testCol = testEl?.closest("[data-stage-key]");
  const moveBtns = [...document.querySelectorAll("button, .c-btn")].filter((b) => /MOVE/i.test(b.textContent || "")).length;
  const archiveBtns = [...document.querySelectorAll("button")].filter((b) => /Archive/i.test(b.textContent || "")).length;
  return {
    path: location.pathname,
    cards,
    testOnBoard: !!testEl,
    testStage: testCol?.getAttribute("data-stage-key") || null,
    moveBtns,
    archiveBtns,
    body: (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 180)
  };
}, TEST_CLIENT);
const pipeShot = await shot(page, "u11-pipeline");

const pipeApi = await apiFromPage(page, "GET", "/api/dashboard/pipeline");
const apiItems = pipeApi.data?.items || pipeApi.data?.cards || pipeApi.data?.pipelines || null;
let apiTestCount = null;
let apiCardCount = null;
try {
  const raw = JSON.stringify(pipeApi.data || {});
  apiTestCount = (raw.match(new RegExp(TEST_CLIENT, "g")) || []).length;
  apiCardCount = (raw.match(/client_id/g) || []).length;
} catch {
  apiTestCount = null;
}
rec({
  id: "u11-pipeline-api",
  claim: "GET /api/dashboard/pipeline",
  happened: `status=${pipeApi.status} ok=${pipeApi.data?.ok} test_id_hits=${apiTestCount} client_id_keys=${apiCardCount}`,
  verdict: "OBSERVED"
});

const testCardCount = beforeDb.test_cards.ok ? beforeDb.test_cards.n : 0;
if (!pipe.testOnBoard || testCardCount === 0) {
  rec({
    id: "u11-move",
    claim: "Pipeline MOVE / archive on TEST card only",
    happened: `TEST client cards=${testCardCount}. On board=${pipe.testOnBoard}. Visible cards=${pipe.cards}. MOVE buttons=${pipe.moveBtns}. Did not move a real person’s card. Did not create a card.`,
    shot: pipeShot,
    ui: pipe,
    verdict: "UNVERIFIED"
  });
} else {
  const beforeShot = await shot(page, "u11-before-move");
  const beforeWrites = net.writes.length;
  let how = null;
  const destCol = page.locator('[data-stage-key="decision_rendered"] .col-body').first();
  const testCard = page.locator(`[data-client-id="${TEST_CLIENT}"]`).first();
  if (await destCol.count()) {
    try {
      await testCard.dragTo(destCol);
      await waitQuiet(page, 1600);
      how = "drag_to_decision_rendered";
    } catch (err) {
      how = null;
      rec({
        id: "u11-drag-fail",
        happened: String(err && err.message ? err.message : err).slice(0, 180),
        verdict: "OBSERVED"
      });
    }
  }
  const stillSame = await page.evaluate((id) => {
    const el = document.querySelector(`[data-client-id="${id}"]`);
    const col = el?.closest("[data-stage-key]");
    return (col?.getAttribute("data-stage-key") || null) === "diagnostic_paid";
  }, TEST_CLIENT);
  if (!how || stillSame) {
    const move = page.locator(`[data-client-id="${TEST_CLIENT}"] .c-btn.route`).first();
    if (await move.count()) {
      await move.click();
      await waitQuiet(page, 400);
      await shot(page, "u11-move-menu");
      const lost = page.locator('#routeMenu .rm-item[data-pipeline-key="sales"][data-stage-key="lost"]');
      if (await lost.count()) {
        await lost.click();
        await waitQuiet(page, 1600);
        how = "move_menu_sales_lost";
      } else {
        how = how || "move_menu_missing_sales_lost";
      }
    } else {
      how = how || "no_move_button";
    }
  }
  await waitQuiet(page, 800);
  const afterUi = await page.evaluate((id) => {
    const el = document.querySelector(`[data-client-id="${id}"]`);
    const col = el?.closest("[data-stage-key]");
    return {
      testOnBoard: !!el,
      testStage: col?.getAttribute("data-stage-key") || null
    };
  }, TEST_CLIENT);
  const afterShot = await shot(page, "u11-after-move");
  rec({
    id: "u11-move",
    claim: "MOVE once on TEST card",
    happened: `how=${how} before_stage=${pipe.testStage} after_stage=${afterUi.testStage} on_board=${afterUi.testOnBoard}`,
    shot_before: beforeShot,
    shot_after: afterShot,
    writes: net.writes.slice(beforeWrites),
    verdict: how && how !== "no_move_button" && how !== "move_menu_missing_sales_lost" ? "OBSERVED" : "UNVERIFIED"
  });
}

await context.close();
await browser.close();

const afterDb = await qCards(TEST_CLIENT);
const walk = {
  at: new Date().toISOString(),
  test_client: TEST_CLIENT,
  opened_forbidden: false,
  findings,
  writes: net.writes,
  before: beforeDb,
  after: afterDb,
  pipe_api: { status: pipeApi.status, ok: pipeApi.data?.ok, test_id_hits: apiTestCount, client_id_keys: apiCardCount }
};
fs.writeFileSync(path.join(OUT, "walk.json"), JSON.stringify(walk, null, 2));
console.log(JSON.stringify({
  wrote: "u11/walk.json",
  verdicts: findings.map((f) => ({ id: f.id, verdict: f.verdict })),
  test_cards_before: beforeDb.test_cards.n,
  test_cards_after: afterDb.test_cards.n,
  live_cards: afterDb.live_cards.rows?.[0]?.n ?? null,
  opened_forbidden: false
}, null, 2));
