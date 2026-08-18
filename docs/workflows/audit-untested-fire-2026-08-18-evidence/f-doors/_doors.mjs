/**
 * F-DOORS — live leftover doors. Evidence only.
 * No app/config/env edits. No Netlify INNGEST_EVENT_KEY write.
 * No vendor sandbox. No card charge. Never prints secrets.
 * Never opens / writes client 9af65808-…
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { emit } from "../../../../src/events/bus.mjs";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-untested-fire-2026-08-18-evidence/f-doors");
const BASE = "https://fundhub.ai";
const TEST = "8556bedc-46e1-4d85-b0cd-a24adfee1521";
const FORBIDDEN = "9af65808-a619-4e65-ae91-239766a006b7";
const CARD = "5410b98b-4e78-47e4-9737-b662da097740";

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
fs.mkdirSync(OUT, { recursive: true });

function present(name) {
  return Boolean(String(process.env[name] || "").trim());
}

function maskPhone(p) {
  const s = String(p || "");
  if (s.length < 4) return "[missing]";
  return `***${s.slice(-4)}`;
}

function clipBody(text, n = 400) {
  const s = String(text || "");
  return s.length <= n ? s : s.slice(0, n) + "…";
}

function redact(obj) {
  return JSON.parse(JSON.stringify(obj, (k, v) => {
    if (typeof v === "string" && /token|secret|password|authorization|key|cookie|signing/i.test(k)) {
      return `[redacted len=${v.length}]`;
    }
    if (typeof v === "string" && v.includes(FORBIDDEN)) return "[forbidden-id-stripped]";
    return v;
  }));
}

function hmacHex(secret, raw) {
  return crypto.createHmac("sha256", secret).update(raw).digest("hex");
}

async function dbq(sql, params = []) {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();
  try {
    const r = await client.query(sql, params);
    return { ok: true, n: r.rows.length, rows: r.rows };
  } catch (err) {
    return { ok: false, error: String(err.message || err).slice(0, 240) };
  } finally {
    await client.end();
  }
}

async function captureCounts() {
  return dbq(
    `SELECT provider, count(*)::int AS n
       FROM webhook_captures
      GROUP BY provider
      ORDER BY provider`
  );
}

async function postDoor(url, { body, headers = {} }) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: raw
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return {
    url: url.replace(BASE, ""),
    status: r.status,
    ok: r.ok,
    body: json ? redact(json) : { raw: clipBody(text, 240) }
  };
}

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL missing");
if (TEST === FORBIDDEN) throw new Error("TEST id collision");

const env_names = {
  DATABASE_URL: present("DATABASE_URL"),
  STAFF_E2E_PASSWORD: present("STAFF_E2E_PASSWORD"),
  BLAND_API_KEY: present("BLAND_API_KEY"),
  BLAND_WEBHOOK_SECRET: present("BLAND_WEBHOOK_SECRET"),
  POSTGRID_WEBHOOK_SECRET: present("POSTGRID_WEBHOOK_SECRET"),
  INQUIRY_API_BASE: present("INQUIRY_API_BASE"),
  INQUIRY_API_SECRET: present("INQUIRY_API_SECRET"),
  INNGEST_EVENT_KEY: present("INNGEST_EVENT_KEY"),
  INNGEST_SIGNING_KEY: present("INNGEST_SIGNING_KEY"),
  FUNDHUB_TEST_PHONE: present("FUNDHUB_TEST_PHONE"),
  netlify_inngest_key_written: false
};

fs.writeFileSync(path.join(OUT, "env-names.json"), JSON.stringify(env_names, null, 2));

const captures_before = await captureCounts();
fs.writeFileSync(path.join(OUT, "captures-before.json"), JSON.stringify({
  at: new Date().toISOString(),
  ...captures_before
}, null, 2));

const ghlBody = { e2e: true, source: "audit-fire" };
const postgridBody = { e2e: true, source: "audit-fire" };
const plaidBody = { e2e: true };
const blandUnsignedBody = { e2e: true };

const webhooks = {};

webhooks.ghl_unsigned = await postDoor(BASE + "/api/webhooks/ghl", { body: ghlBody });
webhooks.postgrid_unsigned = await postDoor(BASE + "/api/webhooks/postgrid", { body: postgridBody });
webhooks.plaid_unsigned = await postDoor(BASE + "/api/webhooks/plaid", { body: plaidBody });
webhooks.bland_unsigned = await postDoor(BASE + "/api/webhooks/bland", { body: blandUnsignedBody });

if (webhooks.postgrid_unsigned.status === 401 && present("POSTGRID_WEBHOOK_SECRET")) {
  const raw = JSON.stringify({ e2e: true, source: "audit-fire", event: "letter.updated" });
  webhooks.postgrid_signed_e2e = await postDoor(BASE + "/api/webhooks/postgrid", {
    body: raw,
    headers: { "postgrid-signature": hmacHex(process.env.POSTGRID_WEBHOOK_SECRET, raw) }
  });
}

if (webhooks.bland_unsigned.status === 401 && present("BLAND_WEBHOOK_SECRET")) {
  const raw = JSON.stringify({
    e2e: true,
    status: "queued",
    completed: false,
    source: "audit-fire"
  });
  webhooks.bland_signed_e2e = await postDoor(BASE + "/api/webhooks/bland", {
    body: raw,
    headers: { "x-bland-signature": hmacHex(process.env.BLAND_WEBHOOK_SECRET, raw) }
  });
}

if (webhooks.ghl_unsigned.status === 401) {
  webhooks.ghl_signed_note = "no GHL adapter / no env secret in router — unsigned 401, no signed retry";
}
if (webhooks.plaid_unsigned.status === 401) {
  webhooks.plaid_signed_note = "no Plaid adapter in router — unsigned 401, no signed retry";
}

const captures_after = await captureCounts();
const beforeMap = Object.fromEntries((captures_before.rows || []).map((r) => [r.provider, r.n]));
const afterMap = Object.fromEntries((captures_after.rows || []).map((r) => [r.provider, r.n]));
const providers = [...new Set([...Object.keys(beforeMap), ...Object.keys(afterMap)])].sort();
const capture_delta = providers.map((p) => ({
  provider: p,
  before: beforeMap[p] || 0,
  after: afterMap[p] || 0,
  delta: (afterMap[p] || 0) - (beforeMap[p] || 0)
}));

fs.writeFileSync(path.join(OUT, "webhooks.json"), JSON.stringify({
  at: new Date().toISOString(),
  opened_forbidden: false,
  probes: webhooks,
  capture_delta
}, null, 2));
fs.writeFileSync(path.join(OUT, "captures-after.json"), JSON.stringify({
  at: new Date().toISOString(),
  ...captures_after,
  delta: capture_delta
}, null, 2));

const loginRes = await fetch(BASE + "/api/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "chris@fundhub.ai", password: process.env.STAFF_E2E_PASSWORD })
});
const loginJson = await loginRes.json().catch(() => ({}));
const token = loginJson.token || null;

const inquiryGet = await fetch(BASE + "/api/inquiry?action=cases", {
  headers: { authorization: token ? "Bearer " + token : "", accept: "application/json" }
});
const inquiryGetJson = await inquiryGet.json().catch(() => ({}));

const inquiryLaunch = await fetch(BASE + "/api/inquiry?action=launch", {
  method: "POST",
  headers: {
    authorization: token ? "Bearer " + token : "",
    "content-type": "application/json"
  },
  body: JSON.stringify({
    e2e: true,
    source: "audit-fire",
    phone: process.env.FUNDHUB_TEST_PHONE,
    task: "This is a Fundhub e2e test. Say goodbye and hang up."
  })
});
const inquiryLaunchJson = await inquiryLaunch.json().catch(() => ({}));

const crmStartedCall = inquiryLaunch.ok && Boolean(inquiryLaunchJson.callId || inquiryLaunchJson.call_id);

const blandStart = {
  crm_door: {
    get_cases: {
      status: inquiryGet.status,
      error: inquiryGetJson.error || null,
      message: inquiryGetJson.message || null
    },
    post_launch: {
      status: inquiryLaunch.status,
      error: inquiryLaunchJson.error || null,
      message: inquiryLaunchJson.message || null,
      has_call_id: Boolean(inquiryLaunchJson.callId || inquiryLaunchJson.call_id)
    }
  },
  used_crm_launch: crmStartedCall,
  used_bland_api: false,
  phone_masked: maskPhone(process.env.FUNDHUB_TEST_PHONE),
  call_id: inquiryLaunchJson.callId || inquiryLaunchJson.call_id || null,
  error: null
};

if (!crmStartedCall) {
  if (!present("FUNDHUB_TEST_PHONE")) {
    blandStart.error = "FUNDHUB_TEST_PHONE missing — did not dial";
  } else if (!present("BLAND_API_KEY")) {
    blandStart.error = "BLAND_API_KEY missing — did not dial";
  } else {
    const blandRes = await fetch("https://api.bland.ai/v1/calls", {
      method: "POST",
      headers: {
        authorization: process.env.BLAND_API_KEY,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        phone_number: process.env.FUNDHUB_TEST_PHONE,
        task: "This is a Fundhub e2e test. Say goodbye and hang up.",
        first_sentence: "This is a Fundhub test. Goodbye.",
        max_duration: 1,
        wait_for_greeting: false,
        record: false
      })
    });
    const blandJson = await blandRes.json().catch(() => ({}));
    blandStart.used_bland_api = true;
    blandStart.bland_http = blandRes.status;
    blandStart.call_id = blandJson.call_id || blandJson.callId || null;
    blandStart.bland_status = blandJson.status || blandJson.message || null;
    blandStart.error = blandRes.ok ? null : clipBody(JSON.stringify(redact(blandJson)), 240);
  }
}

fs.writeFileSync(path.join(OUT, "bland-start.json"), JSON.stringify({
  at: new Date().toISOString(),
  ...blandStart
}, null, 2));

const events_before = await dbq(
  `SELECT name, count(*)::int AS n
     FROM events
    WHERE name = 'contract.signed'
    GROUP BY name`
);

const inngestLive = {
  fundhub_serve: null,
  runs_list: null,
  events_list: null,
  emit: null,
  event_runs: null
};

const serve = await fetch(BASE + "/api/inngest", { method: "GET" });
const serveText = await serve.text();
inngestLive.fundhub_serve = {
  method: "GET",
  url: "/api/inngest",
  status: serve.status,
  body: clipBody(serveText, 180)
};

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
  const safe = json ? {
    status: r.status,
    keys: Object.keys(json),
    data_n: Array.isArray(json.data) ? json.data.length : null,
    error: json.error || json.message || null,
    sample: Array.isArray(json.data)
      ? json.data.slice(0, 3).map((row) => ({
        id: row.id || row.run_id || null,
        status: row.status || null,
        function_id: row.function_id || row.function_id || row.function?.id || null,
        event_name: row.event_name || row.name || null
      }))
      : null
  } : { status: r.status, body: clipBody(text, 180) };
  return safe;
}

if (present("INNGEST_SIGNING_KEY")) {
  inngestLive.runs_list = await inngestApi("/v1/runs?limit=5");
  inngestLive.events_list = await inngestApi("/v1/events?limit=5");
} else {
  inngestLive.runs_list = { skipped: true, reason: "INNGEST_SIGNING_KEY absent" };
  inngestLive.events_list = { skipped: true, reason: "INNGEST_SIGNING_KEY absent" };
}

const pgClient = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
await pgClient.connect();
let emitOut = null;
try {
  emitOut = await emit(pgClient, "contract.signed", {
    e2e: true,
    source: "audit-fire",
    client_id: TEST
  }, {
    clientId: TEST,
    idempotencyKey: `audit-fire-f-doors-contract-signed-${Date.now()}`
  });
} catch (err) {
  emitOut = { error: String(err.message || err).slice(0, 220) };
}
await pgClient.end();

inngestLive.emit = {
  event: "contract.signed",
  client: TEST,
  local_event_id: emitOut && emitOut.id ? emitOut.id : null,
  deduped: emitOut && emitOut.deduped === true,
  dispatched_handlers: emitOut && emitOut.dispatched ? emitOut.dispatched : null,
  error: emitOut && emitOut.error ? emitOut.error : null,
  netlify_key_written: false,
  note: "local emit via bus; Inngest fan-out only if process INNGEST_EVENT_KEY is set. Did not write Netlify."
};

await new Promise((r) => setTimeout(r, 4000));

if (present("INNGEST_SIGNING_KEY") && emitOut && emitOut.id) {
  inngestLive.event_runs = await inngestApi(`/v1/events/${emitOut.id}/runs`);
}

const events_after = await dbq(
  `SELECT name, count(*)::int AS n
     FROM events
    WHERE name = 'contract.signed'
    GROUP BY name`
);

const events_row = emitOut && emitOut.id
  ? await dbq(
    `SELECT id, name, client_id, created_at
       FROM events
      WHERE id = $1::uuid`,
    [emitOut.id]
  )
  : { ok: false, skipped: true };

fs.writeFileSync(path.join(OUT, "jobs.json"), JSON.stringify({
  at: new Date().toISOString(),
  env_names: {
    INNGEST_EVENT_KEY: present("INNGEST_EVENT_KEY"),
    INNGEST_SIGNING_KEY: present("INNGEST_SIGNING_KEY")
  },
  netlify_inngest_key_written: false,
  contract_signed_counts: {
    before: events_before.rows,
    after: events_after.rows
  },
  local_event_row: events_row,
  inngest: inngestLive
}, null, 2));

const card_before = await dbq(
  `SELECT c.id, c.client_id, c.is_demo, ps.key AS stage, p.name AS pipeline
     FROM cards c
     JOIN pipeline_stages ps ON ps.id = c.stage_id
     JOIN pipelines p ON p.id = c.pipeline_id
    WHERE c.client_id = $1 AND c.id = $2`,
  [TEST, CARD]
);
const archive_flag_before = await dbq(
  `SELECT id, (custom_fields->>'crm_archived_at') IS NOT NULL AS archived
     FROM clients
    WHERE id = $1`,
  [TEST]
);
fs.writeFileSync(path.join(OUT, "archive-db-before.json"), JSON.stringify({
  at: new Date().toISOString(),
  card: card_before,
  client_archived: archive_flag_before
}, null, 2));

console.log(JSON.stringify({
  webhooks: Object.fromEntries(Object.entries(webhooks).map(([k, v]) => [k, v.status || v])),
  capture_delta,
  bland: {
    crm_launch: blandStart.crm_door.post_launch.status,
    used_bland_api: blandStart.used_bland_api,
    call_id: blandStart.call_id,
    error: blandStart.error
  },
  jobs: {
    serve: inngestLive.fundhub_serve.status,
    runs_list: inngestLive.runs_list && inngestLive.runs_list.status,
    local_event_id: inngestLive.emit.local_event_id
  },
  card_present: card_before.n === 1,
  opened_forbidden: false
}, null, 2));
