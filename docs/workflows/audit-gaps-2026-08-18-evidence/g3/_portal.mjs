/**
 * G3b test-client portal walk. Mints createAccountSession. Signs once if unsigned.
 * Revokes after. Never prints the token. Never opens the live credit file.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { createAccountSession, revokeAccountSession } from "../../../../src/auth/account-session.mjs";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-gaps-2026-08-18-evidence/g3");
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

const findings = [];
function rec(row) {
  findings.push(row);
  console.log(JSON.stringify({ id: row.id, verdict: row.verdict, happened: String(row.happened || "").slice(0, 220) }));
}

async function shot(page, slug) {
  const file = path.join(OUT, `${slug}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return path.relative(ROOT, file);
}

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const acct = (await c.query(`SELECT id, org_id, kind, client_id, email FROM accounts WHERE id=$1`, [ACCOUNT_ID])).rows[0];
if (!acct || acct.client_id !== TEST_CLIENT || acct.kind !== "client") {
  await c.end();
  throw new Error("test account mismatch");
}

const before = {
  consents: (await c.query(
    `SELECT id, kind, capture_method, revoked_at IS NOT NULL AS revoked, granted_at
       FROM client_consents WHERE client_id=$1 ORDER BY granted_at DESC`,
    [TEST_CLIENT]
  )).rows,
  entitlements: (await c.query(
    `SELECT entitlement_code, revoked_at IS NULL AS active
       FROM entitlements WHERE client_id=$1`,
    [TEST_CLIENT]
  )).rows,
  documents: (await c.query(
    `SELECT id, kind, delivery_status FROM documents WHERE client_id=$1 ORDER BY created_at DESC LIMIT 12`,
    [TEST_CLIENT]
  )).rows
};

const session = await createAccountSession(c, { accountId: acct.id, orgId: acct.org_id, userAgent: "g3-auditor" });
const token = session.token;
if (!token) throw new Error("mint failed");

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
const writes = [];
page.on("response", (res) => {
  const req = res.request();
  if (/\/api\//.test(res.url()) && ["POST", "PUT", "PATCH"].includes(req.method())) {
    writes.push({ method: req.method(), status: res.status(), path: res.url().replace(BASE, "").replace(/[?#].*$/, "").slice(0, 160) });
  }
});

await page.goto(BASE + "/app/client-portal.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(2800);
if (page.url().includes(FORBIDDEN)) throw new Error("portal opened forbidden file");

const home = await page.evaluate((testId) => {
  const name = (document.getElementById("who-name")?.innerText || "").trim();
  const greet = (document.getElementById("greeting")?.innerText || "").trim();
  const video = (document.getElementById("video-empty")?.innerText || "").trim();
  const title = (document.getElementById("dispute-auth-title")?.innerText || "").trim();
  const signed = document.getElementById("dispute-auth-card")?.classList.contains("is-signed");
  const form = document.getElementById("cpSignForm");
  const formVisible = !!(form && form.offsetParent);
  const body = (document.body?.innerText || "").replace(/\s+/g, " ");
  return {
    path: location.pathname + location.search,
    name_ok: /test/i.test(name) || name.length > 0,
    greet,
    video,
    title,
    signed,
    formVisible,
    leaked_other: body.includes("9af65808"),
    has_test_id: body.includes(testId),
    tiles: body.match(/\d+ unlocked|\d+ locked|Welcome video|scores|letters/gi)?.slice(0, 12) || [],
    body: body.slice(0, 360)
  };
}, TEST_CLIENT);
await shot(page, "g3b-portal-home");
rec({
  id: "g3b-home",
  happened: JSON.stringify(home).slice(0, 280),
  verdict: home.leaked_other ? "BROKEN" : "WORKS"
});

await page.locator("#dispute-auth-card").scrollIntoViewIfNeeded().catch(() => {});
await shot(page, "g3b-dispute-before");

const alreadySigned = home.signed || /already signed/i.test(home.title);
if (alreadySigned) {
  rec({
    id: "g3b-sign",
    claim: "Dispute-letter Sign",
    happened: "Already signed. Did not sign again.",
    verdict: "OBSERVED"
  });
} else {
  const nameBox = page.locator("#cpSignName");
  if (await nameBox.count()) {
    await nameBox.fill("TEST Client Role");
    await page.evaluate(() => {
      const canvas = document.getElementById("cpSignPad");
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      ctx.strokeStyle = "#1a1a1a";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(20, 80);
      ctx.lineTo(180, 40);
      ctx.lineTo(280, 110);
      ctx.stroke();
    });
    const beforeN = writes.length;
    await page.locator("#cpSignSubmit").click();
    await page.waitForTimeout(2500);
    const afterUi = await page.evaluate(() => ({
      title: (document.getElementById("dispute-auth-title")?.innerText || "").trim(),
      msg: (document.getElementById("cpSignMsg")?.innerText || "").trim(),
      signed: document.getElementById("dispute-auth-card")?.classList.contains("is-signed")
    }));
    await shot(page, "g3b-dispute-after");
    rec({
      id: "g3b-sign",
      claim: "Pressed Sign once on test file",
      happened: JSON.stringify(afterUi),
      writes: writes.slice(beforeN),
      verdict: afterUi.signed || /recorded|already signed/i.test(afterUi.msg + afterUi.title) ? "WORKS" : "BROKEN"
    });
  } else {
    rec({ id: "g3b-sign", happened: "Sign form not present", verdict: "MISSING" });
  }
}

await page.evaluate(() => { const d = document.getElementById("acct"); if (d) d.open = true; });
await page.waitForTimeout(300);
for (const t of ["pay", "agree", "docs"]) {
  const tab = page.locator(`[data-tab="${t}"]`);
  if (await tab.count()) {
    await tab.click({ force: true });
    await page.waitForTimeout(400);
    await shot(page, `g3b-tab-${t}`);
  }
}

const unlockUi = await page.evaluate(() => {
  const video = (document.getElementById("video-empty")?.innerText || "").trim();
  const body = (document.body?.innerText || "").replace(/\s+/g, " ");
  return {
    video,
    videoMissing: /not available/i.test(video),
    tiles: body.match(/\d+ unlocked|\d+ locked/gi)?.slice(0, 8) || [],
    scores: /score/i.test(body),
    letters: /letter/i.test(body)
  };
});
await page.locator("#player").scrollIntoViewIfNeeded().catch(() => {});
await shot(page, "g3b-video-after");
rec({
  id: "g3b-unlocks",
  claim: "What unlocked after sign",
  happened: JSON.stringify(unlockUi),
  verdict: "OBSERVED"
});

await context.close();
await browser.close();

const after = {
  consents: (await c.query(
    `SELECT id, kind, capture_method, revoked_at IS NOT NULL AS revoked, granted_at
       FROM client_consents WHERE client_id=$1 ORDER BY granted_at DESC`,
    [TEST_CLIENT]
  )).rows,
  entitlements: (await c.query(
    `SELECT entitlement_code, revoked_at IS NULL AS active
       FROM entitlements WHERE client_id=$1`,
    [TEST_CLIENT]
  )).rows,
  documents: (await c.query(
    `SELECT id, kind, delivery_status FROM documents WHERE client_id=$1 ORDER BY created_at DESC LIMIT 12`,
    [TEST_CLIENT]
  )).rows
};

await revokeAccountSession(c, token);
await c.end();

fs.writeFileSync(path.join(OUT, "portal.json"), JSON.stringify({
  at: new Date().toISOString(),
  findings,
  writes,
  before,
  after
}, null, 2));
console.log(JSON.stringify({ wrote: "g3/portal.json", n: findings.length }, null, 2));
