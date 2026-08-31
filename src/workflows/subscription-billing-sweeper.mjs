// The subscription billing sweeper — the thing that asks for recurring money on
// a schedule.
//
// ═══════════════════════════════════════════════════════════════════════════
// COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7): payment rails and fee timing.
//
// IT CHARGES NOTHING TODAY, AND THAT IS NOT A DISCLAIMER — IT IS THE STATE OF
// THE PROCESSOR. src/subscriptions/charger.mjs carries the finding in full:
// Commas' confirmed surface is GET /payments/:id and POST /checkout-sessions,
// both of which either read or ask a human to click. There is no
// merchant-initiated "charge the token you hold" call anywhere in the adapter,
// so the charge function registry ships EMPTY and resolveCharger() refuses.
// A pass therefore reports "N due, N skipped, no charger configured", which is
// the honest number. Registering a charger is one call the day an endpoint is
// confirmed; SUBSCRIPTION_BILLING_ENABLED="true" is the second lock in front of
// it, so registering is not the same act as switching live billing on.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY A SWEEPER AND NOT AN EVENT HANDLER
//
// The same three reasons message-dispatch-sweeper.mjs gives, and one more that
// is specific to money:
//
//   * A charge that is due next month has no event attached to it. Something
//     has to come back and look.
//   * A failed attempt goes back on the queue with no event either.
//   * A subscription switched onto the rail mid-cycle needs picking up.
//   * AND: an event-driven biller fires once. If that firing is lost, the
//     period is never billed and nobody finds out for a month. A clock that
//     re-reads the truth every hour cannot lose a period — the row is still due
//     next pass.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// THE ONLY THING THIS FILE MUST NEVER DO IS CHARGE THE SAME PERIOD TWICE
//
// It cannot, and the reason is structural rather than careful. Every path to a
// processor call runs through claimCharge(), which INSERTs the ledger row
// against 275's `UNIQUE (subscription_id, period_start)` BEFORE the call. A
// replay, a second concurrent pass, a restarted container: all of them recompute
// the identical period from the same unadvanced `next_charge_at`, collide on
// that index, get `claimed: false` and return without calling anybody. There is
// no branch in this file that charges without holding the claim, and
// src/subscriptions/billing-replay.pg.test.mjs runs the same sweep five times
// against a real Postgres and asserts the processor was called exactly once.
//
// The three non-claims and what the pass does with each:
//   already_charged — the money moved and our follow-up write did not land.
//                     Repair the window (advanceFromCharge). Takes nothing.
//   in_flight       — a previous attempt called out and never came back. WE DO
//                     NOT KNOW IF THE MONEY MOVED, so this is the one case
//                     where retrying is the mistake. Counted as `stuck` and
//                     left for a human to reconcile against GET /payments/:id.
//   abandoned /     — the ceiling is reached, or the backoff has not elapsed.
//   retry_not_due     Counted and skipped.
//
//
// EVERY PASS IS BOUNDED. One pass takes at most `limit` subscriptions and works
// them one at a time. Nothing loops until the backlog is empty: an unbounded
// drain holds a function open for as long as the backlog is long, and a period
// this pass did not reach is still due in the next one. Nothing is lost by
// stopping early.
//
// NEVER THROWS. A pass that dies must not take the scheduled function down with
// it, for the same reason: the next pass is the recovery. The error is returned
// so a caller can log it.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { MAX_ATTEMPTS, planCharge, classifyChargeResult } from "../subscriptions/billing.mjs";
import { resolveCharger, instrumentRefusal } from "../subscriptions/charger.mjs";
import {
  listDueSubscriptions, claimCharge, settleSucceeded, settleFailed, advanceFromCharge
} from "../subscriptions/billing-store.mjs";

/* HOURLY, AT SEVENTEEN MINUTES PAST.
   Hourly because a billing period is a day at its shortest and nothing is
   gained by asking more often — a charge that is four minutes late is not late.
   Off the hour because midnight-UTC crons are where every scheduled job in
   every system piles up, and a payments API is the worst place to join a queue. */
export const SWEEP_CRON = "17 * * * *";

export const SOURCE_WORKFLOW = "subscription-billing-sweeper";

/** How many due subscriptions one pass will look at. */
export const DEFAULT_BATCH = 50;

/**
 * chargeOne — one subscription, one period, at most one processor call.
 *
 * Exported so the sweep is testable a row at a time. The ORDER OF THE GUARDS is
 * the safety property:
 *
 *   1. plan the period            — pure, no writes
 *   2. is there an instrument?    — skip, no ledger row, nothing changed
 *   3. is a charger configured?   — skip, no ledger row, nothing changed
 *   4. CLAIM the period           — the first write, and the only door onward
 *   5. call the processor
 *   6. settle
 *
 * Steps 2 and 3 come BEFORE the claim on purpose. A ledger row means "we tried
 * to move money", and writing one for a period we were never going to attempt
 * would burn an attempt off the retry budget for a gap on our side. It also
 * keeps the table honest: every row in it is a real attempt.
 */
