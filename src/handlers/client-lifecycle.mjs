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
import { logStaffEvent } from "../shifts/telemetry.mjs";
import { resolveShiftId } from "../shifts/attribution.mjs";
import { ensureGhlContactId, config as ghlConfig } from "../messaging/ghl-contacts.mjs";
import { adaptersBlocked } from "../lib/dry-run.mjs";
import { upsertSurveyCarbonCopy } from "./client-custom-fields.mjs";
import { addTags } from "../workflows/tags.mjs";
import { moveCardToStage } from "../workflows/cards.mjs";

// --- helpers ----------------------------------------------------------------

// Split a single "First Last" display name into first/last (best-effort).
export function splitName(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: null, lastName: null };
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

/** Stamp a visible warning on the client when GHL linkage is missing. */
async function markGhlMissing(db, clientId, reason) {
  try {
    await db.query(
      `UPDATE clients
          SET custom_fields = COALESCE(custom_fields, '{}'::jsonb)
            || jsonb_build_object(
                 'ghl_link_missing', true,
                 'ghl_link_missing_reason', $2::text,
                 'ghl_link_missing_at', to_jsonb(now()::text)
               )
        WHERE id = $1`,
      [clientId, String(reason || "unknown").slice(0, 200)]
    );
  } catch {
    /* custom_fields must not block client creation */
  }
}

/**
 * Best-effort GHL contact sync for a just-created client.
 *
 * Decision (2026-08-04): never leave ghl_contact_id null silently.
 *   1. When GHL_API_KEY is set — find-or-create regardless of sms routing
 *      (relay may turn on later; the contact should already exist).
 *   2. When the ADAPTERS_DRY_RUN fence is up — stamp a local placeholder so
 *      verification and CRM screens are not blank. Checked FIRST, before the
 *      key, because checking it after meant it never ran in production.
 *   3. Otherwise — console.warn + custom_fields.ghl_link_missing so an
 *      operator can see the client cannot receive SMS via the relay.
 *
 * NEVER throws and NEVER blocks client creation.
 */
async function syncGhlContact(db, { clientId, orgId, email, phone, firstName, lastName }, opts = {}) {
  const env = opts.env || process.env;
  if (!email && !phone) {
    console.warn(
      `[client-lifecycle] client ${clientId}: no email/phone — cannot link a GHL contact`
    );
    await markGhlMissing(db, clientId, "no_identifier");
    return;
  }

  try {
    /* THE FENCE COMES FIRST. It used to sit below the `cfg.ok` branch, which
       returns whenever GHL_API_KEY is set — so in production, where the key is
       set, the dry-run branch was unreachable and the sync called GoHighLevel
       no matter what the flag said. Order was the whole bug. */
    if (adaptersBlocked(env)) {
      const placeholder = `dry-ghl-${String(clientId).replace(/-/g, "").slice(0, 12)}`;
      await db.query(
        `UPDATE clients
            SET ghl_contact_id = COALESCE(ghl_contact_id, $1),
                custom_fields = COALESCE(custom_fields, '{}'::jsonb)
                  || jsonb_build_object('ghl_link_dry_run', true)
          WHERE id = $2`,
        [placeholder, clientId]
      );
      console.warn(
        `[client-lifecycle] client ${clientId}: ADAPTERS_DRY_RUN fence is up — ` +
        `stamped placeholder ${placeholder} and did not call GoHighLevel`
      );
      return;
    }

    const cfg = ghlConfig(env);
    if (cfg.ok) {
      const result = await ensureGhlContactId(
        db,
        { id: clientId, email, phone, first_name: firstName, last_name: lastName },
        opts
      );
      if (result.ok) return;
      console.warn(
        `[client-lifecycle] client ${clientId}: GHL link failed (${result.reason}). ` +
        `SMS via ghl_relay will not work until this is fixed.`
      );
      await markGhlMissing(db, clientId, result.reason);
      return;
    }

    console.warn(
      `[client-lifecycle] client ${clientId}: GHL_API_KEY unset — ghl_contact_id left null. ` +
      `This client cannot receive SMS through the GHL relay.`
    );
    await markGhlMissing(db, clientId, "not_configured");
  } catch (err) {
    console.warn(
      `[client-lifecycle] client ${clientId}: GHL sync threw (${String(err && err.message || err).slice(0, 120)})`
    );
    await markGhlMissing(db, clientId, "exception");
  }
}

