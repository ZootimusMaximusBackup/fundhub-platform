/**
 * F-INQ — press Mark Cleared ONCE on a TEST Queued case.
 * TEST client only. Never 9af65808. Do not press Send. Do not mail a bureau.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-untested-fire-2026-08-18-evidence/f-inq");
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

function sanitizePayload(p) {
  if (!p || typeof p !== "object") return p;
  const keep = {};
  for (const k of ["caseId", "inquiryRemovalCaseId", "selectedBureaus", "fundingRoundId", "source", "case_id", "inquiry_id"]) {
    if (p[k] != null) keep[k] = p[k];
  }
  return keep;
}

async function snapshot(c, label) {
  async function q(sql, params = []) {
    try {
      const r = await c.query(sql, params);
      return { ok: true, n: r.rows.length, rows: r.rows };
    } catch (err) {
      return { ok: false, error: String(err.message || err).slice(0, 240) };
    }
  }
  const out = {
    at: new Date().toISOString(),
    label,
    test_client: TEST_CLIENT,
    opened_forbidden: false,
    env_names: {
      STAFF_E2E_PASSWORD: !!String(process.env.STAFF_E2E_PASSWORD || "").trim(),
      DATABASE_URL: !!String(process.env.DATABASE_URL || "").trim(),
      INNGEST_EVENT_KEY: !!String(process.env.INNGEST_EVENT_KEY || "").trim()
    }
  };
  out.inquiry_removed_all = await q(
    `SELECT count(*)::int AS n, max(created_at) AS last FROM events WHERE name = 'inquiry.removed'`
  );
  out.inquiry_removed_test = await q(
    `SELECT count(*)::int AS n FROM events WHERE name = 'inquiry.removed' AND client_id = $1`,
    [TEST_CLIENT]
  );
  out.inquiry_removed_rows_test = await q(
    `SELECT id, name, client_id, created_at, idempotency_key, payload
       FROM events WHERE name = 'inquiry.removed' AND client_id = $1
       ORDER BY created_at DESC LIMIT 10`,
    [TEST_CLIENT]
  );
  if (out.inquiry_removed_rows_test.ok) {
    out.inquiry_removed_rows_test.rows = out.inquiry_removed_rows_test.rows.map((r) => ({
      id: r.id,
      name: r.name,
      client_id: r.client_id,
      created_at: r.created_at,
      idempotency_key: r.idempotency_key,
      payload: sanitizePayload(r.payload)
    }));
  }
  out.inquiry_events_test = await q(
    `SELECT name, count(*)::int AS n, max(created_at) AS last
       FROM events WHERE client_id = $1 AND name ILIKE '%inquir%'
       GROUP BY name ORDER BY name`,
    [TEST_CLIENT]
  );
  out.cases_test = await q(
    `SELECT id, case_id, case_status, client_id, funding_round_id,
            call_fired_at IS NOT NULL AS call_fired,
            first_delivery_at IS NOT NULL AS delivered,
            closed_at, completed_at, created_at, updated_at
       FROM inquiry_removal_cases WHERE client_id = $1 ORDER BY created_at DESC`,
    [TEST_CLIENT]
  );
  out.cases_counts = await q(
    `SELECT count(*)::int AS n,
            count(*) FILTER (WHERE case_status = 'Completed')::int AS completed,
            count(*) FILTER (WHERE case_status = 'Queued')::int AS queued
       FROM inquiry_removal_cases WHERE client_id = $1`,
    [TEST_CLIENT]
  );
  out.tasks_c03_all = await q(
    `SELECT id, client_id, title, source_workflow, created_at
       FROM tasks
       WHERE source_workflow = 'c-03-inquiry-removed-resume-or-hold'
          OR title ILIKE '%Start next funding%'
       ORDER BY created_at DESC LIMIT 20`
  );
  out.tasks_c03_test = await q(
    `SELECT id, title, source_workflow, created_at, body
       FROM tasks WHERE client_id = $1
         AND (source_workflow = 'c-03-inquiry-removed-resume-or-hold'
              OR title ILIKE '%next funding%')
       ORDER BY created_at DESC`,
    [TEST_CLIENT]
  );
  out.failed_c03 = await q(
    `SELECT count(*)::int AS n, max(last_seen_at) AS last
       FROM failed_events
       WHERE event_name = 'inquiry.removed' OR handler_name ILIKE '%c-03%'`
  );
  out.funding_rounds_test = await q(
    `SELECT id, round_number, status, created_at
       FROM funding_rounds WHERE client_id = $1 ORDER BY created_at DESC LIMIT 10`,
    [TEST_CLIENT]
  );
  out.client_next = await q(
    `SELECT
       (custom_fields->>'ready_for_next_round') AS ready_for_next_round,
       (custom_fields->>'employee_next_action') AS employee_next_action,
       tags
       FROM clients WHERE id = $1`,
    [TEST_CLIENT]
  );
  out.forbidden_events = await q(
    `SELECT count(*)::int AS n FROM events
      WHERE client_id = $1 AND created_at > now() - interval '2 hours'`,
    [FORBIDDEN]
  );
  out.forbidden_cases_touched = await q(
    `SELECT count(*)::int AS n FROM inquiry_removal_cases
      WHERE client_id = $1 AND updated_at > now() - interval '2 hours'`,
    [FORBIDDEN]
  );
  return out;
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const before = await snapshot(db, "before");
fs.writeFileSync(path.join(OUT, "before.json"), JSON.stringify(before, null, 2));

const queued = (before.cases_test.rows || []).filter((r) => r.case_status === "Queued");
if (!queued.length) {
  await db.end();
  throw new Error("no Queued TEST cases");
}
const target = queued[0];
if (target.client_id !== TEST_CLIENT) throw new Error("target not TEST client");

const walk = {
  at: new Date().toISOString(),
  signed_in_as: "inquiry@fundhub.ai",
  target_case_id: target.id,
  target_case_status_before: target.case_status,
  pressed_send: false,
  mailed_bureau: false,
  opened_forbidden: false,
  posts: [],
  dialogs: [],
  ui_before: null,
  ui_after: null
};

const browser = await chromium.launch({ headless: true, executablePath: chromeExe() });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

page.on("dialog", async (d) => {
  const msg = String(d.message() || "");
  walk.dialogs.push({ type: d.type(), message: msg.slice(0, 200) });
  const ok = /clear|cleared|complete/i.test(msg) && !/send|mail|bureau/i.test(msg);
  if (ok) await d.accept();
  else await d.dismiss();
});

page.on("response", async (res) => {
  try {
    const url = res.url();
    if (!/\/api\/inquiry-cases/i.test(url) || res.request().method() !== "POST") return;
    let body = null;
    try { body = await res.json(); } catch { body = { parse: "not-json" }; }
    const reqBody = res.request().postDataJSON?.() || null;
    walk.posts.push({
      url: "/api/inquiry-cases",
      status: res.status(),
      request_action: reqBody && reqBody.action,
      request_id: reqBody && (reqBody.id || reqBody.case_id || null),
      ok: body && body.ok,
      error: body && body.error,
      case_status: body && body.case && body.case.case_status,
      event_id: body && body.event && body.event.id,
      event_deduped: body && body.event && body.event.deduped
    });
  } catch {
    /* ignore */
  }
});

