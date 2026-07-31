// Endpoint tests for /api/banking/accounts. No DATABASE_URL, so these run
// anywhere — src/db.mjs builds its pool lazily, which means the handler can be
// imported and its method and auth branches exercised without a database.
//
// WHY THIS FILE LIVES IN src/http/ AND NOT api/. `npm test`'s glob is
// "src/**/*.test.mjs" and "scripts/**/*.test.mjs" — NOTHING under api/ is ever
// run. A test placed next to the handler would pass forever without executing.
//
// WHAT IS COVERED HERE, AND WHAT IS NOT.
//
// Covered behaviourally: method rejection and the unauthenticated path, both of
// which return before any database call.
//
// Covered by SOURCE ASSERTION: the role gate and the org scope. These cannot be
// exercised behaviourally without a real session, which needs a database, which
// means they would only run in the passes that have one — and this repo's most
// expensive bug survived eleven commits for exactly that reason. The mistakes
// are visible in the text, so the text is where they are caught. This is the
// technique src/http/auth-gate.test.mjs already established.
//
// The full round trip is in banking-accounts.pg.test.mjs, which SKIPS without
// DATABASE_URL rather than passing.

import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import handler from "../../api/banking/accounts.mjs";
import { ROUTES } from "../../netlify/functions/api.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const SRC = fs.readFileSync(path.join(ROOT, "api/banking/accounts.mjs"), "utf8");

/** The handler's source with comments removed.
 *
 *  Every source assertion below that COUNTS or FORBIDS an identifier runs
 *  against this, not SRC. The handler's comments name the very functions the
 *  tests forbid — "DO NOT REPLACE THIS WITH toCents() DIRECTLY", "readApr() lives
 *  in the store" — so a naive substring search fails on the documentation
 *  warning you not to do the thing it is checking for. */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/** Minimal res double matching the shape netlify/functions/api.mjs builds. */
function makeRes() {
  return {
    statusCode: null, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
    json(o) { this.body = o; return this; }
  };
}

/* ------------------------------------------------------------- reachability */

test("the handler is in the ROUTES map, or it 404s however well it works", () => {
  // A handler file is not a route. This repo has shipped a finished feature
  // unreachable three times because nobody added the line.
  assert.equal(ROUTES["banking/accounts"], handler);
});

/* ------------------------------------------------------------------ methods */

test("an unsupported method is 405 with an allow header", async () => {
  for (const method of ["PUT", "DELETE", "PATCH"]) {
    const res = makeRes();
    await handler({ method, headers: {}, query: {} }, res);
    assert.equal(res.statusCode, 405, method);
    assert.equal(res.headers.allow, "GET, POST");
  }
});

test("the method check runs before authentication", async () => {
  // Order matters: an unauthenticated PUT should say "wrong method", not leak
  // that the method would have been fine had you been signed in.
  const res = makeRes();
  await handler({ method: "PUT", headers: {}, query: {} }, res);
  assert.equal(res.statusCode, 405);
});

/* --------------------------------------------------------------- auth path */

test("no session is 401 and touches no database", async () => {
  for (const method of ["GET", "POST"]) {
    const res = makeRes();
    // No authorization header, no cookie — bearerToken() returns null and
    // authenticate() returns without ever calling the db.
    await handler({ method, headers: {}, query: {}, body: {} }, res);
    assert.equal(res.statusCode, 401, method);
    assert.deepEqual(res.body, { ok: false, error: "unauthorized" });
  }
});

test("a malformed session cookie does not crash the handler", async () => {
  // decodeURIComponent throws URIError on "%zz", which once 500'd every
  // authenticated route including logout — a browser holding one bad cookie
  // could not clear it from inside the app. bearerToken() now catches that and
  // falls back to the raw value.
  //
  // SO THE ANSWER HERE IS 503, NOT 401, AND THAT IS CORRECT. A token was
  // extracted, so the handler goes on to verify it, which needs a database this
  // test deliberately does not have. 503 + db:"down" is the shape
  // public/app/data.js reads as an outage and renders as "backend unavailable"
  // rather than logging the user out — which is the whole point of
  // AUTH_UNAVAILABLE being distinct from a bad session.
  const res = makeRes();
  await handler({ method: "GET", headers: { cookie: "fundhub_session=%zz" }, query: {} }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.db, "down");
  assert.notEqual(res.statusCode, 500, "a bad cookie must never be an unhandled crash");
});

