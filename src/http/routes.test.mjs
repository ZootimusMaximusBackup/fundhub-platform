// Route reachability — the test that would have caught this twice.
//
// WHAT KEEPS GOING WRONG. netlify/functions/api.mjs holds a hand-written ROUTES
// map, and scripts/dev-server.mjs proxies /api/* through that same module, so a
// handler missing from the map is 404 locally AND on the deploy target. Nothing
// else in the repo knows the map exists. A feature can therefore be complete —
// handler, service module, migration, unit tests, pg tests, all green — and be
// unreachable by any caller, with npm test entirely happy about it.
//
// It has happened twice. AUDIT-FINDINGS.md records api/inngest.mjs: absent from
// ROUTES, so all 47 workflow functions were unreachable while HANDOFF.md told the
// operator the only remaining gate was an unset key ("an operator action, not a
// commit" — it was a commit). Its own conclusion is the sentence this file
// exists to answer: "a structural check can pass over a half-dead feature."
// Then it recurred at scale: 21 handler files under api/ — the whole Creative
// Factory, all of hiring, both PII and inquiry write paths — were absent.
//
// THE INVARIANT. Every *.mjs under api/ is either
//   (a) an exact key in ROUTES, or
//   (b) a dynamic-segment file the adapter routes by prefix, or
//   (c) named in ALLOWED_UNROUTED below with a written reason.
// There is no fourth option, and (c) costs you a paragraph. That is the point:
// leaving something unreachable becomes a decision somebody signs, in a file a
// reviewer reads, instead of a line nobody remembered to add.
//
// PURE UNIT TEST, NO DATABASE, so it runs in every CI pass and not just the ones
// with DATABASE_URL set. Importing the adapter is safe: src/db.mjs builds its
// pool lazily inside pool(), so nothing connects at import time. That import is
// itself load-bearing — it proves every routed handler module actually parses
// and resolves its own imports, which a text-scrape of this file could not.

import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ROUTES, routePath, config } from "../../netlify/functions/api.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const API_DIR = path.resolve(HERE, "../../api");

/* SPECIAL_CASES — files the adapter reaches by something other than an exact
   ROUTES key. Each is a branch in netlify/functions/api.mjs's handler(), named
   here so "not in ROUTES" cannot quietly mean "unreachable" for these three. */
const SPECIAL_CASES = {
  "inngest": "handler() short-circuits path === 'inngest' to inngestWeb, because " +
             "inngest/node's serve() takes a Request and throws on the (req,res) shim.",
  "webhooks/[provider]": "prefix route: path.startsWith('webhooks/') → query.provider.",
  "documents/[id]": "prefix route: path.startsWith('documents/') → query.id."
};

/* ALLOWED_UNROUTED — handler files that exist and are deliberately NOT reachable.
   Key is the path under api/ without the .mjs. The value is the reason, and it
   is not decoration: the next person to read this list needs to know whether the
   entry is a decision or a debt.

   Two kinds live here, and they are not the same thing:
     DEFERRED — will not be routed; the feature is not wanted yet.
     BLOCKED  — should be routed, cannot be yet, and the blocker is named.
   A BLOCKED entry is a bug with a home, not a resolution. Do not let one sit
   here quietly because the test is green with it in the list.

   THE LIST IS EMPTY, AND THAT IS THE POINT. Its one entry — "read/tradelines",
   BLOCKED on api/read/tradelines.mjs passing { roles: ROLE_SETS.STAFF } as
   requireAuth's third argument, which is { db, env }, so the declared role gate
   was silently dropped — was resolved during integration rather than inherited.
   The handler now calls requireRole() for real and the route is in ROUTES. An
   empty allowlist means every file under api/ is reachable by design; the tests
   below still run, they just have nothing to forgive. */
const ALLOWED_UNROUTED = {};

/* walk — every .mjs under api/, as a route key: path relative to api/, minus the
   extension, forward-slashed. api/read/products.mjs → "read/products", which is
   the exact ROUTES key convention. */
function handlerKeys(dir = API_DIR, prefix = "") {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...handlerKeys(path.join(dir, entry.name), rel));
    else if (entry.name.endsWith(".mjs") && !entry.name.endsWith(".test.mjs")) out.push(rel.slice(0, -".mjs".length));
  }
  return out;
}

const KEYS = handlerKeys();

