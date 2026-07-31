// Health state — the testable core behind api/health.mjs.
//
// Framework-agnostic in the same spirit as src/http/router.mjs and
// dashboard-auth.mjs: this takes a db and returns a plain object, so the
// classification can be tested without an HTTP layer or a live Postgres.
//
// BY DEFAULT the endpoint that mounts it always answers 200. This endpoint is
// the only way the browser can tell three failures apart — no function deployed,
// function up but unconfigured, and a database refusing connections — and
// public/app/shell.js branches on exactly that to label its chip
// (NO API / NO DB / LIVE). A 503 is indistinguishable from a platform error at
// the edge, and a 5xx here also trips Netlify's own error pages. So for that
// caller the answer arrives as a body, never as a status code.
//
//   state "up"           — database answered; every migration this code expects is applied
//   state "behind"       — database answered, but migrations this code expects are missing
//   state "unconfigured" — no DATABASE_URL in the environment
//   state "unreachable"  — DATABASE_URL set, connection refused or timed out
//   state "error"        — connected, query failed (schema missing, perms)
//
// "behind" exists because counting rows and answering "up" whenever the count
// query succeeds is not a health check. netlify.toml's build command is an echo,
// so a deploy runs no migrations, and no CI runs them either: a database left at
// an older migration answers that count query perfectly, and the shell chip then
// says LIVE while every screen touching a newer table fails on a missing
// relation. The applied keys are compared against db/expected-migrations.mjs —
// a generated module, because the deployed function is an esbuild bundle with no
// db/*.sql files in it to walk.
//
// ok:false still means "do not trust this deployment"; it does not mean "this
// request failed".
//
// ---------------------------------------------------------------------------
// M19 — always-200 also meant no uptime monitor could ever see an outage.
// ---------------------------------------------------------------------------
// The always-200 rule above is right for shell.js and wrong for everything else,
// and the header used to justify it partly by saying a 5xx "trips uptime
// monitors" — which is the whole job of an uptime monitor. A monitor decides
// up/down from the STATUS CODE. Pointed at a URL that answers 200 while the
// database is refusing connections, it stays green forever. With no error
// reporting and no metrics anywhere in the repo (package.json has exactly two
// dependencies, pg and inngest) and no .github/ directory, that left a 2am
// database outage discoverable only by a person opening the CRM the next
// morning. There was no second signal to fall back on.
//
// So the honest answer is OPT-IN rather than a changed default, because the
// default has live consumers that a status-code change would break:
// public/app/shell.js:283 and public/crm.html:338 both fetch("/api/health")
// with no query string, and both treat any non-200 as "NO API — /api/* is not
// deployed", which would relabel a database outage as a missing deploy. Adding
// `?strict=1` leaves those two callers on the byte-identical 200 they read
// today and gives a monitor a URL that goes 503 when ok is false.
//
// WHAT ?strict=1 IS NOT: it is not authentication. Anyone can append it. It is a
// statement of caller intent — "I am an operator or a monitor, not a browser
// chip" — and the only thing it protects is the DEFAULT body's shape and
// contents, which stay exactly as they were. See httpStatus() and wantsStrict()
// at the foot of this file, and docs/RUNBOOK.md for what to do with each answer.

import { EXPECTED_MIGRATIONS } from "../../db/expected-migrations.mjs";

// Nothing from a driver error reaches the client unscrubbed.
//
// This endpoint is UNAUTHENTICATED — public/app/shell.js reads it before there is
// a session — so anything in the body is world-readable. Three things leak
// through a raw pg error and all three are scrubbed:
//
//   the DSN          "could not connect to postgres://user:pw@host/db"  → password
//   the hostname     "getaddrinfo ENOTFOUND ep-xyz.us-east-2.aws.neon.tech"
//   the address      "connect ECONNREFUSED 10.0.3.14:5432"
//
// The hostname and address are the ones easy to miss: they arrive from
// getaddrinfo/connect rather than from a quoted URL, so a DSN-only scrub lets the
// database endpoint out. An operator needs the FAILURE CLASS, which `state` and
// the driver code already give; the host adds nothing they cannot get from their
// own configuration.
export function safeError(err) {
  var msg = String((err && err.message) || "database error");
  return msg
    // Full DSN first, so its host is gone before the host rules run.
    .replace(/postgres(ql)?:\/\/[^\s"']+/gi, "postgres://[redacted]")
    .replace(/password=\S+/gi, "password=[redacted]")
    // getaddrinfo <CODE> <host>
    .replace(/(getaddrinfo\s+[A-Z_]+)\s+\S+/g, "$1 [redacted]")
    // connect <CODE> <host-or-ip>[:port]
    .replace(/(connect\s+[A-Z_]+)\s+\S+/g, "$1 [redacted]")
    // Any bare host:port that survived the above.
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, "[redacted]")
    .replace(/\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+){2,}(?::\d+)?\b/gi, "[redacted]")
    .slice(0, 200);
}

// A driver that cannot reach the server reports it in `code`, not the message.
const UNREACHABLE = new Set([
  "ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "EHOSTUNREACH",
  "ECONNRESET", "EPIPE", "57P03" /* cannot_connect_now */
]);

