/**
 * G3 owner walk on live fundhub.ai. Evidence only.
 * Never prints passwords, tokens, inbox, phone, or checkout URLs.
 * Never opens the live credit file.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-gaps-2026-08-18-evidence/g3");
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
      if (/token|secret|password|authorization|cookie|checkout_url|payment_link|url/i.test(k) && typeof v === "string" && v.length > 8) {
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
rec({ id: "login", claim: "owner signs in", happened: page.url(), verdict: "WORKS" });

if (page.url().includes(FORBIDDEN)) throw new Error("opened forbidden client");

// ---------- G3a payment landing ----------
await page.goto(BASE + `/app/client-control-panel.html?id=${TEST_CLIENT}`, { waitUntil: "domcontentloaded", timeout: 45000 });
await waitQuiet(page, 2500);
if (page.url().includes(FORBIDDEN)) throw new Error("opened forbidden client");
const ccpShot = await shot(page, "g3a-ccp-before-pay");
const ccpUi = await page.evaluate(() => {
  const text = (document.body?.innerText || "").replace(/\s+/g, " ");
  const payBtns = [...document.querySelectorAll("button, a")].map((b) => (b.innerText || "").replace(/\s+/g, " ").trim())
    .filter((t) => /pay|link|diagnostic|\$32|checkout|commas|fanbasis/i.test(t));
  return {
    path: location.pathname + location.search,
    payish: payBtns.slice(0, 12),
    has_tu: !!document.getElementById("ccp-pull-tu"),
    has_ex: !!document.getElementById("ccp-pull-ex"),
    has_eq: !!document.getElementById("ccp-pull-eq"),
    desk: (document.getElementById("ccp-actions-desk-note")?.innerText || "").trim(),
    status: (document.getElementById("ccp-issue-ir-status")?.innerText || "").trim(),
    body: text.slice(0, 280)
  };
});
rec({
  id: "g3a-ccp-ui",
  claim: "Owner on test client — payment create control",
  happened: JSON.stringify(ccpUi).slice(0, 280),
  shot: ccpShot,
  verdict: ccpUi.payish.length ? "OBSERVED" : "MISSING"
});

const payGet = await apiFromPage(page, "GET", `/api/payment-links?client_id=${TEST_CLIENT}`);
rec({
  id: "g3a-list",
  claim: "GET payment links for test client",
  happened: `status=${payGet.status} ok=${payGet.data?.ok} n=${(payGet.data?.items || payGet.data?.links || []).length || 0} err=${payGet.data?.error || ""}`,
  verdict: "OBSERVED"
});

const payCreate = await apiFromPage(page, "POST", "/api/payment-links", {
  action: "create",
  client_id: TEST_CLIENT,
  purpose: "diagnostic",
  description: "G3 audit diagnostic link — do not charge a real card",
  price: 32
});
const createErr = payCreate.data?.error || payCreate.data?.message || "";
const hasLink = !!(payCreate.data?.item?.has_url || payCreate.data?.checkout_url || payCreate.data?.item?.checkout_url || payCreate.data?.link);
rec({
  id: "g3a-create",
  claim: "Create $32 diagnostic payment link (Commas/Fanbasis)",
  happened: `status=${payCreate.status} ok=${payCreate.data?.ok} err=${createErr} has_url=${hasLink}`,
  http: { status: payCreate.status, error: createErr, ok: payCreate.data?.ok || false },
  verdict: payCreate.data?.ok ? "WORKS" : (/commas_not_configured|not configured|FANBASIS/i.test(createErr) ? "BROKEN" : "BROKEN")
});
await shot(page, "g3a-after-create-api");

// ---------- G3d bureau pulls ----------
const pullStatusBefore = await page.evaluate(() => (document.getElementById("ccp-issue-ir-status")?.innerText || "").trim());
const tu = page.locator("#ccp-pull-tu");
if (await tu.count()) {
  const before = net.writes.length;
  await tu.click();
  await waitQuiet(page, 3500);
  const after = await page.evaluate(() => ({
    status: (document.getElementById("ccp-issue-ir-status")?.innerText || "").trim(),
    body: (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 220)
  }));
  const tuShot = await shot(page, "g3d-pull-transunion");
  rec({
    id: "g3d-tu",
    claim: "Click Pull TransUnion on test client",
    happened: `before=${pullStatusBefore} after=${after.status}`,
    writes: net.writes.slice(before),
    shot: tuShot,
    verdict: /could not|consent|refuse|error/i.test(after.status) ? "BROKEN" : (/finished|stored report/i.test(after.status) ? "WORKS" : "OBSERVED")
  });
} else {
  rec({ id: "g3d-tu", happened: "Pull TransUnion button missing", verdict: "MISSING" });
}

const ex = page.locator("#ccp-pull-ex");
if (await ex.count()) {
  const before = net.writes.length;
  await ex.click();
  await waitQuiet(page, 3000);
  const after = await page.evaluate(() => (document.getElementById("ccp-issue-ir-status")?.innerText || "").trim());
  await shot(page, "g3d-pull-experian");
  rec({
    id: "g3d-ex",
    claim: "Click Pull Experian on test client",
    happened: after,
    writes: net.writes.slice(before),
    verdict: /could not|consent|refuse|error/i.test(after) ? "BROKEN" : (/finished/i.test(after) ? "WORKS" : "OBSERVED")
  });
}

const eq = page.locator("#ccp-pull-eq");
if (await eq.count()) {
  const before = net.writes.length;
  await eq.click();
  await waitQuiet(page, 3000);
  const after = await page.evaluate(() => (document.getElementById("ccp-issue-ir-status")?.innerText || "").trim());
  await shot(page, "g3d-pull-equifax");
  rec({
    id: "g3d-eq",
    claim: "Click Pull Equifax on test client",
    happened: after,
    writes: net.writes.slice(before),
    verdict: /could not|consent|refuse|error/i.test(after) ? "BROKEN" : (/finished/i.test(after) ? "WORKS" : "OBSERVED")
  });
}

const softPullApi = await apiFromPage(page, "POST", "/api/finance/soft-pull", { client_id: TEST_CLIENT });
rec({
  id: "g3d-soft-pull-api",
  claim: "POST /api/finance/soft-pull on test client (no separate CCP button)",
  happened: `status=${softPullApi.status} ok=${softPullApi.data?.ok} err=${softPullApi.data?.error || softPullApi.data?.message || ""}`.slice(0, 240),
  verdict: softPullApi.data?.ok ? "WORKS" : "BROKEN"
});

// ---------- G3c inquiry complete (observe only — do not mark_cleared) ----------
await page.goto(BASE + "/app/inquiry-remover.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await waitQuiet(page, 2500);
await shot(page, "g3c-inquiry-desk");
const caseRow = page.locator("tr, .row, .case, button, a").filter({ hasText: /Queued|f872cc9d|8556bedc/i }).first();
if (await caseRow.count()) {
  await caseRow.click();
  await waitQuiet(page, 1200);
  const detail = await page.evaluate(() => {
    const acts = [...document.querySelectorAll("[data-act], [data-case-act], button")]
      .map((b) => ({
        act: b.getAttribute("data-act") || b.getAttribute("data-case-act") || "",
        text: (b.innerText || "").replace(/\s+/g, " ").trim()
      }))
      .filter((x) => /clear|close|send|complete|mark/i.test(x.act + x.text));
    return {
      acts: acts.slice(0, 12),
      snippet: (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 260)
    };
  });
  await shot(page, "g3c-inquiry-case-open");
  rec({
    id: "g3c-ui",
    claim: "Can a test case complete from the UI without a bureau call?",
    happened: JSON.stringify(detail).slice(0, 280),
    note: "Did not press Mark Cleared / Close — that would emit inquiry.removed without a bureau removal.",
    verdict: "OBSERVED"
  });
} else {
  rec({ id: "g3c-ui", happened: "no queued test case row visible", verdict: "UNVERIFIED" });
}

// ---------- G3e messaging — only if screen will send to stored dest; do not rewrite client ----------
await page.goto(BASE + `/app/messaging.html?client_id=${TEST_CLIENT}`, { waitUntil: "domcontentloaded", timeout: 45000 });
await waitQuiet(page, 2200);
const allTab = page.locator(".ctab, button").filter({ hasText: /^All$/i }).first();
if (await allTab.count()) await allTab.click();
await waitQuiet(page, 600);
await shot(page, "g3e-messaging");
const msgUi = await page.evaluate(() => {
  const compose = document.getElementById("composeBody");
  const send = document.getElementById("sendBtn");
  const status = (document.getElementById("sendStatus")?.innerText || "").trim();
  const note = (document.getElementById("composeNote")?.innerText || "").trim();
  const ch = (document.getElementById("composeChannel")?.innerText || "").trim();
  return {
    hasCompose: !!compose,
    composeDisabled: !!(compose && compose.disabled),
    sendDisabled: !!(send && send.disabled),
    status,
    note,
    ch,
    body: (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 220)
  };
});
rec({
  id: "g3e-screen",
  claim: "Messaging on test client — will the screen send?",
  happened: JSON.stringify(msgUi).slice(0, 260),
  verdict: "OBSERVED"
});

const destNote = {
  FUNDHUB_TEST_INBOX_set: !!String(process.env.FUNDHUB_TEST_INBOX || "").trim(),
  FUNDHUB_TEST_PHONE_set: !!String(process.env.FUNDHUB_TEST_PHONE || "").trim(),
  screen_uses_client_record_only: true,
  did_not_rewrite_client_contact: true
};

if (msgUi.hasCompose && !msgUi.composeDisabled && !msgUi.sendDisabled) {
  await page.locator("#composeBody").fill("G3 audit ping — ignore. Do not reply.");
  const before = net.writes.length;
  await page.locator("#sendBtn").click();
  await waitQuiet(page, 2500);
  const after = await page.evaluate(() => (document.getElementById("sendStatus")?.innerText || "").trim());
  await shot(page, "g3e-messaging-send");
  rec({
    id: "g3e-send",
    claim: "One Messaging send on test client",
    happened: after,
    dest: destNote,
    writes: net.writes.slice(before),
    verdict: /not sent|no phone|no email|no address/i.test(after) ? "BROKEN" : "OBSERVED"
  });
} else {
  rec({
    id: "g3e-send",
    claim: "One Messaging send to FUNDHUB_TEST_INBOX / FUNDHUB_TEST_PHONE",
    happened: "Screen would not send. Compose uses the client record, not the env destinations. Did not rewrite the test client contact. Did not text a real person.",
    dest: destNote,
    ui: msgUi,
    verdict: "BROKEN"
  });
}

// ---------- G3f pipeline Archive / MOVE ----------
await page.goto(BASE + "/app/pipeline.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await waitQuiet(page, 2500);
const pipe = await page.evaluate((id) => {
  const cards = document.querySelectorAll(".col-body .card, .board .card, [data-client-id]").length;
  const testOnBoard = !!document.querySelector(`[data-client-id="${id}"]`);
  return {
    cards,
    testOnBoard,
    body: (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 200)
  };
}, TEST_CLIENT);
const pipeShot = await shot(page, "g3f-pipeline");
if (!pipe.testOnBoard) {
  rec({
    id: "g3f-move",
    claim: "Pipeline Archive / MOVE on test card",
    happened: `Test client not on board. Visible cards=${pipe.cards}. Did not move real people.`,
    shot: pipeShot,
    verdict: "UNVERIFIED"
  });
} else {
  rec({
    id: "g3f-move",
    happened: "Test card present — still withheld MOVE in this pass until DB row is confirmed in the same script.",
    shot: pipeShot,
    verdict: "OBSERVED"
  });
}

await context.close();
await browser.close();

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
const after = {
  payment_links: await q(
    `SELECT id, purpose, status, amount_cents, checkout_url IS NOT NULL AS has_url, created_at
       FROM payment_links WHERE client_id=$1 ORDER BY created_at DESC LIMIT 5`,
    [TEST_CLIENT]
  ),
  soft_pulls: await q(
    `SELECT id, status, created_at FROM soft_pull_requests WHERE client_id=$1 ORDER BY created_at DESC LIMIT 8`,
    [TEST_CLIENT]
  ),
  crs: await q(
    `SELECT id, created_at FROM crs_results WHERE client_id=$1 ORDER BY created_at DESC LIMIT 5`,
    [TEST_CLIENT]
  ),
  inquiry_removed: await q(`SELECT count(*)::int AS n FROM events WHERE name='inquiry.removed'`),
  cards: await q(
    `SELECT c.id, c.client_id, ps.key AS stage, p.name AS pipeline
       FROM cards c
       JOIN pipeline_stages ps ON ps.id = c.stage_id
       JOIN pipelines p ON p.id = c.pipeline_id
      WHERE c.client_id=$1`,
    [TEST_CLIENT]
  ),
  live_cards: await q(
    `SELECT count(*)::int AS n FROM cards`
  ),
  messages: await q(
    `SELECT id, channel, status, to_address IS NOT NULL AS has_to, created_at
       FROM messages WHERE client_id=$1 ORDER BY created_at DESC LIMIT 5`,
    [TEST_CLIENT]
  ),
  consents: await q(
    `SELECT id, kind, capture_method, revoked_at IS NOT NULL AS revoked, granted_at
       FROM client_consents WHERE client_id=$1 ORDER BY granted_at DESC`,
    [TEST_CLIENT]
  )
};
await client.end();

fs.writeFileSync(path.join(OUT, "walk.json"), JSON.stringify({
  at: new Date().toISOString(),
  findings,
  writes: net.writes,
  after
}, null, 2));
console.log(JSON.stringify({ wrote: "g3/walk.json", n: findings.length }, null, 2));
