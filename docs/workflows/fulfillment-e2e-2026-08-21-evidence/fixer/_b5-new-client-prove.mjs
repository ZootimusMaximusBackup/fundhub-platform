#!/usr/bin/env node
/** B5 — click New Client on Pipeline. Plus-tag only. Never the forbidden file. */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  ROOT, BASE, FORBIDDEN, plusTag, staffLogin, launchBrowser, openDb, q, guardClient, writeJson
} from "../_lib.mjs";

const { default: handler } = await import("../../../../api/pipeline-clients.mjs");

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(ROOT, "public/app/pipeline.html"), "utf8");
const RAW = join(HERE, "shots/_raw");
mkdirSync(RAW, { recursive: true });

function mkRes() {
  return {
    statusCode: null, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; }
  };
}

async function shot(page, name) {
  const p = join(RAW, `${name}.png`);
  await page.screenshot({ path: p, fullPage: false });
  return p;
}

async function boxOf(page, sel) {
  const loc = page.locator(sel).first();
  if (!(await loc.count())) return null;
  await loc.scrollIntoViewIfNeeded().catch(() => null);
  const b = await loc.boundingBox();
  if (!b) return null;
  return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
}

function applyMarks(file, legend, marks) {
  const man = join(HERE, "shot-marks.json");
  let cur = {};
  if (existsSync(man)) {
    try { cur = JSON.parse(readFileSync(man, "utf8")); } catch { cur = {}; }
  }
  cur[file] = { legend, marks: marks.filter((m) => m.box) };
  writeFileSync(man, JSON.stringify(cur, null, 2));
  const py = join(HERE, "_apply-marks.py");
  if (existsSync(py)) spawnSync("python3", [py], { cwd: HERE, stdio: "inherit" });
}

const email = plusTag(`b5p${String(Date.now()).slice(-8)}`);
const name = "B5 Pipe Tester";
const phone = "5550100888";
const product = "card-stacking-dfy";

const browser = await launchBrowser();
const page = await browser.newPage();
await page.setViewportSize({ width: 1440, height: 900 });

await staffLogin(page);

await page.route("**/app/pipeline.html**", async (route) => {
  if (route.request().resourceType() !== "document" && !route.request().url().includes("pipeline.html")) {
    return route.continue();
  }
  await route.fulfill({
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: HTML
  });
});

const posts = [];
await page.route("**/api/pipeline-clients", async (route) => {
  const req = route.request();
  if (req.method() !== "POST") {
    await route.fulfill({ status: 405, contentType: "application/json", body: JSON.stringify({ ok: false }) });
    return;
  }
  const headers = req.headers();
  const body = req.postDataJSON() || {};
  const res = mkRes();
  await handler({
    method: "POST",
    headers: {
      authorization: headers.authorization || "",
      cookie: headers.cookie || "",
      "x-session-token": headers["x-session-token"] || ""
    },
    body
  }, res);
  posts.push({ status: res.statusCode, body: res.body });
  await route.fulfill({
    status: res.statusCode || 500,
    contentType: "application/json",
    body: JSON.stringify(res.body || { ok: false })
  });
});

await page.goto(`${BASE}/app/pipeline.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForSelector("#fhNewClient", { timeout: 20000 });
await page.waitForTimeout(800);

await page.locator("#fhNewClient").click();
await page.waitForSelector("#fhNewModal.open", { timeout: 8000 });
await page.locator("#fhNewName").fill(name);
await page.locator("#fhNewEmail").fill(email);
await page.locator("#fhNewPhone").fill(phone);
await page.locator("#fhNewProduct").selectOption(product);
await page.waitForTimeout(200);

const modalShot = await shot(page, "b5-new-client-modal-1440");
applyMarks("b5-new-client-modal-1440.png", "New Client on Pipeline", [
  { n: "1", caption: "New Client button on this board", box: await boxOf(page, "#fhNewClient") },
  { n: "2", caption: "Name, email, phone, product", box: await boxOf(page, "#fhNewModal .fh-del-card") },
  { n: "3", caption: "Save uses the same door as the apply form", box: await boxOf(page, "#fhNewGo") }
]);

const [resp] = await Promise.all([
  page.waitForResponse((r) => r.url().includes("/api/pipeline-clients") && r.request().method() === "POST", { timeout: 90000 }),
  page.locator("#fhNewGo").click()
]);
const httpStatus = resp.status();
await page.waitForTimeout(1200);
const afterShot = await shot(page, "b5-new-client-after-1440");
applyMarks("b5-new-client-after-1440.png", "After Save", [
  { n: "1", caption: "New Client still on the board", box: await boxOf(page, "#fhNewClient") },
  { n: "2", caption: "Modal closed after a good save", box: await boxOf(page, "#fhNewModal") }
]);

await browser.close();

const db = await openDb();
const clients = await q(db, `
  SELECT id, email, first_name, last_name, channel_source,
         custom_fields->>'product' AS product
  FROM clients
  WHERE lower(email) = lower($1)
  LIMIT 3
`, [email]);
for (const row of clients) guardClient(row.id);
if (clients.some((r) => String(r.id).toLowerCase() === FORBIDDEN)) {
  throw new Error("REFUSED: forbidden client");
}

const clientId = clients[0]?.id || null;
let events = [];
let cards = [];
if (clientId) {
  guardClient(clientId);
  events = await q(db, `
    SELECT id, name, created_at
    FROM events
    WHERE client_id = $1 AND name = 'entry.captured'
    ORDER BY created_at DESC
    LIMIT 3
  `, [clientId]);
  cards = await q(db, `
    SELECT c.id, p.key AS pipeline_key, ps.key AS stage_key
    FROM cards c
    JOIN pipeline_stages ps ON ps.id = c.stage_id
    JOIN pipelines p ON p.id = ps.pipeline_id
    WHERE c.client_id = $1
  `, [clientId]);
}
await db.end();

const proof = {
  ok: !!(clientId && posts[0]?.status === 200 && posts[0]?.body?.ok),
  forbidden_untouched: true,
  plus_tag_used: true,
  email,
  httpStatus,
  posts,
  client: clients[0] || null,
  entry_captured: events,
  cards,
  shots: {
    modal: "fixer/shots/b5-new-client-modal-1440-MARKED.png",
    after: "fixer/shots/b5-new-client-after-1440-MARKED.png"
  },
  note: "Live fundhub.ai still 404s this door until merge. The click used live Pipeline with this branch's HTML, and the save ran the real handler against the live database — same resolveClient + entry.captured path the funnel uses. No second insert."
};

const out = writeJson("fixer/b5-new-client.json", proof);
console.log(JSON.stringify({
  ok: proof.ok,
  client_id: clientId,
  httpStatus,
  events: events.length,
  cards: cards.length,
  out
}, null, 2));
if (!proof.ok) process.exit(1);
