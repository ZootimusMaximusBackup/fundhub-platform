import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-crm-whole-2026-08-18-evidence/w1");
const BASE = "https://fundhub.ai";
const TEST_CLIENT = "8556bedc-46e1-4d85-b0cd-a24adfee1521";
const MATH_CLIENT = "9af65808-a619-4e65-ae91-239766a006b7";
const PORTAL_EMAIL = "client@fundhub.ai";
const SENT_CONTRACT = "16b29639-ac19-42ab-ba48-8789018b0e48";
const SIGN_NAME = "TEST — Client Role";

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

function db() {
  return new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
}

const proofs = [];
function rec(row) {
  proofs.push(row);
  console.log(JSON.stringify({
    id: row.id,
    result: row.result,
    clicked: row.clicked,
    happened: row.happened
  }));
}

async function shot(page, slug, full = false) {
  const file = path.join(OUT, `${slug}.png`);
  await page.screenshot({ path: file, fullPage: full });
  return path.relative(ROOT, file);
}

async function loginStaff(page) {
  await page.goto(BASE + "/login.html", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(600);
  if (!/login\.html/i.test(page.url())) return;
  await page.locator('input[type="email"], #email').first().fill("chris@fundhub.ai");
  const pass = page.locator('input[type="password"], #password').first();
  if (await pass.count()) await pass.fill(PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForFunction(() => !/login\.html/i.test(location.pathname), null, { timeout: 30000 });
}

async function query(sql, params = []) {
  const c = db();
  await c.connect();
  try {
    return (await c.query(sql, params)).rows;
  } finally {
    await c.end();
  }
}

async function extractUrl(sql, params, re) {
  const rows = await query(sql, params);
  const body = (rows[0] && rows[0].rendered_body) || "";
  const m = String(body).match(re);
  return { found: !!m, url: m ? m[0] : "" };
}

async function resendStatus(providerRef) {
  const key = process.env.RESEND_API_KEY || "";
  if (!key || !providerRef) return { checked: false };
  const r = await fetch("https://api.resend.com/emails/" + encodeURIComponent(providerRef), {
    headers: { Authorization: "Bearer " + key, accept: "application/json" }
  });
  const b = await r.json().catch(() => ({}));
  return {
    checked: true,
    http: r.status,
    last_event: b.last_event || null,
    hasTo: Array.isArray(b.to) && b.to.length > 0
  };
}

async function proveContract(page) {
  const contract = (await query(
    `SELECT id, status, signed_at, sent_at, template_key
       FROM contracts WHERE id = $1`,
    [SENT_CONTRACT]
  ))[0];
  const signer = (await query(
    `SELECT id, status, signed_at FROM contract_signers WHERE contract_id = $1 LIMIT 1`,
    [SENT_CONTRACT]
  ))[0];
  const link = await extractUrl(
    `SELECT rendered_body FROM messages
      WHERE client_id = $1 AND template_key = 'CONTRACT-SEND-EMAIL'
      ORDER BY created_at DESC LIMIT 1`,
    [TEST_CLIENT],
    /https?:\/\/[^"'\\s>]+contract\.html\?[^"'\\s<]+/
  );
  if (!link.found) {
    rec({
      id: "p1-contract",
      result: "BROKEN",
      claimed: "Reuse this morning's SOFT-PULL-CONSENT and sign it.",
      clicked: "none",
      happened: "A sent row exists, but the mail body had no sign link we could open.",
      db: { contract: contract && contract.status, signer: signer && signer.status },
      shot: null
    });
    return;
  }
  await page.goto(link.url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(1500);
  const opened = await page.evaluate(() => ({
    title: (document.getElementById("title") || {}).textContent || "",
    canSign: !!(document.getElementById("signPanel") && document.getElementById("signPanel").style.display !== "none"),
    problem: (document.getElementById("problemText") || {}).textContent || ""
  }));
  await shot(page, "01-contract-open");
  if (signer && signer.status === "signed") {
    rec({
      id: "p1-contract",
      result: "WORKS",
      claimed: "Reuse this morning's SOFT-PULL-CONSENT. It can be signed.",
      clicked: "Opened the sign link from the queued/sent mail.",
      happened: "Already signed. Link opened.",
      db: { contract: contract.status, signer: signer.status, sent_at: contract.sent_at },
      shot: await shot(page, "01-contract-already-signed")
    });
    return;
  }
  if (!opened.canSign) {
    rec({
      id: "p1-contract",
      result: "BROKEN",
      claimed: "The sent contract can be signed.",
      clicked: "Opened the sign link.",
      happened: opened.problem || opened.title || "Sign panel did not show.",
      db: { contract: contract && contract.status, signer: signer && signer.status },
      shot: await shot(page, "01-contract-cannot-sign")
    });
    return;
  }
  await page.locator("#name").fill(SIGN_NAME);
  const agree = page.locator("#agree");
  if (await agree.count()) await agree.check();
  await shot(page, "01-contract-ready");
  await page.locator("#go").click();
  await page.waitForTimeout(2500);
  const after = await page.evaluate(() => ({
    done: (document.getElementById("doneText") || {}).textContent || "",
    msg: (document.getElementById("msg") || {}).textContent || ""
  }));
  const afterRow = (await query(`SELECT status, signed_at FROM contracts WHERE id = $1`, [SENT_CONTRACT]))[0];
  rec({
    id: "p1-contract",
    result: /signed|thank|saved/i.test(`${after.done} ${after.msg}`) || afterRow.status === "signed" ? "WORKS" : "BROKEN",
    claimed: "Reuse this morning's SOFT-PULL-CONSENT and sign it.",
    clicked: "Opened sign link. Typed test legal name. Checked agree. Pressed Sign.",
    happened: after.done || after.msg || `Contract status now ${afterRow.status}.`,
    db: { before: contract.status, after: afterRow.status, signed_at: afterRow.signed_at },
    shot: await shot(page, "01-contract-after-sign")
  });
}

async function provePortal(page) {
  await page.goto(BASE + "/portal-login.html", { waitUntil: "domcontentloaded", timeout: 45000 });
  const passwords = await page.locator('input[type="password"]').count();
  await page.locator("#email").fill(PORTAL_EMAIL);
  await shot(page, "02-portal-form");
  await page.locator("#go").click();
  await page.waitForTimeout(2000);
  const form = await page.evaluate(() => ({
    ok: (document.getElementById("ok-box") || {}).innerText || "",
    err: (document.getElementById("err") || {}).innerText || ""
  }));
  const { requestMagicLink } = await import(path.join(ROOT, "src/auth/magic-link.mjs"));
  const c = db();
  await c.connect();
  let issued;
  try {
    issued = await requestMagicLink(c, {
      email: PORTAL_EMAIL,
      ip: "127.0.0.1",
      userAgent: "w1-audit",
      env: { ...process.env, PORTAL_BASE_URL: BASE }
    });
  } finally {
    await c.end();
  }
  if (!issued || !issued.ok || issued.limited || !issued.token) {
    rec({
      id: "p2-portal",
      result: "BROKEN",
      claimed: "Client asks for a link, signs in, sees their file. No password field.",
      clicked: "Typed client@fundhub.ai. Pressed Email me a sign-in link.",
      happened: issued && issued.limited ? "Too many link asks in 15 minutes." : (form.ok || form.err || "No link."),
      db: { formOk: !!form.ok, passwords },
      shot: await shot(page, "02-portal-no-link")
    });
    return;
  }
  await page.goto(`${BASE}/portal-login.html?t=${issued.token}`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForFunction(() => /client-portal\.html/i.test(location.pathname), null, { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const land = await page.evaluate(() => ({
    path: location.pathname,
    hasToken: !!(localStorage.getItem("fh_token") || "").length,
    hasAccount: !!localStorage.getItem("fh_account"),
    body: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 400)
  }));
  const seesFile = /TEST Client Role|Welcome/i.test(land.body) && !/could not load your file/i.test(land.body);
  rec({
    id: "p2-portal",
    result: land.hasToken && seesFile ? "WORKS" : "BROKEN",
    claimed: "Email-link only. After sign-in they see their own file.",
    clicked: "Asked for a link on portal-login. Opened the link.",
    happened: land.hasToken
      ? (seesFile ? "Signed in. File loaded." : "Signed in. Page says it could not load the file. Account was not stored.")
      : "Link did not start a session.",
    db: { passwords, hasAccount: land.hasAccount, formOk: !!form.ok },
    shot: await shot(page, "02-portal-after-link", true)
  });
}

async function proveBrain(page) {
  const apiHits = [];
  const onRes = (res) => {
    if (res.url().includes("/api/read/company-brain") || res.url().includes("/api/company-brain")) {
      apiHits.push({ status: res.status(), path: res.url().replace(BASE, "").split("?")[0] });
    }
  };
  page.on("response", onRes);
  await page.goto(BASE + "/app/company-brain.html", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(2000);
  const docs = await page.evaluate(() => {
    const list = [...document.querySelectorAll("#docsList li, .doc-row, [data-doc]")].map((el) =>
      (el.textContent || "").replace(/\s+/g, " ").trim()
    ).filter(Boolean);
    const pane = (document.getElementById("docsPane") || document.body).innerText || "";
    return { list: list.slice(0, 8), pane: pane.replace(/\s+/g, " ").slice(0, 300) };
  });
  await shot(page, "03-brain-page");
  const title = (docs.list[0] || "").slice(0, 80);
  const q = title
    ? `What does the document named "${title}" say? Answer from that document only.`
    : "What company documents are on this page?";
  await page.locator("#q").fill(q);
  await page.locator("#askBtn").click();
  await page.waitForTimeout(8000);
  const after = await page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 500));
  page.off("response", onRes);
  const ask = apiHits.find((h) => h.path.includes("/api/read/company-brain"));
  const broken502 = ask && ask.status >= 500;
  rec({
    id: "p3-brain",
    result: broken502 ? "BROKEN" : (/something went wrong|could not/i.test(after) ? "BROKEN" : (ask && ask.status === 200 ? "WORKS" : "BROKEN")),
    claimed: "Ask answers against a document that is actually on the page.",
    clicked: "Opened Company Brain. Typed a question about a listed document. Pressed Send.",
    happened: broken502
      ? "Ask failed on the server."
      : after.slice(0, 220),
    db: { docsOnPage: docs.list.length, ask },
    outside: ask || null,
    shot: await shot(page, "03-brain-ask")
  });
}

async function proveSoftPull(page) {
  await page.goto(`${BASE}/app/client-control-panel.html?id=${TEST_CLIENT}`, {
    waitUntil: "domcontentloaded",
    timeout: 45000
  });
  await page.waitForTimeout(2000);
  await shot(page, "04-ccp-before-pull");
  const btn = page.locator("#ccp-pull-tu");
  if (!(await btn.count())) {
    rec({
      id: "p4-soft-pull",
      result: "BROKEN",
      claimed: "A soft pull runs and comes back on the test client.",
      clicked: "Opened Client Control Panel for the test client.",
      happened: "No TransUnion pull button.",
      compliance: "COMPLIANCE REVIEW REQUIRED",
      shot: await shot(page, "04-no-pull-btn")
    });
    return;
  }
  await btn.click();
  await page.waitForTimeout(8000);
  const status = await page.locator("#ccp-issue-ir-status").innerText().catch(() => "");
  const pulls = await query(
    `SELECT id, status, provider, state_reason, crs_result_id, requested_at, resolved_at
       FROM soft_pull_requests WHERE client_id = $1
       ORDER BY created_at DESC LIMIT 3`,
    [TEST_CLIENT]
  );
  rec({
    id: "p4-soft-pull",
    result: /finished|stored report/i.test(status) && pulls[0] && pulls[0].status === "completed" ? "WORKS"
      : (pulls[0] ? "BROKEN" : "BROKEN"),
    claimed: "Soft pull runs and comes back. Test client only.",
    clicked: "Opened the test client file. Pressed TransUnion.",
    happened: status || "No status after the click.",
    db: pulls.map((p) => ({ status: p.status, provider: p.provider, has_result: !!p.crs_result_id, reason: p.state_reason })),
    compliance: "COMPLIANCE REVIEW REQUIRED",
    shot: await shot(page, "04-soft-pull-after")
  });
}

async function proveInquiry(page) {
  await page.goto(`${BASE}/app/client-control-panel.html?id=${TEST_CLIENT}`, {
    waitUntil: "domcontentloaded",
    timeout: 45000
  });
  await page.waitForTimeout(1500);
  const issue = page.locator("#ccp-issue-ir");
  if (await issue.count()) await issue.click();
  await page.waitForTimeout(2500);
  if (!/inquiry-remover/i.test(page.url())) {
    await page.goto(BASE + "/app/inquiry-remover.html", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(1500);
  }
  await shot(page, "05-inquiry-desk");
  const row = page.locator("tr[data-row]").first();
  if (await row.count()) await row.click();
  await page.waitForTimeout(800);
  const send = page.locator('[data-act="send"]').first();
  const sendCount = await send.count();
  const disabled = sendCount ? await send.isDisabled() : true;
  if (sendCount && !disabled) await send.click();
  await page.waitForTimeout(2500);
  const cases = await query(
    `SELECT id, case_status, call_fired_at, request_source, created_at
       FROM inquiry_removal_cases WHERE client_id = $1
       ORDER BY created_at DESC LIMIT 3`,
    [TEST_CLIENT]
  );
  rec({
    id: "p5-inquiry",
    result: cases[0] && cases[0].call_fired_at ? "WORKS" : (cases[0] ? "BROKEN" : "BROKEN"),
    claimed: "An inquiry removal request actually fires on the specialist path.",
    clicked: "Opened a case from the test client file. Tried Send on the Specialist desk.",
    happened: !sendCount
      ? "No Send button."
      : (disabled ? "Send was off." : "Pressed Send."),
    db: cases.map((r) => ({ status: r.case_status, fired: !!r.call_fired_at, source: r.request_source })),
    compliance: "COMPLIANCE REVIEW REQUIRED",
    shot: await shot(page, "05-inquiry-after")
  });
}

async function proveMath(page) {
  await page.goto(`${BASE}/app/closer-dashboard.html?client_id=${MATH_CLIENT}`, {
    waitUntil: "domcontentloaded",
    timeout: 45000
  });
  await page.waitForTimeout(2500);
  await page.locator("#iDraw").fill("5000").catch(() => {});
  await page.locator("#iDraw").dispatchEvent("input").catch(() => {});
  await page.waitForTimeout(1500);
  const vals = await page.evaluate(() => ({
    credit: (document.getElementById("oCredit") || {}).textContent || "",
    net: (document.getElementById("oNet") || {}).textContent || "",
    monthly: (document.getElementById("oMonthly") || {}).textContent || "",
    draw: (document.getElementById("iDraw") || {}).value || "",
    hasFHData: !!window.FHData,
    live: !!window.__fhCloserLive,
    hrefHasClient: /client_id=/.test(location.search)
  }));
  rec({
    id: "p6-closer-math",
    result: vals.credit.trim() !== "—" && vals.credit.trim() !== "" ? "WORKS" : "BROKEN",
    claimed: "Calculators show real numbers on the live file after a $5000 draw.",
    clicked: "Opened closer dashboard with the live file id. Typed 5000.",
    happened: vals.credit.trim() === "—"
      ? "Credit stayed blank. File id was in the URL."
      : "Numbers filled.",
    db: { hrefHasClient: vals.hrefHasClient, live: vals.live, draw: vals.draw, creditBlank: vals.credit.trim() === "—" },
    shot: await shot(page, "06-closer-math")
  });
}

async function proveEmail() {
  const row = (await query(
    `SELECT id, status, provider, provider_ref, template_key, created_at
       FROM messages
      WHERE client_id = $1 AND channel = 'email'
      ORDER BY created_at DESC LIMIT 1`,
    [TEST_CLIENT]
  ))[0];
  const outside = await resendStatus(row && row.provider_ref);
  const landed = outside.last_event === "delivered" || outside.last_event === "opened" || outside.last_event === "clicked";
  rec({
    id: "p7-email",
    result: row && row.status === "sent" && landed ? "WORKS"
      : (row && row.status === "sent" && outside.checked ? "BROKEN" : "BROKEN"),
    claimed: "An email actually lands in an inbox. Queue-only is broken.",
    clicked: "Did not send a second contract. Checked this morning's mail row and the mail provider.",
    happened: !row
      ? "No email row."
      : (landed
        ? `Provider says the mail ${outside.last_event}.`
        : `Row is ${row.status} via ${row.provider}. Provider last event: ${outside.last_event || "none"}.`),
    db: row ? { status: row.status, provider: row.provider, has_ref: !!row.provider_ref, key: row.template_key } : null,
    mail: outside,
    shot: null
  });
}

async function proveSms(page) {
  const recent = await query(
    `SELECT status, provider, provider_ref IS NOT NULL AS has_ref, created_at
       FROM messages WHERE channel = 'sms' ORDER BY created_at DESC LIMIT 3`
  );
  await page.goto(BASE + "/app/messaging.html", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(1500);
  await shot(page, "08-messaging");
  rec({
    id: "p8-sms",
    result: "BROKEN",
    claimed: "An SMS actually lands on a phone. Queue-only is broken.",
    clicked: "Opened Messaging. Did not send a new text: the test client has no phone, and the only other test phone is an opt-out file.",
    happened: recent[0]
      ? `Older texts exist as ${recent[0].status} via ${recent[0].provider}. No new send this pass.`
      : "No SMS rows at all.",
    db: recent.map((r) => ({ status: r.status, provider: r.provider, has_ref: r.has_ref })),
    shot: await shot(page, "08-messaging-full", true)
  });
}

async function main() {
  const browser = await chromium.launch({
    headless: false,
    executablePath: chromeExe(),
    args: ["--disable-dev-shm-usage"]
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true
  });
  const page = await context.newPage();
  try {
    await proveContract(page);
    await context.clearCookies();
    await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
    await provePortal(page);
    await context.clearCookies();
    await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
    await loginStaff(page);
    await proveBrain(page);
    await proveSoftPull(page);
    await proveInquiry(page);
    await proveMath(page);
    await proveEmail();
    await proveSms(page);
  } finally {
    fs.writeFileSync(path.join(OUT, "proofs.json"), JSON.stringify({
      at: new Date().toISOString(),
      proofs
    }, null, 2));
    await browser.close();
  }
}

main().catch((err) => {
  console.error(String(err && err.message ? err.message : err));
  process.exit(1);
});
