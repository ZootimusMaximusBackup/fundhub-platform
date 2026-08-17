#!/usr/bin/env node
// Auditor evidence tool — READ-ONLY against the live app.
//
// Logs in as one staff role (password from gitignored .env, never printed),
// then hits every route listed in docs/journeys/<journey>-actual.md and records
// the HTTP status. It never sends a body to a route the role is allowed to
// reach (no production writes). It only sends an EMPTY `{}` POST to routes the
// role should be BLOCKED from — a 403 there proves the gate; anything else is
// the finding.
//
// Usage: node docs/workflows/e2e-verify-run5-evidence/_tools/probe-role.mjs <journey> <email>
//   e.g. node .../probe-role.mjs role-closer closer@fundhub.ai
// Output: docs/workflows/e2e-verify-run5-evidence/<journey>/route-probe.json + route-probe.md

import fs from "node:fs";
import path from "node:path";

const [journey, email] = process.argv.slice(2);
if (!journey || !email) {
  console.error("usage: probe-role.mjs <journey> <email>");
  process.exit(2);
}
const ROOT = process.cwd();
const BASE = process.env.BASE_URL || "https://fundhub.ai";
const OUT_DIR = path.join(ROOT, "docs/workflows/e2e-verify-run5-evidence", journey);
fs.mkdirSync(OUT_DIR, { recursive: true });

// --- .env (names only ever leave this function) ---------------------------
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
  console.error("STAFF_E2E_PASSWORD missing from env/.env — cannot log in");
  process.exit(2);
}

// --- parse the -actual.md route tables --------------------------------------
const actualPath = path.join(ROOT, "docs/journeys", `${journey}-actual.md`);
const intendedPath = path.join(ROOT, "docs/journeys", `${journey}-intended.md`);
const actual = fs.readFileSync(actualPath, "utf8");
const intended = fs.readFileSync(intendedPath, "utf8");

