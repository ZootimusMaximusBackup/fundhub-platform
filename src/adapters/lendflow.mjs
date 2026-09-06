// Lendflow alt-fin adapter — Master Rebuild Spec § 11 (B5 rail), Phase 4.
//
// Lendflow is the external alt-fin LOS. It stays external and is invisible to the
// client and the closer; we mirror it into the Alt-Fin pipeline. Per Spec § 5,
// pipeline #3 cards move ONLY from Lendflow webhooks — never from our own writes.
//
// Same contract as the other 7 adapters. Exactly three responsibilities inbound:
//   1. verify the webhook signature (fail-closed),
//   2. normalize the raw body into a flat event,
//   3. emit canonical events onto the bus — handlers react.
// Plus one outbound: build + POST the Submit Application request. No business
// logic lives here; routing, messaging and card moves are handlers on the events.
//
// ┌───────────────────────────────────────────────────────────────────────────┐
// │ ⚠️ CONFIRM — the field paths, endpoint path, signature header and the       │
// │ Lendflow-side tokens in STAGE_TABLE below are UNVERIFIED.                  │
// │                                                                            │
// │ Spec § 11 points at "fundhub-docs under Lendflow Part 2" for the endpoint  │
// │ and parameter legend. That file is NOT in this repo (no fundhub-docs/ dir, │
// │ no such path in any commit) and app.lendflow.io / api.lendflow.com are not │
// │ reachable unauthenticated, so nothing here was read off the real API.      │
// │                                                                            │
// │ What IS authoritative and already correct below:                           │
// │   • the Alt-Fin stage keys (`stage`) — from db/seed/002_pipelines.sql,     │
// │     which seeds Spec § 5 pipeline #3 verbatim.                             │
// │   • the canonical event names (`event`) — from src/events/canonical.mjs.   │
// │ What needs one pass against the real scrape / a sandbox payload:           │
// │   • the `lendflow` token lists in STAGE_TABLE (their status vocabulary),   │
// │   • SUBMIT_PATH + the payload keys in buildSubmitPayload(),                │
// │   • SIGNATURE_HEADER + the HMAC scheme in verifyLendflowSignature().        │
// │ Correcting the vocabulary is a one-constant edit — that is why the mapping │
// │ is a table and not scattered conditionals.                                 │
// └───────────────────────────────────────────────────────────────────────────┘

import crypto from "node:crypto";
import { emit } from "../events/bus.mjs";
import { postJsonTo, ADAPTERS } from "../lib/outbound-fetch.mjs";

// Header the router should hand to verifyLendflowSignature(); secret env key.
// (Wiring lives in src/http/router.mjs STD — not this module's file to touch.)
export const SIGNATURE_HEADER = "x-lendflow-signature";
export const SUBMIT_PATH = "/api/v1/applications";
export const DEFAULT_API_BASE = "https://api.lendflow.com";

// ---------------------------------------------------------------------------
// 0. Config from env — fail clean when unset (no credentials needed to build).
// ---------------------------------------------------------------------------
// Returns { baseUrl, apiKey, webhookSecret, ready, missing[] }. Nothing throws:
// callers branch on `ready` so an unconfigured deploy degrades instead of
// crashing. Real credentials get pointed at this at cutover.
export function lendflowConfigFromEnv(env = process.env) {
  const baseUrl = String(env.LENDFLOW_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, "");
  const apiKey = env.LENDFLOW_API_KEY || null;
  const webhookSecret = env.LENDFLOW_WEBHOOK_SECRET || null;

  const missing = [];
  if (!apiKey) missing.push("LENDFLOW_API_KEY");
  if (!webhookSecret) missing.push("LENDFLOW_WEBHOOK_SECRET");

  return { baseUrl, apiKey, webhookSecret, ready: missing.length === 0, missing };
}

