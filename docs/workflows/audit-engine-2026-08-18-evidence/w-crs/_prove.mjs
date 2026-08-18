// W-CRS — feed simulated crs_results.result through emitCrsResult().
// Findings only. Writes evidence under w-crs/. Does not teardown.
// Does not set CRS_ALLOW_LIVE or INNGEST_EVENT_KEY.

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-engine-2026-08-18-evidence/w-crs");
const CLIENT_ID = "41a3199f-1835-4ac8-91c0-d4f37bd92037";
const CRS_ID = "c1f83e6b-a624-4f28-a32a-531a530b3ad4";
const ORG_ID = "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6";
const FORBIDDEN = "9af65808-a619-4e65-ae91-239766a006b7";
const COMPARE = "8556bedc-46e1-4d85-b0cd-a24adfee1521";

function loadDotEnv() {
  const p = path.join(ROOT, ".env");
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (k && process.env[k] == null) process.env[k] = v;
  }
}
loadDotEnv();

// Hard stop: never turn these on for this audit.
delete process.env.INNGEST_EVENT_KEY;
delete process.env.CRS_ALLOW_LIVE;
process.env.INNGEST_EVENT_KEY = "";
process.env.CRS_ALLOW_LIVE = "";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL missing");
if (CLIENT_ID === FORBIDDEN || CLIENT_ID === COMPARE) throw new Error("refusing forbidden/compare id");

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(path.join(OUT, "dumps"), { recursive: true });

function dbClient() {
  return new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
}

