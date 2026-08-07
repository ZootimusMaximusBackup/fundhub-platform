// CRS engine output adapter — Master Rebuild Spec Phase 1.
//
// Unlike the Commas adapter this is NOT an inbound webhook. There is no
// signature to verify. Instead, the platform calls emitCrsResult() after the
// CRS engine finishes, passing the engine's return value directly.
//
// The adapter does exactly two things and NOTHING else:
//   1. Normalize the engine result into a flat object (field-path defensive).
//   2. Emit canonical events onto the bus — handlers react.
//
// Field paths read (engine result may nest differently depending on caller):
//   outcome_tier   : engineResult.outcome                       (top-level, canonical)
//              ↳ or engineResult.crm_payload.outcome            (crm_payload alias)
//              ↳ or engineResult.result.outcome                 (legacy result wrapper)
//              ↳ or engineResult.outcomeResult.outcome          (internal detail key)
//   reasonCodes    : engineResult.reason_codes                  (top-level array)
//              ↳ or engineResult.outcomeResult.reasonCodes
//   fundingEstimate: engineResult.preapprovals.totalCombined    (nested)
//              ↳ or engineResult.crm_payload.customFields.total_funding_estimate
//   scores.ex      : engineResult.consumerSignals.scores.perBureau.ex  (nested)
//              ↳ or engineResult.crm_payload.scores.ex
//   scores.eq      : engineResult.consumerSignals.scores.perBureau.eq  (nested)
//              ↳ or engineResult.crm_payload.scores.eq
//   scores.tu      : engineResult.consumerSignals.scores.perBureau.tu  (nested)
//              ↳ or engineResult.crm_payload.scores.tu
//   utilization    : engineResult.consumerSignals.utilization.pct (nested)
//              ↳ or engineResult.crm_payload.customFields.crs_utilization (legacy)
//   email          : engineResult.crm_payload.contact.email     (nested)
//              ↳ or engineResult.formData.email

import { emit } from "../events/bus.mjs";

// --- 1. Normalize the engine result into a flat object ----------------------
// Reads all known field paths defensively; downstream consumers see one shape.
export function normalizeCrsResult(engineResult) {
  const r = engineResult || {};

  // Unwrap common nesting shapes
  const crm = r.crm_payload || r.crmPayload || {};
  const crmCustom = crm.customFields || {};
  const crmScores = crm.scores || {};
  const inner = r.result || {};
  const outcomeR = r.outcomeResult || inner.outcomeResult || {};
  const cs = r.consumerSignals || inner.consumerSignals || {};
  const csScores = (cs.scores && cs.scores.perBureau) ? cs.scores.perBureau : {};
  const csUtil = cs.utilization || {};

  // outcome_tier
  const outcomeTier =
    r.outcome ||
    outcomeR.outcome ||
    crm.outcome ||
    inner.outcome ||
    null;

  // fundingEstimate
  const fundingEstimate =
    (r.preapprovals && r.preapprovals.totalCombined != null ? r.preapprovals.totalCombined : undefined) ??
    (inner.preapprovals && inner.preapprovals.totalCombined != null ? inner.preapprovals.totalCombined : undefined) ??
    crmCustom.total_funding_estimate ??
    null;

  // per-bureau scores
  const scores = {
    ex: csScores.ex ?? crmScores.ex ?? null,
    eq: csScores.eq ?? crmScores.eq ?? null,
    tu: csScores.tu ?? crmScores.tu ?? null
  };

  // utilization
  const utilization =
    csUtil.pct != null ? csUtil.pct :
    crmCustom.crs_utilization != null ? crmCustom.crs_utilization :
    null;

  // reasonCodes
  const reasonCodes =
    Array.isArray(r.reason_codes) ? r.reason_codes :
    Array.isArray(outcomeR.reasonCodes) ? outcomeR.reasonCodes :
    [];

  // clientId and email
  const clientId =
    r.clientId ||
    inner.clientId ||
    null;

  const email =
    (crm.contact && crm.contact.email) ||
    (r.formData && r.formData.email) ||
    null;

  // newInquiries: [{bureau, inquiry}] from normalized.inquiries (engine includes
  // `normalized` in its return value; each item has source=bureau, creditorName=name).
  const rawInquiries = Array.isArray(r.normalized?.inquiries) ? r.normalized.inquiries : [];
  const newInquiries = rawInquiries
    .filter((inq) => inq && inq.source && inq.creditorName)
    .map((inq) => ({ bureau: inq.source, inquiry: inq.creditorName }));

  return {
    clientId: clientId ? String(clientId) : null,
    outcomeTier: outcomeTier ? String(outcomeTier) : null,
    fundingEstimate: fundingEstimate != null ? Number(fundingEstimate) : null,
    scores,
    utilization: utilization != null ? Number(utilization) : null,
    reasonCodes: Array.isArray(reasonCodes) ? reasonCodes : [],
    email: email ? String(email).trim().toLowerCase() : null,
    newInquiries
  };
}

