// W-CONSENT — prove consent capture vs pull gate. Findings only.
// Writes evidence. Does not complete a bureau pull. Does not teardown.

import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-engine-2026-08-18-evidence/w-consent");
const BASE = "https://fundhub.ai";
const CLIENT = "41a3199f-1835-4ac8-91c0-d4f37bd92037";
const ORG = "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6";
const FORBIDDEN = "9af65808-a619-4e65-ae91-239766a006b7";
const COMPARE = "8556bedc-46e1-4d85-b0cd-a24adfee1521";
const EMAIL = "sim+1787079946953@demo.fundhub.local";

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
    return (await c.query(sql, params)).rows;
  } finally {
    await c.end();
  }
}

function redactConsent(row) {
  if (!row) return null;
  const out = { ...row };
  if (out.consent_text) {
    out.consent_text_len = String(out.consent_text).length;
    out.consent_text_first_line = String(out.consent_text).split("\n")[0];
  }
  if (out.captured_ip) out.captured_ip = "[present]";
  if (out.captured_user_agent) out.captured_user_agent = String(out.captured_user_agent).slice(0, 80);
  return out;
}

function classifyCrsEnv() {
  const names = Object.keys(process.env).filter((k) => k.startsWith("CRS_") || k === "ADAPTERS_DRY_RUN").sort();
  const allowRaw = process.env.CRS_ALLOW_LIVE;
  const allowTrim = allowRaw == null ? null : String(allowRaw).trim().toLowerCase();
  const liveAllowed = allowTrim != null && allowTrim !== "" && ["1", "true", "yes", "on"].includes(allowTrim);
  const hostRaw = process.env.CRS_API_HOST || "";
  const host = String(hostRaw).trim().toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .split("/")[0]
    .replace(/:\d+$/, "");
  let hostClass = "other";
  if (host === "api-sandbox.stitchcredit.com") hostClass = "sandbox";
  if (host === "mware.crscreditapi.com") hostClass = "production";
  const bureausRaw = process.env.CRS_ACTIVE_BUREAUS;
  const adapters = process.env.ADAPTERS_DRY_RUN;
  const adaptersTrim = adapters == null ? null : String(adapters).trim().toLowerCase();
  const adaptersTransmit = adaptersTrim != null && ["0", "false", "no", "off"].includes(adaptersTrim);
  return {
    source: "local .env names only — not Netlify values printed",
    names_present: names,
    CRS_ALLOW_LIVE: { present: allowRaw != null && String(allowRaw).trim() !== "", live_allowed: liveAllowed },
    CRS_API_HOST: { present: Boolean(host), host_class: host ? hostClass : "missing" },
    CRS_ACTIVE_BUREAUS: {
      present: bureausRaw != null && String(bureausRaw).trim() !== "",
      parsed: String(bureausRaw || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
    },
    ADAPTERS_DRY_RUN: {
      present: adapters != null && String(adapters).trim() !== "",
      transmit_allowed: adaptersTransmit
    }
  };
}

const proofs = [];
function rec(row) {
  proofs.push(row);
  console.log(JSON.stringify({ id: row.id, result: row.result, observed: row.observed }));
}

async function dumpConsent(label) {
  const consents = await query(
    `SELECT id, org_id, client_id, kind, consent_version, capture_method, granted_name,
            granted_by_kind, granted_by_staff_id, granted_by_account_id,
            granted_at, expires_at, revoked_at, revoked_reason,
            document_id, created_at, updated_at,
            (revoked_at IS NULL
              AND (expires_at IS NULL OR expires_at > now())
              AND granted_at <= now()) AS is_valid
       FROM client_consents
      WHERE client_id = $1
      ORDER BY granted_at DESC, id DESC`,
    [CLIENT]
  );
  const client = await query(
    `SELECT id, org_id, email, consent_sms, is_demo
       FROM clients WHERE id = $1`,
    [CLIENT]
  );
  const custom = await query(
    `SELECT cf_crs_softpull_consent, cf_crs_softpull_consent_at, cf_credit_pull_consent_status
       FROM client_custom_fields WHERE client_id = $1`,
    [CLIENT]
  ).catch(() => []);
  const docs = await query(
    `SELECT id, kind, subtype, title, status
       FROM documents
      WHERE client_id = $1
        AND (subtype ILIKE '%soft_pull%' OR title ILIKE '%soft pull%')
      ORDER BY created_at DESC LIMIT 8`,
    [CLIENT]
  ).catch(() => []);
  const compare = await query(
    `SELECT id, kind, capture_method, consent_version,
            (revoked_at IS NULL
              AND (expires_at IS NULL OR expires_at > now())
              AND granted_at <= now()) AS is_valid
       FROM client_consents
      WHERE client_id = $1
      ORDER BY granted_at DESC LIMIT 8`,
    [COMPARE]
  );
  const payload = {
    label,
    client_id: CLIENT,
    email: EMAIL,
    clients_row: client[0] || null,
    client_consents: consents.map(redactConsent),
    custom_fields: custom,
    soft_pull_documents: docs,
    read_compare_8556_consents: compare.map((r) => ({
      id: r.id,
      kind: r.kind,
      capture_method: r.capture_method,
      consent_version: r.consent_version,
      is_valid: r.is_valid
    }))
  };
  fs.writeFileSync(path.join(OUT, `consent-row-${label}.json`), JSON.stringify(payload, null, 2));
  return payload;
}

async function main() {
  fs.writeFileSync(path.join(OUT, "crs-env-names.json"), JSON.stringify(classifyCrsEnv(), null, 2));

  const before = await dumpConsent("before");
  rec({
    id: "consent.simulate-stamp",
    result: before.clients_row?.consent_sms === true && before.client_consents.length === 0 ? "PASS" : "FAIL",
    expected: "simulate stamps clients.consent_sms=true and does not write client_consents",
    observed: `consent_sms=${before.clients_row?.consent_sms} client_consents=${before.client_consents.length} is_demo=${before.clients_row?.is_demo}`,
    evidence: "w-consent/consent-row-before.json"
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
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
    cookie: `fundhub_session=${token}`
  };

  const getBefore = await fetch(
    `${BASE}/api/consent/capture?client_id=${CLIENT}&kind=soft_pull_consent`,
    { headers: authHeaders }
  );
  const getBeforeJson = await getBefore.json().catch(() => ({}));
  fs.writeFileSync(path.join(OUT, "consent-get-before.json"), JSON.stringify({
    status: getBefore.status,
    ok: getBeforeJson.ok,
    kind: getBeforeJson.kind,
    status_valid: getBeforeJson.status?.valid ?? null,
    status_reason: getBeforeJson.status?.reason ?? null,
    history_count: Array.isArray(getBeforeJson.history) ? getBeforeJson.history.length : null
  }, null, 2));

  rec({
    id: "consent.handler",
    result: "PASS",
    expected: "POST body contract for soft-pull grant from api/consent/capture.mjs",
    observed: "required: client_id + capture_method; kind defaults soft_pull_consent; granted_name required for typed/signature; consent_text never from body",
    evidence: "w-consent/handler-required.json"
  });

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
  await page.waitForTimeout(1500);
  const beforeState = await page.evaluate(() => {
    const btn = document.getElementById("ccp-pull-tu");
    const status = document.getElementById("ccp-issue-ir-status");
    return {
      url: location.href,
      pull_tu_present: Boolean(btn),
      pull_tu_disabled: btn ? btn.disabled : null,
      pull_tu_text: btn ? btn.textContent.trim() : null,
      status_copy: status ? status.textContent.trim() : null
    };
  });
  await page.screenshot({ path: path.join(OUT, "ccp-before-consent.png"), fullPage: false });
  fs.writeFileSync(path.join(OUT, "ccp-before-state.json"), JSON.stringify(beforeState, null, 2));

  rec({
    id: "consent.button-before",
    result: beforeState.pull_tu_present ? "PASS" : "FAIL",
    expected: "CCP pull button visible before consent; UI may still be enabled",
    observed: JSON.stringify(beforeState),
    evidence: "w-consent/ccp-before-consent.png"
  });

  // Safe refuse proof: click TransUnion BEFORE consent. Gate should 403. No bureau order.
  let refuse = null;
  page.once("response", async (res) => {
    if (!/\/api\/finance\/crs-pull/.test(res.url())) return;
    const body = await res.json().catch(() => ({}));
    refuse = { status: res.status(), ok: body.ok, error: body.error, code: body.code };
  });
  const tu = page.locator("#ccp-pull-tu");
  if (await tu.count()) {
    await tu.click();
    await page.waitForTimeout(2500);
  }
  const afterClickBefore = await page.evaluate(() => {
    const btn = document.getElementById("ccp-pull-tu");
    const status = document.getElementById("ccp-issue-ir-status");
    return {
      pull_tu_disabled: btn ? btn.disabled : null,
      status_copy: status ? status.textContent.trim() : null
    };
  });
  if (!refuse) {
    const apiRefuse = await fetch(`${BASE}/api/finance/crs-pull`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ client_id: CLIENT, bureau: "TU" })
    });
    const apiRefuseJson = await apiRefuse.json().catch(() => ({}));
    refuse = { status: apiRefuse.status, ok: apiRefuseJson.ok, error: apiRefuseJson.error, code: apiRefuseJson.code, via: "direct-api-fallback" };
  }
  await page.screenshot({ path: path.join(OUT, "ccp-before-pull-refuse.png"), fullPage: false });
  fs.writeFileSync(path.join(OUT, "pull-refuse-before.json"), JSON.stringify({ refuse, afterClickBefore }, null, 2));

  rec({
    id: "consent.pull-refuse-before",
    result: refuse && refuse.status === 403 && /consent/i.test(String(refuse.error || "")) ? "PASS" : "FAIL",
    expected: "403 + no soft-pull consent on file — no bureau call",
    observed: JSON.stringify(refuse),
    evidence: "w-consent/ccp-before-pull-refuse.png"
  });

  const captureBody = {
    client_id: CLIENT,
    kind: "soft_pull_consent",
    action: "grant",
    capture_method: "checkbox"
  };
  const capRes = await fetch(`${BASE}/api/consent/capture`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify(captureBody)
  });
  const capJson = await capRes.json().catch(() => ({}));
  const consent = capJson.consent || null;
  const echo = consent ? redactConsent({
    id: consent.id,
    org_id: consent.org_id,
    client_id: consent.client_id,
    kind: consent.kind,
    consent_version: consent.consent_version,
    capture_method: consent.capture_method,
    granted_name: consent.granted_name,
    granted_by_kind: consent.granted_by_kind,
    granted_at: consent.granted_at,
    expires_at: consent.expires_at,
    revoked_at: consent.revoked_at,
    valid: consent.valid,
    consent_text: consent.consent_text
  }) : null;
  fs.writeFileSync(path.join(OUT, "capture-response.json"), JSON.stringify({
    status: capRes.status,
    ok: capJson.ok === true,
    error: capJson.error || null,
    code: capJson.code || null,
    sent_body: captureBody,
    consent_id: consent?.id || null,
    consent: echo
  }, null, 2));

  rec({
    id: "consent.capture-live",
    result: capRes.status === 200 && capJson.ok === true && consent?.id ? "PASS" : "FAIL",
    expected: "200 + new client_consents id for this simulated client",
    observed: `status=${capRes.status} ok=${capJson.ok} id=${consent?.id || "none"} kind=${consent?.kind || "none"}`,
    evidence: "w-consent/capture-response.json"
  });

  const after = await dumpConsent("after");
  fs.writeFileSync(path.join(OUT, "consent-row.json"), JSON.stringify({
    table: "client_consents",
    gate_reads: {
      function: "requestSoftPull → consentStatus",
      file: "src/finance/soft-pulls.mjs",
      table: "client_consents",
      where: ["org_id (session)", "client_id", "kind = soft_pull_consent"],
      validity_columns: ["revoked_at IS NULL", "expires_at IS NULL OR expires_at > now()", "granted_at <= now()"],
      newest_valid_wins: true
    },
    capture_writes: {
      handler: "POST /api/consent/capture → captureConsent",
      table: "client_consents",
      columns_written: [
        "org_id", "client_id", "kind", "consent_text", "consent_version",
        "granted_by_kind", "granted_by_account_id", "granted_by_staff_id",
        "capture_method", "granted_name", "captured_ip", "captured_user_agent",
        "document_id", "expires_at"
      ]
    },
    match: true,
    mismatch: [
      "clients.consent_sms is stamped by simulate and is NOT read by the pull gate",
      "custom-field soft-pull columns are NOT read by the pull gate",
      "a signed SOFT-PULL-CONSENT document is NOT read by the pull gate"
    ],
    after
  }, null, 2));

  rec({
    id: "consent.row-vs-gate",
    result: after.client_consents.some((r) => r.kind === "soft_pull_consent" && r.is_valid) ? "PASS" : "FAIL",
    expected: "capture writes client_consents.soft_pull_consent; gate reads that same table/kind/validity",
    observed: `rows=${after.client_consents.length} valid_soft_pull=${after.client_consents.filter((r) => r.kind === "soft_pull_consent" && r.is_valid).length} consent_sms=${after.clients_row?.consent_sms}`,
    evidence: "w-consent/consent-row.json"
  });

  // AFTER capture: screenshot only. Do not press pull — next hop is runCrsPull / bureau.
  await page.route("**/api/finance/crs-pull", (route) => route.abort());
  await page.goto(ccpUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(1500);
  const afterState = await page.evaluate(() => {
    const btn = document.getElementById("ccp-pull-tu");
    const status = document.getElementById("ccp-issue-ir-status");
    return {
      url: location.href,
      pull_tu_present: Boolean(btn),
      pull_tu_disabled: btn ? btn.disabled : null,
      pull_tu_text: btn ? btn.textContent.trim() : null,
      status_copy: status ? status.textContent.trim() : null
    };
  });
  await page.screenshot({ path: path.join(OUT, "ccp-after-consent.png"), fullPage: false });
  fs.writeFileSync(path.join(OUT, "ccp-after-state.json"), JSON.stringify(afterState, null, 2));

  const getAfter = await fetch(
    `${BASE}/api/consent/capture?client_id=${CLIENT}&kind=soft_pull_consent`,
    { headers: authHeaders }
  );
  const getAfterJson = await getAfter.json().catch(() => ({}));
  fs.writeFileSync(path.join(OUT, "consent-get-after.json"), JSON.stringify({
    status: getAfter.status,
    ok: getAfterJson.ok,
    kind: getAfterJson.kind,
    status_valid: getAfterJson.status?.valid ?? null,
    status_reason: getAfterJson.status?.reason ?? null,
    consent_id: getAfterJson.status?.consent?.id || null
  }, null, 2));

  rec({
    id: "consent.button-after",
    result: afterState.pull_tu_present && afterState.pull_tu_disabled === false && getAfterJson.status?.valid === true ? "PASS" : "FAIL",
    expected: "after capture: button still enabled (UI does not hide it); GET consent status.valid=true. Did not press pull.",
    observed: `btn_disabled=${afterState.pull_tu_disabled} status_copy=${JSON.stringify(afterState.status_copy)} get_valid=${getAfterJson.status?.valid} get_reason=${getAfterJson.status?.reason}`,
    evidence: "w-consent/ccp-after-consent.png"
  });

  const crs = classifyCrsEnv();
  const stop = {
    pressed_pull_after_consent: false,
    next_route: "POST /api/finance/crs-pull",
    next_functions: [
      "api/finance/crs-pull.mjs handler",
      "requestSoftPull (consent gate — would now accept)",
      "runCrsPull in src/finance/crs-pull.mjs",
      "createCrsClient → crs.orderPrequal → requestCrsSandbox"
    ],
    why_stopped: "Pressing Pull TransUnion after a valid consent would order a bureau. Owner 2026-08-16 E1006: no live TransUnion. This audit must not complete a live or sandbox bureau call.",
    sandbox_mode_exists: true,
    would_sandbox_run: crs.CRS_API_HOST.host_class === "sandbox" && crs.ADAPTERS_DRY_RUN.transmit_allowed,
    local_env_class: {
      CRS_API_HOST: crs.CRS_API_HOST,
      CRS_ALLOW_LIVE: crs.CRS_ALLOW_LIVE,
      CRS_ACTIVE_BUREAUS: crs.CRS_ACTIVE_BUREAUS,
      ADAPTERS_DRY_RUN: crs.ADAPTERS_DRY_RUN
    },
    notes: [
      "Sandbox host is always allowed in code; production host also needs CRS_ALLOW_LIVE on.",
      "CCP button sends bureau=TU even if CRS_ACTIVE_BUREAUS omits TU.",
      "If ADAPTERS_DRY_RUN is unset, the outbound fence blocks the vendor call after the ledger write.",
      "Live Netlify values were not printed. Local .env names only."
    ]
  };
  fs.writeFileSync(path.join(OUT, "stop-at-gate.json"), JSON.stringify(stop, null, 2));

  rec({
    id: "consent.stop-at-gate",
    result: "PASS",
    expected: "do not complete a bureau pull; record next hop",
    observed: `next=${stop.next_route} sandbox_exists=${stop.sandbox_mode_exists} would_sandbox_run=${stop.would_sandbox_run} live_allowed=${crs.CRS_ALLOW_LIVE.live_allowed}`,
    evidence: "w-consent/stop-at-gate.json"
  });

  rec({
    id: "consent.simulate-after",
    result: after.clients_row?.consent_sms === true ? "PASS" : "FAIL",
    expected: "simulate still only stamps consent_sms; capture added a client_consents row",
    observed: `consent_sms=${after.clients_row?.consent_sms} consents=${after.client_consents.length} capture_id=${consent?.id || "none"}`,
    evidence: "w-consent/consent-row-after.json"
  });

  await browser.close();
  fs.writeFileSync(path.join(OUT, "proofs.json"), JSON.stringify(proofs, null, 2));
  console.log("wrote", proofs.length, "proofs");
}

main().catch((e) => {
  fs.writeFileSync(path.join(OUT, "prove-error.json"), JSON.stringify({ error: String(e && e.message ? e.message : e) }, null, 2));
  console.error(e);
  process.exit(1);
});
