#!/usr/bin/env node
/** Sweep leftover gauntlet APIs + commas signed selftest + leftover events. */
import fs from "fs";

const BASE = "https://fundhub.ai";
const WATCH = `${BASE}/.netlify/functions/tmp-cf-seam-watch`;
const CID = "c9ea0df6-46fb-4499-a480-ba5aeb41f3a0";
const EMAIL = JSON.parse(fs.readFileSync("docs/workflows/e2e-verify-run4-evidence/gauntlet/run-2026-08-13.json", "utf8")).email;
const stamp = Date.now();

function loadEnv() {
  const env = {};
  for (const line of fs.readFileSync(".env", "utf8").split("\n")) {
    const i = line.indexOf("=");
    if (i < 0) continue;
    env[line.slice(0, i)] = line.slice(i + 1);
  }
  return env;
}
const env = { ...loadEnv(), ...process.env };

const out = { at: new Date().toISOString(), commas: {}, apis: [], emits: [], extras: {}, gaps: [] };

async function login(email) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: env.STAFF_E2E_PASSWORD })
  });
  const j = await r.json();
  const cookie = (r.headers.get("set-cookie") || "").split(/,(?=[^;]+?=)/).map((s) => s.split(";")[0].trim()).join("; ");
  return { ok: j.ok, headers: { cookie, authorization: `Bearer ${j.token || ""}`, accept: "application/json", "content-type": "application/json" } };
}

async function watch(body) {
  const r = await fetch(WATCH, {
    method: "POST",
    headers: { "content-type": "application/json", "x-cf-seam-token": env.DASHBOARD_SECRET },
    body: JSON.stringify(body)
  });
  return { http: r.status, ...(await r.json().catch(() => ({}))) };
}

const staff = await login("chris@fundhub.ai");

const commas = await watch({ action: "commas_sign_selftest", email: `bakerskater987+test.commas.${stamp}@gmail.com` });
out.commas = {
  http: commas.http,
  ok: commas.ok,
  webhook_http: commas.http,
  inner_http: commas.response?.status || commas.response?.ok,
  response_keys: Object.keys(commas.response || {}),
  secret_len: commas.secret_len || null,
  error: commas.error || commas.response?.error || null
};
// Don't keep last4 in evidence
console.log("COMMAS", { http: commas.http, ok: commas.ok, inner: commas.response, secret_len: commas.secret_len, err: commas.error });

const reads = [
  `/api/read/closer-call?client_id=${CID}`,
  `/api/read/conversations?client_id=${CID}`,
  `/api/read/agent-context?client_id=${CID}`,
  `/api/read/agents`,
  `/api/read/agent-shadow-log?limit=5`,
  `/api/read/workflows`,
  `/api/read/message-templates`,
  `/api/read/call-outcomes`,
  `/api/read/lenders`,
  `/api/read/lender-matches?client_id=${CID}`,
  `/api/read/lender-observations`,
  `/api/read/tradelines?client_id=${CID}`,
  `/api/read/underwrite?client_id=${CID}`,
  `/api/read/finance-os?client_id=${CID}`,
  `/api/read/finance-command?days=30`,
  `/api/read/money-map?client_id=${CID}`,
  `/api/read/banking-surface?client_id=${CID}`,
  `/api/read/transactions?client_id=${CID}`,
  `/api/read/invoices`,
  `/api/read/funding-rounds`,
  `/api/read/entitlements`,
  `/api/read/affiliates`,
  `/api/read/partners`,
  `/api/read/inquiries`,
  `/api/read/company-activity`,
  `/api/read/ai-bureau-config`,
  `/api/read/proxy-sessions`,
  `/api/read/failed-events`,
  `/api/read/staff`,
  `/api/payment-links`,
  `/api/tasks?client_id=${CID}`,
  `/api/shifts`,
  `/api/journeys?key=client`,
  `/api/read/inbox`
];

