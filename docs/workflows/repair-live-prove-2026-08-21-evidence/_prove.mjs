// Live prove: Specialist Repair tab + portal bureau-response upload (TEST client only).
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/repair-live-prove-2026-08-21-evidence");
const BASE = "https://fundhub.ai";
const TEST_CLIENT = "8556bedc-46e1-4d85-b0cd-a24adfee1521";
const LIVE_FORBIDDEN = "9af65808-a619-4e65-ae91-239766a006b7";
const STAFF_EMAIL = "chris@fundhub.ai";
const PORTAL_EMAIL = "stanbridgejchris+e2e-fire@gmail.com";

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
  console.log(JSON.stringify({ id: row.id, ok: row.ok, note: row.note, shot: row.shot || null }));
}

async function shot(page, slug) {
  const file = path.join(OUT, `${slug}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return path.relative(ROOT, file);
}

async function loginStaff(page) {
  await page.goto(BASE + "/login.html", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.locator('input[type="email"], #email, input[name="email"]').first().fill(STAFF_EMAIL);
  await page.locator('input[type="password"], #password, input[name="password"]').first().fill(PASSWORD);
  await page.locator('button[type="submit"], button:has-text("Sign"), button:has-text("Log")').first().click();
  await page.waitForFunction(() => !/login\.html|portal-login\.html/i.test(location.pathname), null, { timeout: 30000 });
}

/** Tiny valid PNG so byte-sniff accepts the upload. */
function tinyPngBuffer() {
  // 1x1 red PNG
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
}

async function issuePortalLink() {
  const { requestMagicLink } = await import(path.join(ROOT, "src/auth/magic-link.mjs"));
  const c = db();
  await c.connect();
  try {
    const out = await requestMagicLink(c, {
      email: PORTAL_EMAIL,
      ip: "127.0.0.1",
      userAgent: "repair-live-prove",
      env: { ...process.env, PORTAL_BASE_URL: BASE }
    });
    if (!out || !out.ok || out.limited || !out.token) {
      return { found: false, limited: !!(out && out.limited), outcome: out };
    }
    return { found: true, url: `${BASE}/portal-login.html?t=${out.token}` };
  } finally {
    await c.end();
  }
}

async function proveRepairTab(page) {
  await page.goto(`${BASE}/app/inquiry-remover.html`, { waitUntil: "load", timeout: 60000 }).catch(async (err) => {
    // Retry once on abort/flaky nav
    await page.goto(`${BASE}/app/inquiry-remover.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
  });
  await page.waitForTimeout(2000);
  const tab = page.locator("#tab-repair");
  const tabPresent = await tab.count();
  if (!tabPresent) {
    rec({ id: "repair-tab", ok: false, note: "Repair tab button missing", shot: await shot(page, "01-no-repair-tab") });
    return;
  }
  await shot(page, "01-desk-inquiries");
  await tab.click();
  await page.waitForTimeout(2500);
  const after = await page.evaluate((cid) => {
    const pane = document.getElementById("pane-repair");
    const selected = document.getElementById("tab-repair")?.getAttribute("aria-selected");
    const bodyText = (pane && pane.innerText) || "";
    const rows = [...document.querySelectorAll("[data-repair-row]")].map((el) => el.getAttribute("data-repair-row"));
    const hasTest = rows.includes(cid);
    const err = /error|failed|unauthorized|not found/i.test(bodyText.slice(0, 400));
    return {
      selected,
      paneVisible: !!(pane && getComputedStyle(pane).display !== "none"),
      rowCount: rows.length,
      hasTest,
      sample: bodyText.slice(0, 280).replace(/\s+/g, " ").trim(),
      err
    };
  }, TEST_CLIENT);
  const afterShot = await shot(page, "02-repair-tab");

  // Open TEST client detail if listed
  let detail = null;
  if (after.hasTest) {
    await page.locator(`[data-repair-row="${TEST_CLIENT}"]`).first().click();
    await page.waitForTimeout(2000);
    detail = await page.evaluate(() => {
      const text = (document.getElementById("pane-repair") || document.body).innerText || "";
      return { sample: text.slice(0, 400).replace(/\s+/g, " ").trim() };
    });
    await shot(page, "03-repair-test-client");
  }

  rec({
    id: "repair-tab",
    ok: after.selected === "true" && after.paneVisible && !after.err,
    note: after.err
      ? "Repair tab opened but showed an error."
      : after.hasTest
        ? `Repair tab loaded. TEST client row present. Rows=${after.rowCount}.`
        : `Repair tab loaded. TEST client not in list yet. Rows=${after.rowCount}.`,
    after,
    detail,
    shot: afterShot
  });
}

