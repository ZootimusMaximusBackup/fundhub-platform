// POST /api/chat/portal-message — client → staff from the portal chat widget.
//
// Lands on the client's existing conversation for the channel (sms/email),
// threaded — not a separate silo (spec §4.3).

import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { upsertConversation, linkMessage } from "../../src/conversations/store.mjs";
import { safeError } from "../../src/http/health.mjs";
import {
  answerPortalMessage, portalAssistantContext
} from "../../src/chat/portal-assistant.mjs";
import { prequalFromCustomFields, formatPrequalUsd } from "../../src/http/portal-prequal.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const principal = await requirePrincipal(req, res, ["client"], { db });
  if (!principal) return;

  const clientId = principal.clientId || principal.account?.client_id || principal.id;
  const orgId = principal.orgId || principal.org_id;
  if (!clientId || !orgId) {
    return res.status(403).json({ ok: false, error: "no_client_scope" });
  }

  const body = req.body || {};
  const text = String(body.body || "").trim();
  if (!text) return res.status(400).json({ ok: false, error: "body_required" });
  if (text.length > 8000) return res.status(400).json({ ok: false, error: "body_too_long" });

  const channel = String(body.channel || "sms").toLowerCase();
  if (channel !== "sms" && channel !== "email") {
    return res.status(400).json({ ok: false, error: "channel_must_be_sms_or_email" });
  }

  try {
    const convo = await upsertConversation(db, {
      orgId,
      clientId,
      channel,
      lastPulseAt: new Date().toISOString()
    });

    const ins = await db.query(
      `INSERT INTO messages (
         org_id, client_id, conversation_id, direction, channel,
         rendered_body, status, compliance_check_passed, sender_kind
       ) VALUES ($1, $2, $3, 'inbound', $4, $5, 'received', true, 'client')
       RETURNING *`,
      [orgId, clientId, convo.id, channel, text]
    );
    const message = ins.rows[0];
    try {
      await linkMessage(db, { messageId: message.id, conversationId: convo.id });
    } catch { /* non-fatal */ }

    /* The assistant reply. Best-effort by design: the client's message is
       already committed above, so a model outage must not turn a saved message
       into a 500. Worst case they get the fallback line and staff still see the
       thread. */
    let reply = null;
    try {
      reply = await replyFor(db, { orgId, clientId, question: text, conversationId: convo.id, channel });
    } catch {
      reply = null;
    }

    return res.status(200).json({
      ok: true,
      conversation_id: convo.id,
      message,
      reply
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}

/* Build the assistant's reply and, when the model actually answered, keep it on
   the thread so staff read the same conversation the client saw.
   status='delivered', NOT 'queued' — src/messaging/dispatch.mjs claims outbound
   rows with status='queued', so a queued row here would be texted or emailed to
   the client on top of the portal reply they already read. */
async function replyFor(database, { orgId, clientId, question, conversationId, channel }) {
  const found = await database.query(
    `SELECT first_name, custom_fields FROM clients WHERE id = $1 AND org_id = $2`,
    [clientId, orgId]
  );
  const client = found.rows[0] || {};
  const cf = client.custom_fields || {};
  const context = portalAssistantContext({
    client,
    prequalDisplay: formatPrequalUsd(prequalFromCustomFields(cf))
  });

  const answer = await answerPortalMessage({ question, context });

  if (answer.ok) {
    try {
      const saved = await database.query(
        `INSERT INTO messages (
           org_id, client_id, conversation_id, direction, channel,
           rendered_body, status, provider, compliance_check_passed, sender_kind
         ) VALUES ($1, $2, $3, 'outbound', $4, $5, 'delivered', 'internal', true, 'agent')
         RETURNING id`,
        [orgId, clientId, conversationId, channel, answer.text]
      );
      await linkMessage(database, {
        messageId: saved.rows[0].id,
        conversationId
      });
    } catch { /* the reply still goes to the screen; the thread copy is a bonus */ }
  }

  return { text: answer.text, source: answer.ok ? "assistant" : "fallback" };
}
