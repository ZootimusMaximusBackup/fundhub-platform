// Alert and upsell evaluators. Pure: no database, no clock, no I/O.
//
// Every function here takes a snapshot and returns findings. None of them
// writes, notifies, or contacts anybody — turning a finding into an `alerts`
// row (078) or an `upsell_triggers` row (079) is the caller's job, and turning
// one into a message is nobody's job yet, because nothing in this repo
// transmits.
//
//
// THE ONE RULE THAT MATTERS: A FINDING IS NEVER PRODUCED FROM DATA WE DO NOT
// HAVE.
//
// This is a credit product. The inputs are chronically incomplete — a bureau
// file that omits a limit, a card whose balance nobody has refreshed, a client
// with two known cards out of nine. The tempting failure is to treat a missing
// number as a harmless zero, because the arithmetic still runs and the output
// still looks like an answer. It is not harmless:
//
//   * A missing LIMIT read as 0 makes utilization infinite. The client looks
//     maxed out when nothing is known about them.
//   * A missing BALANCE read as 0 makes utilization 0%. The client looks
//     pristine, and a "you have room, borrow more" opportunity gets raised
//     against a card that may already be full.
//
// Both directions are wrong and the second is worse, because it is advice. So
// every function below reports what it could not see, alongside what it found,
// and refuses to produce a finding whose evidence is a gap. `unknown` is a
// first-class output here, not an error path.
//
// AGGREGATES USE ONLY COMPLETE CARDS. Summing known balances over known-plus-
// unknown limits produces a ratio with a numerator and denominator drawn from
// different populations. That number is not a worse estimate — it is not a
// measurement of anything. Cards missing either side are counted and named, and
// left out of the ratio.

/* Default threshold, matching calcFunding()'s (src/calculators/deal-funding.mjs)
   so the two do not disagree about what "high utilization" means on the same
   screen. Per-org configurable there, and passed in here for the same reason. */
export const DEFAULT_UTILIZATION_THRESHOLD = 0.30;

/* The threshold above which a card is treated as effectively maxed. Distinct
   from the org threshold, which is a policy about healthy usage; this is close
   to the ceiling. */
export const NEAR_LIMIT_THRESHOLD = 0.90;

/* The vocabulary this module emits. alerts.kind and upsell_triggers.trigger_kind
   are free text in the schema precisely so this list can grow without a
   migration — which makes THIS the one place the vocabulary is defined. */
export const ALERT_KINDS = Object.freeze({
  UTILIZATION_HIGH: "utilization_high",
  CARD_NEAR_LIMIT: "card_near_limit",
  SCORE_DROP: "score_drop"
});

export const UPSELL_KINDS = Object.freeze({
  CARD_LIMIT_INCREASE: "card_limit_increase"
});

/* A finite, non-negative number, or null. Everything else — undefined, "", NaN,
   "n/a", a negative limit — is unknown, not zero. Strings are accepted because
   pg returns bigint and numeric as strings. */