// Resolve the platform client for an event: prefer an explicit clientId on the
// event, else find-or-create by (org, email). Returns a client uuid or null.
//
// `opts` ({ fetchImpl, env }) is the GHL contact-sync test seam — every real
// call site omits it and gets globalThis.fetch / process.env, same default as
// every provider in src/messaging/providers/.
async function backfillGhlIfMissing(db, clientId, orgId, p, opts = {}) {
  if (!clientId || !orgId) return clientId;
  const { rows } = await db.query(
    `SELECT id, ghl_contact_id, email, phone, first_name, last_name
       FROM clients WHERE id = $1 AND org_id = $2 LIMIT 1`,
    [clientId, orgId]
  );
  const row = rows[0];
  if (!row) return clientId;
  if (row.ghl_contact_id) return clientId;

  const { firstName, lastName } = splitName(p?.name);
  await syncGhlContact(db, {
    clientId,
    orgId,
    email: row.email || (p?.email ? String(p.email).trim().toLowerCase() : null),
    phone: row.phone || p?.phone || null,
    firstName: row.first_name || firstName,
    lastName: row.last_name || lastName
  }, opts);
  return clientId;
}

/** Fill phone / name when a later webhook has them and the row is still blank. */
async function patchClientContact(db, clientId, p = {}) {
  if (!clientId) return;
  const { firstName, lastName } = splitName(p.name);
  const phone = p.phone ? String(p.phone).trim() : null;
  if (!phone && !firstName && !lastName) return;
  await db.query(
    `UPDATE clients SET
       phone = COALESCE(NULLIF(phone, ''), $2),
       first_name = COALESCE(NULLIF(first_name, ''), $3),
       last_name = COALESCE(NULLIF(last_name, ''), $4),
       updated_at = now()
     WHERE id = $1`,
    [clientId, phone, firstName, lastName]
  );
}

