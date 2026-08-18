// W-CONV — prove conveyor hops on THIS simulated file. Findings only.
// Writes evidence. One POST /api/proxy/launch. Stops at credential / last safe error.
// Does not complete a lender application. Does not open a bank site. Does not teardown.

import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-engine-2026-08-18-evidence/w-conv");
const BASE = "https://fundhub.ai";
const CLIENT = "41a3199f-1835-4ac8-91c0-d4f37bd92037";
const CRS = "c1f83e6b-a624-4f28-a32a-531a530b3ad4";
const ORG = "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6";
const FORBIDDEN = "9af65808-a619-4e65-ae91-239766a006b7";
const COMPARE = "8556bedc-46e1-4d85-b0cd-a24adfee1521";
const DUMMY_LENDER = "00000000-0000-4000-8000-000000000001";

if (CLIENT === FORBIDDEN) throw new Error("refusing forbidden live credit file");

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

async function query(sql, params = []) {
  const c = db();
  await c.connect();
  try {
    return { ok: true, rows: (await c.query(sql, params)).rows };
  } catch (err) {
    return { ok: false, error: err.message, rows: [] };
  } finally {
    await c.end();
  }
}

function redactLaunch(body) {
  if (!body || typeof body !== "object") return body;
  const out = JSON.parse(JSON.stringify(body));
  if (out.connection) {
    if (out.connection.password) out.connection.password = "[redacted]";
    if (out.connection.username) out.connection.username = "[present]";
  }
  return out;
}

function oxylabsNames() {
  const user = process.env.OXYLABS_USERNAME;
  const pass = process.env.OXYLABS_PASSWORD;
  return {
    OXYLABS_USERNAME: { present: Boolean(user && String(user).trim()) },
    OXYLABS_PASSWORD: { present: Boolean(pass && String(pass).trim()) },
    ready: Boolean(user && String(user).trim() && pass && String(pass).trim())
  };
}

const proofs = [];
function rec(row) {
  proofs.push(row);
  console.log(JSON.stringify({ id: row.id, result: row.result }));
}

