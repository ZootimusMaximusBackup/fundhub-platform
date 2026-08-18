// W16 — payment → event → unlock for the six portal offers.
// Findings only. No card charge. No Commas/Stripe checkout. No config change.
// Writes: events / sale / transaction rows on the TEST client only. Leave them.

import fs from "node:fs";
import path from "node:path";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-crm-whole-2026-08-18-evidence/w16");
const CLIENT_ID = "8556bedc-46e1-4d85-b0cd-a24adfee1521";
const FORBIDDEN = "9af65808-a619-4e65-ae91-239766a006b7";

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

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL missing");
if (CLIENT_ID === FORBIDDEN) throw new Error("refused forbidden live id");

// Nested handler emits do not get skipInngest. Keep Inngest off for this process only.
const inngestWasPresent = !!(process.env.INNGEST_EVENT_KEY && String(process.env.INNGEST_EVENT_KEY).trim());
delete process.env.INNGEST_EVENT_KEY;

fs.mkdirSync(OUT, { recursive: true });

function write(name, obj) {
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(obj, null, 2));
}

function envPresent(name) {
  const raw = process.env[name];
  return { name, present: raw != null && String(raw).trim() !== "" };
}

function handlerNames(fns) {
  return (fns || []).map((fn) => fn.name || "anonymous");
}

