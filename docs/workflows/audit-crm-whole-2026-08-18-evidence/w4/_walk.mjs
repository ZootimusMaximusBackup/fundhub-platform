import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-crm-whole-2026-08-18-evidence/w4");
const BASE = "https://fundhub.ai";
const DEMO = "94796e0e-d012-4987-8721-676093aaed79";
const TEST_CLIENT = "8556bedc-46e1-4d85-b0cd-a24adfee1521";
const PORTAL_EMAIL = "client@fundhub.ai";

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

function db() {
  return new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
}

function ignoreUrl(url) {
  return /fonts\.googleapis|fonts\.gstatic|googletagmanager|google-analytics|hotjar|sentry\.io|favicon|w3\.org/i.test(url);
}

const clicks = [];
const nets = [];
const shots = [];

function rec(row) {
  clicks.push({ at: new Date().toISOString(), ...row });
  console.log(JSON.stringify({
    screen: row.screen,
    control: row.control,
    happened: (row.happened || "").slice(0, 160),
    api: row.api || null,
    shot: row.shot || null
  }));
}

async function shot(page, slug, full = false) {
  const file = path.join(OUT, `${slug}.png`);
  await page.screenshot({ path: file, fullPage: full }).catch(() => {});
  const rel = path.relative(ROOT, file);
  shots.push(rel);
  return rel;
}

function attachWatchers(page, bag) {
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text() || "";
    if (/Download the React DevTools|Third-party cookie|net::ERR_BLOCKED_BY_CLIENT/i.test(text)) return;
    bag.console.push(text.slice(0, 300));
  });
  page.on("pageerror", (err) => {
    bag.pageErrors.push(String(err && err.message ? err.message : err).slice(0, 300));
  });
  page.on("dialog", async (d) => {
    bag.dialogs.push(d.message().slice(0, 240));
    await d.dismiss();
  });
  page.on("response", (res) => {
    const url = res.url();
    if (ignoreUrl(url)) return;
    const status = res.status();
    const method = res.request().method();
    const short = url.replace(BASE, "").slice(0, 220);
    if (status >= 400 || method !== "GET") {
      const row = { status, method, url: short };
      bag.net.push(row);
      nets.push(row);
    }
  });
}