/* --------------------------------------------------- the gate, in the source */

test("the role gate is a SECOND call, never a `roles` option to requireAuth", () => {
  // requireAuth's third parameter is { db, env }, forwarded to authenticate(),
  // which destructures exactly those two names. A `roles` key is accepted by the
  // object literal and silently discarded. api/read/tradelines.mjs shipped that
  // and its effective gate became "any staff session, any role".
  assert.equal(/requireAuth\s*\([^)]*roles/s.test(CODE), false);
  assert.match(SRC, /requireRole\s*\(\s*res\s*,\s*staff\s*,/);
});

test("writes are gated more tightly than reads", () => {
  // Reads are STAFF (read/banking-surface already serves these rows to that
  // set). Writes are FINANCE, because replace_holdings DELETEs a portfolio.
  assert.match(SRC, /ROLE_SETS\.STAFF/);
  assert.match(SRC, /ROLE_SETS\.FINANCE/);
  assert.match(SRC, /method === "GET"\s*\?\s*ROLE_SETS\.STAFF\s*:\s*ROLE_SETS\.FINANCE/);
});

test("a session with no org is refused rather than binding NULL quietly", () => {
  assert.match(SRC, /if\s*\(\s*!staff\.org_id\s*\)/);
  assert.match(SRC, /no_org_on_session/);
});

/* ------------------------------------------------- org scope, in the source */

test("org_id is read ONLY from the session, never from the body or query", () => {
  // The rule: every read and write scopes to the caller's company from the
  // SESSION. A payload that could name its own org is a tenancy bypass one bad
  // request away.
  assert.match(SRC, /orgId:\s*staff\.org_id/);
  assert.equal(/orgId:\s*(body|req\.body|query|req\.query)/.test(CODE), false,
    "org must never come from caller-supplied data");
  assert.equal(/body\.org_id/.test(CODE), false);
  assert.equal(/query\.org_id/.test(CODE), false);
});

/* -------------------------------------------- money, in the source */

test("dollar amounts never reach toCents() directly", () => {
  // toCents(null), toCents(undefined) and toCents("") all return 0. That is
  // right for commission maths and exactly wrong here: an empty credit-limit box
  // means "I do not know", and 0 would render as $0.00 and make utilisation read
  // as maxed out. dollarsToCentsOrNull() is the boundary that keeps NULL alive.
  assert.match(SRC, /function dollarsToCentsOrNull/);
  const calls = CODE.match(/\btoCents\s*\(/g) || [];
  assert.equal(calls.length, 1,
    "exactly one call to toCents, inside dollarsToCentsOrNull — every other amount goes through the null-preserving wrapper");
});

test("APR is passed through raw so it is normalised exactly once", () => {
  // readApr() lives in the store. A second conversion here is the bug that
  // inflated figures 100-fold in this repo already.
  assert.equal(/readApr/.test(CODE), false, "the endpoint must not convert APR");
  assert.match(CODE, /apr:\s*body\.apr/);
});

test("the next due date is computed server-side, not left to the browser", () => {
  // "Never show a number the server did not send." A date derived in the browser
  // is a number the server did not send, and it would put the month-end rule in
  // two languages.
  assert.match(SRC, /nextDueDate/);
  assert.match(SRC, /next_due:/);
});

/* ------------------------------------------------------------- actions */

test("the POST action list matches what the handler implements", () => {
  const advertised = /allowed:\s*\[([^\]]*)\]/.exec(CODE)[1]
    .split(",").map((s) => s.trim().replace(/^"|"$/g, "")).filter(Boolean);
  const implemented = [...CODE.matchAll(/case\s+"([a-z_]+)":/g)].map((m) => m[1]);
  assert.deepEqual(advertised.sort(), implemented.sort(),
    "an action the error message advertises but does not implement sends a caller in circles");
});
