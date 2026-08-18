/**
 * W6 live fire walk. Evidence only. Does not edit the app.
 * Never prints passwords, tokens, or real client PII.
 * Never opens the live gmail credit file.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-crm-whole-2026-08-18-evidence/w6");
const BASE = "https://fundhub.ai";
const TEST_CLIENT = "8556bedc-46e1-4d85-b0cd-a24adfee1521";
const FORBIDDEN = "9af65808-a619-4e65-ae91-239766a006b7";
const DRAFT_CONTRACT = "8988b582-d98a-44c8-9173-86de54fc5788";
const DRAFT_AGENT = "AG-01";

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

function db() {
  return new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
}

const findings = [];
function rec(row) {
  findings.push(row);
  console.log(JSON.stringify({
    id: row.id,
    claim: row.claim || null,
    happened: String(row.happened || "").slice(0, 260),
    verdict: row.verdict || null
  }));
}

async function shot(page, slug) {
  const file = path.join(OUT, `${slug}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return path.relative(ROOT, file);
}

async function login(page) {
  await page.goto(BASE + "/login.html", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.locator('input[type="email"], #email, input[name="email"]').first().fill("chris@fundhub.ai");
  await page.locator('input[type="password"], #password, input[name="password"]').first().fill(PASSWORD);
  await page.locator('button[type="submit"], button:has-text("Sign"), button:has-text("Log")').first().click();
  await page.waitForFunction(() => !/login\.html|portal-login\.html/i.test(location.pathname), null, { timeout: 30000 });
}

function netWatch(page) {
  const writes = [];
  const vendor = [];
  page.on("request", (req) => {
    const url = req.url();
    if (/inquiry-removal-ai-sigma\.vercel\.app/i.test(url)) {
      vendor.push({ type: "req", method: req.method(), url: url.slice(0, 180), post: String(req.postData() || "").slice(0, 400) });
    }
  });
  page.on("response", (res) => {
    const req = res.request();
    const url = res.url();
    const method = req.method();
    if (/\/api\//.test(url) && ["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      writes.push({ method, status: res.status(), url: url.replace(BASE, "").slice(0, 200) });
    }
    if (/inquiry-removal-ai-sigma\.vercel\.app/i.test(url)) {
      vendor.push({ type: "res", status: res.status(), url: url.slice(0, 180) });
    }
  });
  return { writes, vendor };
}

async function apiFromPage(page, method, path, body) {
  return page.evaluate(async ({ method, path, body }) => {
    const tok = localStorage.getItem("fh_token") || "";
    const r = await fetch(path, {
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
      if (/token|secret|password|authorization|cookie|checkout_url|url/i.test(k) && typeof v === "string" && v.length > 12) {
        return `[redacted len=${v.length}]`;
      }
      return v;
    }));
    return { status: r.status, data: safe };
  }, { method, path, body });
}

async function bannerText(page) {
  return page.evaluate(() => {
    const ids = ["ccp-actions-status", "outboxMsg", "outboxSummary", "importResult", "sendStatus", "cpSignMsg"];
    const bits = [];
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el && el.textContent) bits.push(id + ":" + el.textContent.replace(/\s+/g, " ").trim().slice(0, 180));
    }
    const toasts = [...document.querySelectorAll(".toast, .banner, [role=status], .fh-banner")]
      .map((e) => (e.innerText || "").replace(/\s+/g, " ").trim()).filter(Boolean);
    return { bits, toasts: toasts.slice(0, 6), title: document.title, path: location.pathname + location.search, body: (document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 280) };
  });
}

const browser = await chromium.launch({
  headless: true,
  executablePath: chromeExe()
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const net = netWatch(page);

page.on("dialog", async (d) => {
  const t = d.message() || "";
  if (/voided|why is this being voided/i.test(t)) {
    await d.accept("W6 audit — unused test draft");
    return;
  }
  if (/pause sending|nothing goes out/i.test(t)) {
    await d.accept();
    return;
  }
  if (/turn sending on/i.test(t)) {
    await d.accept();
    return;
  }
  if (/send the \d+ message/i.test(t)) {
    // Refuse if it would send to real clients. Accept only when zero was already gated.
    await d.dismiss();
    return;
  }
  await d.dismiss();
});

await login(page);
await shot(page, "00-owner-login");
rec({ id: "login", claim: "owner signs in", happened: "landed " + page.url(), verdict: "WORKS" });

// ---------- 7 reconcile screens ----------
async function waitQuiet(ms = 1200) { await page.waitForTimeout(ms); }

await page.goto(BASE + "/app/pipeline.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await waitQuiet(2500);
const pipeShot = await shot(page, "07-pipeline");
const pipeUi = await page.evaluate(() => {
  const cols = [...document.querySelectorAll(".col, [data-stage-key]")].map((c) => ({
    stage: c.dataset.stageKey || (c.querySelector(".col-name, .col-hd")?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 40),
    count: (c.querySelector(".col-body .card, .card") ? c.querySelectorAll(".col-body .card, .card").length : 0),
    amt: (c.querySelector(".col-amt, .amt, .est")?.innerText || "").replace(/\s+/g, " ").trim()
  }));
  const cards = document.querySelectorAll(".col-body .card, .board .card").length;
  return { cards, cols: cols.slice(0, 16), body: (document.body.innerText || "").match(/\$0|17|est/gi)?.slice(0, 12) };
});
rec({ id: "reconcile-pipeline", claim: "17 cards vs $0 est", happened: JSON.stringify(pipeUi).slice(0, 240), shot: pipeShot, verdict: "COMPARE" });

await page.goto(BASE + "/app/products-commissions.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await waitQuiet(2000);
const prodShot = await shot(page, "07-products");
const prodUi = await page.evaluate(() => ({
  tile: document.getElementById("kProd")?.textContent,
  tileSub: document.querySelector(".stat .sd")?.textContent,
  rows: [...document.querySelectorAll("table tbody tr, .grid tr")].length,
  text: (document.body.innerText || "").replace(/\s+/g, " ").trim().slice(0, 220)
}));
rec({ id: "reconcile-products", claim: "3 variable vs table", happened: JSON.stringify(prodUi).slice(0, 240), shot: prodShot, verdict: "COMPARE" });

await page.goto(BASE + "/app/sales-floor.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await waitQuiet(2000);
const sfShot = await shot(page, "07-sales-floor");
const sfUi = await page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").trim().slice(0, 240));
rec({ id: "reconcile-sales-floor", claim: "0 closers vs 1 active", happened: sfUi, shot: sfShot, verdict: "COMPARE" });

await page.goto(BASE + "/app/ops-admin.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await waitQuiet(2500);
const peopleBtn = page.locator("button, .tab, [data-tab]").filter({ hasText: /^People$/i }).first();
if (await peopleBtn.count()) await peopleBtn.click();
await waitQuiet(800);
const opsShot = await shot(page, "07-ops-people");
const opsUi = await page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").trim().slice(0, 260));
rec({ id: "reconcile-ops-people", claim: "no staff rows vs 23", happened: opsUi, shot: opsShot, verdict: "COMPARE" });

await page.goto(BASE + "/app/staff-teams.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await waitQuiet(2000);
const staffShot = await shot(page, "07-staff-teams");
const staffUi = await page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").trim().slice(0, 220));
rec({ id: "reconcile-staff", claim: "Staff & Teams roster", happened: staffUi, shot: staffShot, verdict: "COMPARE" });

// ---------- 1 fire buttons ----------
await page.goto(BASE + `/app/client-control-panel.html?id=${TEST_CLIENT}`, { waitUntil: "domcontentloaded", timeout: 45000 });
await waitQuiet(2500);
if (page.url().includes(FORBIDDEN)) throw new Error("opened forbidden client");
await shot(page, "01-ccp-before");

const gen = page.locator("#ccp-generate-apps");
if (await gen.count()) {
  const beforeWrites = net.writes.length;
  await gen.click();
  await waitQuiet(2500);
  const after = await bannerText(page);
  await shot(page, "01-generate-apps");
  rec({
    id: "fire-generate-apps",
    claim: "Generate Apps refreshes lender apply list",
    happened: JSON.stringify(after).slice(0, 240),
    writes: net.writes.slice(beforeWrites),
    verdict: "OBSERVED"
  });
} else {
  rec({ id: "fire-generate-apps", happened: "button missing", verdict: "MISSING" });
}

const ir = page.locator("#ccp-issue-ir");
if (await ir.count()) {
  const beforeWrites = net.writes.length;
  const vendorBefore = net.vendor.length;
  await ir.click();
  await waitQuiet(3000);
  const after = await bannerText(page);
  await shot(page, "01-issue-ir");
  rec({
    id: "fire-issue-ir",
    claim: "Issue Inquiry Removal opens a case / schedule-call",
    happened: `url=${page.url()} ${JSON.stringify(after).slice(0, 180)}`,
    writes: net.writes.slice(beforeWrites),
    vendor: net.vendor.slice(vendorBefore),
    verdict: "OBSERVED"
  });
} else {
  rec({ id: "fire-issue-ir", happened: "button missing", verdict: "MISSING" });
}

// Probe live inquiry proxy (the door schedule-call would use). GET only.
const inqGet = await apiFromPage(page, "GET", "/api/inquiry?action=cases");
rec({
  id: "inquiry-proxy-get",
  claim: "GET /api/inquiry?action=cases — is vercel wired",
  happened: `status=${inqGet.status} error=${inqGet.data?.error || ""} msg=${inqGet.data?.message || ""}`.slice(0, 240),
  verdict: inqGet.status === 503 ? "BROKEN" : "OBSERVED"
});

// Specialist Send on existing test case — do not check mail (would letter a bureau).
await page.goto(BASE + "/app/inquiry-remover.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await waitQuiet(2500);
await shot(page, "01-inquiry-desk");
const caseRow = page.locator("tr, .row, .case").filter({ hasText: /Queued|e235efc2|8556bedc/i }).first();
if (await caseRow.count()) {
  await caseRow.click();
  await waitQuiet(800);
  await shot(page, "01-inquiry-case-open");
  const sendBtn = page.locator('button[data-act="send"]').first();
  if (await sendBtn.count()) {
    const beforeWrites = net.writes.length;
    const vendorBefore = net.vendor.length;
    await sendBtn.click();
    await waitQuiet(1500);
    await shot(page, "01-inquiry-send-click");
    rec({
      id: "fire-inquiry-send",
      claim: "Specialist Send (no mail box — should refuse, not call bureau)",
      happened: JSON.stringify(await bannerText(page)).slice(0, 220),
      writes: net.writes.slice(beforeWrites),
      vendor: net.vendor.slice(vendorBefore),
      verdict: "OBSERVED"
    });
  } else {
    rec({ id: "fire-inquiry-send", happened: "Send button not shown on open case", verdict: "BROKEN" });
  }
} else {
  rec({ id: "fire-inquiry-send", happened: "no queued test case row visible", verdict: "UNVERIFIED" });
}

// Messaging Send — test client has no phone / no thread. Do not text a real person.
await page.goto(BASE + `/app/messaging.html?client_id=${TEST_CLIENT}`, { waitUntil: "domcontentloaded", timeout: 45000 });
await waitQuiet(2000);
const allTab = page.locator(".ctab, button").filter({ hasText: /^All$/i }).first();
if (await allTab.count()) await allTab.click();
await waitQuiet(800);
await shot(page, "01-messaging");
const compose = page.locator("#composeBody");
if (await compose.count()) {
  await compose.fill("W6 audit ping — ignore");
  const beforeWrites = net.writes.length;
  await page.locator("#sendBtn").click();
  await waitQuiet(2000);
  await shot(page, "01-messaging-send");
  rec({
    id: "fire-messaging-send",
    claim: "Messaging Send",
    happened: JSON.stringify(await bannerText(page)).slice(0, 240),
    writes: net.writes.slice(beforeWrites),
    verdict: "OBSERVED"
  });
} else {
  rec({ id: "fire-messaging-send", happened: "compose box missing; test client has no thread/phone", verdict: "BROKEN" });
}

// Outbox send / pause
await page.goto(BASE + "/app/ops-admin.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await waitQuiet(2500);
await shot(page, "01-outbox-before");
const outSummary = await page.locator("#outboxSummary").textContent().catch(() => "");
const sendWait = page.locator("#outboxSend");
const pauseBtn = page.locator("#outboxToggle");
if (await sendWait.count() && await sendWait.isVisible()) {
  const beforeWrites = net.writes.length;
  await sendWait.click();
  await waitQuiet(1200);
  await shot(page, "01-outbox-send");
  rec({
    id: "fire-outbox-send",
    claim: "Outbox send waiting",
    happened: `summary=${(outSummary || "").slice(0, 120)} after=${JSON.stringify(await bannerText(page)).slice(0, 140)}`,
    writes: net.writes.slice(beforeWrites),
    verdict: "OBSERVED"
  });
} else {
  rec({ id: "fire-outbox-send", claim: "Outbox send", happened: `button hidden. summary=${(outSummary || "").slice(0, 160)}`, verdict: "OBSERVED" });
}
if (await pauseBtn.count() && await pauseBtn.isVisible()) {
  const label = await pauseBtn.textContent();
  const beforeWrites = net.writes.length;
  await pauseBtn.click();
  await waitQuiet(1500);
  await shot(page, "01-outbox-pause");
  // restore if we paused a live switch
  const label2 = await pauseBtn.textContent();
  if (/turn sending on|resume/i.test(label2 || "") || /pause/i.test(label || "")) {
    await pauseBtn.click();
    await waitQuiet(1000);
  }
  rec({
    id: "fire-outbox-pause",
    claim: "Outbox pause then restore",
    happened: `before=${(label || "").trim()} after=${(label2 || "").trim()} ${JSON.stringify(await bannerText(page)).slice(0, 120)}`,
    writes: net.writes.slice(beforeWrites),
    verdict: "OBSERVED"
  });
} else {
  rec({ id: "fire-outbox-pause", happened: "pause button hidden", verdict: "MISSING" });
}

// Void draft test contract. Remind on signed (expect refuse / no button).
await page.goto(BASE + "/app/documents.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await waitQuiet(2000);
const contractsTab = page.locator("button, .tab").filter({ hasText: /CONTRACT/i }).first();
if (await contractsTab.count()) await contractsTab.click();
await waitQuiet(800);
await shot(page, "01-documents-contracts");
const voidBtn = page.locator(`button[data-ct="void"][data-cid="${DRAFT_CONTRACT}"]`).first();
if (await voidBtn.count()) {
  const beforeWrites = net.writes.length;
  await voidBtn.click();
  await waitQuiet(1500);
  await shot(page, "01-contract-void");
  rec({
    id: "fire-void",
    claim: "Void unused test draft SOFT-PULL",
    happened: JSON.stringify(await bannerText(page)).slice(0, 220),
    writes: net.writes.slice(beforeWrites),
    verdict: "OBSERVED"
  });
} else {
  rec({ id: "fire-void", happened: "Void not shown on draft 8988b582 (may need admin / row not listed)", verdict: "UNVERIFIED" });
}
const remindBtn = page.locator('button[data-ct="remind"]').first();
if (await remindBtn.count()) {
  const beforeWrites = net.writes.length;
  await remindBtn.click();
  await waitQuiet(1500);
  await shot(page, "01-contract-remind");
  rec({
    id: "fire-remind",
    claim: "Remind on a listed contract",
    happened: JSON.stringify(await bannerText(page)).slice(0, 220),
    writes: net.writes.slice(beforeWrites),
    verdict: "OBSERVED"
  });
} else {
  rec({ id: "fire-remind", happened: "No Remind button (only sent/viewed get one; signed draft hidden)", verdict: "OBSERVED" });
}

// Pipeline MOVE / Archive — test client has no card. Do not move/archive a real person.
await page.goto(BASE + "/app/pipeline.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await waitQuiet(2000);
const testOnBoard = await page.evaluate((id) => {
  return !!document.querySelector(`[data-client-id="${id}"]`);
}, TEST_CLIENT);
await shot(page, "01-pipeline-board");
if (!testOnBoard) {
  rec({
    id: "fire-pipeline-move-archive",
    claim: "Pipeline MOVE / Archive on test row",
    happened: "Test client has no cards row. 17 live cards are real non-demo files. Withheld MOVE/Archive so a real person is not moved or deleted.",
    verdict: "WITHHELD"
  });
} else {
  const move = page.locator(`[data-client-id="${TEST_CLIENT}"] .c-btn.route`).first();
  if (await move.count()) {
    await move.click();
    await waitQuiet(400);
    await shot(page, "01-pipeline-move-menu");
    const item = page.locator("#routeMenu .rm-item").first();
    if (await item.count()) {
      const beforeWrites = net.writes.length;
      await item.click();
      await waitQuiet(1500);
      await shot(page, "01-pipeline-moved");
      rec({ id: "fire-pipeline-move", happened: "clicked first route", writes: net.writes.slice(beforeWrites), verdict: "OBSERVED" });
    }
  }
}

// Lender Import now — empty CSV, should not overwrite production lenders (0 rows).
await page.goto(BASE + "/app/lenders.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await waitQuiet(2000);
const importToggle = page.locator("#btnImportToggle");
if (await importToggle.count()) await importToggle.click();
await waitQuiet(300);
await shot(page, "01-lenders-import-box");
const csvBox = page.locator("#importCsv");
if (await csvBox.count()) {
  const val = await csvBox.inputValue();
  if (String(val || "").trim()) {
    rec({ id: "fire-lender-import", happened: "CSV box was not empty — withheld so production lenders are not overwritten", verdict: "WITHHELD" });
  } else {
    const beforeWrites = net.writes.length;
    await page.locator("#btnImportRun").click();
    await waitQuiet(1500);
    await shot(page, "01-lenders-import-now");
    const result = await page.locator("#importResult").textContent().catch(() => "");
    rec({
      id: "fire-lender-import",
      claim: "Import now with empty CSV",
      happened: (result || "").slice(0, 200),
      writes: net.writes.slice(beforeWrites),
      verdict: "OBSERVED"
    });
  }
} else {
  rec({ id: "fire-lender-import", happened: "import box missing", verdict: "MISSING" });
}

// Hiring hire/reject — demo candidates exist; drawer is documented read-only.
await page.goto(BASE + "/app/hiring.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await waitQuiet(2500);
await shot(page, "01-hiring");
const cand = page.locator("tr.rowbtn, tbody tr, .card").first();
if (await cand.count()) {
  await cand.click();
  await waitQuiet(1000);
  await shot(page, "01-hiring-drawer");
  const hireUi = await page.evaluate(() => {
    const text = (document.getElementById("dwBody")?.innerText || document.body.innerText || "").replace(/\s+/g, " ");
    const buttons = [...document.querySelectorAll("#drawer button, #dwBody button")].map((b) => (b.innerText || "").trim()).filter(Boolean);
    return { buttons, snippet: text.slice(0, 220) };
  });
  rec({
    id: "fire-hire-reject",
    claim: "Hire / reject on demo candidate",
    happened: JSON.stringify(hireUi).slice(0, 240),
    verdict: /nothing in this panel can be changed/i.test(hireUi.snippet) ? "MISSING" : "OBSERVED"
  });
}

// Agent Editor Save — AG-01 draft, not Setter Josh / Inquiry Removal AI.
await page.goto(BASE + "/app/agent-editor.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await waitQuiet(2000);
await shot(page, "01-agents");
const agentRow = page.locator(".alist button, .row, [data-code]").filter({ hasText: /Agent 1 Lead Follow-up|AG-01/i }).first();
if (await agentRow.count()) {
  await agentRow.click();
  await waitQuiet(600);
  const identity = await page.evaluate(() => ({
    name: document.getElementById("a_name")?.value || "",
    id: document.querySelector(".sel, .on")?.textContent || ""
  }));
  if (/setter josh|inquiry removal ai/i.test(JSON.stringify(identity))) {
    rec({ id: "fire-agent-save", happened: "landed on a live real-people agent — withheld", verdict: "WITHHELD" });
  } else {
    const beforeWrites = net.writes.length;
    await page.locator("#saveBtn").click();
    await waitQuiet(1500);
    await shot(page, "01-agent-save");
    const note = await page.evaluate(() => document.getElementById("saveNote")?.textContent || document.body.innerText.slice(0, 120));
    rec({
      id: "fire-agent-save",
      claim: "Save no-op on draft AG-01",
      happened: String(note).slice(0, 180),
      writes: net.writes.slice(beforeWrites),
      verdict: "OBSERVED"
    });
  }
} else {
  rec({ id: "fire-agent-save", happened: "AG-01 row not found", verdict: "UNVERIFIED" });
}

// Money — payment link create via live API the CRM already has. No Stripe keys. No real charge.
const payGet = await apiFromPage(page, "GET", `/api/payment-links?client_id=${TEST_CLIENT}`);
rec({
  id: "money-list",
  claim: "GET payment links for test client",
  happened: `status=${payGet.status} ok=${payGet.data?.ok} n=${(payGet.data?.items || payGet.data?.links || []).length || 0} err=${payGet.data?.error || ""}`,
  verdict: "OBSERVED"
});
const payCreate = await apiFromPage(page, "POST", "/api/payment-links", {
  action: "create",
  client_id: TEST_CLIENT,
  purpose: "diagnostic",
  description: "W6 audit diagnostic link — do not charge a real card",
  price: 32
});
rec({
  id: "money-create",
  claim: "Create $32 diagnostic payment link for test client",
  happened: `status=${payCreate.status} ok=${payCreate.data?.ok} err=${payCreate.data?.error || payCreate.data?.message || ""} has_url=${!!(payCreate.data?.item?.checkout_url || payCreate.data?.checkout_url || payCreate.data?.link?.has_url)}`,
  verdict: payCreate.data?.ok ? "WORKS" : "BROKEN"
});

// Oxylabs — launch proxy only, do not open a bank app.
const proxy = await apiFromPage(page, "POST", "/api/proxy/launch", { client_id: TEST_CLIENT });
rec({
  id: "oxylabs-launch",
  claim: "CRM can reach Oxylabs proxy launch",
  happened: `status=${proxy.status} ok=${proxy.data?.ok} err=${proxy.data?.error || proxy.data?.message || ""}`.slice(0, 240),
  verdict: proxy.data?.ok ? "WORKS" : "BROKEN"
});
await shot(page, "01-after-api");

// Stripe key presence (names only)
rec({
  id: "stripe-keys",
  claim: "Stripe test mode",
  happened: "No STRIPE_* in local .env. Payment rail in code is Commas/Fanbasis, not Stripe.",
  verdict: "MISSING"
});

await context.close();
await browser.close();

const client = db();
await client.connect();
const after = {};
after.inquiry = (await client.query(
  `SELECT id, case_status, call_fired_at, request_source FROM inquiry_removal_cases WHERE client_id=$1 ORDER BY created_at DESC`,
  [TEST_CLIENT]
)).rows;
after.contracts = (await client.query(
  `SELECT id, status, voided_at IS NOT NULL AS voided, template_key FROM contracts WHERE client_id=$1`,
  [TEST_CLIENT]
)).rows;
after.agents = (await client.query(
  `SELECT code, status, updated_at FROM agents WHERE code=$1`,
  [DRAFT_AGENT]
)).rows;
after.pay = (await client.query(
  `SELECT purpose, status, amount_cents, checkout_url IS NOT NULL AS has_url FROM payment_links WHERE client_id=$1 ORDER BY created_at DESC LIMIT 5`,
  [TEST_CLIENT]
)).rows;
after.proxy = (await client.query(
  `SELECT count(*)::int n, max(created_at) last FROM proxy_sessions WHERE client_id=$1`,
  [TEST_CLIENT]
)).rows;
after.messages = (await client.query(
  `SELECT status, channel, count(*)::int n FROM messages GROUP BY 1,2`
)).rows;
after.settings = (await client.query(`SELECT outbound_enabled FROM messaging_settings`)).rows;
await client.end();

fs.writeFileSync(path.join(OUT, "fire.json"), JSON.stringify({
  at: new Date().toISOString(),
  findings,
  writes: net.writes,
  vendor: net.vendor,
  after
}, null, 2));
console.log(JSON.stringify({ wrote: "w6/fire.json", n: findings.length, vendor_hits: net.vendor.length }, null, 2));
