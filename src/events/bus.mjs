// Event bus — Master Rebuild Spec §4 + §16 (replay harness).
// Append-only writes to the `events` table (Rule 9: id + integer version + safe
// replay). Every adapter writes here first, then handlers react.
//
// Dependency-injected `db` ({ query(sql, params) }) so it unit-tests without a
// live Postgres and runs against `pg` in prod.

import { isCanonical } from "./canonical.mjs";
import { getHandlers } from "./registry.mjs";

const DEFAULT_ORG = process.env.DEFAULT_ORG_SLUG || "fundhub";

// emit — append an event, dispatch to handlers. Idempotent by idempotency_key.
// Returns { id, deduped }.
export async function emit(db, name, payload = {}, opts = {}) {
  if (!name || typeof name !== "string") throw new Error("event name required");
  if (!isCanonical(name) && !opts.allowNonCanonical) {
    throw new Error(`unknown event "${name}" (pass allowNonCanonical to extend)`);
  }
  const version = Number.isInteger(opts.version) ? opts.version : 1;
  const orgId = opts.orgId || (await resolveDefaultOrg(db));
  const idem = opts.idempotencyKey || null;

  // Idempotent insert: ON CONFLICT (org_id, idempotency_key) DO NOTHING.
  const insert = await db.query(
    `INSERT INTO events (org_id, name, version, idempotency_key, client_id, payload)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (org_id, idempotency_key) WHERE idempotency_key IS NOT NULL
     DO NOTHING
     RETURNING id`,
    [orgId, name, version, idem, opts.clientId || null, payload]
  );

  if (insert.rows.length === 0 && idem) {
    // already processed — safe no-op
    return { id: null, deduped: true };
  }
  const id = insert.rows[0].id;
  await dispatch(db, { id, name, version, orgId, clientId: opts.clientId || null, payload });
  return { id, deduped: false };
}

// replay — re-dispatch stored events (by name and/or since a timestamp).
// Used by the V1 replay validator to assert on Postgres after a merge.
export async function replay(db, filter = {}) {
  const clauses = [];
  const params = [];
  if (filter.name) { params.push(filter.name); clauses.push(`name = $${params.length}`); }
  if (filter.since) { params.push(filter.since); clauses.push(`created_at >= $${params.length}`); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = (await db.query(
    `SELECT id, name, version, org_id, client_id, payload FROM events ${where} ORDER BY created_at ASC`,
    params
  )).rows;
  let dispatched = 0;
  for (const r of rows) {
    await dispatch(db, { id: r.id, name: r.name, version: r.version, orgId: r.org_id, clientId: r.client_id, payload: r.payload });
    await db.query(`UPDATE events SET replayed_at = now() WHERE id = $1`, [r.id]);
    dispatched += 1;
  }
  return { dispatched };
}

async function dispatch(db, event) {
  for (const handler of getHandlers(event.name)) {
    await handler(event, db); // handlers are idempotent per the spec
  }
}

let _orgCache = null;
async function resolveDefaultOrg(db) {
  if (_orgCache) return _orgCache;
  const r = await db.query(`SELECT id FROM orgs WHERE slug = $1 LIMIT 1`, [DEFAULT_ORG]);
  if (!r.rows.length) throw new Error(`default org "${DEFAULT_ORG}" not found — run migrations`);
  _orgCache = r.rows[0].id;
  return _orgCache;
}

export const _resetOrgCache = () => { _orgCache = null; };
