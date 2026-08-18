// W-PAY — payment.received / diagnostic.paid event path on the shared simulated client.
// Findings only. Event path only. No card rail. No Stripe/Commas charge.
// No live bureau. Do not set CRS_ALLOW_LIVE. Do not turn on INNGEST_EVENT_KEY.
// Writes: this client only (plus events rows we emit). Never teardown.

import fs from "node:fs";
import path from "node:path";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-engine-2026-08-18-evidence/w-pay");
const CLIENT_ID = "41a3199f-1835-4ac8-91c0-d4f37bd92037";
const CRS_ID = "c1f83e6b-a624-4f28-a32a-531a530b3ad4";
const EMAIL = "sim+1787079946953@demo.fundhub.local";
const CARD_ID = "0a8e8863-5094-4fbc-af0f-c37e5a457c97";
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

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL missing");
if (CLIENT_ID === FORBIDDEN) throw new Error("refused forbidden live id");
fs.mkdirSync(OUT, { recursive: true });

function write(name, obj) {
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(obj, null, 2));
}

function envPresent(name) {
  const raw = process.env[name];
  return { name, present: raw != null && String(raw).trim() !== "" };
}

function crsAllowLiveOn(env = process.env) {
  const raw = env.CRS_ALLOW_LIVE;
  if (raw == null || String(raw).trim() === "") return false;
  return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
}

function pickClientCols(row) {
  if (!row) return null;
  return {
    id: row.id,
    org_id: row.org_id,
    email: row.email,
    is_demo: row.is_demo,
    outcome_tier: row.outcome_tier,
    ghl_contact_id_present: row.ghl_contact_id != null && String(row.ghl_contact_id).trim() !== "",
    updated_at: row.updated_at,
    created_at: row.created_at,
    custom_fields: row.custom_fields || {}
  };
}

function entitlementSummary(held, locked, catalog) {
  return {
    catalog_count: catalog.length,
    catalog_codes: catalog.map((c) => c.code),
    held_count: held.length,
    locked_count: locked.length,
    held_codes: held.map((r) => r.code || r.entitlement_code),
    locked_codes: locked.map((r) => r.code || r.entitlement_code),
    portal_tile_note: "client-portal.html paints 6 tiles; FUNDING_MASTERY maps to null so it stays locked"
  };
}

