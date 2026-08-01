// Extract, FROM THE CODE, who can actually reach what.
//
// CLAUDE.md §4: "Generate `-actual.md` from code, never from the spec or from
// memory. If you cannot trace a path in the code, mark it UNVERIFIED in the
// diagram. Do not draw what you assume."
//
// This file is the "from code" half, and it is deliberately literal. It reads
// four things and infers nothing else:
//
//   1. netlify/functions/api.mjs  — the ROUTES map. A handler absent from that
//      map is unreachable, so the map is the definition of "what exists".
//   2. src/http/read-api.mjs      — the ROLE_SETS values, so a journey says
//      "owner, admin" and not "FINANCE", which means nothing to a reader.
//   3. each api/*.mjs handler     — its own gate.
//   4. two shared wrappers        — partner-read-api.mjs and dashboard-auth.mjs,
//      whose gates are read from THEIR source, not hardcoded here.
//
// WHAT IT WILL NOT DO. When a handler's gate does not match a known shape, this
// returns kind "unverified" with the reason. It never guesses, never falls back
// to "probably staff", and never omits the route to keep the picture tidy. An
// unverified gate is a finding — possibly a real hole — and hiding it in a
// generator would be the most expensive kind of quiet.
//
// PARSED, NOT IMPORTED. Importing the adapter would execute every handler
// module's imports; a docs generator that fails because an unrelated handler has
// a broken import is a docs generator nobody runs. Text is enough here because
// the shapes are small and fixed, and anything unfamiliar is reported rather
// than assumed.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(REPO, rel));

/* Strip // line comments and block comments before matching.
   Every file in this repo carries long comment headers that discuss the very
   gates being detected — api/read/tradelines.mjs's header quotes the BROKEN
   `{ roles: ROLE_SETS.STAFF }` call that shipped. Matching against prose would
   read that comment as the gate and report the opposite of the truth. */
// ORDER MATTERS HERE, and getting it wrong silently produced an empty routing
// table on the first run. netlify/functions/api.mjs has this line in its header:
//
//     // One function serves every /api/* path (config.path below).
//
// The `/*` inside `/api/*` opens a block comment as far as a regex is concerned.
// Stripping block comments FIRST therefore ate everything from the header down to
// the next `*/` — every import statement in the file — and the extractor reported
// 48 unverified routes with "handler file ? not found on disk" rather than
// failing. So: whole-line `//` comments go first, and only then block comments.
//
// The line filter is anchored to the start of the line on purpose. Stripping a
// `//` anywhere would truncate any line holding a URL.
export function code(src) {
  return src
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

/* ---------------------------------------------------------------------------
   1. The routing table — key → handler file
   ------------------------------------------------------------------------ */

/** routes() → [{ key, file }] for every exact ROUTES entry. */
export function routes() {
  const src = code(read("netlify/functions/api.mjs"));

  // identifier → api/... path
  const imports = new Map();
  for (const m of src.matchAll(/import\s+(?:\{[^}]*\bas\s+(\w+)\s*\}|(\w+))\s+from\s+"\.\.\/\.\.\/(api\/[^"]+)"/g)) {
    imports.set(m[1] || m[2], m[3]);
  }

  const body = /export const ROUTES = \{([\s\S]*?)\n\};/.exec(src);
  if (!body) throw new Error("extract: could not find the ROUTES literal in netlify/functions/api.mjs");

  const out = [];
  for (const m of body[1].matchAll(/"([^"]+)"\s*:\s*(\w+)/g)) {
    out.push({ key: m[1], file: imports.get(m[2]) || null, identifier: m[2] });
  }
  return out;
}

/* Reached by a prefix branch in the adapter's handler() rather than an exact
   key. Named here because "absent from ROUTES" must not read as "unreachable"
   for these — the same list src/http/routes.test.mjs keeps, for the same reason. */
export const PREFIX_ROUTED = [
  { key: "webhooks/:provider", file: "api/webhooks/[provider].mjs" },
  { key: "documents/:id", file: "api/documents/[id].mjs" },
  { key: "inngest", file: "api/inngest.mjs" }
];

/* ---------------------------------------------------------------------------
   2. ROLE_SETS, resolved to actual role names
   ------------------------------------------------------------------------ */

/** roleSets() → { STAFF: ["owner", ...], ... } */
export function roleSets() {
  const src = code(read("src/http/read-api.mjs"));
  const block = /export const ROLE_SETS = \{([\s\S]*?)\n\};/.exec(src);
  if (!block) throw new Error("extract: could not find ROLE_SETS in src/http/read-api.mjs");

  const sets = {};
  for (const m of block[1].matchAll(/(\w+)\s*:\s*new Set\(\[([^\]]*)\]\)/g)) {
    sets[m[1]] = [...m[2].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  }
  return sets;
}