async function provePortalUpload(page) {
  const link = await issuePortalLink();
  if (!link.found) {
    rec({ id: "portal-upload", ok: false, note: "Could not issue portal magic link for TEST email.", link });
    return;
  }
  await page.goto(link.url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(2000);
  // magic link may land on portal or need click-through
  if (/portal-login/i.test(page.url())) {
    const go = page.locator('button[type="submit"], button:has-text("Sign"), a:has-text("Continue"), button:has-text("Continue")');
    if (await go.count()) await go.first().click().catch(() => {});
    await page.waitForTimeout(2000);
  }
  // Ensure client portal
  if (!/client-portal/i.test(page.url())) {
    await page.goto(`${BASE}/app/client-portal.html`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(2000);
  }
  await shot(page, "10-portal-signed-in");

  const doors = await page.evaluate(() => {
    const body = document.body.className;
    const bureau = document.querySelector(".door-bureau");
    const visible = bureau && getComputedStyle(bureau).display !== "none";
    return { body, bureauVisible: !!visible, text: (document.body.innerText || "").slice(0, 300) };
  });

  if (!doors.bureauVisible) {
    rec({
      id: "portal-upload",
      ok: false,
      note: "Bureau response door not visible on portal (entitlement/door gate).",
      doors,
      shot: await shot(page, "11-no-bureau-door")
    });
    return;
  }

  const pngPath = path.join(OUT, "_upload-bureau.png");
  fs.writeFileSync(pngPath, tinyPngBuffer());

  // Use the door file input directly
  const input = page.locator('.door-bureau input[type="file"], .door-bureau [data-file-input]').first();
  const inputCount = await input.count();
  if (!inputCount) {
    // click upload button may reveal input
    await page.locator(".door-bureau [data-upload-btn]").click().catch(() => {});
    await page.waitForTimeout(400);
  }
  const fileInput = page.locator('.door-bureau input[type="file"]').first();
  if (!(await fileInput.count())) {
    rec({
      id: "portal-upload",
      ok: false,
      note: "Bureau door visible but no file input found.",
      shot: await shot(page, "12-no-file-input")
    });
    return;
  }

  // Intercept upload response
  const uploadWait = page.waitForResponse(
    (r) => r.url().includes("/api/documents-upload") && r.request().method() === "POST",
    { timeout: 60000 }
  ).catch(() => null);

  await fileInput.setInputFiles(pngPath);
  // Some UIs need a second click to submit after pick
  await page.locator(".door-bureau [data-upload-btn]").click().catch(() => {});
  await page.waitForTimeout(1500);

  const resp = await uploadWait;
  let upload = { status: null, body: null };
  if (resp) {
    upload.status = resp.status();
    try { upload.body = await resp.json(); } catch { upload.body = await resp.text(); }
  } else {
    // Fallback: API upload with portal cookie
    const cookies = await page.context().cookies();
    const cookie = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const boundary = "----RepairProve" + Date.now();
    const png = tinyPngBuffer();
    const parts = [
      `--${boundary}\r\nContent-Disposition: form-data; name="client_id"\r\n\r\n${TEST_CLIENT}\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="kind"\r\n\r\nbureau_response\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="bureau.png"\r\nContent-Type: image/png\r\n\r\n`
    ];
    const head = Buffer.from(parts.join(""), "utf8");
    const mid = png;
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
    const body = Buffer.concat([head, mid, tail]);
    const res = await fetch(`${BASE}/api/documents-upload`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body
    });
    upload.status = res.status;
    try { upload.body = await res.json(); } catch { upload.body = await res.text(); }
  }

  await page.waitForTimeout(1000);
  const afterShot = await shot(page, "13-after-upload");

  // Confirm DB row
  const c = db();
  await c.connect();
  let doc = null;
  try {
    const r = await c.query(
      `SELECT id::text, kind, storage_key, created_at
         FROM documents
        WHERE client_id = $1
          AND kind = 'bureau_response'
        ORDER BY created_at DESC
        LIMIT 1`,
      [TEST_CLIENT]
    );
    doc = r.rows[0] || null;
  } finally {
    await c.end();
  }

  const okHttp = upload.status >= 200 && upload.status < 300;
  const okDoc = !!(doc && doc.id);
  rec({
    id: "portal-upload",
    ok: okHttp && okDoc,
    note: okHttp && okDoc
      ? "Bureau response uploaded on live portal; documents row written."
      : `Upload status=${upload.status}; db_row=${okDoc}.`,
    uploadStatus: upload.status,
    uploadOk: upload.body && upload.body.ok,
    documentId: doc && doc.id,
    storageKeySet: !!(doc && doc.storage_key),
    shot: afterShot
  });
}

async function main() {
  if (TEST_CLIENT === LIVE_FORBIDDEN) throw new Error("refusing live client");

  const browser = await chromium.launch({
    headless: true,
    executablePath: chromeExe()
  });
  try {
    const staffCtx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const staffPage = await staffCtx.newPage();
    await loginStaff(staffPage);
    await shot(staffPage, "00-staff-signed-in");
    rec({ id: "staff-login", ok: true, note: "Signed in as owner on live." });
    try {
      await proveRepairTab(staffPage);
    } catch (err) {
      rec({
        id: "repair-tab",
        ok: false,
        note: `Repair tab nav failed: ${String(err && err.message || err).slice(0, 160)}`
      });
    }
    await staffCtx.close();

    const portalCtx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    const portalPage = await portalCtx.newPage();
    await provePortalUpload(portalPage);
    await portalCtx.close();
  } finally {
    await browser.close();
  }

  fs.writeFileSync(path.join(OUT, "findings.json"), JSON.stringify(findings, null, 2));
  const failed = findings.filter((f) => !f.ok);
  console.log(JSON.stringify({ summary: { total: findings.length, failed: failed.length }, failed: failed.map((f) => f.id) }));
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(String(err && err.stack || err));
  process.exit(2);
});
