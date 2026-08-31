// The monthly production-floor review — the job that actually enforces the only
// filter on the partner base.
//
// docs/specs/W0-decisions.md sets the bar (ten funding clients a month, and below
// it the partnership ends); W1-money-model.md §6 sets the cadence (the 1st of each
// month); src/partners/floors.mjs holds every rule and every definition. This file
// is the clock and nothing else. All it does is call evaluateAllPartners() once a
// month and report what happened.
//
// WHY A CRON AND NOT AN EVENT. There is no event to react to. "This partner has
// been below the floor for ninety days" is the ABSENCE of deposits, and an absence
// never fires. The same reasoning the message dispatch sweeper's header gives for
// a deferred text: something has to come back and look.
//
// WHY THE 1ST AND NOT A ROLLING DAILY CHECK. Predictability is the point. A
// partner told "your next check is the 1st" can plan against it, and one job on
// one day means a partner cannot be warned twice for the same shortfall by two
// runs a day apart. windowFor() pins the window end to the start of the month, so
// even a retry, a late run, or a manual run on the 9th scores the SAME window —
// and 282's unique index on (org_id, partner_id, window_end) turns the second
// write into a no-op rather than another rung down the ladder.
//
// WHAT REGISTERING THIS ACTUALLY TURNS ON, stated plainly rather than softened:
// it can lower a partner's revenue_share_pct from 50 to 20. Three things bound
// that, and they are structural, not promises:
//
//   1. IT CANNOT RESTATE HISTORY. partner_revenue.share_pct_applied is frozen on
//      every row (042, and src/partners/revenue.mjs rule 2), so a downgrade
//      changes what LATER accruals compute and moves nothing already earned, paid,
//      or printed. This is the whole reason the ladder is safe to automate.
//   2. IT CANNOT REACH A PARTNER WITH NO ACTIVATION DATE. Every partner active
//      before db/migrations/282_partner_production_floor.sql has activated_at NULL
//      — deliberately, because no honest source for that date exists — and
//      floors.mjs refuses them by name ('no_activation_date') instead of guessing.
//      In practice that means this job scores nobody until somebody sets those
//      dates by hand or a new partner is activated. That is the correct behaviour
//      and it is also, in effect, the safety catch.
//   3. IT CANNOT SKIP THE LADDER. Three consecutive missed windows are required
//      before any share moves, and each one is a recorded row an operator can
//      read before the next fires.
//
// It never touches partners.status. W1 §6 is explicit: 'paused' blocks payouts
// through 042's trigger, so pausing a downgraded partner would withhold money they
// genuinely earned.
//
// COMPLIANCE REVIEW REQUIRED: this job automatically changes a partner's
// revenue-share percentage.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { evaluateAllPartners } from "../partners/floors.mjs";

/** The 1st of every month, 14:00 UTC — 08:00 America/Denver during MDT, the same
    convention daily-pulse uses. Morning, so an operator sees the outcome the day
    it happens rather than finding it on the 2nd. */
export const REVIEW_CRON = "0 14 1 * *";

export const SOURCE_WORKFLOW = "partner-production-floor";

/**
 * One pass. `db` and every knob are arguments, so the tests drive it without
 * Inngest and without a scheduler — the same shape as message-dispatch-sweeper.
 *
 * NEVER THROWS. A pass that fails must not take the scheduled function down with
 * it: the window is pinned to the month, so next month's run re-scores the same
 * boundary correctly and the missed month is a gap in the review history rather
 * than a wrong decision. The error is returned so a caller can log it.
 *
 * @param {{query: Function}} handle
 * @param {{orgId?: string|null, asOf?: Date|string|null, apply?: boolean,
 *          limit?: number}} [options]
 */
export async function review(handle, options = {}) {
  const { orgId = null, asOf = null, apply = true, limit = 0 } = options;
  try {
    const result = await evaluateAllPartners(handle, { orgId, asOf, apply, limit });
    // The per-partner detail is useful to a caller and noisy in a log line, so the
    // counts come first and `results` stays available underneath.
    return { ok: true, ...result };
  } catch (err) {
    return {
      ok: false,
      considered: 0, evaluated: 0, skipped: 0, failed: 0,
      good_standing: 0, warning: 0, final_notice: 0, downgrade: 0, restored: 0,
      downgraded_shares: 0, restored_shares: 0,
      results: [],
      error: String((err && err.message) || err).slice(0, 300)
    };
  }
}

/* handle — the shape src/journeys/runner/registry.mjs expects of every registered
   workflow, so "every registered workflow is callable" stays true rather than this
   one becoming the exception that softens the rule.

   It has no event trigger (it is a cron), so no journey reaches it and it will
   always appear in the runner's neverFired list. That is the correct outcome for a
   scheduled job, not a coverage hole. */
export async function handle({ db: handleDb, step } = {}) {
  const run = () => review(handleDb || db);
  return step && typeof step.run === "function" ? step.run("review", run) : run();
}

export const partnerProductionFloorReview = inngest.createFunction(
  { id: "partner-production-floor", name: "Partner production floor review" },
  { cron: REVIEW_CRON },
  () => review(db)
);

export default review;