async function dumpClient(db, { catalogFn, forClientFn, orgId, email }) {
  const client = (await db.query(
    `SELECT id, org_id, email, first_name, last_name, is_demo, outcome_tier,
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

  const cat = await catalogFn(db, { orgId });
  const ents = await forClientFn(db, { orgId, clientId: CLIENT_ID });
  const entitlementRows = (await db.query(
    `SELECT id, entitlement_code, granted_at, expires_at, revoked_at, source_event_id, grant_reason
       FROM entitlements WHERE client_id = $1 ORDER BY granted_at`,
    [CLIENT_ID]
  )).rows;

  const transactions = (await db.query(
    `SELECT id, product_name, amount_paid, status, provider, provider_ref, created_at
       FROM transactions WHERE client_id = $1 ORDER BY created_at`,
    [CLIENT_ID]
  )).rows;

  const sales = (await db.query(
    `SELECT s.id, s.status, s.sold_at, s.external_ref, s.agreed_price,
            p.code AS product_code, p.name AS product_name
       FROM sales s
       LEFT JOIN products p ON p.id = s.product_id
      WHERE s.client_id = $1
      ORDER BY s.sold_at`,
    [CLIENT_ID]
  )).rows;

  const accounts = (await db.query(
    `SELECT id, kind, created_at FROM accounts WHERE client_id = $1 ORDER BY created_at`,
    [CLIENT_ID]
  )).rows;

  const consents = (await db.query(
    `SELECT id, kind, granted_at, expires_at, revoked_at
       FROM client_consents WHERE client_id = $1 ORDER BY granted_at`,
    [CLIENT_ID]
  )).rows;

  const contracts = (await db.query(
    `SELECT id, template_key, status, sent_at, signed_at, created_at
       FROM contracts WHERE client_id = $1 ORDER BY created_at`,
    [CLIENT_ID]
  )).rows;

  const paymentLinks = (await db.query(
    `SELECT id, purpose, description, amount_cents, status, paid_at, created_at
       FROM payment_links WHERE client_id = $1 ORDER BY created_at`,
    [CLIENT_ID]
  )).rows;

  const outcomes = (await db.query(
    `SELECT id, outcome, logged_at
       FROM call_outcomes WHERE client_id = $1 ORDER BY logged_at`,
    [CLIENT_ID]
  )).rows;

  const events = (await db.query(
    `SELECT id, name, client_id, idempotency_key, created_at,
            payload->>'product' AS payload_product,
            payload->>'productName' AS payload_product_name,
            payload->>'source' AS payload_source
       FROM events
      WHERE client_id = $1
         OR (payload->>'email' = $2)
      ORDER BY created_at`,
    [CLIENT_ID, email]
  )).rows;

  const cf = client?.custom_fields && typeof client.custom_fields === "object"
    ? client.custom_fields
    : {};

  return {
    at: new Date().toISOString(),
    client_id: CLIENT_ID,
    client: client && {
      id: client.id,
      org_id: client.org_id,
      email: client.email,
      first_name: client.first_name,
      is_demo: client.is_demo,
      outcome_tier: client.outcome_tier,
      updated_at: client.updated_at
    },
    custom_fields_pay_keys: {
      crs_paid: cf.crs_paid ?? null,
      deposit_paid: cf.deposit_paid ?? null,
      sale_closed: cf.sale_closed ?? null,
      crs_status: cf.crs_status ?? null,
      analyzer_status: cf.analyzer_status ?? null
    },
    cards: cards.map((c) => ({
      id: c.id,
      pipeline_key: c.pipeline_key,
      stage_key: c.stage_key,
      stage_name: c.stage_name,
      updated_at: c.updated_at
    })),
    entitlements: {
      catalog_count: cat.length,
      catalog_codes: cat.map((c) => c.code),
      held_count: ents.held.length,
      locked_count: ents.locked.length,
      held_codes: ents.held.map((r) => r.code || r.entitlement_code),
      locked_codes: ents.locked.map((r) => r.code || r.entitlement_code),
      rows: entitlementRows
    },
    transactions,
    sales,
    accounts,
    consents,
    contracts,
    payment_links: paymentLinks,
    call_outcomes: outcomes,
    events
  };
}

async function main() {
  const { pool } = await import("../../../../src/db.mjs");
  const { registerAll } = await import("../../../../src/register-all.mjs");
  const { emit } = await import("../../../../src/events/bus.mjs");
  const { getHandlers } = await import("../../../../src/events/registry.mjs");
  const { catalog, forClient } = await import("../../../../src/entitlements/entitlements.mjs");
  const { OFFERS, OFFER_KEYS, UWIQ_DELIVERABLES_CONTENTS } = await import("../../../../src/config/offers.mjs");
  const { productOf, mapToCanonical } = await import("../../../../src/adapters/commas.mjs");
  const { checkoutConfig } = await import("../../../../src/payments/commas-api.mjs");

  const db = pool();

  const clientRow = (await db.query(
    `SELECT id, org_id, email, first_name, is_demo FROM clients WHERE id = $1`,
    [CLIENT_ID]
  )).rows[0];
  if (!clientRow) throw new Error("test client missing");
  if (clientRow.id === FORBIDDEN) throw new Error("refused forbidden live id");
  const ORG_ID = clientRow.org_id;
  const EMAIL = clientRow.email;

  const products = (await db.query(
    `SELECT id, code, name, category, default_price, sort_order
       FROM products WHERE org_id = $1 ORDER BY sort_order, code`,
    [ORG_ID]
  )).rows;

  const aliases = (await db.query(
    `SELECT a.alias, a.source, p.code AS product_code
       FROM product_aliases a
       JOIN products p ON p.id = a.product_id
      WHERE a.org_id = $1
      ORDER BY p.code, a.alias`,
    [ORG_ID]
  )).rows;

  const productEntitlements = (await db.query(
    `SELECT product_code, entitlement_code, duration_days
       FROM product_entitlements WHERE org_id = $1
       ORDER BY product_code, entitlement_code`,
    [ORG_ID]
  )).rows;

  const entitlementCatalog = (await db.query(
    `SELECT code, name, kind, sort_order
       FROM entitlement_catalog WHERE org_id = $1
       ORDER BY sort_order, code`,
    [ORG_ID]
  )).rows;

  const TILE_MAP = {
    SOFT_PULL: "credit-analysis-report",
    FUNDING_DFY: "funding-snapshot",
    REPAIR_DFY: "metro2-letter-pack",
    REPAIR_TRIAL: "metro2-letter-pack",
    UWIQ_DELIVERABLES: "credit-optimization-roadmap",
    FUNDING_MASTERY: null
  };

  const offerMaps = OFFER_KEYS.map((key) => {
    const offer = OFFERS[key];
    const fakeEvt = { name: offer.name, type: "payment.succeeded" };
    const bucket = productOf(fakeEvt);
    const canonical = mapToCanonical(fakeEvt).map((c) => ({ name: c.name, product: c.product }));
    return {
      offer_key: key,
      offer_name: offer.name,
      price_cents: offer.priceCents,
      payment_purpose: offer.paymentPurpose,
      contract_template_key: offer.contractTemplateKey || null,
      contents: offer.contents || null,
      commas_name_match_bucket: bucket,
      commas_would_emit: canonical,
      portal_tile_entitlement: TILE_MAP[key],
      products_table_exact_name: products.find((p) => p.name === offer.name) || null,
      alias_exact_name: aliases.find((a) => a.alias.toLowerCase() === offer.name.toLowerCase()) || null
    };
  });

  write("catalog.json", {
    org_id: ORG_ID,
    products,
    aliases,
    entitlement_catalog: entitlementCatalog,
    product_entitlements: productEntitlements,
    product_entitlements_count: productEntitlements.length,
    tile_map_from_client_portal: TILE_MAP,
    offers: offerMaps,
    uwiq_contents_from_offers_mjs: UWIQ_DELIVERABLES_CONTENTS
  });

  const before = await dumpClient(db, { catalogFn: catalog, forClientFn: forClient, orgId: ORG_ID, email: EMAIL });
  write("before.json", before);

  const checkout = checkoutConfig(process.env);
  write("env-flags.json", {
    DATABASE_URL: envPresent("DATABASE_URL"),
    FANBASIS_CHECKOUT_API_KEY: envPresent("FANBASIS_CHECKOUT_API_KEY"),
    FANBASIS_CHECKOUT_API_BASE: envPresent("FANBASIS_CHECKOUT_API_BASE"),
    COMMAS_CHECKOUT_BASE_URL: envPresent("COMMAS_CHECKOUT_BASE_URL"),
    COMMAS_API_KEY: envPresent("COMMAS_API_KEY"),
    COMMAS_WEBHOOK_SECRET: envPresent("COMMAS_WEBHOOK_SECRET"),
    CRS_ALLOW_LIVE: {
      name: "CRS_ALLOW_LIVE",
      present: envPresent("CRS_ALLOW_LIVE").present,
      on: ["1", "true", "yes", "on"].includes(String(process.env.CRS_ALLOW_LIVE || "").trim().toLowerCase())
    },
    INNGEST_EVENT_KEY: {
      name: "INNGEST_EVENT_KEY",
      present_in_dotenv: inngestWasPresent,
      enabled_this_run: false,
      note: "Deleted from process.env for this script so nested handler emits cannot fan out."
    },
    checkout_config_ok: checkout.ok,
    checkout_config_reason: checkout.ok ? "key present — we did NOT mint a checkout" : checkout.reason
  });

  const clientAccount = before.accounts.find((a) => a.kind === "client") || null;
  const softPullConsent = before.consents.find((c) => c.kind === "soft_pull" && !c.revoked_at) || null;
  const bureauRisk = {
    has_client_account: !!clientAccount,
    has_soft_pull_consent: !!softPullConsent,
    would_reach_requestSoftPull: !!(clientAccount && softPullConsent)
  };

  registerAll();

  const listeners = {
    "payment.received": handlerNames(getHandlers("payment.received")),
    "diagnostic.paid": handlerNames(getHandlers("diagnostic.paid")),
    "deposit.paid": handlerNames(getHandlers("deposit.paid")),
    "sale.closed": handlerNames(getHandlers("sale.closed")),
    "contract.signed": handlerNames(getHandlers("contract.signed")),
    "contract.sent": handlerNames(getHandlers("contract.sent"))
  };
  write("listeners.json", {
    registerAll: true,
    bureauRisk,
    listeners,
    inngest_workflows_that_listen: {
      "diagnostic.paid": ["c-00-crs-soft-pull-request", "af-02-referral-ownership-capture"],
      "deposit.paid": ["c-02b-inquiry-removal-requested", "s-06-post-call-funding-purchased"],
      "payment.received": ["ds-02-diy-letters"],
      "sale.closed": []
    },
    inngest_sent_this_run: false
  });

  let softPullUnsubscribed = false;
  if (bureauRisk.would_reach_requestSoftPull) {
    const { on } = await import("../../../../src/events/registry.mjs");
    const { onDiagnosticPaidSoftPull } = await import("../../../../src/handlers/diagnostic-soft-pull.mjs");
    const unsub = on("diagnostic.paid", onDiagnosticPaidSoftPull);
    unsub();
    softPullUnsubscribed = true;
    write("soft-pull-gate.json", {
      refused_live_bureau: true,
      unsubscribed_onDiagnosticPaidSoftPull: true,
      why: "Test file has a portal account and a soft-pull consent. Completing that handler would call requestSoftPull then runCrsPull. Removed it for this process only. Still skipped diagnostic.paid emit.",
      next_call: "requestSoftPull then runCrsPull",
      CRS_ALLOW_LIVE_on: false
    });
  } else {
    write("soft-pull-gate.json", {
      refused_live_bureau: false,
      why: "No portal account and/or no consent, so c-00 stops before a bureau call.",
      next_stop: clientAccount ? "requestSoftPull (consent gate)" : "no_account_for_attribution"
    });
  }

  const SEMANTIC_FOR_UNLOCK = {
    SOFT_PULL: { name: "diagnostic.paid", product: "crs" },
    FUNDING_DFY: { name: "deposit.paid", product: "deposit" },
    REPAIR_DFY: { name: "sale.closed", product: "diy" },
    REPAIR_TRIAL: { name: "sale.closed", product: "diy" },
    UWIQ_DELIVERABLES: null,
    FUNDING_MASTERY: null
  };

  const emitted = [];

  async function doEmit(name, payload, opts, meta) {
    const res = await emit(db, name, payload, { ...opts, skipInngest: true });
    let stored = null;
    if (res.id) {
      stored = (await db.query(
        `SELECT id, name, client_id, idempotency_key, created_at,
                payload->>'product' AS payload_product,
                payload->>'productName' AS payload_product_name
           FROM events WHERE id = $1`,
        [res.id]
      )).rows[0] || null;
    }
    const row = {
      ...meta,
      name,
      emit_id: res.id,
      deduped: res.deduped,
      dispatched: res.dispatched || null,
      stored_client_id: stored?.client_id ?? null,
      stored
    };
    emitted.push(row);
    return row;
  }

  for (const key of OFFER_KEYS) {
    const offer = OFFERS[key];
    const bucket = productOf({ name: offer.name });
    const amount = offer.priceCents / 100;
    const livePayload = {
      product: bucket,
      productName: offer.name,
      amount,
      email: EMAIL,
      providerRef: `w16-sim-${CLIENT_ID.slice(0, 8)}-${key}-live`,
      source: "w16-sim",
      offerKey: key
    };

    await doEmit(
      "payment.received",
      livePayload,
      {
        orgId: ORG_ID,
        clientId: CLIENT_ID,
        idempotencyKey: `w16:2026-08-18:${key}:pay-live`
      },
      { offer_key: key, shape: "live_offer_name", commas_bucket: bucket }
    );

    const liveCanonical = mapToCanonical({ name: offer.name, type: "payment.succeeded" });
    for (const c of liveCanonical) {
      if (c.name === "payment.received") continue;
      if (c.name === "diagnostic.paid" && bureauRisk.would_reach_requestSoftPull) {
        emitted.push({
          offer_key: key,
          shape: "live_sibling_skipped_bureau",
          name: c.name,
          emit_id: null,
          skipped: true,
          reason: "would_reach_requestSoftPull"
        });
        continue;
      }
      await doEmit(
        c.name,
        { ...livePayload, product: c.product },
        {
          orgId: ORG_ID,
          clientId: CLIENT_ID,
          idempotencyKey: `w16:2026-08-18:${key}:${c.name}:live`
        },
        { offer_key: key, shape: "live_canonical_sibling", commas_bucket: c.product }
      );
    }

    const unlock = SEMANTIC_FOR_UNLOCK[key];
    if (unlock && !liveCanonical.some((c) => c.name === unlock.name)) {
      if (unlock.name === "diagnostic.paid" && bureauRisk.would_reach_requestSoftPull) {
        emitted.push({
          offer_key: key,
          shape: "unlock_path_skipped_bureau",
          name: unlock.name,
          emit_id: null,
          skipped: true,
          reason: "would_reach_requestSoftPull"
        });
      } else {
        await doEmit(
          unlock.name,
          {
            ...livePayload,
            product: unlock.product,
            providerRef: `w16-sim-${CLIENT_ID.slice(0, 8)}-${key}-unlock`
          },
          {
            orgId: ORG_ID,
            clientId: CLIENT_ID,
            idempotencyKey: `w16:2026-08-18:${key}:${unlock.name}:unlock`
          },
          {
            offer_key: key,
            shape: "unlock_path_forced_semantic",
            note: "Live offer name would not emit this. Fired so we can score grant/unlock."
          }
        );
      }
    }
  }

  write("emits.json", { bureauRisk, softPullUnsubscribed, emitted });

  const after = await dumpClient(db, { catalogFn: catalog, forClientFn: forClient, orgId: ORG_ID, email: EMAIL });
  write("after.json", after);

  const newEvents = after.events.filter((e) => !before.events.some((b) => b.id === e.id));
  const newTx = after.transactions.filter((t) => !before.transactions.some((b) => b.id === t.id));
  const newSales = after.sales.filter((s) => !before.sales.some((b) => b.id === s.id));
  const newEnts = after.entitlements.rows.filter((r) => !before.entitlements.rows.some((b) => b.id === r.id));

  write("delta.json", {
    entitlements_held: { before: before.entitlements.held_count, after: after.entitlements.held_count },
    entitlements_held_codes: { before: before.entitlements.held_codes, after: after.entitlements.held_codes },
    product_entitlements_count: productEntitlements.length,
    new_event_ids: newEvents.map((e) => ({ id: e.id, name: e.name, product: e.payload_product, productName: e.payload_product_name })),
    new_transaction_ids: newTx.map((t) => ({ id: t.id, product_name: t.product_name, provider_ref: t.provider_ref, amount_paid: t.amount_paid })),
    new_sale_ids: newSales.map((s) => ({ id: s.id, product_code: s.product_code, status: s.status })),
    new_entitlement_ids: newEnts.map((r) => ({ id: r.id, code: r.entitlement_code })),
    custom_fields: { before: before.custom_fields_pay_keys, after: after.custom_fields_pay_keys },
    cards: { before: before.cards, after: after.cards }
  });

  write("events-fired.json", {
    client_id: CLIENT_ID,
    org_id: ORG_ID,
    email: EMAIL,
    simulated: true,
    charged_card: false,
    commas_checkout_called: false,
    inngest_sent: false,
    events: emitted
  });

  await pool().end();
}

main().catch((err) => {
  fs.writeFileSync(path.join(OUT, "prove-error.json"), JSON.stringify({
    error: String(err && err.message || err).slice(0, 400),
    stack: String(err && err.stack || "").slice(0, 1200)
  }, null, 2));
  console.error(err);
  process.exit(1);
});