async function dumpFile(db, label) {
  const clientCols = (await db.query(
    `SELECT column_name, data_type
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'clients'
      ORDER BY ordinal_position`
  )).rows;
  const payishClientCols = clientCols.filter((c) =>
    /stage|crs_paid|entitlement|paid|lifecycle/i.test(c.column_name)
  );

  const ccfExists = (await db.query(
    `SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'client_custom_fields'`
  )).rows[0];
  let ccfCols = [];
  let ccfRow = null;
  if (ccfExists) {
    ccfCols = (await db.query(
      `SELECT column_name, data_type
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'client_custom_fields'
          AND (column_name ILIKE '%crs_paid%' OR column_name ILIKE '%paid%'
               OR column_name ILIKE '%entitlement%' OR column_name ILIKE '%analyzer%'
               OR column_name ILIKE '%crs_%')
        ORDER BY column_name`
    )).rows;
    const hasCrsPaid = ccfCols.some((c) => c.column_name === "crs_paid");
    const hasAnalyzer = ccfCols.some((c) => c.column_name === "analyzer_path");
    const select = ["client_id"];
    if (hasCrsPaid) select.push("crs_paid");
    if (hasAnalyzer) select.push("analyzer_path");
    ccfRow = (await db.query(
      `SELECT ${select.join(", ")} FROM client_custom_fields WHERE client_id = $1 LIMIT 1`,
      [CLIENT_ID]
    )).rows[0] || null;
  }

  const client = (await db.query(
    `SELECT id, org_id, email, is_demo, outcome_tier, ghl_contact_id,
            custom_fields, updated_at, created_at
       FROM clients WHERE id = $1`,
    [CLIENT_ID]
  )).rows[0] || null;

  const cards = (await db.query(
    `SELECT c.id, c.pipeline_id, c.stage_id, c.entered_at, c.updated_at,
            p.key AS pipeline_key, ps.key AS stage_key, ps.name AS stage_name
       FROM cards c
       LEFT JOIN pipelines p ON p.id = c.pipeline_id
       LEFT JOIN pipeline_stages ps ON ps.id = c.stage_id
      WHERE c.client_id = $1
      ORDER BY c.created_at`,
    [CLIENT_ID]
  )).rows;

  const namedCard = cards.find((c) => c.id === CARD_ID) || null;

  const { forClient, catalog } = await import("../../../../src/entitlements/entitlements.mjs");
  const cat = await catalog(db, { orgId: ORG_ID });
  const ents = await forClient(db, { orgId: ORG_ID, clientId: CLIENT_ID });
  const entitlementRows = (await db.query(
    `SELECT entitlement_code, granted_at, expires_at, revoked_at, source_event_id
       FROM entitlements WHERE client_id = $1 ORDER BY granted_at`,
    [CLIENT_ID]
  )).rows;

  const productEntitlements = (await db.query(
    `SELECT product_code, entitlement_code, duration_days
       FROM product_entitlements WHERE org_id = $1
       ORDER BY product_code, entitlement_code`,
    [ORG_ID]
  )).rows;

  const transactions = (await db.query(
    `SELECT id, product_name, amount_paid, status, provider, provider_ref, created_at
       FROM transactions WHERE client_id = $1 ORDER BY created_at`,
    [CLIENT_ID]
  )).rows;

  const sales = (await db.query(
    `SELECT s.id, s.status, s.sold_at, s.external_ref, p.code AS product_code, p.name AS product_name
       FROM sales s
       LEFT JOIN products p ON p.id = s.product_id
      WHERE s.client_id = $1
      ORDER BY s.sold_at`,
    [CLIENT_ID]
  )).rows;

  const salePayments = sales.length
    ? (await db.query(
      `SELECT id, sale_id, kind, amount, created_at
         FROM sale_payments WHERE sale_id = ANY($1::uuid[])
         ORDER BY created_at`,
      [sales.map((s) => s.id)]
    )).rows
    : [];

  const accounts = (await db.query(
    `SELECT id, kind, created_at FROM accounts WHERE client_id = $1 ORDER BY created_at`,
    [CLIENT_ID]
  )).rows;

  const consents = (await db.query(
    `SELECT id, kind, granted_at, expires_at, revoked_at
       FROM client_consents WHERE client_id = $1 ORDER BY granted_at`,
    [CLIENT_ID]
  )).rows;

  const events = (await db.query(
    `SELECT id, name, client_id, idempotency_key, created_at,
            (payload ? 'email') AS payload_has_email_key,
            NULLIF(btrim(payload->>'email'), '') IS NOT NULL AS payload_email_nonempty
       FROM events
      WHERE client_id = $1
         OR (payload->>'email' = $2)
      ORDER BY created_at`,
    [CLIENT_ID, EMAIL]
  )).rows;

  const cf = client?.custom_fields && typeof client.custom_fields === "object"
    ? client.custom_fields
    : {};

  return {
    label,
    at: new Date().toISOString(),
    client_id: CLIENT_ID,
    crs_id: CRS_ID,
    card_id: CARD_ID,
    discovered: {
      clients_has_stage_column: clientCols.some((c) => c.column_name === "stage"),
      clients_has_crs_paid_column: clientCols.some((c) => c.column_name === "crs_paid"),
      clients_has_entitlement_column: clientCols.some((c) => /entitlement/i.test(c.column_name)),
      payish_client_columns: payishClientCols,
      crs_paid_lives_in: "clients.custom_fields.crs_paid (jsonb). clients.crs_paid column does not exist.",
      client_custom_fields_table: !!ccfExists,
      client_custom_fields_payish_columns: ccfCols
    },
    client: pickClientCols(client),
    custom_fields_pay_keys: {
      crs_paid: cf.crs_paid ?? null,
      deposit_paid: cf.deposit_paid ?? null,
      sale_closed: cf.sale_closed ?? null,
      crs_status: cf.crs_status ?? null,
      crs_pull_scope: cf.crs_pull_scope ?? null,
      analyzer_path: cf.analyzer_path ?? null,
      round_hold_reason: cf.round_hold_reason ?? null,
      lifecycle_status: cf.lifecycle_status ?? null
    },
    client_custom_fields_row: ccfRow,
    cards,
    named_card: namedCard,
    card_stage: namedCard
      ? { pipeline_key: namedCard.pipeline_key, stage_key: namedCard.stage_key, stage_name: namedCard.stage_name }
      : null,
    entitlements: {
      ...entitlementSummary(ents.held, ents.locked, cat),
      rows: entitlementRows,
      product_entitlements: productEntitlements
    },
    transactions,
    sales,
    sale_payments: salePayments,
    accounts,
    consents,
    events_for_this_email_or_id: events
  };
}