// --- 2. Map a normalized result to canonical events (pure) ------------------
// A completed CRS run always emits two events:
//   analysis.completed  — "what the bureaus said" (scores/util/reasonCodes)
//   decision.rendered   — "what we decided" (tier + estimate)
//
// `outcomeTier` rides on BOTH payloads. It is decision.rendered's headline, but
// analysis.completed needs it too: emitCrsResult emits these in order and the bus
// dispatches synchronously, so every analysis.completed subscriber runs BEFORE
// decision.rendered has written `clients.outcome_tier`. Without the tier on this
// payload those subscribers read a column that is still null (first pull) or stale
// (re-pull) — see the "Model drift" section of workflow-migration-table.md.
// Two in-repo consumers already assumed this shape: client-lifecycle.mjs's
// onAnalysisCompleted reads `payload.outcomeTier` to fill `crs_results.outcome_tier`
// (previously always null in production), and api/dashboard/seed.mjs emits it.
export function mapToCanonical(norm, { crsResultId = null, requestId = null } = {}) {
  if (!norm || !norm.outcomeTier) return [];

  const anchor = { crsResultId, requestId };
  return [
    {
      name: "analysis.completed",
      payload: {
        ...anchor,
        outcomeTier: norm.outcomeTier,
        scores: norm.scores,
        utilization: norm.utilization,
        reasonCodes: norm.reasonCodes,
        newInquiries: norm.newInquiries,
        source: "crs"
      }
    },
    {
      name: "decision.rendered",
      payload: {
        ...anchor,
        outcomeTier: norm.outcomeTier,
        fundingEstimate: norm.fundingEstimate,
        source: "crs"
      }
    }
  ];
}

// --- Adapter entrypoint ------------------------------------------------------
// emitCrsResult({ db, engineResult, clientId?, crsResultId, requestId })
//   → { ok, emitted: [{name, id, deduped}] }
// Maps the engine output to canonical events and emits each via the bus.
// `db` is injected (pg pool or a fake) so this is unit-testable without Postgres.
// clientId overrides any clientId embedded in engineResult.
export async function emitCrsResult({
  db,
  engineResult,
  clientId,
  crsResultId,
  requestId
} = {}) {
  const norm = normalizeCrsResult(engineResult);
  // Caller-supplied clientId wins over engine-embedded
  const resolvedClientId = clientId != null ? String(clientId) : norm.clientId;

  if (!crsResultId || !requestId) {
    return { ok: false, emitted: [], reason: "missing_result_anchor" };
  }

  const canonical = mapToCanonical(norm, {
    crsResultId: String(crsResultId),
    requestId: String(requestId)
  });
  if (canonical.length === 0) {
    return { ok: false, emitted: [], reason: "no_outcome_tier" };
  }

  const emitted = [];
  for (const c of canonical) {
    const idKey = `crs-result:${crsResultId}:${c.name}:v1`;
    const res = await emit(db, c.name, c.payload, {
      idempotencyKey: idKey,
      clientId: resolvedClientId || undefined
    });
    emitted.push({ name: c.name, id: res.id, deduped: res.deduped });
  }
  return { ok: true, emitted };
}