function num(v) {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function round(x, places) {
  const f = 10 ** places;
  return Math.round(x * f) / f;
}

/* Read a card in either of the two shapes this repo stores money in: integer
   cents (tradelines, 054) or plain dollars (the calculator's own shape). The
   ratio is unit-free, so mixing is safe within a card and never across one —
   which is why each side is read independently and both must be present. */
function readCard(card) {
  const limit = num(card?.creditLimitCents ?? card?.credit_limit_cents ?? card?.creditLimit ?? card?.credit_limit);
  const balance = num(card?.balanceCents ?? card?.balance_cents ?? card?.currentBalance ?? card?.balance);
  return {
    lender: card?.lender ?? null,
    accountRef: card?.accountRef ?? card?.account_ref ?? null,
    limit,
    balance,
    // A zero limit is a real stored value and it is NOT a divisor. Utilization
    // against a zero limit is undefined, not infinite and not 100%.
    utilization: limit != null && balance != null && limit > 0 ? round(balance / limit, 4) : null
  };
}

/* Why a card produced no utilization, in the caller's words rather than a
   silent omission. A screen that shows "3 cards not counted" and cannot say why
   is only marginally better than one that hid them. */
function missingReason(c) {
  if (c.limit == null && c.balance == null) return "no limit and no balance on file";
  if (c.limit == null) return "no credit limit on file";
  if (c.balance == null) return "no balance on file";
  if (c.limit === 0) return "credit limit is zero — utilization is undefined, not 100%";
  return null;
}

/**
 * evaluateUtilization — how much of the known credit line is in use, and what
 * that is worth saying out loud.
 *
 * Returns { aggregate, cards, unknown, findings }. `findings` is empty whenever
 * the evidence is a gap; `unknown` is never empty in that case, so a caller can
 * always tell "nothing wrong" from "nothing known".
 */
export function evaluateUtilization({
  cards = [],
  threshold = DEFAULT_UTILIZATION_THRESHOLD,
  nearLimit = NEAR_LIMIT_THRESHOLD
} = {}) {
  const t = num(threshold) ?? DEFAULT_UTILIZATION_THRESHOLD;
  const nl = num(nearLimit) ?? NEAR_LIMIT_THRESHOLD;

  const read = (Array.isArray(cards) ? cards : []).map(readCard);
  const complete = read.filter((c) => c.utilization != null);
  const unknown = read
    .filter((c) => c.utilization == null)
    .map((c) => ({ lender: c.lender, accountRef: c.accountRef, reason: missingReason(c) }));

  // Only complete cards. See the header — a ratio over two different
  // populations is not a measurement.
  const totalLimit = complete.reduce((s, c) => s + c.limit, 0);
  const totalBalance = complete.reduce((s, c) => s + c.balance, 0);

  const aggregate = {
    utilization: totalLimit > 0 ? round(totalBalance / totalLimit, 4) : null,
    totalLimit: complete.length ? totalLimit : null,
    totalBalance: complete.length ? totalBalance : null,
    cardsCounted: complete.length,
    cardsNotCounted: unknown.length,
    threshold: t,
    // The honest headline. A caller must be able to say "this is based on 2 of
    // your 9 cards" without recomputing it.
    complete: read.length > 0 && unknown.length === 0
  };

  const findings = [];

  if (aggregate.utilization != null && aggregate.utilization > t) {
    findings.push({
      kind: ALERT_KINDS.UTILIZATION_HIGH,
      // A partial picture is never critical. We do not know enough to be sure,
      // and a critical alert on 2 of 9 cards is a confident wrong answer.
      severity: aggregate.complete ? "warn" : "info",
      message: aggregate.complete
        ? `Aggregate utilization is ${(aggregate.utilization * 100).toFixed(1)}% across ${complete.length} card(s), above the ${(t * 100).toFixed(0)}% threshold.`
        : `Aggregate utilization is ${(aggregate.utilization * 100).toFixed(1)}% across the ${complete.length} card(s) with complete data, above the ${(t * 100).toFixed(0)}% threshold. ${unknown.length} card(s) could not be counted.`,
      dedupeKey: `utilization:${t}`,
      evidence: { ...aggregate, unknown }
    });
  }

  for (const c of complete) {
    if (c.utilization > nl) {
      findings.push({
        kind: ALERT_KINDS.CARD_NEAR_LIMIT,
        severity: "warn",
        message: `${c.lender ?? "A card"} is at ${(c.utilization * 100).toFixed(1)}% of its limit.`,
        // Per card, so two maxed cards are two findings and refreshing the same
        // card is one. accountRef first because a lender name is not unique.
        dedupeKey: `near_limit:${c.accountRef ?? c.lender ?? "unknown"}`,
        evidence: { lender: c.lender, accountRef: c.accountRef, utilization: c.utilization, limit: c.limit, balance: c.balance, nearLimit: nl }
      });
    }
  }

  return { aggregate, cards: complete, unknown, findings };
}

/**
 * evaluateScore — did the score move, and by enough to say something.
 *
 * Both scores must be present. A first-ever score has nothing to compare
 * against and produces no finding — "your score changed" is meaningless without
 * a previous one, and defaulting the previous to 0 would report every new client
 * as having gained 700 points.
 */
export function evaluateScore({ current, previous, dropPoints = 20, bureau = null, asOf = null } = {}) {
  const cur = num(current);
  const prev = num(previous);
  const drop = num(dropPoints) ?? 20;

  if (cur == null || prev == null) {
    return {
      delta: null,
      direction: "unknown",
      // Named, so a screen can say which half is missing instead of showing a
      // blank where a number belongs.
      reason: cur == null && prev == null
        ? "no score on file"
        : cur == null ? "no current score on file" : "no earlier score to compare against",
      findings: []
    };
  }

  const delta = round(cur - prev, 0);
  const direction = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  const findings = [];

  if (delta <= -drop) {
    findings.push({
      kind: ALERT_KINDS.SCORE_DROP,
      severity: "warn",
      // States what moved. Says nothing about why, and nothing about what
      // happens next — this repo does not draft claims about credit outcomes.
      message: `Score fell ${Math.abs(delta)} points, from ${prev} to ${cur}.`,
      dedupeKey: `score_drop:${bureau ?? "any"}:${prev}->${cur}`,
      evidence: { current: cur, previous: prev, delta, dropPoints: drop, bureau, asOf }
    });
  }

  return { delta, direction, current: cur, previous: prev, bureau, asOf, findings };
}

/**
 * suggestCardUpgrade — cards where a limit increase is worth asking about.
 *
 * THE SHAPE OF THE OPPORTUNITY: a card carrying real balance against a small
 * limit. Raising that limit lowers utilization on the same debt.
 *
 * WHAT THIS DELIBERATELY WILL NOT DO. It will not suggest anything for a card
 * whose limit or balance is unknown. That is the whole reason this function
 * exists separately from a filter: the naive version treats a missing balance as
 * 0, sees a small limit and no debt, and recommends an increase to somebody who
 * may already be maxed. Every suggestion here rests on two numbers we actually
 * have.
 *
 * Confidence reflects how much of the file was visible, and is deliberately not
 * used to hide anything — see 079's header.
 */
export function suggestCardUpgrade({
  cards = [],
  threshold = DEFAULT_UTILIZATION_THRESHOLD,
  minBalance = 0
} = {}) {
  const t = num(threshold) ?? DEFAULT_UTILIZATION_THRESHOLD;
  const floor = num(minBalance) ?? 0;

  const read = (Array.isArray(cards) ? cards : []).map(readCard);
  const complete = read.filter((c) => c.utilization != null);
  const unknown = read.filter((c) => c.utilization == null).length;

  // How much of the picture we can see. With nothing visible there is no
  // confidence to express, and null is the honest value — not 0, which would
  // read as "certain this is a bad fit".
  const visibility = read.length ? round(complete.length / read.length, 3) : null;

  const suggestions = complete
    .filter((c) => c.utilization > t && c.balance > floor)
    .map((c) => ({
      kind: UPSELL_KINDS.CARD_LIMIT_INCREASE,
      lender: c.lender,
      accountRef: c.accountRef,
      // Internal. 079's header: never rendered to a consumer.
      rationale: `${c.lender ?? "Card"} is at ${(c.utilization * 100).toFixed(1)}% of a ${c.limit} limit. A limit increase lowers utilization on the same balance.`,
      confidence: visibility,
      dedupeKey: `limit_increase:${c.accountRef ?? c.lender ?? "unknown"}`,
      evidence: {
        lender: c.lender, accountRef: c.accountRef,
        limit: c.limit, balance: c.balance, utilization: c.utilization,
        threshold: t, cardsVisible: complete.length, cardsTotal: read.length
      }
    }));

  return { suggestions, cardsConsidered: complete.length, cardsSkipped: unknown, visibility };
}

/**
 * monthlyReport — one month's findings, assembled.
 *
 * Assembles; does not compute anything new and invents no number. Everything in
 * the output came from the evaluators above or from the caller, which is what
 * makes it checkable. `period` is passed in rather than derived from a clock —
 * this module has no clock, so a report is reproducible and a test does not
 * depend on the date it runs.
 */
export function monthlyReport({
  period = null,
  cards = [],
  score = {},
  threshold = DEFAULT_UTILIZATION_THRESHOLD
} = {}) {
  const utilization = evaluateUtilization({ cards, threshold });
  const scoreResult = evaluateScore({ ...score });
  const upsell = suggestCardUpgrade({ cards, threshold });

  const findings = [...utilization.findings, ...scoreResult.findings];
  const rank = { critical: 0, warn: 1, info: 2 };
  findings.sort((a, b) => rank[a.severity] - rank[b.severity]);

  // What the report could NOT see, in one place. A monthly summary that omits
  // its own blind spots is the most misleading artifact this module could
  // produce — it is the one a client is most likely to be shown.
  const gaps = [];
  if (utilization.unknown.length) {
    gaps.push(`${utilization.unknown.length} card(s) were not counted: ${
      [...new Set(utilization.unknown.map((u) => u.reason))].join("; ")}.`);
  }
  if (scoreResult.direction === "unknown") gaps.push(`Score movement unavailable — ${scoreResult.reason}.`);

  return {
    period,
    utilization: utilization.aggregate,
    score: { delta: scoreResult.delta, direction: scoreResult.direction, current: scoreResult.current ?? null, previous: scoreResult.previous ?? null },
    findings,
    upsell: upsell.suggestions,
    gaps,
    // True only when every input was complete. A caller may present a partial
    // report; it may not present one as whole.
    complete: gaps.length === 0
  };
}
