-- 142_agent_runtime.sql — tables and columns the agent runtime needs to
-- converse, attribute sends, and leave a shadow trail humans can read.
--
-- CONTEXT. Migration 114 seeded eight real GHL agent definitions (prompts,
-- from_name, booking, triggers, output_schema). Migration 134 made
-- messages.sender_kind accept 'agent'. Nothing yet selected an agent for an
-- inbound thread, recorded what a shadow run would have said, or named which
-- agent authored an outbound row. This closes those three gaps.
--
-- OWNER DECISIONS (this session, not to re-litigate):
--   1. conversations.agent_code is the sticky owner of a thread. When null,
--      the runtime falls back to the last agent sender on the thread, then to
--      a single channel-matching live|shadow messaging agent. Ambiguous
--      multi-match with no assignment → no reply (logged skip).
--   2. runtime='bland' agents stay on the external Bland path; this runtime
--      does not double-send for them.
--   3. Max permanent migration before this file was 137; t138–t141 are temp
--      peer migrations, so this takes 142 to avoid a renumber collision.

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS agent_code text,
  ADD COLUMN IF NOT EXISTS agent_halted_at timestamptz,
  ADD COLUMN IF NOT EXISTS agent_halt_reason text;

COMMENT ON COLUMN conversations.agent_code IS
  'Agent code that owns this thread for replies. NULL means unassigned; runtime resolves by last agent sender or a single channel match.';

COMMENT ON COLUMN conversations.agent_halted_at IS
  'When set, the agent runtime must not reply on this thread until a human clears it. Written on STOP-word / escalation halt.';

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS sender_agent_code text;

COMMENT ON COLUMN messages.sender_agent_code IS
  'agents.code of the author when sender_kind = agent. NULL for staff/client/system rows.';

CREATE TABLE IF NOT EXISTS agent_shadow_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  agent_code          text NOT NULL,
  client_id           uuid REFERENCES clients(id) ON DELETE SET NULL,
  conversation_id     uuid REFERENCES conversations(id) ON DELETE SET NULL,
  inbound_message_id  uuid REFERENCES messages(id) ON DELETE SET NULL,
  channel             text,
  inbound_body        text,
  would_send_body     text,
  context_snapshot    jsonb NOT NULL DEFAULT '{}'::jsonb,
  model_request       jsonb,
  reason              text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_shadow_log_org_agent
  ON agent_shadow_log (org_id, agent_code, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_shadow_log_client
  ON agent_shadow_log (client_id, created_at DESC)
  WHERE client_id IS NOT NULL;

COMMENT ON TABLE agent_shadow_log IS
  'Would-be agent replies that were not sent: status=shadow, missing ANTHROPIC_API_KEY, or a guardrail halt. Feeds AE-08 on the agent editor.';

-- Seed structured guardrails onto the GHL agents whose prompts already name
-- STOP conditions. 114 left guardrails as '{}'; empty JSON cannot enforce
-- authority caps. These values are extracted from each prompt's RULES/STOP
-- block — not invented beyond what the prompt already says.
UPDATE agents SET guardrails = v.guardrails, updated_at = now()
  FROM (VALUES
    ('GHL-A1', '{
      "block": "Never promise funding amount/approval/rate/outcome. No credit/legal/financial advice. No fees/deposits/refunds/contracts/money owed. STOP on stop/not interested, complaint, legal threat, distress.",
      "stop_words": ["stop","not interested","unsubscribe","complaint","lawsuit","attorney","lawyer","sue","legal action","distress"],
      "escalation": {"path":"halt","after":"1","when":"complaint, legal threat, distress"},
      "authority": {"disc":0,"msgcap":8,"pay":false,"contract":false,"book":true,"pull":false},
      "flags": {"noamount":true,"noscore":true,"attorney":true,"quiet":true}
    }'::jsonb),
    ('GHL-A2', '{
      "block": "Never threaten what will not happen. Never shame/harass. Never misstate balance. Never disclose debt to anyone but the client. STOP on dispute, hardship, cannot pay, refund, legal, contested amount, payment-plan request.",
      "stop_words": ["stop","dispute","hardship","cannot pay","can''t pay","refund","lawsuit","attorney","lawyer","legal","contested","payment plan","payment-plan"],
      "escalation": {"path":"halt","after":"1","when":"dispute, hardship, legal, refund"},
      "authority": {"disc":0,"msgcap":6,"pay":false,"contract":false,"book":false,"pull":false},
      "flags": {"noamount":false,"noscore":true,"attorney":true,"quiet":true}
    }'::jsonb),
    ('GHL-A3', '{
      "block": "Never promise amount/approval/rate/score/outcome beyond the record. No advice. No fees/money talk. Honor stop. STOP on complaint, dispute, legal threat, distress.",
      "stop_words": ["stop","not interested","unsubscribe","complaint","dispute","lawsuit","attorney","lawyer","legal","distress"],
      "escalation": {"path":"halt","after":"1","when":"complaint, dispute, legal, distress"},
      "authority": {"disc":0,"msgcap":6,"pay":false,"contract":false,"book":true,"pull":false},
      "flags": {"noamount":true,"noscore":true,"attorney":true,"quiet":true}
    }'::jsonb),
    ('GHL-A4', '{
      "block": "Never promise funding outcomes. No advice. No fees/money talk. STOP on complaint, legal threat, distress, or real objection that cannot be resolved.",
      "stop_words": ["stop","unsubscribe","complaint","lawsuit","attorney","lawyer","legal","distress"],
      "escalation": {"path":"halt","after":"1","when":"complaint, legal, distress"},
      "authority": {"disc":0,"msgcap":6,"pay":false,"contract":false,"book":true,"pull":false},
      "flags": {"noamount":true,"noscore":true,"attorney":true,"quiet":true}
    }'::jsonb),
    ('GHL-A5', '{
      "block": "Never write consent fields. No fee/funding/eligibility talk. No advice. STOP on money or eligibility question, complaint, or cannot help after one try.",
      "stop_words": ["stop","unsubscribe","complaint","lawsuit","attorney","lawyer","refund","how much does it cost","what do i owe","eligibility"],
      "escalation": {"path":"halt","after":"1","when":"money question, complaint"},
      "authority": {"disc":0,"msgcap":8,"pay":false,"contract":false,"book":false,"pull":false},
      "flags": {"noamount":true,"noscore":true,"attorney":true,"quiet":true}
    }'::jsonb),
    ('GHL-A7', '{
      "block": "Never invent affiliate numbers. Never change tier/ownership/downline. STOP on payout/balance dispute, tier/ownership/downline change request, or partner-manager request.",
      "stop_words": ["stop","unsubscribe","dispute","wrong balance","wrong payout","change my tier","partner manager"],
      "escalation": {"path":"halt","after":"1","when":"payout dispute, tier change, partner manager"},
      "authority": {"disc":0,"msgcap":4,"pay":false,"contract":false,"book":false,"pull":false},
      "flags": {"noamount":false,"noscore":true,"attorney":true,"quiet":true}
    }'::jsonb)
  ) AS v(code, guardrails)
 WHERE agents.code = v.code
   AND agents.guardrails = '{}'::jsonb;
