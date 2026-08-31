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
//   closed          → round.closeout  (staff marks the engagement complete)
//
// Idempotency key includes roundNumber so round 2 can re-enter the same stages.

import { emit } from "../events/bus.mjs";
import { resolveSuccessFee, sumConfirmedApprovals } from "./success-fee.mjs";

export const PIPELINE_KEY = "funding_card_stacking";
export const PRODUCT = "card_stacking";

/** stage key → canonical event name, or null for stage-only moves */
export const STAGE_TO_EVENT = Object.freeze({
  apply_now: "round.started",
  round_submitted: "round.submitted",
  approved: "round.approved",
  action_required: null,
  funded: "round.funded",
  closed: "round.closeout"
});

export function eventForStage(stageKey) {
  if (!stageKey) return null;
  return Object.prototype.hasOwnProperty.call(STAGE_TO_EVENT, stageKey)
    ? STAGE_TO_EVENT[stageKey]
    : null;
}

/**
 * Sum of confirmed approvals on a funding round — Approved applications that
 * carry a real recorded amount. Used here to PREFILL the funded amount when
 * staff omit it; the same number is also the fee basis under the 2026-08-30
 * decision (docs/CLOSEOUT-FEE-BASIS.md). One definition, in success-fee.mjs.
 */
export async function sumApprovedApplications(db, fundingRoundId) {
  return sumConfirmedApprovals(db, { fundingRoundId });
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

/** One client's round by number, falling back to their latest round. */
export async function roundFor(db, { orgId, clientId, roundNumber } = {}) {
  if (roundNumber != null) {
    const r = await db.query(
      `SELECT * FROM funding_rounds
        WHERE org_id = $1 AND client_id = $2 AND round_number = $3
        LIMIT 1`,
      [orgId, clientId, Number(roundNumber)]
    );
    if (r.rows[0]) return r.rows[0];
  }
  return latestRoundForClient(db, { orgId, clientId });
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
  const round = await roundFor(db, { orgId, clientId, roundNumber });

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
    // No fallback to the funded amount. Calling money that funded an "approved
    // amount" is how the funded figure used to end up billed as an approval.
    // Nothing confirmed is null, and null means unknown (CLAUDE.md §12).
    approvedAmount: approvedAmount != null && Number(approvedAmount) > 0
      ? Number(approvedAmount)
      : suggested,
    round,
    alreadyFunded: false
  };
}

function buildPayload({
  stageKey,
  roundNumber,
  approvedAmount,
  fundedAmount,
  feePercent = null,
  saleId = null,
  fundingRoundId = null
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
    roundNumber,
    engagementComplete: stageKey === "closed",
    // Only round.funded carries these three, and only they make an invoice
    // possible. Without feePercent, F-07 made a task instead of a bill for
    // every funded round this system has ever had. In PERCENT UNITS: 10 = 10%.
    feePercent,
    saleId,
    fundingRoundId
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

  /* round.funded is the billing event, so it carries the billing facts, read
     from the database at the moment of funding and frozen on the event:

       approvedAmount  the CONFIRMED approvals total — the fee basis
       feePercent      the rate agreed on this client's sale, in percent units
       saleId          } together these two are F-07's idempotency key, which
       fundingRoundId  } is what stops a replay billing the client twice

     Every one of these was missing before, which is why no funded round has
     ever produced an invoice. approvedAmount here is deliberately NOT the
     caller's typed roll-up: only a bank yes with a recorded amount is a
     confirmed approval, and nothing confirmed means null, never the funded
     amount and never zero. */
  const billing = eventName === "round.funded";
  let fee = { confirmedApprovedAmount: null, feePercent: null, saleId: null, fundingRoundId: null };
  if (billing) {
    const row = await roundFor(db, { orgId, clientId, roundNumber: rn });
    if (row) {
      const resolved = await resolveSuccessFee(db, { orgId, fundingRoundId: row.id });
      fee = { ...resolved, fundingRoundId: row.id };
    }
    // No round row leaves every billing field null. F-07 then refuses with a
    // named reason, which is the right answer — not a bill built on a guess.
  }

  const payload = buildPayload({
    stageKey,
    roundNumber: rn,
    approvedAmount: billing ? fee.confirmedApprovedAmount : approvedAmount,
    fundedAmount,
    feePercent: fee.feePercent,
    saleId: fee.saleId,
    fundingRoundId: fee.fundingRoundId
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
