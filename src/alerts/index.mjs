// Alert and upsell evaluation. Pure, I/O-free, no clock of its own.
//
// Every function here takes facts and policy and returns findings. It reads no
// database, writes no row, and sends nothing. That is what makes the awkward
// cases testable: a card with no known limit, a score with nothing to compare
// against, a client with no cards at all.
//
// *** POLICY IS NEVER A DEFAULT IN THIS FILE. ***
// Every threshold is a required argument. There is no 30%, no 80%, no 40-point
// drop hiding in a constant. `config_defaults` (052) holds no alert policy, and
// no threshold rows exist anywhere in this repository — so a plausible default
// here would be a number nobody chose, sitting in production, reading to every
// future maintainer as a decision. These functions throw instead. The absence of
// the policy is the finding; see db/migrations/078_alerts.sql.
//
// *** AN UNKNOWN IS NEVER A ZERO, AND IT IS NEVER SILENTLY DROPPED. ***
// A tradeline with no credit limit has no utilization. The whole-book number
// EXCLUDES it and says so in `excluded`, because a total that quietly leaves out
// two of a client's five cards is a wrong number that looks right — and this one
// gets read out loud on a call.

import { fromCents } from "../commissions/money.mjs";

/** Utilization for one line: balance / limit, or null if it cannot be known.
 *  A zero limit yields null, not Infinity and not 1: a card with no limit on
 *  record is an unknown, and dividing by it is a made-up number. */
export function utilizationOf(line) {
  // Number(null) is 0, which would make an unknown limit read as a zero limit
  // and an unknown balance read as a paid-off card. Both are converted to NaN
  // first so the one guard below rejects them — an explicit null check here
  // would be a second branch that can never be reached on its own.
  const limit = line?.credit_limit_cents == null ? NaN : Number(line.credit_limit_cents);
  const balance = line?.balance_cents == null ? NaN : Number(line.balance_cents);
  if (!Number.isFinite(limit) || !Number.isFinite(balance) || limit <= 0) return null;
  return balance / limit;
}

/** The lines a utilization question is actually about. Installment loans cannot
 *  be drawn against and closed lines have no headroom — the same two exclusions
 *  src/tradelines/index.mjs applies before the funding waterfall, for the same
 *  reason. Kept in one place so the two answers cannot drift. */
export function drawableLines(lines = []) {
  return lines.filter((l) => l && !l.closed_at && l.kind !== "installment");
}

function requireThresholds(value, where) {
  if (value == null) {
    throw new TypeError(
      `${where}: a threshold is required — no alert policy exists as a row anywhere in this repository, ` +
      `and this function will not invent one`
    );
  }
  const n = Number(value);
  if (!Number.isFinite(n)) throw new TypeError(`${where}: threshold is not a number: ${JSON.stringify(value)}`);
  return n;
}

/**
 * evaluateUtilization({ lines }, { perCard, overall }) — who is drawn too far.
 *
 * `perCard` and `overall` are ratios in [0,1] (0.8 is 80%) and BOTH ARE
 * REQUIRED. Returns per-line findings, the whole-book figure, and — the part
 * that matters — an explicit list of what could not be measured.
 *
 * THE WHOLE-BOOK NUMBER IS COMPUTED FROM THE MEASURABLE LINES ONLY, and
 * `excluded` names every line left out. A client with three known cards and two
 * unknown ones gets a total across three, labelled as being across three. The
 * alternative — treating an unknown limit as zero — understates the book and
 * makes a client look more drawn than they are; treating it as zero balance
 * overstates their headroom and is how somebody gets told they can borrow money
 * they cannot.
 */