async function sampleLivePaymentEvents(db) {
  const counts = (await db.query(
    `SELECT name,
            count(*)::int AS n,
            count(*) FILTER (WHERE client_id IS NULL)::int AS client_id_null,
            count(*) FILTER (WHERE client_id IS NOT NULL)::int AS client_id_set,
            count(*) FILTER (
              WHERE client_id IS NULL
                AND NULLIF(btrim(payload->>'email'), '') IS NULL
            )::int AS null_client_and_no_email,
            count(*) FILTER (
              WHERE client_id IS NULL
                AND NULLIF(btrim(payload->>'email'), '') IS NOT NULL
            )::int AS null_client_but_has_email
       FROM events
      WHERE name IN ('payment.received', 'diagnostic.paid')
        AND client_id IS DISTINCT FROM $1
      GROUP BY name
      ORDER BY name`,
    [FORBIDDEN]
  )).rows;

  const recent = (await db.query(
    `SELECT id, name, client_id, created_at,
            (payload ? 'email') AS payload_has_email_key,
            NULLIF(btrim(payload->>'email'), '') IS NOT NULL AS payload_email_nonempty,
            payload ? 'product' AS payload_has_product,
            payload->>'source' AS source,
            left(coalesce(idempotency_key, ''), 48) AS idempotency_prefix
       FROM events
      WHERE name IN ('payment.received', 'diagnostic.paid')
        AND client_id IS DISTINCT FROM $1
      ORDER BY created_at DESC
      LIMIT 24`,
    [FORBIDDEN]
  )).rows;

  const compareCounts = (await db.query(
    `SELECT name, count(*)::int AS n,
            count(*) FILTER (WHERE client_id IS NULL)::int AS client_id_null
       FROM events
      WHERE name IN ('payment.received', 'diagnostic.paid')
        AND client_id = $1
      GROUP BY name`,
    [COMPARE]
  )).rows;

  return {
    note: "Read-only. Forbidden live file excluded from sample. No writes to other clients. Emails not printed.",
    forbidden_excluded: FORBIDDEN,
    read_compare_client: COMPARE,
    counts_excluding_forbidden: counts,
    read_compare_8556_event_counts: compareCounts,
    recent_sample: recent
  };
}