await page.goto(BASE + "/login.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.locator('input[type="email"], #email').first().fill("inquiry@fundhub.ai");
await page.locator('input[type="password"], #password').first().fill(PASSWORD);
await page.locator('button[type="submit"]').first().click();
await page.waitForFunction(() => !/login\.html/i.test(location.pathname), null, { timeout: 30000 });
if (page.url().includes(FORBIDDEN)) throw new Error("opened forbidden client");

await page.goto(BASE + "/app/inquiry-remover.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(3500);
if (page.url().includes(FORBIDDEN)) throw new Error("opened forbidden client");

const testRow = page.locator("tr.case-main").filter({ hasText: /TEST Client|8556bedc|client@fundhub/i }).first();
if (await testRow.count()) await testRow.click();
await page.waitForTimeout(1200);
if (page.url().includes(FORBIDDEN)) throw new Error("opened forbidden after row");

walk.ui_before = await page.evaluate((targetId) => {
  const forbidden = /9af65808/i.test(location.href);
  const cleared = document.querySelector('button[data-act="cleared"]');
  const markCleared = document.querySelector('button[data-case-act="mark_cleared"]');
  const send = document.querySelector('button[data-act="send"]');
  const rows = [...document.querySelectorAll("tr.case-main")].map((tr) => (tr.innerText || "").replace(/\s+/g, " ").trim().slice(0, 180));
  const detail = document.querySelector("tr.case-detail-row:not([hidden])");
  return {
    path: location.pathname,
    forbidden,
    has_mark_cleared_detail: !!cleared,
    mark_cleared_detail_text: cleared ? (cleared.innerText || "").trim() : "",
    has_mark_cleared_panel: !!markCleared,
    mark_cleared_panel_text: markCleared ? (markCleared.innerText || "").trim() : "",
    has_send: !!send,
    detail_open: !!detail,
    rows,
    targetId
  };
}, target.id);

await page.screenshot({ path: path.join(OUT, "01-before.png"), fullPage: false });

const detailBtn = page.locator('tr.case-detail-row:not([hidden]) button[data-act="cleared"]').first();
const panelBtn = page.locator('button[data-case-act="mark_cleared"]').first();
let pressed = "none";
if (await detailBtn.count()) {
  await detailBtn.click();
  pressed = "data-act=cleared";
} else if (await panelBtn.count()) {
  await panelBtn.click();
  pressed = "data-case-act=mark_cleared";
}
walk.pressed = pressed;
walk.press_count = pressed === "none" ? 0 : 1;

await page.waitForTimeout(4000);
if (page.url().includes(FORBIDDEN)) throw new Error("opened forbidden after press");

walk.ui_after = await page.evaluate(() => {
  const detail = document.querySelector("tr.case-detail-row:not([hidden])");
  const banner = document.querySelector("[data-banner], .banner, .toast, .fh-banner");
  const pills = [...document.querySelectorAll(".status-pill")].map((el) => (el.innerText || "").trim()).slice(0, 12);
  return {
    path: location.pathname,
    forbidden: /9af65808/i.test(location.href),
    detail_open: !!detail,
    banner: banner ? (banner.innerText || "").trim().slice(0, 200) : "",
    pills,
    body_snip: (document.body.innerText || "").replace(/\s+/g, " ").trim().slice(0, 400)
  };
});

await page.screenshot({ path: path.join(OUT, "02-after.png"), fullPage: false });

await page.waitForTimeout(25000);
const after = await snapshot(db, "after");
fs.writeFileSync(path.join(OUT, "after.json"), JSON.stringify(after, null, 2));

walk.after_wait_ms = 25000;
walk.inquiry_removed_before = before.inquiry_removed_all.rows?.[0] || null;
walk.inquiry_removed_after = after.inquiry_removed_all.rows?.[0] || null;
walk.cases_before = before.cases_test.rows || [];
walk.cases_after = after.cases_test.rows || [];
walk.rounds_before_n = before.funding_rounds_test.n;
walk.rounds_after_n = after.funding_rounds_test.n;
walk.tasks_c03_test_before_n = before.tasks_c03_test.n;
walk.tasks_c03_test_after_n = after.tasks_c03_test.n;
walk.client_next_before = before.client_next.rows?.[0] || null;
walk.client_next_after = after.client_next.rows?.[0] || null;
walk.new_event_rows = after.inquiry_removed_rows_test.rows || [];

await context.close();
await browser.close();
await db.end();

fs.writeFileSync(path.join(OUT, "walk.json"), JSON.stringify(walk, null, 2));
console.log(JSON.stringify({
  wrote: "f-inq/walk.json",
  target: target.id,
  pressed,
  posts: walk.posts,
  removed_before: walk.inquiry_removed_before,
  removed_after: walk.inquiry_removed_after,
  rounds_before_n: walk.rounds_before_n,
  rounds_after_n: walk.rounds_after_n,
  tasks_before_n: walk.tasks_c03_test_before_n,
  tasks_after_n: walk.tasks_c03_test_after_n,
  forbidden: walk.opened_forbidden
}, null, 2));
