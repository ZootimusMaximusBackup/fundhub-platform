import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-crm-whole-2026-08-18-evidence/w3");
const BASE = "https://fundhub.ai";
const FORBIDDEN = "9af65808-a619-4e65-ae91-239766a006b7";
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

fs.mkdirSync(OUT, { recursive: true });

const SCREENS = {
  finance: "/app/finance-os.html",
  financeClient: `/app/finance-os.html?client_id=${TEST_CLIENT}`,
  products: "/app/products-commissions.html",
  ops: "/app/ops-admin.html",
  specialist: "/app/inquiry-remover.html",
  calendar: "/app/calendar.html",
  messaging: "/app/messaging.html",
  staff: "/app/staff-teams.html"
};

const ROLES = [
  { id: "owner", email: "chris@fundhub.ai", can: ["finance", "products", "ops", "specialist", "calendar", "messaging", "staff"] },
  { id: "closer", email: "closer@fundhub.ai", can: ["specialist", "calendar", "messaging"] },
  { id: "advisor", email: "advisor@fundhub.ai", can: ["specialist", "calendar", "messaging"] },
  { id: "sales", email: "sales@fundhub.ai", can: ["products", "specialist", "calendar", "messaging", "staff"] },
  { id: "inquiry", email: "inquiry@fundhub.ai", can: ["specialist", "calendar", "messaging"] }
];

const ALL_KEYS = ["finance", "products", "ops", "specialist", "calendar", "messaging", "staff"];

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

const clicks = [];
const pages = [];

function rec(row) {
  clicks.push(row);
  console.log(JSON.stringify({
    kind: "click",
    role: row.role,
    screen: row.screen,
    claimed: row.claimed,
    happened: row.happened,
    net: (row.net || []).map((n) => `${n.method} ${n.status} ${n.path}`).slice(0, 6)
  }));
}

function recPage(row) {
  pages.push(row);
  console.log(JSON.stringify({
    kind: "page",
    role: row.role,
    screen: row.screen,
    ok: row.ok,
    path: row.path,
    bounced: row.bounced,
    h1: row.h1
  }));
}

function attach(page, bag) {
  page.on("dialog", async (d) => {
    bag.dialogs.push({ type: d.type(), message: String(d.message() || "").slice(0, 240) });
    await d.dismiss();
  });
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text() || "";
    if (/Download the React DevTools|Third-party cookie|net::ERR_BLOCKED_BY_CLIENT/i.test(text)) return;
    bag.console.push(text.slice(0, 300));
  });
  page.on("pageerror", (err) => {
    bag.pageErrors.push(String(err && err.message ? err.message : err).slice(0, 300));
  });
  page.on("response", (res) => {
    const url = res.url();
    if (ignoreUrl(url) || !/\/api\//.test(url)) return;
    let u;
    try { u = new URL(url); } catch { return; }
    bag.net.push({
      status: res.status(),
      method: res.request().method(),
      path: (u.pathname + u.search).slice(0, 220)
    });
  });
}

function drain(bag) {
  const net = bag.net.slice();
  const dialogs = bag.dialogs.slice();
  bag.net.length = 0;
  bag.dialogs.length = 0;
  return { net, dialogs };
}