async function main() {
  const { db, close } = await import("../../../../src/db.mjs");
  const { emit } = await import("../../../../src/events/bus.mjs");
  const { registerAll } = await import("../../../../src/register-all.mjs");
  const { on, getHandlers } = await import("../../../../src/events/registry.mjs");
  const { resolveClient } = await import("../../../../src/handlers/client-lifecycle.mjs");
  const { onDiagnosticPaidSoftPull } = await import("../../../../src/handlers/diagnostic-soft-pull.mjs");
  const c00Mod = await import("../../../../src/workflows/c-00-crs-soft-pull-request.mjs");
  const c00Handle = c00Mod.handle;

  const envFlags = {
    DATABASE_URL: envPresent("DATABASE_URL"),
    INNGEST_EVENT_KEY: envPresent("INNGEST_EVENT_KEY"),
    CRS_ALLOW_LIVE: { ...envPresent("CRS_ALLOW_LIVE"), on: crsAllowLiveOn() },
    GHL_API_KEY: envPresent("GHL_API_KEY"),
    ADAPTERS_DRY_RUN: envPresent("ADAPTERS_DRY_RUN"),
    CRS_API_HOST: envPresent("CRS_API_HOST")
  };

  write("env-flags.json", envFlags);

  const live = await sampleLivePaymentEvents(db);
  write("live-payment-events.json", live);

  const before = await dumpFile(db, "before");
  write("before.json", before);

  const resolveProbes = {
    with_clientId: null,
    email_only: null,
    w10_no_clientId_no_email: null
  };
  resolveProbes.w10_no_clientId_no_email = await resolveClient(db, {
    orgId: ORG_ID,
    name: "diagnostic.paid",
    payload: { product: "crs", amount: 32, source: "commas" }
  });
  write("resolve-probes.json", {
    ...resolveProbes,
    note: "w10_no_clientId_no_email is a read of resolveClient (no email → return null, no insert). with_clientId and email_only are taken from emit rows after emit so we do not double-write GHL."
  });

  const clientAccount = before.accounts.find((a) => a.kind === "client") || null;
  const softPullConsent = before.consents.find((c) => c.kind === "soft_pull_consent" && c.revoked_at == null) || null;
  const bureauRisk = {
    has_client_account: !!clientAccount,
    account_id: clientAccount?.id || null,
    has_valid_looking_soft_pull_consent: !!softPullConsent,
    consent_id: softPullConsent?.id || null,
    crs_allow_live_on: crsAllowLiveOn(),
    would_reach_requestSoftPull: !!(clientAccount && softPullConsent),
    next_function_if_consent_and_account: "requestSoftPull → runCrsPull (src/finance/crs-pull.mjs)"
  };

  registerAll();
  const handlersBeforeUnsub = {
    "payment.received": getHandlers("payment.received").map((fn) => fn.name || "anonymous"),
    "diagnostic.paid": getHandlers("diagnostic.paid").map((fn) => fn.name || "anonymous")
  };

  let softPullUnsubscribed = false;
  if (bureauRisk.would_reach_requestSoftPull) {
    const unsub = on("diagnostic.paid", onDiagnosticPaidSoftPull);
    unsub();
    softPullUnsubscribed = true;
  }

  const handlersAfter = {
    "payment.received": getHandlers("payment.received").map((fn) => fn.name || "anonymous"),
    "diagnostic.paid": getHandlers("diagnostic.paid").map((fn) => fn.name || "anonymous")
  };

  const payloadEmail = {
    email: EMAIL,
    product: "crs",
    productName: "Business Financial Assessment",
    amount: 32,
    source: "commas"
  };

  const emitOptsBase = { orgId: ORG_ID, skipInngest: true, throwOnHandlerError: false };

  const emitted = [];

  async function doEmit(name, payload, opts, shape) {
    const res = await emit(db, name, payload, opts);
    const stored = res.id
      ? (await db.query(
        `SELECT id, name, org_id, client_id, idempotency_key, created_at,
                (payload ? 'email') AS payload_has_email_key,
                NULLIF(btrim(payload->>'email'), '') IS NOT NULL AS payload_email_nonempty
           FROM events WHERE id = $1`,
        [res.id]
      )).rows[0]
      : null;
    const row = {
      shape,
      name,
      emit_id: res.id,
      deduped: res.deduped,
      dispatched: res.dispatched || null,
      stored_client_id: stored?.client_id ?? null,
      stored_client_id_is_this_client: stored?.client_id === CLIENT_ID,
      stored: stored
    };
    emitted.push(row);
    return row;
  }

  const payNoId = await doEmit(
    "payment.received",
    { ...payloadEmail, providerRef: "wpay-sim-41a3199f-pay-noid" },
    { ...emitOptsBase, idempotencyKey: "w-pay:2026-08-18:pay-noid" },
    "payment.received without clientId, with email"
  );

  const payWithId = await doEmit(
    "payment.received",
    { ...payloadEmail, providerRef: "wpay-sim-41a3199f-pay-withid" },
    { ...emitOptsBase, clientId: CLIENT_ID, idempotencyKey: "w-pay:2026-08-18:pay-withid" },
    "payment.received with clientId"
  );

  const diagNoId = await doEmit(
    "diagnostic.paid",
    { ...payloadEmail, providerRef: "wpay-sim-41a3199f-pay-noid" },
    { ...emitOptsBase, idempotencyKey: "w-pay:2026-08-18:diag-noid" },
    "diagnostic.paid without clientId, with email"
  );

  const diagWithId = await doEmit(
    "diagnostic.paid",
    { ...payloadEmail, providerRef: "wpay-sim-41a3199f-pay-withid" },
    { ...emitOptsBase, clientId: CLIENT_ID, idempotencyKey: "w-pay:2026-08-18:diag-withid" },
    "diagnostic.paid with clientId"
  );

  write("emits.json", {
    handlers_after_registerAll: handlersBeforeUnsub,
    soft_pull_unsubscribed_before_diagnostic_emit: softPullUnsubscribed,
    handlers_at_emit: handlersAfter,
    bureauRisk,
    emitted
  });

  const after = await dumpFile(db, "after");
  write("after.json", after);

  let c00 = {
    inngest: {
      key_present: envFlags.INNGEST_EVENT_KEY.present,
      enabled_this_run: false,
      skipInngest_passed: true,
      listens_to: "diagnostic.paid",
      result: envFlags.INNGEST_EVENT_KEY.present
        ? "would-run_if_key_used — skipped because skipInngest and we did not send"
        : "skip — INNGEST_EVENT_KEY not present, emit() will not send"
    },
    local_handle: null
  };

  if (bureauRisk.would_reach_requestSoftPull) {
    c00.local_handle = {
      result: "skip",
      reason: "client account + soft-pull consent present; handle() next call is requestSoftPull then runCrsPull"
    };
  } else {
    try {
      const local = await c00Handle({
        event: {
          id: diagWithId.emit_id,
          name: "diagnostic.paid",
          orgId: ORG_ID,
          clientId: CLIENT_ID,
          payload: { ...payloadEmail, providerRef: "wpay-sim-41a3199f-pay-withid" }
        },
        db,
        step: { run: async (_n, fn) => fn() },
        env: process.env,
        runPull: async () => {
          throw new Error("W-PAY refuse: runCrsPull must not run");
        }
      });
      c00.local_handle = { result: "ran", returned: local };
    } catch (err) {
      c00.local_handle = {
        result: "error",
        message: String(err && err.message || err).slice(0, 240)
      };
    }
  }
  write("c00.json", c00);

  const softPull = {
    registered_on: "diagnostic.paid",
    handler: "onDiagnosticPaidSoftPull → c-00 handle()",
    bureauRisk,
    unsubscribed: softPullUnsubscribed,
    refuse: softPullUnsubscribed
      ? {
        refused: true,
        why: "This file has a client portal account and a soft-pull consent. Completing the handler would call requestSoftPull then runCrsPull.",
        next_call: "requestSoftPull (src/finance/soft-pulls.mjs) then runCrsPull (src/finance/crs-pull.mjs)"
      }
      : {
        refused: false,
        why: "No client portal account and/or no consent path to runCrsPull. Handler was left registered. Next stop inside handle() is recorded in c00.json.",
        next_call: clientAccount
          ? "requestSoftPull (consent gate) — then runCrsPull if consent passes"
          : "handle() returns no_account_for_attribution after stamping crs_status; runCrsPull is not next"
      }
  };
  write("soft-pull.json", softPull);

  write("resolve-path.json", {
    emit_stores_client_id_from: "opts.clientId || null (src/events/bus.mjs). Production commas sweeper does not pass clientId.",
    production_commas: {
      file: "src/adapters/commas.mjs processCommasInboxRow",
      opts: "orgId + idempotencyKey only — no clientId",
      payload_email: "evt.email from the Commas body (may be missing)"
    },
    resolveClient: {
      file: "src/handlers/client-lifecycle.mjs",
      order: [
        "event.clientId → return that id (also GHL backfill if ghl_contact_id empty)",
        "else payload.email + orgId → find or create client",
        "else null"
      ]
    },
    handlers: {
      "payment.received": [
        "onPaymentReceived (lifecycle) — transaction row via resolveClient",
        "onPaymentReceivedForLink (payment-links) — settle link by ref/session; does not resolve client",
        "onPaymentReceivedMoney (money-chain) — sale/entitlement via resolveClient"
      ],
      "diagnostic.paid": [
        "onDiagnosticPaid (lifecycle) — custom_fields.crs_paid + card stage diagnostic_paid",
        "onDiagnosticPaidMoney (money-chain) — sale + grantForPurchase",
        "onDiagnosticPaidSoftPull (diagnostic-soft-pull) — c-00 handle(); bureau if account+consent"
      ]
    },
    w10_live_shape: "events.client_id null and payload email empty → resolveClient returns null",
    probes: {
      w10_no_clientId_no_email: resolveProbes.w10_no_clientId_no_email,
      emit_without_clientId_stored_client_id: payNoId.stored_client_id,
      emit_without_clientId_resolved_this_client_via_email: after.transactions.some((t) => t.provider_ref === "wpay-sim-41a3199f-pay-noid"),
      emit_with_clientId_stored_client_id: payWithId.stored_client_id
    }
  });

  const eventsFired = emitted.map((e) => ({
    name: e.name,
    id: e.emit_id,
    client_id: e.stored_client_id,
    client_id_null: e.stored_client_id == null,
    client_id_is_this_file: e.stored_client_id === CLIENT_ID,
    shape: e.shape
  }));
  write("events-fired.json", {
    client_id: CLIENT_ID,
    org_id: ORG_ID,
    events: eventsFired
  });

  const beforeStage = before.card_stage;
  const afterStage = after.card_stage;
  const beforeCrsPaid = before.custom_fields_pay_keys.crs_paid;
  const afterCrsPaid = after.custom_fields_pay_keys.crs_paid;
  const beforeHeld = before.entitlements.held_count;
  const afterHeld = after.entitlements.held_count;
  const catalogN = after.entitlements.catalog_count;

  write("before-after-delta.json", {
    stage: { before: beforeStage, after: afterStage },
    crs_paid_custom_fields: { before: beforeCrsPaid, after: afterCrsPaid },
    client_custom_fields_crs_paid: {
      before: before.client_custom_fields_row,
      after: after.client_custom_fields_row
    },
    entitlements: {
      before_held: beforeHeld,
      after_held: afterHeld,
      catalog_count: catalogN,
      before_locked: before.entitlements.locked_count,
      after_locked: after.entitlements.locked_count,
      product_entitlements_rows: after.entitlements.product_entitlements.length
    },
    transactions_count: { before: before.transactions.length, after: after.transactions.length },
    sales_count: { before: before.sales.length, after: after.sales.length },
    custom_fields_pay_keys: {
      before: before.custom_fields_pay_keys,
      after: after.custom_fields_pay_keys
    }
  });

  await close();
}

main().catch((err) => {
  fs.writeFileSync(
    path.join(OUT, "prove-error.json"),
    JSON.stringify({ message: String(err && err.message || err).slice(0, 500), stack: String(err && err.stack || "").split("\n").slice(0, 8) }, null, 2)
  );
  console.error(err && err.message);
  process.exit(1);
});
