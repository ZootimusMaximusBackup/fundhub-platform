/**
 * Layout audit evidence. Read-only. Measures live CRM page width / gutter / sidebar.
 * Does not click writes. Does not print secrets.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-crm-whole-2026-08-18-evidence/w-layout");
const BASE = "https://fundhub.ai";
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

const cred = process.env.STAFF_E2E_PASSWORD || process.env.STAFF_INITIAL_PASSWORD || "";
if (!cred) throw new Error("STAFF_E2E_PASSWORD missing");
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

const PAGES = [
  { label: "Home", path: "/app/partner-galaxy.html" },
  { label: "Pipeline", path: "/app/pipeline.html" },
  { label: "Closer Dashboard", path: "/app/closer-dashboard.html" },
  { label: "Call cockpit", path: `/app/closer-call.html?client_id=${TEST_CLIENT}` },
  { label: "My numbers", path: "/app/my-numbers.html" },
  { label: "Sales floor", path: "/app/sales-floor.html" },
  { label: "Calendar", path: "/app/calendar.html" },
  { label: "Lenders", path: "/app/lenders.html" },
  { label: "Finance OS", path: "/app/finance-os.html" },
  { label: "Client Control Panel", path: `/app/client-control-panel.html?id=${TEST_CLIENT}` },
  { label: "Messaging", path: "/app/messaging.html" },
  { label: "Documents", path: "/app/documents.html" },
  { label: "Specialist", path: "/app/inquiry-remover.html" },
  { label: "Company Brain", path: "/app/company-brain.html" },
  { label: "Galaxy", path: "/app/galaxy.html" },
  { label: "Ops & Admin", path: "/app/ops-admin.html" },
  { label: "Agent Editor", path: "/app/agent-editor.html" },
  { label: "Workflows", path: "/app/automations.html" },
  { label: "Journeys", path: "/app/journeys.html" },
  { label: "Message Copy", path: "/app/template-editor.html" },
  { label: "Campaigns", path: "/app/campaign-manager.html" },
  { label: "Social Studio", path: "/app/social-studio.html" },
  { label: "Creative Factory", path: "/app/creative-factory.html" },
  { label: "Staff & Teams", path: "/app/staff-teams.html" },
  { label: "Hiring", path: "/app/hiring.html" },
  { label: "Products & Commissions", path: "/app/products-commissions.html" },
  { label: "Contract templates", path: "/app/contracts.html" },
  { label: "Brand Studio", path: "/app/brand-studio.html" },
  { label: "Client Portal", path: `/app/client-portal.html?client_id=${TEST_CLIENT}` },
  { label: "Affiliate", path: "/app/affiliate.html" },
  { label: "Present", path: `/app/present.html?contact=${TEST_CLIENT}` }
];

const SHOTS = new Set(["Staff & Teams", "Pipeline", "Sales floor", "Client Control Panel"]);

function measureFn() {
  const side = document.querySelector("aside.side, aside#side, .side#side");
  const sideCs = side ? getComputedStyle(side) : null;
  const sideBox = side ? side.getBoundingClientRect() : null;
  const sidebar = !!(side && sideBox && sideBox.width > 8 && sideCs.display !== "none" && sideCs.visibility !== "hidden");
  const app = document.querySelector(".app, .app-shell");
  const sels = [
    ".content.fh-maxw",
    "main.fh-maxw",
    ".shell.fh-maxw",
    ".page.fh-maxw",
    "#fosWrap",
    ".content",
    ".shell",
    ".page",
    ".cc-wrap",
    ".wrap",
    "main",
    ".canvas",
    ".main-col"
  ];
  let el = null;
  let sel = null;
  for (const s of sels) {
    const hit = document.querySelector(s);
    if (hit) {
      el = hit;
      sel = s;
      break;
    }
  }
  const cs = el ? getComputedStyle(el) : null;
  const box = el ? el.getBoundingClientRect() : null;
  return {
    href: location.pathname + location.search,
    title: document.title,
    vw: window.innerWidth,
    vh: window.innerHeight,
    fhMaxw: getComputedStyle(document.documentElement).getPropertyValue("--fh-maxw").trim(),
    sidebar,
    sidebarW: sidebar ? Math.round(sideBox.width) : 0,
    appPadL: app ? getComputedStyle(app).paddingLeft : "none",
    wrapSel: sel,
    maxWidth: cs ? cs.maxWidth : null,
    paddingLeft: cs ? cs.paddingLeft : null,
    paddingRight: cs ? cs.paddingRight : null,
    marginLeft: cs ? cs.marginLeft : null,
    marginRight: cs ? cs.marginRight : null,
    wrapW: box ? Math.round(box.width) : null,
    wrapX: box ? Math.round(box.x) : null
  };
}

async function login(page) {
  await page.goto(BASE + "/login.html", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.locator('input[type="email"], #email, input[name="email"]').first().fill("chris@fundhub.ai");
  await page.locator('input[type="password"], #password, input[name="password"]').first().fill(cred);
  await page.locator('button[type="submit"], button:has-text("Sign"), button:has-text("Log")').first().click();
  await page.waitForFunction(() => !/login\.html|portal-login\.html/i.test(location.pathname), null, { timeout: 30000 });
  await page.waitForTimeout(600);
}

async function run() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: chromeExe()
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await login(page);

  const rows = [];
  for (const view of [
    { name: "1440", w: 1440, h: 900 },
    { name: "2560", w: 2560, h: 1400 },
    { name: "390", w: 390, h: 844 }
  ]) {
    await page.setViewportSize({ width: view.w, height: view.h });
    for (const item of PAGES) {
      await page.goto(BASE + item.path, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(700);
      const m = await page.evaluate(measureFn);
      m.label = item.label;
      m.view = view.name;
      rows.push(m);
      if (SHOTS.has(item.label)) {
        const slug = item.label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        await page.screenshot({
          path: path.join(OUT, `${slug}-${view.name}.png`),
          fullPage: false
        });
      }
    }
  }

  fs.writeFileSync(path.join(OUT, "measure.json"), JSON.stringify({ when: new Date().toISOString(), rows }, null, 2));
  await browser.close();
  console.log("wrote", rows.length, "rows");
}

run().catch((err) => {
  console.error(String(err && err.message ? err.message : err));
  process.exit(1);
});