export async function resolveClient(db, event, opts = {}) {
  const orgId = event.orgId;
  const p = event.payload || {};
  if (event.clientId) {
    // Explicit id still needs a GHL link when missing — lead capture often
    // creates the row first, then emits with clientId set.
    await patchClientContact(db, event.clientId, p);
    return backfillGhlIfMissing(db, event.clientId, orgId, p, opts);
  }
  const email = String(p.email || "").trim().toLowerCase();
  if (!orgId || !email) return null;

  const found = await db.query(
    `SELECT id, ghl_contact_id FROM clients WHERE org_id = $1 AND lower(email) = $2 LIMIT 1`,
    [orgId, email]
  );
  if (found.rows[0]) {
    await patchClientContact(db, found.rows[0].id, p);
    // Existing row with a null GHL id is the silent-null hazard — backfill.
    return backfillGhlIfMissing(db, found.rows[0].id, orgId, p, opts);
  }

  const { firstName, lastName } = splitName(p.name);
  const ins = await db.query(
    `INSERT INTO clients (org_id, email, first_name, last_name, phone, channel_source)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (org_id, lower(email)) WHERE email IS NOT NULL DO NOTHING
     RETURNING id`,
    [orgId, email, firstName, lastName, p.phone || null, p.source || null]
  );
  if (ins.rows[0]) {
    const clientId = ins.rows[0].id;
    await syncGhlContact(db, { clientId, orgId, email, phone: p.phone || null, firstName, lastName }, opts);
    return clientId;
  }

  // Lost an insert race (or already existed) — re-select and backfill if needed.
  const re = await db.query(
    `SELECT id FROM clients WHERE org_id = $1 AND lower(email) = $2 LIMIT 1`,
    [orgId, email]
  );
  if (!re.rows[0]) return null;
  await patchClientContact(db, re.rows[0].id, p);
  return backfillGhlIfMissing(db, re.rows[0].id, orgId, p, opts);
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

// entry.captured — ensure client + Sales board card (new_lead).
// Card placement is sync here so Pipeline UI updates even when Inngest cannot
// invoke functions (missing INNGEST_SIGNING_KEY / sync failure). s-01 also
// places the card; moveCardToStage is idempotent.
export async function onEntryCaptured(event, db) {
  const clientId = await resolveClient(db, event);
  if (!clientId || !event.orgId) return;
  await mergeCustomFields(db, clientId, { lifecycle_status: "New Lead" });
  await addTags(db, clientId, ["lead:new"]);
  await moveCardToStage(db, {
    orgId: event.orgId,
    clientId,
    pipelineKey: "sales",
    stageKey: "new_lead"
  });
}

// survey.submitted — fold answers into clients.custom_fields (jsonb) and the
// typed client_custom_fields carbon-copy (sales/agent joins).
export async function onSurveySubmitted(event, db) {
  const clientId = await resolveClient(db, event);
  const answers = event.payload && event.payload.answers;
  if (clientId && answers && typeof answers === "object") {
    await mergeCustomFields(db, clientId, answers);
    if (event.orgId) {
      await upsertSurveyCarbonCopy(db, { clientId, orgId: event.orgId, answers });
    }
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
//
// This INSERT is the line where "a credit pull ran" becomes true, so it is where
// the `pull_run` staff telemetry belongs. THE SEAM IS EMPTY TODAY: the pull is
// requested and returned entirely by automation reacting to the client's $32
// diagnostic payment, and the event carries orgId/clientId and no staff member —
// so `staffId` is never present and no row is written. Under the 05/30 model
// drift the pull runs live on the call, which gives it an actor for the first
// time; when the emitter carries one, this reads it. It is not invented here.
export async function onAnalysisCompleted(event, db) {
  const clientId = await resolveClient(db, event);
  if (!clientId) return;

  const crsResultId = event.payload?.crsResultId ?? null;
  if (crsResultId) {
    const anchored = (await db.query(
      `SELECT id, org_id, client_id FROM crs_results WHERE id = $1`,
      [crsResultId]
    )).rows[0];
    if (!anchored) throw new Error("analysis.completed names a missing crs_results row");
    if (String(anchored.org_id) !== String(event.orgId)
        || String(anchored.client_id) !== String(clientId)) {
      throw new Error("analysis.completed crs_results row belongs to a different org or client");
    }


    // Reuse the durable row. Canonical analysis fields are merged into the raw
    // provider object because downstream underwriting reads them there; the
    // provider payload remains intact and no second history row is created.
    const canonical = {
      scores: event.payload?.scores,
      utilization: event.payload?.utilization,
      reasonCodes: event.payload?.reasonCodes,
      newInquiries: event.payload?.newInquiries,
      source: event.payload?.source
    };
    await db.query(
      `UPDATE crs_results
          SET result = result || $2::jsonb,
              outcome_tier = COALESCE(outcome_tier, $3),
              updated_at = now()
        WHERE id = $1`,
      [crsResultId, JSON.stringify(canonical), event.payload?.outcomeTier ?? null]
    );
    return;
  }

  const result = { ...(event.payload || {}), __event_id: event.id };
  // Legacy unanchored events keep their event-id replay guard and insert path.
  const dup = await db.query(
    `SELECT 1 FROM crs_results WHERE client_id = $1 AND result->>'__event_id' = $2 LIMIT 1`,
    [clientId, String(event.id)]
  );
  if (dup.rows[0]) return;
  await db.query(
    `INSERT INTO crs_results (org_id, client_id, result, outcome_tier) VALUES ($1,$2,$3,$4)`,
    [event.orgId, clientId, JSON.stringify(result), event.payload?.outcomeTier || null]
  );

  // Below the dedupe return above, so a replayed pull cannot be counted twice
  // against whoever ran it. logStaffEvent never throws; the result row is
  // already written and nothing here can take it back.
  const staffId = event.payload?.staffId ?? null;
  if (staffId) {
    await logStaffEvent(db, {
      orgId: event.orgId,
      staffId,
      shiftId: await resolveShiftId(db, { staffId, shiftId: event.payload?.shiftId }),
      kind: "pull_run",
      detail: {
        client_id: clientId,
        event_id: String(event.id),
        // The bureau payload itself is NOT copied in — it is the consumer's
        // credit file. The tier is the one summary a telemetry reader needs.
        outcome_tier: event.payload?.outcomeTier ?? null
      }
    });
  }
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
    // `analyzer_prequal_amount` had no writer anywhere in the codebase (see the "Adjacent
    // bug" note in workflow-migration-table.md), so the AI-SET-03 and AI-SET-04 SMS copy —
    // "you've been pre-approved for {{contact.analyzer_prequal_amount}} in capital" — merged
    // an always-empty field. Fixed here rather than by repointing the templates at
    // total_funding_estimate: db/schema/005 and the GHL custom-field map both carry
    // analyzer_prequal_amount as its own MONETORY field, and that ported copy is already
    // flagged for a rewrite pass — changing its merge tag now would collide with that.
    //
    // Both mirror one figure: decision.rendered carries a single dollar amount
    // (crs.mjs:mapToCanonical → payload.fundingEstimate), so both are written from it.
    // Stored raw, like total_funding_estimate — consumers format (public/dashboard.html
    // uses fmtMoney). Display formatting for the merge tag belongs with the AI-SET copy
    // rewrite, not invented here.
    await mergeCustomFields(db, clientId, {
      total_funding_estimate: p.fundingEstimate,
      analyzer_prequal_amount: p.fundingEstimate
    });
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