export function classify(err) {
  if (/DATABASE_URL not set/i.test(String((err && err.message) || ""))) return "unconfigured";
  if (err && UNREACHABLE.has(String(err.code))) return "unreachable";
  return "error";
}

// healthState — never throws, never rejects. A health check that can fail is
// not a health check.
//
// `detail` adds `missingMigrations`: the pending migrations BY NAME, in the
// order db/migrate.mjs would apply them. It is off by default and it is the only
// thing that changes the body's shape.
//
// WHY IT IS A SEPARATE SWITCH. The counts alone answer "is this deployment
// behind" but not "behind by WHAT", and the difference is an operator reading
// one line versus diffing three directories against a database at 2am — the
// exact moment nobody should be doing that. But this endpoint is unauthenticated
// and world-readable, and health-migrations.test.mjs:65 pins a real decision:
// the default body names no .sql file, because a filename list like
// "080_plaid_items.sql, 077_soft_pull_requests.sql, 053_eeo_selfid.sql" tells an
// anonymous reader which features exist and which vendors are wired in. Both
// things are true, so both are honoured: the default body is unchanged and names
// nothing, and the operator who asks for detail gets the list. `error` never
// carries a filename in either mode — the names live only in this array, so
// anything that logs or screenshots the message cannot leak them by accident.
export async function healthState(db, now = () => new Date(), expected = EXPECTED_MIGRATIONS, detail = false) {
  const body = {
    ok: false,
    db: "down",
    state: "error",
    migrations: 0,
    expected: expected.length,
    pending: expected.length,
    error: null,
    checkedAt: now().toISOString()
  };

  try {
    const r = await db.query("SELECT key FROM schema_migrations");
    const rows = (r && r.rows) || [];
    // By key, not by count: a row count alone cannot tell "all 69 applied" from
    // "69 rows from some other branch's files".
    const applied = new Set(
      rows.map((x) => x && x.key).filter((k) => typeof k === "string")
    );
    const missing = expected.filter((k) => !applied.has(k));
    const pending = missing.length;

    body.db = "up";
    body.migrations = applied.size;
    body.pending = pending;
    body.ok = pending === 0;
    body.state = pending === 0 ? "up" : "behind";
    // No filename here: this endpoint is unauthenticated, and the counts are
    // what an operator acts on — run db/migrate.mjs. The names go in
    // missingMigrations below, and only when the caller asked for them.
    body.error = pending === 0
      ? null
      : `database is behind: ${applied.size} of ${expected.length} migrations applied, ${pending} pending`;
    if (detail) body.missingMigrations = missing;
  } catch (err) {
    body.state = classify(err);
    body.error = body.state === "unconfigured" ? "DATABASE_URL is not set" : safeError(err);
    // Nothing was read, so nothing is known to be applied — but "everything is
    // missing" would be a guess dressed as a fact. An unreachable database is
    // not a behind database, and the empty array says only what is true: no
    // pending list could be computed. body.pending stays at expected.length,
    // which is where the initial body already put it.
    if (detail) body.missingMigrations = [];
  }

  return body;
}

/* ---------------------------------------------------------------------------
   The strict channel (M19a) — how a machine asks this endpoint to be honest.
   --------------------------------------------------------------------------- */

// Values that mean "yes" on a query string. `?strict` with no value arrives as
// the empty string from URLSearchParams, and somebody typing `?strict=true` or
// `?strict=yes` into a monitor's config meant the same thing as `?strict=1`.
// Everything else — including `?strict=0` and `?strict=false` — is off, so a
// monitor can disable the flag without editing the URL down.
const STRICT_YES = new Set(["", "1", "true", "yes", "on"]);

// wantsStrict — did this caller opt in to status-code honesty?
//
// OWN properties only, and via Object.prototype.hasOwnProperty.call: the
// Netlify adapter builds req.query with Object.create(null)
// (netlify/functions/api.mjs:210), so query.hasOwnProperty does not exist to be
// called on it, and a plain `query.strict` on an ordinary object would inherit
// from the prototype chain for a key like "constructor". Same reasoning as the
// ROUTES lookup in that file.
export function wantsStrict(query) {
  if (!query || typeof query !== "object") return false;
  if (!Object.prototype.hasOwnProperty.call(query, "strict")) return false;
  const v = query.strict;
  if (v === true) return true;
  if (v === false || v === null || v === undefined) return false;
  return STRICT_YES.has(String(v).trim().toLowerCase());
}

// httpStatus — the status code for a health body, given how the caller asked.
//
// 200 unless the caller opted in AND the deployment is not trustworthy. That is
// the whole rule, and it is deliberately the ONLY thing strict changes: the body
// a strict caller gets back is the same body (plus missingMigrations), so a
// monitor that alerts on the code and a human who reads the JSON are looking at
// one source of truth rather than two.
//
// 503 rather than 500: "Service Unavailable" is what every uptime monitor,
// load balancer and status page already understands as "down but expected
// back", and it is what this means — unconfigured, unreachable, query failing
// or schema behind are all conditions a human fixes, not crashes.
export function httpStatus(body, query) {
  if (!wantsStrict(query)) return 200;
  return body && body.ok ? 200 : 503;
}

export default healthState;