test("routes: every handler file under api/ is routed, prefix-routed, or explicitly allowed to be unreachable", () => {
  // The whole failure mode, in one assertion. A new file under api/ fails this
  // until somebody decides what it is.
  const orphans = KEYS.filter((k) =>
    !Object.prototype.hasOwnProperty.call(ROUTES, k) &&
    !Object.prototype.hasOwnProperty.call(SPECIAL_CASES, k) &&
    !Object.prototype.hasOwnProperty.call(ALLOWED_UNROUTED, k));

  assert.deepEqual(orphans, [],
    `api/ handlers unreachable by any caller — they answer 404 on Netlify and under ` +
    `scripts/dev-server.mjs alike:\n  ${orphans.join("\n  ")}\n` +
    `Add each to ROUTES in netlify/functions/api.mjs, or to ALLOWED_UNROUTED in ` +
    `this file with a written reason.`);
});

test("routes: every ROUTES key names a handler file that exists on disk", () => {
  // The mirror image, and a real hazard: the value is an imported function, so a
  // MISTYPED KEY still points at working code. "read/tradeline" would import
  // fine, answer 200, and serve the right handler at a path no screen calls.
  const dangling = Object.keys(ROUTES).filter((k) => !KEYS.includes(k));
  assert.deepEqual(dangling, [],
    `ROUTES keys with no api/<key>.mjs behind them (a typo here is invisible — ` +
    `the import still resolves): ${dangling.join(", ")}`);
});

test("routes: every ROUTES value is a callable handler", () => {
  // A handler file whose default export went missing lands here as undefined,
  // and the adapter would treat it as a live route and throw on invocation —
  // a 500 for what should have been a 404.
  for (const [key, fn] of Object.entries(ROUTES)) {
    assert.equal(typeof fn, "function", `ROUTES["${key}"] is ${typeof fn}, not a function`);
  }
});

test("routes: no ALLOWED_UNROUTED entry is stale — each names a real file that is still unrouted", () => {
  // An allowlist nobody prunes stops being a decision and becomes a place to
  // hide things. Both directions are wrong and both are caught here.
  for (const key of Object.keys(ALLOWED_UNROUTED)) {
    assert.ok(KEYS.includes(key),
      `ALLOWED_UNROUTED names "${key}" but api/${key}.mjs does not exist — the file ` +
      `was deleted or renamed; drop the entry.`);
    assert.ok(!Object.prototype.hasOwnProperty.call(ROUTES, key),
      `"${key}" is in ROUTES and in ALLOWED_UNROUTED. It is routed; delete the ` +
      `ALLOWED_UNROUTED entry so the list keeps meaning what it says.`);
  }
});

test("routes: every ALLOWED_UNROUTED entry carries a reason substantial enough to be a decision", () => {
  // "todo" is not a reason. The cost of leaving something unreachable is that you
  // have to write down why, where the next reader will see it.
  for (const [key, reason] of Object.entries(ALLOWED_UNROUTED)) {
    assert.ok(typeof reason === "string" && reason.trim().length >= 40,
      `ALLOWED_UNROUTED["${key}"] needs a written reason, not "${reason}".`);
  }
});

test("routes: every SPECIAL_CASES entry names a real file the adapter reaches without a ROUTES key", () => {
  for (const key of Object.keys(SPECIAL_CASES)) {
    assert.ok(KEYS.includes(key), `SPECIAL_CASES names "${key}" but api/${key}.mjs does not exist.`);
    assert.ok(!Object.prototype.hasOwnProperty.call(ROUTES, key),
      `"${key}" has an exact ROUTES key, so it is not a special case — drop it from SPECIAL_CASES.`);
  }
});

// ---------------------------------------------------------------------------
// routePath — both URL shapes must reduce to the same key.
// ---------------------------------------------------------------------------

test("routePath: both URL shapes reduce every ROUTES key to that same key", () => {
  // netlify.toml's rewrite delivers /.netlify/functions/api/<key>; config.path
  // delivers /api/<key>. If those two ever disagree, one entire URL shape 404s
  // on every route at once — which is the kind of outage that gets blamed on DNS.
  for (const key of Object.keys(ROUTES)) {
    assert.equal(routePath(`/api/${key}`), key, `/api/${key} did not reduce to "${key}"`);
    assert.equal(routePath(`/.netlify/functions/api/${key}`), key,
      `the netlify.toml rewrite shape did not reduce /${key} to "${key}"`);
  }
});

