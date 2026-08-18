// K2: why magic-link portal cannot load the file. Evidence only. No secrets.
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { chromium } from "@playwright/test";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-keep-going-2026-08-18-evidence/k2");
const TEST = "8556bedc-46e1-4d85-b0cd-a24adfee1521";
const LIVE = "9af65808-a619-4e65-ae91-239766a006b7";
const BASE = "https://fundhub.ai";

function loadDotEnv() {
  const p = path.join(ROOT, ".env");
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (k && process.env[k] == null) process.env[k] = v;
  }
}

function dump(name, obj) {
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(obj, null, 2) + "\n");
}

function plusFromInbox(inbox) {
  const at = inbox.indexOf("@");
  if (at < 1) throw new Error("inbox_malformed");
  return inbox.slice(0, at) + "+e2e-fire" + inbox.slice(at);
}

function isPlusTagOfInbox(email, inbox) {
  const e = String(email || "").trim().toLowerCase();
  const i = String(inbox || "").trim().toLowerCase();
  if (!e || !i || e === i) return false;
  const [ilocal, idomain] = i.split("@");
  const [elocal, edomain] = e.split("@");
  return Boolean(ilocal && idomain && elocal && edomain
    && edomain === idomain
    && elocal.startsWith(ilocal + "+"));
}

