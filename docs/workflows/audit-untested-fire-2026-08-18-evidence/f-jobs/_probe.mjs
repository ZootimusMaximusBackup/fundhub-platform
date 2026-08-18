/**
 * F-JOBS: prove whether Inngest has run rows for tonight's fires,
 * and whether live emit reached Inngest. Read-only except one already-sent ping lookup.
 * Never prints secrets. Never opens the live credit file.
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-untested-fire-2026-08-18-evidence/f-jobs");
const TEST = "8556bedc-46e1-4d85-b0cd-a24adfee1521";
const FUNNEL = "edca0767-88e9-4cf4-8837-47382049503a";
const LIVE = "9af65808-a619-4e65-ae91-239766a006b7";
const PING_ID = "01M0BDM893W140KNYZ1XBYQYZA";
const WATCH = [
  "inquiry.removed",
  "booking.created",
  "message.inbound",
  "fundhub/e2e.ping",
  "contract.signed"
];
const WATCH_FNS = [
  "c-03-inquiry-removed-resume-or-hold",
  "s-04-call-booked",
  "s-04b-booking-reminders",
  "bs-01-precall-launcher",
  "dpc-03-inbound-reply-router",
  "message-dispatch-sweeper"
];

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

function present(name) {
  return Boolean(String(process.env[name] || "").trim());
}

function slimEvent(row) {
  return {
    id: row.id || row.internal_id || null,
    name: row.name || row.event_name || null,
    received: row.received_at || row.ts || row.created_at || null
  };
}

function slimRun(row) {
  return {
    id: row.run_id || row.id || null,
    status: row.status || null,
    function_id: row.function_id || row.function?.id || null,
    started: row.started_at || row.run_started_at || null,
    ended: row.ended_at || row.ended || null
  };
}

async function inngestApi(pathname) {
  const r = await fetch("https://api.inngest.com" + pathname, {
    headers: {
      authorization: "Bearer " + (process.env.INNGEST_SIGNING_KEY || ""),
      accept: "application/json"
    }
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  const data = json && Array.isArray(json.data) ? json.data : [];
  return {
    path: pathname,
    status: r.status,
    keys: json ? Object.keys(json) : [],
    data_n: json && Array.isArray(json.data) ? json.data.length : null,
    error: (json && (json.error || json.message)) || null,
    page: json && json.page ? { has_more: json.page.has_more || json.page.hasMore || null } : null,
    events: data.map(slimEvent),
    runs: data.map(slimRun),
    raw_clip: json ? null : String(text || "").slice(0, 160)
  };
}

async function inngestPages(pathname, { maxPages = 8, pageParam = "cursor" } = {}) {
  const pages = [];
  let path = pathname;
  for (let i = 0; i < maxPages; i++) {
    const page = await inngestApi(path);
    pages.push({ status: page.status, data_n: page.data_n, error: page.error, page: page.page });
    if (page.status !== 200) break;
    if (!page.page || !page.page.has_more) break;
    // unknown cursor shape — stop rather than guess
    break;
  }
  return pages;
}

const out = {
  at: new Date().toISOString(),
  env_names: {
    INNGEST_EVENT_KEY: present("INNGEST_EVENT_KEY"),
    INNGEST_SIGNING_KEY: present("INNGEST_SIGNING_KEY"),
    DATABASE_URL: present("DATABASE_URL"),
    STAFF_E2E_PASSWORD: present("STAFF_E2E_PASSWORD")
  },
  netlify: {
    keys_set_this_session: true,
    local_cli_deploy_failed: true,
    local_cli_fail_reason: "build.command migrate ENOTFOUND base",
    cloud_trigger_deploy: "6a84d3bba08d3e85dc48dfd5"
  },
  ping: { id: PING_ID },
  live_guard: { opened_live: false, live_id: LIVE }
};

out.probes = {
  v1_events: await inngestApi("/v1/events?limit=100"),
  v2_runs: await inngestApi("/v2/runs?limit=50"),
  ping_get: await inngestApi("/v1/events/" + PING_ID),
  ping_runs: await inngestApi("/v1/events/" + PING_ID + "/runs")
};

const eventNames = {};
for (const ev of out.probes.v1_events.events || []) {
  const n = ev.name || "(none)";
  eventNames[n] = (eventNames[n] || 0) + 1;
}
out.event_name_counts = eventNames;
out.watched_events_in_list = (out.probes.v1_events.events || []).filter((e) => WATCH.includes(e.name));

const fnCounts = {};
const fnStatus = {};
for (const run of out.probes.v2_runs.runs || []) {
  const id = run.function_id || "(none)";
  fnCounts[id] = (fnCounts[id] || 0) + 1;
  fnStatus[id] = fnStatus[id] || {};
  const st = run.status || "UNKNOWN";
  fnStatus[id][st] = (fnStatus[id][st] || 0) + 1;
}
out.run_function_counts = fnCounts;
out.run_function_status = fnStatus;
out.watched_runs = (out.probes.v2_runs.runs || []).filter((r) => WATCH_FNS.includes(r.function_id));

// Look up recent finished events' names more carefully from first 15 ids
out.event_gets = [];
for (const ev of (out.probes.v1_events.events || []).slice(0, 15)) {
  if (!ev.id) continue;
  const got = await inngestApi("/v1/events/" + ev.id);
  out.event_gets.push({
    id: ev.id,
    list_name: ev.name,
    get_status: got.status,
    get_keys: got.keys,
    get_name: got.events[0]?.name || null
  });
}

const login = await fetch("https://fundhub.ai/api/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "chris@fundhub.ai", password: process.env.STAFF_E2E_PASSWORD })
});
const loginJson = await login.json().catch(() => ({}));
const token = loginJson.token || loginJson.access_token || null;
out.login = { status: login.status, ok: login.ok, has_token: Boolean(token) };

if (token) {
  const wf = await fetch("https://fundhub.ai/api/read/workflows?limit=100&offset=0", {
    headers: { authorization: "Bearer " + token, accept: "application/json" }
  });
  const wj = await wf.json().catch(() => ({}));
  const items = wj.items || wj.workflows || wj.rows || [];
  const pick = items
    .filter((x) => WATCH_FNS.includes(x.id) || (x.events || []).some((e) => WATCH.includes(e)))
    .map((x) => ({
      id: x.id,
      status: x.status,
      engine_active: x.engine_active,
      last_triggered_at: x.last_triggered_at || null,
      events: x.events || []
    }));
  const statusCounts = {};
  for (const x of items) {
    const st = x.status || "(none)";
    statusCounts[st] = (statusCounts[st] || 0) + 1;
  }
  out.workflows = {
    status: wf.status,
    count: items.length,
    status_counts: statusCounts,
    watched: pick,
    never_triggered: items.filter((x) => x.status === "never_triggered").map((x) => x.id)
  };
}

// DB: our events table for tonight's fires
if (present("DATABASE_URL")) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    const q = async (sql, params) => {
      const r = await client.query(sql, params);
      return r.rows;
    };
    out.db = {
      inquiry_removed: await q(
        `SELECT id, name, client_id, created_at
         FROM events WHERE name = 'inquiry.removed'
         ORDER BY created_at DESC LIMIT 5`
      ),
      booking_created_funnel: await q(
        `SELECT id, name, client_id, created_at
         FROM events WHERE name = 'booking.created' AND client_id = $1
         ORDER BY created_at DESC LIMIT 3`,
        [FUNNEL]
      ),
      message_inbound_test: await q(
        `SELECT id, name, client_id, created_at
         FROM events WHERE name = 'message.inbound' AND client_id = $1
         ORDER BY created_at DESC LIMIT 5`,
        [TEST]
      ),
      live_events_touched: await q(
        `SELECT COUNT(*)::int AS n FROM events WHERE client_id = $1`,
        [LIVE]
      ),
      c03_task: await q(
        `SELECT id, title, source_workflow, created_at
         FROM tasks
         WHERE client_id = $1 AND title ILIKE '%next funding round%'
         ORDER BY created_at DESC LIMIT 3`,
        [TEST]
      )
    };
    // redact client ids that are live
    for (const key of Object.keys(out.db)) {
      if (!Array.isArray(out.db[key])) continue;
      out.db[key] = out.db[key].map((row) => ({
        ...row,
        client_id: row.client_id === LIVE ? "LIVE_BLOCKED" : row.client_id
      }));
    }
  } catch (err) {
    out.db = { ok: false, error: String(err.message || err).slice(0, 220) };
  } finally {
    try { await client.end(); } catch { /* ignore */ }
  }
} else {
  out.db = { skipped: true, reason: "DATABASE_URL absent" };
}

// strip bulky raw lists from probes (keep counts + watched)
out.probes.v1_events.events = out.watched_events_in_list;
out.probes.v2_runs.runs = (out.probes.v2_runs.runs || []).slice(0, 20);

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "probe.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify({
  at: out.at,
  login: out.login,
  event_name_counts: out.event_name_counts,
  watched_events_n: out.watched_events_in_list.length,
  run_function_counts: out.run_function_counts,
  watched_runs_n: out.watched_runs.length,
  ping_get: { status: out.probes.ping_get.status, keys: out.probes.ping_get.keys },
  ping_runs: { status: out.probes.ping_runs.status, data_n: out.probes.ping_runs.data_n },
  workflows_never: out.workflows && out.workflows.never_triggered,
  workflows_watched: out.workflows && out.workflows.watched,
  db_ok: Boolean(out.db) && out.db.ok !== false && !out.db.skipped,
  db_error: out.db && out.db.error,
  inquiry_n: out.db && Array.isArray(out.db.inquiry_removed) ? out.db.inquiry_removed.length : null
}, null, 2));
