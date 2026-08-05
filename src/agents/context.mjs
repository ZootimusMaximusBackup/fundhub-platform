// Context fetcher — the shared memory read every agent turn uses.
//
// Master-spec §11 "shared memory" lived in GHL as contact.agent_context plus
// whatever the Conversation AI injector pulled. It was never ported. This is
// that port: one module, one shape, used by the runtime and exposed read-only
// on the client control panel so a human sees exactly what the AI sees.
//
// READ ONLY. Nothing here writes. Missing pieces stay null — never invented.

const RECENT_MESSAGE_LIMIT = 20;

const SURVEY_KEYS = [
  "how_much_funding_does_your_business_need",
  "what_will_the_funding_be_used_for",
  "what_is_your_current_credit_score",
  "cf_svy_self_reported_fico",
  "cf_svy_funding_target_amount",
  "cf_funding_scope"
];

/**
 * fetchContext(db, { orgId, clientId, conversationId?, channel?, recentLimit? })
 * → {
 *     conversation: { id, channel, summary, agent_code, agent_halted_at, agent_halt_reason, last_pulse_at } | null,
 *     recent_messages: [{ id, direction, channel, body, sender_kind, sender_agent_code, created_at }],
 *     survey: { [key]: value },
 *     client: { id, first_name, last_name, email, phone, funded, funded_amount, tags, flags },
 *     snapshot: { pipeline_stage, funding_round, fico, prequal_amount, agent_context_field, outcome_tier },
 *     as_prompt_block: string   // ready to inject under the system prompt
 *   }
 */
export async function fetchContext(db, {
  orgId, clientId, conversationId = null, channel = null, recentLimit = RECENT_MESSAGE_LIMIT
} = {}) {
  if (!orgId) throw new Error("fetchContext: orgId is required");
  if (!clientId) throw new Error("fetchContext: clientId is required");

  const [clientRes, convoRes, messagesRes, stageRes, roundRes, cfRes] = await Promise.all([
    db.query(
      `SELECT id, first_name, last_name, email, phone, funded, funded_amount,
              tags, outcome_tier, dnd_sms, dnd_email, dnd_voice
         FROM clients
        WHERE id = $1 AND org_id = $2`,
      [clientId, orgId]
    ),
    conversationId
      ? db.query(
          `SELECT id, channel, summary, agent_code, agent_halted_at, agent_halt_reason, last_pulse_at
             FROM conversations
            WHERE id = $1 AND org_id = $2 AND client_id = $3`,
          [conversationId, orgId, clientId]
        )
      : channel
        ? db.query(
            `SELECT id, channel, summary, agent_code, agent_halted_at, agent_halt_reason, last_pulse_at
               FROM conversations
              WHERE org_id = $1 AND client_id = $2 AND channel = $3
                AND COALESCE(kind, 'client') = 'client'
              LIMIT 1`,
            [orgId, clientId, channel]
          )
        : db.query(
            `SELECT id, channel, summary, agent_code, agent_halted_at, agent_halt_reason, last_pulse_at
               FROM conversations
              WHERE org_id = $1 AND client_id = $2
                AND COALESCE(kind, 'client') = 'client'
              ORDER BY last_pulse_at DESC NULLS LAST, updated_at DESC
              LIMIT 1`,
            [orgId, clientId]
          ),
    db.query(
      `SELECT id, direction, channel, rendered_body AS body, sender_kind,
              sender_agent_code, created_at, subject
         FROM messages
        WHERE org_id = $1 AND client_id = $2
          AND ($3::uuid IS NULL OR conversation_id = $3)
        ORDER BY created_at DESC
        LIMIT $4`,
      [orgId, clientId, conversationId, recentLimit]
    ),
    db.query(
      `SELECT ps.name AS stage_name, p.name AS pipeline_name
         FROM cards c
         JOIN pipeline_stages ps ON ps.id = c.stage_id
         JOIN pipelines p ON p.id = c.pipeline_id
        WHERE c.client_id = $1 AND c.org_id = $2
        ORDER BY c.updated_at DESC NULLS LAST
        LIMIT 1`,
      [clientId, orgId]
    ),
    db.query(
      `SELECT id, round_number, status, submitted_amount, approved_amount, funded_amount
         FROM funding_rounds
        WHERE client_id = $1 AND org_id = $2
        ORDER BY round_number DESC NULLS LAST, created_at DESC
        LIMIT 1`,
      [clientId, orgId]
    ),
    db.query(
      `SELECT agent_context, crs_fico_score, primary_fico_score,
              analyzer_prequal_amount, cf_reanalyzer_prequal_amount,
              total_funding_estimate, funding_round_number, funding_fico_band,
              how_much_funding_does_your_business_need,
              what_will_the_funding_be_used_for,
              what_is_your_current_credit_score,
              cf_svy_self_reported_fico, cf_svy_funding_target_amount,
              cf_funding_scope, employee_next_action, analyzer_path_raw
         FROM client_custom_fields
        WHERE client_id = $1 AND org_id = $2`,
      [clientId, orgId]
    )
  ]);

  const clientRow = clientRes.rows[0] || null;
  const cf = cfRes.rows[0] || {};
  const convo = convoRes.rows[0] || null;
  const recent = (messagesRes.rows || []).slice().reverse();

  const survey = {};
  for (const key of SURVEY_KEYS) {
    if (cf[key] != null && cf[key] !== "") survey[key] = cf[key];
  }

  const fico = cf.crs_fico_score ?? cf.primary_fico_score ?? null;
  const prequal = cf.analyzer_prequal_amount
    || cf.cf_reanalyzer_prequal_amount
    || cf.total_funding_estimate
    || null;

  const stage = stageRes.rows[0] || null;
  const round = roundRes.rows[0] || null;

  const snapshot = {
    pipeline_stage: stage
      ? { pipeline: stage.pipeline_name, stage: stage.stage_name }
      : null,
    funding_round: round
      ? {
          id: round.id,
          number: round.round_number ?? cf.funding_round_number ?? null,
          status: round.status || null,
          submitted_amount: round.submitted_amount ?? null,
          approved_amount: round.approved_amount ?? null,
          funded_amount: round.funded_amount ?? null
        }
      : (cf.funding_round_number != null
        ? { id: null, number: cf.funding_round_number, status: null,
            submitted_amount: null, approved_amount: null, funded_amount: null }
        : null),
    fico: fico != null ? Number(fico) : null,
    fico_band: cf.funding_fico_band || null,
    prequal_amount: prequal,
    agent_context_field: cf.agent_context || null,
    outcome_tier: clientRow?.outcome_tier || null,
    analyzer_path: cf.analyzer_path_raw || null,
    employee_next_action: cf.employee_next_action || null
  };

  const context = {
    conversation: convo
      ? {
          id: convo.id,
          channel: convo.channel,
          summary: convo.summary || null,
          agent_code: convo.agent_code || null,
          agent_halted_at: convo.agent_halted_at || null,
          agent_halt_reason: convo.agent_halt_reason || null,
          last_pulse_at: convo.last_pulse_at || null
        }
      : null,
    recent_messages: recent.map((m) => ({
      id: m.id,
      direction: m.direction,
      channel: m.channel,
      body: m.body,
      subject: m.subject || null,
      sender_kind: m.sender_kind || null,
      sender_agent_code: m.sender_agent_code || null,
      created_at: m.created_at
    })),
    survey,
    client: clientRow
      ? {
          id: clientRow.id,
          first_name: clientRow.first_name,
          last_name: clientRow.last_name,
          email: clientRow.email,
          phone: clientRow.phone,
          funded: clientRow.funded,
          funded_amount: clientRow.funded_amount,
          tags: clientRow.tags || [],
          flags: {
            dnd_sms: !!clientRow.dnd_sms,
            dnd_email: !!clientRow.dnd_email,
            dnd_voice: !!clientRow.dnd_voice
          }
        }
      : null,
    snapshot
  };

  context.as_prompt_block = formatPromptBlock(context);
  return context;
}

