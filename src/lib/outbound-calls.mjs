// Tracks outbound Bland AI calls so the completed-call webhook can resolve
// callId → clientId (Bland's payload has no clientId on completion).

/**
 * Record a dispatched call. Idempotent: duplicate call_id is silently ignored.
 * @param {{ callId: string, clientId: string, orgId: string, kind: string, db: object }} opts
 */
export async function recordDispatch({ callId, clientId, orgId, kind, db }) {
  await db.query(
    `INSERT INTO outbound_calls (call_id, client_id, org_id, kind)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (call_id) DO NOTHING`,
    [callId, clientId, orgId, kind]
  );
}

/**
 * Look up the clientId for a Bland call by callId.
 * Returns null when not found.
 * @param {string} callId
 * @param {object} db
 * @returns {Promise<string|null>}
 */
export async function resolveClientByCallId(callId, db) {
  const res = await db.query(
    `SELECT client_id FROM outbound_calls WHERE call_id = $1`,
    [callId]
  );
  return res.rows[0]?.client_id ?? null;
}
