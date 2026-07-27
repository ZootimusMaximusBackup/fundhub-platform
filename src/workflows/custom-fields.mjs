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
