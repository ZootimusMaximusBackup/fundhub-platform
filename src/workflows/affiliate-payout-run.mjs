/* AFFILIATE PAYOUT RUN — the monthly job that turns accrued commission into
 * payouts somebody can actually be paid.
 *
 * Registered 2026-09-21. Before it, commission accrued correctly and was never
 * once batched into a payout: every INSERT into affiliate_payouts in this repo
 * was a test fixture or demo seed. See src/affiliates/payouts.mjs for the whole
 * account of what was missing and the three owner-set numbers this uses.
 *
 * NOTHING LEAVES THE BUILDING WHEN THIS RUNS. It writes 'pending' and 'held'
 * rows and stops. The move to 'processing' and 'paid' is a human action against
 * a payment rail this repository does not contain, and the database refuses
 * that move outright for anyone who has not signed the partner license
 * (affiliate_payouts_guard, 033_affiliates.sql). So the worst case if this
 * fires unexpectedly is a run row nobody asked for, which is voidable — not a
 * payment nobody asked for, which is not.
 *
 * WHY A CRON AND NOT AN EVENT. There is no event for "a month ended". Reacting
 * to a payment instead would build a run per payment, which is the opposite of
 * batching and would defeat the minimum entirely.
 *
 * MONTHLY, NOT DAILY OR WEEKLY. The run covers the PREVIOUS whole calendar
 * month, so firing more often than monthly would mostly re-derive the same
 * idempotency key and land on the unique index doing nothing. It is scheduled
 * a few hours into the 1st rather than at midnight so a payment settling late
 * on the last day of the month has landed before the period is closed.
 */

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { buildPayoutRunsForAllOrgs } from "../affiliates/payouts.mjs";

/** 03:00 UTC on the 1st of each month. See the header for why not midnight. */
export const PAYOUT_CRON = "0 3 1 * *";

export async function sweep(database = db, opts = {}) {
  return buildPayoutRunsForAllOrgs(database, opts);
}

/* handle — the shape src/journeys/runner/registry.mjs expects of every
   registered workflow, so "every registered workflow is callable" stays true
   rather than this one becoming the exception that softens the rule.

   It has no event trigger (it is a cron), so no journey reaches it and it will
   always appear in the runner's neverFired list. That is the correct outcome
   for a scheduled job, not a coverage hole. */
export async function handle({ db: handleDb, step } = {}) {
  const run = () => sweep(handleDb || db);
  return step && typeof step.run === "function" ? step.run("payout-run", run) : run();
}

export const affiliatePayoutRun = inngest.createFunction(
  { id: "affiliate-payout-run", name: "Affiliate payout run (monthly)" },
  { cron: PAYOUT_CRON },
  () => sweep(db)
);

export default sweep;
