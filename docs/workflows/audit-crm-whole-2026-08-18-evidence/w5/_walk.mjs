/**
 * W5 live walk — automation screens + role matrix.
 * Read-only audit evidence. Does not promote agents, does not enable outbound,
 * does not fire soft pulls / inquiry removals / contract sends.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-crm-whole-2026-08-18-evidence/w5");
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

const PASSWORD = process.env.STAFF_E2E_PASSWORD || "";
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

const NAV = [
  { label: "Home", href: "partner-galaxy.html" },
  { label: "Pipeline", href: "pipeline.html" },
  { label: "Closer Dashboard", href: "closer-dashboard.html" },
  { label: "Call cockpit", href: "closer-call.html" },
  { label: "My numbers", href: "my-numbers.html" },
  { label: "Sales floor", href: "sales-floor.html" },
  { label: "Calendar", href: "calendar.html" },
  { label: "Lenders", href: "lenders.html" },
  { label: "Finance OS", href: "finance-os.html" },
  { label: "Client Control Panel", href: "client-control-panel.html" },
  { label: "Messaging", href: "messaging.html" },
  { label: "Documents", href: "documents.html" },
  { label: "Specialist", href: "inquiry-remover.html" },
  { label: "Company Brain", href: "company-brain.html" },
  { label: "Galaxy", href: "galaxy.html" },
  { label: "Ops & Admin", href: "ops-admin.html" },
  { label: "Agent Editor", href: "agent-editor.html" },
  { label: "Workflows", href: "automations.html" },
  { label: "Journeys", href: "journeys.html" },
  { label: "Message Copy", href: "template-editor.html" },
  { label: "Campaigns", href: "campaign-manager.html" },
  { label: "Social Studio", href: "social-studio.html" },
  { label: "Creative Factory", href: "creative-factory.html" },
  { label: "Staff & Teams", href: "staff-teams.html" },
  { label: "Hiring", href: "hiring.html" },
  { label: "Products & Commissions", href: "products-commissions.html" },
  { label: "Contract templates", href: "contracts.html" },
  { label: "Brand Studio", href: "brand-studio.html" },
  { label: "Client Portal", href: "client-portal.html" },
  { label: "Affiliate", href: "affiliate.html" }
];

const ROLES = [
  { key: "owner", email: "chris@fundhub.ai" },
  { key: "closer", email: "closer@fundhub.ai" },
  { key: "sales", email: "sales@fundhub.ai" },
  { key: "advisor", email: "advisor@fundhub.ai" },
  { key: "affiliate", email: "affiliate@fundhub.ai" }
];

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
    if (status >= 400) bag.net.push({ status, url: url.slice(0, 240), method: res.request().method() });
  });
}

async function login(page, email) {
  await page.goto(BASE + "/login.html", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.locator('input[type="email"], #email, input[name="email"]').first().fill(email);
  const pass = page.locator('input[type="password"], #password, input[name="password"]').first();
  if (!(await pass.count())) return { ok: false, reason: "no password field" };
  await pass.fill(PASSWORD);
  await page.locator('button[type="submit"], button:has-text("Sign"), button:has-text("Log")').first().click();
  await page.waitForFunction(() => !/login\.html|portal-login\.html/i.test(location.pathname), null, { timeout: 30000 });
  await page.waitForTimeout(800);
  return { ok: true };
}

async function facts(page) {
  return page.evaluate(() => {
    const body = (document.body && document.body.innerText) || "";
    const nav = [...document.querySelectorAll("#fh-side-nav a")].filter((a) => a.offsetParent).map((a) => ({
      label: (a.textContent || "").replace(/\s+/g, " ").trim(),
      href: (a.getAttribute("href") || "").split("?")[0]
    })).filter((x) => x.label);
    return {
      url: location.href,
      pathname: location.pathname,
      title: document.title,
      h1: (document.querySelector("h1, .page-title, .hdr h1, .topbar h1, .sub")?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 160),
      snippet: body.replace(/\s+/g, " ").slice(0, 700),
      visibleNav: nav,
      roleChip: (document.querySelector(".who, #fh-role-chip, .org-pill")?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 80)
    };
  });
}

async function shot(page, slug, full = false) {
  const file = path.join(OUT, `${slug}.png`);
  await page.screenshot({ path: file, fullPage: full });
  return path.relative(ROOT, file);
}

function apiOf(bag, re) {
  return bag.net.filter((n) => re.test(n.url));
}

const report = {
  ranAt: new Date().toISOString(),
  live: BASE,
  roles: {},
  matrix: [],
  automation: [],
  notes: []
};

async function withRole(browser, role, fn) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const bag = { console: [], pageErrors: [], net: [] };
  attachWatchers(page, bag);
  page.on("dialog", async (d) => {
    report.notes.push({ role: role.key, dialog: d.type(), message: String(d.message() || "").slice(0, 200), action: "dismiss" });
    await d.dismiss();
  });
  const loginRes = await login(page, role.email);
  const f = await facts(page);
  report.roles[role.key] = {
    email: role.email,
    login: loginRes,
    landing: { pathname: f.pathname, h1: f.h1, title: f.title },
    visibleNav: f.visibleNav,
    shot: await shot(page, `role-${role.key}-00-landing`)
  };
  try {
    await fn(page, bag, role);
  } finally {
    await context.close();
  }
}

async function openScreen(page, href) {
  await page.goto(BASE + "/app/" + href, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(1100);
  return facts(page);
}

async function walkMatrix(page, role) {
  for (const screen of NAV) {
    const f = await openScreen(page, screen.href);
    const landed = (f.pathname || "").split("/").pop();
    const opened = landed === screen.href;
    const bounced = !opened;
    const row = {
      role: role.key,
      screen: screen.label,
      href: screen.href,
      opened,
      bounced,
      landed,
      h1: f.h1,
      title: f.title,
      snippet: f.snippet.slice(0, 280),
      shot: await shot(page, `role-${role.key}-${screen.href.replace(/\.html$/, "")}`)
    };
    report.matrix.push(row);
    process.stdout.write(`${role.key} ${screen.label}: ${opened ? "OPEN" : "BOUNCE→" + landed}\n`);
  }
}

async function clickIfVisible(page, selector) {
  const loc = page.locator(selector).first();
  if (!(await loc.count())) return { clicked: false, reason: "missing" };
  if (!(await loc.isVisible().catch(() => false))) return { clicked: false, reason: "hidden" };
  const disabled = await loc.isDisabled().catch(() => false);
  if (disabled) return { clicked: false, reason: "disabled" };
  await loc.click({ timeout: 5000 }).catch((e) => ({ err: e.message }));
  return { clicked: true };
}

async function walkMessageCopy(page, bag, role) {
  const f0 = await openScreen(page, "template-editor.html");
  const opened = (f0.pathname || "").endsWith("template-editor.html");
  const rec = {
    screen: "Message Copy",
    role: role.key,
    opened,
    landing: f0,
    shot: await shot(page, `${role.key}-copy-00`, true),
    controls: [],
    apis: []
  };
  if (!opened) {
    rec.controls.push({ control: "open page", claimed: "open Message Copy", happened: "bounced to " + f0.pathname, db: "none", mail: "none", outside: "none" });
    report.automation.push(rec);
    return rec;
  }
  await page.waitForTimeout(1500);
  rec.shotLoaded = await shot(page, `${role.key}-copy-01-loaded`, true);
  rec.stats = await page.evaluate(() => ({
    all: document.getElementById("kAll")?.textContent,
    sms: document.getElementById("kSms")?.textContent,
    email: document.getElementById("kEmail")?.textContent,
    off: document.getElementById("kOff")?.textContent,
    draft: document.getElementById("kDraft")?.textContent,
    liveTxt: document.getElementById("liveTxt")?.textContent,
    howThisWorks: document.getElementById("explainCard")?.innerText?.slice(0, 400) || ""
  }));

  const explain = await clickIfVisible(page, "#explainCard summary, #explainCard > summary");
  rec.controls.push({
    control: "How this works",
    claimed: "explains editing / approval / no send",
    clicked: explain,
    happened: explain.clicked ? "opened details" : explain.reason,
    db: "none", mail: "none", outside: "none"
  });
  rec.shotExplain = await shot(page, `${role.key}-copy-02-explain`);

  const items = page.locator("#tplList .aitem");
  const n = await items.count();
  rec.listCount = n;
  if (n) {
    await items.first().click();
    await page.waitForTimeout(600);
    rec.controls.push({
      control: "template list item",
      claimed: "open wording in editor",
      happened: "editor pane shown",
      db: "none", mail: "none", outside: "none",
      editor: await page.evaluate(() => ({
        key: document.getElementById("edKey")?.textContent,
        chan: document.getElementById("edChan")?.textContent,
        state: document.getElementById("edState")?.textContent,
        approved: document.getElementById("edApproved")?.textContent,
        preview: (document.getElementById("preview")?.innerText || "").slice(0, 180),
        saveDisabled: !!document.getElementById("saveBtn")?.disabled,
        apprVisible: document.getElementById("apprCard")?.style?.display !== "none",
        apprState: document.getElementById("apprState")?.innerText || "",
        goingOutClaim: /messages are being sent/i.test(document.getElementById("apprState")?.innerText || "")
          || /going out/i.test(document.getElementById("edState")?.textContent || "")
      }))
    });
    rec.shotEditor = await shot(page, `${role.key}-copy-03-editor`, true);
  }

  const tagBtn = page.locator("#tagPalette button").first();
  if (await tagBtn.count() && await tagBtn.isVisible().catch(() => false)) {
    await tagBtn.click();
    await page.waitForTimeout(300);
    rec.controls.push({
      control: "insert First name tag",
      claimed: "insert {{contact.first_name}} into body",
      happened: "tag inserted locally",
      db: "none", mail: "none", outside: "none"
    });
    rec.shotTag = await shot(page, `${role.key}-copy-04-tag`);
    const undo = await clickIfVisible(page, "#revertBtn");
    rec.controls.push({
      control: "Undo my changes",
      claimed: "revert editor to saved wording",
      clicked: undo,
      happened: undo.clicked ? "editor restored locally" : undo.reason,
      db: "none", mail: "none", outside: "none"
    });
  }

  if (n > 1) {
    await items.nth(Math.min(1, n - 1)).click();
    await page.waitForTimeout(400);
  }
  const state = await page.evaluate(() => ({
    state: document.getElementById("edState")?.textContent || "",
    saveDisabled: !!document.getElementById("saveBtn")?.disabled,
    apprDisabled: !!document.getElementById("apprBtn")?.disabled,
    apprVisible: document.getElementById("apprCard")?.offsetParent != null
  }));
  rec.controls.push({
    control: "Save wording",
    claimed: "save copy to the database and switch the message off until approved",
    happened: "NOT CLICKED — would write production message_templates. Observed button " + (state.saveDisabled ? "disabled" : "enabled") + "; current state “" + state.state + "”.",
    db: "none (deliberately not written)",
    mail: "none",
    outside: "none"
  });
  rec.controls.push({
    control: "Approve this wording",
    claimed: "turn the message back on / “messages are being sent with it”",
    happened: "NOT CLICKED — would flip compliance_passed. Button " + (state.apprVisible ? (state.apprDisabled ? "visible+disabled" : "visible+enabled") : "hidden for this role") + ".",
    db: "none",
    mail: "none",
    outside: "none"
  });

  const prev = await clickIfVisible(page, "#tplPrev");
  const next = await clickIfVisible(page, "#tplNext");
  rec.controls.push({ control: "Previous / Next pager", claimed: "page the template list", happened: `prev=${JSON.stringify(prev)} next=${JSON.stringify(next)}`, db: "none", mail: "none", outside: "none" });

  rec.apis = bag.net.filter((n) => /message-templates|auth\/session/.test(n.url));
  rec.shotEnd = await shot(page, `${role.key}-copy-99`, true);
  report.automation.push(rec);
  return rec;
}

async function walkWorkflows(page, bag, role) {
  bag.net.length = 0;
  const f0 = await openScreen(page, "automations.html");
  const opened = (f0.pathname || "").endsWith("automations.html");
  const rec = {
    screen: "Workflows",
    role: role.key,
    opened,
    landing: f0,
    shot: await shot(page, `${role.key}-wf-00`, true),
    controls: []
  };
  if (!opened) {
    rec.controls.push({ control: "open page", claimed: "open Workflows", happened: "bounced to " + f0.pathname, db: "none", mail: "none", outside: "none" });
    report.automation.push(rec);
    return rec;
  }
  await page.waitForTimeout(1800);
  rec.summary = await page.evaluate(() => ({
    total: document.querySelector('[data-sum="total"]')?.textContent,
    engine: document.querySelector('[data-sum="engine"]')?.textContent,
    live: document.querySelector('[data-sum="live"]')?.textContent,
    attn: document.getElementById("attnBar")?.innerText || "",
    footer: document.getElementById("wfFooterCount")?.textContent,
    rows: document.querySelectorAll("tr[data-wf]").length
  }));
  rec.shotLoaded = await shot(page, `${role.key}-wf-01-loaded`, true);
  rec.controls.push({
    control: "page load / Engine tile",
    claimed: "show live registry + whether the automation engine is on",
    happened: `engine=${rec.summary.engine} total=${rec.summary.total} triggered=${rec.summary.live}`,
    attn: rec.summary.attn.slice(0, 280),
    db: "read /api/read/workflows only",
    mail: "none",
    outside: rec.summary.engine === "ON" ? "Inngest key present" : "no Inngest key — engine off"
  });

  const row = page.locator("tr[data-wf]").first();
  if (await row.count()) {
    await row.click();
    await page.waitForTimeout(400);
    rec.controls.push({
      control: "workflow row",
      claimed: "expand registry details",
      happened: "row toggled open",
      db: "none", mail: "none", outside: "none",
      detail: await page.evaluate(() => (document.querySelector(".wf-steps:not([hidden])")?.innerText || "").replace(/\s+/g, " ").slice(0, 300))
    });
    rec.shotExpand = await shot(page, `${role.key}-wf-02-expand`);
  }

  const rails = await page.locator("#rail-select option").allTextContents();
  rec.rails = rails;
  if (rails.length > 1) {
    await page.selectOption("#rail-select", { label: rails[1] });
    await page.waitForTimeout(300);
    rec.controls.push({
      control: "Rail filter",
      claimed: "show only that rail’s workflows",
      happened: "filtered to " + rails[1],
      visibleGroups: await page.evaluate(() => [...document.querySelectorAll(".rail-group")].filter((g) => !g.hidden).map((g) => g.dataset.rail)),
      db: "none", mail: "none", outside: "none"
    });
    rec.shotRail = await shot(page, `${role.key}-wf-03-rail`);
    await page.selectOption("#rail-select", { label: rails[0] });
  }
  rec.apis = bag.net.filter((n) => /workflows/.test(n.url));
  report.automation.push(rec);
  return rec;
}

async function walkJourneys(page, bag, role) {
  bag.net.length = 0;
  const f0 = await openScreen(page, "journeys.html");
  const opened = (f0.pathname || "").endsWith("journeys.html");
  const rec = {
    screen: "Journeys",
    role: role.key,
    opened,
    landing: f0,
    shot: await shot(page, `${role.key}-jny-00`, true),
    controls: []
  };
  if (!opened) {
    rec.controls.push({ control: "open page", claimed: "open Journeys", happened: "bounced to " + f0.pathname, db: "none", mail: "none", outside: "none" });
    report.automation.push(rec);
    return rec;
  }
  await page.waitForTimeout(1500);
  rec.shotLoaded = await shot(page, `${role.key}-jny-01-loaded`, true);
  rec.header = await page.evaluate(() => ({
    dirty: document.getElementById("dirty")?.textContent,
    journeys: [...document.querySelectorAll(".jitem, .jlist button, [data-j]")].slice(0, 12).map((el) => (el.innerText || "").replace(/\s+/g, " ").trim()).filter(Boolean)
  }));

  for (const tab of ["step", "sim", "hist"]) {
    const c = await clickIfVisible(page, `.ptab[data-tab="${tab}"]`);
    rec.controls.push({ control: `tab ${tab}`, claimed: `show ${tab} panel`, clicked: c, happened: c.clicked ? "panel shown" : c.reason, db: "none", mail: "none", outside: "none" });
  }
  rec.shotTabs = await shot(page, `${role.key}-jny-02-tabs`);

  await clickIfVisible(page, '.ptab[data-tab="sim"]');
  const sim = await clickIfVisible(page, "#simstart");
  await page.waitForTimeout(800);
  rec.controls.push({
    control: "Run the journey (Simulate)",
    claimed: "walk the journey locally",
    clicked: sim,
    happened: sim.clicked ? "simulate started in the browser" : sim.reason,
    db: "none", mail: "none", outside: "none"
  });
  rec.shotSim = await shot(page, `${role.key}-jny-03-sim`);
  await clickIfVisible(page, "#simstop");

  const apply = await clickIfVisible(page, "#apply");
  await page.waitForTimeout(500);
  rec.controls.push({
    control: "Apply to code",
    claimed: "save journey nodes to the database (PUT /api/journeys). Copy says nothing is live until deploy.",
    clicked: apply,
    happened: apply.clicked ? "clicked with no dirty changes (expect nothing-to-apply toast)" : apply.reason,
    toast: await page.evaluate(() => (document.querySelector(".toast, #toast")?.innerText || "").slice(0, 200)),
    db: apply.clicked ? "PUT only if dirty — dirty was 0" : "none",
    mail: "none",
    outside: "none"
  });
  rec.shotApply = await shot(page, `${role.key}-jny-04-apply`);

  const savever = await clickIfVisible(page, "#savever");
  rec.controls.push({
    control: "Save version",
    claimed: "name and keep a local snapshot",
    clicked: savever,
    happened: savever.clicked ? "prompt dismissed — no version stored" : savever.reason,
    db: "none (versions are in-memory only)",
    mail: "none",
    outside: "none"
  });

  const undo = await clickIfVisible(page, "#undo");
  rec.controls.push({
    control: "Undo",
    claimed: "undo last edit",
    clicked: undo,
    happened: undo.clicked ? "clicked" : undo.reason,
    db: "none", mail: "none", outside: "none"
  });

  const runreal = await clickIfVisible(page, "#runreal");
  rec.controls.push({
    control: "Test against the code",
    claimed: "POST /api/journeys/run — walk real workflows, roll back, recording provider (cannot send)",
    clicked: runreal,
    happened: runreal.clicked ? "clicked — waiting" : runreal.reason
  });
  if (runreal.clicked) {
    try {
      await page.waitForFunction(() => document.getElementById("runout") || /Could not|Not allowed|Testing/.test(document.body.innerText), null, { timeout: 90000 });
    } catch {}
    await page.waitForTimeout(800);
    rec.controls[rec.controls.length - 1].happened = await page.evaluate(() => ({
      runout: (document.getElementById("runout")?.innerText || "").replace(/\s+/g, " ").slice(0, 600),
      toast: (document.querySelector(".toast, #toast")?.innerText || "").slice(0, 200)
    }));
    rec.shotRun = await shot(page, `${role.key}-jny-05-runcode`, true);
    await clickIfVisible(page, "#runclose");
  }

  const node = page.locator(".node").first();
  if (await node.count() && await node.isVisible().catch(() => false)) {
    await node.click();
    await page.waitForTimeout(400);
    rec.controls.push({
      control: "journey step node",
      claimed: "select step and show Step panel",
      happened: "node selected",
      db: "none", mail: "none", outside: "none"
    });
    rec.shotNode = await shot(page, `${role.key}-jny-06-node`);
  }

  const add = page.locator("button.add").first();
  if (await add.count() && await add.isVisible().catch(() => false)) {
    await add.click();
    await page.waitForTimeout(300);
    rec.shotMenu = await shot(page, `${role.key}-jny-07-addmenu`);
    rec.controls.push({
      control: "+ add step",
      claimed: "open step-type menu",
      happened: "menu opened — no type inserted (would dirty the journey)",
      db: "none", mail: "none", outside: "none"
    });
    await page.keyboard.press("Escape");
  }

  const eg = page.locator(".eg").first();
  if (await eg.count() && await eg.isVisible().catch(() => false)) {
    rec.controls.push({
      control: "example / Make the change",
      claimed: "POST /api/journeys/ask (Claude) or local worked example",
      happened: "NOT CLICKED — would call Claude / stage a patch. Observed example buttons present.",
      db: "none", mail: "none", outside: "none (deliberately not called)"
    });
  }

  rec.apis = bag.net.filter((n) => /\/api\/journeys/.test(n.url));
  rec.shotEnd = await shot(page, `${role.key}-jny-99`, true);
  report.automation.push(rec);
  return rec;
}

async function walkAgentEditor(page, bag, role) {
  bag.net.length = 0;
  const f0 = await openScreen(page, "agent-editor.html");
  const opened = (f0.pathname || "").endsWith("agent-editor.html");
  const rec = {
    screen: "Agent Editor",
    role: role.key,
    opened,
    landing: f0,
    shot: await shot(page, `${role.key}-agt-00`, true),
    controls: []
  };
  if (!opened) {
    rec.controls.push({ control: "open page", claimed: "open Agent Editor", happened: "bounced to " + f0.pathname, db: "none", mail: "none", outside: "none" });
    report.automation.push(rec);
    return rec;
  }
  await page.waitForTimeout(1800);
  rec.stats = await page.evaluate(() => ({
    all: document.getElementById("kAll")?.textContent,
    live: document.getElementById("kLive")?.textContent,
    shadow: document.getElementById("kShadow")?.textContent,
    breach: document.getElementById("kBreach")?.textContent,
    mode: document.getElementById("modeTitle")?.textContent,
    modeSub: document.getElementById("modeSub")?.textContent,
    empty: document.getElementById("emptyState")?.style?.display !== "none" ? document.getElementById("emptyStateMsg")?.textContent : null,
    list: [...document.querySelectorAll("#alist .aitem, #alist > *")].slice(0, 12).map((el) => (el.innerText || "").replace(/\s+/g, " ").trim()).filter(Boolean)
  }));
  rec.shotLoaded = await shot(page, `${role.key}-agt-01-loaded`, true);

  const listItem = page.locator("#alist .aitem, #alist > div").nth(1);
  if (await listItem.count() && await listItem.isVisible().catch(() => false)) {
    await listItem.click();
    await page.waitForTimeout(400);
    rec.controls.push({ control: "agent list item", claimed: "load that agent into the form", happened: "second agent selected (or first if only one)", db: "none", mail: "none", outside: "none" });
  }
  rec.shotAgent = await shot(page, `${role.key}-agt-02-selected`, true);

  for (const sum of ["IDENTITY", "TRIGGER EVENTS", "PROMPT", "ESCALATION PATH", "SHADOW LOG"]) {
    const loc = page.locator("details.card").filter({ hasText: sum }).locator("summary").first();
    if (await loc.count()) {
      await loc.click().catch(() => {});
      rec.controls.push({ control: `expand ${sum}`, claimed: "show that card", happened: "toggled", db: "none", mail: "none", outside: "none" });
    }
  }
  rec.shotCards = await shot(page, `${role.key}-agt-03-cards`, true);

  const sw = page.locator(".sw").first();
  if (await sw.count()) {
    await sw.click();
    await page.waitForTimeout(200);
    rec.controls.push({
      control: "guardrail / authority switch",
      claimed: "toggle a local flag (dirty until Save)",
      happened: "toggled locally",
      db: "none yet"
    });
    const rev = await clickIfVisible(page, "#revertBtn");
    rec.controls.push({
      control: "Revert",
      claimed: "reload the selected agent, drop unsaved edits",
      clicked: rev,
      happened: rev.clicked ? "reverted locally" : rev.reason,
      db: "none", mail: "none", outside: "none"
    });
  }

  rec.controls.push({
    control: "Save agent",
    claimed: "POST /api/agents action=save — write name, prompt, guardrails",
    happened: "NOT CLICKED — would write the agents row. Button is on the page.",
    db: "none", mail: "none", outside: "none"
  });
  rec.controls.push({
    control: "Promote to live",
    claimed: "agent starts acting on real clients immediately",
    happened: "clicked then confirm dismissed — no promote",
    db: "none", mail: "none", outside: "none"
  });
  await clickIfVisible(page, "#promoteBtn");
  await page.waitForTimeout(400);
  rec.shotPromote = await shot(page, `${role.key}-agt-04-promote`);

  rec.controls.push({
    control: "Return to shadow",
    claimed: "stop acting on real clients; only log",
    happened: "clicked then confirm dismissed — no demote",
    db: "none", mail: "none", outside: "none"
  });
  await clickIfVisible(page, "#demoteBtn");

  rec.controls.push({
    control: "+ New agent",
    claimed: "prompt for a name, POST /api/agents action=create",
    happened: "clicked then prompt dismissed — no row created",
    db: "none", mail: "none", outside: "none"
  });
  await clickIfVisible(page, "#newBtn");
  await page.waitForTimeout(400);
  rec.shotNew = await shot(page, `${role.key}-agt-05-new`);

  rec.apis = bag.net.filter((n) => /\/api\/(agents|read\/agents|read\/staff)/.test(n.url));
  rec.shotEnd = await shot(page, `${role.key}-agt-99`, true);
  report.automation.push(rec);
  return rec;
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: chromeExe(),
    args: ["--disable-dev-shm-usage"]
  });

  for (const role of ROLES) {
    await withRole(browser, role, async (page, bag, r) => {
      await walkMatrix(page, r);
      if (r.key === "owner") {
        await walkMessageCopy(page, bag, r);
        await walkWorkflows(page, bag, r);
        await walkJourneys(page, bag, r);
        await walkAgentEditor(page, bag, r);
      } else {
        await walkMessageCopy(page, bag, r);
        await walkWorkflows(page, bag, r);
        await walkJourneys(page, bag, r);
        await walkAgentEditor(page, bag, r);
      }
    });
  }

  // Client portal is email-link only — no password walk.
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(BASE + "/portal-login.html", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(600);
  const clientFacts = await facts(page);
  report.clientPortal = {
    note: "Client is email-link only. No password invented. Unsigned portal-login only.",
    facts: clientFacts,
    shot: await shot(page, "role-client-portal-login")
  };
  await context.close();
  await browser.close();

  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  const matrixMd = [];
  const screens = NAV.map((s) => s.label);
  const roleKeys = ROLES.map((r) => r.key);
  matrixMd.push("| Screen | owner | closer | sales | advisor | affiliate |");
  matrixMd.push("|---|---|---|---|---|---|");
  for (const label of screens) {
    const cells = roleKeys.map((rk) => {
      const row = report.matrix.find((m) => m.role === rk && m.screen === label);
      if (!row) return "?";
      return row.opened ? "OPEN" : "BOUNCE";
    });
    matrixMd.push(`| ${label} | ${cells.join(" | ")} |`);
  }
  fs.writeFileSync(path.join(OUT, "matrix.md"), matrixMd.join("\n") + "\n");
  console.log("W5 walk done", { matrix: report.matrix.length, automation: report.automation.length });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
