// isDbDown / dbDown — "the database did not answer" as a status a screen can read.
//
// *** THE BUG THIS EXISTS TO FIX. ***
//
// Every endpoint in the Finance OS cluster ended its top-level catch with a bare
// `throw e`. netlify/functions/api.mjs wraps anything thrown into
// `500 { ok:false, error:"internal_error" }`, and public/app/data.js classifies a
// 500 as source "server", whose wording is:
//
//     "something went wrong on our side while answering.
//      The database did not report a problem."
//
// That sentence is correct for our own code throwing. It is a LIE when the throw
// was Postgres refusing the connection — which is exactly what the Finance OS
// screen showed for the funding-capacity read: "Funding capacity could not be
// read — HTTP 500 internal_error", printed while the database was down. The one
// person who could have fixed it in a minute was told the database was fine.
//
// data.js already has the honest branch and has had it all along: a 503 carrying
// `db:"down"` becomes source "nodb" and reads "the database is not answering".
// requireAuth uses that shape, api/auth/session.mjs uses it, and
// api/dashboard/pipeline.mjs uses it. The Finance OS reads simply never did, so
// an outage arrived at the user wearing our code's face.
//
// *** WHY THE CHECK IS NOT JUST health.mjs's classify(). ***
//
// classify() answers "unreachable" off a driver `code` — ECONNREFUSED and its
// four siblings. That covers a host that is gone. It does NOT cover the two
// failures a POOLED connection actually dies of, because neither carries a code:
//
//   "Connection terminated unexpectedly"        a pooler (Supavisor, PgBouncer)
//                                               reaping a backend mid-query
//   "timeout exceeded when trying to connect"   pg's own connectionTimeoutMillis
//
// Those are the ones that hit a live request rather than a cold start, and they
// are the ones the funding-capacity read was failing on. The SQLSTATE class 08
// (connection exception) and the 57P0x shutdown codes are included for the same
// reason: they all mean the connection, not the query.
//
// safeError() is health.mjs's, not a second copy: a driver error quotes the DSN,
// the hostname or the IP, and this body reaches a browser.

import { safeError, classify } from "./health.mjs";

/* SQLSTATE codes that mean the CONNECTION failed, never the query.
   Class 08 is "connection exception"; 57P01/02/03 are the server telling us it
   is going away. None of these are the caller's fault and none are ours. */
const CONNECTION_STATES = new Set([
  "08000", // connection_exception
  "08003", // connection_does_not_exist
  "08006", // connection_failure
  "08001", // sqlclient_unable_to_establish_sqlconnection
  "08004", // sqlserver_rejected_establishment_of_sqlconnection
  "08007", // transaction_resolution_unknown
  "08P01", // protocol_violation
  "57P01", // admin_shutdown — "terminating connection due to administrator command"
  "57P02", // crash_shutdown
  "57P03"  // cannot_connect_now — server still starting up
]);

/* The codeless ones. node-postgres raises these as plain Errors with no `code`,
   so a message match is the only thing available. Anchored to phrases the driver
   emits verbatim; deliberately narrow, because a false positive here tells an
   operator the database is down when our own code is what broke. */
const CONNECTION_MESSAGES = [
  /connection terminated/i,
  /timeout exceeded when trying to connect/i,
  /client has encountered a connection error/i,
  /server closed the connection unexpectedly/i,
  /connection ended unexpectedly/i,
  /DATABASE_URL not set/i
];

/**
 * isDbDown(err) — true when the database did not answer.
 *
 * Deliberately narrow. Anything it is unsure about is NOT a database outage, so
 * an unclassified fault keeps falling through to the 500 it already got. Being
 * wrong towards "our code broke" costs an operator one wrong guess; being wrong
 * towards "the database is down" sends them to Postgres for an hour.
 */
export function isDbDown(err) {
  if (!err) return false;
  if (classify(err) === "unreachable") return true;
  if (CONNECTION_STATES.has(String(err.code))) return true;
  const msg = String(err.message || "");
  return CONNECTION_MESSAGES.some((re) => re.test(msg));
}

/**
 * dbDown(res, err) — write the outage answer and return true, so a catch reads:
 *
 *     if (dbDown(res, e)) return;
 *     throw e;
 *
 * The body shape is the one already in use at api/journeys/run.mjs and
 * api/dashboard/pipeline.mjs, and it is the shape public/app/data.js reads as
 * source "nodb". `message` is scrubbed by health.mjs's safeError — a raw driver
 * error carries the DSN, the host or the IP, and this reaches a browser.
 */
export function dbDown(res, err) {
  if (!isDbDown(err)) return false;
  res.status(503).json({
    ok: false,
    error: "db_unavailable",
    db: "down",
    message: safeError(err)
  });
  return true;
}

export default dbDown;
