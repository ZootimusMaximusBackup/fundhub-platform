// Client-lifecycle handlers — Master Rebuild Spec Phase 2 (the "reactions" layer).
//
// Adapters emit canonical events; THESE react by writing domain state to Postgres.
// This is the platform replacement for what GHL/Airtable did: keep a client row,
// record payments, store CRS results, stamp the outcome. Everything here is
// IDEMPOTENT (Rule 9): the bus dedupes normal deliveries, and replay() re-drives
// events — so a handler that runs twice must not double-write. We lean on:
//   - clients_org_email_uniq         (one client per org+email)
//   - transactions_org_providerref_uniq (one transaction per provider ref)
// (both from migration 003) plus column-set updates (naturally idempotent).
//
// Register once at boot: `import { register } from "./handlers/client-lifecycle.mjs"; register();`

import { on } from "../events/registry.mjs";

// --- helpers ----------------------------------------------------------------

// Split a single "First Last" display name into first/last (best-effort).
export function splitName(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: null, lastName: null };
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

// Resolve the platform client for an event: prefer an explicit clientId on the
// event, else find-or-create by (org, email). Returns a client uuid or null.
export async function resolveClient(db, event) {
  const orgId = event.orgId;
  if (event.clientId) return event.clientId;
  const p = event.payload || {};
  const email = String(p.email || "").trim().toLowerCase();
  if (!orgId || !email) return null;

  const found = await db.query(
    `SELECT id FROM clients WHERE org_id = $1 AND lower(email) = $2 LIMIT 1`,
    [orgId, email]
  );
  if (found.rows[0]) return found.rows[0].id;

  const { firstName, lastName } = splitName(p.name);
  const ins = await db.query(
    `INSERT INTO clients (org_id, email, first_name, last_name, phone, channel_source)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (org_id, lower(email)) WHERE email IS NOT NULL DO NOTHING
     RETURNING id`,
    [orgId, email, firstName, lastName, p.phone || null, p.source || null]
  );
  if (ins.rows[0]) return ins.rows[0].id;

  // Lost an insert race (or already existed) — re-select.
  const re = await db.query(
    `SELECT id FROM clients WHERE org_id = $1 AND lower(email) = $2 LIMIT 1`,
    [orgId, email]
  );
  return re.rows[0] ? re.rows[0].id : null;
}

// Merge a partial object into clients.custom_fields (jsonb). No-op on empty.
async function mergeCustomFields(db, clientId, patch) {
  if (!clientId || !patch || Object.keys(patch).length === 0) return;
  await db.query(
    `UPDATE clients SET custom_fields = custom_fields || $2::jsonb WHERE id = $1`,
    [clientId, JSON.stringify(patch)]
  );
}

// --- handlers ---------------------------------------------------------------

// entry.captured — a new lead entered the funnel: ensure the client exists.
export async function onEntryCaptured(event, db) {
  await resolveClient(db, event);
}

// survey.submitted — fold the survey answers into the client's custom_fields.
export async function onSurveySubmitted(event, db) {
  const clientId = await resolveClient(db, event);
  const answers = event.payload && event.payload.answers;
  if (clientId && answers && typeof answers === "object") {
    await mergeCustomFields(db, clientId, answers);
  }
}

// Record a transaction row (deduped by provider_ref). Shared by the paid + failed
// handlers — same shape, different status.
async function recordTransaction(event, db, status) {
  const clientId = await resolveClient(db, event);
  const p = event.payload || {};
  await db.query(
    `INSERT INTO transactions (org_id, client_id, product_name, amount_paid, status, provider, provider_ref, raw_payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (org_id, provider_ref) WHERE provider_ref IS NOT NULL DO NOTHING`,
    [event.orgId, clientId, p.productName || p.product || "unknown", p.amount ?? null, status, p.source || "commas", p.providerRef || null, JSON.stringify(p)]
  );
}

// payment.received — record the money-in as a succeeded transaction row.
export async function onPaymentReceived(event, db) {
  await recordTransaction(event, db, "succeeded");
}

// payment.failed — record the attempt as a failed transaction (don't lose it).
export async function onPaymentFailed(event, db) {
  await recordTransaction(event, db, "failed");
}

// diagnostic.paid ($32) / deposit.paid / sale.closed — stamp a flag on the client.
// custom_fields flags mirror the GHL fields the live system flips (crs_paid etc).
export async function onDiagnosticPaid(event, db) {
  const clientId = await resolveClient(db, event);
  await mergeCustomFields(db, clientId, { crs_paid: true });
}
export async function onDepositPaid(event, db) {
  const clientId = await resolveClient(db, event);
  await mergeCustomFields(db, clientId, { deposit_paid: true });
}
export async function onSaleClosed(event, db) {
  const clientId = await resolveClient(db, event);
  await mergeCustomFields(db, clientId, { sale_closed: true });
}

// analysis.completed — store the CRS result as history (ports latest_crs_result_full).
// Deduped by (client_id, event id) carried in result.__event_id so replay is safe.
export async function onAnalysisCompleted(event, db) {
  const clientId = await resolveClient(db, event);
  if (!clientId) return;
  const result = { ...(event.payload || {}), __event_id: event.id };
  // Idempotent: skip if we already stored this exact event for the client.
  const dup = await db.query(
    `SELECT 1 FROM crs_results WHERE client_id = $1 AND result->>'__event_id' = $2 LIMIT 1`,
    [clientId, String(event.id)]
  );
  if (dup.rows[0]) return;
  await db.query(
    `INSERT INTO crs_results (org_id, client_id, result, outcome_tier) VALUES ($1,$2,$3,$4)`,
    [event.orgId, clientId, JSON.stringify(result), event.payload?.outcomeTier || null]
  );
}

// decision.rendered — stamp the 6-tier outcome + funding estimate on the client.
export async function onDecisionRendered(event, db) {
  const clientId = await resolveClient(db, event);
  if (!clientId) return;
  const p = event.payload || {};
  if (p.outcomeTier) {
    await db.query(`UPDATE clients SET outcome_tier = $2 WHERE id = $1`, [clientId, p.outcomeTier]);
  }
  if (p.fundingEstimate != null) {
    await mergeCustomFields(db, clientId, { total_funding_estimate: p.fundingEstimate });
  }
}

// register() — wire every handler onto the bus. Idempotent-ish: `on()` uses a Set,
// so double-registering the same fn reference is a no-op.
export function register() {
  on("entry.captured", onEntryCaptured);
  on("survey.submitted", onSurveySubmitted);
  on("payment.received", onPaymentReceived);
  on("payment.failed", onPaymentFailed);
  on("diagnostic.paid", onDiagnosticPaid);
  on("deposit.paid", onDepositPaid);
  on("sale.closed", onSaleClosed);
  on("analysis.completed", onAnalysisCompleted);
  on("decision.rendered", onDecisionRendered);
}
