#!/usr/bin/env node
/** Part A nav prove: owner / closer / sales_manager menus at 1440, before (live) and after (live + local shell.js). */
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  ROOT, BASE, launchBrowser, staffLogin, staffPassword
} from "../_lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = join(HERE, "shots/_raw");
const SHOTS = join(HERE, "shots");
const LOCAL_SHELL = join(ROOT, "public/app/shell.js");
const LOCAL_CSS = join(ROOT, "public/app/crm-sidebar.css");

mkdirSync(RAW, { recursive: true });
mkdirSync(SHOTS, { recursive: true });

const ROLES = [
  { id: "owner", email: "chris@fundhub.ai" },
  { id: "closer", email: "closer@fundhub.ai" },
  { id: "sales_manager", email: "sales@fundhub.ai" }
];

async function expandGroups(page) {
  await page.evaluate(() => {
    document.querySelectorAll(".navgroup").forEach((g) => g.classList.remove("closed"));
  });
  await page.waitForTimeout(250);
}

async function visibleNav(page) {
  return page.evaluate(() => {
    const groups = [];
    for (const g of document.querySelectorAll(".navgroup")) {
      const cs = window.getComputedStyle(g);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const head = (g.querySelector(".navhead")?.innerText || "").replace("▾", "").trim();
      const hrefs = [];
      for (const a of g.querySelectorAll("a.navitem")) {
        const s = window.getComputedStyle(a);
        if (s.display === "none" || a.hasAttribute("data-fh-gated")) continue;
        const href = (a.getAttribute("data-fh-href") || a.getAttribute("href") || "").split("?")[0];
        const lbl = (a.querySelector(".lbl")?.innerText || a.innerText || "").trim();
        const beta = !!a.querySelector(".beta-badge");
        hrefs.push({ href, lbl, beta });
      }
      groups.push({ head, hrefs });
    }
    const chip = (document.getElementById("fh-shell-chip")?.innerText || "").replace(/\s+/g, " ").trim();
    return { chip, groups };
  });
}

async function boxOf(page, sel) {
  const loc = page.locator(sel).first();
  if ((await loc.count()) === 0) return null;
  const visible = await loc.isVisible().catch(() => false);
  if (!visible) return null;
  const b = await loc.boundingBox();
  if (!b || b.width < 2 || b.height < 2) return null;
  return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
}

async function interceptNav(context) {
  await context.route(/\/app\/shell\.js(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/javascript; charset=utf-8",
      body: readFileSync(LOCAL_SHELL),
      headers: { "cache-control": "no-store" }
    });
  });
  await context.route(/\/app\/crm-sidebar\.css(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/css; charset=utf-8",
      body: readFileSync(LOCAL_CSS),
      headers: { "cache-control": "no-store" }
    });
  });
}

async function capture(browser, role, phase, intercept) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  if (intercept) await interceptNav(context);
  const page = await context.newPage();
  const landed = await staffLogin(page, role.email);
  await page.goto(`${BASE}/app/pipeline.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("#fh-shell-chip, aside.side", { timeout: 30000 });
  await page.waitForTimeout(1500);
  await expandGroups(page);
  const nav = await visibleNav(page);
  const name = `nav-${role.id}-${phase}-1440`;
  const raw = join(RAW, `${name}.png`);
  await page.screenshot({ path: raw, fullPage: false });
  const marks = [];
  const add = async (n, caption, sel) => {
    const box = await boxOf(page, sel);
    if (box) marks.push({ n: String(n), caption, box });
  };
  if (phase === "before") {
    await add(1, "Client Control Panel is under Client ops", 'a.navitem[href="client-control-panel.html"], a.navitem[href*="client-control-panel.html"]');
    await add(2, "Agent Editor is still in the menu", 'a.navitem[href="agent-editor.html"], a.navitem[href*="agent-editor.html"]');
    await add(3, "Marketing group header", '.navgroup[data-fh-section="marketing"] .navhead');
    await add(4, "BETA tag on a menu row", ".beta-badge");
  } else {
    await add(1, "Client Control Panel now sits under Funding, after Lenders", 'a.navitem[href="client-control-panel.html"], a.navitem[href*="client-control-panel.html"]');
    await add(2, "Funding group (Lenders then Client Control Panel)", '.navgroup[data-fh-section="funding"]');
    await add(3, "Client ops no longer holds Client Control Panel", '.navgroup[data-fh-section="client-ops"]');
    await add(4, "Automation group — Agent Editor gone from the menu", '.navgroup[data-fh-section="automation"]');
  }
  await context.close();
  return { role: role.id, email: role.email, phase, landed, nav, raw: `shots/_raw/${name}.png`, file: `${name}.png`, marks };
}

function writeManifest(rows) {
  const spec = {};
  for (const r of rows) {
    spec[r.file] = {
      legend: `${r.role} menu ${r.phase} (1440)`,
      marks: r.marks
    };
  }
  writeFileSync(join(HERE, "shot-marks.json"), JSON.stringify(spec, null, 2));
  const py = join(HERE, "_apply-marks.py");
  const run = spawnSync("python3", [py], { cwd: HERE, encoding: "utf8" });
  return { stdout: run.stdout, stderr: run.stderr, status: run.status };
}

const pw = staffPassword();
if (!pw) throw new Error("STAFF_E2E_PASSWORD missing");

const browser = await launchBrowser();
const rows = [];
try {
  for (const role of ROLES) {
    rows.push(await capture(browser, role, "before", false));
  }
  for (const role of ROLES) {
    rows.push(await capture(browser, role, "after", true));
  }
} finally {
  await browser.close();
}

const dump = rows.map((r) => ({
  role: r.role,
  phase: r.phase,
  landed: r.landed,
  chip: r.nav.chip,
  groups: r.nav.groups,
  hrefs: r.nav.groups.flatMap((g) => g.hrefs.map((h) => h.href)),
  betas: r.nav.groups.flatMap((g) => g.hrefs.filter((h) => h.beta).map((h) => h.href)),
  shot: r.raw,
  markCount: r.marks.length
}));
writeFileSync(join(HERE, "nav-prove.json"), JSON.stringify(dump, null, 2));
const marked = writeManifest(rows);
console.log(JSON.stringify({ ok: true, rows: dump.map((d) => ({
  role: d.role, phase: d.phase, hrefs: d.hrefs, betas: d.betas, chip: d.chip?.slice(0, 80)
})), marked }, null, 2));
