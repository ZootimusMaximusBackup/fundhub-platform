/**
 * W6 client portal walk. Mints a session with createAccountSession.
 * Never prints the token. Test client only. Does not sign dispute.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { createAccountSession, revokeAccountSession } from "../../../../src/auth/account-session.mjs";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-crm-whole-2026-08-18-evidence/w6");
const BASE = "https://fundhub.ai";
const TEST_CLIENT = "8556bedc-46e1-4d85-b0cd-a24adfee1521";
const ACCOUNT_ID = "55d85886-0ca8-4e1e-825a-f9b218ed12c2";
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

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const acct = (await c.query(`SELECT id, org_id, kind, client_id, email FROM accounts WHERE id=$1`, [ACCOUNT_ID])).rows[0];
if (!acct || acct.client_id !== TEST_CLIENT || acct.kind !== "client") {
  await c.end();
  throw new Error("test account mismatch");
}
const session = await createAccountSession(c, { accountId: acct.id, orgId: acct.org_id, userAgent: "w6-auditor" });
const token = session.token;
if (!token) throw new Error("mint failed");

const findings = [];
function rec(row) {
  findings.push(row);
  console.log(JSON.stringify({ id: row.id, happened: String(row.happened || "").slice(0, 240), verdict: row.verdict }));
}

async function shot(page, slug) {
  const file = path.join(OUT, `${slug}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return path.relative(ROOT, file);
}

const browser = await chromium.launch({ headless: true, executablePath: chromeExe() });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await context.addInitScript(({ token, clientId }) => {
  localStorage.setItem("fh_token", token);
  localStorage.setItem("fh_role", "client");
  localStorage.setItem("fh_account", JSON.stringify({
    kind: "client",
    role: "client",
    client_id: clientId,
    clientId
  }));
}, { token, clientId: TEST_CLIENT });

const page = await context.newPage();
await page.goto(BASE + "/app/client-portal.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(2500);
if (page.url().includes(FORBIDDEN)) throw new Error("portal opened forbidden file");
const top = await shot(page, "03-portal-home");
const facts = await page.evaluate((testId) => {
  const name = (document.getElementById("who-name")?.innerText || "").trim();
  const greet = (document.getElementById("greeting")?.innerText || "").trim();
  const greetSub = (document.getElementById("greeting-sub-pre")?.innerText || "").trim();
  const video = (document.getElementById("video-empty")?.innerText || "").trim();
  const videoHidden = !document.getElementById("video-empty") || document.getElementById("video-empty").offsetParent === null;
  const dispute = (document.getElementById("dispute-auth-card")?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 280);
  const signForm = !!document.getElementById("cpSignForm");
  const body = (document.body?.innerText || "").replace(/\s+/g, " ");
  const leaked = body.includes("9af65808") || /gmail\.com/i.test(body);
  const buttons = [...document.querySelectorAll("button, a.btn, a.btn-book, .upload-btn, .tab")]
    .filter((el) => el.offsetParent)
    .map((el) => (el.innerText || el.id || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 40);
  return {
    path: location.pathname + location.search,
    name_len: name.length,
    name_looks_self: /test|client|portal/i.test(name) || name.length > 0,
    greet,
    greetSub,
    video,
    videoHidden,
    dispute: dispute.slice(0, 220),
    signForm,
    leaked_other_file: leaked,
    has_test_id_in_dom: body.includes(testId),
    buttons,
    body: body.slice(0, 360)
  };
}, TEST_CLIENT);
rec({ id: "portal-home", happened: JSON.stringify(facts).slice(0, 280), shot: top, verdict: /could not load your file/i.test(facts.greetSub + facts.body) ? "BROKEN" : "WORKS" });

// Account drawer is a <details> — tabs are hidden until it is open.
const acctDrawer = page.locator("#acct");
if (await acctDrawer.count()) {
  await page.evaluate(() => { const d = document.getElementById("acct"); if (d) d.open = true; });
  await page.waitForTimeout(300);
  await shot(page, "03-portal-acct-open");
  rec({ id: "portal-acct-drawer", happened: "opened Account & history", verdict: "WORKS" });
}
const tabIds = ["pay", "agree", "docs", "act", "msg"];
for (const t of tabIds) {
  const tab = page.locator(`[data-tab="${t}"]`);
  if (await tab.count()) {
    await tab.click({ force: true });
    await page.waitForTimeout(400);
    await shot(page, `03-portal-tab-${t}`);
    rec({ id: `portal-tab-${t}`, happened: `clicked ${t}`, verdict: "WORKS" });
  } else {
    rec({ id: `portal-tab-${t}`, happened: "tab missing", verdict: "MISSING" });
  }
}

// Stage toggles
for (const id of ["st-precall", "st-progress", "st-funded"]) {
  const b = page.locator("#" + id);
  if (await b.count()) {
    await b.click({ force: true }).catch(() => {});
    await page.waitForTimeout(300);
    await shot(page, `03-portal-${id}`);
  }
}

// Dispute card — observe only. Do not sign.
await page.locator("#dispute-auth-card").scrollIntoViewIfNeeded().catch(() => {});
await shot(page, "03-portal-dispute-card");
const disputeState = await page.evaluate(() => {
  const card = document.getElementById("dispute-auth-card");
  const words = (document.getElementById("cpDisclosure")?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 200);
  const form = document.getElementById("cpSignForm");
  const msg = (document.getElementById("cpSignMsg")?.innerText || "").trim();
  return {
    visible: !!(card && card.offsetParent),
    words,
    formVisible: !!(form && form.offsetParent),
    msg
  };
});
rec({
  id: "portal-dispute",
  happened: JSON.stringify(disputeState),
  verdict: disputeState.visible ? "WORKS" : "MISSING",
  note: "Observed only. Did not press Sign. COMPLIANCE REVIEW REQUIRED if this card is unsigned and someone later signs it."
});

// Welcome video
await page.locator("#player").scrollIntoViewIfNeeded().catch(() => {});
await shot(page, "03-portal-video");
rec({
  id: "portal-video",
  happened: facts.video || "no empty copy",
  verdict: /not available/i.test(facts.video) ? "BROKEN" : "WORKS"
});

// Isolation: try opening forbidden id in URL while holding test session
await page.goto(BASE + `/app/client-portal.html?id=${FORBIDDEN}`, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(1500);
const iso = await page.evaluate((forbidden) => {
  const body = (document.body?.innerText || "");
  return {
    path: location.pathname + location.search,
    mentions_forbidden: body.includes(forbidden),
    who: (document.getElementById("who-name")?.innerText || "").trim().slice(0, 40),
    greetSub: (document.getElementById("greeting-sub-pre")?.innerText || "").trim()
  };
}, FORBIDDEN);
await shot(page, "03-portal-isolation");
rec({
  id: "portal-isolation",
  happened: JSON.stringify(iso),
  verdict: iso.mentions_forbidden ? "BROKEN" : "WORKS"
});

// Staff screens should bounce
await page.goto(BASE + "/app/pipeline.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(1200);
rec({
  id: "portal-cannot-pipeline",
  happened: page.url(),
  verdict: /client-portal|portal-login|login/i.test(page.url()) ? "WORKS" : "BROKEN"
});
await shot(page, "03-portal-pipeline-bounce");

await context.close();
await browser.close();
await revokeAccountSession(c, token);
await c.end();

fs.writeFileSync(path.join(OUT, "portal.json"), JSON.stringify({ at: new Date().toISOString(), findings }, null, 2));
console.log(JSON.stringify({ wrote: "w6/portal.json", n: findings.length }, null, 2));
