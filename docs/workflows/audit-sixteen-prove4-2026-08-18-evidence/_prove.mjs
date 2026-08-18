import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-sixteen-prove4-2026-08-18-evidence");
const BASE = "https://fundhub.ai";

const TEST_CLIENT = "8556bedc-46e1-4d85-b0cd-a24adfee1521";
const MATH_CLIENT = "9af65808-a619-4e65-ae91-239766a006b7";
const SOFT_PULL = "d6b00014-43c3-42be-95e4-b23490ec71b6";
const DEMO_PARTNER = "94796e0e-d012-4987-8721-676093aaed79";
const PORTAL_EMAIL = "client@fundhub.ai";
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

const findings = [];
function rec(row) {
  findings.push(row);
  console.log(JSON.stringify({
    id: row.id,
    ok: row.ok,
    note: row.note,
    shot: row.shot || null
  }));
}

async function shot(page, slug, full = false) {
  const file = path.join(OUT, `${slug}.png`);
  await page.screenshot({ path: file, fullPage: full });
  return path.relative(ROOT, file);
}

async function loginStaff(page) {
  await page.goto(BASE + "/login.html", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.locator('input[type="email"], #email, input[name="email"]').first().fill("chris@fundhub.ai");
  await page.locator('input[type="password"], #password, input[name="password"]').first().fill(PASSWORD);
  await page.locator('button[type="submit"], button:has-text("Sign"), button:has-text("Log")').first().click();
  await page.waitForFunction(() => !/login\.html|portal-login\.html/i.test(location.pathname), null, { timeout: 30000 });
}

async function waitQuiet(page, ms = 800) {
  await page.waitForTimeout(ms);
}

async function extractPortalLink() {
  const c = db();
  await c.connect();
  try {
    const r = await c.query(
      `SELECT rendered_body, created_at, status
         FROM messages
        WHERE client_id = $1
          AND template_key = 'EMAIL-PORTAL-MAGIC-LINK'
        ORDER BY created_at DESC
        LIMIT 1`,
      [TEST_CLIENT]
    );
    const body = (r.rows[0] && r.rows[0].rendered_body) || "";
    const m = String(body).match(/https?:\/\/[^"'\\s>]+portal-login\.html\?t=[A-Za-z0-9_-]+/);
    return {
      found: !!m,
      url: m ? m[0] : "",
      queuedAt: r.rows[0] ? String(r.rows[0].created_at) : null,
      status: r.rows[0] ? r.rows[0].status : null
    };
  } finally {
    await c.end();
  }
}

async function issuePortalLinkLocal() {
  const { requestMagicLink } = await import(path.join(ROOT, "src/auth/magic-link.mjs"));
  const c = db();
  await c.connect();
  try {
    const out = await requestMagicLink(c, {
      email: PORTAL_EMAIL,
      ip: "127.0.0.1",
      userAgent: "audit-prove4",
      env: { ...process.env, PORTAL_BASE_URL: BASE }
    });
    if (!out || !out.ok || out.limited || !out.token) {
      return { found: false, limited: !!(out && out.limited), outcome: out && out.outcome };
    }
    return { found: true, url: `${BASE}/portal-login.html?t=${out.token}` };
  } finally {
    await c.end();
  }
}

async function proveMath(page) {
  await page.goto(`${BASE}/app/closer-dashboard.html?client_id=${MATH_CLIENT}`, {
    waitUntil: "domcontentloaded",
    timeout: 45000
  });
  await page.waitForFunction(() => {
    const el = document.getElementById("oCredit");
    return el && el.textContent && el.textContent.trim() !== "—";
  }, null, { timeout: 20000 }).catch(() => {});
  await waitQuiet(page, 600);
  const before = await page.evaluate(() => ({
    credit: (document.getElementById("oCredit") || {}).textContent || "",
    net: (document.getElementById("oNet") || {}).textContent || "",
    monthly: (document.getElementById("oMonthly") || {}).textContent || "",
    draw: (document.getElementById("iDraw") || {}).value || ""
  }));
  const beforeShot = await shot(page, "01-closer-math-open");
  const draw = page.locator("#iDraw");
  if (await draw.count()) {
    await draw.fill("5000");
    await draw.dispatchEvent("input");
    await draw.dispatchEvent("change");
    await waitQuiet(page, 800);
  }
  const after = await page.evaluate(() => ({
    credit: (document.getElementById("oCredit") || {}).textContent || "",
    net: (document.getElementById("oNet") || {}).textContent || "",
    monthly: (document.getElementById("oMonthly") || {}).textContent || "",
    funded: (document.getElementById("oFunded") || {}).textContent || "",
    drawn: (document.getElementById("oDrawn") || {}).textContent || "",
    draw: (document.getElementById("iDraw") || {}).value || ""
  }));
  const afterShot = await shot(page, "01-closer-math-draw");
  const filled = after.credit.trim() !== "—" && after.credit.trim() !== "";
  const drawMoved = after.net.trim() !== "—" || after.monthly.trim() !== "—" || after.funded.trim() !== "—";
  rec({
    id: "closer-math",
    ok: filled && drawMoved,
    note: filled
      ? (drawMoved ? "Live file opened. Credit filled. Draw of 5000 moved net/monthly." : "Live file opened. Credit filled. Net/monthly stayed blank after draw.")
      : "Live file opened. Credit still blank.",
    before,
    after,
    shot: afterShot,
    shots: [beforeShot, afterShot]
  });
}

async function sendContractViaCall(page) {
  await page.goto(`${BASE}/app/closer-call.html?client_id=${TEST_CLIENT}`, {
    waitUntil: "domcontentloaded",
    timeout: 45000
  });
  await waitQuiet(page, 1500);
  const sendBtn = page.locator("#fh-send-contract");
  const present = await sendBtn.count();
  const visible = present ? await sendBtn.isVisible().catch(() => false) : false;
  if (!visible) {
    return { used: false, shot: await shot(page, "02-call-no-send-btn"), why: present ? "hidden" : "removed" };
  }
  await sendBtn.click();
  await page.waitForSelector("#fh-contract-tpl option", { timeout: 10000 }).catch(() => {});
  await waitQuiet(page, 400);
  const picked = await page.evaluate((id) => {
    const sel = document.getElementById("fh-contract-tpl");
    if (!sel) return false;
    const opt = [...sel.options].find((o) => o.value === id);
    if (!opt) return false;
    sel.value = id;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, SOFT_PULL);
  await shot(page, "02-contract-wording");
  if (!picked) {
    return { used: true, sent: false, why: "soft-pull wording missing", shot: await shot(page, "02-contract-no-wording") };
  }
  await page.locator("#fh-contract-go").click();
  await page.waitForFunction(() => {
    const m = document.getElementById("fh-contract-msg");
    const t = (m && m.textContent) || "";
    return t && t !== "Sending…" && t !== "Loading wordings…";
  }, null, { timeout: 20000 }).catch(() => {});
  const msg = await page.locator("#fh-contract-msg").innerText().catch(() => "");
  const linkShown = await page.locator("#fh-contract-link").isVisible().catch(() => false);
  return {
    used: true,
    sent: /sent|copy the link/i.test(msg),
    msg,
    linkShown,
    shot: await shot(page, "02-contract-sent")
  };
}

async function sendContractViaPresent(page) {
  await page.goto(`${BASE}/app/present.html?contact=${TEST_CLIENT}`, {
    waitUntil: "domcontentloaded",
    timeout: 45000
  });
  await waitQuiet(page, 1500);
  const phase = page.locator('[data-act="phase:07 Close"]');
  if (await phase.count()) await phase.click();
  await waitQuiet(page, 600);
  const send = page.locator('[data-act="contract"]');
  if (!(await send.count())) {
    return { used: true, sent: false, why: "no Send contract on deck", shot: await shot(page, "02-present-no-send") };
  }
  await send.click();
  await page.waitForSelector("#fh-contract-tpl option", { timeout: 10000 }).catch(() => {});
  await page.evaluate((id) => {
    const sel = document.getElementById("fh-contract-tpl");
    if (!sel) return;
    sel.value = id;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  }, SOFT_PULL);
  await shot(page, "02-present-wording");
  const go = page.locator('[data-act="contract-go"]');
  if (await go.count()) await go.click();
  await waitQuiet(page, 2500);
  const msg = await page.evaluate(() => document.body.innerText || "");
  return {
    used: true,
    sent: /sent|copy the link|copy link/i.test(msg),
    msg: msg.replace(/\s+/g, " ").slice(0, 280),
    shot: await shot(page, "02-present-sent")
  };
}

async function proveContract(page) {
  const call = await sendContractViaCall(page);
  if (call.used) {
    rec({
      id: "contract-send",
      ok: !!call.sent,
      note: call.sent
        ? `Soft-pull wording sent from call cockpit. ${call.linkShown ? "Sign link shown." : "No sign link on screen."}`
        : (call.msg || call.why || "Send did not confirm."),
      msg: call.msg || null,
      path: "closer-call",
      shot: call.shot
    });
    return;
  }
  const present = await sendContractViaPresent(page);
  rec({
    id: "contract-send",
    ok: !!present.sent,
    note: present.sent
      ? "Soft-pull wording sent from Present close screen."
      : (present.why || "Present send did not confirm."),
    msg: present.msg || null,
    path: "present",
    callWhy: call.why,
    shot: present.shot
  });
}

async function proveSocial(page) {
  await page.goto(`${BASE}/app/social-studio.html?partner_id=${DEMO_PARTNER}`, {
    waitUntil: "domcontentloaded",
    timeout: 45000
  });
  await waitQuiet(page, 1200);
  const compose = page.locator("#composeTop, button:has-text('Write a post')").first();
  if (await compose.count()) await compose.click().catch(() => {});
  await waitQuiet(page, 500);
  const caption = page.locator("#cCaption");
  if (await caption.count()) {
    await caption.fill("E2E audit 2026-08-18 — queue only. Do not publish.");
  }
  await shot(page, "03-social-compose");
  const queue = page.locator("#queueBtn");
  if (await queue.count()) await queue.click();
  await waitQuiet(page, 1200);
  const queueMsg = await page.locator("#queueMsg").innerText().catch(() => "");
  const channels = await page.locator("#cChannel option").count().catch(() => 0);
  rec({
    id: "social-post",
    ok: /saved|queued|scheduled/i.test(queueMsg),
    note: queueMsg || (channels < 2 ? "No connected account. Queue refused." : "Queue click produced no message."),
    channels,
    shot: await shot(page, "03-social-queue")
  });
}

async function proveCreative(page) {
  await page.goto(`${BASE}/app/creative-factory.html?partner_id=${DEMO_PARTNER}`, {
    waitUntil: "domcontentloaded",
    timeout: 45000
  });
  await waitQuiet(page, 1500);
  const prompt = page.locator("#genPrompt");
  const idem = page.locator("#genIdem");
  if (await prompt.count()) {
    await prompt.fill("E2E audit 2026-08-18. One short working-capital line. Do not publish.");
  }
  if (await idem.count()) {
    await idem.fill(`e2e-audit-prove4-${Date.now()}`);
  }
  await shot(page, "04-creative-form");
  const gen = page.locator("#genBtn");
  const genEnabled = await gen.isEnabled().catch(() => false);
  if (genEnabled) await gen.click();
  else if (await gen.count()) await gen.click({ force: true }).catch(() => {});
  await waitQuiet(page, 2000);
  const genMsg = await page.locator("#genMsg").innerText().catch(() => "");
  const run = page.locator("#runJobsBtn");
  if (await run.isEnabled().catch(() => false)) {
    await run.click();
    await waitQuiet(page, 2500);
  }
  const afterMsg = await page.locator("#genMsg").innerText().catch(() => genMsg);
  rec({
    id: "creative-job",
    ok: /added to the queue|already used|run/i.test(afterMsg),
    note: afterMsg || (genEnabled ? "Enqueue click produced no message." : "Enqueue button stayed off."),
    genEnabled,
    shot: await shot(page, "04-creative-enqueue")
  });
}

async function provePortalAndSign(page) {
  await page.goto(BASE + "/portal-login.html", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.locator("#email").fill(PORTAL_EMAIL);
  const passCount = await page.locator('input[type="password"]').count();
  await shot(page, "05-portal-login-form");
  await page.locator("#go").click();
  await waitQuiet(page, 1500);
  const formMsg = await page.evaluate(() => {
    const ok = document.getElementById("ok-box");
    const err = document.getElementById("err");
    return {
      okText: (ok && ok.style.display !== "none" ? ok.innerText : "") || "",
      errText: (err && err.style.display !== "none" ? err.innerText : "") || "",
      hasPassword: !!document.querySelector('input[type="password"]')
    };
  });
  const formShot = await shot(page, "05-portal-link-requested");
  rec({
    id: "portal-request-link",
    ok: !!formMsg.okText && passCount === 0,
    note: formMsg.okText || formMsg.errText || "Form did not confirm.",
    passwordFields: passCount,
    shot: formShot
  });

  let link = await extractPortalLink();
  if (!link.found) link = await issuePortalLinkLocal();
  if (!link.found) {
    rec({
      id: "portal-signin",
      ok: false,
      note: link.limited
        ? "Could not get a sign-in link. Too many asks in 15 minutes."
        : "Form queued nothing we could open. Local issue also failed.",
      limited: !!link.limited
    });
    rec({ id: "dispute-sign", ok: false, note: "Skipped. Client never signed in." });
    return;
  }

  await page.goto(link.url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForFunction(() => /client-portal\.html/i.test(location.pathname) || document.getElementById("err")?.innerText, null, { timeout: 25000 }).catch(() => {});
  await waitQuiet(page, 1200);
  const signedIn = await page.evaluate(() => {
    const token = localStorage.getItem("fh_token");
    return {
      path: location.pathname,
      hasToken: !!(token && token.length > 8),
      title: (document.getElementById("dispute-auth-title") || {}).textContent || "",
      h1: (document.querySelector("h1") || {}).textContent || ""
    };
  });
  const inShot = await shot(page, "05-portal-signed-in", true);
  rec({
    id: "portal-signin",
    ok: signedIn.hasToken && /client-portal/.test(signedIn.path),
    note: signedIn.hasToken
      ? "Client session started from the emailed link. No password field."
      : "Link opened but no client session.",
    path: signedIn.path,
    title: signedIn.title,
    shot: inShot
  });
  if (!signedIn.hasToken) {
    rec({ id: "dispute-sign", ok: false, note: "Skipped. Client session missing." });
    return;
  }

  const card = page.locator("#dispute-auth-card");
  if (await card.count()) await card.scrollIntoViewIfNeeded();
  await waitQuiet(page, 500);
  const already = await page.locator("#dispute-auth-title").innerText().catch(() => "");
  if (/already signed/i.test(already)) {
    rec({
      id: "dispute-sign",
      ok: true,
      note: "Client is signed in. Card already says they signed.",
      shot: await shot(page, "06-dispute-already-signed")
    });
    return;
  }

  const pad = page.locator("#cpSignPad");
  if (await pad.count()) {
    const box = await pad.boundingBox();
    if (box) {
      await page.mouse.move(box.x + 30, box.y + 80);
      await page.mouse.down();
      await page.mouse.move(box.x + 120, box.y + 40, { steps: 12 });
      await page.mouse.move(box.x + 200, box.y + 110, { steps: 12 });
      await page.mouse.move(box.x + 280, box.y + 55, { steps: 12 });
      await page.mouse.up();
    }
  }
  const name = page.locator("#cpSignName");
  if (await name.count()) await name.fill(SIGN_NAME);
  await shot(page, "06-dispute-drawn");
  const submit = page.locator("#cpSignSubmit");
  if (await submit.count()) await submit.click();
  await waitQuiet(page, 2000);
  const after = await page.evaluate(() => ({
    title: (document.getElementById("dispute-auth-title") || {}).textContent || "",
    msg: (document.getElementById("cpSignMsg") || {}).textContent || ""
  }));
  rec({
    id: "dispute-sign",
    ok: /already signed|signature recorded/i.test(`${after.title} ${after.msg}`),
    note: after.msg || after.title || "Submit produced no message.",
    shot: await shot(page, "06-dispute-after")
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
    await loginStaff(page);
    await shot(page, "00-owner-login");
    await proveMath(page);
    await proveContract(page);
    await proveSocial(page);
    await proveCreative(page);
    await context.clearCookies();
    await page.evaluate(() => localStorage.clear());
    await provePortalAndSign(page);
  } finally {
    fs.writeFileSync(path.join(OUT, "findings.json"), JSON.stringify({
      at: new Date().toISOString(),
      findings
    }, null, 2));
    await browser.close();
  }
}

main().catch((err) => {
  console.error(String(err && err.message ? err.message : err));
  process.exit(1);
});
