// Shared clients.tags helpers — GHL's "Add tag" / "Remove tag" steps, ported as
// idempotent array operations (safe to run twice: union / except are naturally
// idempotent, no guard-select needed).

export async function addTags(db, clientId, tags) {
  if (!clientId || !tags?.length) return;
  await db.query(
    `UPDATE clients SET tags = array(SELECT DISTINCT unnest(tags || $2::text[])) WHERE id = $1`,
    [clientId, tags]
  );
}

export async function removeTags(db, clientId, tags) {
  if (!clientId || !tags?.length) return;
  await db.query(
    `UPDATE clients SET tags = array(SELECT unnest(tags) EXCEPT SELECT unnest($2::text[])) WHERE id = $1`,
    [clientId, tags]
  );
}
