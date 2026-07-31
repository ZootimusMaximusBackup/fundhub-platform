// The monthly UnderwriteIQ optimization report, re-aimed.
//
// WHAT CHANGED ABOUT IT. The Credit Optimization Roadmap already exists in this
// platform as a ONE-OFF DELIVERABLE: a document kind
// (`credit_optimization_roadmap`, db/migrations/030_documents.sql:87) and a
// grantable entitlement (`credit-optimization-roadmap`,
// db/migrations/032_entitlements.sql:195) that a client receives once, when they
// buy. Bought once, delivered once, done.
//
// A subscription artifact is a different thing wearing the same name. It is
// produced EVERY PERIOD for as long as somebody is subscribed, whether or not
// anything interesting happened, and its value is the comparison between this
// period and the last one rather than the snapshot itself. That is what this
// module builds: one artifact per client per calendar month, with a stable key
// so that regenerating a month replaces it rather than producing a second copy.
//
// THREE THINGS THIS MODULE DELIBERATELY DOES NOT DO:
//
//   * IT DOES NOT SUBSCRIBE ANYBODY. There is no billing here, no card storage,
//     no entitlement check. `entitlement_code` below names the grant a delivery
//     path should gate on; making that check is somebody else's module.
//   * IT DOES NOT SCHEDULE. `period_start` is an argument. There is no clock in
//     this file and no cron anywhere in this repository.
//   * IT DOES NOT SEND. Nothing transmits in this platform (AUDIT-FINDINGS.md);
//     this returns a value.
//
// NO CUSTOMER-FACING CLAIM TEXT. Every string in the output is either a field
// name, a measured number, or a stated reason why a number is absent. This is a
// regulated consumer-finance product and CLAUDE.md §7 is explicit that a
// customer-facing claim about a credit outcome is a human's to write. The report
// carries the evidence; the wording is somebody's job, not this function's.
//
// Pure: same inputs, same output, forever.

import { evaluate, firedAlerts, blanksOf, positionOf, dateOrNull } from "./upsell.mjs";

/** The document kind this artifact instantiates — already in the schema (030). */
export const DOCUMENT_KIND = "credit_optimization_roadmap";

/** The entitlement a delivery path should gate on — already in the schema (032). */
export const ENTITLEMENT_CODE = "credit-optimization-roadmap";

export const CADENCE = "monthly";

/** "2026-07" from any instant inside July 2026, in UTC. The period label is the
 *  artifact's identity, so it must not depend on the reader's timezone. */
export function monthKey(date) {
  const d = dateOrNull(date, "monthKey.date");
  if (d === null) throw new TypeError("monthKey: a date is required");
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The first instant of the month after the one containing `date`, in UTC. */
export function nextMonthStart(date) {
  const d = dateOrNull(date, "nextMonthStart.date");
  if (d === null) throw new TypeError("nextMonthStart: a date is required");
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}

/**
 * buildMonthlyOptimizationReport — one period's artifact for one client.
 *
 * PRODUCED EVERY PERIOD, EVEN WHEN NOTHING FIRED. That is the difference between
 * a subscription artifact and an alert: a subscriber who gets nothing in a quiet
 * month has been told something (nothing changed), and a month with no artifact
 * is indistinguishable from a month the job failed. `signal_count` may be zero
 * and `blanks` says why.
 *
 * @param {object} opts
 * @param {string}  opts.clientId
 * @param {string?} opts.orgId
 * @param {Date|string} opts.periodStart      first instant of the period, UTC
 * @param {Date|string?} opts.periodEnd       defaults to the first instant of the next month
 * @param {Array}   opts.tradelines           rows shaped like `tradelines` (054)
 * @param {Array?}  opts.previousTradelines   the same shape, from the previous period
 * @param {object?} opts.pull                 the latest pull's inquiry/late-payment counts
 * @param {object?} opts.scores               { previous, current } from `snapshots.score`
 * @param {object}  opts.rules                `upsell_trigger_rules` rows (079)
 * @param {Date|string?} opts.now             when the report was built; no clock in here
 */
export function buildMonthlyOptimizationReport({
  clientId,
  orgId = null,
  periodStart,
  periodEnd = null,
  tradelines = [],
  previousTradelines = null,
  pull = null,
  scores = null,
  rules = {},
  now = null
} = {}) {
  if (!clientId) throw new TypeError("buildMonthlyOptimizationReport: clientId is required");

  const start = dateOrNull(periodStart, "periodStart");
  if (start === null) throw new TypeError("buildMonthlyOptimizationReport: periodStart is required");
  const end = periodEnd === null || periodEnd === undefined
    ? nextMonthStart(start)
    : dateOrNull(periodEnd, "periodEnd");
  if (end.getTime() <= start.getTime()) {
    throw new RangeError(`buildMonthlyOptimizationReport: periodEnd ${end.toISOString()} is not after periodStart ${start.toISOString()}`);
  }

  const builtAt = dateOrNull(now, "now");
  const periodKey = monthKey(start);

  const signals = evaluate({ clientId, tradelines, previousTradelines, pull, scores, rules, now: builtAt });
  const position = positionOf(tradelines);
  const previousPosition = previousTradelines === null || previousTradelines === undefined
    ? null
    : positionOf(previousTradelines);

  const blanks = blanksOf(signals);
  if (!position.complete) {
    // The position's own gap is a blank in its own right: every rule downstream
    // of it will refuse for the same reason, and a reader should see the cause
    // once at the top rather than inferring it from three rule reasons.
    blanks.unshift({
      rule_key: null,
      reason: `the client's position could not be measured: ${position.incomplete_reason}`,
      metrics: position
    });
  }

  return {
    artifact: {
      // Stable per (client, period). Regenerating July replaces July.
      key: `${DOCUMENT_KIND}|${clientId}|${periodKey}`,
      document_kind: DOCUMENT_KIND,
      entitlement_code: ENTITLEMENT_CODE,
      cadence: CADENCE,
      recurring: true,
      period: { key: periodKey, start: start.toISOString(), end: end.toISOString() }
    },
    client_id: clientId,
    org_id: orgId,
    built_at: builtAt === null ? null : builtAt.toISOString(),

    // What was true this period, and what was true last period. Nulls carry a
    // stated reason rather than being filled in.
    position,
    previous_position: previousPosition,

    signals,
    signal_count: signals.filter((s) => s.fires).length,
    // Ready for src/finance/alerts.mjs raiseAlerts(); this function writes nothing.
    alerts: firedAlerts(signals),
    // The deliberate blanks, kept visible — the convention unmappedProducts(),
    // unratedConversions() and needsAttention() already follow in this repo.
    blanks
  };
}

/* The short name the build plan uses for this function. One implementation, two
   names — not a second builder. */
export { buildMonthlyOptimizationReport as monthlyReport };

export default buildMonthlyOptimizationReport;
