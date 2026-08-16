#!/usr/bin/env node
/**
 * Full product gauntlet (dry-run=1). Live fundhub.ai.
 * Writes JSON evidence next to this file. Never prints secrets.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const BASE = "https://fundhub.ai";
const WATCH = `${BASE}/.netlify/functions/tmp-cf-seam-watch`;
const stamp = Date.now();
const EMAIL = `bakerskater987+test.gauntlet.${stamp}@gmail.com`;
const NAME = "Gauntlet Thirteen";
const PHONE = "(602) 555-0199";
const out = {
  at: new Date().toISOString(),
  email: EMAIL,
  dry_run: 1,
  client_id: null,
  emits: [],
  correlate: {},
  portal: {},
  screens: [],
  roles: [],
  extra: {},
  gaps: []
};

function envFromDotenv() {
  const raw = fs.readFileSync(path.resolve(process.cwd(), ".env"), "utf8");
  const env = {};
  for (const line of raw.split("\n")) {
    const i = line.indexOf("=");
    if (i < 0) continue;
    env[line.slice(0, i)] = line.slice(i + 1);
  }
  return env;
}

const env = { ...envFromDotenv(), ...process.env };
const SECRET = env.DASHBOARD_SECRET;
const PASS = env.STAFF_E2E_PASSWORD;
if (!SECRET || !PASS) {
  console.error("missing DASHBOARD_SECRET or STAFF_E2E_PASSWORD");
  process.exit(1);
}

async function watch(body) {
  const r = await fetch(WATCH, {
    method: "POST",
    headers: { "content-type": "application/json", "x-cf-seam-token": SECRET },
    body: JSON.stringify(body)
  });
  const j = await r.json().catch(() => ({}));
  return { http: r.status, ...j };
}

async function emit(name, payload) {
  const res = await watch({
    action: "emit_inngest_probe",
    name,
    email: EMAIL,
    client_id: out.client_id || undefined,
    payload: { email: EMAIL, name: NAME, phone: PHONE, source: "gauntlet-2026-08-13", ...payload }
  });
  const row = {
    name,
    ok: Boolean(res.ok && res.event_id),
    event_id: res.event_id || null,
    inngest: res.inngest_send?.ok === true,
    error: res.error || res.inngest_send?.error || null
  };
  out.emits.push(row);
  console.log("EMIT", name, row.ok ? "PASS" : "FAIL", row.inngest ? "inngest" : "no-inngest", (row.error || "").slice(0, 80));
  return res;
}

async function login(email) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASS })
  });
  const j = await r.json().catch(() => ({}));
  const cookie = (r.headers.get("set-cookie") || "")
    .split(/,(?=[^;]+?=)/)
    .map((s) => s.split(";")[0].trim())
    .join("; ");
  return {
    status: r.status,
    ok: j.ok === true,
    token: j.token,
    headers: {
      cookie,
      authorization: `Bearer ${j.token || ""}`,
      accept: "application/json",
      "content-type": "application/json"
    }
  };
}

async function get(headers, url) {
  const r = await fetch(url.startsWith("http") ? url : BASE + url, { headers });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, json: j };
}

async function post(headers, url, body) {
  const r = await fetch(url.startsWith("http") ? url : BASE + url, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  const t = await r.text();
  let j = {};
  try { j = JSON.parse(t); } catch { j = { raw: t.slice(0, 200) }; }
  return { status: r.status, json: j };
}

function stageOf(pipe, clientId) {
  for (const s of pipe.stages || []) {
    for (const c of s.cards || []) {
      if (String(c.client_id) === String(clientId)) return s.key;
    }
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- gates ---
const health = await get({}, `${BASE}/api/health`);
out.extra.health = { status: health.status, ok: health.json?.ok, pending: health.json?.pending };
console.log("HEALTH", out.extra.health);

const sig = await watch({ action: "cf_sign_selftest" });
out.extra.cf_sign = { http: sig.http, ok: sig.ok, webhook_http: sig.http, response_ok: sig.response };
console.log("CF_SIGN", sig.http, sig.ok, sig.response?.reason || sig.response);

const staff = await login("chris@fundhub.ai");
console.log("LOGIN chris", staff.status, staff.ok);
if (!staff.ok) {
  out.gaps.push("staff login failed");
  fs.writeFileSync(new URL("./run-2026-08-13.json", import.meta.url), JSON.stringify(out, null, 2));
  process.exit(1);
}

// --- W1 spine ---
await emit("entry.captured", { name: NAME, phone: PHONE });
await sleep(1500);
const search1 = await get(staff.headers, `${BASE}/api/read/search?q=${encodeURIComponent(EMAIL)}`);
const found = search1.json?.groups?.clients?.[0];
out.client_id = found?.id || null;
console.log("CLIENT", out.client_id, found?.title);

if (!out.client_id) {
  await sleep(2000);
  const search2 = await get(staff.headers, `${BASE}/api/read/search?q=${encodeURIComponent(EMAIL)}`);
  out.client_id = search2.json?.groups?.clients?.[0]?.id || null;
  console.log("CLIENT retry", out.client_id);
}

const pipeAfterEntry = await get(staff.headers, `${BASE}/api/dashboard/pipeline?pipeline=sales`);
out.correlate.after_entry = stageOf(pipeAfterEntry.json, out.client_id);
console.log("STAGE after entry", out.correlate.after_entry);

await emit("survey.submitted", {
  answers: {
    cf_svy_funding_target_amount: "$50k - $100k",
    cf_svy_planned_use: "Growth (marketing, inventory, hiring)",
    cf_svy_money_change_now: "Grow faster (more customers / more reach)",
    cf_svy_self_reported_fico: "650-699",
    cf_svy_has_business: "Yes, 1-2 years",
    cf_svy_business_revenue: "$100k - $249k",
    cf_svy_revenue_verifiable: "Yes, bank statements",
    cf_svy_available_capital: "Less than $1k"
  }
});
await sleep(1500);
const pipeAfterSurvey = await get(staff.headers, `${BASE}/api/dashboard/pipeline?pipeline=sales`);
out.correlate.after_survey = stageOf(pipeAfterSurvey.json, out.client_id);
console.log("STAGE after survey", out.correlate.after_survey);

await emit("booking.created", {
  bookingUid: `gauntlet-${stamp}`,
  startTime: new Date(Date.now() + 86400000).toISOString(),
  endTime: new Date(Date.now() + 86400000 + 1800000).toISOString()
});
await sleep(1500);
const pipeAfterBook = await get(staff.headers, `${BASE}/api/dashboard/pipeline?pipeline=sales`);
out.correlate.after_book = stageOf(pipeAfterBook.json, out.client_id);
console.log("STAGE after book", out.correlate.after_book);

const more = [
  ["payment.received", { productName: "Diagnostic", amount: 3200, providerRef: `gauntlet-pay-${stamp}`, source: "gauntlet" }],
  ["diagnostic.paid", {}],
  ["decision.rendered", { outcomeTier: "FULL_FUNDING", fundingEstimate: 80000 }],
  ["analysis.completed", { outcomeTier: "FULL_FUNDING", scores: { ex: 680 } }],
  ["call.completed", { duration: 600 }],
  ["deposit.paid", { amount: 300000 }],
  ["sale.closed", {}],
  ["inquiry.gate.raised", {}],
  ["inquiry.docs.needed", {}],
  ["inquiry.removed", {}],
  ["message.inbound", { phone: PHONE, body: "gauntlet inbound", channel: "sms" }],
  ["round.started", { roundNumber: 1 }],
  ["round.submitted", { roundNumber: 1 }],
  ["round.approved", { roundNumber: 1, approvedAmount: 50000 }],
  ["repair.enrolled", {}],
  ["file.finalized", {}],
  ["round.funded", { roundNumber: 1, fundedAmount: 50000 }],
  ["letter.generated", {}],
  ["repair.letters.ready", {}],
  ["invoice.created", { amount: 3000 }],
  ["docs.received", {}],
  ["contract.sent", {}],
  ["contract.signed", {}]
];
for (const [name, payload] of more) {
  await emit(name, payload);
}

await sleep(2500);

const ccp = await get(staff.headers, `${BASE}/api/dashboard/client?id=${out.client_id}`);
const cl = ccp.json?.client || {};
const cf = cl.custom_fields || {};
out.correlate.ccp = {
  ok: Boolean(cl.id),
  email: cl.email,
  phone: cl.phone,
  lifecycle: cf.lifecycle_status,
  capital: cf.cf_svy_available_capital,
  outcome: cl.outcome_tier,
  crs_paid: cf.crs_paid,
  tags: cl.tags || [],
  svyKeys: Object.keys(cf).filter((k) => k.startsWith("cf_svy_")),
  tasks: (ccp.json?.tasks || []).map((t) => t.title),
  tx: (ccp.json?.transactions || []).length,
  messages: (ccp.json?.messages || []).length
};
console.log("CCP", JSON.stringify({
  phone: out.correlate.ccp.phone,
  lifecycle: out.correlate.ccp.lifecycle,
  capital: out.correlate.ccp.capital,
  stage_book: out.correlate.after_book,
  stage_survey: out.correlate.after_survey,
  tags: out.correlate.ccp.tags.length,
  tasks: out.correlate.ccp.tasks.length
}));

for (const name of ["sales", "funding_card_stacking", "optimization"]) {
  const p = await get(staff.headers, `${BASE}/api/dashboard/pipeline?pipeline=${name === "funding_card_stacking" ? "funding" : name === "optimization" ? "repair" : name}`);
  out.correlate[`pipeline_${name}`] = {
    status: p.status,
    stage: stageOf(p.json, out.client_id),
    keys: (p.json?.stages || []).map((s) => s.key).slice(0, 8)
  };
}

const inbox = await get(staff.headers, `${BASE}/api/read/inbox`);
out.correlate.inbox = { status: inbox.status, ok: inbox.json?.ok === true };

// inquiry case
const ir = await post(staff.headers, "/api/inquiry-cases", {
  action: "create",
  client_id: out.client_id,
  bureau: "experian",
  notes: "gauntlet 2026-08-13"
});
out.extra.inquiry = { status: ir.status, ok: ir.json?.ok, id: ir.json?.case?.id || ir.json?.id, error: ir.json?.error };
console.log("INQUIRY", out.extra.inquiry);

// contract template + draft
const templates = await watch({ action: "sql_peek", which: "contract_templates" });
const tid = (templates.rows || []).find((r) => /FUNDING/i.test(r.template_key || r.name || ""))?.id
  || templates.rows?.[0]?.id || null;
out.extra.template_id = tid;
if (tid) {
  const draft = await post(staff.headers, "/api/contracts", {
    action: "create_draft",
    client_id: out.client_id,
    template_id: tid
  });
  const cid = draft.json?.contract?.id || draft.json?.id;
  out.extra.contract_draft = { status: draft.status, ok: draft.json?.ok, id: cid, error: draft.json?.error };
  console.log("CONTRACT draft", out.extra.contract_draft);
  if (cid) {
    const sent = await post(staff.headers, "/api/contracts", { action: "send", id: cid, contract_id: cid });
    out.extra.contract_sent = { status: sent.status, ok: sent.json?.ok, error: sent.json?.error, has_link: Boolean(sent.json?.signing_url || sent.json?.link) };
    console.log("CONTRACT send", out.extra.contract_sent);
    const sign = await post({}, "/api/contracts/sign", { id: cid, contract_id: cid, action: "sign", signature: "Gauntlet Thirteen" });
    out.extra.contract_sign = { status: sign.status, ok: sign.json?.ok, error: sign.json?.error, status_field: sign.json?.contract?.status };
    console.log("CONTRACT sign", out.extra.contract_sign);
  }
} else {
  out.gaps.push("no contract template");
}

// portal
const portalIssue = await watch({ action: "issue_portal_link", email: EMAIL });
out.portal.issue = {
  ok: portalIssue.ok,
  outcome: portalIssue.outcome,
  limited: portalIssue.limited,
  has_token: portalIssue.has_token,
  sent: portalIssue.sent
};
console.log("PORTAL issue", out.portal.issue);
if (portalIssue.token) {
  const verify = await fetch(`${BASE}/api/auth/magic-link-verify?token=${encodeURIComponent(portalIssue.token)}`, { redirect: "manual" });
  out.portal.verify = { status: verify.status, location: verify.headers.get("location") };
  console.log("PORTAL verify", out.portal.verify);
} else {
  out.gaps.push("portal token missing (rate-limit or dry-run send)");
}
const peek = await watch({ action: "peek_portal", email: EMAIL, client_id: out.client_id });
out.portal.peek = {
  accounts: (peek.accounts || []).length,
  links: (peek.magic_links || []).length,
  messages: (peek.magic_messages || []).length
};

// screens
const pages = [
  "/app/pipeline.html",
  "/app/client-control-panel.html",
  "/app/messaging.html",
  "/app/calendar.html",
  "/app/contracts.html",
  "/app/inquiry-remover.html",
  "/app/documents.html",
  "/app/staff-teams.html",
  "/app/hiring.html",
  "/app/sales-floor.html",
  "/app/my-numbers.html",
  "/app/closer-dashboard.html",
  "/app/automations.html",
  "/app/products-commissions.html",
  "/app/finance-os.html",
  "/app/affiliate.html",
  "/app/command-center.html",
  "/app/journeys.html",
  "/app/agent-editor.html",
  "/app/lenders.html"
];
const apis = [
  "/api/read/staff",
  "/api/read/contracts",
  "/api/read/inquiry-cases",
  "/api/read/inbox",
  "/api/read/my-numbers",
  "/api/read/sales-floor",
  "/api/hiring/candidates",
  "/api/read/products",
  "/api/read/commissions",
  `/api/dashboard/client?id=${out.client_id}`,
  "/api/dashboard/pipeline?pipeline=sales",
  "/api/health"
];
for (const p of pages) {
  const r = await fetch(BASE + p);
  out.screens.push({ k: `page ${p}`, ok: r.status === 200, status: r.status });
}
for (const p of apis) {
  const r = await fetch(BASE + p, { headers: staff.headers });
  out.screens.push({ k: `api ${p}`, ok: r.status === 200, status: r.status });
}
const screenFail = out.screens.filter((s) => !s.ok);
console.log("SCREENS", out.screens.filter((s) => s.ok).length + "/" + out.screens.length, "fail", screenFail.map((s) => s.k));

// roles
for (const email of ["chris@fundhub.ai", "owner@fundhub.ai", "admin@fundhub.ai", "jordan@fundhub.ai", "nina@fundhub.ai"]) {
  const l = await login(email);
  out.roles.push({ email, status: l.status, ok: l.ok });
  console.log("ROLE", email, l.status, l.ok ? "PASS" : "FAIL");
}

const emitPass = out.emits.filter((e) => e.ok).length;
const emitFail = out.emits.filter((e) => !e.ok);
out.summary = {
  client_id: out.client_id,
  emit: `${emitPass}/${out.emits.length}`,
  emit_fail: emitFail.map((e) => e.name),
  after_entry: out.correlate.after_entry,
  after_survey: out.correlate.after_survey,
  after_book: out.correlate.after_book,
  screens: `${out.screens.filter((s) => s.ok).length}/${out.screens.length}`,
  roles_ok: out.roles.filter((r) => r.ok).map((r) => r.email),
  roles_fail: out.roles.filter((r) => !r.ok).map((r) => r.email),
  gaps: out.gaps
};
console.log("SUMMARY", JSON.stringify(out.summary, null, 2));

const dest = fileURLToPath(new URL("./run-2026-08-13.json", import.meta.url));
fs.writeFileSync(dest, JSON.stringify(out, null, 2) + "\n");
console.log("WROTE", dest);
