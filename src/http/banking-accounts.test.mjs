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
// WHAT IS NOT COVERED ANYWHERE, AS OF 2026-08-18. This header used to end by
// saying "the full round trip is in banking-accounts.pg.test.mjs". THAT FILE
// DOES NOT EXIST and never has — `ls src/http/banking-*` returns three files and
// none of them is it. The claim is removed rather than left standing, because a
// pointer to imaginary coverage is worse than an admission of none: it is what
// let the ON CONFLICT defect below live in the tree unnoticed.
//
// The round trip WAS exercised by hand against a scratch Postgres 16.14 on
// 2026-08-18 (create_account → a real bank_accounts row, and sync-accounts →
// four). Writing that up as a committed .pg.test.mjs is the obvious next job and
// is deliberately left for whoever owns the banking test files.

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
  // THE STATUS DEPENDS ON THE ENVIRONMENT, AND THE ASSERTION MUST NOT.
  // A token WAS extracted, so the handler goes on to verify it:
  //   - with no database  -> 503 + db:"down" (AUTH_UNAVAILABLE, "I could not
  //     check"), which public/app/data.js renders as "backend unavailable"
  //     rather than logging the user out;
  //   - with a database   -> 401, because the token is simply not a session.
  //
  // Both are correct. An earlier version of this test pinned 503 and passed
  // without DATABASE_URL and FAILED with it — a test that only holds when a
  // dependency is missing is the exact shape of the problem this repo keeps
  // hitting. What is being asserted is the contract that holds either way: a bad
  // cookie is handled, never an unhandled crash.
  const res = makeRes();
  await handler({ method: "GET", headers: { cookie: "fundhub_session=%zz" }, query: {} }, res);
  assert.ok([401, 503].includes(res.statusCode),
    `expected 401 or 503, got ${res.statusCode}`);
  assert.notEqual(res.statusCode, 500, "a bad cookie must never be an unhandled crash");
  if (res.statusCode === 503) assert.equal(res.body.db, "down");
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

/* ------------------------------- the other door into the same table --------
 *
 * WHY A TEST ABOUT src/banking/accounts-store.mjs SITS IN THIS FILE. There are
 * exactly two write paths into `bank_accounts`: this endpoint (a human typing an
 * account in) and POST /api/banking/sync-accounts (a provider's list). The
 * second one goes through accounts-store.mjs, and on 2026-08-18 it was found to
 * fail on its FIRST ROW against a real database — a 500, every time, so no
 * provider account had ever been stored. The store has no test file of its own
 * in this batch's ownership split, and a defect this size must not be fixed
 * without a guard, so the guard lives next to the other door. Move it to a test
 * beside the store when one exists.
 *
 * WHAT WENT WRONG. Both unique indexes on bank_accounts are PARTIAL — each ends
 * in a WHERE (081 line 123, 103 line 162). Postgres will not use a partial
 * unique index as the arbiter of an ON CONFLICT unless the statement repeats
 * that index's predicate. Without it there is no arbiter and the INSERT dies
 * with 42P10. It is invisible to any test with a stubbed database, because a
 * stub happily accepts any SQL string.
 */
test("every ON CONFLICT target repeats its partial index's WHERE, or the INSERT is a 500", () => {
  const STORE = fs.readFileSync(path.join(ROOT, "src/banking/accounts-store.mjs"), "utf8");
  const code = STORE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  const targets = [...code.matchAll(/ON CONFLICT \$\{target\}|"\(([^)]*)\)([^"]*)"/g)];
  assert.ok(targets.length > 0, "the conflict targets moved — this test must move with them");

  // uq_bank_accounts_plaid is partial on both plaid columns.
  assert.match(code, /plaid_item_id,\s*plaid_account_id\)\s*"\s*\+\s*\n?\s*"WHERE plaid_item_id IS NOT NULL AND plaid_account_id IS NOT NULL"/,
    "the plaid conflict target must repeat uq_bank_accounts_plaid's WHERE clause");

  // uq_bank_accounts_provider_ref is partial on provider_account_id.
  assert.match(code, /org_id,\s*client_id,\s*provider,\s*provider_account_id\)\s*"\s*\+\s*\n?\s*"WHERE provider_account_id IS NOT NULL"/,
    "the non-plaid conflict target must repeat uq_bank_accounts_provider_ref's WHERE clause");
});

test("the two partial indexes this store upserts on still have the predicates it names", () => {
  // If a later migration makes either index total, the WHERE above becomes
  // wrong in the other direction. Read the migrations, not a memory of them.
  const m081 = fs.readFileSync(path.join(ROOT, "db/migrations/081_bank_accounts.sql"), "utf8");
  const m103 = fs.readFileSync(path.join(ROOT, "db/migrations/103_bank_account_provider.sql"), "utf8");

  assert.match(m081, /CREATE UNIQUE INDEX[^;]*uq_bank_accounts_plaid[^;]*WHERE plaid_item_id IS NOT NULL AND plaid_account_id IS NOT NULL/s);
  assert.match(m103, /CREATE UNIQUE INDEX[^;]*uq_bank_accounts_provider_ref[^;]*WHERE provider_account_id IS NOT NULL/s);
});

test("the POST action list matches what the handler implements", () => {
  const advertised = /allowed:\s*\[([^\]]*)\]/.exec(CODE)[1]
    .split(",").map((s) => s.trim().replace(/^"|"$/g, "")).filter(Boolean);
  const implemented = [...CODE.matchAll(/case\s+"([a-z_]+)":/g)].map((m) => m[1]);
  assert.deepEqual(advertised.sort(), implemented.sort(),
    "an action the error message advertises but does not implement sends a caller in circles");
});
