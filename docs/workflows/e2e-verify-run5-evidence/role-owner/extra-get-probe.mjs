#!/usr/bin/env node
// Auditor follow-up — READ-ONLY. One login as owner@fundhub.ai, then plain GETs
// on (a) reach routes whose -actual.md method column is "—" and are safe to GET
// (no logout/seed/archive/inngest/webhook), and (b) the four hiring reads the
// hiring.html screen loads, so the pageerror seen in the UI walk can be traced.
// Records status + error + top-level key names / item key names only. No PII rows.
// Usage: node docs/workflows/e2e-verify-run5-evidence/role-owner/extra-get-probe.mjs
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const BASE = process.env.BASE_URL || "https://fundhub.ai";
const OUT = path.join(ROOT, "docs/workflows/e2e-verify-run5-evidence/role-owner/extra-get-probe.json");
const email = "owner@fundhub.ai";

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

const ROUTES = [
  "/api/auth/session",
  "/api/climate",
  "/api/climate/config",
  "/api/climate/geocode",
  "/api/dashboard/kpis",
  "/api/dashboard/clients",
  "/api/dashboard/pipeline",
  "/api/dashboard/client",
  "/api/health",
  "/api/inquiry",
  "/api/read/agent-context",
  "/api/read/agent-shadow-log",
  "/api/read/tradelines",
  "/api/social/oauth",
  // hiring screen loads (trace pageerror on hiring.html)
  "/api/hiring/candidates?state=all&limit=200",
  "/api/hiring/postings?limit=200",
  "/api/hiring/decisions?state=all&days=730&limit=200",
  "/api/hiring/bench?limit=200",
  // ops-admin compliance panel call
  "/api/read/messages?status=blocked&limit=30",
  // read/banking-surface (403 in probe) with a dummy uuid to confirm it is config, not role
  "/api/read/banking-surface?client_id=00000000-0000-0000-0000-000000000000"
];

function shapeOf(v, depth = 0) {
  if (Array.isArray(v)) return `array(${v.length})`;
  if (v && typeof v === "object") {
    if (depth >= 1) return "object";
    return "{" + Object.keys(v).map((k) => `${k}:${shapeOf(v[k], depth + 1)}`).join(", ") + "}";
  }
  return typeof v;
}
function itemKeys(body) {
  const arr = body?.items || body?.data?.items || body?.rows;
  if (!Array.isArray(arr) || !arr.length) return null;
  const first = arr[0];
  if (!first || typeof first !== "object") return null;
  // key names + which are null in the first row (no values)
  return Object.keys(first).map((k) => (first[k] === null ? `${k}:null` : k));
}

const login = await fetch(BASE + "/api/auth/login", {
  method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
  body: JSON.stringify({ email, password })
});
const lb = await login.json().catch(() => ({}));
const token = lb?.token || "";
const out = { ranAt: new Date().toISOString(), email, loginStatus: login.status, note: "GET-only follow-up; one login; shapes only, no rows", results: [] };
if (!token) { console.error("login failed", login.status); }

for (const route of ROUTES) {
  const rec = { route, method: "GET" };
  try {
    const res = await fetch(BASE + route, { headers: { authorization: "Bearer " + token, accept: "application/json" }, redirect: "manual" });
    rec.status = res.status;
    if (res.status >= 300 && res.status < 400) rec.location = (res.headers.get("location") || "").replace(/\?.*$/, "?…");
    const text = await res.text().catch(() => "");
    let body = null;
    try { body = JSON.parse(text); } catch { rec.contentType = res.headers.get("content-type") || ""; rec.textLen = text.length; }
    if (body) {
      rec.shape = shapeOf(body);
      rec.error = body?.error || body?.message || "";
      const ik = itemKeys(body);
      if (ik) rec.firstItemKeys = ik;
    }
  } catch (e) {
    rec.status = 0; rec.error = String(e?.message || e).slice(0, 160);
  }
  out.results.push(rec);
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
