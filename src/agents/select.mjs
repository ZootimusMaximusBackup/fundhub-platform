// Agent selection — which registry row owns this inbound message.
//
// Order (owner-set this session):
//   1. Skip if no client, or conversation is agent-halted.
//   2. conversations.agent_code if set and the agent is eligible.
//   3. Last outbound sender_agent_code on this conversation, if eligible.
//   4. Exactly one channel-compatible live|shadow messaging agent.
//      Zero or many → skip (ambiguous ownership must not invent a reply).
//
// Eligible = status in (live, shadow), channel covers the inbound channel,
// agent_class = client_facing, channel is messaging (sms|email|sms_email),
// runtime !== 'bland' (Bland stays on the external path until cutover).

const MESSAGING_CHANNELS = new Set(["sms", "email", "sms_email"]);
const RUNNING = new Set(["live", "shadow"]);

export function channelCompatible(agentChannel, inboundChannel) {
  if (!agentChannel || !inboundChannel) return false;
  if (agentChannel === inboundChannel) return true;
  if (agentChannel === "sms_email" && (inboundChannel === "sms" || inboundChannel === "email")) {
    return true;
  }
  return false;
}

export function isEligibleAgent(agent, inboundChannel) {
  if (!agent) return false;
  if (!RUNNING.has(agent.status)) return false;
  if (agent.agent_class && agent.agent_class !== "client_facing") return false;
  if (!MESSAGING_CHANNELS.has(agent.channel)) return false;
  if (agent.runtime === "bland") return false;
  if (!channelCompatible(agent.channel, inboundChannel)) return false;
  // Draft prompts empty → cannot usefully reply.
  if (!agent.prompt || !String(agent.prompt).trim()) return false;
  return true;
}

/**
 * selectAgent(db, { orgId, clientId, channel, conversationId? })
 * → { agent, reason } | { agent: null, reason }
 */
export async function selectAgent(db, {
  orgId, clientId, channel, conversationId = null
} = {}) {
  if (!orgId || !clientId) {
    return { agent: null, reason: "no_client" };
  }
  if (!channel || (channel !== "sms" && channel !== "email")) {
    return { agent: null, reason: "unsupported_channel" };
  }

  let convo = null;
  if (conversationId) {
    const { rows } = await db.query(
      `SELECT id, agent_code, agent_halted_at, agent_halt_reason
         FROM conversations WHERE id = $1 AND org_id = $2`,
      [conversationId, orgId]
    );
    convo = rows[0] || null;
  } else {
    const { rows } = await db.query(
      `SELECT id, agent_code, agent_halted_at, agent_halt_reason
         FROM conversations
        WHERE org_id = $1 AND client_id = $2 AND channel = $3
          AND COALESCE(kind, 'client') = 'client'
        LIMIT 1`,
      [orgId, clientId, channel]
    );
    convo = rows[0] || null;
  }

  if (convo?.agent_halted_at) {
    return {
      agent: null,
      reason: "halted",
      detail: convo.agent_halt_reason || "thread halted",
      conversationId: convo.id
    };
  }

  const load = async (code) => {
    if (!code) return null;
    const { rows } = await db.query(
      `SELECT * FROM agents WHERE org_id = $1 AND code = $2`,
      [orgId, String(code).trim().toUpperCase()]
    );
    return rows[0] || null;
  };

  if (convo?.agent_code) {
    const a = await load(convo.agent_code);
    if (isEligibleAgent(a, channel)) {
      return { agent: a, reason: "conversation_assigned", conversationId: convo.id };
    }
  }

  const convoId = convo?.id || conversationId;
  if (convoId) {
    const { rows } = await db.query(
      `SELECT sender_agent_code
         FROM messages
        WHERE conversation_id = $1
          AND sender_kind = 'agent'
          AND sender_agent_code IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 1`,
      [convoId]
    );
    if (rows[0]?.sender_agent_code) {
      const a = await load(rows[0].sender_agent_code);
      if (isEligibleAgent(a, channel)) {
        return { agent: a, reason: "last_agent_sender", conversationId: convoId };
      }
    }
  }

  const { rows: candidates } = await db.query(
    `SELECT * FROM agents
      WHERE org_id = $1
        AND status IN ('live', 'shadow')
        AND agent_class = 'client_facing'
        AND channel IN ('sms', 'email', 'sms_email')
        AND COALESCE(runtime, '') <> 'bland'
        AND prompt IS NOT NULL AND btrim(prompt) <> ''`,
    [orgId]
  );

  const matched = candidates.filter((a) => isEligibleAgent(a, channel));
  if (matched.length === 1) {
    return {
      agent: matched[0],
      reason: "sole_channel_match",
      conversationId: convoId || null
    };
  }
  if (matched.length === 0) {
    return { agent: null, reason: "no_eligible_agent", conversationId: convoId || null };
  }
  return {
    agent: null,
    reason: "ambiguous_agents",
    detail: matched.map((a) => a.code).join(","),
    conversationId: convoId || null
  };
}

export default selectAgent;
