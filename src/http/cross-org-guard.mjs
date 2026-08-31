// cross-org-guard — auto-enumerates api/ handlers that accept an id / client_id
// and classifies whether each one scopes to the session org.
//
// THE CLASS OF BUG. A handler that looks up a row by id from the request and
// never binds the session's org_id will hand another company's data to whoever
// knows a UUID. Confirmed live on api/dashboard/client.mjs (2026-08-04).
//
// This module is the recurrence guard: new endpoints that accept an id are
// discovered from the filesystem, not from a hand list. The static test fails
// CI when a new one lacks an org-scoping marker. The pg test probes every
// classified client-scoped handler with an org-B session against an org-A row.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const API_ROOT = path.resolve(HERE, "../../api");

/** Paths (posix, relative to api/) that authenticate by HMAC / public token /
 *  webhook secret rather than a staff session. Org-from-session does not apply. */
export const SESSIONLESS_ALLOWLIST = new Set([
  "documents/[id].mjs",
  "contracts/sign.mjs",
  "webhooks/[provider].mjs",
  "public/partner-page.mjs",
  "health.mjs",
  "auth/login.mjs",
  "auth/logout.mjs",
  "auth/session.mjs",
  "auth/reset.mjs",
  "auth/admin-reset.mjs",
  "auth/magic-link.mjs",
  "auth/magic-link-verify.mjs",
  // Proxies an external service with a server-side secret; no local row by id.
  "inquiry.mjs",
  // Dev seed writes via the event bus; does not look up by foreign id.
  "dashboard/seed.mjs",
  /* The $27 Decline Autopsy upload. SESSIONLESS BY DESIGN: the credential is
     the paid `autopsy_ref` plus the merchant attestation, because the buyer is
     a stranger from an ad with no login and no client record. It IS org-scoped
     — every call it makes into src/autopsy/store.mjs passes orgId and every
     statement there carries `WHERE org_id = $1` — but the scope lives in the
     store module, not in this file's text, so the static marker scan cannot see
     it. The only reason it is discovered as id-shaped at all is the phrase
     "client_id" in its own header comment explaining why it is NOT
     api/documents-upload.mjs. There is no client id in this flow and there must
     never be one: decline_autopsy_rows has no client_id column. */
  "public/decline-autopsy-upload.mjs"
]);

/** Markers that prove the handler binds tenancy to the session (or partner
 *  scope / RLS). Presence of ANY one is enough for the static guard. */
const ORG_SCOPE_MARKERS = [
  /requireClientInOrg\b/,
  /requireSessionOrg\b/,
  /ownsClient\b/,
  /partnerReadHandler\b/,
  /withPartnerScope\b/,
  /assertCanReadClient\b/,
  /staff\.org_id\b/,
  /principal\.orgId\b/,
  /orgId\s*=\s*staff/,
  /org_id\s*=\s*\$/,
  /AND\s+org_id\b/i,
  /WHERE[^\n]*org_id/i,
  /orgOf\s*\(/,
  /SESSION_OWNED/
];

/** Does this source accept a record id from the request? */
const ID_PARAM_MARKERS = [
  /query\??\.(id|client_id)\b/,
  /req\.query\??\.(id|client_id)\b/,
  /body\.(id|client_id)\b/,
  /req\.body\??\.(id|client_id)\b/,
  /\bclient_id\b/
];

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, out);
    else if (ent.name.endsWith(".mjs")) out.push(full);
  }
  return out;
}

function relApi(abs) {
  return path.relative(API_ROOT, abs).split(path.sep).join("/");
}

/**
 * discoverIdEndpoints() → [{ rel, abs, acceptsId, scoped, sessionless }]
 * Every .mjs file under api/ that looks like it takes an id/client_id.
 */
export function discoverIdEndpoints() {
  const files = walk(API_ROOT);
  const out = [];
  for (const abs of files) {
    const rel = relApi(abs);
    const src = fs.readFileSync(abs, "utf8");
    const acceptsId = ID_PARAM_MARKERS.some((re) => re.test(src));
    if (!acceptsId) continue;
    const sessionless = SESSIONLESS_ALLOWLIST.has(rel);
    const scoped = sessionless || ORG_SCOPE_MARKERS.some((re) => re.test(src));
    out.push({ rel, abs, acceptsId, scoped, sessionless });
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

/**
 * Runtime probes for client-row isolation. Built from discovery + known
 * handler import paths. Each probe seeds nothing itself — the test fixture
 * supplies orgAClientId / orgATaskId / tokens.
 *
 * kind:
 *   client_query  — GET ?id=<client>
 *   client_id_q   — GET ?client_id=<client>
 *   task_get      — GET ?client_id=<client> on tasks
 *   task_patch    — PATCH { id: <task> }
 *   clients_list  — GET list must not include foreign client id
 */
export function buildRuntimeProbes() {
  // Map route key → dynamic import path under api/
  const discovered = discoverIdEndpoints().filter((e) => !e.sessionless);
  const byRel = new Map(discovered.map((e) => [e.rel, e]));

  const probes = [];

  const add = (probe) => {
    // Only keep probes whose handler still exists and is still id-shaped.
    if (!byRel.has(probe.rel) && !probe.force) return;
    probes.push(probe);
  };

  add({
    name: "dashboard/client",
    rel: "dashboard/client.mjs",
    force: true,
    kind: "client_query",
    method: "GET",
    importPath: "../../api/dashboard/client.mjs"
  });
  add({
    name: "dashboard/clients",
    rel: "dashboard/clients.mjs",
    force: true,
    kind: "clients_list",
    method: "GET",
    importPath: "../../api/dashboard/clients.mjs"
  });
  add({
    name: "tasks GET by client_id",
    rel: "tasks.mjs",
    force: true,
    kind: "task_get",
    method: "GET",
    importPath: "../../api/tasks.mjs"
  });
  add({
    name: "tasks PATCH by id",
    rel: "tasks.mjs",
    force: true,
    kind: "task_patch",
    method: "PATCH",
    importPath: "../../api/tasks.mjs"
  });

  // Every discovered read handler that binds client_id in the query string.
  for (const e of discovered) {
    if (!e.rel.startsWith("read/") && !e.rel.startsWith("banking/") &&
        !e.rel.startsWith("finance/") && e.rel !== "dashboard/client.mjs") {
      continue;
    }
    const src = fs.readFileSync(e.abs, "utf8");
    if (!/client_id/.test(src)) continue;
    if (e.rel === "dashboard/client.mjs") continue; // already added as client_query
    // Prefer GET client_id probes for read surfaces.
    if (!/method|GET|readHandler|requireClientInOrg/.test(src)) continue;
    probes.push({
      name: e.rel.replace(/\.mjs$/, ""),
      rel: e.rel,
      kind: "client_id_q",
      method: "GET",
      importPath: `../../api/${e.rel}`
    });
  }

  // Deduplicate by name.
  const seen = new Set();
  return probes.filter((p) => {
    if (seen.has(p.name)) return false;
    seen.add(p.name);
    return true;
  });
}

export default { discoverIdEndpoints, buildRuntimeProbes, SESSIONLESS_ALLOWLIST };
