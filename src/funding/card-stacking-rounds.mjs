// Card Stacking round emitter — staff advance funding_card_stacking cards;
// we emit the same canonical round.* events Lendflow does for Alt-Fin so
// money-chain + the 16 Inngest workflows fire unchanged.
//
// Stage map (funding_card_stacking only):
//   apply_now       → round.started
//   round_submitted → round.submitted
//   approved        → round.approved
//   action_required → (none)
//   funded          → round.funded  (hard-requires funded_amount > 0)
//   closed          → (none)
//
// Idempotency key includes roundNumber so round 2 can re-enter the same stages.

import { emit } from "../events/bus.mjs";

export const PIPELINE_KEY = "funding_card_stacking";
export const PRODUCT = "card_stacking";

/** stage key → canonical event name, or null for stage-only moves */
export const STAGE_TO_EVENT = Object.freeze({
  apply_now: "round.started",
  round_submitted: "round.submitted",
  approved: "round.approved",
  action_required: null,
  funded: "round.funded",
  closed: null
});

export function eventForStage(stageKey) {
  if (!stageKey) return null;
  return Object.prototype.hasOwnProperty.call(STAGE_TO_EVENT, stageKey)
    ? STAGE_TO_EVENT[stageKey]
    : null;
}

/**
 * Sum of Approved applications' approved_amount for a funding round.
 * Prefill only — fee basis stays funding_rounds.funded_amount (CLOSEOUT-FEE-BASIS).
 */
export async function sumApprovedApplications(db, fundingRoundId) {
  if (!fundingRoundId) return null;
  const r = await db.query(
    `SELECT COALESCE(SUM(approved_amount), 0)::numeric AS total
       FROM applications
      WHERE funding_round_id = $1
        AND status = 'Approved'`,
    [fundingRoundId]
  );
  const n = Number(r.rows[0]?.total);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function latestRoundForClient(db, { orgId, clientId }) {
  const r = await db.query(
    `SELECT * FROM funding_rounds
      WHERE org_id = $1 AND client_id = $2
      ORDER BY round_number DESC
      LIMIT 1`,
    [orgId, clientId]
  );
  return r.rows[0] || null;
}

export async function nextRoundNumber(db, { orgId, clientId }) {
  const r = await db.query(
    `SELECT COALESCE(MAX(round_number), 0)::int AS max
       FROM funding_rounds
      WHERE org_id = $1 AND client_id = $2`,
    [orgId, clientId]
  );
  return (r.rows[0]?.max || 0) + 1;
}

function isPresent(v) {
  return v !== undefined && v !== null && v !== "";
}

/**
 * Resolve funded_amount for a move to funded.
 * Priority: explicit fundedAmount → explicit approvedAmount → prefill from
 * Approved apps → null.
 *
 * Explicit zero/negative is NOT a missing value — it refuses (returns null)
 * and must not fall through to prefill. Prefill only runs when the caller
 * omitted the amount entirely.
 */
export async function resolveFundedAmount(db, {
  fundingRoundId,
  fundedAmount,
  approvedAmount
} = {}) {
  if (isPresent(fundedAmount)) {
    const n = Number(fundedAmount);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  if (isPresent(approvedAmount)) {
    const n = Number(approvedAmount);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return sumApprovedApplications(db, fundingRoundId);
}

/**
 * Guard: funded moves require funded_amount > 0.
 * Returns { ok:true, fundedAmount } or { ok:false, reason, message, suggestedFundedAmount }.
 */
export async function guardFundedAmount(db, {
  orgId,
  clientId,
  fundedAmount,
  approvedAmount,
  roundNumber
} = {}) {
  let round = null;
  if (roundNumber != null) {
    round = (await db.query(
      `SELECT * FROM funding_rounds
        WHERE org_id = $1 AND client_id = $2 AND round_number = $3
        LIMIT 1`,
      [orgId, clientId, Number(roundNumber)]
    )).rows[0] || null;
  }
  if (!round) {
    round = await latestRoundForClient(db, { orgId, clientId });
  }

  // Already funded with a real amount — idempotent re-move may omit the body field.
  if (round && round.status === "funded" && Number(round.funded_amount) > 0) {
    return {
      ok: true,
      fundedAmount: Number(round.funded_amount),
      approvedAmount: round.approved_amount != null ? Number(round.approved_amount) : null,
      round,
      alreadyFunded: true
    };
  }

  const suggested = await sumApprovedApplications(db, round?.id);
  const resolved = await resolveFundedAmount(db, {
    fundingRoundId: round?.id,
    fundedAmount,
    approvedAmount
  });

  if (resolved == null || !(resolved > 0)) {
    return {
      ok: false,
      reason: "funded_amount_required",
      message:
        "Cannot move to funded without a funded amount greater than zero. " +
        "Send funded_amount (what actually funded). " +
        (suggested != null
          ? `Suggested from Approved applications: ${suggested}.`
          : "No Approved application amounts found to suggest — enter the funded amount."),
      suggestedFundedAmount: suggested,
      round
    };
  }

  return {
    ok: true,
    fundedAmount: resolved,
    approvedAmount: approvedAmount != null && Number(approvedAmount) > 0
      ? Number(approvedAmount)
      : (suggested != null ? suggested : resolved),
    round,
    alreadyFunded: false
  };
}

function buildPayload({
  stageKey,
  roundNumber,
  approvedAmount,
  fundedAmount
}) {
  return {
    applicationId: null,
    stage: stageKey,
    lendflowStatus: null,
    approvedAmount: approvedAmount != null ? Number(approvedAmount) : null,
    fundedAmount: fundedAmount != null ? Number(fundedAmount) : null,
    offerCount: null,
    rail: "card_stacking",
    source: "card_stacking",
    product: PRODUCT,
    roundNumber
  };
}

/**
 * Emit the canonical round.* event for a Card Stacking stage transition.
 * Caller is responsible for the funded-amount guard before move+emit.
 */
export async function emitCardStackingRoundTransition(db, {
  orgId,
  clientId,
  stageKey,
  roundNumber,
  approvedAmount = null,
  fundedAmount = null
} = {}) {
  const eventName = eventForStage(stageKey);
  if (!eventName) {
    return { emitted: false, reason: "stage_only", eventName: null };
  }
  if (!orgId || !clientId) {
    return { emitted: false, reason: "missing_ids", eventName };
  }

  let rn = roundNumber != null ? Number(roundNumber) : null;
  if (eventName === "round.started") {
    if (rn == null || !(rn > 0)) {
      // Re-parking on apply_now during an open round must reuse that round
      // number (idempotent). Only allocate N+1 after funded/closed (or first).
      const latest = await latestRoundForClient(db, { orgId, clientId });
      const status = latest ? String(latest.status || "") : "";
      if (latest && status !== "funded" && status !== "closed") {
        rn = Number(latest.round_number);
      } else {
        rn = await nextRoundNumber(db, { orgId, clientId });
      }
    }
  } else if (rn == null || !(rn > 0)) {
    const latest = await latestRoundForClient(db, { orgId, clientId });
    rn = latest ? Number(latest.round_number) : 1;
  }

  const payload = buildPayload({
    stageKey,
    roundNumber: rn,
    approvedAmount,
    fundedAmount
  });

  const idempotencyKey = `card_stacking:${clientId}:${rn}:${stageKey}:${eventName}`;
  const res = await emit(db, eventName, payload, {
    orgId,
    clientId,
    idempotencyKey
  });

  return {
    emitted: true,
    eventName,
    roundNumber: rn,
    payload,
    id: res.id,
    deduped: res.deduped,
    idempotencyKey
  };
}