async function withDb(fn) {
  const c = dbClient();
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

function write(name, obj) {
  const p = path.join(OUT, name);
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
  return name;
}

function pickCf(cf, keys) {
  const out = {};
  for (const k of keys) out[k] = cf && Object.prototype.hasOwnProperty.call(cf, k) ? cf[k] : null;
  return out;
}

const CF_KEYS = [
  "total_funding_estimate",
  "analyzer_prequal_amount",
  "crs_fico_score",
  "crs_utilization_percent",
  "credit_score",
  "utilization_pct",
  "primary_fico_score",
  "primary_utilization_percent",
  "analyzer_score",
  "utilization",
  "funding_letters_delivered_event_id"
];

function clientSnap(row) {
  if (!row) return null;
  const cf = row.custom_fields || {};
  return {
    id: row.id,
    org_id: row.org_id,
    email: row.email,
    is_demo: row.is_demo,
    outcome_tier: row.outcome_tier,
    tags: row.tags,
    funded: row.funded,
    funded_amount: row.funded_amount,
    updated_at: row.updated_at,
    custom_fields_keys: Object.keys(cf).sort(),
    score_util_estimate_fields: pickCf(cf, CF_KEYS)
  };
}

function crsShape(result) {
  if (!result || typeof result !== "object") return { type: typeof result };
  return {
    top_keys: Object.keys(result).sort(),
    outcome: result.outcome ?? null,
    reason_codes: result.reason_codes ?? null,
    preapprovals: result.preapprovals ?? null,
    consumerSignals_scores: result.consumerSignals?.scores ?? null,
    consumerSignals_utilization: result.consumerSignals?.utilization ?? null,
    crm_payload_scores: result.crm_payload?.scores ?? null,
    crm_payload_estimate: result.crm_payload?.customFields?.total_funding_estimate ?? null,
    crm_payload_util: result.crm_payload?.customFields?.crs_utilization ?? null,
    top_level_scores: result.scores ?? null,
    top_level_utilization: result.utilization ?? null,
    top_level_source: result.source ?? null,
    tradeline_count: Array.isArray(result.tradelines) ? result.tradelines.length : null
  };
}

async function main() {
  const { registerAll } = await import(path.join(ROOT, "src/register-all.mjs"));
  const { emitCrsResult, normalizeCrsResult, mapToCanonical } = await import(path.join(ROOT, "src/adapters/crs.mjs"));
  const { getHandlers } = await import(path.join(ROOT, "src/events/registry.mjs"));
  const { handle: c06Handle } = await import(path.join(ROOT, "src/workflows/c-06-crs-results-router.mjs"));
  const { fakeStep } = await import(path.join(ROOT, "src/workflows/test-support.mjs"));
  const { buildLetterPackForClient } = await import(path.join(ROOT, "src/underwrite/letter-pack.mjs"));

  // --- 1. Load crs_results.result ---
  const before = await withDb(async (c) => {
    const cols = (await c.query(
      `SELECT column_name, data_type
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'clients'
          AND (
            column_name ILIKE '%score%'
            OR column_name ILIKE '%util%'
            OR column_name ILIKE '%fund%'
            OR column_name ILIKE '%estimate%'
            OR column_name IN ('outcome_tier','custom_fields','tags','funded','funded_amount')
          )
        ORDER BY column_name`
    )).rows;
    const client = (await c.query(
      `SELECT id, org_id, email, is_demo, outcome_tier, tags, funded, funded_amount,
              custom_fields, updated_at
         FROM clients WHERE id = $1`,
      [CLIENT_ID]
    )).rows[0] || null;
    const crs = (await c.query(
      `SELECT id, org_id, client_id, outcome_tier, result, created_at, updated_at
         FROM crs_results WHERE id = $1`,
      [CRS_ID]
    )).rows[0] || null;
    const eventsBefore = (await c.query(
      `SELECT id, name, client_id, org_id, idempotency_key, created_at
         FROM events WHERE client_id = $1 ORDER BY created_at ASC`,
      [CLIENT_ID]
    )).rows;
    const cardsBefore = (await c.query(
      `SELECT c.id, c.stage_id, ps.key AS stage_key, p.key AS pipeline_key
         FROM cards c
         LEFT JOIN pipeline_stages ps ON ps.id = c.stage_id
         LEFT JOIN pipelines p ON p.id = c.pipeline_id
        WHERE c.client_id = $1`,
      [CLIENT_ID]
    )).rows;
    const eventCols = (await c.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'events'
        ORDER BY ordinal_position`
    )).rows.map((r) => r.column_name);
    const defaultOrg = (await c.query(
      `SELECT id, slug FROM orgs WHERE slug = $1 LIMIT 1`,
      [process.env.DEFAULT_ORG_SLUG || "fundhub"]
    )).rows[0] || null;
    return { cols, client, crs, eventsBefore, cardsBefore, eventCols, defaultOrg };
  });

  if (!before.client) throw new Error("simulated client missing");
  if (!before.crs) throw new Error("simulated crs_results row missing");
  if (before.client.id === FORBIDDEN) throw new Error("refusing live credit file");
  if (String(before.client.org_id) !== ORG_ID) throw new Error("org mismatch");
  if (String(before.crs.client_id) !== CLIENT_ID) throw new Error("crs client mismatch");

  const engineResult = before.crs.result;
  const norm = normalizeCrsResult(engineResult);
  const canonicalPreview = mapToCanonical(norm, { crsResultId: CRS_ID, requestId: "preview" });

  write("dumps/01-crs-result.json", {
    crs_id: before.crs.id,
    org_id: before.crs.org_id,
    client_id: before.crs.client_id,
    outcome_tier: before.crs.outcome_tier,
    created_at: before.crs.created_at,
    updated_at: before.crs.updated_at,
    shape: crsShape(engineResult),
    normalized: norm,
    mapToCanonical_names: canonicalPreview.map((e) => e.name)
  });
  write("dumps/06-clients-before.json", {
    clients_columns_matching_score_util_estimate: before.cols,
    events_table_columns: before.eventCols,
    default_org: before.defaultOrg,
    client: clientSnap(before.client),
    cards: before.cardsBefore,
    events_before: before.eventsBefore
  });

  // --- 2. registerAll + emitCrsResult ---
  registerAll();
  const analysisHandlers = getHandlers("analysis.completed").map((fn) => fn.name || String(fn));
  const decisionHandlers = getHandlers("decision.rendered").map((fn) => fn.name || String(fn));
  const registeredAll = {
    "analysis.completed": analysisHandlers,
    "decision.rendered": decisionHandlers
  };

  const requestId = randomUUID();
  const emitDb = {
    query: async (sql, params) => {
      const c = dbClient();
      await c.connect();
      try {
        return await c.query(sql, params);
      } finally {
        await c.end();
      }
    }
  };

  const emitted = await emitCrsResult({
    db: emitDb,
    engineResult,
    clientId: CLIENT_ID,
    crsResultId: CRS_ID,
    requestId
  });

  write("dumps/02-emit-return.json", {
    request_id: requestId,
    inngest_event_key_set: Boolean(process.env.INNGEST_EVENT_KEY),
    crs_allow_live_set: Boolean(process.env.CRS_ALLOW_LIVE),
    registered_handlers: registeredAll,
    emit: emitted
  });

  // --- 3 + 4 + 6 after emit ---
  const after = await withDb(async (c) => {
    const client = (await c.query(
      `SELECT id, org_id, email, is_demo, outcome_tier, tags, funded, funded_amount,
              custom_fields, updated_at
         FROM clients WHERE id = $1`,
      [CLIENT_ID]
    )).rows[0] || null;
    const crs = (await c.query(
      `SELECT id, org_id, client_id, outcome_tier, result, created_at, updated_at
         FROM crs_results WHERE id = $1`,
      [CRS_ID]
    )).rows[0] || null;
    const events = (await c.query(
      `SELECT id, name, version, org_id, client_id, idempotency_key, created_at, payload
         FROM events WHERE client_id = $1 ORDER BY created_at ASC`,
      [CLIENT_ID]
    )).rows;
    const cards = (await c.query(
      `SELECT c.id, c.stage_id, ps.key AS stage_key, p.key AS pipeline_key
         FROM cards c
         LEFT JOIN pipeline_stages ps ON ps.id = c.stage_id
         LEFT JOIN pipelines p ON p.id = c.pipeline_id
        WHERE c.client_id = $1`,
      [CLIENT_ID]
    )).rows;
    const dead = (await c.query(
      `SELECT id, event_id, event_name, handler, error, created_at
         FROM dead_letter
        WHERE client_id = $1
        ORDER BY created_at DESC
        LIMIT 20`,
      [CLIENT_ID]
    ).catch(() => ({ rows: [] }))).rows;
    return { client, crs, events, cards, dead };
  });

  write("dumps/03-events.json", {
    count: after.events.length,
    names: after.events.map((e) => e.name),
    rows: after.events.map((e) => ({
      id: e.id,
      name: e.name,
      org_id: e.org_id,
      client_id: e.client_id,
      idempotency_key: e.idempotency_key,
      created_at: e.created_at,
      payload: e.payload
    }))
  });
  write("dumps/06-clients-after-emit.json", {
    client: clientSnap(after.client),
    crs_shape: crsShape(after.crs?.result),
    crs_outcome_tier: after.crs?.outcome_tier ?? null,
    crs_updated_at: after.crs?.updated_at ?? null,
    cards: after.cards,
    dead_letter: after.dead
  });

  const beforeCf = pickCf(before.client.custom_fields || {}, CF_KEYS);
  const afterCf = pickCf(after.client.custom_fields || {}, CF_KEYS);
  const beforeTags = [...(before.client.tags || [])].sort();
  const afterTags = [...(after.client.tags || [])].sort();
  const crsResultChanged = JSON.stringify(crsShape(before.crs.result)) !== JSON.stringify(crsShape(after.crs.result));
  const cardBefore = before.cardsBefore.map((x) => x.stage_key).join(",");
  const cardAfter = after.cards.map((x) => x.stage_key).join(",");

  write("dumps/04-handlers.json", {
    register_all_listeners: {
      "analysis.completed": analysisHandlers,
      "decision.rendered": decisionHandlers,
      other_register_all_modules_grep: {
        "handlers/comms.mjs": "not registered",
        "handlers/payment-links.mjs": "not registered",
        "handlers/money-chain.mjs": "not registered",
        "handlers/customer-insights.mjs": "not registered",
        "handlers/inquiry-gate.mjs": "not registered",
        "handlers/inquiry-docs.mjs": "not registered",
        "handlers/commas-disputes.mjs": "not registered",
        "handlers/diagnostic-soft-pull.mjs": "not registered",
        "agents/runtime.mjs": "not registered"
      }
    },
    row_changes_after_emit: {
      onAnalysisCompleted: {
        registered: analysisHandlers.includes("onAnalysisCompleted"),
        crs_results_result_shape_changed: crsResultChanged,
        crs_results_top_level_scores: after.crs?.result?.scores ?? null,
        crs_results_top_level_utilization: after.crs?.result?.utilization ?? null,
        crs_results_outcome_tier: after.crs?.outcome_tier ?? null
      },
      onDecisionRendered: {
        registered: decisionHandlers.includes("onDecisionRendered"),
        clients_outcome_tier_before: before.client.outcome_tier,
        clients_outcome_tier_after: after.client.outcome_tier,
        custom_fields_before: beforeCf,
        custom_fields_after: afterCf,
        card_stage_before: cardBefore || null,
        card_stage_after: cardAfter || null
      }
    }
  });

  const fired = (emitted.emitted || []).map((e) => ({
    name: e.name,
    id: e.id,
    deduped: e.deduped,
    client_id: CLIENT_ID,
    crs_id: CRS_ID,
    request_id: requestId,
    source: "emitCrsResult"
  }));
  write("events-fired.json", {
    unit: "W-CRS",
    client_id: CLIENT_ID,
    crs_id: CRS_ID,
    request_id: requestId,
    emitted: fired,
    events_table_rows: after.events.map((e) => ({
      id: e.id,
      name: e.name,
      idempotency_key: e.idempotency_key,
      created_at: e.created_at
    }))
  });

  // --- 5. c-06 handle() locally, no Inngest ---
  const analysisRow = after.events.find((e) => e.name === "analysis.completed");
  let c06 = { invoked: false };
  if (analysisRow) {
    const event = {
      id: analysisRow.id,
      name: analysisRow.name,
      orgId: analysisRow.org_id,
      clientId: analysisRow.client_id,
      payload: analysisRow.payload
    };
    const tagsBeforeC06 = afterTags;
    const c06Result = await c06Handle({
      event,
      db: emitDb,
      step: fakeStep(),
      deliverFundingLettersFn: async (db, args) => {
        const pack = await buildLetterPackForClient(db, { clientId: args.clientId, pack: "funding" });
        const files = pack.files || [];
        return {
          delivered: files.length > 0,
          letterCount: files.length,
          files: files.map((f) => ({
            path: f.filename || f.name || f.path || null,
            bytes: f.buffer?.byteLength || f.content?.byteLength || f.pdf?.byteLength || f.bytes?.byteLength || 0
          })),
          persisted: false,
          reason: "audit_dry_run_no_persist",
          engineSkip: pack.engineSkip || null,
          pack_reason: pack.reason || null
        };
      }
    });
    const afterC06 = await withDb(async (c) => {
      const client = (await c.query(
        `SELECT tags, custom_fields FROM clients WHERE id = $1`,
        [CLIENT_ID]
      )).rows[0];
      const docs = (await c.query(
        `SELECT id, kind, subtype, title, generated_by
           FROM documents WHERE client_id = $1
           ORDER BY created_at DESC LIMIT 20`,
        [CLIENT_ID]
      ).catch(() => ({ rows: [] }))).rows;
      const msgs = (await c.query(
        `SELECT id, channel, status, template_key
           FROM messages WHERE client_id = $1
           ORDER BY created_at DESC LIMIT 20`,
        [CLIENT_ID]
      ).catch(() => ({ rows: [] }))).rows;
      const tasks = (await c.query(
        `SELECT id, title, source_workflow
           FROM tasks WHERE client_id = $1
           ORDER BY created_at DESC LIMIT 20`,
        [CLIENT_ID]
      ).catch(() => ({ rows: [] }))).rows;
      return { client, docs, msgs, tasks };
    });
    c06 = {
      invoked: true,
      inngest_enabled: false,
      event_used: { id: event.id, name: event.name, payload_source: event.payload?.source || null },
      result: c06Result,
      tags_before: tagsBeforeC06,
      tags_after: afterC06.client?.tags || [],
      custom_fields_funding_letters_event: afterC06.client?.custom_fields?.funding_letters_delivered_event_id ?? null,
      documents: afterC06.docs,
      messages: afterC06.msgs,
      tasks: afterC06.tasks
    };
  } else {
    c06 = { invoked: false, reason: "no analysis.completed row to feed handle()" };
  }
  write("dumps/05-c06.json", c06);

  write("dumps/06-clients-after-c06.json", {
    note: "c-06 handle() ran locally after emit; tags may have changed",
    c06
  });

  console.log(JSON.stringify({
    emit_ok: emitted.ok,
    emitted: fired,
    events: after.events.map((e) => e.name),
    scores_on_clients: afterCf,
    c06_branch: c06.result?.branch || c06.reason || null
  }));
}

main().catch((err) => {
  console.error(String(err && err.stack ? err.stack : err));
  process.exit(1);
});
