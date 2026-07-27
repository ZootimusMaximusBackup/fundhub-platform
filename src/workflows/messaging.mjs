// sendTemplated — shared send helper for workflow functions (Section 7 messaging
// engine + Rule 9 idempotency).
//
// Never invents copy: if `templateKey` has no row in message_templates, or the row
// hasn't passed the compliance gate, the send is a safe no-op ({ sent: false,
// reason: "template_pending" }). Real N-series SMS content is confirmed missing in
// GHL itself (Chris's own tracking note) — this is how that gap surfaces instead of
// silently sending blank/placeholder messages.
//
// Idempotent via the existing messages_org_providerref_uniq index (migration 004):
// provider_ref is synthesized from the triggering event's id, so a replayed event
// can't double-send even though this isn't a real external provider callback.
export async function sendTemplated(db, { orgId, clientId, channel, templateKey, eventId }) {
  const tpl = await db.query(
    `SELECT body, subject FROM message_templates WHERE org_id = $1 AND template_key = $2 AND compliance_passed = true LIMIT 1`,
    [orgId, templateKey]
  );
  const row = tpl.rows[0];
  if (!row) return { sent: false, reason: "template_pending" };

  const providerRef = `workflow:${templateKey}:${eventId}`;
  await db.query(
    `INSERT INTO messages (org_id, client_id, direction, channel, template_key, rendered_body, provider, provider_ref, status, compliance_check_passed)
     VALUES ($1,$2,'outbound',$3,$4,$5,'internal',$6,'queued',true)
     ON CONFLICT (org_id, provider_ref) WHERE provider_ref IS NOT NULL DO NOTHING`,
    [orgId, clientId, channel, templateKey, row.body, providerRef]
  );
  return { sent: true };
}