/* formatPromptBlock — compact text the model reads. Nulls omitted so the
   model is not told "unknown" for facts we do not have. */
export function formatPromptBlock(ctx) {
  const lines = ["CLIENT CONTEXT (read-only facts; do not invent missing values)"];
  const c = ctx.client;
  if (c) {
    const name = [c.first_name, c.last_name].filter(Boolean).join(" ");
    if (name) lines.push(`Name: ${name}`);
    if (c.email) lines.push(`Email: ${c.email}`);
    if (c.phone) lines.push(`Phone: ${c.phone}`);
    if (c.funded) lines.push(`Funded: yes${c.funded_amount != null ? ` (${c.funded_amount})` : ""}`);
    if (c.tags?.length) lines.push(`Tags: ${c.tags.join(", ")}`);
  }
  const s = ctx.snapshot || {};
  if (s.pipeline_stage) {
    lines.push(`Pipeline: ${s.pipeline_stage.pipeline} / ${s.pipeline_stage.stage}`);
  }
  if (s.funding_round) {
    lines.push(
      `Funding round: #${s.funding_round.number ?? "?"}` +
      (s.funding_round.status ? ` (${s.funding_round.status})` : "")
    );
  }
  if (s.fico != null) lines.push(`FICO: ${s.fico}`);
  if (s.fico_band) lines.push(`FICO band: ${s.fico_band}`);
  if (s.prequal_amount) lines.push(`Prequal: ${s.prequal_amount}`);
  if (s.outcome_tier) lines.push(`Outcome tier: ${s.outcome_tier}`);
  if (s.analyzer_path) lines.push(`Analyzer path: ${s.analyzer_path}`);
  if (s.employee_next_action) lines.push(`Employee next action: ${s.employee_next_action}`);
  if (s.agent_context_field) {
    lines.push("Stored agent context:");
    lines.push(String(s.agent_context_field).slice(0, 2000));
  }
  const surveyKeys = Object.keys(ctx.survey || {});
  if (surveyKeys.length) {
    lines.push("Survey answers:");
    for (const k of surveyKeys) lines.push(`  - ${k}: ${ctx.survey[k]}`);
  }
  if (ctx.conversation?.summary) {
    lines.push(`Conversation summary: ${ctx.conversation.summary}`);
  }
  if (ctx.recent_messages?.length) {
    lines.push("Recent messages (oldest first):");
    for (const m of ctx.recent_messages) {
      const who = m.direction === "inbound"
        ? "CLIENT"
        : (m.sender_kind === "agent"
          ? `AGENT(${m.sender_agent_code || "?"})`
          : (m.sender_kind || "OUTBOUND").toUpperCase());
      lines.push(`  [${who}] ${(m.body || "").slice(0, 500)}`);
    }
  }
  return lines.join("\n");
}

export default fetchContext;
