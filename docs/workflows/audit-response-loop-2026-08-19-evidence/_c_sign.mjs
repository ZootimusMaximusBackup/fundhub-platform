// Open sign link, prove view, sign, run_reminders. Findings only.
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-response-loop-2026-08-19-evidence");
const SHOTS = path.join(OUT, "shots");
const DUMPS = path.join(OUT, "dumps");
const BASE = "https://fundhub.ai";
const FORBIDDEN = "9af65808-a619-4e65-ae91-239766a006b7";
const SIGN_NAME = "TEST — Response Loop";
const session = JSON.parse(fs.readFileSync("/tmp/p3-response-loop-session.json", "utf8"));

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

function chromeExe() {
  const home = process.env.HOME || "";
  const root = path.join(home, "Library/Caches/ms-playwright");
  if (!fs.existsSync(root)) return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const dirs = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const d of dirs) {
    const exe = path.join(root, d, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
    if (fs.existsSync(exe)) return exe;
  }
  return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
}

function db() {
  return new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
}
async function query(sql, params = []) {
  const c = db();
  await c.connect();
  try { return (await c.query(sql, params)).rows; }
  finally { await c.end(); }
}
function writeDump(name, obj) {
  fs.writeFileSync(path.join(DUMPS, name), JSON.stringify(obj, null, 2));
}

async function signerState() {
  const c = (await query(
    `SELECT id, status, viewed_at, view_count FROM contracts WHERE id = $1`,
    [session.contract_id]
  ))[0];
  const s = (await query(
    `SELECT id, status, viewed_at, view_count FROM contract_signers WHERE contract_id = $1`,
    [session.contract_id]
  ))[0];
  return {
    contract: c && { id: c.id, status: c.status, viewed_at: c.viewed_at, view_count: c.view_count },
    signer: s && { id: s.id, status: s.status, viewed_at: s.viewed_at, view_count: s.view_count }
  };
}

async function main() {
  if (session.client_id === FORBIDDEN) throw new Error("forbidden");
  const before = await signerState();
  writeDump("10-before-view.json", before);

  const browser = await chromium.launch({ headless: true, executablePath: chromeExe() });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  let signHttp = null;
  let getHttp = null;
  page.on("response", (res) => {
    if (/\/api\/contracts\/sign/.test(res.url())) {
      const rec = { status: res.status(), method: res.request().method() };
      if (res.request().method() === "GET") getHttp = rec;
      if (res.request().method() === "POST") signHttp = rec;
    }
  });

  await page.goto(session.sign_link, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(2500);
  const opened = await page.evaluate(() => ({
    title: (document.getElementById("title") || {}).textContent || "",
    canSign: !!(document.getElementById("signPanel") && document.getElementById("signPanel").style.display !== "none"),
    problem: (document.getElementById("problemText") || {}).textContent || "",
    badge: (document.getElementById("sub") || {}).innerText || "",
    done: (document.getElementById("doneText") || {}).textContent || ""
  }));
  await page.screenshot({ path: path.join(SHOTS, "03-contract-open.png") });
  const afterView = await signerState();
  writeDump("11-after-view.json", { opened, getHttp, afterView, link_source: "send_response_not_gmail_body" });

  if (opened.canSign) {
    await page.locator("#name").fill(SIGN_NAME);
    const agree = page.locator("#agree");
    if (await agree.count()) await agree.check();
    await page.screenshot({ path: path.join(SHOTS, "04-contract-ready.png") });
    await page.locator("#go").click();
    await page.waitForTimeout(3500);
  }
  const afterUi = await page.evaluate(() => ({
    done: (document.getElementById("doneText") || {}).textContent || "",
    msg: (document.getElementById("msg") || {}).textContent || "",
    badge: (document.getElementById("sub") || {}).innerText || "",
    doneVisible: !!(document.getElementById("donePanel") && document.getElementById("donePanel").style.display !== "none")
  }));
  await page.screenshot({ path: path.join(SHOTS, "05-contract-signed.png") });

  const afterSign = await signerState();
  writeDump("12-after-sign.json", { afterUi, signHttp, afterSign });

  // Staff documents page — view/opened badge
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "chris@fundhub.ai", password: PASSWORD })
  });
  const loginJson = await loginRes.json().catch(() => ({}));
  const token = loginJson.token || null;
  if (token) {
    await context.addCookies([{
      name: "fundhub_session",
      value: token,
      url: BASE
    }]);
    const staff = await context.newPage();
    await staff.goto(`${BASE}/app/documents.html?client_id=${session.client_id}`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await staff.waitForTimeout(3000);
    const staffText = await staff.evaluate(() => (document.body && document.body.innerText || "").slice(0, 4000));
    await staff.screenshot({ path: path.join(SHOTS, "06-staff-documents.png") });
    writeDump("13-staff-documents.json", {
      url: staff.url(),
      has_opened: /opened/i.test(staffText),
      has_signed: /signed/i.test(staffText),
      has_viewed: /viewed/i.test(staffText),
      has_sent: /\bsent\b/i.test(staffText),
      snippet_has_funding: /Funding Agreement/i.test(staffText)
    });

    const remindSweep = await fetch(`${BASE}/api/contracts`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        cookie: `fundhub_session=${token}`
      },
      body: JSON.stringify({ action: "run_reminders" })
    });
    const sweepJson = await remindSweep.json().catch(() => ({}));
    writeDump("14-run-reminders.json", {
      status: remindSweep.status,
      ok: sweepJson.ok === true,
      message: sweepJson.message || null,
      result: sweepJson.result || null
    });

    const remindOne = await fetch(`${BASE}/api/contracts`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        cookie: `fundhub_session=${token}`
      },
      body: JSON.stringify({ action: "remind", id: session.contract_id })
    });
    const oneJson = await remindOne.json().catch(() => ({}));
    writeDump("15-remind-one.json", {
      status: remindOne.status,
      ok: oneJson.ok === true,
      message: oneJson.message || null,
      error: oneJson.error || null
    });
  }

  const msgs = await query(
    `SELECT id, template_key, status, provider, created_at
       FROM messages WHERE client_id = $1 ORDER BY created_at`,
    [session.client_id]
  );
  writeDump("16-messages-after-remind.json", {
    messages: msgs.map((m) => ({
      id: m.id, template_key: m.template_key, status: m.status, provider: m.provider, created_at: m.created_at
    }))
  });

  await browser.close();
  console.log(JSON.stringify({
    view_count_after_open: afterView.contract && afterView.contract.view_count,
    viewed_at_set: Boolean(afterView.contract && afterView.contract.viewed_at),
    contract_status_after_open: afterView.contract && afterView.contract.status,
    signed_status: afterSign.contract && afterSign.contract.status,
    client_badge_open: opened.badge,
    client_badge_after: afterUi.badge
  }));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err.message }));
  process.exit(1);
});
