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

async function shot(page, slug, full = false) {
  const file = path.join(OUT, `${slug}.png`);
  await page.screenshot({ path: file, fullPage: full });
  return path.relative(ROOT, file);
}

const notes = [];
function rec(row) { notes.push(row); console.log(JSON.stringify(row)); }

const browser = await chromium.launch({
  headless: true,
  executablePath: chromeExe()
});
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
rec({ step: "login", url: page.url() });

// Documents — after both signs
await page.goto(BASE + "/app/documents.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(2500);
const docsBody = await page.locator("body").innerText();
rec({
  step: "documents",
  shot: await shot(page, "after-documents", true),
  hasSigned: /signed/i.test(docsBody),
  hasFunding: /FUNDING-AGREEMENT|Funding Agreement/i.test(docsBody),
  hasSoft: /SOFT-PULL|Soft Pull/i.test(docsBody)
});

// Pipeline — after funding sign (protected file card)
await page.goto(BASE + "/app/pipeline.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(2500);
rec({
  step: "pipeline",
  shot: await shot(page, "after-pipeline", true)
});

// CCP test client — soft-pull consent contract was signed
await page.goto(BASE + `/app/client-control-panel.html?client=${TEST_CLIENT}`, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(3000);
const ccpTest = await page.locator("body").innerText();
const pullBtns = page.locator("button, a, [role=button]");
const pullLabels = [];
const n = await pullBtns.count();
for (let i = 0; i < Math.min(n, 80); i++) {
  const t = (await pullBtns.nth(i).innerText().catch(() => "")).trim();
  if (/transunion|experian|equifax|soft.?pull|inquiry|letter|generate/i.test(t)) {
    pullLabels.push({
      text: t.slice(0, 80),
      disabled: await pullBtns.nth(i).isDisabled().catch(() => null)
    });
  }
}
rec({
  step: "ccp-test",
  shot: await shot(page, "after-ccp-test", true),
  pullLabels,
  mentionsConsent: /consent/i.test(ccpTest)
});

// CCP protected — READ ONLY. Do not click write controls.
await page.goto(BASE + `/app/client-control-panel.html?client=${PROT}`, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(3000);
rec({
  step: "ccp-protected-readonly",
  shot: await shot(page, "after-ccp-protected", true)
});

// Documents filtered / contracts tab if present
await page.goto(BASE + "/app/documents.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(1500);
const tab = page.getByRole("button", { name: /contracts/i }).or(page.getByText(/^CONTRACTS$/i)).first();
if (await tab.count()) {
  await tab.click().catch(() => {});
  await page.waitForTimeout(1200);
}
rec({
  step: "documents-contracts-tab",
  shot: await shot(page, "after-documents-contracts", true)
});

// Portal dispute card as staff-with-testid (unsigned expected)
await page.goto(BASE + `/app/client-portal.html?client_id=${TEST_CLIENT}`, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(2500);
const portal = await page.locator("body").innerText();
rec({
  step: "portal-test",
  shot: await shot(page, "after-portal-test", true),
  disputeCard: /authorize dispute|dispute letter/i.test(portal),
  signIn: /sign in/i.test(portal)
});

await browser.close();
fs.writeFileSync(path.join(OUT, "shots.json"), JSON.stringify({ at: new Date().toISOString(), notes }, null, 2));
console.log("wrote shots.json");
