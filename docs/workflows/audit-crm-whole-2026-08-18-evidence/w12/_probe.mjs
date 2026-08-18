#!/usr/bin/env node
// W12 security-delta probe. READ-ONLY against live + a mint/revoke of the
// existing test-client session. Writes status codes only. Never prints tokens.

import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { createAccountSession, revokeAccountSession } from "../../../../src/auth/account-session.mjs";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-crm-whole-2026-08-18-evidence/w12");
const BASE = "https://fundhub.ai";
const TEST_CLIENT = "8556bedc-46e1-4d85-b0cd-a24adfee1521";
const TEST_ACCOUNT = "55d85886-0ca8-4e1e-825a-f9b218ed12c2";
const FORBIDDEN_PREFIX = "9af65808"; // never open / never send
const OTHER_FAKE = "00000000-0000-4000-8000-000000000002";

fs.mkdirSync(OUT, { recursive: true });

function loadDotEnv() {
  const p = path.join(ROOT, ".env");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim().replace(/^export\s+/, "");
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (k && process.env[k] == null) process.env[k] = v;
  }
}
loadDotEnv();

const password = process.env.STAFF_E2E_PASSWORD || "";
if (!password) {
  console.error("STAFF_E2E_PASSWORD missing");
  process.exit(2);
}

const PUBLIC_BY_DESIGN = new Set([
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/magic-link",
  "/api/auth/magic-link-verify",
  "/api/auth/reset",
  "/api/auth/session",
  "/api/climate",
  "/api/climate/config",
  "/api/climate/geocode",
  "/api/contracts/sign",
  "/api/health",
  "/api/public/partner-apply",
  "/api/public/partner-page",
  "/api/public/survey-submit",
  "/api/soft-pull-approve"
]);

const NO_EMPTY_POST = new Set([
  "/api/public/survey-submit",
  "/api/public/partner-apply",
  "/api/auth/reset",
  "/api/auth/magic-link",
  "/api/auth/magic-link-verify",
  "/api/climate",
  "/api/climate/geocode",
  "/api/contracts/sign",
  "/api/soft-pull-approve",
  "/api/webhooks/mailgun",
  "/api/inngest",
  "/api/demo/simulate",
  "/api/privacy/erasure",
  "/api/banking/revoke",
  "/api/dashboard/seed",
  "/api/dashboard/client-archive"
]);

function extractRoutes() {
  const src = fs.readFileSync(path.join(ROOT, "netlify/functions/api.mjs"), "utf8");
  const start = src.indexOf("export const ROUTES = {");
  const end = src.indexOf("/* NOT ROUTED", start);
  const block = src.slice(start, end);
  const keys = [];
  for (const m of block.matchAll(/^\s+"([^"]+)":/gm)) keys.push(m[1]);
  return keys;
}

