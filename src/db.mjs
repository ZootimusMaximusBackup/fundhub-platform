// Postgres connection (pg pool). One database for the whole platform (Spec §2).
import pg from "pg";

let _pool = null;

export function pool() {
  if (!_pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL not set");
    _pool = new pg.Pool({ connectionString, max: Number(process.env.PG_POOL_MAX || 10) });
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
