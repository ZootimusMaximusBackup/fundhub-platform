// Agent reply — queue an outbound message as sender_kind=agent and hand it to
// the EXISTING dispatch path. The compliance gate always runs inside
// dispatchMessage. There is no bypass.

import { dispatchMessage, OUTCOME } from "../messaging/dispatch.mjs";
import { linkMessage, upsertConversation } from "../conversations/store.mjs";

const ADDRESS_BY_CHANNEL = { email: "email", sms: "phone" };
export const MAX_BODY_LENGTH = 4000;

async function addressFor(db, clientId, channel) {
  const col = ADDRESS_BY_CHANNEL[channel];
  if (!col) return null;
  const { rows } = await db.query(
    `SELECT ${col} AS address FROM clients WHERE id = $1 LIMIT 1`,
    [clientId]
  );
  return rows[0]?.address || null;
}

/**
 * composeAgentReply(db, input, options) → { message, outcome, detail, shadowed? }
 *
 * input: {
 *   orgId, agentCode, clientId, conversationId?, channel, body, subject?,
 *   idempotencyKey?, fromName?
 * }
 *
 * ALWAYS goes through dispatchMessage → gateAndRecord. Quiet hours and
 * opt-out are enforced there, not here.
 */
export async function composeAgentReply(db, input = {}, options = {}) {
  const {
    orgId, agentCode, clientId, conversationId = null,
    channel, body, subject = null, idempotencyKey = null
  } = input;

  if (!orgId) throw new Error("composeAgentReply: orgId is required");
  if (!agentCode) throw new Error("composeAgentReply: agentCode is required");
  if (!clientId) throw new Error("composeAgentReply: clientId is required");
  if (channel !== "sms" && channel !== "email") {
    throw new Error(`composeAgentReply: unsupported channel ${channel}`);
  }

  const text = typeof body === "string" ? body.trim() : "";
  if (!text) throw new Error("composeAgentReply: body is required");
  if (text.length > MAX_BODY_LENGTH) {
    throw new Error(`composeAgentReply: body longer than ${MAX_BODY_LENGTH}`);
  }

  let convoId = conversationId;
  if (!convoId) {
    const convo = await upsertConversation(db, {
      orgId, clientId, channel, lastPulseAt: new Date().toISOString()
    });
    convoId = convo.id;
  }

  // Stick the agent onto the conversation so the next inbound resolves fast.
  await db.query(
    `UPDATE conversations
        SET agent_code = COALESCE(agent_code, $2), updated_at = now()
      WHERE id = $1`,
    [convoId, String(agentCode).trim().toUpperCase()]
  );

  const providerRef = idempotencyKey
    ? `agent:${String(agentCode).trim().toUpperCase()}:${idempotencyKey}`
    : null;
  const toAddress = await addressFor(db, clientId, channel);
  const subjectLine = channel === "email" && typeof subject === "string" && subject.trim()
    ? subject.trim()
    : null;

  const ins = await db.query(
    `INSERT INTO messages (
       org_id, client_id, conversation_id, direction, channel, rendered_body,
       provider_ref, status, compliance_check_passed, to_address, subject,
       sender_staff_id, sender_kind, sender_agent_code
     )
     VALUES ($1,$2,$3,'outbound',$4,$5,$6,'queued',false,$7,$8,NULL,'agent',$9)
     ON CONFLICT (org_id, provider_ref) WHERE provider_ref IS NOT NULL DO NOTHING
     RETURNING id, created_at`,
    [
      orgId, clientId, convoId, channel, text, providerRef,
      toAddress, subjectLine, String(agentCode).trim().toUpperCase()
    ]
  );

  if (!ins.rows[0]) {
    const existing = await db.query(
      `SELECT id, conversation_id, channel, rendered_body, status, created_at
         FROM messages WHERE org_id = $1 AND provider_ref = $2 LIMIT 1`,
      [orgId, providerRef]
    );
    return {
      message: existing.rows[0] || null,
      conversationId: convoId,
      outcome: null,
      detail: null,
      deduped: true
    };
  }

  const messageId = ins.rows[0].id;
  try {
    await linkMessage(db, { messageId, conversationId: convoId });
    await upsertConversation(db, {
      orgId, clientId, channel, lastPulseAt: ins.rows[0].created_at || null
    });
  } catch (err) {
    console.error(`[agent-reply] threading failed for ${messageId}: ${err && err.message}`);
  }

  const result = await dispatchMessage(db, messageId, options);

  const final = await db.query(
    `SELECT id, conversation_id, client_id, channel, direction, rendered_body,
            subject, status, provider, blocked_reason, last_error, scheduled_at,
            sender_kind, sender_agent_code, created_at
       FROM messages WHERE id = $1`,
    [messageId]
  );

  return {
    message: final.rows[0] || null,
    conversationId: convoId,
    outcome: result.outcome,
    detail: result.detail,
    deduped: false,
    sent: result.outcome === OUTCOME.SENT
  };
}

export default composeAgentReply;
