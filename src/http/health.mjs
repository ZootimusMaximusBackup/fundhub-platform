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
//   state "up"           — database answered; migrations counted
//   state "unconfigured" — no DATABASE_URL in the environment
//   state "unreachable"  — DATABASE_URL set, connection refused or timed out
//   state "error"        — connected, query failed (schema missing, perms)
//
// ok:false still means "do not trust this deployment"; it does not mean "this
// request failed".

// Connection errors quote the DSN often enough to matter, and the DSN carries
// the password. Nothing from a driver error reaches the client unscrubbed.
export function safeError(err) {
  var msg = String((err && err.message) || "database error");
  return msg
    .replace(/postgres(ql)?:\/\/[^\s"']+/gi, "postgres://[redacted]")
    .replace(/password=\S+/gi, "password=[redacted]")
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
export async function healthState(db, now = () => new Date()) {
  const body = {
    ok: false,
    db: "down",
    state: "error",
    migrations: 0,
    error: null,
    checkedAt: now().toISOString()
  };

  try {
    const r = await db.query("SELECT count(*)::int AS n FROM schema_migrations");
    const n = r && r.rows && r.rows[0] ? Number(r.rows[0].n) : 0;
    body.ok = true;
    body.db = "up";
    body.state = "up";
    body.migrations = Number.isFinite(n) ? n : 0;
  } catch (err) {
    body.state = classify(err);
    body.error = body.state === "unconfigured" ? "DATABASE_URL is not set" : safeError(err);
  }

  return body;
}

export default healthState;
