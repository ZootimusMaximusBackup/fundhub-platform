/**
 * W13R read-only: Bland prompt source vs Agent Editor save path.
 * No createCall. No UPDATE. No secrets in output. No full prompt text.
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-crm-whole-2026-08-18-evidence/w13r");

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
  return !!(process.env[name] && String(process.env[name]).trim());
}

function taskHint(task) {
  if (!task) return null;
  const s = String(task);
  if (/You are Josh/i.test(s)) return "matches_vendor_setter_josh";
  if (/calling Experian/i.test(s)) return "matches_vendor_experian";
  if (/calling Equifax/i.test(s) || /Equifax IVR/i.test(s)) return "matches_vendor_equifax";
  if (/calling TransUnion/i.test(s) || /TransUnion/i.test(s)) return "matches_vendor_transunion";
  if (/doc-chase|document/i.test(s) && /FundHub/i.test(s)) return "matches_vendor_doc_chase";
  if (/collections|past due|balance/i.test(s) && /FundHub/i.test(s)) return "matches_vendor_collections";
  return "other";
}

async function blandGet(pathname) {
  const key = process.env.BLAND_API_KEY;
  if (!key) return { ok: false, status: 0, error: "BLAND_API_KEY_missing" };
  const url = `https://api.bland.ai/v1${pathname}`;
  const resp = await fetch(url, {
    method: "GET",
    headers: { authorization: key, "Content-Type": "application/json" }
  });
  const text = await resp.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return {
    ok: resp.ok,
    status: resp.status,
    bytes: text.length,
    json
  };
}

function summarizeCall(c) {
  if (!c || typeof c !== "object") return null;
  const req = c.request_data || c.request || {};
  const task = c.task || req.task || null;
  const meta = c.metadata && typeof c.metadata === "object" ? c.metadata : {};
  return {
    call_id: c.call_id || c.c_id || null,
    created_at: c.created_at || null,
    completed: c.completed ?? null,
    status: c.status || c.queue_status || null,
    inbound: c.inbound ?? null,
    answered_by: c.answered_by || null,
    has_pathway_id: !!(c.pathway_id),
    pathway_id: c.pathway_id || null,
    pathway_version: c.pathway_version ?? null,
    has_task: !!task,
    task_chars: task ? String(task).length : 0,
    task_hint: taskHint(task),
    metadata_keys: Object.keys(meta).sort(),
    call_type: meta.call_type || meta.bureau || null,
    webhook: typeof (c.webhook || req.webhook) === "string" ? String(c.webhook || req.webhook) : null,
    has_phone: !!(c.to || req.phone_number)
  };
}

function summarizePathway(p) {
  if (!p || typeof p !== "object") return null;
  return {
    id: p.id || p.pathway_id || null,
    name: p.name || null,
    description_chars: p.description ? String(p.description).length : 0,
    node_count: Array.isArray(p.nodes) ? p.nodes.length : (p.nodes ? "present" : 0)
  };
}

function summarizeWebAgent(a) {
  if (!a || typeof a !== "object") return null;
  return {
    agent_id: a.agent_id || a.id || null,
    name: a.name || null,
    voice: a.voice || null,
    prompt_chars: a.prompt ? String(a.prompt).length : 0,
    webhook: typeof a.webhook === "string" ? a.webhook : null
  };
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

const env_present = {
  DATABASE_URL: keyPresent("DATABASE_URL"),
  BLAND_API_KEY: keyPresent("BLAND_API_KEY"),
  BLAND_WEBHOOK_SECRET: keyPresent("BLAND_WEBHOOK_SECRET"),
  INQUIRY_API_BASE: keyPresent("INQUIRY_API_BASE"),
  INQUIRY_API_SECRET: keyPresent("INQUIRY_API_SECRET")
};

const bland = {
  env_present,
  endpoints: {},
  prove_calls: {},
  recent_calls: [],
  pathways: [],
  web_agents: [],
  notes: []
};

if (!env_present.BLAND_API_KEY) {
  bland.notes.push("BLAND_API_KEY missing — Bland GET is UNVERIFIED");
} else {
  const endpoints = [
    ["/calls?limit=20", "calls"],
    ["/pathway", "pathway"],
    ["/pathways", "pathways"],
    ["/agents", "agents"],
    ["/inbound", "inbound"]
  ];
  for (const [ep, key] of endpoints) {
    const r = await blandGet(ep);
    bland.endpoints[key] = {
      path: ep,
      ok: r.ok,
      status: r.status,
      bytes: r.bytes,
      top_keys: r.json && typeof r.json === "object" ? Object.keys(r.json).slice(0, 20) : [],
      error_hint: r.ok ? null : (r.json && (r.json.errors || r.json.message || r.json.error)
        ? String(JSON.stringify(r.json.errors || r.json.message || r.json.error)).slice(0, 200)
        : `http_${r.status}`)
    };

    if (key === "calls" && r.json) {
      const list = r.json.calls || r.json.data || [];
      bland.endpoints.calls.total_count = r.json.total_count ?? r.json.count ?? list.length;
      bland.endpoints.calls.returned = Array.isArray(list) ? list.length : 0;
      if (Array.isArray(list)) {
        bland.recent_calls = list.slice(0, 20).map((c) => ({
          call_id: c.call_id || c.c_id || null,
          created_at: c.created_at || null,
          completed: c.completed ?? null,
          status: c.status || c.queue_status || null,
          inbound: c.inbound ?? null,
          answered_by: c.answered_by || null,
          has_pathway_id: !!(c.pathway_id),
          pathway_id: c.pathway_id || null
        }));
      }
    }
    if ((key === "pathway" || key === "pathways") && r.json) {
      const raw = Array.isArray(r.json) ? r.json
        : (r.json.pathways || r.json.data || r.json.pathway || []);
      if (Array.isArray(raw)) {
        bland.pathways = raw.map(summarizePathway).filter(Boolean);
        bland.endpoints[key].count = raw.length;
        bland.endpoints[key].names = bland.pathways.map((p) => ({ id: p.id, name: p.name }));
      }
    }
    if (key === "agents" && r.json) {
      const raw = Array.isArray(r.json) ? r.json : (r.json.agents || r.json.data || []);
      if (Array.isArray(raw)) {
        bland.web_agents = raw.map(summarizeWebAgent).filter(Boolean);
        bland.endpoints.agents.count = raw.length;
        bland.endpoints.agents.ids = bland.web_agents.map((a) => ({
          agent_id: a.agent_id, name: a.name, prompt_chars: a.prompt_chars
        }));
      }
    }
    if (key === "inbound" && r.json) {
      const raw = Array.isArray(r.json) ? r.json
        : (r.json.inbound || r.json.numbers || r.json.data || []);
      bland.endpoints.inbound.count = Array.isArray(raw) ? raw.length : null;
      if (Array.isArray(raw)) {
        bland.endpoints.inbound.items = raw.slice(0, 20).map((n) => ({
          id: n.id || n.inbound_id || null,
          phone_present: !!(n.phone_number || n.number),
          pathway_id: n.pathway_id || n.pathway || null,
          agent_id: n.agent_id || null,
          webhook: typeof n.webhook === "string" ? n.webhook : null
        }));
      }
    }
  }

  const proveIds = [
    "326e71c0-86f3-4c76-ba8e-de0627a9c30d",
    "823ec038-e86e-461a-b265-13009959eb8f",
    "9c6db403-8153-43c7-91ff-7382f57ab192"
  ];
  for (const id of proveIds) {
    const r = await blandGet(`/calls/${id}`);
    bland.prove_calls[id] = {
      ok: r.ok,
      status: r.status,
      summary: r.ok ? summarizeCall(r.json) : {
        error_hint: r.json && (r.json.errors || r.json.message || r.json.error)
          ? String(JSON.stringify(r.json.errors || r.json.message || r.json.error)).slice(0, 200)
          : `http_${r.status}`
      }
    };
  }

  const detailIds = bland.recent_calls.map((c) => c.call_id).filter(Boolean).slice(0, 10);
  bland.recent_call_details = [];
  for (const id of detailIds) {
    if (proveIds.includes(id)) continue;
    const r = await blandGet(`/calls/${id}`);
    if (r.ok) bland.recent_call_details.push(summarizeCall(r.json));
    else bland.recent_call_details.push({ call_id: id, ok: false, status: r.status });
  }
}

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
await c.connect();

const agents = await q(c, `
  SELECT code, name, status, agent_class, channel, runtime, runtime_ref,
         left(coalesce(runtime_notes, ''), 180) AS runtime_notes_head,
         (prompt IS NULL OR btrim(prompt) = '') AS prompt_empty,
         COALESCE(length(btrim(coalesce(prompt, ''))), 0)::int AS prompt_chars,
         (prompt ILIKE '%You are Josh%') AS prompt_looks_like_josh,
         (prompt ILIKE '%Experian%' OR prompt ILIKE '%Equifax%' OR prompt ILIKE '%TransUnion%') AS prompt_looks_like_bureau,
         (guardrails = '{}'::jsonb) AS guardrails_empty,
         jsonb_typeof(guardrails) AS guardrails_type,
         created_at, updated_at, went_live_at, retired_at, owner_label, sort_order
    FROM agents
   ORDER BY sort_order, code
`);

const saveProof = await q(c, `
  SELECT code, name, status,
         created_at, updated_at,
         (updated_at > created_at) AS updated_after_create,
         (prompt IS NULL OR btrim(prompt) = '') AS prompt_empty,
         COALESCE(length(btrim(coalesce(prompt, ''))), 0)::int AS prompt_chars,
         (guardrails = '{}'::jsonb) AS guardrails_empty
    FROM agents
   WHERE updated_at > created_at
   ORDER BY updated_at DESC
`);

const liveEmpty = await q(c, `
  SELECT code, name, status, runtime, runtime_ref, channel,
         (prompt IS NULL OR btrim(prompt) = '') AS prompt_empty,
         (guardrails = '{}'::jsonb) AS guardrails_empty,
         created_at, updated_at, went_live_at
    FROM agents
   WHERE status = 'live'
   ORDER BY code
`);

const events = await q(c, `
  SELECT name, count(*)::int AS n, max(created_at) AS last_at
    FROM events
   WHERE name IN ('call.completed', 'message.inbound')
   GROUP BY name
`);

const outbound = await q(c, `SELECT count(*)::int AS n FROM outbound_calls`);
const shadow = await q(c, `SELECT count(*)::int AS n FROM agent_shadow_log`);
const inquiryCols = await q(c, `
  SELECT column_name FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'inquiry_removal_cases'
   ORDER BY ordinal_position
`);
const inquiry = await q(c, `
  SELECT count(*)::int AS n,
         count(call_fired_at)::int AS call_fired,
         count(ai_call_status) FILTER (WHERE ai_call_status IS NOT NULL AND btrim(ai_call_status) <> '')::int AS has_ai_call_status
    FROM inquiry_removal_cases
`);

await c.end();

const db = {
  at: new Date().toISOString(),
  env_present,
  agents: agents.ok ? agents.rows : { error: agents.error },
  agent_count: agents.ok ? agents.rows.length : 0,
  save_proof_rows_updated_after_create: saveProof.ok ? saveProof.rows : { error: saveProof.error },
  live_agents: liveEmpty.ok ? liveEmpty.rows : { error: liveEmpty.error },
  events: events.ok ? events.rows : { error: events.error },
  outbound_calls: outbound.ok ? outbound.rows : { error: outbound.error },
  agent_shadow_log: shadow.ok ? shadow.rows : { error: shadow.error },
  inquiry_columns: inquiryCols.ok ? inquiryCols.rows.map((r) => r.column_name) : { error: inquiryCols.error },
  inquiry_cases: inquiry.ok ? inquiry.rows : { error: inquiry.error }
};

fs.writeFileSync(path.join(OUT, "db.json"), JSON.stringify(db, null, 2));
fs.writeFileSync(path.join(OUT, "bland-api.json"), JSON.stringify(bland, null, 2));
console.log(JSON.stringify({
  agents: db.agent_count,
  live: Array.isArray(db.live_agents) ? db.live_agents.map((a) => a.code) : db.live_agents,
  bland_calls: bland.endpoints.calls || null,
  bland_pathways: bland.pathways.length,
  bland_web_agents: bland.web_agents.length,
  prove: Object.fromEntries(Object.entries(bland.prove_calls).map(([id, v]) => [id, v.ok && v.summary ? {
    has_pathway_id: v.summary.has_pathway_id,
    has_task: v.summary.has_task,
    task_hint: v.summary.task_hint,
    task_chars: v.summary.task_chars,
    call_type: v.summary.call_type
  } : v]))
}, null, 2));
