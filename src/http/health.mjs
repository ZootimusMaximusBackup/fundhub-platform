// Health state — the testable core behind api/health.mjs.
//
// Framework-agnostic in the same spirit as src/http/router.mjs and
// dashboard-auth.mjs: this takes a db and returns a plain object, so the
// classification can be tested without an HTTP layer or a live Postgres.
//
// The endpoint that mounts it ALWAYS answers 200. This endpoint is the only way
// the browser can tell three failures apart — no function deployed, function up
// but unconfigured, and a database refusing connections — and
// public/app/shell.js branches on exactly that to label its chip
// (NO API / NO DB / LIVE). A 503 is indistinguishable from a platform error at
// the edge, and a 5xx here also trips uptime monitors and Netlify's own error
// pages. So the answer arrives as a body, never as a status code.
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
export async function healthState(db, now = () => new Date(), expected = EXPECTED_MIGRATIONS) {
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
    const pending = expected.filter((k) => !applied.has(k)).length;

    body.db = "up";
    body.migrations = applied.size;
    body.pending = pending;
    body.ok = pending === 0;
    body.state = pending === 0 ? "up" : "behind";
    // No filename here: this endpoint is unauthenticated, and the counts are
    // what an operator acts on — run db/migrate.mjs.
    body.error = pending === 0
      ? null
      : `database is behind: ${applied.size} of ${expected.length} migrations applied, ${pending} pending`;
  } catch (err) {
    body.state = classify(err);
    body.error = body.state === "unconfigured" ? "DATABASE_URL is not set" : safeError(err);
  }

  return body;
}

export default healthState;