async function login(page, email) {
  await page.goto(BASE + "/login.html", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.locator("#email").fill(email);
  await page.locator("#pw").fill(PASSWORD);
  await page.locator("#go").click();
  await page.waitForFunction(() => !/login\.html/i.test(location.pathname), null, { timeout: 30000 });
}

async function shot(page, slug, full = false) {
  const file = path.join(OUT, `${slug}.png`);
  await page.screenshot({ path: file, fullPage: full });
  return path.relative(ROOT, file);
}

async function waitQuiet(page, ms = 1200) {
  await page.waitForTimeout(ms);
}

async function facts(page) {
  return page.evaluate(() => {
    const body = (document.body && document.body.innerText) || "";
    const nav = [...document.querySelectorAll("#fh-side-nav a.navitem")]
      .filter((a) => a.offsetParent)
      .map((a) => ({
        href: (a.getAttribute("href") || "").split("?")[0],
        label: (a.textContent || "").replace(/\s+/g, " ").trim()
      }));
    return {
      url: location.href,
      path: location.pathname,
      title: document.title,
      h1: (document.querySelector("h1, .topbar h1, .brand .sub, .hdr h1")?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 160),
      snippet: body.replace(/\s+/g, " ").slice(0, 700),
      beta: !!document.getElementById("fh-beta-banner"),
      nav
    };
  });
}

async function inventory(page) {
  return page.evaluate(() => {
    const sel = [
      "button",
      "[role='tab']",
      ".tab",
      ".ctab",
      ".zonetab",
      ".navbtn",
      ".today-btn",
      "#seg span",
      "[data-act]",
      "[data-case-act]",
      "[data-clock]",
      "[data-consent]",
      "[data-chg]",
      "[data-led]",
      "[data-save]",
      "[data-cancel]",
      "a.btn",
      "a.qbtn",
      "a.af-link"
    ].join(",");
    return [...document.querySelectorAll(sel)]
      .filter((e) => {
        if (e.closest("aside.side, #fh-side-nav, .side-top")) return false;
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      })
      .map((e) => ({
        tag: e.tagName.toLowerCase(),
        id: e.id || "",
        text: (e.innerText || e.getAttribute("aria-label") || e.title || "").replace(/\s+/g, " ").trim().slice(0, 90),
        disabled: !!(e.disabled || e.getAttribute("aria-disabled") === "true"),
        title: e.title || "",
        act: e.getAttribute("data-act") || e.getAttribute("data-case-act") || "",
        href: e.getAttribute("href") || ""
      }));
  });
}

async function clickSel(page, bag, spec) {
  const loc = page.locator(spec.sel).first();
  const n = await loc.count();
  if (!n) {
    rec({
      role: spec.role, screen: spec.screen, claimed: spec.claimed,
      happened: "control missing", evidence: spec.slug || "", net: []
    });
    return { ok: false, reason: "missing" };
  }
  const vis = await loc.isVisible().catch(() => false);
  if (!vis) {
    rec({
      role: spec.role, screen: spec.screen, claimed: spec.claimed,
      happened: "control hidden", evidence: spec.slug || "", net: []
    });
    return { ok: false, reason: "hidden" };
  }
  const disabled = await loc.isDisabled().catch(() => false);
  if (disabled && !spec.clickDisabled) {
    rec({
      role: spec.role, screen: spec.screen, claimed: spec.claimed,
      happened: "disabled — did nothing", evidence: spec.slug || "", net: []
    });
    return { ok: false, reason: "disabled" };
  }
  drain(bag);
  await loc.click({ timeout: 5000 }).catch((e) => ({ err: e.message }));
  await waitQuiet(page, spec.wait || 800);
  const after = drain(bag);
  const f = await facts(page);
  let shotPath = "";
  if (spec.slug) shotPath = await shot(page, spec.slug, !!spec.full);
  rec({
    role: spec.role,
    screen: spec.screen,
    claimed: spec.claimed,
    happened: spec.happened ? spec.happened(f, after) : summarize(f, after),
    evidence: shotPath,
    path: f.path,
    snippet: f.snippet.slice(0, 220),
    net: after.net,
    dialogs: after.dialogs
  });
  return { ok: true, facts: f, after };
}

function summarize(f, after) {
  const writes = after.net.filter((n) => /POST|PUT|PATCH|DELETE/i.test(n.method));
  const dialogs = after.dialogs;
  if (dialogs.length) return `confirm shown then dismissed: ${dialogs[0].message.slice(0, 120)} — no write`;
  if (writes.length) return `outside call / write: ${writes.map((w) => `${w.method} ${w.status} ${w.path}`).join(" | ")}`;
  const gets = after.net.filter((n) => n.method === "GET");
  if (gets.length) return `UI + GET ${gets.map((g) => `${g.status} ${g.path}`).join(" | ")}`;
  return "did nothing (no API write or confirm)";
}

function mailOrSms(net) {
  return net.some((n) => /messages|outbound|twilio|mailgun|postgrid|send/i.test(n.path) && /POST/i.test(n.method));
}

async function openScreen(page, bag, role, key, extra = "") {
  drain(bag);
  const url = SCREENS[key] + extra;
  const res = await page.goto(BASE + url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch((e) => ({ error: e.message }));
  await waitQuiet(page, 1400);
  const f = await facts(page);
  const after = drain(bag);
  const expected = role.can.includes(key.replace("Client", ""));
  const landed = f.path.endsWith(url.split("?")[0].split("/").pop()) || f.path.includes(url.split("?")[0].split("/").pop());
  const bounced = !landed;
  const slug = `${role.id}-${key}${extra ? "-q" : ""}`;
  const shotPath = await shot(page, slug, true);
  recPage({
    role: role.id,
    screen: key,
    ok: expected ? landed : bounced,
    expected: expected ? "open" : "bounce",
    bounced,
    path: f.path,
    href: f.url,
    h1: f.h1,
    snippet: f.snippet,
    nav: f.nav,
    beta: f.beta,
    status: res && res.status ? res.status() : null,
    net: after.net,
    evidence: shotPath,
    inventory: await inventory(page)
  });
  return f;
}

async function walkFinance(page, bag, role) {
  const screen = "finance";
  await openScreen(page, bag, role, "finance");
  if (!role.can.includes("finance")) return;
  await clickSel(page, bag, {
    role: role.id, screen, sel: "#fh-beta-banner button, #fh-beta-banner .dismiss, button:has-text('Dismiss')",
    claimed: "Dismiss beta bar", slug: `${role.id}-finance-beta`
  });
  await openScreen(page, bag, role, "finance");
  await page.goto(BASE + SCREENS.financeClient, { waitUntil: "domcontentloaded", timeout: 45000 });
  await waitQuiet(page, 1600);
  const f = await facts(page);
  const shotPath = await shot(page, `${role.id}-finance-test-client`, true);
  rec({
    role: role.id, screen, claimed: "Open Finance OS with test client_id",
    happened: f.snippet.slice(0, 240), evidence: shotPath, path: f.path, net: drain(bag).net
  });
}

async function walkProducts(page, bag, role) {
  const screen = "products";
  await openScreen(page, bag, role, "products");
  if (!role.can.includes("products")) return;
  await clickSel(page, bag, {
    role: role.id, screen, sel: 'button.tab[data-tab="rules"]',
    claimed: "Commission rules tab", slug: `${role.id}-products-rules`
  });
  await clickSel(page, bag, {
    role: role.id, screen, sel: "button[data-chg]",
    claimed: "Change rate opens the rate editor", slug: `${role.id}-products-change-rate`
  });
  await clickSel(page, bag, {
    role: role.id, screen, sel: "button[data-cancel]",
    claimed: "Cancel hides the rate editor", slug: `${role.id}-products-change-cancel`
  });
  await clickSel(page, bag, {
    role: role.id, screen, sel: "button[data-led]",
    claimed: "See these payouts → opens ledger filtered to that rule", slug: `${role.id}-products-see-payouts`
  });
  await clickSel(page, bag, {
    role: role.id, screen, sel: "#ledgerBack",
    claimed: "← Back to rules", slug: `${role.id}-products-ledger-back`
  });
  await clickSel(page, bag, {
    role: role.id, screen, sel: 'button.tab[data-tab="products"]',
    claimed: "Products tab", slug: `${role.id}-products-tab`
  });
  await clickSel(page, bag, {
    role: role.id, screen, sel: "#ledgerLink",
    claimed: "View payout ledger →", slug: `${role.id}-products-ledger`
  });
  const per = page.locator("#perFilter");
  if (await per.count()) {
    const opts = await per.locator("option").allTextContents();
    if (opts.length > 1) {
      await per.selectOption({ index: 1 });
      await waitQuiet(page, 600);
      rec({
        role: role.id, screen, claimed: "Ledger person filter",
        happened: `selected ${opts[1]}`, evidence: await shot(page, `${role.id}-products-per-filter`),
        net: drain(bag).net
      });
    }
  }
  const stat = page.locator("#statFilter");
  if (await stat.count()) {
    await stat.selectOption({ index: 1 }).catch(() => {});
    await waitQuiet(page, 500);
    rec({
      role: role.id, screen, claimed: "Ledger status filter",
      happened: "changed status filter", evidence: await shot(page, `${role.id}-products-stat-filter`),
      net: drain(bag).net
    });
  }
  await clickSel(page, bag, {
    role: role.id, screen, sel: "#ledgerBack",
    claimed: "Back from ledger", slug: `${role.id}-products-back2`
  });
  await clickSel(page, bag, {
    role: role.id, screen, sel: "#addProdBtn",
    claimed: "+ Add product opens editor", slug: `${role.id}-products-add`
  });
  await clickSel(page, bag, {
    role: role.id, screen, sel: "#edCancel",
    claimed: "Cancel closes product editor without save", slug: `${role.id}-products-add-cancel`
  });
  const row = page.locator("tr[data-p], tbody tr").nth(1);
  if (await row.count() && await row.isVisible().catch(() => false)) {
    drain(bag);
    await row.click().catch(() => {});
    await waitQuiet(page, 700);
    rec({
      role: role.id, screen, claimed: "Click product row opens editor",
      happened: await page.locator("#edTitle").innerText().catch(() => "no editor title"),
      evidence: await shot(page, `${role.id}-products-row`),
      net: drain(bag).net
    });
    await clickSel(page, bag, {
      role: role.id, screen, sel: "#edClose",
      claimed: "✕ closes product editor", slug: `${role.id}-products-row-close`
    });
  }
}

async function walkOps(page, bag, role) {
  const screen = "ops";
  await openScreen(page, bag, role, "ops");
  if (!role.can.includes("ops")) return;
  await clickSel(page, bag, {
    role: role.id, screen, sel: "#period-btn",
    claimed: "Last 7 Days opens date-range menu", slug: `${role.id}-ops-period`
  });
  await clickSel(page, bag, {
    role: role.id, screen, sel: "#period-menu [role='menuitem'], #period-menu button, #period-menu div",
    claimed: "Pick another period reloads KPIs", slug: `${role.id}-ops-period-pick`, wait: 1500
  });
  await clickSel(page, bag, {
    role: role.id, screen, sel: 'button.zonetab[data-zone="people"]',
    claimed: "People tab shows staff, comp & consent", slug: `${role.id}-ops-people`, full: true
  });
  await clickSel(page, bag, {
    role: role.id, screen, sel: 'button.zonetab[data-zone="money"]',
    claimed: "Money tab shows KPIs · AR · compliance", slug: `${role.id}-ops-money`, full: true
  });
  await clickSel(page, bag, {
    role: role.id, screen, sel: "#aff summary, details#aff > summary",
    claimed: "Affiliates + Hiring expands", slug: `${role.id}-ops-aff`
  });
  const outVis = await page.evaluate(() => {
    const ids = ["outboxSend", "outboxToggle", "outboxInvoices"];
    return ids.map((id) => {
      const el = document.getElementById(id);
      if (!el) return { id, state: "missing" };
      const vis = el.offsetParent && getComputedStyle(el).display !== "none";
      return { id, state: vis ? "visible" : "hidden", text: (el.innerText || "").trim() };
    });
  });
  rec({
    role: role.id, screen, claimed: "Outbound mail buttons appear after queue read",
    happened: JSON.stringify(outVis), evidence: await shot(page, `${role.id}-ops-outbox`),
    net: []
  });
  if (outVis.find((x) => x.id === "outboxToggle" && x.state === "visible")) {
    await clickSel(page, bag, {
      role: role.id, screen, sel: "#outboxToggle",
      claimed: "Pause sending / Turn sending on — confirm then change outbound setting",
      slug: `${role.id}-ops-outbox-toggle`
    });
  }
  if (outVis.find((x) => x.id === "outboxSend" && x.state === "visible")) {
    await clickSel(page, bag, {
      role: role.id, screen, sel: "#outboxSend",
      claimed: "Send what is waiting — confirm then dispatch live mail",
      slug: `${role.id}-ops-outbox-send`
    });
  }
  if (outVis.find((x) => x.id === "outboxInvoices" && x.state === "visible")) {
    await clickSel(page, bag, {
      role: role.id, screen, sel: "#outboxInvoices",
      claimed: "Email unsent invoices — confirm then email clients",
      slug: `${role.id}-ops-outbox-inv`
    });
  }
}

async function walkSpecialist(page, bag, role) {
  const screen = "specialist";
  await openScreen(page, bag, role, "specialist");
  if (!role.can.includes("specialist")) return;
  await clickSel(page, bag, {
    role: role.id, screen, sel: "#tab-repair",
    claimed: "Repair tab shows repair files", slug: `${role.id}-spec-repair`, wait: 1400, full: true
  });
  const repairRow = page.locator("#repairBody tr, #repairTable tbody tr").first();
  if (await repairRow.count() && await repairRow.isVisible().catch(() => false)) {
    drain(bag);
    await repairRow.click().catch(() => {});
    await waitQuiet(page, 1200);
    const sendLetters = await page.locator('[data-act="repair-send"]').count();
    rec({
      role: role.id, screen, claimed: "Click repair row shows letters; Send letters only if a body is ready",
      happened: `row opened; Send letters buttons=${sendLetters} (not fired)`,
      evidence: await shot(page, `${role.id}-spec-repair-row`, true),
      net: drain(bag).net
    });
  }
  await clickSel(page, bag, {
    role: role.id, screen, sel: "#tab-inquiries",
    claimed: "Inquiries tab shows inquiry queue", slug: `${role.id}-spec-inq`, wait: 1400, full: true
  });
  for (const bureau of ["Equifax", "TransUnion", "Experian"]) {
    await clickSel(page, bag, {
      role: role.id, screen, sel: `button.bureau-chip[data-bureau="${bureau}"]`,
      claimed: `${bureau} chip filters the queue`, slug: `${role.id}-spec-chip-${bureau.toLowerCase()}`
    });
    await clickSel(page, bag, {
      role: role.id, screen, sel: `button.bureau-chip[data-bureau="${bureau}"]`,
      claimed: `${bureau} chip toggle off`, slug: `${role.id}-spec-chip-${bureau.toLowerCase()}-off`
    });
  }
  const rows = page.locator("#queue-body tr[data-id], #caseQueueBody tr[data-id], table.queue tbody tr[data-id], table.queue tbody tr[data-row]");
  const count = await rows.count();
  rec({
    role: role.id, screen, claimed: "Inquiry queue has rows to open",
    happened: `${count} data rows`, evidence: "", net: []
  });
  const max = Math.min(count, 4);
  for (let i = 0; i < max; i++) {
    const row = rows.nth(i);
    const meta = await row.evaluate((el) => ({
      id: el.getAttribute("data-id") || "",
      clientId: el.getAttribute("data-client-id") || el.getAttribute("data-clientId") || "",
      text: (el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 120)
    })).catch(() => null);
    if (!meta) continue;
    if (meta.clientId === FORBIDDEN) {
      drain(bag);
      await row.click().catch(() => {});
      await waitQuiet(page, 900);
      rec({
        role: role.id, screen, claimed: "Open live gmail credit-file row (read only — no FIRE)",
        happened: "row expanded; Send / Mark cleared / Close NOT clicked",
        evidence: await shot(page, `${role.id}-spec-forbidden-row`),
        net: drain(bag).net,
        note: "forbidden client — no fire"
      });
      continue;
    }
    drain(bag);
    await row.click().catch(() => {});
    await waitQuiet(page, 1000);
    const acts = await page.evaluate(() =>
      [...document.querySelectorAll("[data-act], [data-case-act], button.qbtn, button.primary")]
        .filter((e) => e.offsetParent)
        .map((e) => (e.innerText || "").replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .slice(0, 20)
    );
    rec({
      role: role.id, screen, claimed: "Expand inquiry row shows work controls",
      happened: `controls: ${acts.join(" | ") || "none visible"}`,
      evidence: await shot(page, `${role.id}-spec-row-${i}`),
      net: drain(bag).net,
      clientId: meta.clientId || "(none)",
      rowText: meta.text
    });
    if (meta.clientId === TEST_CLIENT) {
      await clickSel(page, bag, {
        role: role.id, screen, sel: "button.qbtn:has-text('Log an attempt')",
        claimed: "Log an attempt writes an inquiry_log row",
        slug: `${role.id}-spec-log-attempt`
      });
      await clickSel(page, bag, {
        role: role.id, screen, sel: '[data-act="packet"]',
        claimed: "Download packet opens documents for this client",
        slug: `${role.id}-spec-packet`
      });
    }
    const sendBtn = page.locator('[data-act="send"]').first();
    if (await sendBtn.count() && await sendBtn.isVisible().catch(() => false)) {
      rec({
        role: role.id, screen, claimed: "Send mails the bureau letter (PostGrid)",
        happened: meta.clientId === FORBIDDEN
          ? "NOT clicked — live gmail credit file"
          : "NOT clicked — would mail a real letter; FIRE belongs to W1",
        evidence: "",
        net: []
      });
    }
  }
}

async function walkCalendar(page, bag, role) {
  const screen = "calendar";
  await openScreen(page, bag, role, "calendar");
  if (!role.can.includes("calendar")) return;
  await clickSel(page, bag, {
    role: role.id, screen, sel: '#seg span[data-v="week"]',
    claimed: "Week view", slug: `${role.id}-cal-week`
  });
  await clickSel(page, bag, {
    role: role.id, screen, sel: '#seg span[data-v="day"]',
    claimed: "Day view", slug: `${role.id}-cal-day`
  });
  await clickSel(page, bag, {
    role: role.id, screen, sel: ".navbtn",
    claimed: "‹ previous day/week", slug: `${role.id}-cal-prev`
  });
  await clickSel(page, bag, {
    role: role.id, screen, sel: ".navbtn >> nth=1",
    claimed: "› next day/week", slug: `${role.id}-cal-next`
  });
  await clickSel(page, bag, {
    role: role.id, screen, sel: ".today-btn",
    claimed: "Today jumps to today", slug: `${role.id}-cal-today`
  });
  const day = page.locator(".ws-day").nth(2);
  if (await day.count()) {
    drain(bag);
    await day.click().catch(() => {});
    await waitQuiet(page, 600);
    rec({
      role: role.id, screen, claimed: "Week-strip day selects that date",
      happened: (await page.locator(".datelabel").innerText().catch(() => "")).slice(0, 80),
      evidence: await shot(page, `${role.id}-cal-strip`),
      net: drain(bag).net
    });
  }
  await clickSel(page, bag, {
    role: role.id, screen, sel: "#unJoin",
    claimed: "Join Call opens the call link", slug: `${role.id}-cal-join`, clickDisabled: false
  });
  await clickSel(page, bag, {
    role: role.id, screen, sel: "#unFile",
    claimed: "Client file opens that client's file", slug: `${role.id}-cal-file`
  });
  await clickSel(page, bag, {
    role: role.id, screen, sel: "#demoToggle",
    claimed: "Demonstration states expands sample alerts", slug: `${role.id}-cal-demo`
  });
  const demoActs = page.locator(".errbar .acts span");
  const n = await demoActs.count();
  for (let i = 0; i < n; i++) {
    const t = (await demoActs.nth(i).innerText()).trim();
    drain(bag);
    await demoActs.nth(i).click().catch(() => {});
    await waitQuiet(page, 400);
    rec({
      role: role.id, screen, claimed: t,
      happened: summarize(await facts(page), drain(bag)),
      evidence: await shot(page, `${role.id}-cal-demo-act-${i}`),
      net: []
    });
  }
}

async function walkMessaging(page, bag, role) {
  const screen = "messaging";
  await openScreen(page, bag, role, "messaging");
  if (!role.can.includes("messaging")) return;
  await clickSel(page, bag, {
    role: role.id, screen, sel: 'button.ctab[data-filter="all"]',
    claimed: "All tab lists every conversation", slug: `${role.id}-msg-all`, wait: 1200
  });
  await page.locator("#q").fill("test");
  await waitQuiet(page, 500);
  rec({
    role: role.id, screen, claimed: "Search filters people and messages",
    happened: `typed test; list now ${(await page.locator(".convo").count())} rows`,
    evidence: await shot(page, `${role.id}-msg-search`),
    net: drain(bag).net
  });
  await page.locator("#q").fill("");
  await waitQuiet(page, 400);
  await clickSel(page, bag, {
    role: role.id, screen, sel: 'button.ctab[data-filter="reply"]',
    claimed: "Needs reply tab lists threads where the client spoke last",
    slug: `${role.id}-msg-reply`, wait: 1200
  });
  const convo = page.locator(".convo").first();
  if (await convo.count() && await convo.isVisible().catch(() => false)) {
    const label = (await convo.innerText()).replace(/\s+/g, " ").trim().slice(0, 80);
    drain(bag);
    await convo.click();
    await waitQuiet(page, 1200);
    const th = await page.locator("#thName").innerText().catch(() => "");
    rec({
      role: role.id, screen, claimed: "Open a conversation reads the thread",
      happened: `opened "${label}" → thread "${th}"`,
      evidence: await shot(page, `${role.id}-msg-thread`, true),
      net: drain(bag).net
    });
    const sendDisabled = await page.locator("#sendBtn").isDisabled().catch(() => true);
    await page.locator("#composeBody").fill("W3 audit — do not send").catch(() => {});
    await waitQuiet(page, 300);
    rec({
      role: role.id, screen, claimed: "Send posts a reply on this channel",
      happened: sendDisabled
        ? "Send stayed disabled or compose refused"
        : "NOT clicked — would send live mail/SMS; typed only",
      evidence: await shot(page, `${role.id}-msg-compose`),
      net: drain(bag).net
    });
    await page.locator("#composeBody").fill("").catch(() => {});
  } else {
    rec({
      role: role.id, screen, claimed: "Open a conversation",
      happened: "no conversation rows", evidence: await shot(page, `${role.id}-msg-empty`), net: []
    });
  }
  await clickSel(page, bag, {
    role: role.id, screen, sel: "details.ctx-sec >> nth=1 > summary",
    claimed: "Open elsewhere expands", slug: `${role.id}-msg-elsewhere`
  });
  await clickSel(page, bag, {
    role: role.id, screen, sel: "#demoToggle",
    claimed: "Reference colour key expands", slug: `${role.id}-msg-ref`
  });
}

async function walkStaff(page, bag, role) {
  const screen = "staff";
  await openScreen(page, bag, role, "staff");
  if (!role.can.includes("staff")) return;
  await clickSel(page, bag, {
    role: role.id, screen, sel: 'button.tab[data-tab="perms"]',
    claimed: "Permissions tab", slug: `${role.id}-staff-perms`, full: true
  });
  await clickSel(page, bag, {
    role: role.id, screen, sel: 'button.tab[data-tab="clock"]',
    claimed: "Clock & consent tab", slug: `${role.id}-staff-clock`, full: true
  });
  const clockBtn = page.locator("[data-clock]").first();
  if (await clockBtn.count() && await clockBtn.isVisible().catch(() => false)) {
    const label = (await clockBtn.innerText()).trim();
    await clickSel(page, bag, {
      role: role.id, screen, sel: "[data-clock]",
      claimed: `${label} writes an open/close shift for the signed-in person`,
      slug: `${role.id}-staff-clock-btn`, wait: 1500
    });
    await clickSel(page, bag, {
      role: role.id, screen, sel: "[data-clock]",
      claimed: "Clock again restores prior state",
      slug: `${role.id}-staff-clock-btn2`, wait: 1500
    });
  }
  const consentBtn = page.locator("[data-consent]").first();
  if (await consentBtn.count() && await consentBtn.isVisible().catch(() => false)) {
    await clickSel(page, bag, {
      role: role.id, screen, sel: "[data-consent]",
      claimed: "Record form / Revoke writes monitoring consent",
      slug: `${role.id}-staff-consent`
    });
  }
  await clickSel(page, bag, {
    role: role.id, screen, sel: 'button.tab[data-tab="telemetry"]',
    claimed: "Telemetry tab", slug: `${role.id}-staff-tele`, wait: 1200, full: true
  });
  await clickSel(page, bag, {
    role: role.id, screen, sel: "#teleRefresh",
    claimed: "Refresh reloads telemetry", slug: `${role.id}-staff-tele-refresh`, wait: 1200
  });
  await clickSel(page, bag, {
    role: role.id, screen, sel: 'button.tab[data-tab="roster"]',
    claimed: "Roster tab", slug: `${role.id}-staff-roster`
  });
  await page.locator("#qFilter").fill("chris");
  await waitQuiet(page, 400);
  rec({
    role: role.id, screen, claimed: "Filter name or code…",
    happened: `typed chris; rows ${(await page.locator("tbody tr").count())}`,
    evidence: await shot(page, `${role.id}-staff-filter`),
    net: drain(bag).net
  });
  await page.locator("#qFilter").fill("");
  const roleFilter = page.locator("#roleFilter");
  if (await roleFilter.count()) {
    const opts = await roleFilter.locator("option").allTextContents();
    const pick = opts.findIndex((o) => /closer/i.test(o));
    if (pick >= 0) {
      await roleFilter.selectOption({ index: pick });
      await waitQuiet(page, 400);
      rec({
        role: role.id, screen, claimed: "Role filter",
        happened: `selected ${opts[pick]}`,
        evidence: await shot(page, `${role.id}-staff-role-filter`),
        net: drain(bag).net
      });
      await roleFilter.selectOption({ index: 0 });
    }
  }
  await clickSel(page, bag, {
    role: role.id, screen, sel: "#toAdvanced",
    claimed: "Permissions → jumps to Permissions tab", slug: `${role.id}-staff-to-adv`
  });
  await clickSel(page, bag, {
    role: role.id, screen, sel: 'button.tab[data-tab="roster"]',
    claimed: "Back to Roster", slug: `${role.id}-staff-roster2`
  });
  await clickSel(page, bag, {
    role: role.id, screen, sel: "#addBtn",
    claimed: "+ Add person opens the new-person drawer", slug: `${role.id}-staff-add`
  });
  await clickSel(page, bag, {
    role: role.id, screen, sel: "#edCancel",
    claimed: "Cancel closes drawer without save", slug: `${role.id}-staff-add-cancel`
  });
  const person = page.locator("tbody tr[data-id], tbody tr").first();
  if (await person.count() && await person.isVisible().catch(() => false)) {
    drain(bag);
    await person.click();
    await waitQuiet(page, 700);
    rec({
      role: role.id, screen, claimed: "Click roster row opens person editor",
      happened: (await page.locator("#edTitle").innerText().catch(() => "")).slice(0, 80),
      evidence: await shot(page, `${role.id}-staff-edit`),
      net: drain(bag).net
    });
    const resetVis = await page.locator("#edReset").isVisible().catch(() => false);
    rec({
      role: role.id, screen, claimed: "Reset password emails a reset link",
      happened: resetVis ? "NOT clicked — would email a live reset" : "hidden",
      evidence: "", net: []
    });
    rec({
      role: role.id, screen, claimed: "Revoke login deactivates this staff row",
      happened: "NOT clicked — would lock a live person out",
      evidence: "", net: []
    });
    await clickSel(page, bag, {
      role: role.id, screen, sel: "#edClose",
      claimed: "✕ closes person editor without save", slug: `${role.id}-staff-edit-close`
    });
  }
}

async function runRole(browser, role) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const bag = { net: [], dialogs: [], console: [], pageErrors: [] };
  attach(page, bag);
  try {
    await login(page, role.email);
    await waitQuiet(page, 800);
    await shot(page, `${role.id}-after-login`, true);
    rec({
      role: role.id, screen: "login", claimed: "Sign in lands on this role's home",
      happened: (await facts(page)).path, evidence: `${role.id}-after-login.png`, net: drain(bag).net
    });
    if (role.id === "owner") {
      await walkFinance(page, bag, role);
      await walkProducts(page, bag, role);
      await walkOps(page, bag, role);
      await walkSpecialist(page, bag, role);
      await walkCalendar(page, bag, role);
      await walkMessaging(page, bag, role);
      await walkStaff(page, bag, role);
    } else {
      for (const key of ALL_KEYS) {
        if (role.can.includes(key)) {
          if (key === "specialist") await walkSpecialist(page, bag, role);
          else if (key === "calendar") await walkCalendar(page, bag, role);
          else if (key === "messaging") await walkMessaging(page, bag, role);
          else if (key === "products") await walkProducts(page, bag, role);
          else if (key === "staff") await walkStaff(page, bag, role);
          else await openScreen(page, bag, role, key);
        } else {
          await openScreen(page, bag, role, key);
        }
      }
    }
  } catch (e) {
    rec({
      role: role.id, screen: "session", claimed: "Walk this role",
      happened: `threw: ${String(e && e.message ? e.message : e).slice(0, 240)}`,
      evidence: await shot(page, `${role.id}-error`).catch(() => ""),
      net: []
    });
  } finally {
    await context.close();
  }
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: chromeExe()
  });
  for (const role of ROLES) {
    console.log(JSON.stringify({ kind: "role-start", role: role.id }));
    await runRole(browser, role);
  }
  await browser.close();
  const out = {
    when: new Date().toISOString(),
    live: BASE,
    forbiddenClient: FORBIDDEN,
    testClient: TEST_CLIENT,
    pages,
    clicks
  };
  fs.writeFileSync(path.join(OUT, "walk.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ kind: "done", pages: pages.length, clicks: clicks.length }));
})().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
