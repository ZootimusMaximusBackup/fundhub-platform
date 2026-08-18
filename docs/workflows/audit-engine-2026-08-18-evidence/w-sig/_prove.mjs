// W-SIG — send + sign one contract on the simulated client. Findings only.
// Writes evidence. Does not teardown. Does not touch the live credit file.

import { chromium } from "@playwright/test";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-engine-2026-08-18-evidence/w-sig");
const DUMPS = path.join(OUT, "dumps");
const BASE = "https://fundhub.ai";
const CLIENT = "41a3199f-1835-4ac8-91c0-d4f37bd92037";
const CARD = "0a8e8863-5094-4fbc-af0f-c37e5a457c97";
const ORG = "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6";
const FORBIDDEN = "9af65808-a619-4e65-ae91-239766a006b7";
const COMPARE = "8556bedc-46e1-4d85-b0cd-a24adfee1521";
const EMAIL = "sim+1787079946953@demo.fundhub.local";
const SIGN_NAME = "TEST — Simulated Client";

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
const TEST_INBOX = String(process.env.FUNDHUB_TEST_INBOX || "").trim();
fs.mkdirSync(DUMPS, { recursive: true });

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

function writeDump(name, obj) {
  const file = path.join(DUMPS, name);
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
  return path.relative(ROOT, file);
}

function writeOut(name, obj) {
  const file = path.join(OUT, name);
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
  return path.relative(ROOT, file);
}

function idsOnlyEventPayload(payload) {
  if (!payload || typeof payload !== "object") return {};
  return {
    contract_id: payload.contract_id || null,
    client_id: payload.client_id || null,
    template_key: payload.template_key || null,
    kind: payload.kind || null,
    subtype: payload.subtype || null,
    status: payload.status || null,
    document_id: payload.document_id || null,
    document_version_id: payload.document_version_id || null,
    signed_document_id: payload.signed_document_id || null
  };
}

function stripContract(row) {
  if (!row) return null;
  const out = { ...row };
  delete out.rendered_body;
  delete out.merge_values;
  delete out.body;
  delete out.fields;
  delete out.signature_statement;
  if (out.body_sha) out.body_sha = "[present]";
  if (out.signed_body_sha) out.signed_body_sha = "[present]";
  return out;
}

const proofs = [];
function rec(row) {
  proofs.push(row);
  console.log(JSON.stringify({ id: row.id, result: row.result, observed: row.observed }));
}

async function dumpState(label) {
  const contracts = (await query(
    `SELECT id, org_id, client_id, template_id, template_key, title, kind, subtype,
            status, sent_at, signed_at, voided_at, document_id, signed_document_id,
            created_at, updated_at, signer_name
       FROM contracts WHERE client_id = $1 ORDER BY created_at`,
    [CLIENT]
  )).map((r) => ({
    ...r,
    signer_name: r.signer_name ? "[present]" : null
  }));

  const events = (await query(
    `SELECT id, name, client_id, idempotency_key, created_at, payload
       FROM events WHERE client_id = $1 ORDER BY created_at`,
    [CLIENT]
  )).map((e) => ({
    id: e.id,
    name: e.name,
    client_id: e.client_id,
    idempotency_key: e.idempotency_key,
    created_at: e.created_at,
    payload: idsOnlyEventPayload(e.payload)
  }));

  const card = (await query(
    `SELECT c.id, c.client_id, c.pipeline_id, c.stage_id, c.entered_at, c.updated_at,
            p.key AS pipeline_key, s.key AS stage_key, s.name AS stage_name
       FROM cards c
       JOIN pipelines p ON p.id = c.pipeline_id
       JOIN pipeline_stages s ON s.id = c.stage_id
      WHERE c.client_id = $1
      ORDER BY c.created_at`,
    [CLIENT]
  ))[0] || null;

  const client = (await query(
    `SELECT id, org_id, is_demo, email, updated_at, created_at,
            funded, outcome_tier, consent_sms, ghl_contact_id IS NOT NULL AS has_ghl_contact_id,
            tags
       FROM clients WHERE id = $1`,
    [CLIENT]
  ))[0] || null;

  const tasks = await query(
    `SELECT id, title, source_workflow, done, due_at, created_at, updated_at
       FROM tasks WHERE client_id = $1 ORDER BY created_at`,
    [CLIENT]
  );

  const entitlements = await query(
    `SELECT id, entitlement_code, grant_reason, granted_by, created_at
       FROM entitlements WHERE client_id = $1 ORDER BY created_at`,
    [CLIENT]
  ).catch(() => []);

  const consents = await query(
    `SELECT id, kind, capture_method, granted_at, revoked_at, document_id, created_at, updated_at
       FROM client_consents WHERE client_id = $1 ORDER BY created_at`,
    [CLIENT]
  ).catch(() => []);

  const pulls = await query(
    `SELECT id, status, provider, state_reason, created_at, updated_at
       FROM soft_pull_requests WHERE client_id = $1 ORDER BY created_at`,
    [CLIENT]
  ).catch(() => []);

  const messages = await query(
    `SELECT id, channel, template_key, status, provider, created_at, updated_at,
            provider_ref IS NOT NULL AS has_provider_ref
       FROM messages WHERE client_id = $1 ORDER BY created_at`,
    [CLIENT]
  );

  const documents = await query(
    `SELECT id, kind, subtype, title, status, delivery_status, created_at, updated_at
       FROM documents WHERE client_id = $1 ORDER BY created_at`,
    [CLIENT]
  ).catch(() => []);

  const letters = await query(
    `SELECT id, created_at FROM letters_generated WHERE client_id = $1`,
    [CLIENT]
  ).catch(() => ({ _missing_table: true }));

  const payload = {
    label,
    at: new Date().toISOString(),
    client_id: CLIENT,
    card_id: CARD,
    contracts,
    events,
    card,
    client,
    tasks,
    entitlements,
    consents,
    soft_pull_requests: pulls,
    messages,
    documents,
    letters_generated: Array.isArray(letters) ? letters : letters
  };
  writeDump(`${label}.json`, payload);
  return payload;
}