// ---------------------------------------------------------------------------
// 1. Signature verification (fail-closed)
// ---------------------------------------------------------------------------
// HMAC-SHA256 of the raw body keyed by the webhook secret, hex — the same scheme
// the Commas and Bland adapters use. Accepts a bare hex digest or a prefixed
// "sha256=<hex>" header. Returns false on any mismatch, missing secret, or
// malformed input; the caller MUST refuse the request when false.
export function verifyLendflowSignature(rawBody, providedHeader, secret) {
  if (!secret) return false;
  const provided = String(providedHeader || "").trim();
  if (!provided) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody || "").digest("hex");
  const providedHex = provided.includes("=") ? provided.split("=").pop().trim() : provided;
  try {
    return crypto.timingSafeEqual(Buffer.from(providedHex, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 2. THE STAGE MAP — the reviewable table
// ---------------------------------------------------------------------------
// One row per Alt-Fin milestone. Read it as: "when Lendflow says any of these,
// the card sits at this Alt-Fin stage and we emit this canonical event."
//
//   lendflow — status/stage tokens Lendflow may send (⚠️ UNVERIFIED, see header).
//              Matched after normalizeStageToken(): lowercased, non-alphanumerics
//              collapsed to "_". So "Offer Accepted", "OFFER-ACCEPTED" and
//              "offer_accepted" are all the same token.
//   stage    — Alt-Fin pipeline stage key (db/seed/002_pipelines.sql). Carried in
//              the payload; the card-move handler consumes it. AUTHORITATIVE.
//   event    — canonical event name from src/events/canonical.mjs, or null when
//              the transition is a stage move with no canonical event behind it.
//              AUTHORITATIVE — nothing outside canonical.mjs is ever emitted.
//   proposed — set only where a canonical event SHOULD exist but does not yet.
//              Documented, never emitted. See the DECLINE GAP note below.
//
// Rows are ordered along the Alt-Fin ladder:
//   App Created → Docs/Stips → Underwriting → Offers → Offer Accepted → Funded → Closed
export const STAGE_TABLE = [
  {
    lendflow: ["application_started", "application_created", "app_created", "new", "draft", "created"],
    stage: "app_created",
    event: "round.started",
    note: "Lendflow accepted the application shell. Opens the Alt-Fin card."
  },
  {
    lendflow: [
      "documents_requested", "docs_requested", "document_request", "stips_requested",
      "stips_outstanding", "stips", "documents_required", "pending_documents",
      "awaiting_documents", "incomplete"
    ],
    stage: "docs_stips",
    event: null,
    note:
      "Stips outstanding. Stage move only — docs.received is for docs we RECEIVE, " +
      "not for a request, so emitting it here would be a lie. The borrower widget " +
      "(Spec § 11) collects these; its own callback is what should fire docs.received."
  },
  {
    lendflow: [
      "submitted", "application_submitted", "submitted_to_lenders", "in_underwriting",
      "underwriting", "under_review", "reviewing", "processing", "in_progress"
    ],
    stage: "underwriting",
    event: "round.submitted",
    note: "Out to the lender panel. This is the round.submitted milestone (F-03 copy)."
  },
  {
    lendflow: [
      "offers", "offers_received", "offer_received", "offers_available", "offers_ready",
      "offer_presented", "approved", "conditionally_approved", "pre_approved"
    ],
    stage: "offers",
    event: "round.approved",
    note:
      "At least one lender came back with terms. On the alt-fin rail 'we have offers' " +
      "IS the approval milestone — this is the row that fires round.approved."
  },
  {
    lendflow: ["offer_accepted", "accepted", "offer_selected", "contract_signed", "closing"],
    stage: "offer_accepted",
    event: null,
    note:
      "Client took an offer. Stage move only — round.approved already fired on the " +
      "offers row; re-emitting it here would double-fire the approval messaging."
  },
  {
    lendflow: ["funded", "deal_funded", "funding_complete", "disbursed", "closed_won"],
    stage: "funded",
    event: "round.funded",
    note: "Money moved. Drives the 10% success-fee closeout (Spec § 12 / AX20-AX21)."
  },
  {
    lendflow: ["declined", "denied", "rejected", "no_offers", "not_qualified", "ineligible"],
    stage: "closed",
    event: null,
    proposed: "round.declined",
    note:
      "DECLINE GAP — see the note below. Stage moves to Closed; no event is emitted " +
      "until round.declined is added to canonical.mjs."
  },
  {
    lendflow: ["withdrawn", "cancelled", "canceled", "expired", "abandoned", "closed_lost"],
    stage: "closed",
    event: null,
    note: "Client-side or timeout exit. Stage move only; not a decline."
  },
  {
    lendflow: ["closed", "complete", "completed"],
    stage: "closed",
    event: null,
    note: "Terminal housekeeping state. file.finalized is the file-level fact and is not ours to emit."
  }
];

// --- DECLINE GAP -----------------------------------------------------------
// The brief asks for round.submitted / round.approved / round.funded / round.declined.
// The first three exist in src/events/canonical.mjs. `round.declined` DOES NOT —
// the § 4 spine has no decline event on either funding rail. The rule is emit only
// what is already canonical, so this adapter emits NOTHING on a decline and reports
// reason "unmapped_pending_canonical:round.declined" instead of inventing an event
// or bending an unrelated one (decision.rendered is the 6-tier CRS outcome, not a
// lender decline). The proposal to add it is in the PR/report accompanying this file.
// When round.declined lands in canonical.mjs, the entire change here is: move the
// string from `proposed` to `event` on the declined row. One line.

// normalizeStageToken — "Offer Accepted" / "OFFER-ACCEPTED" → "offer_accepted".
export function normalizeStageToken(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// Flatten STAGE_TABLE into a token → row lookup once at module load.
const STAGE_LOOKUP = new Map();
for (const row of STAGE_TABLE) {
  for (const token of row.lendflow) STAGE_LOOKUP.set(token, row);
}

// lookupStage — resolve a raw Lendflow status to its table row, or null if the
// vocabulary is unknown to us. Unknown is NOT an error: Lendflow can add states,
// and an unrecognized one must be an inert 200, never a dropped webhook.
export function lookupStage(rawStage) {
  return STAGE_LOOKUP.get(normalizeStageToken(rawStage)) || null;
}

// ---------------------------------------------------------------------------
// 3. Normalize the webhook body into a flat event
// ---------------------------------------------------------------------------
// Lendflow global webhooks cover deal status, offers and stips (Spec § 11). The
// envelope may nest the deal under `data`, `application` or `deal` — read all.
export function normalizeLendflowEvent(body) {
  const b = body || {};
  const d = b.data || b.application || b.deal || b;
  const app = d.application || d;

  const applicationId =
    b.application_id ||
    d.application_id ||
    app.application_id ||
    app.uuid ||
    app.id ||
    b.deal_id ||
    d.deal_id ||
    b.id ||
    null;

  // The status token the table keys on. Prefer an explicit status/stage field over
  // the envelope's event name ("application.status_updated" carries no stage).
  const stageRaw =
    d.status ||
    d.stage ||
    app.status ||
    app.stage ||
    b.status ||
    b.stage ||
    d.status_name ||
    app.status_name ||
    null;

  const eventType = b.event || b.event_type || b.type || d.event || null;

  // Offer / funded amounts, best-effort across the shapes offers can arrive in.
  const offers = Array.isArray(d.offers) ? d.offers : Array.isArray(app.offers) ? app.offers : [];
  const firstOffer = offers[0] || d.offer || app.offer || {};
  const approvedAmount = num(
    d.approved_amount ?? app.approved_amount ?? firstOffer.amount ?? firstOffer.approved_amount
  );
  const fundedAmount = num(
    d.funded_amount ?? app.funded_amount ?? (d.funding && d.funding.amount) ?? firstOffer.funded_amount
  );

  // Our own reference, echoed back from the submit payload — lets emit() attach
  // the event to the right client without a lookup.
  const clientRef =
    d.external_id ||
    app.external_id ||
    b.external_id ||
    d.reference_id ||
    app.reference_id ||
    (d.metadata && d.metadata.client_id) ||
    (app.metadata && app.metadata.client_id) ||
    null;

  const roundRef =
    (d.metadata && d.metadata.round_id) || (app.metadata && app.metadata.round_id) || null;

  return {
    applicationId: applicationId ? String(applicationId) : null,
    stageRaw: stageRaw ? String(stageRaw) : null,
    stageToken: normalizeStageToken(stageRaw),
    eventType: eventType ? String(eventType) : null,
    approvedAmount,
    fundedAmount,
    offerCount: offers.length,
    clientRef: clientRef ? String(clientRef) : null,
    roundRef: roundRef ? String(roundRef) : null
  };
}

function num(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

// ---------------------------------------------------------------------------
// 4. Map a normalized event to canonical events (pure)
// ---------------------------------------------------------------------------
// Pure table lookup. Returns [] when the stage is unknown, when the row carries
// no canonical event (stage move only), or when the row is only `proposed`.
export function mapToCanonical(evt) {
  if (!evt || !evt.stageToken) return [];
  const row = lookupStage(evt.stageToken);
  if (!row || !row.event) return [];

  return [
    {
      name: row.event,
      stage: row.stage,
      payload: {
        applicationId: evt.applicationId,
        stage: row.stage,
        lendflowStatus: evt.stageRaw,
        approvedAmount: evt.approvedAmount,
        fundedAmount: evt.fundedAmount,
        offerCount: evt.offerCount,
        rail: "altfin",
        source: "lendflow"
      }
    }
  ];
}

// ---------------------------------------------------------------------------
// 5. Inbound entrypoint
// ---------------------------------------------------------------------------
// handleLendflowWebhook({ db, rawBody, signatureHeader, secret })
//   → { ok, status, emitted: [{name, id, deduped}], reason? }
// Signature shape matches the STD adapters in src/http/router.mjs, so wiring the
// route later is one line there.
//
// Idempotency key = lendflow:<applicationId>:<stageToken>:<eventName>.
// Deliberately keyed on the STAGE, not on a delivery/event id: Lendflow retries
// reuse the application + status but may carry a fresh delivery id, and a
// delivery-id key would let a retry re-fire the milestone messaging. Keying on
// the transition makes both a byte-identical redelivery and a retry with a new
// id collapse to the same no-op.
export async function handleLendflowWebhook({ db, rawBody, signatureHeader, secret }) {
  if (!verifyLendflowSignature(rawBody, signatureHeader, secret)) {
    return { ok: false, status: 401, reason: "bad_signature", emitted: [] };
  }

  let body;
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return { ok: false, status: 400, reason: "invalid_json", emitted: [] };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, status: 400, reason: "invalid_body", emitted: [] };
  }

  const evt = normalizeLendflowEvent(body);

  // No stage token at all — nothing to map. Acknowledge so Lendflow stops retrying.
  if (!evt.stageToken) {
    return { ok: true, status: 200, reason: "no_stage", emitted: [] };
  }

  const row = lookupStage(evt.stageToken);
  if (!row) {
    // Vocabulary we have never seen. Inert 200 — never drop, never guess.
    return { ok: true, status: 200, reason: `unknown_stage:${evt.stageToken}`, emitted: [], stage: null };
  }

  // Known stage, but no canonical event exists for it yet (the decline gap).
  if (!row.event && row.proposed) {
    return {
      ok: true,
      status: 200,
      reason: `unmapped_pending_canonical:${row.proposed}`,
      stage: row.stage,
      emitted: []
    };
  }

  // Known stage that is a card move only.
  if (!row.event) {
    return { ok: true, status: 200, reason: `stage_only:${row.stage}`, stage: row.stage, emitted: [] };
  }

  // Without an application id we cannot build a stable idempotency key, so a
  // retry would double-emit. Refuse rather than risk duplicate milestone sends.
  if (!evt.applicationId) {
    return { ok: false, status: 400, reason: "missing_application_id", emitted: [] };
  }

  const canonical = mapToCanonical(evt);
  const emitted = [];
  for (const c of canonical) {
    const idKey = `lendflow:${evt.applicationId}:${evt.stageToken}:${c.name}`;
    const res = await emit(db, c.name, c.payload, {
      idempotencyKey: idKey,
      clientId: evt.clientRef || undefined
    });
    emitted.push({ name: c.name, id: res.id, deduped: res.deduped });
  }

  return { ok: true, status: 200, stage: row.stage, emitted };
}

// ---------------------------------------------------------------------------
// 6. Outbound — Submit Application
// ---------------------------------------------------------------------------
// Spec § 11: on alt-fin product selection the platform submits via Lendflow's
// Submit Application API, pre-filled from the soft pull + survey. Direct mode.
//
// buildSubmitPayload is pure and separately testable. Field reads are defensive
// across the client row (typed columns), client.custom_fields (the interim jsonb
// holder for the 252 cf_* fields, Rule 2) and an optional business row.
export function buildSubmitPayload({ client = {}, round = {}, business = {} } = {}) {
  const cf = client.custom_fields || client.customFields || {};
  const biz = business || {};
  const bizEntity = biz.entity_data || biz.entityData || {};

  // cf_* names are carbon-copied from the CRM (Rule 2) — read those first, then the
  // typed/plain equivalents. ⚠️ the exact cf_svy_* keys beyond funding_target are
  // UNVERIFIED against the CRM field export.
  const pick = (...vals) => vals.find((v) => v !== undefined && v !== null && v !== "") ?? null;

  const requestedAmount = num(
    pick(
      round.submitted_amount,
      round.submittedAmount,
      cf.cf_svy_funding_target_amount,
      client.funding_target_amount
    )
  );

  const annualRevenue = num(
    pick(cf.cf_svy_annual_revenue, cf.cf_biz_annual_revenue, biz.annual_revenue, client.annual_revenue)
  );

  const timeInBusinessMonths = num(
    pick(biz.age_months, biz.ageMonths, cf.cf_biz_time_in_business_months, client.time_in_business_months)
  );

  return {
    external_id: client.id ? String(client.id) : null, // echoed back on every webhook
    metadata: {
      client_id: client.id ? String(client.id) : null,
      round_id: round.id ? String(round.id) : null,
      round_number: round.round_number ?? round.roundNumber ?? null
    },
    requested_amount: requestedAmount,
    business: {
      name: pick(biz.name, cf.cf_biz_legal_name, client.business_name),
      entity_type: pick(bizEntity.entity_type, cf.cf_biz_entity_type),
      ein: pick(bizEntity.ein, cf.cf_biz_ein),
      annual_revenue: annualRevenue,
      time_in_business_months: timeInBusinessMonths,
      state: pick(bizEntity.state, cf.cf_biz_state)
    },
    owner: {
      first_name: pick(client.first_name, client.firstName),
      last_name: pick(client.last_name, client.lastName),
      email: client.email ? String(client.email).trim().toLowerCase() : null,
      phone: pick(client.phone)
    }
  };
}

// Fields Lendflow cannot underwrite without. Checked before we spend a call.
const REQUIRED_SUBMIT_FIELDS = [
  ["owner.email", (p) => p.owner.email],
  ["owner.first_name", (p) => p.owner.first_name],
  ["owner.last_name", (p) => p.owner.last_name],
  ["business.name", (p) => p.business.name],
  ["requested_amount", (p) => p.requested_amount]
];

export function validateSubmitPayload(payload) {
  const missing = REQUIRED_SUBMIT_FIELDS.filter(([, get]) => {
    const v = get(payload);
    return v === null || v === undefined || v === "";
  }).map(([name]) => name);
  return { valid: missing.length === 0, missing };
}

// submitApplication({ client, round, business, env?, fetchImpl? })
//   → { ok, status, applicationId, payload, reason? }
//
// Emits NOTHING on the bus. Spec § 5 is explicit that Alt-Fin cards move ONLY
// from Lendflow webhooks, so the round.started / round.submitted milestones come
// back to us through handleLendflowWebhook — never from our own submit call.
//
// Fails clean and never throws: unset env → { ok:false, reason:"not_configured" }.
export async function submitApplication({
  client,
  round,
  business,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const cfg = lendflowConfigFromEnv(env);
  const payload = buildSubmitPayload({ client, round, business });

  if (!cfg.apiKey) {
    return { ok: false, status: 0, reason: `not_configured:${cfg.missing.join(",")}`, payload, applicationId: null };
  }

  const check = validateSubmitPayload(payload);
  if (!check.valid) {
    return {
      ok: false,
      status: 0,
      reason: `missing_required:${check.missing.join(",")}`,
      payload,
      applicationId: null
    };
  }

  /* Behind the adapters fence — see src/lib/outbound-fetch.mjs. This is a real
     application submitted to a real lender under a real client's name, so it is
     held unless ADAPTERS_DRY_RUN is explicitly off. transmit() never throws, so
     the network try/catch is gone with the bare fetch. */
  const sent = await postJsonTo(`${cfg.baseUrl}${SUBMIT_PATH}`, {
    headers: {
      authorization: `Bearer ${cfg.apiKey}`,
      accept: "application/json"
    },
    body: JSON.stringify(payload),
    fetchImpl,
    env,
    fence: ADAPTERS,
    what: "lendflow application submit"
  });

  if (sent.blocked) {
    return { ok: false, status: 0, reason: `dry_run_blocked:${sent.error}`, payload, applicationId: null };
  }
  if (!sent.ok && sent.status === 0) {
    return { ok: false, status: 0, reason: `network_error:${sent.error || "unknown"}`, payload, applicationId: null };
  }

  const status = sent.status;
  // transmit() already read the body once and parsed it defensively; a non-JSON
  // body arrives as null and the status still decides the outcome.
  const json = sent.body;

  if (status < 200 || status >= 300) {
    return {
      ok: false,
      status,
      reason: `http_${status}`,
      providerError: json?.message || json?.error || null,
      payload,
      applicationId: null
    };
  }

  const d = json?.data || json || {};
  const applicationId = d.application_id || d.uuid || d.id || null;
  return { ok: true, status, applicationId: applicationId ? String(applicationId) : null, payload };
}
