// Postgres connection (pg pool). One database for the whole platform (Spec §2).
import pg from "pg";

let _pool = null;

export function pool() {
  if (!_pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL not set");
    /* TIMEOUTS. With none set, pg waits on the OS TCP timeout — a host that
       drops packets rather than refusing them left /api/health hanging for
       ~135 seconds. On a serverless platform the function is killed long before
       that, so the "health never 5xx's" contract broke by timeout rather than by
       any code path: the caller gets a platform 502 and no JSON body at all.

       connectionTimeoutMillis bounds establishing a connection; a blocked host
       now surfaces as a clean, reportable error in a couple of seconds.
       statement_timeout bounds a query that connects but never returns, which
       is the other way to hang past the function's own limit. Both are
       overridable for a slow link or a deliberately long migration run. */
    _pool = new pg.Pool({
      connectionString,
      max: Number(process.env.PG_POOL_MAX || 10),
      connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS || 5000),
      idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30000),
      statement_timeout: Number(process.env.PG_STATEMENT_TIMEOUT_MS || 15000)
    });
  }
  return _pool;
}

// query(sql, params) — the interface the event bus + handlers depend on.
export const db = {
  query: (sql, params) => pool().query(sql, params)
};

export async function close() {
  if (_pool) { await _pool.end(); _pool = null; }
}