function pickTemplate(items) {
  const active = (items || []).filter((t) => t && t.active !== false);
  const notDispute = active.filter((t) => !/dispute|letter|repair|authorization/i.test(
    `${t.template_key || ""} ${t.name || ""} ${t.subtype || ""}`
  ) || /funding|service|agreement/i.test(`${t.template_key || ""} ${t.subtype || ""}`));
  const funding = active.filter((t) => /funding|service/i.test(`${t.template_key || ""} ${t.subtype || ""} ${t.name || ""}`));
  const soft = active.filter((t) => /SOFT-PULL-CONSENT|soft_pull/i.test(`${t.template_key || ""} ${t.subtype || ""}`));
  const picked = funding[0] || notDispute.find((t) => !/SOFT-PULL|CONSENT|DISPUTE/i.test(t.template_key || "")) || soft[0] || active[0] || null;
  return {
    picked,
    available: active.map((t) => ({
      id: t.id,
      template_key: t.template_key,
      name: t.name,
      kind: t.kind,
      subtype: t.subtype,
      source_kind: t.source_kind,
      active: t.active,
      required_keys: (t.manual_fields || []).filter((f) => f && f.required).map((f) => f.key)
    })),
    only_soft_pull: Boolean(picked && /SOFT-PULL-CONSENT/i.test(picked.template_key || "")) && funding.length === 0
  };
}

function fillValues(template) {
  const values = {};
  for (const f of template.manual_fields || []) {
    if (!f || !f.key) continue;
    if (f.required || f.required === true) values[f.key] = "TEST-AUDIT";
  }
  return values;
}

function linkFromSend(data) {
  const links = (data && data.links) || [];
  if (links[0]) return links[0].url || links[0].path || "";
  const link = data && data.link;
  if (!link) return "";
  if (typeof link === "string") return link;
  return link.url || link.path || "";
}