/* THERE IS NO IMPLICIT SUPER-ROLE ON THE READ PATH, and this matters enough to
   state. There are TWO different requireRole functions in this repo:

     src/http/read-api.mjs           requireRole(res, staff, roleSet)
       — plain set membership. No super-role.
     src/http/middleware/requireRole.mjs  requireRole(...allowed)
       — has SUPER_ROLES = ["owner"], so owner passes every gate.

   The endpoints in api/ use the FIRST one. Owner reaches everything only because
   "owner" is written into each ROLE_SETS value by hand. If someone removes it
   from one, the owner loses that route — there is no safety net. A journey that
   quietly added owner everywhere would hide that. */
export function superRoleApplies() {
  const src = code(read("src/http/read-api.mjs"));
  return /SUPER_ROLES/.test(src);
}

/* ---------------------------------------------------------------------------
   3. Wrapper gates — read from the wrapper's own source
   ------------------------------------------------------------------------ */

function principalsFromRequirePrincipal(src) {
  const m = /requirePrincipal\(\s*req\s*,\s*res\s*,\s*\[([^\]]*)\]/.exec(code(src));
  if (!m) return null;
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

/** The gates of the shared wrappers, traced rather than assumed. */
export function wrapperGates() {
  const out = {};

  if (exists("src/http/partner-read-api.mjs")) {
    const kinds = principalsFromRequirePrincipal(read("src/http/partner-read-api.mjs"));
    out.partnerReadHandler = kinds
      ? { principals: kinds, note: "via src/http/partner-read-api.mjs" }
      : { unverified: "partner-read-api.mjs has no requirePrincipal call this parser recognises" };
  }

  if (exists("src/http/dashboard-auth.mjs")) {
    const src = code(read("src/http/dashboard-auth.mjs"));
    const secretFallback = /DASHBOARD_SECRET/.test(src);
    out.requireDashboardAccess = {
      principals: ["staff"],
      note: secretFallback
        ? "via src/http/dashboard-auth.mjs — staff session, OR a DASHBOARD_SECRET shared-secret fallback"
        : "via src/http/dashboard-auth.mjs",
      sharedSecretFallback: secretFallback
    };
  }

  return out;
}

/* ---------------------------------------------------------------------------
   4. One handler's gate
   ------------------------------------------------------------------------ */

/**
 * gateFor(file, { sets, wrappers }) → {
 *   kind, roles[]|null, principals[]|null, note, unverified?
 * }
 *
 * kind is one of:
 *   "role-set"       readHandler({ roles: ROLE_SETS.X }) or requireRole(..., ROLE_SETS.X)
 *   "explicit-roles" a hand-written Set of role names in the handler
 *   "principal"      requirePrincipal, gated by KIND rather than role
 *   "wrapper"        gate lives in a shared wrapper, traced above
 *   "open"           no session gate at all, by design
 *   "unverified"     the parser does not recognise the shape — a finding
 */
export function gateFor(file, { sets, wrappers }) {
  if (!file || !exists(file)) {
    return { kind: "unverified", roles: null, principals: null, note: `handler file ${file || "?"} not found on disk` };
  }
  const src = code(read(file));

  // Shared wrappers first: the handler delegates and has no gate of its own.
  for (const [name, gate] of Object.entries(wrappers)) {
    if (new RegExp(`\\b${name}\\b`).test(src)) {
      if (gate.unverified) return { kind: "unverified", roles: null, principals: null, note: gate.unverified };
      return {
        kind: "wrapper", roles: null, principals: gate.principals,
        note: gate.note, sharedSecretFallback: !!gate.sharedSecretFallback
      };
    }
  }

  const resolveSet = (expr) => {
    const named = /^ROLE_SETS\.(\w+)$/.exec(expr);
    if (named) return sets[named[1]] ? { roles: sets[named[1]], label: `ROLE_SETS.${named[1]}` } : null;
    // A hand-written const in the same file: const X_ROLES = new Set([...]).
    const local = new RegExp(`const\\s+${expr}\\s*=\\s*new Set\\(\\[([^\\]]*)\\]\\)`).exec(src);
    if (local) return { roles: [...local[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]), label: expr };
    /* A LOCAL NAME FOR A SHARED SET: const CARD_ROLES = ROLE_SETS.FINANCE.
       The eight api/finance/* handlers all gate this way — they alias the shared
       set to a name that says what the endpoint is, then gate on the alias. Both
       halves were already resolvable on their own and the alias between them was
       not, so every one of those endpoints extracted as "unverified" and the
       journey drew a gate it could not see. Resolved by following the alias to
       the set it names, so the diagram reports the roles that actually apply
       rather than an honest shrug. */
    const alias = new RegExp(`const\\s+${expr}\\s*=\\s*(ROLE_SETS\\.\\w+)\\s*;`).exec(src);
    if (alias) {
      const target = resolveSet(alias[1]);
      if (target) return { roles: target.roles, label: `${expr} (${target.label})` };
    }
    /* A GATE THAT CHANGES WITH THE METHOD:
         const gate = method === "GET" ? ROLE_SETS.STAFF : ROLE_SETS.FINANCE
       api/banking/accounts.mjs reads with one set and writes with a narrower one
       from a single handler. Reported as the UNION, because the question a
       journey answers is "who can reach this route at all" and the answer is
       everyone in either arm — reporting only the write set would draw the
       endpoint as closed to the roles that can in fact read it. The label names
       both sets so the narrower arm is not lost to a reader. */
    const byMethod = new RegExp(
      `const\\s+${expr}\\s*=\\s*[^;]*?\\?\\s*(ROLE_SETS\\.\\w+)\\s*:\\s*(ROLE_SETS\\.\\w+)\\s*;`
    ).exec(src);
    if (byMethod) {
      const a = resolveSet(byMethod[1]);
      const b = resolveSet(byMethod[2]);
      if (a && b) {
        return {
          roles: [...new Set([...a.roles, ...b.roles])],
          label: `${expr} — ${a.label} or ${b.label}, by method`
        };
      }
    }
    return null;
  };

  // readHandler({ roles: X, principals: new Set([...]) })
  //
  // Scanned over the WHOLE FILE rather than by bracket-matching the call. The
  // call appears both as a one-liner (api/hiring/application.mjs) and spread over
  // many lines with nested braces in the `fetch` arrow (api/read/products.mjs),
  // and any regex that tries to find the call's closing brace gets one of those
  // two wrong. There is exactly one readHandler call per handler file, so a
  // file-wide scan for its keys is unambiguous and survives both shapes.
  if (/readHandler\(\{/.test(src)) {
    const rolesExpr = /roles:\s*([\w.]+)/.exec(src);
    const principals = /principals:\s*new Set\(\[([^\]]*)\]\)/.exec(src);
    const resolved = rolesExpr ? resolveSet(rolesExpr[1]) : null;
    if (!resolved) {
      return { kind: "unverified", roles: null, principals: null,
        note: `readHandler with an unresolvable roles value: ${rolesExpr ? rolesExpr[1] : "none given"}` };
    }
    /* readHandler calls requirePrincipal(req, res, ["staff", ...principals]) —
       src/http/read-api.mjs:194. So the effective kinds ALWAYS include staff,
       and reading only the declared list would wrongly show an endpoint as
       closed to employees. Reconstructed here rather than assumed. */
    const declared = principals ? [...principals[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : null;
    return {
      kind: "role-set",
      roles: resolved.roles,
      principals: declared ? ["staff", ...declared] : null,
      note: `readHandler, roles ${resolved.label}` +
            (declared ? `, also open to ${declared.join(", ")} by principal kind` : "")
    };
  }

  /* THE OTHER requireRole. src/http/middleware/requireRole.mjs exports a CURRIED
     form — requireRole("a","b")(req,res) — and unlike read-api.mjs's version it
     has SUPER_ROLES, so an owner passes it without being named. api/inquiry.mjs
     is the one endpoint using it. Reporting its allowed set without the implicit
     owner would understate who can reach it, which is the kind of error a journey
     exists to prevent. */
  const curried = /requireRole\(\s*((?:"[^"]+"\s*,?\s*)+)\)\s*\(\s*req\s*,\s*res/.exec(src);
  if (curried) {
    const named = [...curried[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    const supers = middlewareSuperRoles();
    const all = [...new Set([...named, ...supers])];
    return {
      kind: "role-set", roles: all, principals: ["staff"],
      note: `requireRole(${named.join(", ")}) from src/http/middleware/requireRole.mjs` +
            (supers.length ? ` — plus ${supers.join(", ")} via SUPER_ROLES` : "")
    };
  }

  // requireRole(res, staff, X) — the SECOND call, after requireAuth.
  const rr = /requireRole\(\s*res\s*,\s*staff\s*,\s*([\w.]+)\s*\)/.exec(src);
  if (rr) {
    const resolved = resolveSet(rr[1]);
    if (!resolved) {
      return { kind: "unverified", roles: null, principals: null, note: `requireRole with an unresolvable set: ${rr[1]}` };
    }
    return { kind: "role-set", roles: resolved.roles, principals: null, note: `requireAuth + requireRole, ${resolved.label}` };
  }

  // requirePrincipal(req, res, [kinds]) — gated by kind, sometimes plus a local
  // role set applied only to the staff kind.
  const kinds = principalsFromRequirePrincipal(src);
  if (kinds) {
    const localSet = /const\s+(\w*ROLES)\s*=\s*new Set\(\[([^\]]*)\]\)/.exec(src);
    if (localSet) {
      return {
        kind: "explicit-roles",
        roles: [...localSet[2].matchAll(/"([^"]+)"/g)].map((x) => x[1]),
        principals: kinds,
        note: `requirePrincipal(${kinds.join(", ")}), staff further limited by ${localSet[1]}`
      };
    }
    return { kind: "principal", roles: null, principals: kinds, note: `requirePrincipal(${kinds.join(", ")})` };
  }

  // requireAuth with no role gate: any signed-in employee, any role.
  if (/requireAuth\(\s*req\s*,\s*res/.test(src)) {
    return { kind: "role-set", roles: sets.STAFF ? ["any signed-in employee"] : null, principals: ["staff"],
      note: "requireAuth only — ANY signed-in employee of ANY role", anyStaff: true };
  }

  /* NOT EVERY GATE IS A SESSION. Three routes here have no requireAuth and are
     nonetheless not open to the world, and reporting them as "anyone" would be a
     false claim in the dangerous direction — somebody reads the journey, sees the
     webhook endpoint listed as reachable by anyone, and either panics or, worse,
     believes it and builds on it.
     Each mechanism is detected from what the handler actually imports or calls. */
  if (/verifyDocumentUrl|signed-url/.test(src)) {
    return { kind: "verified-other", roles: null, principals: null, verifiedBy: "signed link",
      note: "no sign-in needed, and NOT open — the link itself is signed and expires, checked in constant time (src/documents/signed-url.mjs)" };
  }
  if (/rawBody|signature/i.test(src) && /adapter|provider/i.test(src)) {
    return { kind: "verified-other", roles: null, principals: null, verifiedBy: "provider signature",
      note: "no sign-in — the sender is checked by verifying the provider's signature over the raw bytes, in the adapter" };
  }
  if (/inngest/i.test(file)) {
    return { kind: "verified-other", roles: null, principals: null, verifiedBy: "Inngest request signing",
      note: "no sign-in — served by Inngest's own handler, which verifies its request signing" };
  }

  /* The auth endpoints themselves. These are open BY DESIGN and each is open in
     its own specific way, so they are named rather than lumped together — "open"
     with no explanation on a login route reads like an oversight. */
  if (/\battachStaff\b/.test(src)) {
    return { kind: "open", roles: null, principals: null,
      note: "auth is OPTIONAL here — this endpoint reports whether a session exists, so it must answer either way" };
  }
  if (/\bbearerToken\b/.test(src)) {
    return { kind: "open", roles: null, principals: null,
      note: "no gate — it acts on whatever token is presented, which is what makes signing out possible with a bad session" };
  }

  // No session gate referenced at all.
  if (!/require(Auth|Role|Principal|DashboardAccess)/.test(src)) {
    return { kind: "open", roles: null, principals: null, note: "no session gate in this handler" };
  }

  return { kind: "unverified", roles: null, principals: null, note: "a gate is referenced but its shape was not recognised" };
}

/* SUPER_ROLES from the middleware, read rather than assumed. Empty if the export
   ever goes away, which would silently narrow every curried gate — so the note
   above says "plus X" only when there really is an X. */
export function middlewareSuperRoles() {
  const rel = "src/http/middleware/requireRole.mjs";
  if (!exists(rel)) return [];
  const m = /export const SUPER_ROLES = \[([^\]]*)\]/.exec(code(read(rel)));
  return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : [];
}

/* ---------------------------------------------------------------------------
   5. Which HTTP methods a handler answers
   ------------------------------------------------------------------------ */

export function methodsFor(file) {
  if (!file || !exists(file)) return [];
  const src = code(read(file));
  const found = new Set();
  for (const m of src.matchAll(/req\.method\s*===?\s*"(\w+)"/g)) found.add(m[1]);
  for (const m of src.matchAll(/setHeader\(\s*"allow"\s*,\s*"([^"]+)"/gi)) {
    for (const v of m[1].split(",")) found.add(v.trim());
  }
  if (/readHandler\(\{/.test(src) || /partnerReadHandler\(\{/.test(src)) found.add("GET");
  return [...found].filter(Boolean).sort();
}

/* ---------------------------------------------------------------------------
   6. The journeys themselves
   ------------------------------------------------------------------------ */

/* THE EIGHT TRACKED JOURNEYS, from CLAUDE.md §4, each tied to the thing in the
   code it actually describes — with the evidence for that tie, because two of
   these mappings are not obvious from the name and one of them does not exist.

   `subject` is either a staff.role value or a principal kind. `evidence` is
   where that mapping is established IN THE CODE, so a reader can check it
   rather than trust it. */
export const JOURNEYS = [
  { name: "client", type: "principal", subject: "client",
    evidence: "src/auth/account-session.mjs — PRINCIPAL_KINDS includes 'client'" },

  { name: "role-owner", type: "role", subject: "owner",
    evidence: "db/schema/001_init.sql — staff.role comment lists 'owner'" },

  { name: "role-sales-manager", type: "role", subject: "sales_manager", missing: true,
    evidence: "NONE — no such role exists anywhere in src/, api/ or db/" },

  { name: "role-closer", type: "role", subject: "closer",
    evidence: "src/http/read-api.mjs — ROLE_SETS.STAFF includes 'closer'" },

  { name: "role-funding-advisor", type: "role", subject: "funding_advisor",
    evidence: "src/http/read-api.mjs — ROLE_SETS.STAFF includes 'funding_advisor'" },

  { name: "role-inquiry-remover", type: "role", subject: "inquiry_specialist",
    evidence: "the screen is the Inquiry Remover (src/http/inquiry-remover-view.mjs); " +
              "the role key behind it is 'inquiry_specialist' (src/http/read-api.mjs ROLE_SETS.STAFF, " +
              "and api/pii.mjs IDENTITY_ROLES). The journey is named for the product, the role for the column." },

  { name: "affiliate", type: "principal", subject: "affiliate",
    evidence: "src/auth/account-session.mjs — PRINCIPAL_KINDS includes 'affiliate'" },

  { name: "white-label", type: "principal", subject: "partner",
    evidence: "db/migrations/036_partner_role.sql — \"External white-label partner\"; " +
              "db/migrations/044_accounts.sql — \"partner — white-label operator, sees their own book only\"" }
];

/** Can this journey's subject reach this route? */
export function reaches(journey, gate) {
  if (gate.kind === "open") return { reachable: true, why: "no session gate" };
  if (gate.kind === "verified-other") {
    return { reachable: true, why: `no session gate — verified by ${gate.verifiedBy}` };
  }
  if (gate.kind === "unverified") return { reachable: null, why: "gate not verified" };

  if (journey.type === "role") {
    if (gate.anyStaff) return { reachable: true, why: "any signed-in employee" };
    if (gate.principals && !gate.principals.includes("staff")) {
      return { reachable: false, why: "employees are not an accepted principal kind here" };
    }
    if (!gate.roles) {
      return gate.principals && gate.principals.includes("staff")
        ? { reachable: true, why: "accepted as the staff kind, no role limit" }
        : { reachable: false, why: "no role admitted" };
    }
    return gate.roles.includes(journey.subject)
      ? { reachable: true, why: "role is in the allowed set" }
      : { reachable: false, why: "role is not in the allowed set" };
  }

  // A non-staff principal is admitted by KIND; roles do not apply to it.
  const kinds = gate.principals || [];
  return kinds.includes(journey.subject)
    ? { reachable: true, why: "principal kind is accepted" }
    : { reachable: false, why: "principal kind is not accepted" };
}

/** extractAll() → everything render.mjs needs, and nothing it has to re-derive. */
export function extractAll() {
  const sets = roleSets();
  const wrappers = wrapperGates();

  const all = [...routes().map((r) => ({ ...r, routing: "exact" })),
               ...PREFIX_ROUTED.map((r) => ({ ...r, routing: "prefix" }))];

  const endpoints = all.map((r) => ({
    ...r,
    gate: gateFor(r.file, { sets, wrappers }),
    methods: methodsFor(r.file)
  })).sort((a, b) => (a.key < b.key ? -1 : 1));

  return {
    endpoints,
    roleSets: sets,
    superRoleOnReadPath: superRoleApplies(),
    journeys: JOURNEYS,
    counts: {
      total: endpoints.length,
      unverified: endpoints.filter((e) => e.gate.kind === "unverified").length,
      open: endpoints.filter((e) => e.gate.kind === "open").length,
      verifiedOther: endpoints.filter((e) => e.gate.kind === "verified-other").length
    }
  };
}

export default { extractAll, routes, roleSets, gateFor, methodsFor, reaches, JOURNEYS, REPO };
