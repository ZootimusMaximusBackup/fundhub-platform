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
import { isOptedOut } from "../lib/opt-out.mjs";
import { renderTemplate } from "../lib/render-template.mjs";

// Merge-tag context for the ported GHL copy, which merges `{{contact.*}}` — first name,
// business name, the pre-approval amount. Every call site in src/workflows passes no
// `context`, so without this those tags resolve to nothing (and before the renderer fix
// they rendered literally, braces and all, into live SMS and email).
//
// Sourced from the client record: the identity columns off `clients`, plus the
// custom_fields jsonb that holds the 252 ported GHL fields — which is where
// analyzer_prequal_amount and the rest of `contact.*` actually live. Columns are spread
// last so a stale same-named custom field can't shadow real identity data.
async function clientContext(db, clientId) {
  if (!clientId) return {};
  const r = await db.query(
    `SELECT first_name, last_name, email, phone, custom_fields FROM clients WHERE id = $1 LIMIT 1`,
    [clientId]
  );
  const c = r.rows[0];
  if (!c) return {};
  const fullName = [c.first_name, c.last_name].filter(Boolean).join(" ") || null;
  return {
    contact: {
      ...(c.custom_fields || {}),
      first_name: c.first_name ?? null,
      last_name: c.last_name ?? null,
      name: fullName,
      full_name: fullName,
      email: c.email ?? null,
      phone: c.phone ?? null
    }
  };
}

export async function sendTemplated(db, { orgId, clientId, channel, templateKey, eventId, context = {} }) {
  // TCPA / suppression guard: skip opted-out contacts before touching any template.
  if (clientId && channel === "sms") {
    const suppressed = await isOptedOut(db, clientId, "sms");
    if (suppressed) {
      console.warn(`[sendTemplated] suppressed: client ${clientId} opted out of sms`);
      return { sent: false, reason: "opted_out" };
    }
  }

  const tpl = await db.query(
    `SELECT body, subject FROM message_templates WHERE org_id = $1 AND template_key = $2 AND compliance_passed = true LIMIT 1`,
    [orgId, templateKey]
  );
  const row = tpl.rows[0];
  if (!row) return { sent: false, reason: "template_pending" };

  // Loaded only once a real template exists — a template_pending no-op costs no query.
  // An explicitly-passed `context` wins over the record, so a caller can still override.
  const base = await clientContext(db, clientId);
  const rendered = renderTemplate(row.body, {
    ...base,
    ...context,
    contact: { ...(base.contact || {}), ...(context.contact || {}) }
  });
  const providerRef = `workflow:${templateKey}:${eventId}`;
  await db.query(
    `INSERT INTO messages (org_id, client_id, direction, channel, template_key, rendered_body, provider, provider_ref, status, compliance_check_passed)
     VALUES ($1,$2,'outbound',$3,$4,$5,'internal',$6,'queued',true)
     ON CONFLICT (org_id, provider_ref) WHERE provider_ref IS NOT NULL DO NOTHING`,
    [orgId, clientId, channel, templateKey, rendered, providerRef]
  );
  return { sent: true };
}