function parseTable(md, heading) {
  const start = md.indexOf(heading);
  if (start < 0) return [];
  const rest = md.slice(start);
  const end = rest.indexOf("\n## ", 5);
  const section = end < 0 ? rest : rest.slice(0, end);
  const rows = [];
  for (const line of section.split("\n")) {
    const m = line.match(/^\|\s*`([^`]+)`\s*\|\s*([^|]*)\|\s*(.*)\|\s*$/);
    if (!m) continue;
    const methods = m[2].trim() === "—" ? [] : m[2].split(",").map((s) => s.trim()).filter(Boolean);
    rows.push({ route: m[1].trim(), methods, gate: m[3].trim().replace(/<br>/g, " ") });
  }
  return rows;
}
const reach = parseTable(actual, "## What they can reach");
const blocked = parseTable(actual, "## What they are blocked from");

// intended vs actual group counts (the intended file only names groups + counts)
const AREA_LABEL = {
  read: "Reading data", dashboard: "The dashboard", campaigns: "Campaigns",
  creative: "Creative Factory", hiring: "Hiring", auth: "Signing in and out",
  finance: "Finance", webhooks: "Incoming webhooks", documents: "Documents",
  "top level": "Everything else"
};
function area(route) {
  const key = route.replace(/^\/api\//, "");
  return key.includes("/") ? key.split("/")[0] : "top level";
}
const label = (a) => AREA_LABEL[a] || a;
function countGroups(rows) {
  const m = new Map();
  for (const r of rows) m.set(label(area(r.route)), (m.get(label(area(r.route))) || 0) + 1);
  return m;
}
function intendedGroups(md, heading) {
  const start = md.indexOf(heading);
  if (start < 0) return new Map();
  const rest = md.slice(start);
  const end = rest.indexOf("\n## ", 5);
  const section = end < 0 ? rest : rest.slice(0, end);
  const m = new Map();
  for (const line of section.split("\n")) {
    const g = line.match(/^- \*\*(.+?)\*\* \((\d+) routes?\)/);
    if (g) m.set(g[1], Number(g[2]));
  }
  return m;
}
const intReach = intendedGroups(intended, "## Should be able to reach");
const intBlocked = intendedGroups(intended, "## Should stay blocked from");
const actReach = countGroups(reach);
const actBlocked = countGroups(blocked);

// --- HTTP ---------------------------------------------------------------------
async function call(method, route, token, body) {
  const headers = { accept: "application/json" };
  if (token) headers.authorization = "Bearer " + token;
  if (body !== undefined) headers["content-type"] = "application/json";
  const started = Date.now();
  try {
    const res = await fetch(BASE + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
    let text = "";
    try { text = await res.text(); } catch { /* ignore */ }
    let err = "";
    try { const j = JSON.parse(text); err = j?.error || j?.message || ""; } catch { /* not json */ }
    return { status: res.status, ms: Date.now() - started, error: String(err).slice(0, 80), bytes: text.length };
  } catch (e) {
    return { status: 0, ms: Date.now() - started, error: String(e?.message || e).slice(0, 80), bytes: 0 };
  }
}

const result = { journey, email, base: BASE, ranAt: new Date().toISOString(), login: null, session: null, unauth: [], reach: [], blocked: [], groups: {} };

// Step 1 — sign in
const loginRes = await fetch(BASE + "/api/auth/login", {
  method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
  body: JSON.stringify({ email, password })
});
const loginBody = await loginRes.json().catch(() => ({}));
const token = loginBody?.token || "";
result.login = {
  status: loginRes.status, ok: !!loginBody?.ok, error: loginBody?.error || "",
  tokenPresent: !!token, staff: loginBody?.staff ? { role: loginBody.staff.role, email: loginBody.staff.email, id: loginBody.staff.id, status: loginBody.staff.status } : null,
  setCookie: /fundhub_session/.test(loginRes.headers.get("set-cookie") || "")
};
if (!token) {
  console.error("login failed", result.login);
}

// who am I (session route)
if (token) {
  const s = await fetch(BASE + "/api/auth/session", { headers: { authorization: "Bearer " + token, accept: "application/json" } });
  const sb = await s.json().catch(() => ({}));
  result.session = { status: s.status, role: sb?.staff?.role || sb?.role || sb?.session?.role || null, ok: !!sb?.ok };
}

// Step 0 — not signed in → 401 (sample of 6 reach routes with GET)
for (const r of reach.filter((x) => x.methods.includes("GET") && !/anyone|public/i.test(x.gate)).slice(0, 6)) {
  const out = await call("GET", r.route, "");
  result.unauth.push({ route: r.route, expected: 401, ...out });
}

// Step 2 — should reach (GET only; POST-only routes are UNVERIFIED — no writes)
for (const r of reach) {
  if (r.methods.includes("GET")) {
    const out = await call("GET", r.route, token);
    result.reach.push({ route: r.route, method: "GET", gate: r.gate, expected: "not 401/403/404", ...out });
  } else {
    result.reach.push({ route: r.route, method: r.methods.join(",") || "—", gate: r.gate, expected: "not 401/403/404", status: null, note: "UNVERIFIED — write-only route, not probed" });
  }
}

// Step 3 — should stay blocked (GET if allowed, else empty POST; DELETE never)
for (const r of blocked) {
  let method = null;
  if (r.methods.includes("GET")) method = "GET";
  else if (r.methods.includes("POST")) method = "POST";
  if (!method) {
    result.blocked.push({ route: r.route, method: r.methods.join(",") || "—", gate: r.gate, expected: 403, status: null, note: "UNVERIFIED — no GET/POST method to probe safely" });
    continue;
  }
  const out = await call(method, r.route, token, method === "POST" ? {} : undefined);
  result.blocked.push({ route: r.route, method, gate: r.gate, expected: 403, ...out });
}

result.groups = {
  reach: [...new Set([...intReach.keys(), ...actReach.keys()])].map((g) => ({ group: g, intended: intReach.get(g) ?? 0, actual: actReach.get(g) ?? 0 })),
  blocked: [...new Set([...intBlocked.keys(), ...actBlocked.keys()])].map((g) => ({ group: g, intended: intBlocked.get(g) ?? 0, actual: actBlocked.get(g) ?? 0 }))
};

// --- summary --------------------------------------------------------------
const reachProbed = result.reach.filter((r) => r.status !== null);
const reachBad = reachProbed.filter((r) => [401, 403, 404, 0].includes(r.status) || r.status >= 500);
const blockedProbed = result.blocked.filter((r) => r.status !== null);
const blockedBad = blockedProbed.filter((r) => r.status !== 403);
const unauthBad = result.unauth.filter((r) => r.status !== 401);
result.summary = {
  reachTotal: reach.length, reachProbed: reachProbed.length, reachUnverified: reach.length - reachProbed.length, reachBad: reachBad.length,
  blockedTotal: blocked.length, blockedProbed: blockedProbed.length, blockedUnverified: blocked.length - blockedProbed.length, blockedBad: blockedBad.length,
  unauthBad: unauthBad.length
};

fs.writeFileSync(path.join(OUT_DIR, "route-probe.json"), JSON.stringify(result, null, 2));

const md = [];
md.push(`# ${journey} — live route probe`);
md.push(``);
md.push(`Ran ${result.ranAt} against ${BASE} as \`${email}\`.`);
md.push(``);
md.push(`| Check | Result |`);
md.push(`|---|---|`);
md.push(`| Login | HTTP ${result.login.status}, ok=${result.login.ok}, role=${result.login.staff?.role ?? "—"}, token=${result.login.tokenPresent}, cookie=${result.login.setCookie} |`);
md.push(`| Session | HTTP ${result.session?.status ?? "—"}, role=${result.session?.role ?? "—"} |`);
md.push(`| Not signed in → 401 | ${result.unauth.length - unauthBad.length}/${result.unauth.length} correct |`);
md.push(`| Should reach | ${reachProbed.length - reachBad.length}/${reachProbed.length} probed OK · ${result.summary.reachUnverified} UNVERIFIED (write-only) · ${reachBad.length} FAIL |`);
md.push(`| Should stay blocked | ${blockedProbed.length - blockedBad.length}/${blockedProbed.length} probed 403 · ${result.summary.blockedUnverified} UNVERIFIED · ${blockedBad.length} FAIL |`);
md.push(``);
md.push(`## Intended vs actual group counts`);
md.push(``);
md.push(`| Side | Group | Intended | Actual (code) |`);
md.push(`|---|---|---|---|`);
for (const g of result.groups.reach) md.push(`| reach | ${g.group} | ${g.intended} | ${g.actual}${g.intended !== g.actual ? " ⚠️" : ""} |`);
for (const g of result.groups.blocked) md.push(`| blocked | ${g.group} | ${g.intended} | ${g.actual}${g.intended !== g.actual ? " ⚠️" : ""} |`);
md.push(``);
md.push(`## Failures — should reach but got 401/403/404/5xx`);
md.push(``);
md.push(`| Route | Method | Status | Error | Gate (code says) |`);
md.push(`|---|---|---|---|---|`);
for (const r of reachBad) md.push(`| \`${r.route}\` | ${r.method} | ${r.status} | ${r.error} | ${r.gate} |`);
if (!reachBad.length) md.push(`| — | | | | |`);
md.push(``);
md.push(`## Failures — should be blocked but was not 403`);
md.push(``);
md.push(`| Route | Method | Status | Error | Gate (code says) |`);
md.push(`|---|---|---|---|---|`);
for (const r of blockedBad) md.push(`| \`${r.route}\` | ${r.method} | ${r.status} | ${r.error} | ${r.gate} |`);
if (!blockedBad.length) md.push(`| — | | | | |`);
md.push(``);
md.push(`## Not signed in`);
md.push(``);
md.push(`| Route | Status (expect 401) |`);
md.push(`|---|---|`);
for (const r of result.unauth) md.push(`| \`${r.route}\` | ${r.status} |`);
md.push(``);
md.push(`## Every probe`);
md.push(``);
md.push(`| Side | Route | Method | Status | Note |`);
md.push(`|---|---|---|---|---|`);
for (const r of result.reach) md.push(`| reach | \`${r.route}\` | ${r.method} | ${r.status ?? "—"} | ${r.note || r.error || ""} |`);
for (const r of result.blocked) md.push(`| blocked | \`${r.route}\` | ${r.method} | ${r.status ?? "—"} | ${r.note || r.error || ""} |`);
fs.writeFileSync(path.join(OUT_DIR, "route-probe.md"), md.join("\n") + "\n");

console.log(JSON.stringify({ journey, email, login: result.login, session: result.session, summary: result.summary, groups: result.groups }, null, 2));