export function evaluateUtilization({ lines = [] } = {}, { perCard, overall } = {}) {
  const perCardThreshold = requireThresholds(perCard, "evaluateUtilization: perCard");
  const overallThreshold = requireThresholds(overall, "evaluateUtilization: overall");

  const drawable = drawableLines(lines);
  const findings = [];
  const excluded = [];
  let limitCents = 0;
  let balanceCents = 0;
  let measured = 0;

  for (const line of drawable) {
    const ratio = utilizationOf(line);
    if (ratio == null) {
      excluded.push({ tradeline_id: line.id ?? null, lender: line.lender ?? null, reason: "no_known_limit" });
      continue;
    }
    measured += 1;
    limitCents += Number(line.credit_limit_cents);
    balanceCents += Number(line.balance_cents);
    if (ratio >= perCardThreshold) {
      findings.push({
        kind: "utilization",
        scope: "line",
        tradeline_id: line.id ?? null,
        lender: line.lender ?? null,
        observed: ratio,
        threshold: perCardThreshold,
        dedupe_key: `utilization:line:${line.id ?? line.lender ?? "unknown"}`
      });
    }
  }

  const overallRatio = limitCents > 0 ? balanceCents / limitCents : null;
  if (overallRatio != null && overallRatio >= overallThreshold) {
    findings.push({
      kind: "utilization",
      scope: "book",
      tradeline_id: null,
      observed: overallRatio,
      threshold: overallThreshold,
      dedupe_key: "utilization:book"
    });
  }

  return {
    findings,
    overall: overallRatio,
    // Dollars as a STRING via money.fromCents — never a float. These are the
    // figures a closer reads out, and 0.1 + 0.2 is not 0.3.
    measured_limit: fromCents(limitCents),
    measured_balance: fromCents(balanceCents),
    measured_lines: measured,
    excluded
  };
}

/**
 * evaluateScore({ current, previous }, { dropPoints }) — did a score fall far
 * enough to be worth telling somebody?
 *
 * `dropPoints` is required, for the same reason as above. Returns no finding
 * when either score is unknown: "we have one reading" is not a movement, and a
 * missing previous score treated as zero would report every first pull as a
 * catastrophic drop.
 *
 * A RISE IS NOT AN ALERT. It is reported in `delta` so a caller can use it, but
 * it raises nothing — an alert queue that fills with good news is a queue nobody
 * reads.
 */
export function evaluateScore({ current, previous } = {}, { dropPoints } = {}) {
  const threshold = requireThresholds(dropPoints, "evaluateScore: dropPoints");
  if (threshold < 0) throw new RangeError("evaluateScore: dropPoints is a magnitude — pass 40, not -40");

  const now = current == null || current === "" ? null : Number(current);
  const before = previous == null || previous === "" ? null : Number(previous);
  if (now == null || before == null || !Number.isFinite(now) || !Number.isFinite(before)) {
    return { findings: [], delta: null, reason: "insufficient_history" };
  }

  const delta = now - before;
  const findings = [];
  if (delta <= -threshold) {
    findings.push({
      kind: "score",
      scope: "client",
      observed: now,
      previous: before,
      delta,
      threshold,
      dedupe_key: `score:drop:${before}:${now}`
    });
  }
  return { findings, delta, reason: null };
}

/**
 * suggestCardUpgrade({ lines }, { minLines, maxUtilization, minLimitCents }) —
 * a client whose own file suggests a product conversation.
 *
 * All three criteria are required arguments. The rule this encodes is
 * deliberately dull: a client with several established lines, comfortably
 * under-drawn, with real limits already extended. It is NOT a model, does not
 * score, and returns no confidence number — there is no historical conversion
 * data in this repository to calibrate one against, and an invented confidence
 * is worse than none because somebody sorts on it.
 *
 * Returns at most one suggestion, with the facts that produced it, or none.
 */
