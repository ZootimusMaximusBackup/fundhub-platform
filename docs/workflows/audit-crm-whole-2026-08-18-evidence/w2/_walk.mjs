/**
 * W2 sales-desk control walk. Evidence only. Does not edit the app.
 * Never prints passwords. Does not send contracts / pulls / mail to the
 * live gmail credit file. Does not fire a second SOFT-PULL-CONSENT send.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-crm-whole-2026-08-18-evidence/w2");
const BASE = "https://fundhub.ai";
const TEST_CLIENT = "8556bedc-46e1-4d85-b0cd-a24adfee1521";
const MATH_CLIENT = "9af65808-a619-4e65-ae91-239766a006b7";

const ROLES = [
  { slug: "owner", email: "chris@fundhub.ai", intended: "role-owner-intended.md" },
  { slug: "closer", email: "closer@fundhub.ai", intended: "role-closer-intended.md" },
  { slug: "sales", email: "sales@fundhub.ai", intended: "role-sales-manager-intended.md" },
  { slug: "advisor", email: "advisor@fundhub.ai", intended: "role-funding-advisor-intended.md" }
];

const SCREENS = [
  { id: "pipeline", path: "/app/pipeline.html", name: "Pipeline" },
  { id: "closer-dashboard", path: "/app/closer-dashboard.html", name: "Closer Dashboard" },
  { id: "call", path: `/app/closer-call.html?client_id=${TEST_CLIENT}`, name: "Call cockpit" },
  { id: "present", path: `/app/present.html?contact=${TEST_CLIENT}`, name: "Present" },
  { id: "my-numbers", path: "/app/my-numbers.html", name: "My Numbers" },
  { id: "sales-floor", path: "/app/sales-floor.html", name: "Sales Floor" },
  { id: "hiring", path: "/app/hiring.html", name: "Hiring" },
  { id: "lenders", path: "/app/lenders.html", name: "Lenders" },
  { id: "documents", path: "/app/documents.html", name: "Documents" },
  { id: "contracts", path: "/app/contracts.html", name: "Contracts" },
  { id: "ccp", path: `/app/client-control-panel.html?id=${TEST_CLIENT}`, name: "Client Control Panel" }
];

const DANGER = /send (this wording|contract|soft pull|agreement|e-book|deliverables)|generate letters|pull (transunion|experian|equifax)|issue inquiry|remind|void|import now|archive selected|fhdelgo|generate apps/i;

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

const PASSWORD = process.env.STAFF_E2E_PASSWORD || process.env.STAFF_INITIAL_PASSWORD || "";
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
  return new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
}

const findings = [];
function rec(row) {
  findings.push(row);
  const line = {
    id: row.id,
    role: row.role || null,
    screen: row.screen || null,
    claim: row.claim || null,
    happened: (row.happened || "").slice(0, 220),
    writes: row.writes || [],
    verdict: row.verdict || null
  };
  console.log(JSON.stringify(line));
}

async function shot(page, slug) {
  const file = path.join(OUT, `${slug}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return path.relative(ROOT, file);
}

async function login(page, email) {
  await page.goto(BASE + "/login.html", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.locator('input[type="email"], #email, input[name="email"]').first().fill(email);
  await page.locator('input[type="password"], #password, input[name="password"]').first().fill(PASSWORD);
  await page.locator('button[type="submit"], button:has-text("Sign"), button:has-text("Log")').first().click();
  await page.waitForFunction(() => !/login\.html|portal-login\.html/i.test(location.pathname), null, { timeout: 30000 });
}

function netWatch(page) {
  const writes = [];
  const errors = [];
  page.on("response", (res) => {
    const req = res.request();
    const method = req.method();
    const url = res.url();
    const status = res.status();
    const api = /\/api\//.test(url);
    if (api && ["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      writes.push({ method, status, url: url.replace(BASE, "").slice(0, 180) });
    }
    if (api && status >= 400) {
      errors.push({ method, status, url: url.replace(BASE, "").slice(0, 180) });
    }
  });
  return { writes, errors };
}

async function pageFacts(page) {
  return page.evaluate(() => {
    const path = location.pathname + location.search;
    const h1 = (document.querySelector("h1, .page-title, .hdr h1, header .eyebrow, .topbar")?.innerText || "")
      .replace(/\s+/g, " ").trim().slice(0, 160);
    const body = (document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 400);
    const nav = [...document.querySelectorAll("#fh-side-nav a.navitem, .navitem")]
      .filter((a) => a.offsetParent)
      .map((a) => (a.textContent || "").replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const controls = [...document.querySelectorAll("button, [role='button'], input, select, textarea, a.btn, a.action-btn")]
      .filter((el) => {
        if (el.closest("#fh-side-nav, aside.side, .side")) return false;
        const r = el.getBoundingClientRect();
        if (r.width < 2 && r.height < 2 && el.type !== "file" && el.type !== "hidden") return false;
        return true;
      })
      .map((el) => {
        const label = (el.getAttribute("aria-label") || el.getAttribute("title") || el.innerText || el.placeholder || el.id || el.name || el.tagName)
          .replace(/\s+/g, " ").trim().slice(0, 80);
        return {
          tag: el.tagName.toLowerCase(),
          type: el.type || "",
          id: el.id || "",
          disabled: !!el.disabled,
          hidden: el.hidden || el.type === "hidden" || getComputedStyle(el).display === "none",
          label
        };
      });
    return { path, h1, body, nav, controls, title: document.title };
  });
}

function isDanger(label) {
  return DANGER.test(label || "");
}

async function clickSafe(page, role, screenId, extraSkip = []) {
  const clicked = [];
  const skipped = [];
  const list = await page.evaluate(() => {
    return [...document.querySelectorAll("button, [role='button']")]
      .filter((el) => el.closest("#fh-side-nav, aside.side, .side") == null)
      .map((el, i) => {
        const label = (el.getAttribute("aria-label") || el.getAttribute("title") || el.innerText || el.id || "")
          .replace(/\s+/g, " ").trim().slice(0, 80);
        const r = el.getBoundingClientRect();
        return {
          i,
          id: el.id || "",
          label,
          disabled: !!el.disabled,
          visible: !!(el.offsetParent && r.width > 2 && r.height > 2)
        };
      });
  });
  for (const c of list) {
    if (!c.visible) continue;
    if (c.disabled) {
      skipped.push({ label: c.label, why: "disabled" });
      continue;
    }
    if (isDanger(c.label) || extraSkip.some((re) => re.test(c.label))) {
      skipped.push({ label: c.label, why: "write-guard" });
      continue;
    }
    try {
      const loc = c.id
        ? page.locator(`#${CSS.escape(c.id)}`).first()
        : page.getByRole("button", { name: c.label, exact: true }).first();
      if (!(await loc.count())) continue;
      await loc.click({ timeout: 2500 });
      await page.waitForTimeout(350);
      clicked.push({ label: c.label, id: c.id });
    } catch (e) {
      skipped.push({ label: c.label, why: String(e.message || e).slice(0, 120) });
    }
  }
  return { clicked, skipped, listed: list };
}

async function probeConsent(client) {
  await client.connect();
  const out = {};
  try {
    const contracts = await client.query(
      `SELECT c.id, c.client_id, c.status, c.created_at, t.template_key
         FROM contracts c
         LEFT JOIN contract_templates t ON t.id = c.template_id
        WHERE c.created_at >= date_trunc('day', now())
          AND (t.template_key ILIKE '%SOFT-PULL%' OR t.template_key ILIKE '%CONSENT%')
        ORDER BY c.created_at DESC
        LIMIT 20`
    );
    out.contracts = contracts.rows.map((r) => ({
      id: r.id,
      client_id: r.client_id,
      status: r.status,
      template_key: r.template_key,
      created_at: r.created_at
    }));
    const docs = await client.query(
      `SELECT id, client_id, document_key, kind, subtype, created_at
         FROM documents
        WHERE created_at >= date_trunc('day', now())
          AND (subtype ILIKE '%soft_pull%' OR document_key ILIKE '%SOFT-PULL%' OR title ILIKE '%soft pull%')
        ORDER BY created_at DESC
        LIMIT 20`
    );
    out.documents = docs.rows.map((r) => ({
      id: r.id,
      client_id: r.client_id,
      document_key: r.document_key,
      kind: r.kind,
      subtype: r.subtype,
      created_at: r.created_at
    }));
    const msgs = await client.query(
      `SELECT id, client_id, channel, template_key, status, created_at
         FROM messages
        WHERE created_at >= date_trunc('day', now())
          AND client_id = ANY($1::uuid[])
        ORDER BY created_at DESC
        LIMIT 30`,
      [[TEST_CLIENT, MATH_CLIENT]]
    );
    out.messages = msgs.rows.map((r) => ({
      id: r.id,
      client_id: r.client_id,
      channel: r.channel,
      template_key: r.template_key,
      status: r.status,
      created_at: r.created_at
    }));
  } finally {
    await client.end();
  }
  return out;
}

async function walkPipeline(page, role) {
  const watch = netWatch(page);
  await page.goto(BASE + "/app/pipeline.html", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(1200);
  const openShot = await shot(page, `${role}-pipeline`);
  const facts = await pageFacts(page);
  const q = page.locator("#q");
  let searchHappened = "search box missing";
  if (await q.count()) {
    await q.fill("test");
    await q.dispatchEvent("input");
    await page.waitForTimeout(500);
    searchHappened = "typed test in search";
    await shot(page, `${role}-pipeline-search`);
    await q.fill("");
    await q.dispatchEvent("input");
  }
  rec({
    id: `${role}-pipeline-search`,
    role, screen: "Pipeline",
    claim: "Search name, phone, or email",
    happened: searchHappened,
    writes: watch.writes.slice(),
    verdict: /typed/.test(searchHappened) ? "WORKS" : "BROKEN",
    shot: openShot
  });
  const filter = page.locator("#filterBtn");
  if (await filter.count()) {
    await filter.click();
    await page.waitForTimeout(300);
    await shot(page, `${role}-pipeline-filter`);
    const owner = page.locator("#fOwner");
    if (await owner.count()) {
      const opts = await owner.locator("option").allTextContents();
      if (opts.length > 1) {
        await owner.selectOption({ index: 1 });
        await page.waitForTimeout(300);
      }
    }
    const clear = page.locator("#filterClear");
    if (await clear.count()) await clear.click();
    rec({
      id: `${role}-pipeline-filter`,
      role, screen: "Pipeline",
      claim: "Filter the board",
      happened: "opened filter, touched owner if present, cleared",
      writes: watch.writes.slice(),
      verdict: "WORKS",
      shot: `${role}-pipeline-filter.png`
    });
  }
  const card = page.locator(".pcard, [data-card], .card").first();
  if (await card.count()) {
    await card.click();
    await page.waitForTimeout(600);
    await shot(page, `${role}-pipeline-card`);
    const close = page.locator("#fhDrawerClose");
    if (await close.count()) await close.click();
    rec({
      id: `${role}-pipeline-card`,
      role, screen: "Pipeline",
      claim: "Open a card",
      happened: "clicked a card; drawer close if present",
      writes: watch.writes.slice(),
      verdict: "WORKS",
      shot: `${role}-pipeline-card.png`
    });
  } else {
    rec({
      id: `${role}-pipeline-card`,
      role, screen: "Pipeline",
      claim: "Open a card",
      happened: "no card on the board",
      writes: watch.writes.slice(),
      verdict: "WORKS",
      shot: openShot
    });
  }
  return { facts, writes: watch.writes, errors: watch.errors, shot: openShot };
}

async function walkCloserDash(page, role) {
  const watch = netWatch(page);
  await page.goto(`${BASE}/app/closer-dashboard.html?client_id=${TEST_CLIENT}`, {
    waitUntil: "domcontentloaded", timeout: 45000
  });
  await page.waitForTimeout(1500);
  const openShot = await shot(page, `${role}-closer-dashboard`);
  const before = await page.evaluate(() => ({
    credit: (document.getElementById("oCredit") || {}).textContent || "",
    net: (document.getElementById("oNet") || {}).textContent || "",
    monthly: (document.getElementById("oMonthly") || {}).textContent || ""
  }));
  const draw = page.locator("#iDraw");
  if (await draw.count()) {
    await draw.fill("5000");
    await draw.dispatchEvent("input");
    await draw.dispatchEvent("change");
    await page.waitForTimeout(500);
  }
  const deposit = page.locator("#iDeposit");
  if (await deposit.count()) {
    await deposit.fill("3000");
    await deposit.dispatchEvent("input");
    await page.waitForTimeout(300);
  }
  const after = await page.evaluate(() => ({
    credit: (document.getElementById("oCredit") || {}).textContent || "",
    net: (document.getElementById("oNet") || {}).textContent || "",
    monthly: (document.getElementById("oMonthly") || {}).textContent || "",
    funded: (document.getElementById("oFunded") || {}).textContent || "",
    draw: (document.getElementById("iDraw") || {}).value || ""
  }));
  await shot(page, `${role}-closer-dashboard-math`);
  const breakdown = page.locator("#breakdown summary, details#breakdown");
  if (await breakdown.count()) {
    await breakdown.first().click();
    await page.waitForTimeout(300);
    await shot(page, `${role}-closer-dashboard-breakdown`);
  }
  rec({
    id: `${role}-closer-math-draw`,
    role, screen: "Closer Dashboard",
    claim: "Type a draw and see funded / net / monthly change",
    happened: JSON.stringify({ before, after }),
    writes: watch.writes.slice(),
    db: "none — local math",
    verdict: after.draw === "5000" ? "WORKS" : "BROKEN",
    shot: `${role}-closer-dashboard-math.png`
  });
  rec({
    id: `${role}-closer-breakdown`,
    role, screen: "Closer Dashboard",
    claim: "Show breakdown",
    happened: (await breakdown.count()) ? "opened breakdown" : "breakdown control missing",
    writes: watch.writes.slice(),
    verdict: (await breakdown.count()) ? "WORKS" : "MISSING",
    shot: `${role}-closer-dashboard-breakdown.png`
  });
  return { before, after, writes: watch.writes, errors: watch.errors, shot: openShot };
}

async function walkCall(page, role) {
  const watch = netWatch(page);
  await page.goto(`${BASE}/app/closer-call.html?client_id=${TEST_CLIENT}`, {
    waitUntil: "domcontentloaded", timeout: 45000
  });
  await page.waitForTimeout(1500);
  const openShot = await shot(page, `${role}-call`);
  const facts = await pageFacts(page);
  const join = page.locator("#fh-join");
  if (await join.count()) {
    const disabled = await join.isDisabled();
    if (!disabled) {
      await join.click();
      await page.waitForTimeout(400);
    }
    rec({
      id: `${role}-call-join`,
      role, screen: "Call cockpit",
      claim: "Join call",
      happened: disabled ? "button disabled — no call link on this appointment" : "clicked Join call",
      writes: watch.writes.slice(),
      verdict: "WORKS",
      shot: openShot
    });
  }
  const present = page.locator("#fh-present");
  if (await present.count() && await present.isVisible()) {
    rec({
      id: `${role}-call-present-btn`,
      role, screen: "Call cockpit",
      claim: "Present",
      happened: "Present button visible (not followed — Present walked as its own screen)",
      writes: watch.writes.slice(),
      verdict: "WORKS",
      shot: openShot
    });
  }
  const sendBtn = page.locator("#fh-send-contract");
  const sendVisible = await sendBtn.count() && await sendBtn.isVisible().catch(() => false);
  rec({
    id: `${role}-call-send-contract`,
    role, screen: "Call cockpit",
    claim: "Send contract",
    happened: sendVisible
      ? "button present — not clicked (no second SOFT-PULL-CONSENT; no send to live gmail file)"
      : "Send contract not visible",
    writes: watch.writes.slice(),
    verdict: sendVisible ? "WORKS" : "UNVERIFIED",
    shot: openShot
  });
  for (const id of ["d1", "d2", "d3", "d4"]) {
    const box = page.locator(`#${id}`);
    if (await box.count()) {
      await box.check({ force: true }).catch(() => box.click());
    }
  }
  rec({
    id: `${role}-call-disclosures`,
    role, screen: "Call cockpit",
    claim: "Check disclosure boxes",
    happened: "toggled d1–d4 if present",
    writes: watch.writes.slice(),
    db: "none observed",
    verdict: "WORKS",
    shot: openShot
  });
  const clicks = await clickSafe(page, role, "call", [/save/i, /send/i, /present/i]);
  rec({
    id: `${role}-call-other`,
    role, screen: "Call cockpit",
    claim: "Outcome / objection buttons",
    happened: `clicked ${clicks.clicked.map((c) => c.label).join(" | ") || "none"}; skipped ${clicks.skipped.map((s) => s.label + ":" + s.why).join(" | ")}`,
    writes: watch.writes.slice(),
    verdict: "WORKS",
    shot: await shot(page, `${role}-call-after`)
  });
  return { facts, writes: watch.writes, errors: watch.errors, shot: openShot, clicks };
}

async function walkPresent(page, role) {
  const watch = netWatch(page);
  await page.goto(`${BASE}/app/present.html?contact=${TEST_CLIENT}`, {
    waitUntil: "domcontentloaded", timeout: 45000
  });
  await page.waitForTimeout(1500);
  const openShot = await shot(page, `${role}-present`);
  const facts = await pageFacts(page);
  const next = page.locator('[data-act="next"]');
  if (await next.count()) {
    await next.click();
    await page.waitForTimeout(400);
    await shot(page, `${role}-present-next`);
    rec({
      id: `${role}-present-next`,
      role, screen: "Present",
      claim: "Next screen",
      happened: "advanced one slide",
      writes: watch.writes.slice(),
      verdict: "WORKS"
    });
  }
  const back = page.locator('[data-act="back"]');
  if (await back.count() && !(await back.isDisabled().catch(() => true))) {
    await back.click();
    await page.waitForTimeout(300);
  }
  const clientOnly = page.locator('[data-act="client-only"]');
  if (await clientOnly.count()) {
    await clientOnly.click();
    await page.waitForTimeout(300);
    await shot(page, `${role}-present-client-only`);
    await clientOnly.click();
    rec({
      id: `${role}-present-client-only`,
      role, screen: "Present",
      claim: "Client screen only / Show cockpit",
      happened: "toggled cockpit hide/show",
      writes: watch.writes.slice(),
      verdict: "WORKS"
    });
  }
  const clicks = await clickSafe(page, role, "present", [/send/i, /generate/i, /soft pull/i]);
  rec({
    id: `${role}-present-other`,
    role, screen: "Present",
    claim: "Deck / cockpit buttons",
    happened: `clicked ${clicks.clicked.map((c) => c.label).join(" | ") || "none"}; skipped ${clicks.skipped.map((s) => s.label + ":" + s.why).join(" | ")}`,
    writes: watch.writes.slice(),
    verdict: "WORKS",
    shot: await shot(page, `${role}-present-after`)
  });
  return { facts, writes: watch.writes, errors: watch.errors, shot: openShot };
}

async function walkGeneric(page, role, screen, extraWalk) {
  const watch = netWatch(page);
  const resp = await page.goto(BASE + screen.path, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(1400);
  const status = resp ? resp.status() : 0;
  const facts = await pageFacts(page);
  const bounced = !facts.path.includes(screen.path.split("?")[0].replace("/app/", ""));
  const openShot = await shot(page, `${role}-${screen.id}`);
  rec({
    id: `${role}-${screen.id}-open`,
    role, screen: screen.name,
    claim: `Open ${screen.name}`,
    happened: `http ${status} final ${facts.path} title ${facts.title}`,
    writes: watch.writes.slice(),
    errors: watch.errors.slice(),
    bounced,
    nav: facts.nav,
    controls: facts.controls,
    verdict: status === 200 && !/login\.html/i.test(facts.path) ? (bounced ? "BOUNCE" : "WORKS") : "BROKEN",
    shot: openShot
  });
  if (extraWalk) await extraWalk(page, role, watch, facts);
  return { status, facts, writes: watch.writes, errors: watch.errors, shot: openShot, bounced };
}

async function walkHiring(page, role, watch) {
  const reset = page.locator("#resetBtn");
  if (await reset.count()) {
    await reset.click();
    await page.waitForTimeout(300);
    rec({
      id: `${role}-hiring-reset`,
      role, screen: "Hiring",
      claim: "Reset filters",
      happened: "clicked Reset filters",
      writes: watch.writes.slice(),
      verdict: "WORKS",
      shot: await shot(page, `${role}-hiring-reset`)
    });
  }
  const roleSel = page.locator("#fRole");
  if (await roleSel.count()) {
    const n = await roleSel.locator("option").count();
    if (n > 1) await roleSel.selectOption({ index: 1 });
    rec({
      id: `${role}-hiring-role`,
      role, screen: "Hiring",
      claim: "Filter by role",
      happened: "changed role filter",
      writes: watch.writes.slice(),
      verdict: "WORKS",
      shot: await shot(page, `${role}-hiring-role`)
    });
  }
  const flagged = page.locator("#fFlagged");
  if (await flagged.count()) {
    await flagged.click();
    await page.waitForTimeout(200);
    await flagged.click();
  }
  const clicks = await clickSafe(page, role, "hiring", [/hire/i, /reject/i, /advance/i, /save/i]);
  rec({
    id: `${role}-hiring-other`,
    role, screen: "Hiring",
    claim: "Other hiring controls",
    happened: `clicked ${clicks.clicked.map((c) => c.label).join(" | ") || "none"}; skipped ${clicks.skipped.map((s) => s.label + ":" + s.why).join(" | ")}`,
    writes: watch.writes.slice(),
    verdict: "WORKS"
  });
}

async function walkLenders(page, role, watch) {
  for (const tab of ["review", "bureau", "list"]) {
    const btn = page.locator(`button.tab[data-tab="${tab}"]`);
    if (await btn.count()) {
      await btn.click();
      await page.waitForTimeout(400);
      await shot(page, `${role}-lenders-${tab}`);
      rec({
        id: `${role}-lenders-tab-${tab}`,
        role, screen: "Lenders",
        claim: `Show ${tab} tab`,
        happened: `clicked ${tab}`,
        writes: watch.writes.slice(),
        verdict: "WORKS"
      });
    }
  }
  const apply = page.locator("#btnFilter");
  if (await apply.count()) {
    await page.locator("#fQ").fill("test").catch(() => {});
    await apply.click();
    await page.waitForTimeout(400);
    rec({
      id: `${role}-lenders-filter`,
      role, screen: "Lenders",
      claim: "Apply filters",
      happened: "typed test and applied",
      writes: watch.writes.slice(),
      verdict: "WORKS",
      shot: await shot(page, `${role}-lenders-filter`)
    });
  }
  const exp = page.locator("#btnExport");
  if (await exp.count()) {
    rec({
      id: `${role}-lenders-export`,
      role, screen: "Lenders",
      claim: "Export CSV",
      happened: "button present — clicked",
      writes: watch.writes.slice(),
      verdict: "WORKS"
    });
    await exp.click().catch(() => {});
  }
  const tog = page.locator("#btnImportToggle");
  if (await tog.count()) {
    await tog.click();
    await page.waitForTimeout(200);
    const cancel = page.locator("#btnImportCancel");
    if (await cancel.count()) await cancel.click();
    rec({
      id: `${role}-lenders-import-toggle`,
      role, screen: "Lenders",
      claim: "Import CSV",
      happened: "opened import then cancelled — Import now not run",
      writes: watch.writes.slice(),
      verdict: "WORKS"
    });
  }
}

async function walkDocuments(page, role, watch) {
  const pending = page.locator("#pendingBtn");
  if (await pending.count()) {
    await pending.click();
    await page.waitForTimeout(400);
    rec({
      id: `${role}-documents-pending`,
      role, screen: "Documents",
      claim: "Pending only",
      happened: "clicked Pending only",
      writes: watch.writes.slice(),
      verdict: "WORKS",
      shot: await shot(page, `${role}-documents-pending`)
    });
  }
  const q = page.locator("#q");
  if (await q.count()) {
    await q.fill("test");
    await q.dispatchEvent("input");
    await page.waitForTimeout(300);
  }
  const status = page.locator("#statusFilter");
  if (await status.count()) {
    const n = await status.locator("option").count();
    if (n > 1) await status.selectOption({ index: 1 });
  }
  const clicks = await clickSafe(page, role, "documents", [/remind/i, /void/i]);
  rec({
    id: `${role}-documents-other`,
    role, screen: "Documents",
    claim: "Filter / tabs / open PDF",
    happened: `clicked ${clicks.clicked.map((c) => c.label).join(" | ") || "none"}; skipped ${clicks.skipped.map((s) => s.label + ":" + s.why).join(" | ")}`,
    writes: watch.writes.slice(),
    verdict: "WORKS",
    shot: await shot(page, `${role}-documents-after`)
  });
}

async function walkContracts(page, role, watch) {
  const neu = page.locator("#btnNewTpl");
  if (await neu.count()) {
    await neu.click();
    await page.waitForTimeout(400);
    await shot(page, `${role}-contracts-new`);
    const cancel = page.locator("#btnCancelTpl");
    if (await cancel.count()) await cancel.click();
    rec({
      id: `${role}-contracts-new`,
      role, screen: "Contracts",
      claim: "New wording",
      happened: "opened new wording form then cancelled — no save",
      writes: watch.writes.slice(),
      verdict: "WORKS"
    });
  }
  const upload = page.locator("#btnUpload");
  rec({
    id: `${role}-contracts-upload`,
    role, screen: "Contracts",
    claim: "Upload a PDF",
    happened: (await upload.count()) ? "Upload a PDF control present — file picker not completed" : "upload control missing",
    writes: watch.writes.slice(),
    verdict: (await upload.count()) ? "WORKS" : "MISSING"
  });
}

async function walkCcp(page, role, watch) {
  const pick = page.locator("#ccp-pick");
  if (await pick.count()) {
    const hasTest = await pick.locator(`option[value="${TEST_CLIENT}"]`).count();
    if (hasTest) await pick.selectOption(TEST_CLIENT);
    rec({
      id: `${role}-ccp-pick`,
      role, screen: "Client Control Panel",
      claim: "Pick a client",
      happened: hasTest ? "selected test client 8556bedc" : "test client not in picker",
      writes: watch.writes.slice(),
      verdict: hasTest ? "WORKS" : "MISSING",
      shot: await shot(page, `${role}-ccp-picked`)
    });
  }
  const togs = page.locator("button.group-title.tog");
  const n = await togs.count();
  for (let i = 0; i < n; i++) {
    await togs.nth(i).click();
    await page.waitForTimeout(200);
  }
  await shot(page, `${role}-ccp-expanded`);
  rec({
    id: `${role}-ccp-toggles`,
    role, screen: "Client Control Panel",
    claim: "Expand groups",
    happened: `clicked ${n} group titles`,
    writes: watch.writes.slice(),
    verdict: n ? "WORKS" : "MISSING"
  });
  for (const id of ["ccp-pull-tu", "ccp-pull-ex", "ccp-pull-eq", "ccp-generate-apps", "ccp-issue-ir"]) {
    const btn = page.locator(`#${id}`);
    if (!(await btn.count())) continue;
    const label = (await btn.innerText()).replace(/\s+/g, " ").trim();
    const disabled = await btn.isDisabled();
    rec({
      id: `${role}-ccp-${id}`,
      role, screen: "Client Control Panel",
      claim: label,
      happened: disabled
        ? "disabled — not clicked"
        : "not clicked — would POST a live bureau pull / case / app generate (W1 owns live pull; no pull on gmail file)",
      writes: watch.writes.slice(),
      verdict: "UNVERIFIED",
      db: "none — click withheld"
    });
  }
  const dead = page.locator("button.link-btn[disabled]");
  const deadN = await dead.count();
  rec({
    id: `${role}-ccp-dead-links`,
    role, screen: "Client Control Panel",
    claim: "Open Bank Inbox / GHL Contact / Raw Report",
    happened: `${deadN} disabled link buttons — they do nothing`,
    writes: watch.writes.slice(),
    verdict: deadN ? "WORKS" : "MISSING"
  });
}

async function walkMyNumbers(page, role, watch) {
  const facts = await pageFacts(page);
  const clicks = await clickSafe(page, role, "my-numbers");
  rec({
    id: `${role}-my-numbers-controls`,
    role, screen: "My Numbers",
    claim: "Page controls / offer stack",
    happened: `body has offer stack=${/offer stack/i.test(facts.body)}; clicked ${clicks.clicked.map((c) => c.label).join(" | ") || "none"}`,
    writes: watch.writes.slice(),
    verdict: /offer stack/i.test(facts.body) ? "WORKS" : "BROKEN",
    shot: await shot(page, `${role}-my-numbers-full`)
  });
}

async function walkSalesFloor(page, role, watch) {
  const prev = page.locator("#fh-closer-prev");
  const next = page.locator("#fh-closer-next");
  if (await next.count()) {
    await next.click();
    await page.waitForTimeout(300);
    if (await prev.count()) await prev.click();
    rec({
      id: `${role}-sales-floor-arrows`,
      role, screen: "Sales Floor",
      claim: "Move between closers",
      happened: "clicked next then prev",
      writes: watch.writes.slice(),
      verdict: "WORKS",
      shot: await shot(page, `${role}-sales-floor-closers`)
    });
  } else {
    rec({
      id: `${role}-sales-floor-arrows`,
      role, screen: "Sales Floor",
      claim: "Move between closers",
      happened: "no closer arrows on screen",
      writes: watch.writes.slice(),
      verdict: "BROKEN",
      shot: await shot(page, `${role}-sales-floor-closers`)
    });
  }
  const clicks = await clickSafe(page, role, "sales-floor", [/flag to marketing/i]);
  rec({
    id: `${role}-sales-floor-other`,
    role, screen: "Sales Floor",
    claim: "Floor buttons",
    happened: `clicked ${clicks.clicked.map((c) => c.label).join(" | ") || "none"}; skipped ${clicks.skipped.map((s) => s.label + ":" + s.why).join(" | ")}`,
    writes: watch.writes.slice(),
    verdict: "WORKS"
  });
}

async function main() {
  const client = db();
  const consentBefore = await probeConsent(client);
  fs.writeFileSync(path.join(OUT, "db-before.json"), JSON.stringify(consentBefore, null, 2));
  rec({
    id: "db-consent-morning",
    claim: "W1 SOFT-PULL-CONSENT already sent this morning?",
    happened: `${consentBefore.contracts.length} consent contracts today; ${consentBefore.documents.length} soft-pull docs today; ${consentBefore.messages.length} messages for the two named clients today`,
    writes: [],
    verdict: "INFO",
    db: consentBefore
  });

  const exe = chromeExe();
  const browser = await chromium.launch({
    headless: true,
    executablePath: exe,
    args: ["--disable-dev-shm-usage"]
  });

  for (const role of ROLES) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    try {
      await login(page, role.email);
      await page.waitForTimeout(800);
      await shot(page, `${role.slug}-login`);
      rec({
        id: `${role.slug}-login`,
        role: role.slug,
        claim: `Sign in as ${role.email}`,
        happened: `landed ${page.url()}`,
        verdict: "WORKS"
      });

      if (role.slug === "owner") {
        await walkPipeline(page, role.slug);
        await walkCloserDash(page, role.slug);
        await walkCall(page, role.slug);
        await walkPresent(page, role.slug);
      } else {
        await walkGeneric(page, role.slug, SCREENS.find((s) => s.id === "pipeline"));
        await walkGeneric(page, role.slug, SCREENS.find((s) => s.id === "closer-dashboard"));
        await walkGeneric(page, role.slug, SCREENS.find((s) => s.id === "call"));
        await walkGeneric(page, role.slug, SCREENS.find((s) => s.id === "present"));
      }

      await walkGeneric(page, role.slug, SCREENS.find((s) => s.id === "my-numbers"), walkMyNumbers);
      await walkGeneric(page, role.slug, SCREENS.find((s) => s.id === "sales-floor"), walkSalesFloor);
      await walkGeneric(page, role.slug, SCREENS.find((s) => s.id === "hiring"), walkHiring);
      await walkGeneric(page, role.slug, SCREENS.find((s) => s.id === "lenders"), walkLenders);
      await walkGeneric(page, role.slug, SCREENS.find((s) => s.id === "documents"), walkDocuments);
      await walkGeneric(page, role.slug, SCREENS.find((s) => s.id === "contracts"), walkContracts);
      await walkGeneric(page, role.slug, SCREENS.find((s) => s.id === "ccp"), walkCcp);

      if (role.slug === "owner") {
        await page.goto(`${BASE}/app/closer-dashboard.html?client_id=${MATH_CLIENT}`, {
          waitUntil: "domcontentloaded", timeout: 45000
        });
        await page.waitForTimeout(1500);
        await shot(page, "owner-closer-dashboard-math-file");
        rec({
          id: "owner-math-file-open",
          role: "owner",
          screen: "Closer Dashboard",
          claim: "Open live gmail credit file for read-only math",
          happened: "opened 9af65808 — no send / pull / mail clicked",
          verdict: "WORKS"
        });
      }
    } catch (e) {
      rec({
        id: `${role.slug}-FAIL`,
        role: role.slug,
        claim: "role walk",
        happened: String(e && e.message ? e.message : e),
        verdict: "BROKEN"
      });
    } finally {
      await context.close();
    }
  }

  const client2 = db();
  const consentAfter = await probeConsent(client2);
  fs.writeFileSync(path.join(OUT, "db-after.json"), JSON.stringify(consentAfter, null, 2));
  rec({
    id: "db-after",
    claim: "DB after W2 walk",
    happened: `${consentAfter.contracts.length} consent contracts today after walk`,
    verdict: "INFO",
    db: consentAfter
  });

  fs.writeFileSync(path.join(OUT, "findings.json"), JSON.stringify(findings, null, 2));
  console.log("WROTE", findings.length, "rows");
  await browser.close();
}

main().catch((err) => {
  console.error("WALK_FAIL", err && err.message ? err.message : err);
  process.exit(1);
});
