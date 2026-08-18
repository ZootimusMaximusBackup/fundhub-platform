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
  await page.waitForTimeout(800);
  if (!/login\.html/i.test(page.url())) return;
  await page.locator('input[type="email"], #email').first().fill("chris@fundhub.ai");
  const pass = page.locator('input[type="password"], #password').first();
  if (await pass.count()) await pass.fill(PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForFunction(() => !/login\.html/i.test(location.pathname), null, { timeout: 30000 });
}

async function issuePortalLinkLocal() {
  const { requestMagicLink } = await import(path.join(ROOT, "src/auth/magic-link.mjs"));
  const c = db();
  await c.connect();
  try {
    const out = await requestMagicLink(c, {
      email: PORTAL_EMAIL,
      ip: "127.0.0.1",
      userAgent: "audit-prove3",
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
  page.on("response", (res) => {
    const u = res.url();
    if (u.includes("/api/")) apiHits.push({ status: res.status(), path: u.replace(BASE, "").split("?")[0] });
  });
  await page.goto(`${BASE}/app/closer-dashboard.html?client_id=${MATH_CLIENT}`, {
    waitUntil: "domcontentloaded",
    timeout: 45000
  });
  await page.waitForTimeout(1500);
  const boot = await page.evaluate(() => ({
    hasFHData: !!window.FHData,
    hasView: !!window.FHCloserView,
    hrefHasClient: /client_id=/.test(location.search),
    credit: (document.getElementById("oCredit") || {}).textContent || "",
    banner: (document.getElementById("fh-data-banner") || {}).textContent || "",
    live: !!window.__fhCloserLive
  }));
  await shot(page, "01c-math-boot");

  let apiAfter = null;
  if (boot.hasFHData) {
    apiAfter = await page.evaluate(async (cid) => {
      const r = await window.FHData.read("tradelines", { client_id: cid, requested_amount: 5000 });
      const d = r && r.data ? r.data : null;
      return {
        ok: !!(r && r.ok),
        source: r && r.source,
        error: r && r.error,
        keys: d ? Object.keys(d).slice(0, 20) : [],
        total: d && (d.total_available || d.totalAvailable || d.available || d.summary),
        drawCount: d && d.allocation && Array.isArray(d.allocation.draws) ? d.allocation.draws.length : null
      };
    }, MATH_CLIENT);
  }

  rec({
    id: "closer-math",
    ok: boot.credit.trim() !== "—",
    note: boot.credit.trim() !== "—"
      ? "Screen filled from the live file."
      : (!boot.hasFHData
        ? "Live file is in the URL, but the screen never asked the server. The data helper loads too late, so the calculators stay blank."
        : "Screen asked, still blank."),
    boot,
    apiAfter,
    apiHits: apiHits.filter((h) => /tradelines|closer/.test(h.path)).slice(0, 12),
    shot: await shot(page, "01c-math-after")
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
  }, null, { timeout: 20000 });
  await page.waitForTimeout(500);
  const sendBtn = page.locator("#fh-send-contract");
  if (await sendBtn.count()) {
    await sendBtn.click();
    await page.waitForTimeout(400);
    const hidden = await page.locator("#fh-contract-panel").getAttribute("hidden");
    if (hidden !== null) await sendBtn.click();
  }
  await page.waitForFunction(() => {
    const sel = document.getElementById("fh-contract-tpl");
    return sel && sel.options && sel.options.length > 0;
  }, null, { timeout: 10000 });
  await page.evaluate((id) => {
    const sel = document.getElementById("fh-contract-tpl");
    sel.value = id;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  }, SOFT_PULL);
  await page.waitForTimeout(400);
  await page.evaluate((mail) => {
    const byKey = {
      company_name: "Fundhub",
      company: "Fundhub",
      permission_lasts_days: "30",
      days: "30",
      withdrawal_email: mail,
      withdrawal_email_address: mail
    };
    document.querySelectorAll("[data-blank]").forEach((el) => {
      const k = (el.getAttribute("data-blank") || "").toLowerCase();
      if (byKey[k]) el.value = byKey[k];
      else if (/email/.test(k)) el.value = mail;
      else if (/day/.test(k)) el.value = "30";
      else el.value = "Fundhub";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }, PORTAL_EMAIL);
  await shot(page, "02c-contract-filled");
  await page.locator("#fh-contract-go").click();
  await page.waitForFunction(() => {
    const t = (document.getElementById("fh-contract-msg") || {}).textContent || "";
    return t && !/sending|loading|blanks/i.test(t);
  }, null, { timeout: 25000 }).catch(() => {});
  const msg = await page.locator("#fh-contract-msg").innerText().catch(() => "");
  const linkShown = await page.locator("#fh-contract-link").isVisible().catch(() => false);
  rec({
    id: "contract-send",
    ok: /sent|copy the link/i.test(msg),
    note: msg || "Send produced no message.",
    linkShown,
    shot: await shot(page, "02c-contract-sent")
  });
}

async function proveDispute(page) {
  const link = await issuePortalLinkLocal();
  if (!link.found) {
    rec({ id: "dispute-sign", ok: false, note: "Could not issue a fresh client sign-in link." });
    return;
  }
  await page.goto(link.url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForFunction(() => /client-portal\.html/i.test(location.pathname), null, { timeout: 25000 });
  await page.waitForTimeout(800);
  const recovered = await page.evaluate(async () => {
    const t = localStorage.getItem("fh_token") || "";
    const r = await fetch("/api/auth/session", {
      headers: { accept: "application/json", authorization: "Bearer " + t }
    });
    const b = await r.json().catch(() => null);
    const staff = b && b.staff;
    const cid = staff && (staff.client_id || staff.clientId);
    if (!cid) {
      return { ok: false, status: r.status, keys: staff ? Object.keys(staff) : Object.keys(b || {}) };
    }
    localStorage.setItem("fh_account", JSON.stringify({
      clientId: cid,
      client_id: cid,
      kind: staff.role || staff.principal_kind || "client"
    }));
    return { ok: true, status: r.status };
  });
  if (!recovered.ok) {
    rec({ id: "dispute-sign", ok: false, note: "Signed in, session still did not name a client file.", recovered });
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
      shot: await shot(page, "06c-dispute-already")
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
  await shot(page, "06c-dispute-drawn");
  if (await page.locator("#cpSignSubmit").count()) await page.locator("#cpSignSubmit").click();
  await page.waitForTimeout(2500);
  const after = await page.evaluate(() => ({
    title: (document.getElementById("dispute-auth-title") || {}).textContent || "",
    msg: (document.getElementById("cpSignMsg") || {}).textContent || ""
  }));
  rec({
    id: "dispute-sign",
    ok: /already signed|signature recorded/i.test(`${after.title} ${after.msg}`),
    note: after.msg || after.title || "Submit produced no message.",
    shot: await shot(page, "06c-dispute-after")
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
    await context.clearCookies();
    await page.evaluate(() => localStorage.clear());
    await proveDispute(page);
  } finally {
    fs.writeFileSync(path.join(OUT, "findings3.json"), JSON.stringify({
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