for (const p of reads) {
  const r = await fetch(BASE + p, { headers: staff.headers });
  const j = await r.json().catch(() => ({}));
  const row = { p, status: r.status, ok: r.status === 200, err: j.error || null };
  if (p.includes("workflows") && j.workflows) row.n = j.workflows.length || j.count;
  if (p.includes("agents") && !p.includes("shadow") && !p.includes("context")) row.n = (j.agents || j.rows || []).length;
  out.apis.push(row);
  if (r.status !== 200) console.log("API", r.status, p, j.error || "");
}

const posts = [
  ["/api/read/company-brain", { question: "What is FundHub?" }],
  ["/api/read/finance-ask", { question: "What is cashflow?", client_id: CID }],
  ["/api/contracts", { action: "run_reminders" }]
];
for (const [p, body] of posts) {
  const r = await fetch(BASE + p, { method: "POST", headers: staff.headers, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  out.apis.push({ p: "POST " + p, status: r.status, ok: r.status === 200, err: j.error || null });
  console.log("POST", p, r.status, j.error || j.ok || j.message || "ok");
}

const aff = await login("affiliate@fundhub.ai");
if (aff.ok) {
  const r = await fetch(`${BASE}/api/read/company-brain-affiliate`, {
    method: "POST",
    headers: aff.headers,
    body: JSON.stringify({ question: "What is FundHub?" })
  });
  const j = await r.json().catch(() => ({}));
  out.extras.affiliate_brain = { status: r.status, ok: r.status === 200, err: j.error || null };
  console.log("AFF BRAIN", r.status, j.error || "ok");
}

const leftover = [
  ["booking.cancelled", { bookingUid: `cancel-${stamp}` }],
  ["payment.expired", { providerRef: `exp-${stamp}` }],
  ["payment.canceled", { providerRef: `pc-${stamp}` }],
  ["payment.refunded", { providerRef: `ref-${stamp}` }],
  ["payment.disputed", { providerRef: `dis-${stamp}` }],
  ["inquiry.gate.clear", {}],
  ["round.closeout", { roundNumber: 1 }],
  ["commission.earned", { amount: 1000 }],
  ["invoice.paid", { amount: 3000 }],
  ["repair.docs.complete", {}],
  ["repair.analysis.complete", {}],
  ["diy.package.ready", {}],
  ["message.queued", { channel: "sms", body: "gauntlet queued" }]
];
const evEmail = `bakerskater987+test.more.${stamp}@gmail.com`;
await watch({
  action: "emit_inngest_probe",
  name: "entry.captured",
  email: evEmail,
  payload: { email: evEmail, name: "More Gauntlet", phone: "(602) 555-0144", source: "gauntlet-more" }
});
for (const [name, payload] of leftover) {
  const res = await watch({
    action: "emit_inngest_probe",
    name,
    email: evEmail,
    payload: { email: evEmail, source: "gauntlet-more", ...payload }
  });
  out.emits.push({ name, ok: Boolean(res.ok && res.event_id), inngest: res.inngest_send?.ok === true, error: res.error || null });
  if (!res.ok) console.log("EMIT FAIL", name, res.error);
}

const wf = out.apis.find((a) => a.p.includes("/api/read/workflows"));
const agents = out.apis.find((a) => a.p === "/api/read/agents");
out.summary = {
  commas_ok: out.commas.ok === true && (out.commas.http === 200),
  commas_webhook_http: out.commas,
  apis_200: out.apis.filter((a) => a.ok).length,
  apis_fail: out.apis.filter((a) => !a.ok).map((a) => `${a.status} ${a.p} ${a.err || ""}`),
  workflows_n: wf?.n,
  agents_n: agents?.n,
  emits: `${out.emits.filter((e) => e.ok).length}/${out.emits.length}`,
  affiliate_brain: out.extras.affiliate_brain
};
console.log("SUMMARY", JSON.stringify(out.summary, null, 2));
fs.writeFileSync("docs/workflows/e2e-verify-run4-evidence/gauntlet/run-more.json", JSON.stringify(out, null, 2) + "\n");
