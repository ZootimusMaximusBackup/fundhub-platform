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
  console.log(JSON.stringify({ id: row.id, ok: row.ok, note: row.note, shot: row.shot || null }));
}

async function shot(page, slug, full = false) {
  const file = path.join(OUT, `${slug}.png`);
  await page.screenshot({ path: file, fullPage: full });
  return path.relative(ROOT, file);
}

async function loginStaff(page) {
  await page.goto(BASE + "/login.html", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.locator('input[type="email"], #email').first().fill("chris@fundhub.ai");
  await page.locator('input[type="password"], #password').first().fill(PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForFunction(() => !/login\.html/i.test(location.pathname), null, { timeout: 30000 });
}

async function extractPortalLink() {
  const c = db();
  await c.connect();
  try {
    const r = await c.query(
      `SELECT rendered_body FROM messages
        WHERE client_id = $1 AND template_key = 'EMAIL-PORTAL-MAGIC-LINK'
        ORDER BY created_at DESC LIMIT 1`,
      [TEST_CLIENT]
    );
    const body = (r.rows[0] && r.rows[0].rendered_body) || "";
    const m = String(body).match(/https?:\/\/[^"'\\s>]+portal-login\.html\?t=[A-Za-z0-9_-]+/);
    return { found: !!m, url: m ? m[0] : "" };
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
      userAgent: "audit-prove2",
      env: { ...process.env, PORTAL_BASE_URL: BASE }
    });
    if (!out || !out.ok || out.limited || !out.token) {
      return { found: false, limited: !!(out && out.limited) };
    }
    return { found: true, url: `${BASE}/portal-login.html?t=${out.token}` };
  } finally {
    await c.end();
  }
}

async function proveMath(page) {
  const apiHits = [];
  const onRes = (res) => {
    const u = res.url();
    if (/\/api\/read\/(tradelines|lender-matches|closer-call)/.test(u)) {
      apiHits.push({ status: res.status(), path: u.replace(BASE, "").slice(0, 180) });
    }
  };
  page.on("response", onRes);
  await page.goto(`${BASE}/app/closer-dashboard.html?client_id=${MATH_CLIENT}`, {
    waitUntil: "domcontentloaded",
    timeout: 45000
  });
  await page.waitForFunction(() => {
    const b = document.getElementById("fh-data-banner");
    const t = (b && b.textContent) || "";
    const c = (document.getElementById("oCredit") || {}).textContent || "";
    return (t && !/loading tradelines/i.test(t)) || (c && c.trim() !== "—");
  }, null, { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(800);
  const state = await page.evaluate(() => ({
    hrefHasClient: /client_id=/.test(location.search),
    banner: (document.getElementById("fh-data-banner") || {}).textContent || "",
    credit: (document.getElementById("oCredit") || {}).textContent || "",
    net: (document.getElementById("oNet") || {}).textContent || "",
    monthly: (document.getElementById("oMonthly") || {}).textContent || "",
    live: !!window.__fhCloserLive
  }));
  await shot(page, "01b-closer-math-loaded");
  const draw = page.locator("#iDraw");
  if (await draw.count()) {
    await draw.fill("5000");
    await draw.dispatchEvent("input");
    await draw.dispatchEvent("change");
    await page.waitForTimeout(1500);
  }
  const after = await page.evaluate(() => ({
    credit: (document.getElementById("oCredit") || {}).textContent || "",
    net: (document.getElementById("oNet") || {}).textContent || "",
    monthly: (document.getElementById("oMonthly") || {}).textContent || "",
    funded: (document.getElementById("oFunded") || {}).textContent || "",
    drawn: (document.getElementById("oDrawn") || {}).textContent || "",
    draw: (document.getElementById("iDraw") || {}).value || "",
    banner: (document.getElementById("fh-data-banner") || {}).textContent || ""
  }));
  page.off("response", onRes);
  rec({
    id: "closer-math",
    ok: after.credit.trim() !== "—" && (after.net.trim() !== "—" || after.funded.trim() !== "—"),
    note: after.credit.trim() === "—"
      ? `Credit still blank. Banner: ${after.banner || state.banner || "(none)"}.`
      : "Live file opened. Numbers filled after a $5000 draw.",
    hrefHasClient: state.hrefHasClient,
    liveFlag: state.live,
    apiHits,
    after,
    shot: await shot(page, "01b-closer-math-draw")
  });
}

async function proveContract(page) {
  await page.goto(`${BASE}/app/closer-call.html?client_id=${TEST_CLIENT}`, {
    waitUntil: "domcontentloaded",
    timeout: 45000
  });
  await page.waitForFunction(() => {
    const n = document.getElementById("ccp-who-name");
    return n && n.textContent && !/loading/i.test(n.textContent);
  }, null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(600);
  const callState = await page.evaluate(() => ({
    hrefHasClient: /client_id=/.test(location.search),
    who: (document.getElementById("ccp-who-name") || {}).textContent || "",
    sendVisible: !!(document.getElementById("fh-send-contract") && !document.getElementById("fh-send-contract").hidden)
  }));
  await shot(page, "02b-call-loaded");
  if (callState.sendVisible) {
    await page.locator("#fh-send-contract").click();
    await page.waitForSelector("#fh-contract-tpl option", { timeout: 10000 }).catch(() => {});
    await page.evaluate((id) => {
      const sel = document.getElementById("fh-contract-tpl");
      if (!sel) return;
      sel.value = id;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }, SOFT_PULL);
    await page.locator("#fh-contract-go").click();
    await page.waitForFunction(() => {
      const t = (document.getElementById("fh-contract-msg") || {}).textContent || "";
      return t && !/sending|loading/i.test(t);
    }, null, { timeout: 20000 }).catch(() => {});
    const msg = await page.locator("#fh-contract-msg").innerText().catch(() => "");
    rec({
      id: "contract-send",
      ok: /sent|copy the link/i.test(msg),
      note: msg || "Call cockpit send produced no message.",
      path: "closer-call",
      shot: await shot(page, "02b-contract-sent")
    });
    return;
  }

  await page.goto(`${BASE}/app/present.html?contact=${TEST_CLIENT}`, {
    waitUntil: "domcontentloaded",
    timeout: 45000
  });
  await page.waitForSelector('[data-act="next"]', { timeout: 15000 });
  await page.locator('[data-act="phase:07"]').click();
  await page.waitForTimeout(800);
  await shot(page, "02b-present-close");
  const send = page.locator('[data-act="contract"]');
  if (!(await send.count())) {
    rec({
      id: "contract-send",
      ok: false,
      note: "Close slide has no Send contract.",
      callState,
      shot: await shot(page, "02b-present-no-send")
    });
    return;
  }
  await send.click();
  await page.waitForSelector("#fh-contract-tpl option", { timeout: 10000 }).catch(() => {});
  await page.evaluate((id) => {
    const sel = document.getElementById("fh-contract-tpl");
    if (!sel) return;
    sel.value = id;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  }, SOFT_PULL);
  await shot(page, "02b-present-wording");
  await page.locator('[data-act="contract-go"]').click();
  await page.waitForTimeout(2500);
  const body = await page.evaluate(() => document.body.innerText || "");
  rec({
    id: "contract-send",
    ok: /sent|copy the link|copy link/i.test(body),
    note: /sent|copy the link|copy link/i.test(body)
      ? "Soft-pull wording sent from Present close screen."
      : body.replace(/\s+/g, " ").slice(0, 240),
    path: "present",
    callState,
    shot: await shot(page, "02b-present-sent")
  });
}

async function proveCreative(page) {
  await page.goto(`${BASE}/app/creative-factory.html?partner_id=${DEMO_PARTNER}`, {
    waitUntil: "domcontentloaded",
    timeout: 45000
  });
  await page.waitForFunction(() => {
    const sel = document.getElementById("partnerSel");
    return sel && sel.options && sel.options.length > 0 && sel.options[0].value !== "";
  }, null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(800);
  const picked = await page.evaluate((id) => {
    const sel = document.getElementById("partnerSel");
    if (!sel) return false;
    const opt = [...sel.options].find((o) => (o.textContent || "").includes("Northlight") || o.value === id);
    if (opt) {
      sel.value = opt.value;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
    if (sel.options.length) {
      sel.selectedIndex = 0;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
    return false;
  }, DEMO_PARTNER);
  await page.waitForTimeout(2500);
  const prompt = page.locator("#genPrompt");
  const idem = page.locator("#genIdem");
  if (await prompt.count()) await prompt.fill("E2E audit 2026-08-18. One short working-capital line. Do not publish.");
  if (await idem.count()) await idem.fill(`e2e-audit-prove2-${Date.now()}`);
  await shot(page, "04b-creative-ready");
  const gen = page.locator("#genBtn");
  const enabled = await gen.isEnabled().catch(() => false);
  if (enabled) await gen.click();
  await page.waitForTimeout(2000);
  let msg = await page.locator("#genMsg").innerText().catch(() => "");
  const run = page.locator("#runJobsBtn");
  if (await run.isEnabled().catch(() => false)) {
    await run.click();
    await page.waitForTimeout(2500);
    msg = await page.locator("#genMsg").innerText().catch(() => msg);
  }
  rec({
    id: "creative-job",
    ok: /added to the queue|already used/i.test(msg),
    note: msg || (enabled ? "Enqueue produced no message." : "Enqueue stayed off after partner wait."),
    picked,
    enabled,
    shot: await shot(page, "04b-creative-enqueue")
  });
}

async function provePortalAndSign(page) {
  await page.goto(BASE + "/portal-login.html", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.locator("#email").fill(PORTAL_EMAIL);
  await page.locator("#go").click();
  await page.waitForTimeout(2500);
  const form = await page.evaluate(() => ({
    ok: (document.getElementById("ok-box") || {}).innerText || "",
    err: (document.getElementById("err") || {}).innerText || "",
    passwords: document.querySelectorAll('input[type="password"]').length
  }));
  rec({
    id: "portal-request-link",
    ok: !!form.ok && form.passwords === 0,
    note: form.ok || form.err || "Form did not confirm.",
    passwordFields: form.passwords,
    shot: await shot(page, "05b-portal-link-requested")
  });

  let link = await extractPortalLink();
  if (!link.found) link = await issuePortalLinkLocal();
  if (!link.found) {
    rec({ id: "portal-signin", ok: false, note: "No sign-in link to open." });
    rec({ id: "dispute-sign", ok: false, note: "Skipped. Client never signed in." });
    return;
  }
  await page.goto(link.url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForFunction(() => /client-portal\.html/i.test(location.pathname), null, { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const landing = await page.evaluate(() => ({
    path: location.pathname,
    search: location.search,
    hasToken: !!(localStorage.getItem("fh_token") || "").length,
    account: localStorage.getItem("fh_account"),
    title: (document.getElementById("dispute-auth-title") || {}).textContent || "",
    msg: (document.getElementById("cpSignMsg") || {}).textContent || "",
    disclosure: (document.getElementById("cpDisclosure") || {}).textContent || ""
  }));
  rec({
    id: "portal-signin",
    ok: landing.hasToken && /client-portal/.test(landing.path),
    note: landing.account
      ? "Client session started. Account was stored."
      : "Client session started. Account was not stored, so the page does not know which file to open.",
    path: landing.path,
    hasAccount: !!landing.account,
    shot: await shot(page, "05b-portal-signed-in", true)
  });

  rec({
    id: "dispute-on-default-landing",
    ok: !/sign in to/i.test(`${landing.disclosure} ${landing.msg} ${landing.title}`),
    note: /sign in to/i.test(`${landing.disclosure} ${landing.msg}`)
      ? "Signed in, but the sign card still says sign in. The page never stored the client id."
      : (landing.disclosure || landing.title),
    shot: await shot(page, "06b-dispute-default")
  });

  const recovered = await page.evaluate(async () => {
    const t = localStorage.getItem("fh_token") || "";
    const r = await fetch("/api/auth/session", {
      headers: { accept: "application/json", authorization: "Bearer " + t }
    });
    const b = await r.json().catch(() => null);
    const acct = b && (b.account || b);
    const cid = acct && (acct.client_id || acct.clientId);
    if (!cid) return { ok: false, status: r.status };
    localStorage.setItem("fh_account", JSON.stringify({
      clientId: cid,
      client_id: cid,
      kind: acct.kind || "client"
    }));
    return { ok: true, status: r.status, hasClient: true };
  });

  if (!recovered.ok) {
    rec({ id: "dispute-sign", ok: false, note: "Session did not name a client file.", recovered });
    return;
  }

  await page.goto(`${BASE}/app/client-portal.html?client_id=${TEST_CLIENT}`, {
    waitUntil: "domcontentloaded",
    timeout: 45000
  });
  await page.waitForTimeout(1500);
  const card = page.locator("#dispute-auth-card");
  if (await card.count()) await card.scrollIntoViewIfNeeded();
  const already = await page.locator("#dispute-auth-title").innerText().catch(() => "");
  if (/already signed/i.test(already)) {
    rec({
      id: "dispute-sign",
      ok: true,
      note: "After the file id was restored, the card already said they signed.",
      recovered,
      shot: await shot(page, "06b-dispute-already")
    });
    return;
  }
  const pad = page.locator("#cpSignPad");
  if (await pad.count()) {
    const box = await pad.boundingBox();
    if (box) {
      await page.mouse.move(box.x + 40, box.y + 90);
      await page.mouse.down();
      await page.mouse.move(box.x + 140, box.y + 50, { steps: 14 });
      await page.mouse.move(box.x + 220, box.y + 120, { steps: 14 });
      await page.mouse.move(box.x + 300, box.y + 60, { steps: 14 });
      await page.mouse.up();
    }
  }
  const name = page.locator("#cpSignName");
  if (await name.count()) await name.fill(SIGN_NAME);
  await shot(page, "06b-dispute-drawn");
  const submit = page.locator("#cpSignSubmit");
  if (await submit.count()) await submit.click();
  await page.waitForTimeout(2500);
  const after = await page.evaluate(() => ({
    title: (document.getElementById("dispute-auth-title") || {}).textContent || "",
    msg: (document.getElementById("cpSignMsg") || {}).textContent || ""
  }));
  rec({
    id: "dispute-sign",
    ok: /already signed|signature recorded/i.test(`${after.title} ${after.msg}`),
    note: after.msg || after.title || "Submit produced no message.",
    recovered,
    shot: await shot(page, "06b-dispute-after")
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
    await proveMath(page);
    await proveContract(page);
    await proveCreative(page);
    await context.clearCookies();
    await page.evaluate(() => localStorage.clear());
    await provePortalAndSign(page);
  } finally {
    fs.writeFileSync(path.join(OUT, "findings2.json"), JSON.stringify({
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
