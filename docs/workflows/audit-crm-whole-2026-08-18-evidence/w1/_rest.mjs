import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-crm-whole-2026-08-18-evidence/w1");
const BASE = "https://fundhub.ai";
const TEST_CLIENT = "8556bedc-46e1-4d85-b0cd-a24adfee1521";
const MATH_CLIENT = "9af65808-a619-4e65-ae91-239766a006b7";
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
  console.log(JSON.stringify({ id: row.id, result: row.result, happened: row.happened }));
}

async function shot(page, slug, full = false) {
  const file = path.join(OUT, `${slug}.png`);
  await page.screenshot({ path: file, fullPage: full });
  return path.relative(ROOT, file);
}

async function query(sql, params = []) {
  const c = db();
  await c.connect();
  try { return (await c.query(sql, params)).rows; }
  finally { await c.end(); }
}

async function loginStaff(page) {
  await page.goto(BASE + "/login.html", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(800);
  if (!/login\.html/i.test(page.url())) return;
  await page.locator('input[type="email"], #email').first().fill("chris@fundhub.ai");
  const pass = page.locator('input[type="password"], #password').first();
  if (await pass.count()) await pass.fill(PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForFunction(() => !/login\.html/i.test(location.pathname), null, { timeout: 30000 });
}

async function contractUrlFromMail() {
  const rows = await query(
    `SELECT rendered_body FROM messages
      WHERE client_id = $1 AND template_key = 'CONTRACT-SEND-EMAIL'
      ORDER BY created_at DESC LIMIT 1`,
    [TEST_CLIENT]
  );
  const body = String(rows[0]?.rendered_body || "").replace(/&amp;/g, "&");
  const m = body.match(/https?:\/\/[^\s<>"']+contract\.html\?[^\s<>"']+/);
  if (!m) return "";
  try {
    const u = new URL(m[0].replace(/[.,;)]+$/, ""));
    if (u.searchParams.get("id") && u.searchParams.get("sig") && u.searchParams.get("exp")) return u.toString();
  } catch {}
  return "";
}

async function contractUrlMinted() {
  const { signContractUrl } = await import(path.join(ROOT, "src/contracts/signed-link.mjs"));
  const signer = (await query(
    `SELECT id FROM contract_signers WHERE contract_id = $1 LIMIT 1`,
    [SENT_CONTRACT]
  ))[0];
  const out = signContractUrl({
    contractId: SENT_CONTRACT,
    signerId: signer && signer.id,
    baseUrl: BASE,
    env: process.env
  });
  return out.url;
}

async function proveContract(page) {
  let url = await contractUrlFromMail();
  let source = "mail";
  if (!url) {
    url = await contractUrlMinted();
    source = "remint";
  }
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(1500);
  const opened = await page.evaluate(() => ({
    title: (document.getElementById("title") || {}).textContent || "",
    canSign: !!(document.getElementById("signPanel") && document.getElementById("signPanel").style.display !== "none"),
    problem: (document.getElementById("problemText") || {}).textContent || "",
    hasId: !!new URLSearchParams(location.search).get("id"),
    hasSig: !!new URLSearchParams(location.search).get("sig"),
    hasExp: !!new URLSearchParams(location.search).get("exp")
  }));
  await shot(page, "01b-contract-open");
  if (!opened.canSign) {
    rec({
      id: "p1-contract",
      result: "BROKEN",
      claimed: "This morning's SOFT-PULL-CONSENT can be signed.",
      clicked: `Opened the sign link (${source}).`,
      happened: opened.problem || opened.title,
      db: opened,
      shot: await shot(page, "01b-contract-cannot")
    });
    return;
  }
  await page.locator("#name").fill(SIGN_NAME);
  const agree = page.locator("#agree");
  if (await agree.count()) await agree.check();
  await shot(page, "01b-contract-ready");
  await page.locator("#go").click();
  await page.waitForTimeout(3000);
  const after = await page.evaluate(() => ({
    done: (document.getElementById("doneText") || {}).textContent || "",
    msg: (document.getElementById("msg") || {}).textContent || ""
  }));
  const row = (await query(`SELECT status, signed_at FROM contracts WHERE id = $1`, [SENT_CONTRACT]))[0];
  rec({
    id: "p1-contract",
    result: row.status === "signed" || /signed|saved|thank/i.test(`${after.done} ${after.msg}`) ? "WORKS" : "BROKEN",
    claimed: "This morning's SOFT-PULL-CONSENT can be signed.",
    clicked: "Opened sign link. Typed test name. Checked agree. Pressed Sign.",
    happened: after.done || after.msg || `Status ${row.status}.`,
    db: { status: row.status, signed: !!row.signed_at, linkSource: source },
    shot: await shot(page, "01b-contract-after")
  });
}

async function proveBrain(page) {
  const apiHits = [];
  page.on("response", (res) => {
    if (res.url().includes("company-brain")) {
      apiHits.push({ status: res.status(), path: res.url().replace(BASE, "").split("?")[0] });
    }
  });
  await page.goto(BASE + "/app/company-brain.html", { waitUntil: "networkidle", timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await shot(page, "03-brain-page");
  const docs = await page.evaluate(() =>
    [...document.querySelectorAll("li, .doc, [data-doc], .file")].map((el) =>
      (el.textContent || "").replace(/\s+/g, " ").trim()
    ).filter((t) => t.length > 4 && t.length < 120).slice(0, 8)
  );
  const ask = page.locator("#askBtn, button:has-text('Send')").first();
  const box = page.locator("#q, textarea[placeholder*='Ask']").first();
  if (!(await box.count()) || !(await ask.count())) {
    rec({
      id: "p3-brain",
      result: "BROKEN",
      claimed: "Ask answers against a document on the page.",
      clicked: "Opened Company Brain.",
      happened: "Ask box or Send was missing.",
      db: { docs: docs.length, apiHits },
      shot: await shot(page, "03-brain-missing")
    });
    return;
  }
  const q = docs[0]
    ? `What does the document named "${docs[0]}" say? Use only that document.`
    : "What documents are listed on this page?";
  await box.fill(q);
  await ask.click();
  await page.waitForTimeout(8000);
  const body = await page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 400));
  const hit = apiHits.find((h) => h.path.includes("/api/read/company-brain"));
  rec({
    id: "p3-brain",
    result: hit && hit.status >= 500 ? "BROKEN" : (hit && hit.status === 200 && !/something went wrong/i.test(body) ? "WORKS" : "BROKEN"),
    claimed: "Ask answers against a document on the page.",
    clicked: "Typed a question about a listed document. Pressed Send.",
    happened: hit && hit.status >= 500 ? "Ask failed on the server." : body.slice(0, 220),
    db: { docsOnPage: docs.length, hit },
    outside: hit || null,
    shot: await shot(page, "03-brain-ask")
  });
}

async function proveSoftPull(page) {
  await page.goto(`${BASE}/app/client-control-panel.html?id=${TEST_CLIENT}`, {
    waitUntil: "domcontentloaded", timeout: 45000
  });
  await page.waitForTimeout(2000);
  await shot(page, "04-ccp-before-pull");
  const btn = page.locator("#ccp-pull-tu");
  if (!(await btn.count())) {
    rec({
      id: "p4-soft-pull",
      result: "BROKEN",
      claimed: "Soft pull runs and comes back on the test client.",
      clicked: "Opened the test client file.",
      happened: "No TransUnion button.",
      compliance: "COMPLIANCE REVIEW REQUIRED",
      shot: await shot(page, "04-no-pull-btn")
    });
    return;
  }
  await btn.click();
  await page.waitForTimeout(10000);
  const status = await page.locator("#ccp-issue-ir-status").innerText().catch(() => "");
  const pulls = await query(
    `SELECT status, provider, state_reason, crs_result_id IS NOT NULL AS has_result
       FROM soft_pull_requests WHERE client_id = $1 ORDER BY created_at DESC LIMIT 3`,
    [TEST_CLIENT]
  );
  rec({
    id: "p4-soft-pull",
    result: /finished|stored report/i.test(status) ? "WORKS" : "BROKEN",
    claimed: "Soft pull runs and comes back. Test client only.",
    clicked: "Pressed TransUnion on the test client file.",
    happened: status || "No status after the click.",
    db: pulls,
    compliance: "COMPLIANCE REVIEW REQUIRED",
    shot: await shot(page, "04-soft-pull-after")
  });
}

async function proveInquiry(page) {
  await page.goto(`${BASE}/app/client-control-panel.html?id=${TEST_CLIENT}`, {
    waitUntil: "domcontentloaded", timeout: 45000
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
    `SELECT case_status, call_fired_at, request_source
       FROM inquiry_removal_cases WHERE client_id = $1 ORDER BY created_at DESC LIMIT 3`,
    [TEST_CLIENT]
  );
  rec({
    id: "p5-inquiry",
    result: cases[0] && cases[0].call_fired_at ? "WORKS" : "BROKEN",
    claimed: "Inquiry removal Send actually fires.",
    clicked: "Opened a case from the test client. Tried Send.",
    happened: !sendCount ? "No Send button." : (disabled ? "Send was off." : "Pressed Send."),
    db: cases,
    compliance: "COMPLIANCE REVIEW REQUIRED",
    shot: await shot(page, "05-inquiry-after")
  });
}

async function proveMath(page) {
  await page.goto(`${BASE}/app/closer-dashboard.html?client_id=${MATH_CLIENT}`, {
    waitUntil: "domcontentloaded", timeout: 45000
  });
  await page.waitForTimeout(2500);
  await page.locator("#iDraw").fill("5000").catch(() => {});
  await page.locator("#iDraw").dispatchEvent("input").catch(() => {});
  await page.waitForTimeout(1500);
  const vals = await page.evaluate(() => ({
    credit: (document.getElementById("oCredit") || {}).textContent || "",
    draw: (document.getElementById("iDraw") || {}).value || "",
    live: !!window.__fhCloserLive,
    hrefHasClient: /client_id=/.test(location.search)
  }));
  rec({
    id: "p6-closer-math",
    result: vals.credit.trim() !== "—" ? "WORKS" : "BROKEN",
    claimed: "Calculators show real numbers after a $5000 draw.",
    clicked: "Opened the live file. Typed 5000.",
    happened: vals.credit.trim() === "—" ? "Credit stayed blank. File id was in the URL." : "Numbers filled.",
    db: vals,
    shot: await shot(page, "06-closer-math")
  });
}

async function proveEmail() {
  const row = (await query(
    `SELECT status, provider, provider_ref, template_key
       FROM messages WHERE client_id = $1 AND channel = 'email'
       ORDER BY created_at DESC LIMIT 1`,
    [TEST_CLIENT]
  ))[0];
  let outside = { checked: false };
  if (row && row.provider_ref && process.env.RESEND_API_KEY) {
    const r = await fetch("https://api.resend.com/emails/" + encodeURIComponent(row.provider_ref), {
      headers: { Authorization: "Bearer " + process.env.RESEND_API_KEY, accept: "application/json" }
    });
    const b = await r.json().catch(() => ({}));
    outside = { checked: true, http: r.status, last_event: b.last_event || null };
  }
  const landed = outside.last_event === "delivered" || outside.last_event === "opened" || outside.last_event === "clicked";
  rec({
    id: "p7-email",
    result: row && row.status === "sent" && landed ? "WORKS" : "BROKEN",
    claimed: "An email actually lands in an inbox.",
    clicked: "Did not send a second contract. Checked this morning's mail row and the provider.",
    happened: !row ? "No email row." : (landed ? `Provider says ${outside.last_event}.` : `Row is ${row.status} via ${row.provider}. Last event: ${outside.last_event || "none"}.`),
    db: row ? { status: row.status, provider: row.provider, has_ref: !!row.provider_ref, key: row.template_key } : null,
    mail: outside
  });
}

async function proveSms(page) {
  const recent = await query(
    `SELECT status, provider, provider_ref IS NOT NULL AS has_ref
       FROM messages WHERE channel = 'sms' ORDER BY created_at DESC LIMIT 3`
  );
  await page.goto(BASE + "/app/messaging.html", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(1500);
  rec({
    id: "p8-sms",
    result: "BROKEN",
    claimed: "An SMS actually lands on a phone.",
    clicked: "Opened Messaging. Did not send a new text. Test client has no phone. The other test phone is an opt-out file.",
    happened: recent[0] ? `Older texts exist as ${recent[0].status} via ${recent[0].provider}. No new send this pass.` : "No SMS rows.",
    db: recent,
    shot: await shot(page, "08-messaging")
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
    await loginStaff(page);
    await proveBrain(page);
    await proveSoftPull(page);
    await proveInquiry(page);
    await proveMath(page);
    await proveEmail();
    await proveSms(page);
  } finally {
    const prev = path.join(OUT, "proofs.json");
    let old = [];
    try { old = JSON.parse(fs.readFileSync(prev, "utf8")).proofs || []; } catch {}
    fs.writeFileSync(path.join(OUT, "proofs.json"), JSON.stringify({
      at: new Date().toISOString(),
      proofs: old.concat(proofs)
    }, null, 2));
    await browser.close();
  }
}

main().catch((err) => {
  console.error(String(err && err.message ? err.message : err));
  process.exit(1);
});
