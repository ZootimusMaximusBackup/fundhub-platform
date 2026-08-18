#!/usr/bin/env node
import { loadEnv } from "./load-env.mjs";
loadEnv();

const pw = process.env.STAFF_E2E_PASSWORD;
const BASE = "https://fundhub.ai";
const PROVE = "9af65808-a619-4e65-ae91-239766a006b7";

const accounts = [
  ["owner", "chris@fundhub.ai"],
  ["owner_test", "owner@fundhub.ai"],
  ["admin_test", "admin@fundhub.ai"],
  ["sales_manager", "sales@fundhub.ai"],
  ["closer", "closer@fundhub.ai"],
  ["advisor", "advisor@fundhub.ai"],
  ["inquiry", "inquiry@fundhub.ai"],
  ["setter", "setter@fundhub.ai"],
  ["affiliate", "affiliate@fundhub.ai"],
  ["partner", "partner@fundhub.ai"],
  ["client", "client@fundhub.ai"]
];

const report = { at: new Date().toISOString(), base: BASE, logins: [], apis: [], shells: [], chat: null };

for (const [role, email] of accounts) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: pw })
  });
  const b = await r.json().catch(() => ({}));
  report.logins.push({
    role,
    email,
    http: r.status,
    ok: !!b.ok,
    principal: b.principal || null,
    staffRole: b.staff?.role || null,
    error: b.error || null
  });
}

const loginRes = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "chris@fundhub.ai", password: pw })
});
const loginBody = await loginRes.json();
const token = loginBody.token;
const auth = token ? { authorization: `Bearer ${token}` } : {};

// GET /api/read/messages requires conversation_id (uuid). A bare ?limit=3 is
// correctly 400 invalid_parameter — that is the anti-leak guard, not a bug.
// Resolve a real thread for the prove client when one exists; otherwise use a
// well-formed uuid and expect 200 with an empty items list.
let conversationId = "00000000-0000-4000-8000-000000000001";
if (token) {
  const convRes = await fetch(
    `${BASE}/api/read/conversations?client_id=${PROVE}&limit=1`,
    { headers: { ...auth, accept: "application/json" } }
  );
  const convBody = await convRes.json().catch(() => ({}));
  if (Array.isArray(convBody.items) && convBody.items[0]?.id) {
    conversationId = convBody.items[0].id;
  }
}

for (const [name, path] of [
  ["health", "/api/health"],
  ["pipeline", "/api/dashboard/pipeline"],
  ["kpis", "/api/dashboard/kpis"],
  ["inquiry_cases", "/api/read/inquiry-cases"],
  ["staff", "/api/read/staff"],
  ["products", "/api/read/products"],
  ["commissions", "/api/read/commissions"],
  ["search_prove", "/api/read/search?q=prove"],
  ["client_prove", `/api/dashboard/client?id=${PROVE}`],
  ["tradelines_prove", `/api/read/tradelines?client_id=${PROVE}`],
  ["my_numbers", "/api/read/my-numbers"],
  ["partners", "/api/read/partners"],
  ["affiliates", "/api/read/affiliates"],
  ["messages", `/api/read/messages?conversation_id=${conversationId}&limit=3`],
  ["tasks", "/api/tasks?limit=5"]
]) {
  const r = await fetch(BASE + path, { headers: { ...auth, accept: "application/json" } });
  let snippet = null;
  try {
    const b = await r.json();
    snippet = b.error || (Array.isArray(b.items) ? `items:${b.items.length}` : null)
      || (Array.isArray(b.data) ? `data:${b.data.length}` : null)
      || (b.client?.first_name ? `client:${b.client.first_name}` : null)
      || (b.ok === true ? "ok" : JSON.stringify(b).slice(0, 60));
  } catch {
    snippet = "non-json";
  }
  report.apis.push({ name, path, status: r.status, snippet });
}

const pages = [
  "pipeline.html", "client-control-panel.html", "inquiry-remover.html", "affiliate.html",
  "partner-galaxy.html", "client-portal.html", "staff-teams.html", "closer-dashboard.html",
  "my-numbers.html", "sales-floor.html", "calendar.html", "present.html", "command-center.html",
  "ops-admin.html", "automations.html", "messaging.html", "contracts.html", "finance-os.html",
  "brand-studio.html", "galaxy.html", "documents.html", "lenders.html", "products-commissions.html",
  "agent-editor.html", "template-editor.html", "journeys.html", "campaign-manager.html",
  "social-studio.html", "creative-factory.html", "content-admin.html", "hiring.html",
  "company-brain.html", "subscriptions.html", "soft-pull-approve.html",
  "payment-success.html", "closer-call.html", "index.html"
];

const BAD = ["[object Promise]", "Derek Owusu", "Marcus Webb", "Jordan Blake", "Sun Jul 26", "DKOWAL-000123", "Elena Voss", "Bianca Souza"];

for (const p of pages) {
  const r = await fetch(`${BASE}/app/${p}`, { headers: auth });
  const t = await r.text();
  report.shells.push({
    page: p,
    status: r.status,
    bad: BAD.filter((x) => t.includes(x)),
    bytes: t.length
  });
}

if (token) {
  const c = await fetch(`${BASE}/api/chat/ask`, {
    method: "POST",
    headers: { "content-type": "application/json", ...auth },
    body: JSON.stringify({ question: "What is Fundhub?" })
  });
  const cb = await c.json().catch(() => ({}));
  report.chat = { status: c.status, ok: cb.ok, error: cb.error || null };
}

report.login_ok = report.logins.filter((x) => x.ok).map((x) => x.role);
report.login_fail = report.logins.filter((x) => !x.ok).map((x) => ({ role: x.role, error: x.error }));
report.shell_bad = report.shells.filter((x) => x.bad.length);
report.api_fail = report.apis.filter((x) => x.status >= 400);

console.log(JSON.stringify(report, null, 2));
