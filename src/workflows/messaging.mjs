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
//
// STAFF TELEMETRY IS A SEAM HERE, AND IT IS EMPTY ON PURPOSE.
// `staff_events` records "this person did this thing". Every one of this
// function's 39 call sites is an Inngest workflow reacting to a system event,
// and a workflow has no staff member — so there is nobody to attribute a
// `text_sent` row to and none is written. The `staffId` argument below is the
// place a staff-initiated send would pass one; there is no such send today (no
// api/messages.mjs, no send action on any endpoint), so it is never supplied
// and no row is ever produced. That is the correct outcome, not a gap to fill
// with an invented actor. See src/shifts/TELEMETRY-CALLSITES.md.
import { isOptedOut } from "../lib/opt-out.mjs";
import { renderTemplate } from "../lib/render-template.mjs";
import { logStaffEvent } from "../shifts/telemetry.mjs";
import { resolveShiftId } from "../shifts/attribution.mjs";

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

export async function sendTemplated(db, { orgId, clientId, channel, templateKey, eventId, context = {}, staffId, shiftId }) {
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
  // RETURNING id so a deduped replay can be told from a real queue. It changes
  // nothing about what is written — ON CONFLICT DO NOTHING returns no row — and
  // the return value below is deliberately unchanged, because every existing
  // caller reads `sent` and a replay has always reported sent:true.
  const ins = await db.query(
    `INSERT INTO messages (org_id, client_id, direction, channel, template_key, rendered_body, provider, provider_ref, status, compliance_check_passed)
     VALUES ($1,$2,'outbound',$3,$4,$5,'internal',$6,'queued',true)
     ON CONFLICT (org_id, provider_ref) WHERE provider_ref IS NOT NULL DO NOTHING
     RETURNING id`,
    [orgId, clientId, channel, templateKey, rendered, providerRef]
  );

  /* THE SEAM. Inert until a staff-initiated send exists — see the header.
     Three conditions, all necessary:
       staffId   — a workflow passes none, and an unattributed row is worse than
                   no row: `staff_events` means "this person did this".
       sms       — the kind is `text_sent`. An email is not a text, and there is
                   no kind for one; filing it here would make the count a lie.
       a new row — a replayed event that deduped into DO NOTHING queued nothing,
                   so counting it would inflate one person's numbers on retry.
     Nothing below can fail the send: logStaffEvent never throws, and the message
     row is already committed by the time this runs. */
  if (staffId && channel === "sms" && ins?.rows?.[0]) {
    await logStaffEvent(db, {
      orgId,
      staffId,
      shiftId: await resolveShiftId(db, { staffId, shiftId }),
      kind: "text_sent",
      detail: { client_id: clientId ?? null, template_key: templateKey, channel, message_id: ins.rows[0].id }
      // The rendered body is NOT copied in. It is client-facing copy about a
      // consumer's file; `detail` is an index over work, not a second outbox.
    });
  }

  return { sent: true };
}