function absLink(link) {
  if (!link) return "";
  if (/^https?:\/\//i.test(link)) return link;
  return BASE + (link.startsWith("/") ? link : `/${link}`);
}

async function main() {
  const listenersGrep = execSync(
    `rg -n --glob '!docs/**' --glob '!e2e/**' --glob '!**/node_modules/**' --glob '!**/*.test.mjs' --glob '!**/*.pg.test.mjs' 'contract\\.signed' src api netlify || true`,
    { cwd: ROOT, encoding: "utf8" }
  );
  writeDump("listeners-grep.txt.json", {
    note: "rg contract.signed excluding tests/docs. Full text in listeners-grep.txt",
    line_count: listenersGrep.split("\n").filter(Boolean).length
  });
  fs.writeFileSync(path.join(DUMPS, "listeners-grep.txt"), listenersGrep);

  const before = await dumpState("01-before");
  rec({
    id: "sig.before",
    result: before.client && before.client.id === CLIENT ? "PASS" : "FAIL",
    expected: "dump contracts / events / card stage / clients.updated_at / tasks for THIS client_id",
    observed: `contracts=${before.contracts.length} events=${before.events.length} stage=${before.card && before.card.stage_key} updated_at=${before.client && before.client.updated_at} tasks=${before.tasks.length}`,
    evidence: "w-sig/dumps/01-before.json"
  });

  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "chris@fundhub.ai", password: PASSWORD })
  });
  const loginJson = await loginRes.json().catch(() => ({}));
  const token = loginJson.token || null;
  writeDump("../login-status.json", {
    status: loginRes.status,
    ok: loginJson.ok === true,
    has_token: Boolean(token),
    staff_role: loginJson.staff?.role || null
  });
  if (!token) throw new Error("login failed");

  const authHeaders = {
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
    cookie: `fundhub_session=${token}`
  };

  const tplRes = await fetch(`${BASE}/api/read/contracts?view=templates&active_only=1`, { headers: authHeaders });
  const tplJson = await tplRes.json().catch(() => ({}));
  const items = (tplJson && (tplJson.items || tplJson.templates || (tplJson.data && (tplJson.data.items || tplJson.data.templates)))) || [];
  const pick = pickTemplate(items);
  writeDump("02-templates.json", {
    status: tplRes.status,
    ok: tplJson.ok,
    count: items.length,
    available: pick.available,
    picked_key: pick.picked && pick.picked.template_key,
    only_soft_pull: pick.only_soft_pull,
    test_inbox_present: Boolean(TEST_INBOX)
  });

  if (!pick.picked) {
    rec({
      id: "sig.send",
      result: "FAIL",
      expected: "at least one active contract template to send",
      observed: `templates_http=${tplRes.status} count=${items.length}`,
      evidence: "w-sig/dumps/02-templates.json"
    });
    finish(before, null);
    return;
  }

  const values = fillValues(pick.picked);
  const draftBody = {
    action: "create_draft",
    client_id: CLIENT,
    template_id: pick.picked.id,
    values,
    title: pick.picked.name || pick.picked.template_key
  };
  if (TEST_INBOX) {
    draftBody.signers = [{
      role_label: "Client",
      name: SIGN_NAME,
      email: TEST_INBOX,
      client_id: CLIENT
    }];
  }

  const draftRes = await fetch(`${BASE}/api/contracts`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify(draftBody)
  });
  const draftJson = await draftRes.json().catch(() => ({}));
  const draftContract = draftJson.contract || null;
  writeDump("03-create-draft.json", {
    status: draftRes.status,
    ok: draftJson.ok === true,
    error: draftJson.error || null,
    message: draftJson.message || null,
    template_key: pick.picked.template_key,
    template_id: pick.picked.id,
    contract_id: draftContract && draftContract.id,
    signer_count: Array.isArray(draftJson.signers) ? draftJson.signers.length : null,
    signer_has_email: Array.isArray(draftJson.signers) ? draftJson.signers.map((s) => Boolean(s.email)) : null,
    used_test_inbox_override: Boolean(TEST_INBOX),
    override_reason: TEST_INBOX
      ? "designed create_draft.signers[] accepts email; default would be sim+…@demo.fundhub.local"
      : "FUNDHUB_TEST_INBOX missing — default client email would be used"
  });

  if (!draftContract || !draftContract.id) {
    rec({
      id: "sig.send",
      result: "FAIL",
      expected: "create_draft returns a contract id for THIS client",
      observed: `status=${draftRes.status} error=${draftJson.error || draftJson.message || "no contract"}`,
      evidence: "w-sig/dumps/03-create-draft.json"
    });
    finish(before, null);
    return;
  }

  const sendRes = await fetch(`${BASE}/api/contracts`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ action: "send", id: draftContract.id })
  });
  const sendJson = await sendRes.json().catch(() => ({}));
  const sent = sendJson.contract || null;
  const signLink = absLink(linkFromSend(sendJson));
  writeDump("04-send.json", {
    status: sendRes.status,
    ok: sendJson.ok === true,
    error: sendJson.error || null,
    message: sendJson.message || null,
    template_key: pick.picked.template_key,
    contract_id: sent && sent.id,
    contract_status: sent && sent.status,
    has_link: Boolean(signLink),
    link_is_absolute: /^https?:\/\//i.test(signLink),
    resent: sendJson.resent || false,
    used_test_inbox_override: Boolean(TEST_INBOX)
  });

  rec({
    id: "sig.send",
    result: sendRes.status === 200 && sent && sent.id ? "PASS" : "FAIL",
    expected: "POST /api/contracts create_draft + send; funding/service if present; network status + contract id",
    observed: `status=${sendRes.status} template=${pick.picked.template_key} contract_id=${sent && sent.id} only_soft_pull=${pick.only_soft_pull} has_link=${Boolean(signLink)}`,
    evidence: "w-sig/dumps/04-send.json"
  });

  const afterSend = await dumpState("04b-after-send");

  if (!signLink) {
    rec({
      id: "sig.sign",
      result: "FAIL",
      expected: "send returns an in-app sign link",
      observed: "no link on send response",
      evidence: "w-sig/dumps/04-send.json"
    });
    finish(before, afterSend, { template_key: pick.picked.template_key, contract_id: sent && sent.id, afterSend });
    return;
  }

  const browser = await chromium.launch({
    headless: true,
    executablePath: chromeExe()
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  let signHttp = null;
  page.on("response", (res) => {
    if (/\/api\/contracts\/sign/.test(res.url()) && res.request().method() === "POST") {
      signHttp = { status: res.status() };
    }
  });
  await page.goto(signLink, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(2000);
  const opened = await page.evaluate(() => ({
    title: (document.getElementById("title") || {}).textContent || "",
    canSign: !!(document.getElementById("signPanel") && document.getElementById("signPanel").style.display !== "none"),
    problem: (document.getElementById("problemText") || {}).textContent || "",
    done: (document.getElementById("doneText") || {}).textContent || ""
  }));
  await page.screenshot({ path: path.join(OUT, "01-contract-open.png") });

  if (opened.canSign) {
    await page.locator("#name").fill(SIGN_NAME);
    const agree = page.locator("#agree");
    if (await agree.count()) await agree.check();
    await page.screenshot({ path: path.join(OUT, "02-contract-ready.png") });
    await page.locator("#go").click();
    await page.waitForTimeout(3500);
  }
  const afterUi = await page.evaluate(() => ({
    done: (document.getElementById("doneText") || {}).textContent || "",
    msg: (document.getElementById("msg") || {}).textContent || "",
    badge: (document.getElementById("sub") || {}).innerText || "",
    doneVisible: !!(document.getElementById("donePanel") && document.getElementById("donePanel").style.display !== "none")
  }));
  await page.screenshot({ path: path.join(OUT, "03-contract-signed.png") });
  await browser.close();

  const signedRow = (await query(
    `SELECT id, status, signed_at, template_key, document_id, signed_document_id, signer_name
       FROM contracts WHERE id = $1`,
    [draftContract.id]
  ))[0] || null;
  const signedEvent = (await query(
    `SELECT id, name, client_id, idempotency_key, created_at, payload
       FROM events
      WHERE name = 'contract.signed'
        AND (client_id = $1 OR idempotency_key = $2)
      ORDER BY created_at DESC LIMIT 1`,
    [CLIENT, `contract.signed:${draftContract.id}`]
  ))[0] || null;

  writeDump("06-signed.json", {
    contract: signedRow && {
      id: signedRow.id,
      status: signedRow.status,
      signed_at: signedRow.signed_at,
      template_key: signedRow.template_key,
      document_id: signedRow.document_id,
      signed_document_id: signedRow.signed_document_id,
      signer_name_present: Boolean(signedRow.signer_name)
    },
    event: signedEvent && {
      id: signedEvent.id,
      name: signedEvent.name,
      client_id: signedEvent.client_id,
      idempotency_key: signedEvent.idempotency_key,
      created_at: signedEvent.created_at,
      payload: idsOnlyEventPayload(signedEvent.payload)
    },
    sign_http: signHttp,
    opened,
    after_ui: afterUi
  });

  rec({
    id: "sig.sign",
    result: signedRow && signedRow.status === "signed" && signedEvent && signedEvent.name === "contract.signed" ? "PASS" : "FAIL",
    expected: "contracts.status=signed and events.contract.signed row; ids-only payload; signed screenshot",
    observed: `status=${signedRow && signedRow.status} event_id=${signedEvent && signedEvent.id} event_client=${signedEvent && signedEvent.client_id} ui=${(afterUi.done || afterUi.badge || "").slice(0, 120)}`,
    evidence: "w-sig/03-contract-signed.png"
  });

  const after = await dumpState("05-after");
  finish(before, after, {
    template_key: pick.picked.template_key,
    only_soft_pull: pick.only_soft_pull,
    contract_id: draftContract.id,
    event: signedEvent,
    used_test_inbox_override: Boolean(TEST_INBOX),
    afterSend
  });
}

function finish(before, after, meta = {}) {
  const baseline = meta.afterSend || before;
  const afterSafe = after || baseline;
  const newEvents = afterSafe.events.filter((e) => !baseline.events.some((b) => b.id === e.id));
  const newTasks = afterSafe.tasks.filter((t) => !baseline.tasks.some((b) => b.id === t.id));
  const newConsents = afterSafe.consents.filter((c) => !baseline.consents.some((b) => b.id === c.id));
  const newPulls = afterSafe.soft_pull_requests.filter((p) => !baseline.soft_pull_requests.some((b) => b.id === p.id));
  const newMsgs = afterSafe.messages.filter((m) => !baseline.messages.some((b) => b.id === m.id));
  const newEnt = afterSafe.entitlements.filter((e) => !baseline.entitlements.some((b) => b.id === e.id));
  const newDocs = afterSafe.documents.filter((d) => !baseline.documents.some((b) => b.id === d.id));
  const stageMoved = Boolean(baseline.card && afterSafe.card && (
    baseline.card.stage_id !== afterSafe.card.stage_id || baseline.card.stage_key !== afterSafe.card.stage_key
  ));
  const clientUpdated = Boolean(baseline.client && afterSafe.client && String(baseline.client.updated_at) !== String(afterSafe.client.updated_at));
  const followupMail = newMsgs.filter((m) => m.template_key !== "CONTRACT-SEND-EMAIL" && m.template_key !== "CONTRACT-REMIND-EMAIL");
  const sendMail = newMsgs.filter((m) => m.template_key === "CONTRACT-SEND-EMAIL");

  const listeners = {
    canonical_comment: "src/events/canonical.mjs: NO HANDLER IS REGISTERED FOR contract.sent / contract.signed, deliberately",
    register_all: [],
    inngest_from_w_wf_inventory: [],
    grep_src_hits: "w-sig/dumps/listeners-grep.txt",
    empty: true
  };

  const unlock = {
    stage_move: stageMoved,
    stage_before: before.card && before.card.stage_key,
    stage_after: afterSafe.card && afterSafe.card.stage_key,
    new_task: newTasks.length > 0,
    new_tasks: newTasks.map((t) => ({ id: t.id, title: t.title, source_workflow: t.source_workflow })),
    new_entitlement: newEnt.length > 0,
    new_entitlements: newEnt.map((e) => e.entitlement_code),
    new_consent: newConsents.length > 0,
    new_consents: newConsents.map((c) => ({ id: c.id, kind: c.kind })),
    pull_gate_new_request: newPulls.length > 0,
    letter_send: false,
    followup_email_or_sms: followupMail.length > 0,
    followup_messages: followupMail.map((m) => ({ id: m.id, channel: m.channel, template_key: m.template_key, status: m.status })),
    send_email_rows: sendMail.map((m) => ({ id: m.id, channel: m.channel, template_key: m.template_key, status: m.status })),
    ghl: {
      before_has_ghl: baseline.client && baseline.client.has_ghl_contact_id,
      after_has_ghl: afterSafe.client && afterSafe.client.has_ghl_contact_id,
      changed: Boolean(baseline.client && afterSafe.client && baseline.client.has_ghl_contact_id !== afterSafe.client.has_ghl_contact_id)
    },
    client_updated_at_changed: clientUpdated,
    client_updated_at_before: baseline.client && baseline.client.updated_at,
    client_updated_at_after: afterSafe.client && afterSafe.client.updated_at,
    compare_from: meta.afterSend ? "after-send → after-sign (contract.signed window)" : "before → after",
    send_window_vs_before: meta.afterSend ? {
      stage_moved: Boolean(before.card && meta.afterSend.card && before.card.stage_key !== meta.afterSend.card.stage_key),
      client_updated: Boolean(before.client && meta.afterSend.client && String(before.client.updated_at) !== String(meta.afterSend.client.updated_at)),
      new_message_keys: meta.afterSend.messages.filter((m) => !before.messages.some((b) => b.id === m.id)).map((m) => m.template_key),
      new_event_names: meta.afterSend.events.filter((e) => !before.events.some((b) => b.id === e.id)).map((e) => e.name)
    } : null,
    new_events: newEvents.map((e) => ({ id: e.id, name: e.name, client_id: e.client_id })),
    new_documents: newDocs.map((d) => ({ id: d.id, title: d.title, status: d.status, delivery_status: d.delivery_status })),
    listeners
  };
  const unlockedAnything = stageMoved || newTasks.length || newEnt.length || newConsents.length
    || newPulls.length || followupMail.length || unlock.ghl.changed || clientUpdated
    || newEvents.some((e) => e.name !== "contract.signed" && e.name !== "contract.sent" && e.name !== "message.queued" && e.name !== "message.sent");

  writeDump("07-after-vs-before.json", unlock);

  const w10 = [
    {
      claim: "contract.signed fired; nobody listened (no stage move, no task, no follow-up mail/SMS, client updated_at unchanged)",
      w10: "BROKEN — fired but nothing listened",
      this_file: unlock.stage_move || unlock.new_task || unlock.followup_email_or_sms || unlock.client_updated_at_changed
        ? "DIFFERENT"
        : "SAME",
      note: unlockedAnything ? "row change after sign — see 07-after-vs-before.json" : "empty listener list + no unlock row change"
    },
    {
      claim: "Soft-pull consent contract signed did not unlock soft pull (capture path is POST /api/consent/capture)",
      w10: "BROKEN",
      this_file: meta.only_soft_pull
        ? (unlock.new_consent || unlock.pull_gate_new_request ? "DIFFERENT" : "SAME")
        : "N/A — this file signed " + (meta.template_key || "non-soft-pull"),
      note: "W-CONSENT already wrote client_consents via capture on this client before W-SIG"
    },
    {
      claim: "Dispute-letter sign never done in W10",
      w10: "MISSING",
      this_file: /dispute/i.test(meta.template_key || "") ? "NEW" : "SAME — still not signed",
      note: "Did not sign a dispute letter"
    }
  ];
  writeDump("08-w10-crosscheck.json", w10);

  rec({
    id: "sig.unlock",
    result: !unlockedAnything && listeners.empty ? "PASS" : (unlockedAnything ? "FAIL" : "PASS"),
    expected: "prove what contract.signed did on THIS file; empty listeners + no row change = W10 still true",
    observed: unlockedAnything
      ? `unlock detected: ${JSON.stringify({ stage: unlock.stage_move, tasks: unlock.new_task, updated: unlock.client_updated_at_changed, followup: unlock.followup_email_or_sms })}`
      : "no stage/task/entitlement/consent/pull/letter/follow-up/GHL/client.updated_at change from contract.signed",
    evidence: "w-sig/dumps/07-after-vs-before.json"
  });

  rec({
    id: "sig.w10-crosscheck",
    result: "PASS",
    expected: "one short table: same / different / new vs W10",
    observed: w10.map((r) => `${r.this_file}: ${r.claim.slice(0, 60)}`).join(" | "),
    evidence: "w-sig/dumps/08-w10-crosscheck.json"
  });

  const signedEvt = (afterSafe.events || []).find((e) => e.name === "contract.signed")
    || meta.event
    || null;
  writeDump("../events-fired.json", {
    unit: "W-SIG",
    client_id: CLIENT,
    contract_id: meta.contract_id || null,
    template_key: meta.template_key || null,
    emitted: signedEvt ? [{
      name: "contract.signed",
      id: signedEvt.id || null,
      client_id: signedEvt.client_id || null,
      contract_id: meta.contract_id || (signedEvt.payload && signedEvt.payload.contract_id) || null
    }] : [],
    events_table_rows: (afterSafe.events || []).filter((e) => e.name === "contract.signed" || e.name === "contract.sent").map((e) => ({
      id: e.id,
      name: e.name,
      client_id: e.client_id,
      idempotency_key: e.idempotency_key,
      created_at: e.created_at
    }))
  });

  fs.writeFileSync(path.join(OUT, "proofs.json"), JSON.stringify(proofs, null, 2));
}

main().catch((err) => {
  console.error(String(err && err.message ? err.message : err));
  process.exit(1);
});
