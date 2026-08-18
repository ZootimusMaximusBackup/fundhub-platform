/**
 * U5 — bureau pull on TEST file only. Evidence only.
 * Never opens the live credit file. No letter mail. TU one click only.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-untested-2026-08-18-evidence/u5");
const BASE = "https://fundhub.ai";
const TEST_CLIENT = "8556bedc-46e1-4d85-b0cd-a24adfee1521";
const FORBIDDEN = "9af65808-a619-4e65-ae91-239766a006b7";

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

const findings = [];
function rec(row) {
  findings.push(row);
  console.log(JSON.stringify({
    id: row.id,
    verdict: row.verdict || null,
    happened: String(row.happened || "").slice(0, 240)
  }));
}

async function shot(page, slug) {
  const file = path.join(OUT, `${slug}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return path.relative(ROOT, file);
}

function netWatch(page) {
  const writes = [];
  page.on("response", (res) => {
    const req = res.request();
    const url = res.url();
    const method = req.method();
    if (/\/api\//.test(url) && ["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      writes.push({
        method,
        status: res.status(),
        path: url.replace(BASE, "").replace(/[?#].*$/, "").slice(0, 180)
      });
    }
  });
  return { writes };
}

const browser = await chromium.launch({ headless: true, executablePath: chromeExe() });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const net = netWatch(page);
page.on("dialog", async (d) => { await d.dismiss(); });

await page.goto(BASE + "/login.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.locator('input[type="email"], #email').first().fill("chris@fundhub.ai");
await page.locator('input[type="password"], #password').first().fill(PASSWORD);
await page.locator('button[type="submit"]').first().click();
await page.waitForFunction(() => !/login\.html/i.test(location.pathname), null, { timeout: 30000 });
if (page.url().includes(FORBIDDEN)) throw new Error("opened forbidden client");
await shot(page, "00-owner-login");
rec({ id: "login", claim: "owner signs in", happened: page.url().replace(/[?#].*$/, ""), verdict: "WORKS" });

await page.goto(BASE + `/app/client-control-panel.html?id=${TEST_CLIENT}`, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(4000);
try {
  await page.waitForFunction(() => {
    const foot = document.getElementById("ccp-footer-id");
    const name = document.getElementById("ccp-name");
    const t = ((foot && foot.innerText) || "") + ((name && name.innerText) || "");
    return /8556bedc|TEST/i.test(t) || /TEST/i.test(document.body.innerText);
  }, null, { timeout: 12000 });
} catch { /* record paint state below */ }
if (page.url().includes(FORBIDDEN)) throw new Error("opened forbidden client");

const before = await page.evaluate(() => {
  const text = (document.body?.innerText || "").replace(/\s+/g, " ");
  const btns = [...document.querySelectorAll("button, a")].map((b) => (b.innerText || "").replace(/\s+/g, " ").trim());
  return {
    path: location.pathname + location.search,
    forbidden: /9af65808/i.test(location.href),
    name: (document.getElementById("ccp-name")?.innerText || "").trim(),
    key: (document.getElementById("ccp-key")?.innerText || "").trim(),
    scores: (document.getElementById("ccp-scores")?.innerText || "").trim(),
    status: (document.getElementById("ccp-issue-ir-status")?.innerText || "").trim(),
    has_soft: btns.some((t) => /^soft pull$/i.test(t) || /soft pull/i.test(t)),
    has_ex: !!document.getElementById("ccp-pull-ex"),
    has_eq: !!document.getElementById("ccp-pull-eq"),
    has_tu: !!document.getElementById("ccp-pull-tu"),
    pullish: btns.filter((t) => /pull|experian|equifax|transunion|soft/i.test(t)).slice(0, 12),
    body: text.slice(0, 240)
  };
});
await shot(page, "01-ccp-before-pull");
rec({
  id: "ccp-before",
  claim: "Owner on TEST file before pull",
  happened: JSON.stringify(before),
  verdict: before.forbidden ? "BROKEN" : "OBSERVED"
});

const softBtn = page.locator("button, a").filter({ hasText: /^soft pull$/i }).first();
if (await softBtn.count()) {
  const beforeN = net.writes.length;
  await softBtn.click();
  await page.waitForTimeout(2500);
  const afterSoft = await page.evaluate(() => ({
    status: (document.getElementById("ccp-issue-ir-status")?.innerText || "").trim(),
    scores: (document.getElementById("ccp-scores")?.innerText || "").trim()
  }));
  rec({
    id: "click-soft",
    claim: "Click Soft pull once",
    happened: JSON.stringify({ status: afterSoft.status, scores: afterSoft.scores, writes: net.writes.slice(beforeN) }),
    shot: await shot(page, "02-soft-pull"),
    verdict: /403|consent|refus|could not/i.test(afterSoft.status) ? "BROKEN" : "OBSERVED"
  });
} else {
  rec({
    id: "click-soft",
    claim: "Click Soft pull once",
    happened: "No Soft pull button on Client Control Panel. The three bureau buttons are the pull.",
    verdict: "MISSING"
  });
}

async function clickBureau(id, label, slug) {
  const btn = page.locator("#" + id);
  if (!(await btn.count())) {
    rec({ id: "click-" + slug, claim: "Click " + label, happened: "button missing", verdict: "MISSING" });
    return;
  }
  const beforeN = net.writes.length;
  await btn.click();
  await page.waitForTimeout(3000);
  const after = await page.evaluate(() => ({
    status: (document.getElementById("ccp-issue-ir-status")?.innerText || "").trim(),
    scores: (document.getElementById("ccp-scores")?.innerText || "").trim(),
    name: (document.getElementById("ccp-name")?.innerText || "").trim()
  }));
  const writes = net.writes.slice(beforeN);
  const refused = writes.some((w) => w.status >= 400) || /consent|could not|refus|not configured|forbidden/i.test(after.status);
  rec({
    id: "click-" + slug,
    claim: "Click " + label + " once on TEST file",
    happened: JSON.stringify({ status: after.status, scores: after.scores, writes }),
    shot: await shot(page, slug),
    http: writes,
    verdict: refused ? "BROKEN" : (after.status ? "OBSERVED" : "UNVERIFIED")
  });
}

await clickBureau("ccp-pull-ex", "Experian", "03-pull-experian");
await clickBureau("ccp-pull-eq", "Equifax", "04-pull-equifax");
await clickBureau("ccp-pull-tu", "TransUnion", "05-pull-transunion");

const afterUi = await page.evaluate(() => ({
  scores: (document.getElementById("ccp-scores")?.innerText || "").trim(),
  status: (document.getElementById("ccp-issue-ir-status")?.innerText || "").trim(),
  name: (document.getElementById("ccp-name")?.innerText || "").trim(),
  path: location.pathname + location.search,
  forbidden: /9af65808/i.test(location.href)
}));
await shot(page, "06-ccp-after-pulls");
rec({
  id: "after-pulls",
  claim: "Scores and status after one click each",
  happened: JSON.stringify(afterUi),
  verdict: afterUi.forbidden ? "BROKEN" : "OBSERVED"
});

await context.close();
await browser.close();

fs.writeFileSync(path.join(OUT, "walk.json"), JSON.stringify({
  at: new Date().toISOString(),
  test_client: TEST_CLIENT,
  opened_forbidden: false,
  findings
}, null, 2));
console.log(JSON.stringify({ wrote: "u5/walk.json", n: findings.length }, null, 2));
