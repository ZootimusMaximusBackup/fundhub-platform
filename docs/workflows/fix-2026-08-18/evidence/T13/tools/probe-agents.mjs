import pg from "pg";

// Read-only. Point it at whatever database you want to inspect:
//   DATABASE_URL="postgres://..." node probe-agents.mjs
const url = process.env.DATABASE_URL;
if (!url) { console.error("Set DATABASE_URL first."); process.exit(1); }
const LOCAL = /localhost|127\.0\.0\.1/.test(url);
const c = new pg.Client({ connectionString: url, ssl: LOCAL ? false : { rejectUnauthorized: false } });
await c.connect();
const q = async (sql,p=[]) => (await c.query(sql,p)).rows;
const out = { captured_at:new Date().toISOString(), source:"read-only; whatever DATABASE_URL points at" };
out.agents_by_status = await q("SELECT status, count(*)::int n FROM agents GROUP BY status ORDER BY status");
out.agents_total = (await q("SELECT count(*)::int n FROM agents"))[0].n;
out.live_and_shadow = await q(`SELECT code,name,status,channel,runtime,runtime_ref,sort_order,
  (prompt IS NULL OR btrim(prompt)='') AS prompt_missing,
  (guardrails='{}'::jsonb) AS guardrails_missing,
  (created_at=updated_at) AS never_edited, went_live_at, created_at, updated_at
  FROM agents WHERE status IN ('live','shadow') ORDER BY code`);
out.retired = await q("SELECT code,name,status,retired_at FROM agents WHERE status='retired' ORDER BY code");
out.tables_present = await q(`SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' AND table_name IN
  ('agent_triggers','agent_runs','agent_shadow_log','outbound_calls','agent_shadow_runs') ORDER BY 1`);
const has = (t) => out.tables_present.some(r=>r.table_name===t);
out.outbound_calls_rows = has('outbound_calls') ? (await q("SELECT count(*)::int n FROM outbound_calls"))[0].n : "TABLE ABSENT";
out.agent_shadow_log_rows = has('agent_shadow_log') ? (await q("SELECT count(*)::int n FROM agent_shadow_log"))[0].n : "TABLE ABSENT";
try { out.msg_inbound_events = (await q("SELECT count(*)::int n FROM events WHERE name='message.inbound'"))[0].n; }
catch(e){ out.msg_inbound_events = "ERR: "+e.message; }
try { out.messages_from_agent = (await q("SELECT count(*)::int n FROM messages WHERE sender_kind='agent'"))[0].n; }
catch(e){ out.messages_from_agent = "ERR: "+e.message; }
try { out.trigger_events_column = await q(`SELECT column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='agents' AND column_name IN ('trigger_events','runtime','runtime_ref','prompt','guardrails') ORDER BY 1`); }
catch(e){ out.trigger_events_column = "ERR: "+e.message; }
try { out.webhook_captures_bland = (await q("SELECT count(*)::int n FROM webhook_captures WHERE provider='bland'"))[0].n; }
catch(e){ out.webhook_captures_bland = "ERR: "+e.message; }
console.log(JSON.stringify(out,null,2));
await c.end();
