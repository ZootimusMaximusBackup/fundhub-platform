/**
 * W13 read-only agent audit. No secrets. No client names/emails/phones.
 * Writes agents.json + probe.json into this folder.
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-crm-whole-2026-08-18-evidence/w13");

function loadDotEnv() {
  const p = path.join(ROOT, ".env");
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (k && process.env[k] == null) process.env[k] = v;
  }
}
loadDotEnv();

function keyPresent(name) {
  const v = process.env[name];
  return !!(v && String(v).trim());
}

const MEANT = {
  "AG-04": "Voice setter. Was meant to call leads on Bland and book a strategy call.",
  "AG-09": "Voice inquiry-removal caller. Was meant to call credit bureaus on Bland.",
  "AG-01": "Sample SMS lead follow-up (mock identity from the old screen).",
  "AG-02": "Sample email billing bot (mock identity from the old screen).",
  "AG-03": "Sample SMS nurture bot (mock identity from the old screen).",
  "AG-05": "Sample email onboarding bot (mock identity from the old screen).",
  "AG-06": "Sample internal document check (mock identity).",
  "AG-07": "Sample internal recon / watchdog (mock identity).",
  "AG-08": "Sample internal context fetcher (mock identity).",
  "OP-01": "Ops heartbeat (sample).",
  "OP-02": "Ops fixer (sample).",
  "OP-03": "Ops daily brief email (sample).",
  "OP-04": "Ops compliance gate (sample).",
  "OP-05": "Ops data + models (sample).",
  "GHL-A1": "GHL lead follow-up and booking over SMS and email.",
  "GHL-A2": "GHL billing / collections over SMS and email.",
  "GHL-A3": "GHL nurture / rebook over SMS and email.",
  "GHL-A4": "GHL pre-call reply bot (replies only).",
  "GHL-A5": "GHL onboarding and document chase over SMS and email.",
  "GHL-A7": "GHL affiliate re-engagement over SMS and email.",
  "GHL-DOC": "GHL internal document-check (JSON, not chat).",
  "GHL-RECON": "GHL internal recon watchdog (JSON, emails/texts Chris — never a client)."
};

function isEligibleMessaging(a) {
  const RUNNING = new Set(["live", "shadow"]);
  const MESSAGING = new Set(["sms", "email", "sms_email"]);
  if (!RUNNING.has(a.status)) return { ok: false, why: "status_not_running" };
  if (a.agent_class && a.agent_class !== "client_facing") return { ok: false, why: "not_client_facing" };
  if (!MESSAGING.has(a.channel)) return { ok: false, why: "channel_not_messaging" };
  if (a.runtime === "bland" || a.runtime === "ghl") return { ok: false, why: `runtime_${a.runtime}_rejected` };
  if (!a.prompt || !String(a.prompt).trim()) return { ok: false, why: "empty_prompt" };
  return { ok: true, why: "eligible" };
}

async function q(c, sql, params = []) {
  try {
    const r = await c.query(sql, params);
    return { ok: true, rows: r.rows, n: r.rowCount };
  } catch (err) {
    return { ok: false, error: String(err.message || err).slice(0, 400) };
  }
}

fs.mkdirSync(OUT, { recursive: true });

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
await c.connect();

const probe = {
  at: new Date().toISOString(),
  env_present: {
    DATABASE_URL: keyPresent("DATABASE_URL"),
    ANTHROPIC_API_KEY: keyPresent("ANTHROPIC_API_KEY"),
    BLAND_API_KEY: keyPresent("BLAND_API_KEY"),
    BLAND_WEBHOOK_SECRET: keyPresent("BLAND_WEBHOOK_SECRET"),
    INQUIRY_API_BASE: keyPresent("INQUIRY_API_BASE"),
    INQUIRY_API_SECRET: keyPresent("INQUIRY_API_SECRET"),
    INQUIRY_REMOVAL_WEBHOOK_SECRET: keyPresent("INQUIRY_REMOVAL_WEBHOOK_SECRET"),
    INNGEST_EVENT_KEY: keyPresent("INNGEST_EVENT_KEY"),
    TWILIO_ACCOUNT_SID: keyPresent("TWILIO_ACCOUNT_SID"),
    TWILIO_AUTH_TOKEN: keyPresent("TWILIO_AUTH_TOKEN")
  },
  tables: {},
  counts: {}
};

const tableNames = [
  "agents", "agent_triggers", "agent_runs", "agent_shadow_log",
  "outbound_calls", "conversations", "messages", "events",
  "inquiry_removal_cases", "messaging_settings", "v_agents_live"
];
for (const name of tableNames) {
  const r = await q(c, `
    SELECT table_type
      FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = $1
  `, [name]);
  probe.tables[name] = r.ok && r.rows[0] ? r.rows[0].table_type : "missing";
}

const agentsRes = await q(c, `
  SELECT
    code, name, agent_class, channel, status, runtime, runtime_ref,
    (runtime_notes IS NOT NULL AND btrim(runtime_notes) <> '') AS has_runtime_notes,
    (prompt IS NOT NULL AND btrim(prompt) <> '') AS has_prompt,
    length(coalesce(btrim(prompt), ''))::int AS prompt_chars,
    guardrails,
    (guardrails = '{}'::jsonb) AS guardrails_empty,
    jsonb_typeof(guardrails) AS guardrails_type,
    COALESCE(jsonb_array_length(COALESCE(guardrails->'triggers', '[]'::jsonb)), 0)::int AS editor_trigger_count,
    COALESCE(jsonb_array_length(COALESCE(trigger_events, '[]'::jsonb)), 0)::int AS ghl_trigger_count,
    booking_enabled,
    from_name IS NOT NULL AS has_from_name,
    output_schema IS NOT NULL AS has_output_schema,
    went_live_at,
    retired_at,
    sort_order,
    created_at,
    updated_at
  FROM agents
  ORDER BY sort_order, code
`);

const shadowByAgent = await q(c, `
  SELECT agent_code, reason, count(*)::int AS n,
         count(DISTINCT client_id)::int AS distinct_clients
    FROM agent_shadow_log
   GROUP BY 1, 2
   ORDER BY 1, 2
`);

const shadowTotals = await q(c, `
  SELECT agent_code, count(*)::int AS n,
         count(DISTINCT client_id)::int AS distinct_clients,
         min(created_at) AS first_at,
         max(created_at) AS last_at
    FROM agent_shadow_log
   GROUP BY 1
`);

const shadowClientIds = await q(c, `
  SELECT agent_code, client_id, count(*)::int AS n
    FROM agent_shadow_log
   WHERE client_id IS NOT NULL
   GROUP BY 1, 2
   ORDER BY 1
`);

const msgByAgent = await q(c, `
  SELECT sender_agent_code AS agent_code, status, channel, count(*)::int AS n,
         count(DISTINCT client_id)::int AS distinct_clients
    FROM messages
   WHERE sender_kind = 'agent' AND sender_agent_code IS NOT NULL
   GROUP BY 1, 2, 3
   ORDER BY 1, 2, 3
`);

const msgClientIds = await q(c, `
  SELECT sender_agent_code AS agent_code, client_id, count(*)::int AS n
    FROM messages
   WHERE sender_kind = 'agent' AND sender_agent_code IS NOT NULL
   GROUP BY 1, 2
   ORDER BY 1
`);

const convoAssign = await q(c, `
  SELECT agent_code, count(*)::int AS n,
         count(*) FILTER (WHERE agent_halted_at IS NOT NULL)::int AS halted
    FROM conversations
   WHERE agent_code IS NOT NULL
   GROUP BY 1
`);

const outbound = await q(c, `
  SELECT kind, status, count(*)::int AS n
    FROM outbound_calls
   GROUP BY 1, 2
`);

const outboundTotal = await q(c, `SELECT count(*)::int AS n FROM outbound_calls`);

const events = await q(c, `
  SELECT name, count(*)::int AS n, max(created_at) AS last_at
    FROM events
   WHERE name IN (
     'message.inbound', 'message.outbound', 'call.completed',
     'call.started', 'inquiry.removed', 'deposit.paid'
   )
   GROUP BY 1
   ORDER BY 1
`);

const eventNamesLike = await q(c, `
  SELECT name, count(*)::int AS n
    FROM events
   WHERE name ILIKE '%bland%'
      OR name ILIKE '%agent%'
      OR name ILIKE '%call%'
      OR name ILIKE '%inquiry%'
   GROUP BY 1
   ORDER BY 2 DESC
   LIMIT 40
`);

const messagingSettings = await q(c, `
  SELECT outbound_enabled
    FROM messaging_settings
   LIMIT 5
`);

const inquiryCases = await q(c, `
  SELECT
    count(*)::int AS n,
    count(*) FILTER (WHERE call_fired_at IS NOT NULL)::int AS fired,
    count(*) FILTER (WHERE status IS NOT NULL)::int AS with_status
  FROM inquiry_removal_cases
`);

const inquiryCols = await q(c, `
  SELECT column_name
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='inquiry_removal_cases'
   ORDER BY ordinal_position
`);

const liveView = await q(c, `
  SELECT code, name, status, runtime, prompt_missing, guardrails_missing, went_live_at
    FROM v_agents_live
   ORDER BY code
`);

probe.counts = {
  agents: agentsRes.ok ? agentsRes.n : null,
  agent_shadow_log_total: (await q(c, `SELECT count(*)::int AS n FROM agent_shadow_log`)).rows?.[0] || null,
  messages_sender_agent: (await q(c, `
    SELECT count(*)::int AS n FROM messages
     WHERE sender_kind = 'agent' AND sender_agent_code IS NOT NULL
  `)).rows?.[0] || null,
  outbound_calls: outboundTotal.ok ? outboundTotal.rows[0] : outboundTotal,
  conversations_with_agent: (await q(c, `
    SELECT count(*)::int AS n FROM conversations WHERE agent_code IS NOT NULL
  `)).rows?.[0] || null
};

probe.shadow_by_agent = shadowByAgent;
probe.shadow_totals = shadowTotals;
probe.shadow_client_ids = shadowClientIds;
probe.messages_by_agent = msgByAgent;
probe.message_client_ids = msgClientIds;
probe.conversations_assigned = convoAssign;
probe.outbound_calls = outbound;
probe.events_named = events;
probe.events_like = eventNamesLike;
probe.messaging_settings = messagingSettings;
probe.inquiry_cases = inquiryCases;
probe.inquiry_columns = inquiryCols.ok ? inquiryCols.rows.map((r) => r.column_name) : inquiryCols;
probe.v_agents_live = liveView;

const shadowMap = new Map();
if (shadowTotals.ok) {
  for (const r of shadowTotals.rows) shadowMap.set(r.agent_code, r);
}
const shadowReasonMap = new Map();
if (shadowByAgent.ok) {
  for (const r of shadowByAgent.rows) {
    const list = shadowReasonMap.get(r.agent_code) || [];
    list.push({ reason: r.reason, n: r.n, distinct_clients: r.distinct_clients });
    shadowReasonMap.set(r.agent_code, list);
  }
}
const shadowIdsMap = new Map();
if (shadowClientIds.ok) {
  for (const r of shadowClientIds.rows) {
    const list = shadowIdsMap.get(r.agent_code) || [];
    list.push({ client_id: r.client_id, n: r.n });
    shadowIdsMap.set(r.agent_code, list);
  }
}
const msgMap = new Map();
if (msgByAgent.ok) {
  for (const r of msgByAgent.rows) {
    const list = msgMap.get(r.agent_code) || [];
    list.push({ status: r.status, channel: r.channel, n: r.n, distinct_clients: r.distinct_clients });
    msgMap.set(r.agent_code, list);
  }
}
const msgIdsMap = new Map();
if (msgClientIds.ok) {
  for (const r of msgClientIds.rows) {
    const list = msgIdsMap.get(r.agent_code) || [];
    list.push({ client_id: r.client_id, n: r.n });
    msgIdsMap.set(r.agent_code, list);
  }
}
const convoMap = new Map();
if (convoAssign.ok) {
  for (const r of convoAssign.rows) convoMap.set(r.agent_code, r);
}

function authorityOf(guardrails) {
  const g = guardrails && typeof guardrails === "object" ? guardrails : {};
  const auth = g.authority || {};
  const esc = g.escalation || {};
  const empty = !g || Object.keys(g).length === 0;
  return {
    stored: !empty,
    block_chars: typeof g.block === "string" ? g.block.length : 0,
    discount_cap: auth.disc != null ? Number(auth.disc) : 0,
    message_cap: auth.msgcap != null ? Number(auth.msgcap) : 0,
    can_take_payment: !!auth.pay,
    can_handle_contract: !!auth.contract,
    can_book: !!auth.book,
    can_credit_pull: !!auth.pull,
    escalation_path: esc.path || null,
    escalation_after: esc.after != null ? String(esc.after) : null,
    escalation_when: esc.when || null
  };
}

const agents = [];
if (agentsRes.ok) {
  for (const a of agentsRes.rows) {
    const eligibility = isEligibleMessaging(a);
    const auth = authorityOf(a.guardrails);
    const shadow = shadowMap.get(a.code) || { n: 0, distinct_clients: 0, first_at: null, last_at: null };
    const sent = msgMap.get(a.code) || [];
    const sentN = sent.reduce((s, x) => s + x.n, 0);
    agents.push({
      code: a.code,
      name: a.name,
      status: a.status,
      agent_class: a.agent_class,
      channel: a.channel,
      runtime: a.runtime,
      runtime_ref: a.runtime_ref,
      meant_to_do: MEANT[a.code] || "Unknown — not in seed map.",
      prompt: a.has_prompt ? "y" : "n",
      prompt_chars: a.prompt_chars,
      guardrails: a.guardrails_empty ? "n" : "y",
      editor_trigger_count: a.editor_trigger_count,
      ghl_trigger_count: a.ghl_trigger_count,
      trigger_count_editor: a.editor_trigger_count,
      run_count_shadow_log: shadow.n,
      run_count_messages_sent: sentN,
      run_count_table_agent_runs: "no_table",
      ever_run: shadow.n > 0 || sentN > 0,
      shadow_reasons: shadowReasonMap.get(a.code) || [],
      shadow_client_ids: shadowIdsMap.get(a.code) || [],
      messages_sent: sent,
      message_client_ids: msgIdsMap.get(a.code) || [],
      conversations_assigned: convoMap.get(a.code) || { n: 0, halted: 0 },
      unsupervised: {
        discount: auth.stored ? auth.discount_cap : "none_stored_defaults_to_0_if_runtime_ran",
        payment: auth.can_take_payment,
        message_cap: auth.stored ? auth.message_cap : "none_stored_defaults_to_0_unlimited_if_runtime_ran",
        contract: auth.can_handle_contract,
        book: auth.can_book,
        credit_pull: auth.can_credit_pull,
        escalation_path: auth.escalation_path,
        escalation_after: auth.escalation_after
      },
      messaging_runtime_eligible: eligibility,
      booking_enabled: a.booking_enabled,
      has_from_name: a.has_from_name,
      went_live_at: a.went_live_at,
      created_at: a.created_at,
      updated_at: a.updated_at
    });
  }
}

const live = agents.filter((a) => a.status === "live");
const agentsJson = {
  at: probe.at,
  source: "live DATABASE_URL via .env; no PII",
  agent_count: agents.length,
  live_count: live.length,
  shadow_count: agents.filter((a) => a.status === "shadow").length,
  draft_count: agents.filter((a) => a.status === "draft").length,
  tables: probe.tables,
  env_present: probe.env_present,
  outbound_calls_total: probe.counts.outbound_calls,
  messaging_settings: messagingSettings.ok ? messagingSettings.rows : messagingSettings,
  inquiry_cases: inquiryCases.ok ? inquiryCases.rows : inquiryCases,
  events: events.ok ? events.rows : events,
  live_agents: live.map((a) => a.code),
  can_two_live_act_today: {
    answer: "no",
    reasons: [
      "runtime=bland is rejected by src/agents/select.mjs isEligibleAgent",
      "channel=voice is not a messaging channel; runtime only handles sms|email",
      "prompt empty — select.mjs and the candidate SQL both skip empty prompts",
      "this repo has no Bland dialer (src/ has zero api.bland.ai calls)",
      "recordDispatch is never called from production code",
      "INQUIRY_API_BASE unset means /api/inquiry returns 503 and never calls out",
      "vendor/inquiry-remover is not deployed on fundhub.ai",
      "outbound_calls count is 0; bland webhook table does not exist; no call.completed events"
    ]
  },
  agents
};

fs.writeFileSync(path.join(OUT, "agents.json"), JSON.stringify(agentsJson, null, 2));
fs.writeFileSync(path.join(OUT, "probe.json"), JSON.stringify(probe, null, 2));

await c.end();
console.log(JSON.stringify({
  wrote: ["agents.json", "probe.json"],
  agent_count: agents.length,
  live: live.map((a) => a.code),
  env_present: probe.env_present,
  outbound_calls: probe.counts.outbound_calls,
  shadow_total: probe.counts.agent_shadow_log_total,
  messages_agent: probe.counts.messages_sender_agent
}, null, 2));
