import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-crm-whole-2026-08-18-evidence/w10");
const BASE = "https://fundhub.ai";
const TEST_CLIENT = "8556bedc-46e1-4d85-b0cd-a24adfee1521";
const PROT = "9af65808-a619-4e65-ae91-239766a006b7";

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

async function shot(page, slug, full = true) {
  const file = path.join(OUT, `${slug}.png`);
  await page.screenshot({ path: file, fullPage: full });
  return path.relative(ROOT, file);
}

async function waitQuiet(page, ms = 4000) {
  await page.waitForTimeout(ms);
  await page.waitForFunction(() => {
    const t = (document.body && document.body.innerText) || "";
    return !/loading (sales|documents|pipeline)/i.test(t);
  }, null, { timeout: 20000 }).catch(() => {});
}

const notes = [];
const browser = await chromium.launch({ headless: true, executablePath: chromeExe() });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });

await page.goto(BASE + "/login.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(800);
if (/login\.html/i.test(page.url())) {
  await page.locator('input[type="email"], #email').first().fill("chris@fundhub.ai");
  const pass = page.locator('input[type="password"], #password').first();
  if (await pass.count()) await pass.fill(PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForFunction(() => !/login\.html/i.test(location.pathname), null, { timeout: 30000 });
}

await page.goto(BASE + "/app/documents.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await waitQuiet(page, 5000);
const pending = page.getByText(/PENDING ONLY/i).first();
if (await pending.count()) {
  const on = await pending.evaluate((el) => /on|active|checked/i.test(el.className + " " + (el.getAttribute("aria-pressed") || "")));
  notes.push({ pendingToggle: true, looksOn: on });
}
notes.push({
  step: "documents-loaded",
  shot: await shot(page, "after-documents"),
  bodyHint: (await page.locator("body").innerText()).slice(0, 400)
});

const contractsTab = page.getByText(/^CONTRACTS$/i).first();
if (await contractsTab.count()) {
  await contractsTab.click();
  await waitQuiet(page, 2500);
}
notes.push({
  step: "documents-contracts",
  shot: await shot(page, "after-documents-contracts")
});

await page.goto(BASE + "/app/pipeline.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await waitQuiet(page, 6000);
notes.push({
  step: "pipeline-loaded",
  shot: await shot(page, "after-pipeline"),
  bodyHint: (await page.locator("body").innerText()).slice(0, 300)
});

await page.goto(BASE + `/app/client-control-panel.html?id=${TEST_CLIENT}`, { waitUntil: "domcontentloaded", timeout: 45000 });
await waitQuiet(page, 5000);
const ccpTest = await page.locator("body").innerText();
const btns = [];
const loc = page.locator("button");
const n = await loc.count();
for (let i = 0; i < Math.min(n, 100); i++) {
  const t = (await loc.nth(i).innerText().catch(() => "")).trim();
  if (/transunion|experian|equifax|generate apps|inquiry removal/i.test(t)) {
    btns.push({ text: t.replace(/\s+/g, " ").slice(0, 60), disabled: await loc.nth(i).isDisabled() });
  }
}
notes.push({
  step: "ccp-test-open",
  shot: await shot(page, "after-ccp-test"),
  hasChoose: /Choose a client|No client open/i.test(ccpTest),
  btns,
  footer: (ccpTest.match(/live file[^\n]*/i) || [])[0] || null
});

await page.goto(BASE + `/app/client-control-panel.html?id=${PROT}`, { waitUntil: "domcontentloaded", timeout: 45000 });
await waitQuiet(page, 5000);
const ccpP = await page.locator("body").innerText();
notes.push({
  step: "ccp-protected-open-readonly",
  shot: await shot(page, "after-ccp-protected"),
  hasChoose: /Choose a client|No client open/i.test(ccpP),
  stageHint: (ccpP.match(/MAIN STATUS[\s\S]{0,40}/) || [])[0] || null,
  footer: (ccpP.match(/live file[^\n]*/i) || [])[0] || null
});

await page.goto(BASE + `/app/client-portal.html?client_id=${TEST_CLIENT}`, { waitUntil: "domcontentloaded", timeout: 45000 });
await waitQuiet(page, 4000);
const portal = await page.locator("body").innerText();
notes.push({
  step: "portal-test",
  shot: await shot(page, "after-portal-test"),
  entitlements: (portal.match(/live entitlements[^\n]*/i) || [])[0] || null,
  docs: (portal.match(/live documents[^\n]*/i) || [])[0] || null,
  agreements: (portal.match(/live agreements[^\n]*/i) || [])[0] || null,
  dispute: /Sign to authorize dispute/i.test(portal)
});

await browser.close();
fs.writeFileSync(path.join(OUT, "shots2.json"), JSON.stringify({ at: new Date().toISOString(), notes }, null, 2));
console.log(JSON.stringify(notes, null, 2));
