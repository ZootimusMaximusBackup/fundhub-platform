// The pool the ROW-LEVEL-SECURITY tests must talk through, which is not always
// the one the rest of the suite uses.
//
// WHY THIS EXISTS
//
// A Postgres SUPERUSER — and any role carrying rolbypassrls — ignores every RLS
// policy on every table, FORCE or not. src/partners/rls.mjs says so at length
// and db/migrations/104_app_role.sql exists entirely because of it.
//
// The full suite deliberately connects as the table OWNER: ~14 files run
// ALTER TABLE ... DISABLE TRIGGER to prove the archive-only guards hold, and
// `fundhub_app` cannot do that. That is correct for those files and WRONG for
// the isolation files, whose assertions are of the form "partner B reads zero
// rows of partner A's data". Under an owner that read succeeds, so the tests
// fail while reporting a leak that does not exist. Measured 2026-08-27 on
// databases built from zero:
//
//     creative-endpoints   owner 24 pass / 18 fail   app role 41 pass / 1 fail
//     invariants           owner 10 pass /  2 fail   app role 12 pass / 0 fail
//     generate             owner 17 pass /  3 fail   app role 20 pass / 0 fail
//     social               owner 22 pass /  1 fail   app role 23 pass / 0 fail
//
// So: SET UP as the owner (fixtures need ownership), ASSERT as the unprivileged
// role (policies only apply to it). Both, in the same file, from one run.
//
// WHEN APP_DATABASE_URL IS NOT SET this returns the ordinary pool and the
// isolation assertions are not meaningful. Callers should use rlsIsReal() to
// say so out loud rather than reporting a false pass.

import pg from "pg";
import { pool as defaultPool } from "../db.mjs";

let _appPool = null;

function appUrl() {
  const app = String(process.env.APP_DATABASE_URL || "").trim();
  if (!app) return null;
  if (app === String(process.env.DATABASE_URL || "").trim()) return null;
  return app;
}

/** True when a genuinely unprivileged connection is available to assert through. */
export function rlsIsReal() {
  return appUrl() !== null;
}

/** The pool RLS assertions should run on. Shaped as a function because
    withPartnerScope calls `pool()`. */
export function rlsPool() {
  const url = appUrl();
  if (!url) return defaultPool();
  if (!_appPool) {
    _appPool = new pg.Pool({
      connectionString: url,
      max: Number(process.env.PG_POOL_MAX || 4),
      connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS || 5000),
      statement_timeout: Number(process.env.PG_STATEMENT_TIMEOUT_MS || 15000)
    });
    _appPool.on("error", (err) => {
      console.error("rls-pool: idle client error (recovering)", err && err.message);
    });
  }
  return _appPool;
}

export async function closeRlsPool() {
  if (_appPool) { await _appPool.end(); _appPool = null; }
}

/** A `{ query }` handle on the same restricted pool, for the tests that assert
    what an UNSCOPED session can read. Those deliberately skip withPartnerScope —
    "a forgotten predicate must fail closed" — but they still have to run as the
    unprivileged role, or the owner reads straight past every policy and the test
    reports a leak that only exists because of who is connected. */
export const rlsDb = {
  query: (sql, params) => rlsPool().query(sql, params)
};
