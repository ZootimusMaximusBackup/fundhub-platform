// mergeCustomFields — same shape as the private helper in
// src/handlers/client-lifecycle.mjs, duplicated here rather than exported from that
// module (not touching existing handler files). Merge a partial object into
// clients.custom_fields (jsonb). No-op on empty.
export async function mergeCustomFields(db, clientId, patch) {
  if (!clientId || !patch || Object.keys(patch).length === 0) return;
  await db.query(
    `UPDATE clients SET custom_fields = custom_fields || $2::jsonb WHERE id = $1`,
    [clientId, JSON.stringify(patch)]
  );
}

// One-shot lock. Two form pings at the same time both used to pass a read
// check, then both send. This write only lands if the field is still empty.
// Returns true when this caller won the lock.
export async function claimCustomFieldLock(db, clientId, field) {
  if (!clientId || !field) return false;
  const stamp = new Date().toISOString();
  const r = await db.query(
    `UPDATE clients
        SET custom_fields = COALESCE(custom_fields, '{}'::jsonb) || $2::jsonb
      WHERE id = $1
        AND COALESCE(custom_fields->>$3, '') = ''
      RETURNING id`,
    [clientId, JSON.stringify({ [field]: stamp }), field]
  );
  return r.rows.length > 0;
}
