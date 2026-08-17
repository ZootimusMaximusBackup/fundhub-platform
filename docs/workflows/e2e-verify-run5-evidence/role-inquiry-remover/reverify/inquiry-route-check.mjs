#!/usr/bin/env node
// Auditor REVERIFY one-off — GET-only re-check of the role-defining route /api/inquiry?action=cases
// (board line 104: 503 not_configured) plus the three reads the inquiry-remover screen uses.
// Records status + top-level shape only. No token, no rows, no PII is written.
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const BASE = process.env.BASE_URL || "https://fundhub.ai";
const EMAIL = "inquiry@fundhub.ai";
const OUT = path.join(ROOT, "docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/reverify/inquiry-route-check.json");

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
if (!password) { console.error("STAFF_E2E_PASSWORD missing"); process.exit(2); }

const login = await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ email: EMAIL, password }) });
const lb = await login.json().catch(() => ({}));
const token = lb?.token || "";
const out = { ranAt: new Date().toISOString(), base: BASE, email: EMAIL, loginStatus: login.status, role: lb?.staff?.role || null, checks: [] };

async function get(route) {
  const r = await fetch(BASE + route, { headers: { accept: "application/json", authorization: "Bearer " + token } });
  const t = await r.text();
  let shape = null;
  try { const j = JSON.parse(t); shape = { ok: j?.ok, error: j?.error || null, keys: Object.keys(j || {}).slice(0, 8), arrayLens: Object.fromEntries(Object.entries(j || {}).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.length])) }; } catch { shape = "non-json"; }
  out.checks.push({ route, status: r.status, shape });
}
await get("/api/inquiry?action=cases");
await get("/api/read/inquiry-cases");
await get("/api/read/inquiries");
await get("/api/pii");
fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
