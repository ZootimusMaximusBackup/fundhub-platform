// The weekly run, end to end: pull → classify → roll up.
//
// docs/specs/W2-creative-intelligence.md §6.6.
//
// ONE FUNCTION, SO REGISTERING IT IS ONE LINE. The spec puts this on an Inngest
// cron in src/workflows/index.mjs, alongside message-dispatch-sweeper, using the
// registration pattern that already exists there — "reuse the existing
// registration pattern, do not add a second scheduler."
//
// THAT REGISTRATION IS NOT MADE HERE, and the omission is deliberate rather than
// forgotten: src/workflows/index.mjs is a shared registry that another workflow
// is editing in parallel, and two agents appending to the same list is a merge
// conflict at best. So the job is complete and self-contained, and wiring it is
// an import plus a cron line. That gap is named in the task report.
//
// THE ORDER MATTERS AND IT IS NOT ARBITRARY:
//
//   1. INGEST first, because the classifier only ever looks at creatives that
//      exist, and the roll-up only ever looks at observations that exist.
//   2. CLASSIFY second, because six of the ten signals need an angle.
//   3. ROLL UP last, because the Winner Score ranks within angle.
//
// A FAILURE AT ANY STEP DOES NOT DISCARD THE STEPS BEFORE IT. An ingest that
// worked and a classifier that could not reach the model should still leave the
// week's observations on disk — they are bought data, and throwing them away
// because a later step failed means paying for them twice. Each step's outcome
// is reported separately for the same reason.

import { pullAll } from "./ingest.mjs";
import { classifyPending } from "./classify.mjs";
import { computeWeek, isoWeek } from "./weekly.mjs";

/* runWeekly(db, opts, ctx) → { ingest, classify, rollup, errors }

   `errors` is a list, never a throw. A cron that throws is a cron whose failure
   is a stack trace in a log nobody reads; a cron that returns what worked and
   what did not is one whose failure is visible on a screen. */
export async function runWeekly(db, {
  orgId,
  week = isoWeek(),
  vendorKey = "fixture",
  observedOn = null,
  classifyLimit = 200,
  fundhubInternalPartnerId = null,
  env = process.env
} = {}, ctx = {}) {
  if (!orgId) throw new Error("runWeekly: orgId is required");
  const out = { week, ingest: null, classify: null, rollup: null, errors: [] };

  try {
    out.ingest = await pullAll(db, { orgId, vendorKey, observedOn }, ctx);
    if (out.ingest.failed.length) {
      out.errors.push(`ingest failed for: ${out.ingest.failed.join(", ")}`);
    }
  } catch (err) {
    out.errors.push(`ingest: ${String((err && err.message) || err)}`);
  }

  try {
    out.classify = await classifyPending(db, {
      orgId, limit: classifyLimit, fundhubInternalPartnerId, env, fetchImpl: ctx.fetch
    });
    if (out.classify.reason) out.errors.push(`classify: ${out.classify.reason}`);
  } catch (err) {
    out.errors.push(`classify: ${String((err && err.message) || err)}`);
  }

  try {
    // The roll-up runs even when classification was skipped. The signals that
    // need an angle come back NULL and the score renormalises over the rest, so
    // an unclassified week still produces a real (if thinner) board rather than
    // no board at all.
    out.rollup = await computeWeek(db, { orgId, week });
  } catch (err) {
    out.errors.push(`rollup: ${String((err && err.message) || err)}`);
  }

  return out;
}

/* The cron the spec asks for, as data, so registering it does not require
   re-reading §6.6. Sunday night so the board is fresh Monday morning; weekly is
   what the product promises and it is what makes the ad-age arithmetic clean. */
export const WEEKLY_CRON = "0 2 * * 1";
export const WEEKLY_CRON_NOTE =
  "Monday 02:00 UTC — after the Sunday-night pull window, before Monday morning.";
