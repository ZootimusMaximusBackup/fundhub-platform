// Shadow log — AE-08 feed. Every would-be reply that did not go out lands here.

/**
 * recordShadow(db, row) → inserted row
 * reason vocabulary:
 *   shadow_status | no_api_key | guardrail_halt | guardrail_block |
 *   model_error | opted_out | quiet_hours | skip | ambiguous | draft
 */
export async function recordShadow(db, {
  orgId, agentCode, clientId = null, conversationId = null,
  inboundMessageId = null, channel = null, inboundBody = null,
  wouldSendBody = null, contextSnapshot = null, modelRequest = null,
  reason
} = {}) {
  if (!orgId || !agentCode || !reason) {
    throw new Error("recordShadow: orgId, agentCode, and reason are required");
  }
  const { rows } = await db.query(
    `INSERT INTO agent_shadow_log (
       org_id, agent_code, client_id, conversation_id, inbound_message_id,
       channel, inbound_body, would_send_body, context_snapshot, model_request, reason
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11)
     RETURNING id, agent_code, reason, created_at, would_send_body, channel`,
    [
      orgId, String(agentCode).trim().toUpperCase(), clientId, conversationId,
      inboundMessageId, channel, inboundBody, wouldSendBody,
      JSON.stringify(contextSnapshot || {}),
      modelRequest == null ? null : JSON.stringify(modelRequest),
      String(reason).slice(0, 80)
    ]
  );
  return rows[0];
}

/** listShadow — newest first, for AE-08. */
export async function listShadow(db, { orgId, agentCode = null, limit = 50 } = {}) {
  if (!orgId) throw new Error("listShadow: orgId is required");
  const { rows } = await db.query(
    `SELECT id, agent_code, client_id, conversation_id, channel,
            inbound_body, would_send_body, reason, created_at
       FROM agent_shadow_log
      WHERE org_id = $1
        AND ($2::text IS NULL OR agent_code = $2)
      ORDER BY created_at DESC
      LIMIT $3`,
    [orgId, agentCode ? String(agentCode).trim().toUpperCase() : null, Math.min(limit, 200)]
  );
  return rows;
}

/** Shape the agent-editor AE-08 card expects: { t, c, o } */
export function toEditorRows(rows) {
  return (rows || []).map((r) => {
    const when = r.created_at ? new Date(r.created_at) : null;
    const t = when && !Number.isNaN(when.getTime())
      ? when.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
      : "";
    const outcome = r.would_send_body
      ? (r.reason === "guardrail_halt" || r.reason === "guardrail_block"
        ? `BLOCKED · ${r.reason}: ${String(r.would_send_body).slice(0, 200)}`
        : String(r.would_send_body).slice(0, 280))
      : `(${r.reason}) no body`;
    return {
      t,
      c: r.channel || "—",
      o: outcome,
      reason: r.reason,
      id: r.id
    };
  });
}

export default { recordShadow, listShadow, toEditorRows };