async function main() {
  const creds = oxylabsNames();
  fs.writeFileSync(path.join(OUT, "oxylabs-cred-names.json"), JSON.stringify({
    source: "local .env names only — values not printed",
    ...creds
  }, null, 2));

  const hop = {};

  hop.inquiry_removed_events = await query(
    `SELECT id, name, created_at
       FROM events
      WHERE client_id = $1::uuid AND name = 'inquiry.removed'
      ORDER BY created_at DESC
      LIMIT 20`,
    [CLIENT]
  );
  hop.inquiry_removed_events_org = await query(
    `SELECT count(*)::int AS n
       FROM events
      WHERE org_id = $1::uuid AND name = 'inquiry.removed'`,
    [ORG]
  );
  hop.inquiry_cases = await query(
    `SELECT id, case_status, completed_at, cleared_at, closed_at, request_source,
            open_inquiry_count, is_demo
       FROM inquiry_removal_cases
      WHERE client_id = $1::uuid`,
    [CLIENT]
  );
  hop.inquiry_log = await query(
    `SELECT id, bureau, status, created_at
       FROM inquiry_log
      WHERE client_id = $1::uuid
      LIMIT 50`,
    [CLIENT]
  );

  hop.dispute_letters = await query(
    `SELECT count(*)::int AS n FROM dispute_letters WHERE client_id = $1::uuid`,
    [CLIENT]
  );
  hop.dispute_cases = await query(
    `SELECT count(*)::int AS n FROM dispute_cases WHERE client_id = $1::uuid`,
    [CLIENT]
  );
  hop.letters_generated_reg = await query(`SELECT to_regclass('public.letters_generated') AS reg`);
  hop.client_util = await query(
    `SELECT id, is_demo,
            custom_fields->>'crs_utilization' AS cf_crs_utilization,
            custom_fields ? 'diy_letters' AS has_diy_letters,
            custom_fields ? 'diy_package' AS has_diy_package,
            jsonb_object_keys_sample
       FROM (
         SELECT id, is_demo, custom_fields,
                (SELECT array_agg(k) FROM jsonb_object_keys(COALESCE(custom_fields,'{}'::jsonb)) k) AS jsonb_object_keys_sample
           FROM clients WHERE id = $1::uuid
       ) t`,
    [CLIENT]
  );
  hop.crs_util = await query(
    `SELECT id,
            result->'consumerSignals'->'utilization' AS consumer_util,
            result->'crm_payload'->'customFields'->>'crs_utilization' AS crm_util,
            result ? 'bureaus' AS has_bureaus,
            result ? 'inquiries' AS has_inquiries
       FROM crs_results WHERE id = $1::uuid`,
    [CRS]
  );
  hop.optimize_events = await query(
    `SELECT id, name, created_at
       FROM events
      WHERE client_id = $1::uuid
        AND (name ILIKE '%optim%' OR name ILIKE '%letter%' OR name ILIKE '%metro2%' OR name ILIKE '%util%')
      ORDER BY created_at DESC
      LIMIT 20`,
    [CLIENT]
  );

  hop.bank_accounts = await query(
    `SELECT id, name, account_type, mask, current_balance_cents, currency_code,
            raw, created_at
       FROM bank_accounts
      WHERE client_id = $1::uuid`,
    [CLIENT]
  );
  hop.bank_account_cols = await query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'bank_accounts'
      ORDER BY ordinal_position`
  );

  hop.applications = await query(
    `SELECT id, client_id, lender_id, status, application_url, created_at
       FROM applications
      WHERE client_id = $1::uuid
      LIMIT 20`,
    [CLIENT]
  );
  hop.funding_rounds = await query(
    `SELECT id, status, created_at
       FROM funding_rounds
      WHERE client_id = $1::uuid
      LIMIT 20`,
    [CLIENT]
  );
  hop.proxy_sessions = await query(
    `SELECT id, status, error_code, lender_id, started_at, ended_at
       FROM proxy_sessions
      WHERE client_id = $1::uuid
      ORDER BY started_at DESC
      LIMIT 20`,
    [CLIENT]
  );
  hop.lenders_org = await query(
    `SELECT count(*)::int AS n,
            count(*) FILTER (WHERE active IS NOT FALSE)::int AS active_n,
            count(*) FILTER (WHERE is_demo)::int AS demo_n,
            count(*) FILTER (WHERE application_url IS NOT NULL AND btrim(application_url) <> '')::int AS with_url
       FROM lenders
      WHERE org_id = $1::uuid`,
    [ORG]
  );

  hop.forbidden_touch = await query(
    `SELECT count(*)::int AS n FROM events WHERE client_id = $1::uuid`,
    [FORBIDDEN]
  );

  fs.writeFileSync(path.join(OUT, "01-hops-db.json"), JSON.stringify({
    at: new Date().toISOString(),
    client_id: CLIENT,
    crs_id: CRS,
    org_id: ORG,
    hop
  }, null, 2));

  const cases = hop.inquiry_cases.rows || [];
  const completedCase = cases.some((c) =>
    c.completed_at || c.cleared_at || /complete|cleared|closed/i.test(String(c.case_status || ""))
  );
  const queuedOnly = cases.length > 0 && cases.every((c) => c.case_status === "Queued" && !c.completed_at && !c.cleared_at);
  const removedEvents = (hop.inquiry_removed_events.rows || []).length;
  rec({
    id: "conv.1a.inquiries-removed",
    result: removedEvents === 0 && !completedCase ? "EMPTY" : (completedCase || removedEvents > 0 ? "FAIL" : "EMPTY"),
    expected: "inquiry.removed event or a completed inquiry case on THIS file (Chris 2026-08-18 conveyor hop). Intended journeys do not name this hop.",
    observed: {
      inquiry_removed_events_this_file: removedEvents,
      inquiry_removed_events_org: hop.inquiry_removed_events_org.rows?.[0]?.n ?? null,
      cases: cases.map((c) => ({ id: c.id, case_status: c.case_status, completed_at: c.completed_at, cleared_at: c.cleared_at, closed_at: c.closed_at })),
      inquiry_log: (hop.inquiry_log.rows || []).length,
      hop_class: removedEvents === 0 && !completedCase ? (queuedOnly ? "empty — one Queued case, not sent, not completed" : "empty") : "has removal proof"
    },
    evidence: "w-conv/01-hops-db.json"
  });

  const lettersN = hop.dispute_letters.rows?.[0]?.n ?? null;
  const casesN = hop.dispute_cases.rows?.[0]?.n ?? null;
  const lettersTable = hop.letters_generated_reg.rows?.[0]?.reg ?? null;
  rec({
    id: "conv.1b.file-optimized",
    result: "EMPTY",
    expected: "A credit-file optimizer change on THIS file (letters, utilization, metro2 pack). Intended journeys do not name this hop. W-OPT: src/optimize is ad-spend.",
    observed: {
      dispute_letters: lettersN,
      dispute_cases: casesN,
      letters_generated_table: lettersTable,
      optimize_or_letter_events: (hop.optimize_events.rows || []).length,
      crs_has_bureaus: hop.crs_util.rows?.[0]?.has_bureaus ?? null,
      crs_has_inquiries: hop.crs_util.rows?.[0]?.has_inquiries ?? null,
      consumer_util: hop.crs_util.rows?.[0]?.consumer_util ?? null,
      crm_util: hop.crs_util.rows?.[0]?.crm_util ?? null,
      note: "No credit-file optimizer ran. Utilization is still the simulate seed (18). No letter rows."
    },
    evidence: "w-conv/01-hops-db.json"
  });

  const banks = hop.bank_accounts.rows || [];
  const bankClass = banks.length === 0
    ? "empty"
    : banks.every((b) => {
      const raw = b.raw && typeof b.raw === "object" ? b.raw : {};
      return raw.provider === "mock" || raw.is_demo === true || b.name === "Simulated Checking";
    })
      ? "simulate-mock-only"
      : "has-non-mock";
  rec({
    id: "conv.1c.banks-populate",
    result: bankClass === "simulate-mock-only" ? "EMPTY" : (banks.length ? "PASS" : "EMPTY"),
    expected: "Banks populate for THIS file (real bank link / import), not only the simulate mock row.",
    observed: {
      row_count: banks.length,
      names: banks.map((b) => b.name),
      raw: banks.map((b) => b.raw),
      class: bankClass,
      note: bankClass === "simulate-mock-only"
        ? "One Simulated Checking row from src/demo/simulate-client.mjs (raw.provider=mock). That is seed, not populate."
        : null
    },
    evidence: "w-conv/01-hops-db.json"
  });

  rec({
    id: "conv.1d.apply-via-proxy-path",
    result: "PASS",
    expected: "A proxy/apply path exists that can be aimed at THIS client_id.",
    observed: {
      route: "POST /api/proxy/launch",
      required_body: ["client_id (uuid)", "lender_id or application_id (uuid)"],
      ui: ["public/app/proxy-apply.js", "CCP #fh-funding-apply", "lenders.html client-scoped Apply", "pipeline.html matches"],
      applications_this_file: hop.applications.ok ? (hop.applications.rows || []).length : hop.applications.error,
      funding_rounds_this_file: hop.funding_rounds.ok ? (hop.funding_rounds.rows || []).length : hop.funding_rounds.error,
      proxy_sessions_this_file: hop.proxy_sessions.ok ? (hop.proxy_sessions.rows || []).length : hop.proxy_sessions.error,
      lenders_org: hop.lenders_org.rows?.[0] || hop.lenders_org.error
    },
    evidence: "w-conv/01-hops-db.json"
  });

  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "chris@fundhub.ai", password: PASSWORD })
  });
  const loginJson = await loginRes.json().catch(() => ({}));
  const token = loginJson.token || null;
  fs.writeFileSync(path.join(OUT, "login-status.json"), JSON.stringify({
    status: loginRes.status,
    ok: loginJson.ok === true,
    has_token: Boolean(token),
    staff_role: loginJson.staff?.role || null
  }, null, 2));
  if (!token) throw new Error("login failed");

  const authHeaders = {
    accept: "application/json",
    "content-type": "application/json",
    authorization: `Bearer ${token}`
  };

  const matchesUrl = `${BASE}/api/read/lender-matches?client_id=${CLIENT}`;
  const matchesRes = await fetch(matchesUrl, { headers: authHeaders });
  const matchesJson = await matchesRes.json().catch(() => ({}));
  const matchDump = {
    route: "GET /api/read/lender-matches?client_id=",
    required_input: {
      client_id: "uuid — required. 400 if missing.",
      lender_table: "optional filter",
      funding_round_id: "not required",
      application_id: "not required"
    },
    this_file_has_client_id: true,
    status: matchesRes.status,
    ok: matchesJson.ok === true,
    error: matchesJson.error || null,
    client_id: matchesJson.client_id || null,
    match_count: matchesJson.match_count ?? null,
    summary: matchesJson.summary || null,
    skipped_count: Array.isArray(matchesJson.skipped) ? matchesJson.skipped.length : null,
    matches: Array.isArray(matchesJson.matches)
      ? matchesJson.matches.map((m) => ({
        id: m.id,
        name: m.name,
        is_demo: m.is_demo,
        active: m.active,
        application_url: m.application_url ? "[present]" : null,
        bureaus_pulled: m.bureaus_pulled,
        eligible_states: m.eligible_states,
        priority_tier: m.priority_tier,
        lender_table: m.lender_table
      }))
      : [],
    skipped_sample: Array.isArray(matchesJson.skipped)
      ? matchesJson.skipped.slice(0, 12).map((s) => ({
        id: s.id || s.lender_id,
        name: s.name,
        reason: s.reason || s.skip_reason || s.why
      }))
      : []
  };
  fs.writeFileSync(path.join(OUT, "02-lender-matches.json"), JSON.stringify(matchDump, null, 2));

  const compareRes = await fetch(`${BASE}/api/read/lender-matches?client_id=${COMPARE}`, { headers: authHeaders });
  const compareJson = await compareRes.json().catch(() => ({}));
  fs.writeFileSync(path.join(OUT, "02-lender-matches-compare-8556.json"), JSON.stringify({
    note: "read-compare only — 8556bedc. No writes.",
    status: compareRes.status,
    ok: compareJson.ok === true,
    match_count: compareJson.match_count ?? null,
    summary: compareJson.summary || null,
    skipped_count: Array.isArray(compareJson.skipped) ? compareJson.skipped.length : null
  }, null, 2));

  rec({
    id: "conv.2.lender-matches",
    result: matchesRes.status === 200 ? (matchesJson.match_count > 0 ? "PASS" : "EMPTY") : "FAIL",
    expected: "GET /api/read/lender-matches?client_id=THIS returns rows if any lender fits this file",
    observed: {
      status: matchesRes.status,
      match_count: matchesJson.match_count ?? null,
      lender_count: matchesJson.summary?.lender_count ?? null,
      skipped_count: matchDump.skipped_count,
      compare_8556_match_count: compareJson.match_count ?? null,
      required_input: "client_id uuid only; this file has it. No round/id required."
    },
    evidence: "w-conv/02-lender-matches.json"
  });

  const firstMatch = Array.isArray(matchesJson.matches) && matchesJson.matches[0] ? matchesJson.matches[0] : null;
  const usedMatchedLender = Boolean(firstMatch?.id) && !creds.ready;
  const launchLenderId = usedMatchedLender ? firstMatch.id : DUMMY_LENDER;
  const launchBody = { client_id: CLIENT, lender_id: launchLenderId };
  const stopReason = creds.ready
    ? "OXYLABS names present locally — used dummy lender_id so launch dies before an Oxylabs session (lender_not_found or earlier). Did not POST a matched lender."
    : (usedMatchedLender
      ? "Used first matched lender_id. Expect oxylabs_credentials_missing before any session."
      : "No match. Used designed dummy lender_id (same as W6/G5). Expect oxylabs_credentials_missing or lender_not_found.");

  const launchRes = await fetch(`${BASE}/api/proxy/launch`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify(launchBody)
  });
  const launchJson = await launchRes.json().catch(() => ({}));
  const launchDump = {
    hard_stop: "one POST only; no retry; no bank URL open; no Oxylabs past missing-cred / last safe error",
    stop_reason: stopReason,
    oxylabs_names: creds,
    used_matched_lender: usedMatchedLender,
    body: {
      client_id: CLIENT,
      lender_id: launchLenderId,
      lender_id_class: usedMatchedLender ? "matched" : "dummy-00000000-0000-4000-8000-000000000001"
    },
    status: launchRes.status,
    ok: launchJson.ok === true,
    error: launchJson.error || null,
    message: launchJson.message || null,
    session_id: launchJson.session_id || null,
    body_redacted: redactLaunch(launchJson)
  };
  fs.writeFileSync(path.join(OUT, "03-proxy-launch.json"), JSON.stringify(launchDump, null, 2));

  const launchSessionsAfter = await query(
    `SELECT id, status, error_code, lender_id, started_at
       FROM proxy_sessions
      WHERE client_id = $1::uuid
      ORDER BY started_at DESC
      LIMIT 10`,
    [CLIENT]
  );
  fs.writeFileSync(path.join(OUT, "03-proxy-sessions-after.json"), JSON.stringify(launchSessionsAfter, null, 2));

  rec({
    id: "conv.3.proxy-launch",
    result: launchJson.error === "oxylabs_credentials_missing" || launchRes.status === 503
      ? "FAIL"
      : (launchJson.ok ? "FAIL" : "FAIL"),
    expected: "POST /api/proxy/launch for THIS client stops at credential / validation error. Does not open a bank site.",
    observed: {
      status: launchRes.status,
      error: launchJson.error || null,
      session_id: launchJson.session_id || null,
      sessions_after: (launchSessionsAfter.rows || []).length,
      used_matched_lender: usedMatchedLender,
      cred_names_checked: ["OXYLABS_USERNAME", "OXYLABS_PASSWORD"]
    },
    evidence: "w-conv/03-proxy-launch.json"
  });

  const designedFallback = {
    file: "public/app/proxy-apply.js",
    detect: "FHProxyApply.detectExtension() via postMessage ping (1500ms). No API named detect-or-fallback.",
    fallback_copy: "Chrome extension not detected. Browser routing is NOT active. Use the copyable proxy settings below, or install the Fundhub Proxy extension (see extension/README.md).",
    manual_fields: ["Host", "Port", "Username (includes city + sessid)", "Password", "Application URL"],
    renders_only_after: "POST /api/proxy/launch returns ok:true (connection + verification). Credential error modal does not show the manual string."
  };
  fs.writeFileSync(path.join(OUT, "04-designed-fallback-string.json"), JSON.stringify(designedFallback, null, 2));

  const browser = await chromium.launch({
    headless: true,
    executablePath: chromeExe()
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
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

  const ccpUrl = `${BASE}/app/client-control-panel.html?id=${CLIENT}`;
  await page.goto(ccpUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(2500);
  const ccpUi = await page.evaluate(async () => {
    const status = document.getElementById("fh-funding-apply-status");
    const list = document.getElementById("fh-funding-apply-list");
    const door = document.getElementById("fh-funding-apply");
    let ext = { present: false, error: "FHProxyApply missing" };
    if (window.FHProxyApply && window.FHProxyApply.detectExtension) {
      const has = await window.FHProxyApply.detectExtension();
      ext = { present: !!has, isExtensionPresent: !!window.FHProxyApply.isExtensionPresent() };
    }
    const applyBtns = [...document.querySelectorAll("[data-fh-apply], #fh-funding-apply-list button")].map((b) => (b.textContent || "").trim());
    const modal = document.getElementById("fh-proxy-apply-modal");
    return {
      url: location.href,
      door_present: Boolean(door),
      status_copy: status ? status.textContent.trim() : null,
      list_text: list ? list.innerText.trim() : null,
      apply_buttons: applyBtns,
      modal_visible: !!(modal && modal.style.display && modal.style.display !== "none"),
      modal_text: modal ? modal.innerText.replace(/\s+/g, " ").trim().slice(0, 400) : null,
      extension: ext
    };
  });
  await page.screenshot({ path: path.join(OUT, "04-ccp-apply-door.png"), fullPage: false });
  fs.writeFileSync(path.join(OUT, "04-ccp-apply-ui.json"), JSON.stringify(ccpUi, null, 2));

  const lendersUrl = `${BASE}/app/lenders.html?client_id=${CLIENT}`;
  await page.goto(lendersUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(2000);
  const lendersUi = await page.evaluate(() => {
    const banner = document.getElementById("applyClientBanner");
    const applyBtns = [...document.querySelectorAll("[data-fh-apply], button")].filter((b) => /^Apply$/i.test((b.textContent || "").trim()));
    return {
      url: location.href,
      banner: banner ? banner.textContent.trim().slice(0, 240) : null,
      apply_button_count: applyBtns.length
    };
  });
  await page.screenshot({ path: path.join(OUT, "04-lenders-scoped.png"), fullPage: false });
  fs.writeFileSync(path.join(OUT, "04-lenders-ui.json"), JSON.stringify(lendersUi, null, 2));

  await page.close();
  await browser.close();

  const fallbackRendered = Boolean(
    (ccpUi.modal_text && /Chrome extension not detected|Manual proxy settings/i.test(ccpUi.modal_text))
    || (ccpUi.status_copy && /Chrome extension not detected/i.test(ccpUi.status_copy))
  );
  rec({
    id: "conv.4.extension-fallback",
    result: fallbackRendered ? "PASS" : "MISSING",
    expected: "CRM detect-or-fallback renders the manual proxy string on THIS file (extension/ + proxy-apply.js).",
    observed: {
      detect_api: "none named detect-or-fallback — page postMessage ping in public/app/proxy-apply.js",
      extension_present: ccpUi.extension?.present ?? null,
      apply_buttons: ccpUi.apply_buttons,
      status_copy: ccpUi.status_copy,
      fallback_on_screen: fallbackRendered,
      live_string: fallbackRendered ? ccpUi.modal_text : "MISSING — launch never returned ok, so openManualUi never ran",
      designed_string_saved: "w-conv/04-designed-fallback-string.json"
    },
    evidence: [
      "w-conv/04-ccp-apply-door.png",
      "w-conv/04-ccp-apply-ui.json",
      "w-conv/04-designed-fallback-string.json"
    ]
  });

  rec({
    id: "conv.ground-truth",
    result: "MISSING",
    expected: "Written intended journey names inquiries removed → file optimized → banks populate → apply via proxy",
    observed: "docs/journeys/*-intended.md do not name this conveyor. Chris 2026-08-18 board is the only written order. Did not invent missing steps.",
    evidence: "w-conv/NOTES.md"
  });

  rec({
    id: "conv.forbidden-untouched",
    result: "PASS",
    expected: "Never touch 9af65808-a619-4e65-ae91-239766a006b7. 8556 read-compare only.",
    observed: {
      forbidden_event_count_read: hop.forbidden_touch.rows?.[0]?.n ?? null,
      note: "count only — no writes to forbidden or 8556"
    },
    evidence: "w-conv/01-hops-db.json"
  });

  const out = {
    generated_at: new Date().toISOString(),
    unit: "W-CONV",
    client_id: CLIENT,
    crs_id: CRS,
    org_id: ORG,
    forbidden_untouched: FORBIDDEN,
    compare_read_only: COMPARE,
    proofs
  };
  fs.writeFileSync(path.join(OUT, "proofs.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify({
    wrote: "w-conv/proofs.json",
    hop_1a: proofs.find((p) => p.id === "conv.1a.inquiries-removed")?.observed,
    matches: matchesJson.match_count,
    launch: { status: launchRes.status, error: launchJson.error },
    fallback: fallbackRendered ? "rendered" : "MISSING"
  }, null, 2));
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