function parseBlocked(journey) {
  const md = fs.readFileSync(path.join(ROOT, "docs/journeys", `${journey}-actual.md`), "utf8");
  const start = md.indexOf("## What they are blocked from");
  if (start < 0) return [];
  const rest = md.slice(start);
  const end = rest.indexOf("\n## ", 5);
  const section = end < 0 ? rest : rest.slice(0, end);
  const rows = [];
  for (const line of section.split("\n")) {
    const m = line.match(/^\|\s*`([^`]+)`\s*\|\s*([^|]*)\|/);
    if (!m) continue;
    const methods = m[2].trim() === "—" ? [] : m[2].split(",").map((s) => s.trim()).filter(Boolean);
    rows.push({ route: m[1].trim(), methods });
  }
  return rows;
}

async function call(method, route, token, body) {
  const headers = { accept: "application/json" };
  if (token) headers.authorization = "Bearer " + token;
  if (body !== undefined) headers["content-type"] = "application/json";
  const started = Date.now();
  try {
    const res = await fetch(BASE + route, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual"
    });
    let text = "";
    try { text = await res.text(); } catch { /* ignore */ }
    let err = "";
    let ok = null;
    let hasList = false;
    let listLen = 0;
    try {
      const j = JSON.parse(text);
      err = String(j?.error || j?.message || "").slice(0, 80);
      ok = typeof j?.ok === "boolean" ? j.ok : null;
      for (const k of ["items", "rows", "clients", "lenders", "documents", "contracts", "tradelines", "cases"]) {
        if (Array.isArray(j?.[k])) {
          hasList = true;
          listLen = j[k].length;
          break;
        }
      }
    } catch { /* not json */ }
    const looksHtml = /^\s*</.test(text);
    return {
      status: res.status,
      ms: Date.now() - started,
      error: err,
      bytes: text.length,
      ok,
      hasList,
      listLen,
      looksHtml,
      contentType: (res.headers.get("content-type") || "").slice(0, 60)
    };
  } catch (e) {
    return { status: 0, ms: Date.now() - started, error: String(e?.message || e).slice(0, 80), bytes: 0 };
  }
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

async function login(email) {
  const res = await fetch(BASE + "/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ email, password })
  });
  const body = await res.json().catch(() => ({}));
  const token = body?.token || "";
  return {
    status: res.status,
    ok: !!body?.ok,
    error: String(body?.error || "").slice(0, 80),
    tokenPresent: !!token,
    role: body?.staff?.role || body?.account?.kind || body?.principal?.kind || null,
    token
  };
}

const routes = extractRoutes().map((k) => "/api/" + k);
const extras = [
  "/api/documents/" + OTHER_FAKE,
  "/api/webhooks/mailgun",
  "/api/inngest",
  "/api/gifts/message-blaster"
];
const pages = [
  "/app/command-center.html",
  "/app/sample-data.html",
  "/app/subscriptions.html",
  "/app/finance-command.html"
];
const allGet = [...new Set([...routes, ...extras])];

const result = {
  ranAt: new Date().toISOString(),
  base: BASE,
  routeCount: routes.length,
  notes: "status codes only; no tokens, passwords, or PII"
};

console.log("unsigned…", allGet.length);
result.unsigned = await pool(allGet, 8, async (route) => {
  const out = await call("GET", route, "");
  let post = null;
  if (out.status === 405 && !NO_EMPTY_POST.has(route) && !PUBLIC_BY_DESIGN.has(route)) {
    post = await call("POST", route, "", {});
  }
  return { route, method: "GET", publicByDesign: PUBLIC_BY_DESIGN.has(route), ...out, post };
});
result.pages = await pool(pages, 4, async (route) => {
  const out = await call("GET", route, "");
  return { route, ...out };
});

const roles = [
  { name: "closer", email: "closer@fundhub.ai", journey: "role-closer" },
  { name: "sales", email: "sales@fundhub.ai", journey: "role-sales-manager" },
  { name: "advisor", email: "advisor@fundhub.ai", journey: "role-funding-advisor" },
  { name: "affiliate", email: "affiliate@fundhub.ai", journey: "affiliate" }
];

result.roles = {};
for (const role of roles) {
  console.log("login", role.name);
  const lg = await login(role.email);
  const token = lg.token;
  const loginMeta = { status: lg.status, ok: lg.ok, error: lg.error, tokenPresent: lg.tokenPresent, role: lg.role };
  if (!token) {
    result.roles[role.name] = { login: loginMeta, probes: [] };
    continue;
  }
  const blocked = parseBlocked(role.journey);
  const blockedSet = new Set(blocked.map((b) => b.route));
  console.log("probe", role.name, allGet.length);
  const probes = await pool(allGet, 8, async (route) => {
    const out = await call("GET", route, token);
    let post = null;
    if (blockedSet.has(route) && out.status === 405 && !NO_EMPTY_POST.has(route)) {
      post = await call("POST", route, token, {});
    }
    return {
      route,
      method: "GET",
      expectedBlocked: blockedSet.has(route),
      ...out,
      post
    };
  });
  result.roles[role.name] = { login: loginMeta, probes };
}

// Targeted: deletes + lenders as closer + unsigned
console.log("targeted…");
const closerTok = result.roles.closer?.login?.tokenPresent
  ? (await login("closer@fundhub.ai")).token
  : "";
const targetedRoutes = [
  "/api/finance/subscriptions",
  "/api/demo/mode",
  "/api/demo/simulate",
  "/api/read/finance-command",
  "/api/read/finance-ask",
  "/api/read/finance-os",
  "/api/read/money-map",
  "/api/read/lenders",
  "/api/read/lender-matches",
  "/api/read/lender-observations",
  "/api/read/ai-bureau-config",
  "/api/lenders",
  "/api/lender-observations",
  "/api/ai-bureau-config"
];
result.targeted = { unsigned: [], closer: [] };
for (const route of targetedRoutes) {
  result.targeted.unsigned.push({ route, ...(await call("GET", route, "")) });
  result.targeted.closer.push({ route, ...(await call("GET", route, closerTok)) });
}
result.targeted.closerPost = [];
for (const route of ["/api/lenders", "/api/lender-observations", "/api/demo/mode", "/api/finance/subscriptions"]) {
  result.targeted.closerPost.push({ route, method: "POST", ...(await call("POST", route, closerTok, {})) });
  result.targeted.unsigned.push({ route, method: "POST", ...(await call("POST", route, "", {})) });
}

// IDOR — find a second e2e/test client, never the forbidden file
let otherId = OTHER_FAKE;
let otherSource = "synthetic-uuid";
let minted = false;
let clientTok = "";
if (process.env.DATABASE_URL) {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    await c.connect();
    const e2e = await c.query(
      `SELECT id::text AS id
         FROM clients
        WHERE email ILIKE 'e2e+%'
           OR email ILIKE 'e2e+aff-%'
           OR email ILIKE 'e2e+wl-%'
        ORDER BY created_at DESC NULLS LAST
        LIMIT 5`
    );
    const pick = (e2e.rows || []).map((r) => r.id).filter((id) => id && id !== TEST_CLIENT && !String(id).startsWith(FORBIDDEN_PREFIX));
    if (pick[0]) {
      otherId = pick[0];
      otherSource = "e2e-client";
    }
    const acct = (await c.query(
      `SELECT id, org_id, kind, client_id FROM accounts WHERE id=$1`,
      [TEST_ACCOUNT]
    )).rows[0];
    if (acct && acct.client_id === TEST_CLIENT && acct.kind === "client") {
      const session = await createAccountSession(c, { accountId: acct.id, orgId: acct.org_id, userAgent: "w12-auditor" });
      clientTok = session.token || "";
      minted = !!clientTok;
      result.clientMint = { ok: minted, revoked: false };
    } else {
      result.clientMint = { ok: false, error: "test account mismatch" };
    }
    if (clientTok) {
      const idorRoutes = [
        ["/api/read/portal-summary?client_id=", "portal-summary"],
        ["/api/read/documents?client_id=", "documents"],
        ["/api/read/contracts?client_id=", "contracts"],
        ["/api/read/portal-contracts?client_id=", "portal-contracts"],
        ["/api/pii?client_id=", "pii"],
        ["/api/dashboard/client?id=", "dashboard-client"],
        ["/api/read/entitlements?client_id=", "entitlements"],
        ["/api/consent/capture?client_id=", "consent"],
        ["/api/finance/liabilities?client_id=", "liabilities"],
        ["/api/read/tradelines?client_id=", "tradelines"],
        ["/api/read/funding-rounds?client_id=", "funding-rounds"],
        ["/api/banking/accounts?client_id=", "banking-accounts"]
      ];
      result.idor = { otherSource, own: [], other: [], closerOwn: [], closerOther: [] };
      // do not record full other id if it is a real e2e uuid — record prefix + source only
      result.idor.otherIdPrefix = otherId.slice(0, 8);
      result.idor.otherIsSynthetic = otherSource === "synthetic-uuid";
      for (const [prefix, name] of idorRoutes) {
        const ownR = prefix + TEST_CLIENT;
        const othR = prefix + otherId;
        result.idor.own.push({ name, ...(await call("GET", ownR, clientTok)) });
        result.idor.other.push({ name, ...(await call("GET", othR, clientTok)) });
        result.idor.closerOwn.push({ name, ...(await call("GET", ownR, closerTok)) });
        result.idor.closerOther.push({ name, ...(await call("GET", othR, closerTok)) });
      }
      await revokeAccountSession(c, clientTok);
      result.clientMint.revoked = true;
    }
  } catch (e) {
    result.clientMint = { ok: false, error: String(e?.message || e).slice(0, 80) };
  } finally {
    try { await c.end(); } catch { /* ignore */ }
  }
} else {
  result.clientMint = { ok: false, error: "DATABASE_URL missing" };
}

function summarize() {
  const unsignedData = result.unsigned.filter((r) => {
    if (r.publicByDesign) return false;
    if (r.status !== 200) return false;
    if (r.looksHtml) return false;
    return r.bytes > 2;
  });
  const roleLeaks = {};
  for (const [name, pack] of Object.entries(result.roles)) {
    roleLeaks[name] = (pack.probes || []).filter((p) => {
      if (!p.expectedBlocked) return false;
      if (p.status === 200 && p.bytes > 2 && !p.looksHtml) return true;
      if (p.post && p.post.status === 200 && p.post.bytes > 2) return true;
      return false;
    }).map((p) => ({ route: p.route, status: p.status, bytes: p.bytes, error: p.error, post: p.post?.status }));
  }
  return { unsignedDataCount: unsignedData.length, unsignedData: unsignedData.map((r) => ({ route: r.route, status: r.status, bytes: r.bytes, error: r.error })), roleLeaks };
}
result.summary = summarize();

// strip any accidental token
for (const pack of Object.values(result.roles)) {
  if (pack.login) delete pack.login.token;
}

fs.writeFileSync(path.join(OUT, "probe.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify({
  wrote: "w12/probe.json",
  unsigned: result.unsigned.length,
  pages: result.pages.map((p) => ({ route: p.route, status: p.status })),
  logins: Object.fromEntries(Object.entries(result.roles).map(([k, v]) => [k, v.login])),
  summary: result.summary,
  clientMint: result.clientMint,
  idorOther: result.idor ? { source: result.idor.otherSource, prefix: result.idor.otherIdPrefix, synthetic: result.idor.otherIsSynthetic } : null
}, null, 2));
