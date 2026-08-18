import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-sixteen-deep-2026-08-18-evidence");
const BASE = "https://fundhub.ai";

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

function ignoreUrl(url) {
  return /fonts\.googleapis|fonts\.gstatic|googletagmanager|google-analytics|hotjar|sentry\.io|favicon|w3\.org/i.test(url);
}

function attachWatchers(page, bag) {
  page.on("console", (msg) => {
    const type = msg.type();
    if (type !== "error" && type !== "warning") return;
    const text = msg.text() || "";
    if (/Download the React DevTools|Third-party cookie|net::ERR_BLOCKED_BY_CLIENT/i.test(text)) return;
    bag.console.push({ type, text: text.slice(0, 400) });
  });
  page.on("pageerror", (err) => {
    bag.pageErrors.push(String(err && err.message ? err.message : err).slice(0, 400));
  });
  page.on("response", (res) => {
    const url = res.url();
    if (ignoreUrl(url)) return;
    const status = res.status();
    if (status >= 400) bag.net.push({ status, url: url.slice(0, 220), method: res.request().method() });
  });
}

async function login(page, email, loginPath = "/login.html") {
  await page.goto(BASE + loginPath, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.locator('input[type="email"], #email, input[name="email"]').first().fill(email);
  const pass = page.locator('input[type="password"], #password, input[name="password"]').first();
  if (await pass.count()) {
    await pass.fill(PASSWORD);
    await page.locator('button[type="submit"], button:has-text("Sign"), button:has-text("Log")').first().click();
    await page.waitForFunction(() => !/login\.html|portal-login\.html/i.test(location.pathname), null, { timeout: 30000 });
    return { ok: true };
  }
  return { ok: false, reason: "no password field" };
}

async function shot(page, slug, full = false) {
  const file = path.join(OUT, `${slug}.png`);
  await page.screenshot({ path: file, fullPage: full });
  return path.relative(ROOT, file);
}

async function waitQuiet(page, ms = 900) {
  await page.waitForTimeout(ms);
}

async function safeClick(page, selector, timeout = 4000) {
  const loc = page.locator(selector).first();
  if (!(await loc.count())) return { clicked: false, reason: "missing" };
  if (!(await loc.isVisible().catch(() => false))) return { clicked: false, reason: "hidden" };
  await loc.click({ timeout }).catch((e) => ({ err: e.message }));
  return { clicked: true };
}

async function facts(page) {
  return page.evaluate(() => {
    const body = (document.body && document.body.innerText) || "";
    return {
      url: location.href,
      title: document.title,
      pathname: location.pathname,
      h1: (document.querySelector("h1, .page-title, .hdr h1")?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 160),
      bodyFont: getComputedStyle(document.body).fontSize,
      betaBanner: !!document.getElementById("fh-beta-banner"),
      visibleNav: [...document.querySelectorAll("#fh-side-nav a")].filter((a) => a.offsetParent).map((a) => (a.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean),
      snippet: body.replace(/\s+/g, " ").slice(0, 500)
    };
  });
}

const steps = [];

function record(row) {
  steps.push(row);
  const errN = (row.console || []).length + (row.pageErrors || []).length;
  const netN = (row.net || []).filter((n) => n.status >= 500 || (n.status >= 400 && !/\/api\/auth\/session/.test(n.url))).length;
  console.log(JSON.stringify({
    step: row.step,
    ok: row.ok,
    url: row.facts?.pathname || row.url,
    errors: errN,
    badNet: netN,
    note: row.note || ""
  }));
}

async function stepPage(page, bag, spec) {
  const t0 = Date.now();
  bag.console = [];
  bag.pageErrors = [];
  bag.net = [];
  let status = null;
  if (spec.url) {
    const res = await page.goto(BASE + spec.url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch((e) => ({ error: e.message }));
    status = res && res.status ? res.status() : null;
  }
  await waitQuiet(page, spec.wait || 1000);
  if (spec.afterLoad) await spec.afterLoad(page);
  await waitQuiet(page, 400);
  const f = await facts(page);
  const shotPath = await shot(page, spec.slug, !!spec.full);
  let fullPath = null;
  if (spec.fullAlso) fullPath = await shot(page, spec.slug + "-full", true);
  const row = {
    step: spec.step,
    slug: spec.slug,
    item: spec.item,
    feature: spec.feature || "page",
    ok: spec.ok ? spec.ok(f, { status, bag }) : true,
    note: spec.note || "",
    status,
    ms: Date.now() - t0,
    facts: f,
    shot: shotPath,
    fullShot: fullPath,
    console: bag.console.slice(),
    pageErrors: bag.pageErrors.slice(),
    net: bag.net.slice()
  };
  record(row);
  return row;
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: chromeExe() });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const bag = { console: [], pageErrors: [], net: [] };
  attachWatchers(page, bag);

  // OWNER LOGIN
  bag.console = []; bag.pageErrors = []; bag.net = [];
  const ownerLogin = await login(page, "chris@fundhub.ai");
  await waitQuiet(page, 800);
  record({
    step: "login-owner",
    item: 0,
    feature: "sign in",
    ok: ownerLogin.ok,
    note: ownerLogin.reason || "signed in as owner",
    facts: await facts(page),
    shot: await shot(page, "00-owner-login"),
    console: bag.console.slice(),
    pageErrors: bag.pageErrors.slice(),
    net: bag.net.slice()
  });

  // 1 PIPELINE — load, cards, search, filter, click card, switch rail
  await stepPage(page, bag, {
    item: 1, step: "01-pipeline-load", slug: "01-pipeline-load", url: "/app/pipeline.html",
    feature: "board loads", wait: 500,
    afterLoad: async (p) => {
      await p.waitForFunction(() => {
        const cards = document.querySelectorAll("#board .card, #board .pcard, .board .card");
        const status = (document.getElementById("boardStatus")?.innerText || "");
        return cards.length > 0 || /empty|no |error|fail/i.test(status);
      }, null, { timeout: 20000 }).catch(() => {});
    },
    ok: (f) => /pipeline/i.test(f.pathname)
  });
  const pipeCounts = await page.evaluate(() => ({
    cards: document.querySelectorAll("#board .card, .board .card, #board .pcard").length,
    status: (document.getElementById("boardStatus")?.innerText || "").trim(),
    sum: (document.getElementById("sumCount")?.innerText || "").trim()
  }));
  steps[steps.length - 1].pipeCounts = pipeCounts;
  steps[steps.length - 1].ok = pipeCounts.cards > 0;
  steps[steps.length - 1].note = `${pipeCounts.cards} cards · status "${pipeCounts.status}"`;

  await page.locator("#q").fill("test");
  await waitQuiet(page, 600);
  record({
    step: "01-pipeline-search", item: 1, feature: "search box",
    ok: true, note: "typed test in search",
    facts: await facts(page), shot: await shot(page, "01-pipeline-search"),
    console: bag.console.slice(), pageErrors: bag.pageErrors.slice(), net: bag.net.slice()
  });
  await page.locator("#q").fill("");

  const filterClick = await safeClick(page, "#filterBtn");
  await waitQuiet(page, 400);
  record({
    step: "01-pipeline-filter", item: 1, feature: "filter panel",
    ok: filterClick.clicked, note: filterClick.clicked ? "opened filter" : filterClick.reason,
    facts: await facts(page), shot: await shot(page, "01-pipeline-filter"),
    console: bag.console.slice(), pageErrors: bag.pageErrors.slice(), net: bag.net.slice()
  });
  await safeClick(page, "#filterClear");
  await safeClick(page, "#filterBtn");

  const cardClick = await page.evaluate(() => {
    const c = document.querySelector("#board .card, .board .card");
    if (!c) return false;
    c.click();
    return true;
  });
  await waitQuiet(page, 800);
  const drawerOpen = await page.locator("#fhDrawer[aria-hidden='false'], #fhDrawer:not([aria-hidden='true'])").count().catch(() => 0);
  record({
    step: "01-pipeline-card", item: 1, feature: "open a card",
    ok: cardClick, note: cardClick ? `clicked card · drawer=${drawerOpen}` : "no card to click",
    facts: await facts(page), shot: await shot(page, "01-pipeline-card"),
    console: bag.console.slice(), pageErrors: bag.pageErrors.slice(), net: bag.net.slice()
  });
  await safeClick(page, "#fhDrawerClose");

  const rail = page.locator(".rail-tab, [data-rail], button:has-text('Funding')").first();
  if (await rail.count()) {
    await rail.click().catch(() => {});
    await waitQuiet(page, 800);
    record({
      step: "01-pipeline-rail", item: 1, feature: "switch rail",
      ok: true, note: "clicked a rail control",
      facts: await facts(page), shot: await shot(page, "01-pipeline-rail"),
      console: bag.console.slice(), pageErrors: bag.pageErrors.slice(), net: bag.net.slice()
    });
  }

  // 2 GLOBAL POLISH — three widths + click between screens
  for (const [w, h, slug] of [[1440, 900, "02-polish-1440"], [1920, 1080, "02-polish-1920"], [2560, 1440, "02-polish-2560"]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(BASE + "/app/pipeline.html", { waitUntil: "domcontentloaded" });
    await waitQuiet(page, 800);
    record({
      step: slug, item: 2, feature: `layout at ${w}`,
      ok: true, note: `${w}x${h}`,
      facts: await facts(page), shot: await shot(page, slug),
      console: bag.console.slice(), pageErrors: bag.pageErrors.slice(), net: bag.net.slice()
    });
    await page.goto(BASE + "/app/closer-dashboard.html", { waitUntil: "domcontentloaded" });
    await waitQuiet(page, 600);
    record({
      step: slug + "-nav", item: 2, feature: `click to closer at ${w}`,
      ok: /closer-dashboard/.test(page.url()), note: "nav jump check",
      facts: await facts(page), shot: await shot(page, slug + "-closer"),
      console: bag.console.slice(), pageErrors: bag.pageErrors.slice(), net: bag.net.slice()
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  // 3 BETA — owner on campaigns
  await stepPage(page, bag, {
    item: 3, step: "03-beta-owner-campaigns", slug: "03-beta-owner-campaigns",
    url: "/app/campaign-manager.html", feature: "owner keeps banner",
    ok: (f) => f.betaBanner === true
  });

  // 4 5 6 deletes
  for (const [item, slug, url] of [
    [4, "04-subscriptions-gone", "/app/subscriptions.html"],
    [5, "05-demo-mode-gone", "/app/demo-mode.html"],
    [6, "06-command-center-gone", "/app/command-center.html"]
  ]) {
    await stepPage(page, bag, {
      item, step: slug, slug, url, feature: "page gone",
      ok: (f, extra) => extra.status === 404 || /not found|isn't here/i.test(f.snippet + f.h1)
    });
  }

  // 7 CONTRACTS
  await stepPage(page, bag, {
    item: 7, step: "07-contracts-page", slug: "07-contracts-page",
    url: "/app/contracts.html", feature: "template loader",
    ok: (f) => /contract template/i.test(f.title + f.h1 + f.snippet)
  });
  const newWording = await safeClick(page, "button:has-text('New wording'), #newWording");
  await waitQuiet(page, 500);
  record({
    step: "07-contracts-new-wording", item: 7, feature: "New wording",
    ok: true, note: newWording.clicked ? "opened new wording" : `not clicked: ${newWording.reason}`,
    facts: await facts(page), shot: await shot(page, "07-contracts-new-wording"),
    console: bag.console.slice(), pageErrors: bag.pageErrors.slice(), net: bag.net.slice()
  });
  await page.keyboard.press("Escape").catch(() => {});
  const uploadBtn = await page.locator("button:has-text('Upload'), input[type=file]").first().count();
  record({
    step: "07-contracts-upload-control", item: 7, feature: "Upload PDF control",
    ok: uploadBtn > 0, note: uploadBtn ? "upload control present" : "no upload control",
    facts: await facts(page), shot: await shot(page, "07-contracts-upload"),
    console: [], pageErrors: [], net: []
  });

  await stepPage(page, bag, {
    item: 7, step: "07-documents-page", slug: "07-documents-page",
    url: "/app/documents.html", feature: "sent files",
    ok: (f) => /documents/i.test(f.title + f.h1)
  });
  await safeClick(page, "button:has-text('Pending'), [data-filter='pending']");
  await waitQuiet(page, 500);
  record({
    step: "07-documents-pending", item: 7, feature: "pending filter",
    ok: true, note: "clicked pending if present",
    facts: await facts(page), shot: await shot(page, "07-documents-pending"),
    console: bag.console.slice(), pageErrors: bag.pageErrors.slice(), net: bag.net.slice()
  });

  // 8 LENDERS owner
  await stepPage(page, bag, {
    item: 8, step: "08-lenders-owner", slug: "08-lenders-owner",
    url: "/app/lenders.html", feature: "owner can open",
    ok: (f) => /lenders/i.test(f.pathname + f.title)
  });
  const lendApi = await page.evaluate(async () => {
    const r = await fetch("/api/read/lenders", { credentials: "include" });
    return { status: r.status };
  });
  steps[steps.length - 1].lendersApi = lendApi;
  for (const [tab, slug] of [["review", "08-lenders-mismatch"], ["bureau", "08-lenders-bureau"], ["list", "08-lenders-list"]]) {
    await safeClick(page, `button[data-tab="${tab}"]`);
    await waitQuiet(page, 500);
    record({
      step: slug, item: 8, feature: `tab ${tab}`,
      ok: true, note: `clicked ${tab}`,
      facts: await facts(page), shot: await shot(page, slug),
      console: bag.console.slice(), pageErrors: bag.pageErrors.slice(), net: bag.net.slice()
    });
  }

  // 9 COMPANY BRAIN
  await stepPage(page, bag, {
    item: 9, step: "09-brain-page", slug: "09-brain-page",
    url: "/app/company-brain.html", feature: "chat shell",
    ok: (f) => /company brain/i.test(f.title + f.h1 + f.snippet)
  });
  await safeClick(page, "#docsBtn");
  await waitQuiet(page, 600);
  record({
    step: "09-brain-docs", item: 9, feature: "Documents panel",
    ok: await page.locator("#docs, #docList").count().then((n) => n > 0),
    note: "opened documents",
    facts: await facts(page), shot: await shot(page, "09-brain-docs"),
    console: bag.console.slice(), pageErrors: bag.pageErrors.slice(), net: bag.net.slice()
  });
  await safeClick(page, "#docsClose");
  await safeClick(page, "#newChat");
  const q = page.locator("#q");
  if (await q.count()) {
    await q.fill("How many files are loaded?");
    await safeClick(page, "#askBtn");
    await waitQuiet(page, 4000);
    const reply = await page.locator("#msgs").innerText().catch(() => "");
    record({
      step: "09-brain-ask", item: 9, feature: "ask a question",
      ok: reply.trim().length > 0,
      note: `reply length ${reply.trim().length}`,
      facts: await facts(page), shot: await shot(page, "09-brain-ask"),
      console: bag.console.slice(), pageErrors: bag.pageErrors.slice(), net: bag.net.slice(),
      replyHead: reply.replace(/\s+/g, " ").slice(0, 240)
    });
  }

  // 10 CAMPAIGNS — pick partner
  await stepPage(page, bag, {
    item: 10, step: "10-campaigns-page", slug: "10-campaigns-page",
    url: "/app/campaign-manager.html", feature: "page",
    ok: (f) => /campaign/i.test(f.title + f.h1)
  });
  const partnerSel = page.locator("#partnerSel");
  if (await partnerSel.count()) {
    const opts = await partnerSel.locator("option").evaluateAll((os) => os.map((o) => o.value).filter(Boolean));
    if (opts[0]) {
      await partnerSel.selectOption(opts[0]);
      await waitQuiet(page, 1500);
    }
    record({
      step: "10-campaigns-partner", item: 10, feature: "pick a partner",
      ok: opts.length > 0, note: opts[0] ? "selected first partner" : "no partners",
      facts: await facts(page), shot: await shot(page, "10-campaigns-partner"),
      console: bag.console.slice(), pageErrors: bag.pageErrors.slice(), net: bag.net.slice()
    });
  }

  // 11 SOCIAL
  await stepPage(page, bag, {
    item: 11, step: "11-social-page", slug: "11-social-page",
    url: "/app/social-studio.html", feature: "page",
    ok: (f) => /social/i.test(f.title + f.h1)
  });
  if (await page.locator("#partnerSel").count()) {
    const opts = await page.locator("#partnerSel option").evaluateAll((os) => os.map((o) => o.value).filter(Boolean));
    if (opts[0]) {
      await page.locator("#partnerSel").selectOption(opts[0]);
      await waitQuiet(page, 1500);
    }
  }
  record({
    step: "11-social-partner", item: 11, feature: "pick a partner",
    ok: true, note: "partner selected if present",
    facts: await facts(page), shot: await shot(page, "11-social-partner"),
    console: bag.console.slice(), pageErrors: bag.pageErrors.slice(), net: bag.net.slice()
  });
  const compose = await safeClick(page, "#composeTop");
  await waitQuiet(page, 600);
  record({
    step: "11-social-write", item: 11, feature: "Write a post",
    ok: compose.clicked, note: compose.clicked ? "opened compose" : compose.reason,
    facts: await facts(page), shot: await shot(page, "11-social-write"),
    console: bag.console.slice(), pageErrors: bag.pageErrors.slice(), net: bag.net.slice()
  });

  // 12 CREATIVE
  await stepPage(page, bag, {
    item: 12, step: "12-creative-page", slug: "12-creative-page",
    url: "/app/creative-factory.html", feature: "page",
    ok: (f) => /creative/i.test(f.title + f.h1)
  });
  if (await page.locator("#partnerSel, select").first().count()) {
    const sel = page.locator("#partnerSel").first();
    if (await sel.count()) {
      const opts = await sel.locator("option").evaluateAll((os) => os.map((o) => o.value).filter(Boolean));
      if (opts[0]) await sel.selectOption(opts[0]);
      await waitQuiet(page, 1500);
    }
  }
  record({
    step: "12-creative-partner", item: 12, feature: "pick a partner",
    ok: true, note: "partner selected if present",
    facts: await facts(page), shot: await shot(page, "12-creative-partner"),
    console: bag.console.slice(), pageErrors: bag.pageErrors.slice(), net: bag.net.slice()
  });

  // 13 CLOSER DASH + CALL
  await stepPage(page, bag, {
    item: 13, step: "13-closer-dash", slug: "13-closer-dash",
    url: "/app/closer-dashboard.html", feature: "calculators",
    ok: (f) => /closer/i.test(f.title + f.snippet)
  });
  if (await page.locator("#iDraw").count()) {
    await page.locator("#iDraw").fill("5000");
    await page.locator("#iDeposit").fill("200").catch(() => {});
    await waitQuiet(page, 500);
    const calc = await page.evaluate(() => ({
      credit: (document.getElementById("oCredit")?.innerText || "").trim(),
      net: (document.getElementById("oNet")?.innerText || "").trim(),
      monthly: (document.getElementById("oMonthly")?.innerText || "").trim()
    }));
    record({
      step: "13-closer-calc-type", item: 13, feature: "type into calculators",
      ok: true, note: JSON.stringify(calc),
      facts: await facts(page), shot: await shot(page, "13-closer-calc-type"),
      console: bag.console.slice(), pageErrors: bag.pageErrors.slice(), net: bag.net.slice(),
      calc
    });
  }
  const breakdown = await safeClick(page, "summary, #breakdown summary, details.breakdown summary");
  await waitQuiet(page, 400);
  record({
    step: "13-closer-breakdown", item: 13, feature: "Show breakdown",
    ok: breakdown.clicked, note: breakdown.clicked ? "opened breakdown" : breakdown.reason,
    facts: await facts(page), shot: await shot(page, "13-closer-breakdown"),
    console: bag.console.slice(), pageErrors: bag.pageErrors.slice(), net: bag.net.slice()
  });
  await stepPage(page, bag, {
    item: 13, step: "13-call-cockpit", slug: "13-call-cockpit",
    url: "/app/closer-call.html", feature: "call cockpit",
    ok: (f) => /call|closer/i.test(f.title + f.snippet)
  });

  // 14 MY NUMBERS + SALES FLOOR
  await stepPage(page, bag, {
    item: 14, step: "14-my-numbers", slug: "14-my-numbers",
    url: "/app/my-numbers.html", feature: "offer stack",
    ok: (f) => /offer stack|my numbers/i.test(f.snippet + f.title),
    fullAlso: true
  });
  await stepPage(page, bag, {
    item: 14, step: "14-sales-floor", slug: "14-sales-floor",
    url: "/app/sales-floor.html", feature: "floor + closer list",
    ok: (f) => /sales floor/i.test(f.title + f.snippet),
    fullAlso: true
  });
  await page.locator("#fh-closer-focus").scrollIntoViewIfNeeded().catch(() => {});
  await waitQuiet(page, 400);
  const closerUi = await page.evaluate(() => ({
    focus: (document.getElementById("fh-closer-focus")?.innerText || "").replace(/\s+/g, " ").slice(0, 240),
    arrows: !!document.querySelector("#fh-closer-focus button, .focusbody button"),
    rows: document.querySelectorAll(".rost .r, .rost tr, .rost [data-closer]").length
  }));
  record({
    step: "14-sales-floor-closers", item: 14, feature: "scroll between closers",
    ok: /closer/i.test(closerUi.focus),
    note: JSON.stringify(closerUi),
    facts: await facts(page), shot: await shot(page, "14-sales-floor-closers"),
    console: bag.console.slice(), pageErrors: bag.pageErrors.slice(), net: bag.net.slice(),
    closerUi
  });

  // 15 HIRING
  await stepPage(page, bag, {
    item: 15, step: "15-hiring-page", slug: "15-hiring-page",
    url: "/app/hiring.html", feature: "page",
    ok: (f) => /hiring/i.test(f.title + f.h1)
  });
  const reset = await safeClick(page, "#resetBtn");
  await waitQuiet(page, 400);
  record({
    step: "15-hiring-reset", item: 15, feature: "Reset filters",
    ok: reset.clicked, note: reset.clicked ? "clicked reset" : reset.reason,
    facts: await facts(page), shot: await shot(page, "15-hiring-reset"),
    console: bag.console.slice(), pageErrors: bag.pageErrors.slice(), net: bag.net.slice()
  });
  if (await page.locator("#fRole option").count() > 1) {
    await page.locator("#fRole").selectOption({ index: 1 }).catch(() => {});
    await waitQuiet(page, 500);
    record({
      step: "15-hiring-role-filter", item: 15, feature: "filter by role",
      ok: true, note: "changed role filter",
      facts: await facts(page), shot: await shot(page, "15-hiring-role-filter"),
      console: bag.console.slice(), pageErrors: bag.pageErrors.slice(), net: bag.net.slice()
    });
  }

  // 16 CLIENT PORTAL as owner/staff
  await stepPage(page, bag, {
    item: 16, step: "16-portal-staff", slug: "16-portal-staff",
    url: "/app/client-portal.html", feature: "welcome + sign order",
    ok: (f) => /welcome video|sign to authorize/i.test(f.snippet),
    fullAlso: true
  });

  // ROLES
  const roles = [
    { email: "closer@fundhub.ai", slug: "closer", item: 3 },
    { email: "advisor@fundhub.ai", slug: "advisor", item: 8 },
    { email: "sales@fundhub.ai", slug: "sales", item: 8 },
    { email: "affiliate@fundhub.ai", slug: "affiliate", item: 3 }
  ];

  for (const r of roles) {
    await context.clearCookies();
    bag.console = []; bag.pageErrors = []; bag.net = [];
    const lg = await login(page, r.email);
    await waitQuiet(page, 700);
    record({
      step: `role-${r.slug}-login`, item: r.item, feature: `sign in as ${r.slug}`,
      ok: lg.ok, note: lg.reason || `signed in ${r.slug}`,
      facts: await facts(page), shot: await shot(page, `role-${r.slug}-home`),
      console: bag.console.slice(), pageErrors: bag.pageErrors.slice(), net: bag.net.slice()
    });
    if (!lg.ok) continue;

    await page.goto(BASE + "/app/campaign-manager.html", { waitUntil: "domcontentloaded" });
    await waitQuiet(page, 800);
    const fCamp = await facts(page);
    record({
      step: `role-${r.slug}-campaigns`, item: 3, feature: "beta / campaigns as " + r.slug,
      ok: r.slug === "affiliate" || fCamp.betaBanner === false,
      note: `ended ${fCamp.pathname} banner=${fCamp.betaBanner} nav=${(fCamp.visibleNav || []).join("|")}`,
      facts: fCamp, shot: await shot(page, `role-${r.slug}-campaigns`),
      console: bag.console.slice(), pageErrors: bag.pageErrors.slice(), net: bag.net.slice()
    });

    await page.goto(BASE + "/app/lenders.html", { waitUntil: "domcontentloaded" });
    await waitQuiet(page, 800);
    const lend = await page.evaluate(async () => {
      const r = await fetch("/api/read/lenders", { credentials: "include" });
      return { status: r.status, path: location.pathname };
    });
    record({
      step: `role-${r.slug}-lenders`, item: 8, feature: "lenders as " + r.slug,
      ok: true, note: JSON.stringify(lend),
      facts: await facts(page), shot: await shot(page, `role-${r.slug}-lenders`),
      console: bag.console.slice(), pageErrors: bag.pageErrors.slice(), net: bag.net.slice(),
      lendersApi: lend
    });

    if (r.slug === "closer") {
      await page.goto(BASE + "/app/closer-dashboard.html", { waitUntil: "domcontentloaded" });
      await waitQuiet(page, 800);
      record({
        step: "role-closer-dash", item: 13, feature: "closer dashboard as closer",
        ok: /closer-dashboard/.test(page.url()),
        facts: await facts(page), shot: await shot(page, "role-closer-dash"),
        console: bag.console.slice(), pageErrors: bag.pageErrors.slice(), net: bag.net.slice()
      });
    }
  }

  // CLIENT portal login page
  await context.clearCookies();
  bag.console = []; bag.pageErrors = []; bag.net = [];
  await page.goto(BASE + "/portal-login.html", { waitUntil: "domcontentloaded" });
  await waitQuiet(page, 600);
  const portalFields = await page.evaluate(() => ({
    email: !!document.querySelector('input[type="email"], #email'),
    password: !!document.querySelector('input[type="password"], #password'),
    text: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 300)
  }));
  record({
    step: "16-portal-login-page", item: 16, feature: "client sign-in page",
    ok: portalFields.email, note: JSON.stringify({ email: portalFields.email, password: portalFields.password }),
    facts: await facts(page), shot: await shot(page, "16-portal-login-page"),
    console: bag.console.slice(), pageErrors: bag.pageErrors.slice(), net: bag.net.slice(),
    portalFields
  });

  fs.writeFileSync(path.join(OUT, "steps.json"), JSON.stringify(steps, null, 2));
  const summary = steps.map((s) => ({
    step: s.step,
    item: s.item,
    feature: s.feature,
    ok: s.ok,
    note: s.note,
    errors: (s.pageErrors || []).length,
    consoleErrors: (s.console || []).filter((c) => c.type === "error").length,
    net4xx: (s.net || []).filter((n) => n.status >= 400 && n.status < 500).length,
    net5xx: (s.net || []).filter((n) => n.status >= 500).length
  }));
  fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 2));
  console.log("WROTE", steps.length, "steps");
  await browser.close();
})().catch((err) => {
  console.error("WALK_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
});