test("routePath: a trailing slash resolves to the same route rather than a 404", () => {
  assert.equal(routePath("/api/read/products/"), "read/products");
  assert.equal(routePath("/api/read/products///"), "read/products");
  assert.equal(routePath("/.netlify/functions/api/shifts/"), "shifts");
});

test("routePath: the bare function root is the empty key, which ROUTES does not answer", () => {
  // "" must not accidentally become a route; an unmatched key is a 404, and the
  // empty string is unmatched precisely because nobody registers it.
  for (const p of ["/api", "/api/", "/.netlify/functions/api", "/.netlify/functions/api/"]) {
    assert.equal(routePath(p), "");
  }
  assert.equal(Object.prototype.hasOwnProperty.call(ROUTES, ""), false);
});

test("routePath: an unregistered path stays unregistered rather than resolving through the prototype", () => {
  // A previous bug: ROUTES[path] walked the prototype chain, so /api/constructor
  // and /api/__proto__ resolved to Object.prototype members and answered 500 to
  // an UNAUTHENTICATED caller. The adapter uses hasOwnProperty for this reason;
  // the assertion is here so a future "simplification" back to ROUTES[path] has
  // to argue with a red test.
  for (const name of ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__", "isPrototypeOf"]) {
    assert.equal(Object.prototype.hasOwnProperty.call(ROUTES, routePath(`/api/${name}`)), false,
      `/api/${name} must not resolve to a route`);
  }
});

// ---------------------------------------------------------------------------
// The routes this round added, named individually.
// ---------------------------------------------------------------------------

test("routes: the twenty handlers that were 404ing are now reachable at their documented paths", () => {
  // Named rather than counted. A count passes if you swap one for another; these
  // are the exact paths the screens and the docblocks in each handler call, so
  // renaming a key breaks this test at the key that moved.
  const shouldBeRouted = [
    "inquiries", "pii", "shifts", "read/conversations",
    "campaigns/list", "campaigns/detail", "campaigns/spend",
    "campaigns/fatigue", "campaigns/connections", "campaigns/action-log",
    "campaigns/meta-agency",
    "creative/library", "creative/brand-kits", "creative/jobs", "creative/approvals",
    "hiring/candidates", "hiring/application", "hiring/postings",
    "hiring/decisions", "hiring/funnel", "hiring/bench"
  ];
  const missing = shouldBeRouted.filter((k) => !Object.prototype.hasOwnProperty.call(ROUTES, k));
  assert.deepEqual(missing, [], `regressed to 404: ${missing.join(", ")}`);
});

test("routes: Galaxy company-activity feed is routed", () => {
  assert.ok(Object.prototype.hasOwnProperty.call(ROUTES, "read/company-activity"));
});

test("routes: /api/inquiries and /api/inquiry stay separate routes", () => {
  // Two different systems: /api/inquiry proxies the external Airtable runtime,
  // /api/inquiries writes the local inquiry_log table. They are one letter apart
  // and a caller must never reach one believing it hit the other.
  assert.ok(Object.prototype.hasOwnProperty.call(ROUTES, "inquiry"));
  assert.ok(Object.prototype.hasOwnProperty.call(ROUTES, "inquiries"));
  assert.notEqual(ROUTES["inquiry"], ROUTES["inquiries"]);
});

test("routes: no exact key is shadowed by the webhooks/ or documents/ prefix branches", () => {
  // The prefix branches only run when the exact lookup missed, so an exact key
  // wins today. This asserts nobody has added one that would depend on that
  // ordering — "documents/archive" would work, and would silently stop working
  // if the branches were ever reordered.
  const shadowed = Object.keys(ROUTES).filter((k) => k.startsWith("webhooks/") || k.startsWith("documents/"));
  assert.deepEqual(shadowed, [],
    `these exact keys sit under a prefix branch and depend on lookup order: ${shadowed.join(", ")}`);
});

test("routes: the function still claims every /api/* path, so an added route needs no netlify.toml change", () => {
  // If config.path ever narrowed, a new ROUTES entry would pass every test above
  // and still 404 in production because the function was never invoked.
  assert.equal(config.path, "/api/*");
});