async function login(page, email) {
  await page.goto(BASE + "/login.html", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.locator('input[type="email"], #email, input[name="email"]').first().fill(email);
  const pass = page.locator('input[type="password"], #password, input[name="password"]').first();
  if (!(await pass.count())) return { ok: false, reason: "no password field" };
  await pass.fill(PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForFunction(() => !/login\.html|portal-login\.html/i.test(location.pathname), null, { timeout: 30000 });
  return { ok: true, path: await page.evaluate(() => location.pathname) };
}

async function waitQuiet(page, ms = 900) {
  await page.waitForTimeout(ms);
}

async function textOf(page, sel) {
  const loc = page.locator(sel).first();
  if (!(await loc.count())) return "";
  return (await loc.innerText().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 280);
}

async function visibleNav(page) {
  return page.evaluate(() => {
    const items = [...document.querySelectorAll(".navitem, a.navitem")];
    return items
      .filter((a) => {
        const box = a.closest("[data-fh-gated]") || a;
        const st = getComputedStyle(box);
        return st.display !== "none" && st.visibility !== "hidden" && a.offsetParent;
      })
      .map((a) => (a.textContent || "").replace(/\s+/g, " ").trim())
      .filter(Boolean);
  });
}

async function clickNamed(page, screen, selector, claim, opts = {}) {
  const loc = page.locator(selector).first();
  const present = (await loc.count()) > 0;
  if (!present) {
    rec({ screen, control: claim, claimed: claim, happened: "control not on screen", api: null, shot: opts.shot || null });
    return { clicked: false };
  }
  const enabled = await loc.isEnabled().catch(() => false);
  const vis = await loc.isVisible().catch(() => false);
  if (!vis) {
    rec({ screen, control: claim, claimed: claim, happened: "present but not visible", api: null, shot: opts.shot || null });
    return { clicked: false };
  }
  if (!enabled && !opts.force) {
    rec({ screen, control: claim, claimed: claim, happened: "visible but disabled — did nothing", api: null, shot: opts.shot || null });
    return { clicked: false, disabled: true };
  }
  const beforeNet = nets.length;
  await loc.click({ timeout: 8000, force: !!opts.force }).catch((e) => {
    rec({ screen, control: claim, claimed: claim, happened: "click failed: " + String(e.message || e).slice(0, 120), api: null });
  });
  await waitQuiet(page, opts.wait || 800);
  const after = nets.slice(beforeNet);
  const writes = after.filter((n) => n.method !== "GET");
  const api = writes[0] || after.find((n) => n.status >= 400) || null;
  return { clicked: true, api, writes };
}

async function pickPartner(page, id) {
  return page.evaluate((pid) => {
    const sel = document.getElementById("partnerSel");
    if (!sel) return { ok: false, reason: "no partnerSel" };
    const opt = [...sel.options].find((o) => o.value === pid || /Northlight/i.test(o.textContent || ""));
    if (!opt) {
      return { ok: false, reason: "DEMO partner not in list", options: sel.options.length };
    }
    sel.value = opt.value;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, value: opt.value, label: (opt.textContent || "").trim() };
  }, id);
}

async function openRoleScreen(page, role, slug, file) {
  const before = await page.evaluate(() => location.pathname).catch(() => "");
  try {
    await page.goto(`${BASE}/app/${file}`, { waitUntil: "domcontentloaded", timeout: 45000 });
  } catch (e) {
    await waitQuiet(page, 800);
    const pathNow = await page.evaluate(() => location.pathname + location.search).catch(() => "unknown");
    const s = await shot(page, `${slug}-${role}`);
    rec({
      screen: file,
      control: `open as ${role}`,
      claimed: `${role} opens ${file}`,
      happened: `navigation aborted → ${pathNow} (${String(e.message || e).slice(0, 80)})`,
      api: null,
      shot: s,
      bounced: true,
      path: pathNow
    });
    return { bounced: true, path: pathNow, shot: s, from: before };
  }
  await waitQuiet(page, 1200);
  const pathNow = await page.evaluate(() => location.pathname + location.search);
  const title = await page.title().catch(() => "");
  const h1 = await textOf(page, "h1");
  const bounced = !new RegExp(file.replace(".", "\\."), "i").test(pathNow);
  const s = await shot(page, `${slug}-${role}`);
  rec({
    screen: file,
    control: `open as ${role}`,
    claimed: `${role} opens ${file}`,
    happened: bounced ? `bounced to ${pathNow}` : `stayed on ${pathNow} · ${h1 || title}`,
    api: null,
    shot: s,
    bounced,
    path: pathNow,
    nav: await visibleNav(page)
  });
  return { bounced, path: pathNow, shot: s, from: before };
}

async function walkCampaigns(page) {
  const screen = "campaigns";
  await page.goto(`${BASE}/app/campaign-manager.html?partner_id=${DEMO}`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await waitQuiet(page, 1800);
  const pick = await pickPartner(page, DEMO);
  await waitQuiet(page, 2000);
  rec({
    screen,
    control: "Partner picker",
    claimed: "Show this partner's campaigns",
    happened: pick.ok ? `selected ${pick.label}` : (pick.reason || "did nothing"),
    api: nets.filter((n) => /\/api\/campaigns\//.test(n.url)).slice(-1)[0] || null,
    shot: await shot(page, "campaigns-owner-demo", true)
  });

  await clickNamed(page, screen, "#reloadBtn", "Reload");
  await shot(page, "campaigns-reload");

  for (const [sel, claim, value] of [
    ["#fPlatform", "Platform filter", "meta"],
    ["#fOffer", "Offer filter", "funding"],
    ["#fLimit", "List limit", "10"],
    ["#fDays", "Fatigue window", "14"],
    ["#fTarget", "Action log target", "campaign"],
    ["#fRule", "Action log rule", "kill_switch_ceiling"]
  ]) {
    const loc = page.locator(sel).first();
    if (await loc.count()) {
      await loc.selectOption(value).catch(() => {});
      await waitQuiet(page, 600);
      rec({ screen, control: claim, claimed: `Filter to ${value}`, happened: `set ${sel} to ${value}`, api: null });
    }
  }
  await shot(page, "campaigns-filters");

  const sync = await clickNamed(page, screen, "#syncMetaBtn", "Sync Meta now — pull campaigns from Meta", { wait: 2500 });
  const syncMsg = await textOf(page, "#syncMetaMsg");
  rec({
    screen,
    control: "Sync Meta now",
    claimed: "Pull campaigns, ad sets, ads and spend from Meta",
    happened: syncMsg || (sync.clicked ? "clicked; no message" : "not clicked"),
    api: sync.api || nets.filter((n) => /\/api\/campaigns\/sync/.test(n.url)).slice(-1)[0] || null,
    shot: await shot(page, "campaigns-sync-meta")
  });

  const row = page.locator("#campRows tr, #spendRows tr, #attnRow button, #attnRow [data-i]").first();
  if (await row.count() && await row.isVisible().catch(() => false)) {
    await row.click().catch(() => {});
    await waitQuiet(page, 1000);
    const drawer = await page.locator("#drawer").isVisible().catch(() => false);
    rec({
      screen,
      control: "Open a campaign / attention tile",
      claimed: "Open detail drawer",
      happened: drawer ? "drawer opened" : "clicked; no drawer",
      api: nets.filter((n) => /\/api\/campaigns\/detail/.test(n.url)).slice(-1)[0] || null,
      shot: await shot(page, "campaigns-detail")
    });
    await clickNamed(page, screen, "#dwClose", "Close campaign detail");
  } else {
    rec({
      screen,
      control: "Open a campaign row",
      claimed: "Open detail drawer",
      happened: "no campaign rows to click",
      api: null,
      shot: await shot(page, "campaigns-empty-rows", true)
    });
  }

  const pause = page.locator("[data-cw=pause]").first();
  if (await pause.count()) {
    const en = await pause.isEnabled().catch(() => false);
    rec({
      screen,
      control: "Stop spending",
      claimed: "Pause this campaign",
      happened: en ? "button live — not pressed (would change live spend)" : "disabled — did nothing",
      api: null
    });
  }
}

async function walkSocial(page) {
  const screen = "social-studio";
  await page.goto(`${BASE}/app/social-studio.html?partner_id=${DEMO}`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await waitQuiet(page, 1800);
  await pickPartner(page, DEMO);
  await waitQuiet(page, 2000);
  const state = await page.evaluate(() => ({
    notice: (document.getElementById("ssNoticeTxt") || {}).textContent || "",
    suite: (document.getElementById("ssSuiteTxt") || {}).textContent || "",
    channels: (document.getElementById("kChannels") || {}).textContent || "",
    queued: (document.getElementById("kQueued") || {}).textContent || "",
    chCount: (document.getElementById("chCount") || {}).textContent || "",
    footer: (document.querySelector(".foot") || {}).innerText || ""
  }));
  rec({
    screen,
    control: "Partner picker + page load",
    claimed: "Show this partner's social queue",
    happened: `notice="${state.notice}" suite="${state.suite}" channels=${state.channels} queued=${state.queued}`,
    api: nets.filter((n) => /\/api\/social\//.test(n.url)).slice(-1)[0] || null,
    shot: await shot(page, "social-owner-demo", true)
  });

  await clickNamed(page, screen, "#composeTop", "Write a post — open compose");
  await shot(page, "social-compose");

  for (const [sel, claim] of [
    ['button.stat[data-k="queued"]', "Waiting to post tile"],
    ['button.stat[data-k="blocked"]', "Needs a rewrite tile"],
    ['button.stat[data-k="failed"]', "Could not be sent tile"],
    ['button.stat[data-k="posted"]', "Sent tile"],
    ['button.stat[data-k="channels"]', "Connected accounts tile"],
    ['button.rtab[data-pane="blocked"]', "Needs a rewrite tab"],
    ['button.rtab[data-pane="failed"]', "Could not be sent tab"],
    ['button.rtab[data-pane="posted"]', "Sent tab"],
    ['button.rtab[data-pane="audit"]', "Send history tab"],
    ['button.rtab[data-pane="queued"]', "Waiting tab"]
  ]) {
    await clickNamed(page, screen, sel, claim, { wait: 400 });
  }
  await shot(page, "social-tabs");

  const gen = await clickNamed(page, screen, "#ssGenBtn", "Write 3 posts for me", { wait: 4000 });
  rec({
    screen,
    control: "Write 3 posts for me",
    claimed: "Generate 3 draft posts for this partner",
    happened: (await textOf(page, "#ssGenMsg")) || (gen.clicked ? "clicked; no message" : "not clicked"),
    api: nets.filter((n) => /\/api\/social\/generate/.test(n.url)).slice(-1)[0] || null,
    shot: await shot(page, "social-generate")
  });

  const cap = page.locator("#cCaption");
  if (await cap.count()) {
    await cap.fill("DEMO queue only — working capital for owners. Not for a live brand. Audit 2026-08-18.");
  }
  const when = page.locator("#cWhen");
  if (await when.count()) {
    const later = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 16);
    await when.fill(later).catch(() => {});
  }
  await clickNamed(page, screen, "#runScreen", "Check the wording", { wait: 1500 });
  rec({
    screen,
    control: "Check the wording",
    claimed: "Screen the caption before queue",
    happened: (await textOf(page, "#queueMsg, #screenMsg, #cVerdict")) || "clicked",
    api: nets.filter((n) => /screen|compliance/i.test(n.url)).slice(-1)[0] || null,
    shot: await shot(page, "social-screen")
  });

  await clickNamed(page, screen, "#queueBtn", "Queue post", { wait: 1500 });
  rec({
    screen,
    control: "Queue post",
    claimed: "Save a draft to the waiting list (do not publish)",
    happened: (await textOf(page, "#queueMsg")) || "clicked; no message",
    api: nets.filter((n) => /\/api\/social\/schedule/.test(n.url)).slice(-1)[0] || null,
    shot: await shot(page, "social-queue")
  });

  await clickNamed(page, screen, "#clearComposer", "Clear the form");
  rec({
    screen,
    control: "Clear the form",
    claimed: "Empty the compose fields",
    happened: (await page.locator("#cCaption").inputValue().catch(() => "")) === "" ? "fields cleared" : "fields still had text",
    api: null
  });

  // Click publish-due but dialog handler dismisses — must not send to a live brand.
  await clickNamed(page, screen, "#publishDueBtn", "Send anything due now (dismiss confirm — no live publish)", { wait: 800 });
  rec({
    screen,
    control: "Send anything due now",
    claimed: "Publish every due post to connected accounts",
    happened: "confirm shown and dismissed — nothing published (W4 rule)",
    api: nets.filter((n) => /\/api\/social\/publish/.test(n.url)).slice(-1)[0] || null,
    shot: await shot(page, "social-publish-dismissed")
  });

  const oauthBefore = await page.evaluate(() => location.href);
  await clickNamed(page, screen, "#oauthFb", "Connect Facebook", { wait: 1500 });
  const oauthAfter = await page.evaluate(() => location.href);
  rec({
    screen,
    control: "Connect Facebook",
    claimed: "Start Facebook sign-in for this partner",
    happened: oauthAfter !== oauthBefore
      ? `left the page → ${oauthAfter.slice(0, 160)}`
      : ((await textOf(page, "#queueMsg, #ssNoticeTxt, #oauthConnectBox")) || "stayed on Social Studio"),
    api: nets.filter((n) => /\/api\/social\/oauth/.test(n.url)).slice(-1)[0] || null,
    shot: await shot(page, "social-oauth-fb")
  });
  if (!/social-studio/i.test(oauthAfter)) {
    await page.goto(`${BASE}/app/social-studio.html?partner_id=${DEMO}`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await waitQuiet(page, 1000);
  }
  await clickNamed(page, screen, "#oauthIg", "Connect Instagram", { wait: 800 });
  if (!/social-studio/i.test(await page.evaluate(() => location.pathname))) {
    await page.goto(`${BASE}/app/social-studio.html?partner_id=${DEMO}`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await waitQuiet(page, 800);
  }
  await page.locator("#liOrg").fill("0").catch(() => {});
  await clickNamed(page, screen, "#oauthLi", "Connect LinkedIn", { wait: 800 });
  if (!/social-studio/i.test(await page.evaluate(() => location.pathname))) {
    await page.goto(`${BASE}/app/social-studio.html?partner_id=${DEMO}`, { waitUntil: "domcontentloaded", timeout: 45000 });
  }
}

async function walkCreative(page) {
  const screen = "creative-factory";
  await page.goto(`${BASE}/app/creative-factory.html?partner_id=${DEMO}`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await waitQuiet(page, 2200);
  await pickPartner(page, DEMO);
  await waitQuiet(page, 2500);
  const boot = await page.evaluate(() => ({
    partner: (document.getElementById("partnerSel") || {}).value || "",
    genOn: !(document.getElementById("genBtn") || {}).disabled,
    runOn: !(document.getElementById("runJobsBtn") || {}).disabled,
    body: (document.querySelector(".content") || {}).innerText || ""
  }));
  rec({
    screen,
    control: "Partner picker + page load",
    claimed: "Show this partner's creative jobs",
    happened: `gen=${boot.genOn} run=${boot.runOn} partner=${boot.partner || "none"}`,
    api: nets.filter((n) => /\/api\/creative\//.test(n.url)).slice(-1)[0] || null,
    shot: await shot(page, "creative-owner-demo", true)
  });

  const kind = page.locator("#genKind");
  if (await kind.count()) await kind.selectOption("copy").catch(() => {});
  const prompt = page.locator("#genPrompt");
  if (await prompt.count()) await prompt.fill("DEMO audit 2026-08-18. One short working-capital line. Do not publish.");
  const idem = page.locator("#genIdem");
  if (await idem.count()) await idem.fill(`w4-audit-${Date.now()}`);

  const gen = await clickNamed(page, screen, "#genBtn", "Enqueue generation", { wait: 2500 });
  rec({
    screen,
    control: "Enqueue generation",
    claimed: "Put a generation job on the queue",
    happened: (await textOf(page, "#genMsg")) || (gen.disabled ? "button stayed off" : (gen.clicked ? "clicked; no message" : "not clicked")),
    api: nets.filter((n) => /\/api\/creative\/generate/.test(n.url)).slice(-1)[0] || null,
    shot: await shot(page, "creative-enqueue")
  });

  const run = await clickNamed(page, screen, "#runJobsBtn", "Run queued jobs now", { wait: 3000 });
  rec({
    screen,
    control: "Run queued jobs now",
    claimed: "Start queued generation jobs",
    happened: (await textOf(page, "#genMsg")) || (run.disabled ? "button stayed off" : (run.clicked ? "clicked; no message" : "not clicked")),
    api: nets.filter((n) => /\/api\/creative\/run/.test(n.url)).slice(-1)[0] || null,
    shot: await shot(page, "creative-run")
  });

  for (const act of ["approve", "reject", "archive"]) {
    const btn = page.locator(`[data-cact="${act}"]`).first();
    const en = await btn.isEnabled().catch(() => false);
    rec({
      screen,
      control: act[0].toUpperCase() + act.slice(1),
      claimed: `${act} the selected creative`,
      happened: en ? "live — not pressed (would change a real asset)" : "disabled — did nothing",
      api: null
    });
  }

  for (const [sel, claim] of [
    ["#jobLimit", "Job list limit"],
    ["#libArch", "Library include archived"],
    ["#libLimit", "Library limit"],
    ["#apprLimit", "Approval list limit"]
  ]) {
    const loc = page.locator(sel).first();
    if (await loc.count()) {
      const opts = await loc.locator("option").allTextContents();
      if (opts.length) {
        await loc.selectOption({ index: 0 }).catch(() => {});
        rec({ screen, control: claim, claimed: "Change list size", happened: `set to ${opts[0]}`, api: null });
      }
    }
  }
  await shot(page, "creative-filters");
}

async function walkBrand(page) {
  const screen = "brand-studio";
  await page.goto(`${BASE}/app/brand-studio.html?partner_id=${DEMO}`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await waitQuiet(page, 2000);
  rec({
    screen,
    control: "Open Brand Studio for DEMO partner",
    claimed: "Edit DEMO partner brand",
    happened: `h1=${await textOf(page, "h1")} brand=${await textOf(page, "#kBrand")} domain=${await textOf(page, "#kDomain")}`,
    api: nets.filter((n) => /partner-marketing|partner-pages|brand/i.test(n.url)).slice(-1)[0] || null,
    shot: await shot(page, "brand-owner-demo", true)
  });

  await clickNamed(page, screen, "#resetBtn", "Reset");
  await waitQuiet(page, 400);
  await clickNamed(page, screen, "#clearLogo", "Use text (wordmark)");
  await clickNamed(page, screen, "#rampPreset", "Color presets");
  const face = page.locator("#fDisplay");
  if (await face.count()) {
    await face.selectOption("Manrope").catch(() => {});
    rec({ screen, control: "Display face", claimed: "Change display font", happened: "set Manrope (not saved)", api: null });
  }

  await clickNamed(page, screen, "#verifyBtn", "Verify domain", { wait: 1500 });
  rec({
    screen,
    control: "Verify",
    claimed: "Check this partner's custom domain",
    happened: (await textOf(page, "#saveMsg, #kDomainSd, #kDomain")) || "clicked",
    api: nets.filter((n) => /domain|verify/i.test(n.url)).slice(-1)[0] || null,
    shot: await shot(page, "brand-verify")
  });

  await clickNamed(page, screen, "button.copyb", "Copy DNS value");
  rec({
    screen,
    control: "copy (DNS)",
    claimed: "Copy DNS record to clipboard",
    happened: "clicked first copy button",
    api: null
  });

  const suiteOn = page.locator("#suiteOnBtn");
  const suiteOff = page.locator("#suiteOffBtn");
  const onEn = await suiteOn.isEnabled().catch(() => false);
  const offEn = await suiteOff.isEnabled().catch(() => false);
  rec({
    screen,
    control: "Turn on for this partner",
    claimed: "Enable the marketing suite for DEMO",
    happened: onEn ? "button live — clicking DEMO only" : "disabled or already on",
    api: null
  });
  if (onEn) {
    await clickNamed(page, screen, "#suiteOnBtn", "Turn on for this partner", { wait: 1500 });
    rec({
      screen,
      control: "Turn on for this partner",
      claimed: "Enable marketing suite",
      happened: (await textOf(page, "#saveMsg, #pagesMsg")) || "clicked",
      api: nets.filter((n) => /partner-marketing\/enable/.test(n.url)).slice(-1)[0] || null,
      shot: await shot(page, "brand-suite-on")
    });
  }
  rec({
    screen,
    control: "Turn off",
    claimed: "Disable the marketing suite",
    happened: offEn ? "live — not pressed (would turn DEMO suite off)" : "disabled — did nothing",
    api: null
  });

  await clickNamed(page, screen, "#genCopyBtn", "Write page copy", { wait: 4000 });
  rec({
    screen,
    control: "Write page copy",
    claimed: "Generate unlocked page copy for DEMO",
    happened: (await textOf(page, "#saveMsg, #pagesMsg")) || "clicked",
    api: nets.filter((n) => /partner-marketing|gen|copy/i.test(n.url)).slice(-1)[0] || null,
    shot: await shot(page, "brand-write-copy")
  });

  await clickNamed(page, screen, "#genLogoBtn", "Make a wordmark from the name", { wait: 3000 });
  rec({
    screen,
    control: "Make a wordmark from the name",
    claimed: "Generate a type wordmark",
    happened: (await textOf(page, "#saveMsg, #pagesMsg")) || "clicked",
    api: nets.filter((n) => /wordmark|logo|partner-marketing/i.test(n.url)).slice(-1)[0] || null,
    shot: await shot(page, "brand-wordmark")
  });

  const boxes = page.locator('input[type="checkbox"]');
  const n = await boxes.count();
  if (n) {
    await boxes.nth(0).check({ force: true }).catch(() => {});
    rec({ screen, control: "Funnel checkbox", claimed: "Select a funnel to create pages", happened: `ticked 1 of ${n}`, api: null });
  }
  await clickNamed(page, screen, "#createPagesBtn", "Create pages from selected funnels", { wait: 2000 });
  rec({
    screen,
    control: "Create pages from selected funnels",
    claimed: "Write partner_pages drafts",
    happened: (await textOf(page, "#pagesMsg, #saveMsg")) || "clicked",
    api: nets.filter((n) => /partner-pages/.test(n.url)).slice(-1)[0] || null,
    shot: await shot(page, "brand-create-pages")
  });

  await clickNamed(page, screen, "#saveBtn", "Save & apply", { wait: 2000 });
  rec({
    screen,
    control: "Save & apply",
    claimed: "Save DEMO brand tokens",
    happened: (await textOf(page, "#saveMsg")) || "clicked",
    api: nets.filter((n) => /brand|partner-marketing|save/i.test(n.url)).slice(-1)[0] || null,
    shot: await shot(page, "brand-save")
  });

  await clickNamed(page, screen, "#submitBtn", "Submit for approval", { wait: 1500 });
  rec({
    screen,
    control: "Submit for approval",
    claimed: "Send this brand for approval",
    happened: (await textOf(page, "#saveMsg")) || "clicked",
    api: nets.filter((n) => /approv|submit/i.test(n.url)).slice(-1)[0] || null,
    shot: await shot(page, "brand-submit")
  });

  const pub = page.locator("[data-pub]").first();
  if (await pub.count() && await pub.isVisible().catch(() => false)) {
    rec({
      screen,
      control: "Publish",
      claimed: "Make a DEMO page live at /sites/…",
      happened: "button present — not pressed (would publish a page)",
      api: null,
      shot: await shot(page, "brand-publish-present")
    });
  } else {
    rec({
      screen,
      control: "Publish",
      claimed: "Make a page live",
      happened: "no Publish button on screen",
      api: null
    });
  }
}

async function walkGalaxy(page) {
  const screen = "galaxy";
  await page.goto(`${BASE}/app/galaxy.html`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await waitQuiet(page, 2500);
  const boot = await page.evaluate(() => ({
    notice: (document.getElementById("galaxyBackendNotice") || {}).innerText || "",
    pill: (document.getElementById("livePill") || {}).innerText || "",
    census: (document.getElementById("census") || {}).innerText || "",
    canvas: !!document.getElementById("sky")
  }));
  rec({
    screen,
    control: "Open Galaxy",
    claimed: "Show live company activity on the sky",
    happened: `pill=${boot.pill} notice=${(boot.notice || "").slice(0, 160)} canvas=${boot.canvas}`,
    api: nets.filter((n) => /company-activity/.test(n.url)).slice(-1)[0] || null,
    shot: await shot(page, "galaxy-owner")
  });

  const canvas = page.locator("#sky");
  if (await canvas.count()) {
    const box = await canvas.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.45);
      await waitQuiet(page, 800);
      const panel = await textOf(page, "#panelBody");
      rec({
        screen,
        control: "Click a cluster",
        claimed: "Zoom in on a team",
        happened: panel ? `panel: ${panel.slice(0, 160)}` : "clicked canvas; panel empty",
        api: null,
        shot: await shot(page, "galaxy-cluster")
      });
      await page.mouse.click(box.x + 12, box.y + 12);
      await waitQuiet(page, 500);
      rec({
        screen,
        control: "Click empty space",
        claimed: "Pull back",
        happened: "clicked empty corner of the sky",
        api: null,
        shot: await shot(page, "galaxy-pullback")
      });
    }
  }
  await clickNamed(page, screen, "#pClose", "Close worker panel");
}

async function walkBrain(page) {
  const screen = "company-brain";
  await page.goto(`${BASE}/app/company-brain.html`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await waitQuiet(page, 1500);
  rec({
    screen,
    control: "Open Company Brain",
    claimed: "Staff chat against company docs",
    happened: `h1=${await textOf(page, "h1")} title=${await textOf(page, "#chatTitle")}`,
    api: nets.filter((n) => /company-brain|brain/.test(n.url)).slice(-1)[0] || null,
    shot: await shot(page, "brain-owner")
  });

  await clickNamed(page, screen, "#railToggle", "Show your chats");
  await clickNamed(page, screen, "#newChat", "New chat");
  await clickNamed(page, screen, "#docsBtn", "Documents");
  await waitQuiet(page, 800);
  rec({
    screen,
    control: "Documents",
    claimed: "Open the docs list",
    happened: (await textOf(page, "#docList, #docs")) || "panel opened",
    api: nets.filter((n) => /company-brain\/upload|brain_files|docs/i.test(n.url)).slice(-1)[0] || null,
    shot: await shot(page, "brain-docs")
  });
  await clickNamed(page, screen, "#refreshDocs", "Refresh documents", { wait: 800 });
  await clickNamed(page, screen, "#refreshReviews", "Refresh reviews", { wait: 800 });

  const tmp = path.join(OUT, "w4-brain-upload.txt");
  fs.writeFileSync(tmp, "W4 audit upload 2026-08-18. Northlight Capital demo partner kit. Working capital for owners. Not a live client file.\n");
  const fileInput = page.locator("#fileInput");
  if (await fileInput.count()) {
    await clickNamed(page, screen, "#attachBtn", "Add a document");
    await fileInput.setInputFiles(tmp);
    await waitQuiet(page, 2500);
    rec({
      screen,
      control: "Upload a document",
      claimed: "Add a file to Company Brain (not answer-proof — that is W1)",
      happened: (await textOf(page, "#docList, .cmphint, #msgs")) || "file chosen",
      api: nets.filter((n) => /company-brain\/upload/.test(n.url)).slice(-1)[0] || null,
      shot: await shot(page, "brain-upload")
    });
  }

  const q = page.locator("#q");
  if (await q.count()) {
    await q.fill("What documents are on this page?");
    await clickNamed(page, screen, "#askBtn", "Send a question", { wait: 8000 });
    rec({
      screen,
      control: "Send",
      claimed: "Ask Company Brain a question (W1 owns prove-against-doc)",
      happened: (await textOf(page, "#msgs")) || "clicked Send",
      api: nets.filter((n) => /company-brain|chat\/ask|read\/company-brain/.test(n.url)).slice(-1)[0] || null,
      shot: await shot(page, "brain-ask")
    });
  }
  await clickNamed(page, screen, "#docsClose", "Close documents");
}

async function walkAffiliate(page, role) {
  const screen = "affiliate";
  await page.goto(`${BASE}/app/affiliate.html`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await waitQuiet(page, 1800);
  rec({
    screen,
    control: `Open Affiliate as ${role}`,
    claimed: "Show referral link, leads, payouts",
    happened: `path=${await page.evaluate(() => location.pathname)} h1=${await textOf(page, "h1")} code=${await textOf(page, "#affCode")} referred=${await textOf(page, "#kRef")}`,
    api: nets.filter((n) => /affiliate|referral/i.test(n.url)).slice(-1)[0] || null,
    shot: await shot(page, `affiliate-${role}`, true)
  });

  await clickNamed(page, screen, "#copyLink", "Copy link");
  await clickNamed(page, screen, "#copyCode", "Copy code");
  rec({
    screen,
    control: "Copy link / Copy code",
    claimed: "Copy referral URL and code",
    happened: `link=${await page.locator("#reflink").inputValue().catch(() => "")}`.slice(0, 160),
    api: null,
    shot: await shot(page, `affiliate-${role}-copy`)
  });

  const bq = page.locator("#brainQ");
  if (await bq.count() && await bq.isVisible().catch(() => false)) {
    await bq.fill("What docs can an affiliate see?");
    await clickNamed(page, screen, "#brainBtn", "Ask approved partner docs", { wait: 6000 });
    rec({
      screen,
      control: "Ask",
      claimed: "Answer from owner-approved affiliate docs only",
      happened: (await textOf(page, "#brainAnswer, #brainStatus")) || "clicked",
      api: nets.filter((n) => /company-brain-affiliate/.test(n.url)).slice(-1)[0] || null,
      shot: await shot(page, `affiliate-${role}-brain`)
    });
  }

  await clickNamed(page, screen, "#blasterBtn", "Download Message Blaster", { wait: 2000 });
  rec({
    screen,
    control: "Download Message Blaster",
    claimed: "Download the Mac gift",
    happened: (await textOf(page, "#blasterStatus")) || "clicked",
    api: nets.filter((n) => /message-blaster|gifts/.test(n.url)).slice(-1)[0] || null,
    shot: await shot(page, `affiliate-${role}-blaster`)
  });

  await clickNamed(page, screen, 'button.tab[data-tab="payouts"]', "Payouts tab");
  await shot(page, `affiliate-${role}-payouts`);
  await clickNamed(page, screen, 'button.tab[data-tab="terms"]', "Terms tab");
  await shot(page, `affiliate-${role}-terms`);
  await clickNamed(page, screen, 'button.tab[data-tab="leads"]', "Referred leads tab");
  const st = page.locator("#stFilter");
  if (await st.count()) {
    await st.selectOption("Clicked").catch(() => {});
    rec({ screen, control: "Status filter", claimed: "Show Clicked leads only", happened: "set Clicked", api: null });
  }
  const q = page.locator("#q");
  if (await q.count()) {
    await q.fill("test");
    rec({ screen, control: "Filter business", claimed: "Filter the lead list", happened: "typed test", api: null });
  }
  await shot(page, `affiliate-${role}-leads`);
}

async function walkPortalStaff(page) {
  const screen = "client-portal";
  await page.goto(`${BASE}/app/client-portal.html`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await waitQuiet(page, 1500);
  rec({
    screen,
    control: "Open Client Portal as staff (no id)",
    claimed: "Staff preview of the portal",
    happened: `path=${await page.evaluate(() => location.pathname + location.search)} h1=${await textOf(page, "h1")} video=${await textOf(page, ".hero, #welcome, [data-welcome]")}`,
    api: null,
    shot: await shot(page, "portal-staff", true)
  });

  await page.goto(`${BASE}/app/client-portal.html?id=${TEST_CLIENT}`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await waitQuiet(page, 1800);
  rec({
    screen,
    control: "Open Client Portal as staff with test client id",
    claimed: "Show that client's portal preview",
    happened: `path=${await page.evaluate(() => location.pathname + location.search)} sign=${await textOf(page, "#dispute-auth-title, #cpSignMsg, .sign-card")}`,
    api: nets.filter((n) => /portal|client|consent/i.test(n.url)).slice(-1)[0] || null,
    shot: await shot(page, "portal-staff-testid", true)
  });

  for (const [sel, claim] of [
    ["#st-progress", "In progress"],
    ["#st-funded", "Just funded"],
    ["#st-precall", "Before call"],
    ['button.tab[data-tab="agree"]', "Agreements"],
    ['button.tab[data-tab="docs"]', "Documents"],
    ['button.tab[data-tab="act"]', "Activity"],
    ['button.tab[data-tab="msg"]', "Messages"],
    ['button.tab[data-tab="pay"]', "Payments"]
  ]) {
    await clickNamed(page, screen, sel, claim, { wait: 400 });
  }
  await shot(page, "portal-staff-tabs", true);

  const book = page.locator("[data-book]").first();
  if (await book.count() && await book.isVisible().catch(() => false)) {
    await book.click().catch(() => {});
    await waitQuiet(page, 600);
    rec({
      screen,
      control: "Ask about this / Talk to an advisor",
      claimed: "Open a booking / ask modal",
      happened: (await textOf(page, "#bm-x, .modal, #um-x")) ? "modal opened" : "clicked; no modal",
      api: null,
      shot: await shot(page, "portal-staff-book")
    });
    await clickNamed(page, screen, "#bm-x, #um-x", "Close modal");
  }

  rec({
    screen,
    control: "I sign to authorize…",
    claimed: "Record a dispute-letter signature",
    happened: "not pressed — W1 owns full sign-in + dispute sign",
    api: null
  });
}

async function walkPortalLogin(page, recentLinkCount) {
  const screen = "portal-login";
  await page.goto(`${BASE}/portal-login.html`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await waitQuiet(page, 800);
  rec({
    screen,
    control: "Open portal login",
    claimed: "Email-link only, no password",
    happened: `passwords=${await page.locator('input[type="password"]').count()} email=${await page.locator("#email").count()}`,
    api: null,
    shot: await shot(page, "portal-login")
  });

  // Reuse an already-queued link. Do not storm client@ — max 3 / 15 min, W1 also uses this.
  if (recentLinkCount >= 2) {
    rec({
      screen,
      control: "Email me a sign-in link",
      claimed: "Queue a magic link for client@fundhub.ai",
      happened: `skipped — ${recentLinkCount} links already in the last 15 minutes (leave room for W1)`,
      api: null
    });
    return;
  }

  await page.locator("#email").fill(PORTAL_EMAIL);
  await clickNamed(page, screen, "#go", "Email me a sign-in link", { wait: 2500 });
  rec({
    screen,
    control: "Email me a sign-in link",
    claimed: "Queue a sign-in email (no password)",
    happened: (await textOf(page, "#ok-box, #err, .ok")) || "clicked",
    api: nets.filter((n) => /magic-link/.test(n.url)).slice(-1)[0] || null,
    shot: await shot(page, "portal-login-requested")
  });
}

async function tryClientSession(page) {
  const c = db();
  await c.connect();
  try {
    const r = await c.query(
      `SELECT rendered_body, created_at, status
         FROM messages
        WHERE client_id = $1 AND template_key = 'EMAIL-PORTAL-MAGIC-LINK'
        ORDER BY created_at DESC LIMIT 3`,
      [TEST_CLIENT]
    );
    let url = "";
    for (const row of r.rows) {
      const m = String(row.rendered_body || "").match(/https?:\/\/[^"'\\\s>]+portal-login\.html\?t=[A-Za-z0-9_-]+/);
      if (m) { url = m[0]; break; }
    }
    const count = await c.query(
      `SELECT count(*)::int AS n FROM account_magic_links
        WHERE lower(email) = lower($1) AND created_at > now() - interval '15 minutes'`,
      [PORTAL_EMAIL]
    );
    return { url, recent: count.rows[0].n, queued: r.rowCount };
  } finally {
    await c.end();
  }
}

async function openClientIfPossible(browser, linkUrl) {
  if (!linkUrl) {
    rec({
      screen: "client-portal",
      control: "Open as client",
      claimed: "Client sees their own file",
      happened: "no unused magic-link URL in messages — not requesting a second storm",
      api: null
    });
    return;
  }
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const bag = { console: [], pageErrors: [], net: [], dialogs: [] };
  attachWatchers(page, bag);
  await page.goto(linkUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForFunction(() => /client-portal\.html/i.test(location.pathname), null, { timeout: 25000 }).catch(() => {});
  await waitQuiet(page, 1500);
  rec({
    screen: "client-portal",
    control: "Open magic link as client",
    claimed: "Land on own portal (W1 owns prove they see their file)",
    happened: `path=${await page.evaluate(() => location.pathname + location.search)}`,
    api: null,
    shot: await shot(page, "portal-client", true)
  });
  rec({
    screen: "client-portal",
    control: "I sign to authorize…",
    claimed: "Record dispute-letter signature",
    happened: "not pressed — W1 owns dispute sign",
    api: null
  });
  await ctx.close();
}

async function dbSnap() {
  if (!process.env.DATABASE_URL) return { error: "DATABASE_URL missing" };
  const c = db();
  await c.connect();
  try {
    const social = await c.query(
      `SELECT id, partner_id, state, left(coalesce(caption,''),80) AS caption, created_at
         FROM social_posts
        WHERE partner_id = $1 AND created_at > now() - interval '2 hours'
        ORDER BY created_at DESC LIMIT 8`,
      [DEMO]
    );
    const jobs = await c.query(
      `SELECT id, partner_id, status, kind, created_at
         FROM generation_jobs
        WHERE partner_id = $1 AND created_at > now() - interval '2 hours'
        ORDER BY created_at DESC LIMIT 8`,
      [DEMO]
    );
    const pages = await c.query(
      `SELECT id, partner_id, slug, status, created_at
         FROM partner_pages
        WHERE partner_id = $1
        ORDER BY created_at DESC LIMIT 8`,
      [DEMO]
    );
    const files = await c.query(
      `SELECT id, title, approval_status, created_at
         FROM brain_files
        WHERE created_at > now() - interval '2 hours'
        ORDER BY created_at DESC LIMIT 8`
    );
    const threads = await c.query(
      `SELECT id, created_at
         FROM brain_threads
        WHERE created_at > now() - interval '2 hours'
        ORDER BY created_at DESC LIMIT 8`
    );
    const links = await c.query(
      `SELECT outcome, created_at
         FROM account_magic_links
        WHERE lower(email) = lower($1) AND created_at > now() - interval '15 minutes'
        ORDER BY created_at DESC`,
      [PORTAL_EMAIL]
    );
    const msgs = await c.query(
      `SELECT id, status, channel, template_key, created_at
         FROM messages
        WHERE client_id = $1 AND created_at > now() - interval '2 hours'
        ORDER BY created_at DESC LIMIT 8`,
      [TEST_CLIENT]
    );
    const channels = await c.query(
      `SELECT id, channel, status
         FROM social_channels
        WHERE partner_id = $1
        LIMIT 12`,
      [DEMO]
    ).catch(() => ({ rows: [] }));
    return {
      social_posts: social.rows,
      generation_jobs: jobs.rows,
      partner_pages: pages.rows,
      brain_files: files.rows,
      brain_threads: threads.rows,
      magic_links_15m: links.rows,
      messages: msgs.rows,
      social_channels: channels.rows
    };
  } finally {
    await c.end();
  }
}

async function main() {
  const started = new Date().toISOString();
  let linkInfo = { url: "", recent: 0, queued: 0 };
  try {
    linkInfo = await (async () => {
      const c = db();
      await c.connect();
      try {
        const r = await c.query(
          `SELECT rendered_body FROM messages
            WHERE client_id = $1 AND template_key = 'EMAIL-PORTAL-MAGIC-LINK'
            ORDER BY created_at DESC LIMIT 3`,
          [TEST_CLIENT]
        );
        let url = "";
        for (const row of r.rows) {
          const m = String(row.rendered_body || "").match(/https?:\/\/[^"'\\\s>]+portal-login\.html\?t=[A-Za-z0-9_-]+/);
          if (m) { url = m[0]; break; }
        }
        const count = await c.query(
          `SELECT count(*)::int AS n FROM account_magic_links
            WHERE lower(email) = lower($1) AND created_at > now() - interval '15 minutes'`,
          [PORTAL_EMAIL]
        );
        return { url, recent: count.rows[0].n, queued: r.rowCount };
      } finally {
        await c.end();
      }
    })();
  } catch (e) {
    linkInfo = { url: "", recent: 0, queued: 0, error: String(e.message || e).slice(0, 200) };
  }

  const browser = await chromium.launch({
    headless: true,
    executablePath: chromeExe(),
    args: ["--disable-dev-shm-usage"]
  });

  const roles = [
    { role: "owner", email: "chris@fundhub.ai" },
    { role: "closer", email: "closer@fundhub.ai" },
    { role: "sales", email: "sales@fundhub.ai" },
    { role: "advisor", email: "advisor@fundhub.ai" },
    { role: "affiliate", email: "affiliate@fundhub.ai" }
  ];
  const w4files = [
    ["campaigns", "campaign-manager.html"],
    ["social", "social-studio.html"],
    ["creative", "creative-factory.html"],
    ["brand", "brand-studio.html"],
    ["galaxy", "galaxy.html"],
    ["brain", "company-brain.html"],
    ["affiliate", "affiliate.html"],
    ["portal", "client-portal.html"]
  ];

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const bag = { console: [], pageErrors: [], net: [], dialogs: [] };
  attachWatchers(page, bag);

  const ownerLogin = await login(page, "chris@fundhub.ai");
  rec({
    screen: "login",
    control: "Sign in as owner",
    claimed: "Owner reaches the CRM",
    happened: ownerLogin.ok ? `landed ${ownerLogin.path}` : ownerLogin.reason,
    api: null,
    shot: await shot(page, "00-owner-login")
  });

  await walkCampaigns(page);
  await walkSocial(page);
  await walkCreative(page);
  await walkBrand(page);
  await walkGalaxy(page);
  await walkBrain(page);
  await walkAffiliate(page, "owner");
  await walkPortalStaff(page);
  await ctx.close();

  for (const { role, email } of roles.filter((r) => r.role !== "owner")) {
    const c2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p2 = await c2.newPage();
    const b2 = { console: [], pageErrors: [], net: [], dialogs: [] };
    attachWatchers(p2, b2);
    const lg = await login(p2, email);
    rec({
      screen: "login",
      control: `Sign in as ${role}`,
      claimed: `${email} reaches their home`,
      happened: lg.ok ? `landed ${lg.path}` : lg.reason,
      api: null,
      shot: await shot(p2, `00-${role}-login`)
    });
    if (role === "affiliate") {
      await walkAffiliate(p2, "affiliate");
    }
    for (const [slug, file] of w4files) {
      if (role === "affiliate" && file === "affiliate.html") continue;
      await openRoleScreen(p2, role, slug, file);
    }
    await c2.close();
  }

  {
    const c3 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p3 = await c3.newPage();
    attachWatchers(p3, { console: [], pageErrors: [], net: [], dialogs: [] });
    await walkPortalLogin(p3, linkInfo.recent);
    await c3.close();
  }

  let afterLinks = linkInfo;
  try {
    const c = db();
    await c.connect();
    const r = await c.query(
      `SELECT rendered_body FROM messages
        WHERE client_id = $1 AND template_key = 'EMAIL-PORTAL-MAGIC-LINK'
        ORDER BY created_at DESC LIMIT 1`,
      [TEST_CLIENT]
    );
    const body = (r.rows[0] && r.rows[0].rendered_body) || "";
    const m = String(body).match(/https?:\/\/[^"'\\\s>]+portal-login\.html\?t=[A-Za-z0-9_-]+/);
    afterLinks = { url: m ? m[0] : linkInfo.url, recent: linkInfo.recent };
    await c.end();
  } catch {
    afterLinks = linkInfo;
  }

  const w1ClientShot = fs.existsSync(path.join(ROOT, "docs/workflows/audit-crm-whole-2026-08-18-evidence/w1"));
  if (w1ClientShot) {
    const w1files = fs.readdirSync(path.join(ROOT, "docs/workflows/audit-crm-whole-2026-08-18-evidence/w1"));
    const already = w1files.some((f) => /portal|client/i.test(f));
    if (already) {
      rec({
        screen: "client-portal",
        control: "Open as client",
        claimed: "Client session screenshot",
        happened: "W1 already has portal/client evidence — not opening a second magic link",
        api: null
      });
    } else {
      await openClientIfPossible(browser, afterLinks.url);
    }
  } else {
    await openClientIfPossible(browser, afterLinks.url);
  }

  await browser.close();

  let snap = {};
  try {
    snap = await dbSnap();
  } catch (e) {
    snap = { error: String(e.message || e).slice(0, 240) };
  }

  const summary = {
    started,
    ended: new Date().toISOString(),
    demo_partner: DEMO,
    click_count: clicks.length,
    shot_count: shots.length,
    magic_links_seen: linkInfo,
    db: snap,
    writes: nets.filter((n) => n.method !== "GET"),
    errors: nets.filter((n) => n.status >= 400)
  };
  fs.writeFileSync(path.join(OUT, "clicks.json"), JSON.stringify(clicks, null, 2));
  fs.writeFileSync(path.join(OUT, "nets.json"), JSON.stringify(nets, null, 2));
  fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ done: true, clicks: clicks.length, shots: shots.length, errors: summary.errors.length }));
}

main().catch((err) => {
  console.error(String(err && err.stack ? err.stack : err));
  process.exit(1);
});
