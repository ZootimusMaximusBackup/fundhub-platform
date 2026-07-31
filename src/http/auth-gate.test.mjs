// The role gate, as a class of bug rather than one endpoint's fix.
//
// api/read/tradelines.mjs shipped this line and nobody caught it for two rounds:
//
//     const staff = await requireAuth(req, res, { roles: ROLE_SETS.STAFF });
//
// It reads exactly like a role gate. It is not one. requireAuth's third
// parameter is `opts`, forwarded verbatim to authenticate(), which destructures
// `{ db, env }` and nothing else — see src/http/middleware/requireAuth.mjs. A
// `roles` key in that object is accepted by the literal, carried into a function
// that never looks at it, and discarded. The endpoint's effective gate was "any
// authenticated staff session, any role", on a response containing a named
// client's credit limits and balances.
//
// WHY A SOURCE TEST AND NOT A BEHAVIOURAL ONE. The failure is silent by
// construction: the wrong call and the right call are indistinguishable from
// outside unless you hold a session whose role is outside the set, which needs a
// database, which means the check would only run in the passes that have one —
// and this bug survived precisely because nothing ran in the passes that did
// not. The mistake is visible in the text, so the text is where it is caught.
// This runs on every CI pass, over every handler in api/, at zero cost.
//
// SCOPE. This asserts one narrow thing: nobody passes a role set to a function
// that ignores role sets. It does NOT assert that every endpoint has a gate —
// api/health.mjs and api/hiring/application.mjs are deliberately open, and
// deciding which endpoints need which set is a security review, not a regex.

import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const API_DIR = path.join(ROOT, "api");

function sourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (entry.name.endsWith(".mjs")) out.push(full);
  }
  return out;
}

const FILES = sourceFiles(API_DIR).concat(sourceFiles(path.join(ROOT, "src/http")))
  .filter((f) => !f.endsWith(".test.mjs"));

test("requireAuth: no caller passes a `roles` option, because requireAuth ignores it", () => {
  // Matches `requireAuth(` ... `roles` before the closing paren of that call.
  // Deliberately crude: any occurrence at all is worth a human look, and a false
  // positive costs a comment reword while a false negative costs an exposure.
  const offenders = [];
  for (const file of FILES) {
    const src = fs.readFileSync(file, "utf8");
    const re = /requireAuth\s*\(([^;]*?)\)\s*;/gs;
    let m;
    while ((m = re.exec(src)) !== null) {
      if (/\broles\b/.test(m[1])) offenders.push(path.relative(ROOT, file));
    }
  }
  assert.deepEqual([...new Set(offenders)], [],
    "requireAuth(req, res, opts) forwards opts to authenticate(), which reads only " +
    "{ db, env }. A `roles` key there is silently dropped and the endpoint has NO " +
    "role gate. Use the two-call form instead:\n" +
    "    const staff = await requireAuth(req, res, { db });\n" +
    "    if (!staff) return;\n" +
    "    if (!requireRole(res, staff, ROLE_SETS.STAFF)) return;\n" +
    "Files: " + [...new Set(offenders)].join(", "));
});

test("requireAuth: authenticate() still reads only db and env, so the rule above still holds", () => {
  // The assertion above is only correct while this remains true. If somebody
  // teaches authenticate() about roles, this test fails and tells them to delete
  // the other one rather than leaving a rule nobody can explain.
  const src = fs.readFileSync(
    path.join(ROOT, "src/http/middleware/requireAuth.mjs"), "utf8");
  const sig = /export\s+async\s+function\s+authenticate\s*\(([^)]*)\)/.exec(src);
  assert.ok(sig, "authenticate() not found in src/http/middleware/requireAuth.mjs");
  assert.ok(!/\broles\b/.test(sig[1]),
    "authenticate() now destructures `roles`. If it really gates on roles, the " +
    "requireAuth-`roles` test above is obsolete — delete it. If it does not, this " +
    "is a half-done change.");
});

test("read/tradelines: the endpoint gates on ROLE_SETS.STAFF with a call that runs", () => {
  // The specific regression. This endpoint returns a named client's credit
  // limits, balances and the funding waterfall over them; it was unrouted while
  // its gate was dead, and it is routed now, so the gate has to be real.
  const src = fs.readFileSync(path.join(API_DIR, "read/tradelines.mjs"), "utf8");
  assert.match(src, /requireRole\s*\(\s*res\s*,\s*staff\s*,\s*ROLE_SETS\.STAFF\s*\)/,
    "api/read/tradelines.mjs must call requireRole(res, staff, ROLE_SETS.STAFF) — " +
    "it is hand-rolled, so it does not get readHandler's gate for free.");
});
