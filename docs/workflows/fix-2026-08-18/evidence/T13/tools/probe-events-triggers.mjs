import pg from "pg";

// Read-only. Point it at whatever database you want to inspect:
//   DATABASE_URL="postgres://..." node probe-agents.mjs
const url = process.env.DATABASE_URL;
if (!url) { console.error("Set DATABASE_URL first."); process.exit(1); }
const LOCAL = /localhost|127\.0\.0\.1/.test(url);
const c = new pg.Client({ connectionString: url, ssl: LOCAL ? false : { rejectUnauthorized: false } });
await c.connect();
const q = async (s,p=[]) => (await c.query(s,p)).rows;
const out = { captured_at:new Date().toISOString() };
out.message_inbound_events = await q(
  `SELECT id, name, created_at, jsonb_build_object(
     'has_client', (payload ? 'clientId'), 'channel', payload->>'channel',
     'keys', (SELECT jsonb_agg(k ORDER BY k) FROM jsonb_object_keys(payload) k)) AS shape
   FROM events WHERE name='message.inbound' ORDER BY created_at`);
out.event_names_recent = await q(
  `SELECT name, count(*)::int n, max(created_at) newest FROM events
   WHERE name LIKE 'message.%' OR name LIKE 'call.%' OR name LIKE 'agent.%'
   GROUP BY name ORDER BY n DESC`);
out.agents_trigger_events = await q(
  `SELECT code, status, trigger_events, jsonb_typeof(trigger_events) AS t FROM agents ORDER BY code LIMIT 25`);
out.guardrail_shapes = await q(
  `SELECT code, status, guardrails FROM agents WHERE guardrails <> '{}'::jsonb ORDER BY code LIMIT 6`);
out.draft_agents = await q(
  `SELECT code,name,status,channel,runtime,agent_class,
   (prompt IS NULL OR btrim(prompt)='') AS prompt_missing,
   length(coalesce(prompt,'')) AS prompt_len
   FROM agents WHERE status='draft' ORDER BY sort_order, code`);
console.log(JSON.stringify(out,null,2));
await c.end();