export async function chargeOne(sub, { db: conn, env = process.env, now = new Date(), maxAttempts = MAX_ATTEMPTS } = {}) {
  const plan = planCharge(sub, { now });

  const noInstrument = instrumentRefusal(sub);
  if (noInstrument) {
    return { subscriptionId: sub.id, outcome: "skipped", reason: noInstrument, charged: false };
  }

  const charger = resolveCharger({ provider: plan.provider, env });
  if (!charger.ok) {
    return { subscriptionId: sub.id, outcome: "skipped", reason: charger.code, detail: charger.reason, charged: false };
  }

  const claim = await claimCharge(conn, { ...plan, now, maxAttempts });

  if (!claim.claimed) {
    if (claim.reason === "already_charged" && claim.charge) {
      // The money moved; only our window write was lost. Repair it — this takes
      // nothing and calls nobody.
      const repaired = await advanceFromCharge(conn, { orgId: plan.orgId, chargeId: claim.charge.id });
      return {
        subscriptionId: sub.id,
        outcome: "repaired",
        reason: "already_charged",
        chargeId: claim.charge.id,
        advanced: !!repaired,
        charged: false
      };
    }
    return {
      subscriptionId: sub.id,
      outcome: claim.reason === "in_flight" ? "stuck" : "skipped",
      reason: claim.reason,
      chargeId: claim.charge?.id ?? null,
      charged: false
    };
  }

  const charge = claim.charge;
  const attempt = Number(charge.attempt);

  /* THE PROCESSOR CALL. Wrapped because a charge function that throws is the
     ambiguous case — did the money move? — and an unhandled throw here would
     leave the ledger row `in_flight` with no reason on it. Treating a throw as
     a RETRYABLE failure rather than a decline is the conservative reading: it
     does not flip the customer past_due for what may be our bug. The row is
     still capped by the attempt ceiling either way. */
  let result;
  try {
    result = await charger.charge({
      subscriptionId: sub.id,
      orgId: plan.orgId,
      clientId: plan.clientId,
      partnerId: plan.partnerId,
      cardId: plan.cardId,
      amountCents: plan.amountCents,
      currency: plan.currency,
      idempotencyKey: plan.idempotencyKey,
      periodStart: plan.periodStart,
      periodEnd: plan.periodEnd,
      attempt
    });
  } catch (err) {
    result = { ok: false, code: "charger_threw", reason: String(err?.message || err).slice(0, 300) };
  }

  const verdict = classifyChargeResult(result, { attempt, maxAttempts, now });

  if (verdict.outcome === "succeeded") {
    const settled = await settleSucceeded(conn, {
      orgId: plan.orgId,
      chargeId: charge.id,
      providerRef: verdict.providerRef,
      nextChargeAt: plan.periodEnd,
      at: now
    });
    return {
      subscriptionId: sub.id,
      outcome: "charged",
      chargeId: charge.id,
      amountCents: plan.amountCents,
      currency: plan.currency,
      attempt,
      advanced: Number(settled?.advanced_rows ?? 0) > 0,
      charged: true
    };
  }

  await settleFailed(conn, {
    orgId: plan.orgId,
    chargeId: charge.id,
    failureCode: verdict.failureCode,
    failureReason: verdict.failureReason,
    retryAt: verdict.retryAt,
    abandoned: verdict.abandoned,
    pastDue: verdict.pastDue
  });

  return {
    subscriptionId: sub.id,
    outcome: verdict.abandoned ? "abandoned" : "failed",
    reason: verdict.failureCode,
    chargeId: charge.id,
    attempt,
    retryAt: verdict.retryAt,
    pastDue: verdict.pastDue,
    charged: false
  };
}

/**
 * sweep — one pass.
 *
 * Pure enough to test directly: `db`, the clock, the environment and the batch
 * size are all arguments, so the tests drive it without Inngest and without a
 * scheduler.
 *
 * ONE ROW'S FAILURE NEVER STOPS THE PASS. Each subscription is worked inside its
 * own try/catch, because a backlog of fifty in which the third one throws must
 * still bill the other forty-seven. The failure is recorded against that row.
 */
export async function sweep(conn, options = {}) {
  const { limit = DEFAULT_BATCH, env = process.env, now = new Date(), orgId = null, maxAttempts = MAX_ATTEMPTS } = options;
  const tally = {
    ok: true, considered: 0, charged: 0, amountCents: 0,
    failed: 0, abandoned: 0, skipped: 0, stuck: 0, repaired: 0, errored: 0,
    results: []
  };

  let due;
  try {
    due = await listDueSubscriptions(conn, { orgId, now, limit });
  } catch (err) {
    return { ...tally, ok: false, error: String(err?.message || err).slice(0, 300) };
  }

  tally.considered = due.length;

  for (const sub of due) {
    let outcome;
    try {
      outcome = await chargeOne(sub, { db: conn, env, now, maxAttempts });
    } catch (err) {
      tally.errored += 1;
      tally.results.push({
        subscriptionId: sub.id, outcome: "errored",
        reason: String(err?.message || err).slice(0, 300), charged: false
      });
      continue;
    }
    tally.results.push(outcome);
    if (outcome.outcome === "charged") {
      tally.charged += 1;
      tally.amountCents += Number(outcome.amountCents || 0);
    } else if (outcome.outcome === "failed") tally.failed += 1;
    else if (outcome.outcome === "abandoned") { tally.abandoned += 1; tally.failed += 1; }
    else if (outcome.outcome === "stuck") tally.stuck += 1;
    else if (outcome.outcome === "repaired") tally.repaired += 1;
    else tally.skipped += 1;
  }

  return tally;
}

/* handle — the shape src/journeys/runner/registry.mjs expects of every
   registered workflow, so "every registered workflow is callable" stays true
   rather than this one becoming the exception that softens the rule.

   It has no event trigger (it is a cron), so no journey reaches it and it will
   always appear in the runner's neverFired list. That is the correct outcome
   for a scheduled job, not a coverage hole. */
export async function handle({ db: handleDb, step } = {}) {
  const run = () => sweep(handleDb || db);
  return step && typeof step.run === "function" ? step.run("sweep", run) : run();
}

export const subscriptionBillingSweeper = inngest.createFunction(
  { id: "subscription-billing-sweeper", name: "Subscription billing sweeper" },
  { cron: SWEEP_CRON },
  () => sweep(db)
);

export default sweep;
