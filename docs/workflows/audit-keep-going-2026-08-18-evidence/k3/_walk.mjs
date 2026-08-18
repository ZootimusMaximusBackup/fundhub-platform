/**
 * K3: consent on TEST, then one Experian pull. Findings only.
 * Never open the live credit file. Do not click TransUnion.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-keep-going-2026-08-18-evidence/k3");
const BASE = "https://fundhub.ai";
const TEST = "8556bedc-46e1-4d85-b0cd-a24adfee1521";
const LIVE = "9af65808-a619-4e65-ae91-239766a006b7";

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
  const mac = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (fs.existsSync(mac)) return mac;
  return undefined;
}

async function q(sql, params) {
  const c = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  await c.connect();
  try {
    return (await c.query(sql, params)).rows;
  } finally {
    await c.end();
  }
}

fs.mkdirSync(OUT, { recursive: true });

const out = {
  at: new Date().toISOString(),
  test: TEST,
  opened_live: false,
  clicked_transunion: false,
  env_names: {
    STAFF_E2E_PASSWORD: Boolean(PASSWORD),
    DATABASE_URL: Boolean(process.env.DATABASE_URL)
  }
};

out.before = {
  consents: await q(
    `SELECT id, kind, capture_method, revoked_at IS NULL AS active, granted_at
       FROM client_consents
      WHERE client_id = $1
      ORDER BY granted_at DESC LIMIT 8`,
    [TEST]
  ),
  pulls: await q(
    `SELECT id, provider, status, created_at, crs_result_id IS NOT NULL AS has_result
       FROM soft_pull_requests
      WHERE client_id = $1
      ORDER BY created_at DESC LIMIT 5`,
    [TEST]
  ),
  client_ok: await q(
    `SELECT id = $1 AS is_test FROM clients WHERE id = $1`,
    [TEST]
  )
};

const loginRes = await fetch(BASE + "/api/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "chris@fundhub.ai", password: PASSWORD })
});
const loginJson = await loginRes.json().catch(() => ({}));
const token = loginJson.token || null;
out.login = { status: loginRes.status, ok: loginJson.ok === true, has_token: Boolean(token) };
if (!token) throw new Error("login failed");

const browser = await chromium.launch({
  headless: true,
  executablePath: chromeExe(),
  args: ["--disable-blink-features=AutomationControlled"]
});
const context = await browser.newContext({ viewport: { width: 1440, height: 980 } });
await context.addCookies([{
  name: "fundhub_session",
  value: token,
  domain: "fundhub.ai",
  path: "/",
  httpOnly: true,
  secure: true
}]);
const page = await context.newPage();
await page.addInitScript((t) => {
  try { localStorage.setItem("fh_token", t); } catch {}
}, token);
const pulls = [];
page.on("response", async (res) => {
  const url = res.url();
  if (!/\/api\/(consent\/capture|finance\/crs-pull)/.test(url)) return;
  const body = await res.json().catch(() => ({}));
  pulls.push({
    method: res.request().method(),
    path: url.replace(BASE, ""),
    status: res.status(),
    ok: body.ok ?? null,
    error: body.error || body.message || null,
    kind: body.kind || body.consent?.kind || null,
    bureau: body.bureau || null,
    has_score: body.score != null || body.scores != null
  });
});

async function go(url) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  } catch (err) {
    if (!/ERR_ABORTED/.test(String(err))) throw err;
    await page.waitForTimeout(1500);
  }
}

await go(`${BASE}/app/consent-capture.html?client_id=${TEST}&kind=soft_pull_consent`);
await page.waitForTimeout(1500);
const consentUrl = page.url();
if (consentUrl.includes(LIVE)) throw new Error("refusing live file");
out.consent_page = {
  href: consentUrl,
  id_is_test: consentUrl.includes(TEST),
  id_is_live: consentUrl.includes(LIVE)
};
out.consent_page_text = (await page.evaluate(() => (document.body?.innerText || "").replace(/\s+/g, " ").trim())).slice(0, 600);
const nameBox = page.locator("#ccName");
out.consent_form_present = (await nameBox.count()) > 0;
if (out.consent_form_present) {
  await nameBox.fill("TEST Client Role");
  await page.locator("#ccSubmit").click();
  await page.waitForTimeout(2500);
  out.consent_via = "page";
} else {
  const cap = await page.request.post(BASE + "/api/consent/capture", {
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    data: {
      client_id: TEST,
      kind: "soft_pull_consent",
      action: "grant",
      capture_method: "typed",
      granted_name: "TEST Client Role"
    }
  });
  const capJson = await cap.json().catch(() => ({}));
  out.consent_via = "api-fallback";
  out.consent_api = {
    status: cap.status(),
    ok: capJson.ok === true,
    error: capJson.error || capJson.message || null,
    kind: capJson.consent?.kind || capJson.kind || null
  };
}
out.consent_msg = await page.locator("#ccMsg").innerText().catch(() => "");
await page.screenshot({ path: path.join(OUT, "01-consent.png"), fullPage: true });

out.after_consent = {
  consents: await q(
    `SELECT id, kind, capture_method, revoked_at IS NULL AS active, granted_at
       FROM client_consents
      WHERE client_id = $1 AND kind = 'soft_pull_consent'
      ORDER BY granted_at DESC LIMIT 5`,
    [TEST]
  )
};

await go(`${BASE}/app/client-control-panel.html?id=${TEST}`);
await page.waitForTimeout(2000);
const ccp = page.url();
if (ccp.includes(LIVE)) throw new Error("refusing live file");
out.ccp = {
  href: ccp,
  id_is_test: ccp.includes(TEST),
  id_is_live: ccp.includes(LIVE),
  text: (await page.evaluate(() => (document.body?.innerText || "").replace(/\s+/g, " ").trim())).slice(0, 900)
};
await page.screenshot({ path: path.join(OUT, "02-ccp-before-pull.png"), fullPage: true });

const ex = page.locator("#ccp-pull-ex");
out.experian_present = (await ex.count()) > 0;
if (out.experian_present) {
  await ex.click();
  await page.waitForTimeout(8000);
}
out.ccp_status = await page.locator("#ccp-issue-ir-status").innerText().catch(() => "");
out.score_dashes = await page.evaluate(() => {
  const t = document.body?.innerText || "";
  return {
    ex_dash: /EX\s+[—-]/.test(t),
    eq_dash: /EQ\s+[—-]/.test(t),
    tu_dash: /TU\s+[—-]/.test(t)
  };
});
await page.screenshot({ path: path.join(OUT, "03-ccp-after-experian.png"), fullPage: true });

out.http = pulls;
out.after_pull = {
  pulls: await q(
    `SELECT id, provider, status, created_at, crs_result_id IS NOT NULL AS has_result
       FROM soft_pull_requests
      WHERE client_id = $1
      ORDER BY created_at DESC LIMIT 5`,
    [TEST]
  ),
  crs: await q(
    `SELECT COUNT(*)::int AS n FROM crs_results WHERE client_id = $1`,
    [TEST]
  )
};

await browser.close();
fs.writeFileSync(path.join(OUT, "walk.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify({
  consent_via: out.consent_via,
  consent_form_present: out.consent_form_present,
  consent_href: out.consent_page && out.consent_page.href,
  consent_msg: out.consent_msg,
  consent_n: out.after_consent.consents.length,
  experian_present: out.experian_present,
  ccp_status: out.ccp_status,
  http: out.http,
  pulls: out.after_pull.pulls,
  crs_n: out.after_pull.crs,
  opened_live: out.opened_live,
  clicked_transunion: out.clicked_transunion
}, null, 2));