function extractPortalLink(text) {
  const match = String(text || "").match(/https?:\/\/[^\s"'<>]+portal-login\.html\t=[A-Za-z0-9_-]+/i)
    || String(text || "").match(/https?:\/\/[^\s"'<>]+portal-login\.html\?t=[A-Za-z0-9_-]+/i);
  return match ? match[0].replace(/[.,);]+$/, "") : null;
}

function tokenLast4FromUrl(url) {
  try {
    const t = new URL(url).searchParams.get("t") || "";
    return t.length >= 4 ? t.slice(-4) : null;
  } catch {
    return null;
  }
}

function keysOf(obj) {
  if (!obj || typeof obj !== "object") return [];
  return Object.keys(obj).sort();
}

function sanitizeVerify(j) {
  const acct = j && j.account && typeof j.account === "object" ? j.account : null;
  return {
    ok: j && j.ok === true,
    has_token: Boolean(j && j.token),
    token_len: j && j.token ? String(j.token).length : 0,
    principal: j && j.principal != null ? (typeof j.principal === "string" ? j.principal : j.principal.kind || null) : null,
    next: j && j.next ? String(j.next) : null,
    account_keys: keysOf(acct),
    account_kind: acct && acct.kind ? String(acct.kind) : null,
    account_clientId: acct && (acct.clientId || acct.client_id) ? String(acct.clientId || acct.client_id) : null,
    account_clientId_is_test: Boolean(acct && (acct.clientId === TEST || acct.client_id === TEST)),
    account_clientId_is_live: Boolean(acct && (acct.clientId === LIVE || acct.client_id === LIVE)),
    error: j && j.error ? String(j.error) : null
  };
}

function sanitizeApi(j) {
  if (!j || typeof j !== "object") return { keys: [], ok: null };
  return {
    ok: j.ok === true,
    keys: keysOf(j),
    error: j.error ? String(j.error) : null,
    message: j.message ? String(j.message) : null,
    has_client: Boolean(j.client),
    has_prequal_amount: Object.prototype.hasOwnProperty.call(j, "prequal_amount"),
    has_agreements: Object.prototype.hasOwnProperty.call(j, "agreements") || Object.prototype.hasOwnProperty.call(j, "contracts"),
    agreement_count: Array.isArray(j.agreements) ? j.agreements.length
      : Array.isArray(j.contracts) ? j.contracts.length
      : Array.isArray(j.items) ? j.items.length
      : null
  };
}

loadDotEnv();
fs.mkdirSync(OUT, { recursive: true });

const inbox = String(process.env.FUNDHUB_TEST_INBOX || "").trim().toLowerCase();
const plus = plusFromInbox(inbox);
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL missing");
if (!inbox) throw new Error("FUNDHUB_TEST_INBOX missing");
if (plus === inbox) throw new Error("plus collapsed to bare inbox");

dump("00-env-names.json", {
  FUNDHUB_TEST_INBOX_set: Boolean(inbox),
  DATABASE_URL_set: Boolean(process.env.DATABASE_URL),
  plus_eq_bare_inbox: false,
  plus_has_e2e_fire_tag: plus.includes("+e2e-fire@")
});

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
await c.connect();

const alignRows = await c.query(
  `SELECT
     (SELECT lower(email) FROM clients WHERE id = $1::uuid) AS test_email,
     (SELECT lower(email) FROM clients WHERE id = $2::uuid) AS live_email,
     (SELECT count(*)::int FROM account_magic_links
        WHERE client_id = $1::uuid AND created_at > now() - interval '15 minutes') AS test_links_15m`,
  [TEST, LIVE]
);
const testEmail = alignRows.rows[0].test_email || "";
const liveEmail = alignRows.rows[0].live_email || "";
const requestEmail = isPlusTagOfInbox(testEmail, inbox) ? testEmail : plus;

dump("01-align.json", {
  test_is_plus_tag_of_inbox: isPlusTagOfInbox(testEmail, inbox),
  test_eq_bare_inbox: testEmail === inbox,
  live_eq_bare_inbox: liveEmail === inbox,
  live_eq_plus: liveEmail === plus,
  request_eq_test_email: requestEmail === testEmail,
  request_is_plus_tag: isPlusTagOfInbox(requestEmail, inbox),
  request_eq_bare_inbox: requestEmail === inbox,
  test_links_15m: alignRows.rows[0].test_links_15m,
  opened_live: false
});

if (requestEmail === inbox || liveEmail === requestEmail) {
  await c.end();
  throw new Error("refusing to request magic-link to bare inbox or live file email");
}

const magicReq = await fetch(`${BASE}/api/auth/magic-link`, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json" },
  body: JSON.stringify({ email: requestEmail })
});
const magicJson = await magicReq.json().catch(() => ({}));
dump("02-magic-request.json", {
  status: magicReq.status,
  ok: magicJson.ok === true,
  keys: keysOf(magicJson),
  error: magicJson.error || null,
  requested_plus_tag: isPlusTagOfInbox(requestEmail, inbox),
  requested_bare_inbox: false
});

await new Promise((r) => setTimeout(r, 2500));

const msgs = await c.query(
  `SELECT id, status, provider, template_key, created_at,
          (rendered_body IS NOT NULL AND length(rendered_body) > 0) AS has_body,
          rendered_body
     FROM messages
    WHERE client_id = $1::uuid
      AND (template_key = 'EMAIL-PORTAL-MAGIC-LINK'
           OR rendered_body ILIKE '%portal-login.html?t=%')
    ORDER BY created_at DESC
    LIMIT 8`,
  [TEST]
);

let link = null;
const messageStatuses = msgs.rows.map((row) => {
  const extracted = extractPortalLink(row.rendered_body);
  if (!link && extracted) link = extracted;
  return {
    id: row.id,
    status: row.status,
    provider: row.provider,
    template_key: row.template_key,
    has_body: row.has_body,
    created_at: row.created_at
  };
});

if (!link) {
  await c.end();
  dump("03-magic-link.json", { extracted: false, messageStatuses });
  throw new Error("could not extract magic-link");
}

const u = new URL(link);
dump("03-magic-link.json", {
  extracted: true,
  source: "messages.rendered_body",
  host: u.host,
  path: u.pathname,
  has_t: Boolean(u.searchParams.get("t")),
  token_last4: tokenLast4FromUrl(link),
  messageStatuses
});

if (u.host !== "fundhub.ai" || u.pathname !== "/portal-login.html" || !u.searchParams.get("t")) {
  await c.end();
  throw new Error("unexpected magic-link shape");
}

const livePortalLogin = await fetch(`${BASE}/portal-login.html`).then((r) => r.text());
const liveLogin = await fetch(`${BASE}/login.html`).then((r) => r.text());
dump("04-storage-compare.json", {
  live_portal_login_status_ok: livePortalLogin.includes("Email me a sign-in link") || livePortalLogin.includes("fh_token"),
  live_portal_login_sets_fh_token: /localStorage\.setItem\(\s*["']fh_token["']/.test(livePortalLogin),
  live_portal_login_sets_fh_account: /localStorage\.setItem\(\s*["']fh_account["']/.test(livePortalLogin),
  live_portal_login_sets_fh_role: /localStorage\.setItem\(\s*["']fh_role["']/.test(livePortalLogin),
  live_login_sets_fh_token: /localStorage\.setItem\(\s*["']fh_token["']/.test(liveLogin),
  live_login_sets_fh_account: /localStorage\.setItem\(\s*["']fh_account["']/.test(liveLogin),
  live_login_sets_fh_role: /localStorage\.setItem\(\s*["']fh_role["']/.test(liveLogin),
  note: "W1: portal-login never stores fh_account; login.html does"
});

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const pageFetches = [];
let verifyCapture = null;

page.on("response", async (res) => {
  const url = res.url();
  let pathOnly = url;
  try { pathOnly = new URL(url).pathname; } catch { /* keep */ }
  const interesting = /\/api\/(auth\/magic-link-verify|auth\/session|auth\/me|me|read\/portal-summary|read\/portal-contracts|read\/entitlements|dashboard\/client|consent\/capture|read\/documents)/.test(pathOnly);
  if (!interesting) return;
  const j = await res.json().catch(() => null);
  const rec = {
    method: res.request().method(),
    path: pathOnly,
    status: res.status(),
    body: pathOnly.includes("magic-link-verify") ? sanitizeVerify(j) : sanitizeApi(j)
  };
  pageFetches.push(rec);
  if (pathOnly.includes("magic-link-verify") && res.request().method() === "POST") {
    verifyCapture = { status: res.status(), ...sanitizeVerify(j) };
  }
});

await page.goto(link, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(6000);

if (verifyCapture && verifyCapture.account_clientId_is_live) {
  dump("05-portal.json", { stopped: "resolved_to_live_file", verifyCapture });
  await browser.close();
  await c.end();
  throw new Error("magic-link resolved to live file");
}

const finalUrl = page.url();
const storage = await page.evaluate(() => {
  let account = null;
  let accountParseError = false;
  try { account = JSON.parse(localStorage.getItem("fh_account") || "null"); } catch { accountParseError = true; }
  return {
    fh_token_present: Boolean(localStorage.getItem("fh_token")),
    fh_token_len: (localStorage.getItem("fh_token") || "").length,
    fh_role: localStorage.getItem("fh_role"),
    fh_account_raw_present: localStorage.getItem("fh_account") != null,
    fh_account_keys: account && typeof account === "object" ? Object.keys(account).sort() : [],
    fh_account_kind: account && account.kind ? String(account.kind) : null,
    fh_account_clientId: account && (account.clientId || account.client_id) ? String(account.clientId || account.client_id) : null,
    accountParseError
  };
});

const sessionFromPage = await page.evaluate(async () => {
  const t = localStorage.getItem("fh_token") || "";
  const r = await fetch("/api/auth/session", {
    headers: t ? { authorization: "Bearer " + t } : {},
    credentials: "same-origin"
  });
  const j = await r.json().catch(() => ({}));
  const p = j.principal || j.account || j.staff || {};
  return {
    status: r.status,
    ok: j.ok === true,
    keys: Object.keys(j || {}).sort(),
    principal: j.principal && j.principal.kind ? j.principal.kind : (typeof j.principal === "string" ? j.principal : j.kind || null),
    role: j.role || (j.principal && j.principal.role) || null,
    client_id: j.clientId || j.client_id
      || (j.principal && (j.principal.clientId || j.principal.client_id))
      || (j.account && (j.account.clientId || j.account.client_id))
      || null,
    name: j.name || (j.principal && j.principal.name) || (j.staff && j.staff.name) || null
  };
}).catch((e) => ({ error: String(e && e.message || e) }));

const probeFromPage = await page.evaluate(async () => {
  const t = localStorage.getItem("fh_token") || "";
  const headers = t ? { authorization: "Bearer " + t, accept: "application/json" } : { accept: "application/json" };
  async function hit(path) {
    const r = await fetch(path, { headers, credentials: "same-origin" });
    const j = await r.json().catch(() => ({}));
    return {
      path,
      status: r.status,
      keys: Object.keys(j || {}).sort(),
      ok: j.ok === true,
      error: j.error || null,
      message: j.message || null,
      has_prequal_amount: Object.prototype.hasOwnProperty.call(j, "prequal_amount"),
      has_agreements: Object.prototype.hasOwnProperty.call(j, "agreements") || Object.prototype.hasOwnProperty.call(j, "contracts")
    };
  }
  return {
    portal_summary: await hit("/api/read/portal-summary"),
    portal_contracts: await hit("/api/read/portal-contracts")
  };
}).catch((e) => ({ error: String(e && e.message || e) }));

const bodyText = await page.evaluate(() => (document.body && document.body.innerText || "").slice(0, 8000));
const urlObj = (() => { try { return new URL(finalUrl); } catch { return null; } })();

await page.screenshot({ path: path.join(OUT, "01-file-paint.png"), fullPage: true });

const portal = {
  opened_magic_link: true,
  staff_open: false,
  final_host: urlObj && urlObj.host,
  final_path: urlObj && urlObj.pathname,
  url_has_id: Boolean(urlObj && (urlObj.searchParams.get("id") || urlObj.searchParams.get("client_id"))),
  url_id_is_test: Boolean(urlObj && (urlObj.searchParams.get("id") === TEST || urlObj.searchParams.get("client_id") === TEST)),
  url_id_is_live: Boolean(urlObj && (urlObj.searchParams.get("id") === LIVE || urlObj.searchParams.get("client_id") === LIVE)),
  verify: verifyCapture,
  storage: {
    ...storage,
    fh_account_clientId_is_test: storage.fh_account_clientId === TEST,
    fh_account_clientId_is_live: storage.fh_account_clientId === LIVE
  },
  session: {
    ...sessionFromPage,
    client_id_is_test: sessionFromPage && sessionFromPage.client_id === TEST,
    client_id_is_live: sessionFromPage && sessionFromPage.client_id === LIVE
  },
  page_initiated_fetches: pageFetches,
  page_called_portal_summary: pageFetches.some((f) => f.path.includes("portal-summary")),
  page_called_portal_contracts: pageFetches.some((f) => f.path.includes("portal-contracts")),
  probe_with_session_token: probeFromPage,
  saw_welcome_back_test: /Welcome back,\s*TEST/i.test(bodyText),
  saw_could_not_load: /could not load your file/i.test(bodyText),
  hero_empty: /Welcome video is not available/i.test(bodyText),
  entitlements_line: (/live entitlements · \d+ unlocked · \d+ locked/i.exec(bodyText) || [null])[0],
  dispute_sign_in_needed: /Sign in to load the legal wording|sign in/i.test(bodyText),
  did_not_press_sign: true,
  did_not_open_live: true
};

const hop = (() => {
  if (!storage.fh_token_present && !(sessionFromPage && sessionFromPage.ok)) return "session missing";
  if (sessionFromPage && sessionFromPage.client_id && sessionFromPage.client_id !== TEST) return "wrong id";
  if (portal.page_called_portal_summary) {
    const sum = pageFetches.find((f) => f.path.includes("portal-summary"));
    if (sum && sum.status === 401) return "API 401";
    if (sum && sum.status === 200) return "API 200 empty";
  }
  if (!storage.fh_account_clientId && !portal.url_has_id && portal.saw_could_not_load) {
    return "front-end quit";
  }
  return "unclassified";
})();
portal.broken_hop = hop;

dump("05-portal.json", portal);
dump("06-fetches.json", {
  page_initiated: pageFetches,
  probe_with_session_token: probeFromPage
});
dump("07-session-compare.json", {
  test_id: TEST,
  fh_account_clientId: storage.fh_account_clientId,
  session_client_id: sessionFromPage && sessionFromPage.client_id,
  verify_account_clientId: verifyCapture && verifyCapture.account_clientId,
  match_fh_account_vs_test: storage.fh_account_clientId === TEST,
  match_session_vs_test: sessionFromPage && sessionFromPage.client_id === TEST,
  match_verify_vs_test: verifyCapture && verifyCapture.account_clientId === TEST,
  portal_login_wrote_fh_account: storage.fh_account_raw_present,
  broken_hop: hop
});

await browser.close();

const liveGuard = await c.query(
  `SELECT
     (SELECT count(*)::int FROM events WHERE client_id = $1::uuid AND created_at > now() - interval '20 minutes') AS live_events_20m,
     (SELECT count(*)::int FROM messages WHERE client_id = $1::uuid AND created_at > now() - interval '20 minutes') AS live_messages_20m`,
  [LIVE]
);
dump("08-live-guard.json", { opened_live: false, ...liveGuard.rows[0] });

await c.end();

console.log(JSON.stringify({
  magic_status: magicReq.status,
  extracted: true,
  hop,
  saw_could_not_load: portal.saw_could_not_load,
  fh_account_present: storage.fh_account_raw_present,
  session_is_test: sessionFromPage && sessionFromPage.client_id === TEST,
  page_called_portal_summary: portal.page_called_portal_summary
}));
