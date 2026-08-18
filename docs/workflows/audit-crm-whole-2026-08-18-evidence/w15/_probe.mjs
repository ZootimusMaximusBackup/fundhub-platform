#!/usr/bin/env node
/**
 * W15 read-only probe. Never prints secrets. Never POST/PUT/PATCH/DELETE to GHL.
 * Writes probe.json next to this file.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dir = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = "/Users/zootimusmaximus/fundhub-platform/.env";

function loadEnv(path) {
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const s = line.trim();
    if (!s || s.startsWith("#") || !s.includes("=")) continue;
    const i = s.indexOf("=");
    out[s.slice(0, i).trim()] = s.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
  }
  return out;
}

const env = loadEnv(ENV_PATH);
const loc = env.GHL_LOCATION_ID || env.GHL_LOCATION || "ORh91GeY4acceSASSnLR";
const ghlKey = env.GHL_API_KEY || env.GHL_RELAY_API_KEY || "";
const keyNameUsed = env.GHL_API_KEY ? "GHL_API_KEY" : env.GHL_RELAY_API_KEY ? "GHL_RELAY_API_KEY" : null;
const BASE = "https://services.leadconnectorhq.com";
const VERSION = "2021-07-28";

const report = {
  at: new Date().toISOString(),
  env_names: {
    GHL_API_KEY: Boolean(env.GHL_API_KEY),
    GHL_RELAY_API_KEY: Boolean(env.GHL_RELAY_API_KEY),
    GHL_LOCATION_ID: Boolean(env.GHL_LOCATION_ID),
    GHL_LOCATION: Boolean(env.GHL_LOCATION),
    GHL_PRIVATE_API_KEY: Boolean(env.GHL_PRIVATE_API_KEY),
    TWILIO_ACCOUNT_SID: Boolean(env.TWILIO_ACCOUNT_SID),
    TWILIO_SEND_ACCOUNT_SID: Boolean(env.TWILIO_SEND_ACCOUNT_SID),
    TWILIO_SEND_FROM: Boolean(env.TWILIO_SEND_FROM),
    TWILIO_TRUSTHUB_BUNDLE_SID: Boolean(env.TWILIO_TRUSTHUB_BUNDLE_SID),
    TWILIO_AUTH_TOKEN: Boolean(env.TWILIO_AUTH_TOKEN),
    TWILIO_SEND_AUTH_TOKEN: Boolean(env.TWILIO_SEND_AUTH_TOKEN),
    TWILIO_API_KEY: Boolean(env.TWILIO_API_KEY),
    TWILIO_API_SECRET: Boolean(env.TWILIO_API_SECRET),
    DATABASE_URL: Boolean(env.DATABASE_URL)
  },
  ghl_key_name_used: keyNameUsed,
  location_id_source: env.GHL_LOCATION_ID
    ? "GHL_LOCATION_ID"
    : env.GHL_LOCATION
      ? "GHL_LOCATION"
      : "repo_hardcoded_ORh91GeY4acceSASSnLR",
  location_id: loc,
  ghl: {},
  twilio: {},
  db: {}
};

async function ghlGet(path) {
  const url = `${BASE}${path}`;
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${ghlKey}`,
        Version: VERSION,
        Accept: "application/json"
      }
    });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { body = null; }
    const snippet = text.slice(0, 240).replace(/[A-Za-z0-9_\-]{20,}/g, "[redacted]");
    return {
      url_path: path,
      status: res.status,
      ok: res.ok,
      ms: Date.now() - started,
      keys: body && typeof body === "object" ? Object.keys(body) : [],
      error: body && (body.message || body.error || body.msg) || null,
      snippet: res.ok ? undefined : snippet
    };
  } catch (err) {
    return { url_path: path, status: 0, ok: false, error: String(err && err.message || err) };
  }
}

function summarizeWorkflows(body) {
  const list = body?.workflows || body?.data || (Array.isArray(body) ? body : []);
  if (!Array.isArray(list)) return { count: 0, items: [] };
  return {
    count: list.length,
    items: list.map((w) => ({
      id: w.id || w._id || null,
      name: w.name || w.title || null,
      status: w.status || w.state || null,
      deleted: w.deleted ?? null,
      updatedAt: w.updatedAt || w.dateUpdated || null
    }))
  };
}

function summarizeFields(body) {
  const list = body?.customFields || body?.customField || body?.fields || [];
  if (!Array.isArray(list)) return { count: 0, items: [] };
  return {
    count: list.length,
    items: list.map((f) => ({
      id: f.id || null,
      name: f.name || null,
      fieldKey: f.fieldKey || f.field_key || null,
      dataType: f.dataType || f.data_type || null
    }))
  };
}

function summarizePipelines(body) {
  const list = body?.pipelines || body?.data || [];
  if (!Array.isArray(list)) return { count: 0, items: [] };
  return {
    count: list.length,
    items: list.map((p) => ({
      id: p.id || null,
      name: p.name || null,
      stages: Array.isArray(p.stages)
        ? p.stages.map((s) => ({ id: s.id || null, name: s.name || null }))
        : []
    }))
  };
}

async function probeGhl() {
  if (!ghlKey) {
    report.ghl.error = "no_ghl_key_in_local_env";
    return;
  }
  const paths = [
    `/locations/${loc}`,
    `/locations/search?limit=1`,
    `/workflows/?locationId=${loc}`,
    `/locations/${loc}/workflows`,
    `/locations/${loc}/customFields`,
    `/custom-fields?locationId=${loc}`,
    `/opportunities/pipelines?locationId=${loc}`,
    `/hooks/?locationId=${loc}`,
    `/locations/${loc}/webhooks`,
    `/webhooks/?locationId=${loc}`
  ];
  report.ghl.calls = [];
  for (const p of paths) {
    const r = await ghlGet(p);
    report.ghl.calls.push(r);
  }
  const wfCall = report.ghl.calls.find((c) => c.url_path.startsWith("/workflows/") && c.ok);
  if (wfCall) {
    const res = await fetch(`${BASE}${wfCall.url_path}`, {
      headers: { Authorization: `Bearer ${ghlKey}`, Version: VERSION, Accept: "application/json" }
    });
    report.ghl.workflows = summarizeWorkflows(await res.json());
  }
  const cfCall = report.ghl.calls.find((c) => c.url_path.includes("customFields") && c.ok);
  if (cfCall) {
    const res = await fetch(`${BASE}${cfCall.url_path}`, {
      headers: { Authorization: `Bearer ${ghlKey}`, Version: VERSION, Accept: "application/json" }
    });
    report.ghl.custom_fields = summarizeFields(await res.json());
  }
  const pipeCall = report.ghl.calls.find((c) => c.url_path.includes("pipelines") && c.ok);
  if (pipeCall) {
    const res = await fetch(`${BASE}${pipeCall.url_path}`, {
      headers: { Authorization: `Bearer ${ghlKey}`, Version: VERSION, Accept: "application/json" }
    });
    report.ghl.pipelines = summarizePipelines(await res.json());
  }
}

async function probeTwilio() {
  const sid = env.TWILIO_ACCOUNT_SID || env.TWILIO_SEND_ACCOUNT_SID || "";
  const token = env.TWILIO_AUTH_TOKEN || env.TWILIO_SEND_AUTH_TOKEN || "";
  const bundle = env.TWILIO_TRUSTHUB_BUNDLE_SID || "";
  report.twilio.can_auth = Boolean(sid && token);
  report.twilio.has_bundle_sid = Boolean(bundle);
  report.twilio.has_from = Boolean(env.TWILIO_SEND_FROM);
  if (!sid || !token) {
    report.twilio.error = "missing_twilio_auth_token_in_local_env";
    return;
  }
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  async function twilioGet(url) {
    try {
      const res = await fetch(url, { headers: { Authorization: `Basic ${auth}`, Accept: "application/json" } });
      const text = await res.text();
      let body = null;
      try { body = JSON.parse(text); } catch { body = null; }
      return {
        url: url.replace(sid, "[sid]").replace(bundle, "[bundle]"),
        status: res.status,
        ok: res.ok,
        keys: body && typeof body === "object" ? Object.keys(body) : [],
        error: body && (body.message || body.error_message) || null
      };
    } catch (err) {
      return { url, status: 0, ok: false, error: String(err && err.message || err) };
    }
  }
  report.twilio.calls = [
    await twilioGet(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`),
    await twilioGet("https://messaging.twilio.com/v1/Services"),
    await twilioGet("https://messaging.twilio.com/v1/a2p/BrandRegistrations"),
    bundle
      ? await twilioGet(`https://trusthub.twilio.com/v1/TrustProducts/${bundle}`)
      : { skipped: true, reason: "no_bundle_sid" }
  ];
}

async function probeDb() {
  if (!env.DATABASE_URL) {
    report.db.error = "no_database_url";
    return;
  }
  const client = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const q = async (sql) => {
    const { rows } = await client.query(sql);
    return rows;
  };
  report.db.ghl_contact_ids = await q(`
    SELECT
      count(*)::int AS clients,
      count(ghl_contact_id)::int AS with_ghl_id,
      count(*) FILTER (WHERE ghl_contact_id IS NULL)::int AS without_ghl_id,
      count(*) FILTER (WHERE custom_fields IS NULL OR custom_fields = '{}'::jsonb)::int AS empty_custom_fields
    FROM clients
  `);
  report.db.webhook_captures = await q(`
    SELECT provider, count(*)::int AS n, max(created_at) AS last_at
    FROM webhook_captures GROUP BY 1 ORDER BY 2 DESC
  `);
  report.db.routing = await q(`
    SELECT channel, provider, enabled FROM message_channel_routing ORDER BY channel
  `);
  report.db.pipelines = await q(`
    SELECT p.key AS pipeline_key, p.name AS pipeline_name,
           s.key AS stage_key, s.name AS stage_name, s.sort_order
    FROM pipelines p
    JOIN pipeline_stages s ON s.pipeline_id = p.id
    ORDER BY p.key, s.sort_order
  `);
  report.db.custom_field_keys = await q(`
    SELECT k AS key, count(*)::int AS clients_with_key
    FROM clients c
    CROSS JOIN LATERAL jsonb_object_keys(COALESCE(c.custom_fields, '{}'::jsonb)) k
    GROUP BY 1
    ORDER BY 2 DESC, 1
    LIMIT 80
  `);
  report.db.typed_custom_field_rows = await q(`
    SELECT count(*)::int AS n FROM client_custom_fields
  `);
  report.db.events_ghlish = await q(`
    SELECT name, count(*)::int AS n, max(created_at) AS last_at
    FROM events
    WHERE name ILIKE '%ghl%' OR name ILIKE '%inquiry.removed%' OR name ILIKE '%inquiry_removal%'
    GROUP BY 1 ORDER BY 2 DESC LIMIT 20
  `);
  await client.end();
}

await probeGhl();
await probeTwilio();
await probeDb();

writeFileSync(join(__dir, "probe.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  wrote: "probe.json",
  ghl_calls: (report.ghl.calls || []).map((c) => `${c.status} ${c.url_path}`),
  twilio_auth: report.twilio.can_auth,
  db_ok: !report.db.error
}, null, 2));
