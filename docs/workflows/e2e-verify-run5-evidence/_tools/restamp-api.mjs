#!/usr/bin/env node
// Targeted live API restamp for open board rows. Password from .env, never printed.
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const BASE = process.env.BASE_URL || "https://fundhub.ai";
const OUT = path.join(ROOT, "docs/workflows/e2e-verify-run5-evidence/_restamp-2026-08-17");
fs.mkdirSync(OUT, { recursive: true });

function loadEnvPassword() {
  if (process.env.STAFF_E2E_PASSWORD) return process.env.STAFF_E2E_PASSWORD;
  const p = path.join(ROOT, ".env");
  if (!fs.existsSync(p)) return "";
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?STAFF_E2E_PASSWORD\s*=\s*(.*)\s*$/);
    if (m) return m[1].replace(/^["']|["']$/g, "");
  }
  return "";
}
const password = loadEnvPassword();
if (!password) {
  console.error("STAFF_E2E_PASSWORD missing");
  process.exit(2);
}

const ROLES = [
  ["closer", "closer@fundhub.ai"],
  ["funding_advisor", "advisor@fundhub.ai"],
  ["inquiry_specialist", "inquiry@fundhub.ai"],
  ["sales_manager", "sales@fundhub.ai"],
  ["owner", "owner@fundhub.ai"],
  ["client", "client@fundhub.ai"],
  ["affiliate", "affiliate@fundhub.ai"],
  ["partner", "partner@fundhub.ai"],
];

const PATHS = [
  { method: "GET", path: "/api/read/my-numbers" },
  { method: "GET", path: "/api/repair/exceptions" },
  { method: "GET", path: "/api/read/banking-surface" },
  { method: "GET", path: "/api/inquiry?action=cases" },
  { method: "GET", path: "/api/read/staff?limit=5" },
  { method: "GET", path: "/api/read/invoices?limit=5" },
  { method: "GET", path: "/api/read/failed-events?limit=5" },
  { method: "GET", path: "/api/read/commissions?limit=5" },
  { method: "GET", path: "/api/read/messages?status=blocked&limit=5" },
  { method: "GET", path: "/api/demo/mode" },
  { method: "GET", path: "/api/campaigns/list" },
  { method: "POST", path: "/api/read/company-brain-affiliate", body: {} },
];

async function login(email) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json().catch(() => ({}));
  return {
    status: res.status,
    ok: json.ok === true,
    role: json.staff?.role || json.account?.kind || json.principal || null,
    token: json.token || null,
  };
}

async function hit(token, { method, path: p, body }) {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return {
    method,
    path: p,
    status: res.status,
    ok: json.ok,
    error: json.error || json.message || null,
  };
}

const report = { ranAt: new Date().toISOString(), base: BASE, roles: {} };
for (const [role, email] of ROLES) {
  const auth = await login(email);
  const row = { loginStatus: auth.status, loginOk: auth.ok, role: auth.role, hits: [] };
  if (!auth.token) {
    row.loginError = "no token";
    report.roles[role] = row;
    continue;
  }
  for (const spec of PATHS) row.hits.push(await hit(auth.token, spec));
  report.roles[role] = row;
}

fs.writeFileSync(path.join(OUT, "api-probe.json"), JSON.stringify(report, null, 2));
const lines = [`# API restamp ${report.ranAt}`, ""];
for (const [role, row] of Object.entries(report.roles)) {
  lines.push(`## ${role} (login ${row.loginStatus} role=${row.role})`);
  for (const h of row.hits || []) {
    lines.push(`- ${h.method} ${h.path} → ${h.status} ${h.error || (h.ok ? "ok" : "")}`.trim());
  }
  lines.push("");
}
fs.writeFileSync(path.join(OUT, "api-probe.md"), lines.join("\n"));
console.log(JSON.stringify(report, null, 2));