export function suggestCardUpgrade({ lines = [] } = {}, { minLines, maxUtilization, minLimitCents } = {}) {
  const minCount = requireThresholds(minLines, "suggestCardUpgrade: minLines");
  const maxUtil = requireThresholds(maxUtilization, "suggestCardUpgrade: maxUtilization");
  const minLimit = requireThresholds(minLimitCents, "suggestCardUpgrade: minLimitCents");

  const drawable = drawableLines(lines);
  const measurable = drawable.filter((l) => utilizationOf(l) != null);

  // Judged only on lines we can actually measure, and the count says so. A
  // client with two known cards and four unknown ones is not "six cards" here.
  if (measurable.length < minCount) return { suggestions: [], reason: "not_enough_measurable_lines" };

  const limitCents = measurable.reduce((sum, l) => sum + Number(l.credit_limit_cents), 0);
  const balanceCents = measurable.reduce((sum, l) => sum + Number(l.balance_cents), 0);
  if (limitCents < minLimit) return { suggestions: [], reason: "limits_below_floor" };

  const ratio = limitCents > 0 ? balanceCents / limitCents : null;
  if (ratio == null || ratio > maxUtil) return { suggestions: [], reason: "utilization_above_ceiling" };

  return {
    suggestions: [{
      kind: "card_upgrade",
      rationale:
        `${measurable.length} measurable revolving lines, ${fromCents(limitCents)} total limit, ` +
        `${(ratio * 100).toFixed(1)}% drawn — under the ${(maxUtil * 100).toFixed(1)}% ceiling`,
      // WHICH FACTS produced it. A suggestion derived from a credit file is not
      // the same object as one derived from a phone call; only one has FCRA
      // consequences, and a row that does not say which cannot be reviewed.
      evidence: {
        source: "tradelines",
        measurable_lines: measurable.length,
        total_limit: fromCents(limitCents),
        total_balance: fromCents(balanceCents),
        utilization: ratio,
        criteria: { minLines: minCount, maxUtilization: maxUtil, minLimitCents: minLimit },
        tradeline_ids: measurable.map((l) => l.id ?? null)
      },
      dedupe_key: "card_upgrade"
    }],
    reason: null
  };
}

/**
 * monthlyReport({ lines, alerts, scores, period }) — one month, summarised.
 *
 * Pure: it takes the rows and returns an object. It does not fetch them, does
 * not decide what a month is, and has no clock — `period` is supplied by the
 * caller, so a report can be re-run for a past month and produce the same answer
 * it produced then.
 *
 * COUNTS OF UNKNOWNS ARE REPORTED, NOT HIDDEN. `lines_unmeasurable` sits next to
 * every total. A monthly report whose totals quietly cover two thirds of a
 * client's file is the kind of number people make decisions on.
 */
export function monthlyReport({ lines = [], alerts = [], scores = [], period } = {}) {
  if (!period || !period.start || !period.end) {
    throw new TypeError("monthlyReport: period { start, end } is required — this function has no clock");
  }
  const start = Date.parse(period.start);
  const end = Date.parse(period.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw new TypeError("monthlyReport: period start and end must be dates");
  }
  if (end <= start) throw new RangeError("monthlyReport: period end must be after start");

  const within = (t) => {
    const ms = Date.parse(t);
    return Number.isFinite(ms) && ms >= start && ms < end;   // half-open, so adjacent months never double-count
  };

  const drawable = drawableLines(lines);
  const measurable = drawable.filter((l) => utilizationOf(l) != null);
  const limitCents = measurable.reduce((s, l) => s + Number(l.credit_limit_cents), 0);
  const balanceCents = measurable.reduce((s, l) => s + Number(l.balance_cents), 0);

  const raised = alerts.filter((a) => a && within(a.raised_at));
  const resolved = alerts.filter((a) => a && a.resolved_at && within(a.resolved_at));

  const inPeriod = scores
    .filter((s) => s && within(s.scored_at) && s.score != null)
    .sort((a, b) => Date.parse(a.scored_at) - Date.parse(b.scored_at));
  const first = inPeriod[0] ?? null;
  const last = inPeriod[inPeriod.length - 1] ?? null;

  return {
    period: { start: new Date(start).toISOString(), end: new Date(end).toISOString() },
    lines_drawable: drawable.length,
    lines_measurable: measurable.length,
    lines_unmeasurable: drawable.length - measurable.length,
    total_limit: fromCents(limitCents),
    total_balance: fromCents(balanceCents),
    utilization: limitCents > 0 ? balanceCents / limitCents : null,
    alerts_raised: raised.length,
    alerts_resolved: resolved.length,
    alerts_open_at_end: alerts.filter((a) => a && within(a.raised_at) && !(a.resolved_at && within(a.resolved_at))).length,
    // null, not 0: "no score readings this month" is not "no movement".
    score_start: first ? Number(first.score) : null,
    score_end: last ? Number(last.score) : null,
    score_delta: first && last ? Number(last.score) - Number(first.score) : null
  };
}
