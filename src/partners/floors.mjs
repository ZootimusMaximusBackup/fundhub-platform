// @ts-check
// The production floor — the only filter that exists on the partner base.
//
// docs/specs/W0-decisions.md: the $10,000 entry fee is financeable down to a 405
// FICO, so entry screens NOBODY. That makes production the entire quality control,
// and the owner set the bar in one line: **10 funding clients per month. Below it,
// the partnership ends.** W1-money-model.md §6 carries the mechanism — a rolling
// 90-day half-open window, a 90-day grace from activation, the first score at day
// 180, evaluated on the 1st of each month, and a warning → final notice →
// downgrade ladder.
//
// This module is the whole of that, and the counting definition lives here ONCE.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHAT COUNTS. This is the crux, so it is written out in full.
//
// A COUNTABLE FUNDING CLIENT for partner P in window [start, end) is a distinct
// `clients.id` where ALL of these hold:
//
//   1. clients.partner_id = P — the client is on the partner's book. The tenancy
//      column from 042, not an attribution guess.
//   2. There is a `sale_payments` row with kind = 'deposit' whose product resolves
//      to `card-stacking-dfy` — the FUNDING_DFY offer's productCode, imported from
//      src/config/offers.mjs so this file cannot drift from the checkout. NOT a
//      soft pull (`diagnostic`, $32), NOT repair (`repair-bundle`,
//      `repair-trial`), NOT a course. The owner's words: someone who paid the
//      FUNDING_DFY deposit.
//   3. That payment's amount is greater than zero. A $0 receipt is a bookkeeping
//      artefact, not a client who paid.
//   4. The sale is still `active` AND the refunds recorded against it do not cover
//      its deposits. Either signal alone misses a real case: `sales.status` is set
//      by a handler and a refund row can land before it moves, while a partial
//      refund leaves a client who genuinely paid. Both are checked; a client whose
//      deposit came all the way back does not count.
//   5. Neither the sale nor the payment is demo data (148_demo_mode.sql). A
//      partner cannot clear the bar by seeding their own demo book.
//
// WHICH MONTH THE CLIENT LANDS IN: the month of their **earliest surviving
// qualifying deposit**, `MIN(paid_at)`, taken across the partner's whole book —
// not per sale and not per payment. That single choice answers all three boundary
// cases at once:
//
//   * A client who paid twice — two deposits, or a deposit plus installments —
//     counts ONCE, in the month of the first one. Instalments cannot re-count a
//     client into a later window, and a second funding sale to the same person is
//     the same client, not a new one.
//   * A client at the window edge is decided by one comparison, `first >= start
//     AND first < end`, on a half-open interval that matches
//     partner_payouts.period_start/period_end. A deposit at exactly `end` belongs
//     to the NEXT window and is counted there, never in both and never in neither.
//   * A refunded deposit is excluded before the MIN is taken, so a client whose
//     first deposit came back and who later paid again counts from the SECOND,
//     surviving deposit.
//
// The definition exists exactly once, as SQL_COUNT_FUNDING_CLIENTS. Every caller —
// the monthly job, the read endpoint, the tests — runs that string. A second
// hand-written copy of this query anywhere is a bug: two definitions of "a funding
// client" is how a partner is warned by one screen and cleared by another.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY THIS IS SAFE TO RUN AUTOMATICALLY.
//
// Because nothing it does can restate history. The ladder's only write to money is
// `UPDATE partners SET revenue_share_pct`, and every `partner_revenue` row froze
// `share_pct_applied` at accrual time (042, and src/partners/revenue.mjs rule 2).
// So a downgrade changes what LATER accruals compute and moves not one historical
// row, not one issued payout, not one printed statement. Recovery works the same
// way: a restored partner is not retroactively made whole. That symmetry is what
// makes an automatic ladder defensible.
//
// TWO THINGS THIS DELIBERATELY DOES NOT DO:
//
//   * It never touches `partners.status`. W1 §6 is explicit — 'paused' blocks
//     payouts entirely through 042's trigger, so pausing a downgraded partner
//     would withhold money they genuinely earned. They keep their book, their
//     brand, their clients, and their balance.
//   * It never promotes a partner who was never downgraded. A partner contracted
//     at 20% is at 20% because somebody signed that; a good window must not hand
//     them 50%. Restoration only ever puts back a rate THIS ladder took away, read
//     off the recorded downgrade row — never a constant.
//
// NO MONEY IS COMPUTED IN THIS FILE. Not one cent. It counts clients and moves a
// percentage, so src/commissions/money.mjs is correctly absent — there is no
// amount here for it to be the arithmetic of.
//
// COMPLIANCE REVIEW REQUIRED: this module automatically changes a partner's
// revenue-share percentage.

import { OFFERS } from "../config/offers.mjs";

/* ───────────────────────── The numbers, all named ───────────────────────── */

/** The owner's bar, W0-decisions.md: ten funding clients per month. */
export const FLOOR_CLIENTS_PER_MONTH = 10;

/** W1 §6. The window is 90 days rolling, half-open. */
export const WINDOW_DAYS = 90;

/** W1 §6. No judgement inside the first 90 days after activation — ad accounts
    take weeks to season and a partner is not scored on their ramp. */
export const GRACE_DAYS = 90;

/** W1 §6. 90 days of grace, then one COMPLETE window. Never a partial one. */
export const FIRST_EVAL_DAYS = GRACE_DAYS + WINDOW_DAYS; // 180

/** W1 §6 / D9. Three consecutive misses put the partner on the referral
    schedule: 20% direct. Their 5% downline keeps working through the affiliate
    tables. */
export const DOWNGRADED_SHARE_PCT = 20;

/** W1 §6. The final notice states a 30-day cure in plain words. */
export const CURE_DAYS = 30;

/** The rungs, in order. Exported so a screen can render them without re-deriving
    the ladder from prose. */
export const OUTCOMES = Object.freeze({
  GOOD: "good_standing",
  WARNING: "warning",
  FINAL_NOTICE: "final_notice",
  DOWNGRADE: "downgrade",
  RESTORED: "restored"
});

/** The FUNDING_DFY product code, read from the offer catalogue rather than typed
    here. If checkout ever renames the product this file follows it instead of
    silently counting nobody. */
export const FUNDING_DEPOSIT_PRODUCT_CODE = String(OFFERS.FUNDING_DFY.productCode)
  .trim()
  .toLowerCase();

/** One greppable prefix per refusal that changes somebody's commercial terms. */
export const FLOOR_SKIPPED = "[partner-floor] evaluation skipped";
export const FLOOR_FAILED = "[partner-floor] evaluation failed";

const DAY_MS = 86_400_000;

/* ───────────────────────────── Pure helpers ────────────────────────────── */

/** @param {unknown} v @returns {Date|null} */
function asDate(v) {
  if (v === null || v === undefined || v === "") return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** @param {Date} d @param {number} days */
function addDays(d, days) {
  return new Date(d.getTime() + days * DAY_MS);
}

/**
 * PURE. The bar for a window of this length, from the monthly headline number.
 *
 * The owner set a MONTHLY figure and W1 §6 measures over 90 days, so the two have
 * to be composed rather than picked between: ten a month over a 90-day window is
 * thirty. Rounded UP, because a floor that rounds down is a floor a partner can
 * sit just under — and the rounding only ever bites on a window length that is not
 * a whole number of months, which today is none of them.
 *
 * @param {{floorPerMonth?: number, windowDays?: number}} [opts]
 */
export function windowFloor({
  floorPerMonth = FLOOR_CLIENTS_PER_MONTH, windowDays = WINDOW_DAYS
} = {}) {
  if (!Number.isFinite(floorPerMonth) || floorPerMonth < 0) {
    throw new RangeError(`windowFloor: floorPerMonth must be a non-negative number: ${floorPerMonth}`);
  }
  if (!Number.isFinite(windowDays) || windowDays <= 0) {
    throw new RangeError(`windowFloor: windowDays must be positive: ${windowDays}`);
  }
  return Math.ceil((floorPerMonth * windowDays) / 30);
}

/**
 * PURE. The window this evaluation scores, half-open [start, end).
 *
 * The end is pinned to the START OF THE UTC MONTH containing `asOf`, not to the
 * instant the job happens to run. Two consequences, both wanted:
 *
 *   * The job is idempotent within the month. A re-run on the 1st at 14:00, a
 *     manual run on the 9th, and a retry after a crash all produce the same
 *     window_end — which is the column the unique index in 282 stands on, so the
 *     second write is a no-op instead of another rung down the ladder.
 *   * No window is ever partial. The boundary is a real month boundary, so
 *     "evaluated on the 1st" means the same thing whatever time zone the operator
 *     is in.
 *
 * UTC, deliberately, and stated rather than assumed: every timestamp in this
 * database is timestamptz, and a local-midnight boundary would move twice a year.
 *
 * @param {Date|string|number|null} asOf
 * @param {{windowDays?: number}} [opts]
 * @returns {{start: Date, end: Date}}
 */
export function windowFor(asOf, { windowDays = WINDOW_DAYS } = {}) {
  const at = asDate(asOf) || new Date();
  const end = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1, 0, 0, 0, 0));
  return { start: addDays(end, -windowDays), end };
}

/**
 * PURE. May this partner be scored for this window yet?
 *
 * Two conditions, checked separately so the refusal names which one bit:
 *
 *   grace       — the window must begin at or after activation + 90 days. A
 *                 window that reaches back into the ramp is a window that scores
 *                 the ramp.
 *   first_eval  — the window must end at or after activation + 180 days. Implied
 *                 by the grace test for a 90-day window, and checked anyway,
 *                 because the two are separate rules in the spec and a future
 *                 window length would separate them in fact.
 *
 * A NULL activation date is UNKNOWN and stays unknown: 'no_activation_date', never
 * a substituted created_at. Guessing when a partner started is guessing when to
 * start cutting their share.
 *
 * @param {{activatedAt?: unknown, status?: unknown, windowStart?: Date|null,
 *          windowEnd?: Date|null, graceDays?: number, firstEvalDays?: number}} args
 * @returns {{due: boolean, reason: string|null}}
 */
export function isDue({
  activatedAt = null, status = null, windowStart = null, windowEnd = null,
  graceDays = GRACE_DAYS, firstEvalDays = FIRST_EVAL_DAYS
} = {}) {
  // Only a live partnership is judged. 'invited' has no book yet and 'paused' is
  // already suspended — scoring either would be scoring a partner who is not
  // trading.
  if (status !== null && status !== undefined && String(status) !== "active") {
    return { due: false, reason: "not_active" };
  }
  const activated = asDate(activatedAt);
  if (!activated) return { due: false, reason: "no_activation_date" };

  const start = asDate(windowStart);
  const end = asDate(windowEnd);
  if (!start || !end) return { due: false, reason: "no_window" };

  if (start.getTime() < addDays(activated, graceDays).getTime()) {
    return { due: false, reason: "in_grace" };
  }
  if (end.getTime() < addDays(activated, firstEvalDays).getTime()) {
    return { due: false, reason: "before_first_evaluation" };
  }
  return { due: true, reason: null };
}

/**
 * PURE. One rung of the ladder. No database, no clock — everything comes in.
 *
 *   met, 0 prior misses ........ good_standing
 *   met, after a downgrade ..... restored, share put back to what was taken
 *   miss 1 ..................... warning
 *   miss 2 ..................... final_notice, 30-day cure from the window end
 *   miss 3 ..................... downgrade, 50 → 20 on NEW business only
 *   miss 4+ while downgraded ... downgrade recorded, share unchanged
 *
 * `priorDowngradeFrom` is the share percentage the last recorded downgrade took
 * this partner OFF (partner_production_reviews.share_pct_before), or null if this
 * ladder has never downgraded them. It is the only thing a restore may put back —
 * see the module header for why a constant would be wrong.
 *
 * Throws on a missing current share, because every rung needs it to decide and a
 * silent 0 would read as "this partner earns nothing" (the exact trap
 * src/partners/revenue.mjs guards with unknown_share_pct).
 *
 * @param {{met: boolean, priorMisses?: number, currentSharePct?: unknown,
 *          priorDowngradeFrom?: unknown, windowEnd?: Date|string|null,
 *          downgradeToPct?: number, cureDays?: number}} args
 */
export function nextLadderState({
  met, priorMisses = 0, currentSharePct = null, priorDowngradeFrom = null,
  windowEnd = null, downgradeToPct = DOWNGRADED_SHARE_PCT, cureDays = CURE_DAYS
} = /** @type {any} */ ({})) {
  const current = Number(currentSharePct);
  if (currentSharePct === null || currentSharePct === undefined ||
      currentSharePct === "" || !Number.isFinite(current)) {
    throw new RangeError(
      "nextLadderState: currentSharePct is required — an unknown share cannot be laddered"
    );
  }
  const misses = Number.isFinite(Number(priorMisses)) ? Math.max(0, Number(priorMisses)) : 0;
  const end = asDate(windowEnd);

  if (met) {
    const restoreTo = priorDowngradeFrom === null || priorDowngradeFrom === undefined
      ? null
      : Number(priorDowngradeFrom);
    // Restore only a rate this ladder actually took away, and only if the partner
    // is still sitting below it. A partner contracted at 20 was never downgraded,
    // has no downgrade row, and is left exactly where their agreement put them.
    if (restoreTo !== null && Number.isFinite(restoreTo) && current < restoreTo) {
      return {
        outcome: OUTCOMES.RESTORED,
        consecutiveMisses: 0,
        sharePctBefore: current,
        sharePctAfter: restoreTo,
        cureDueAt: null,
        note: "one full window at or above the floor after a downgrade"
      };
    }
    return {
      outcome: OUTCOMES.GOOD, consecutiveMisses: 0,
      sharePctBefore: null, sharePctAfter: null, cureDueAt: null, note: null
    };
  }

  const nextMisses = misses + 1;

  if (nextMisses === 1) {
    return {
      outcome: OUTCOMES.WARNING, consecutiveMisses: 1,
      sharePctBefore: null, sharePctAfter: null, cureDueAt: null,
      note: "first window below the production floor"
    };
  }

  if (nextMisses === 2) {
    return {
      outcome: OUTCOMES.FINAL_NOTICE, consecutiveMisses: 2,
      sharePctBefore: null, sharePctAfter: null,
      // The cure runs from the window that failed, not from whenever the job
      // happened to run, so a late job does not shorten the partner's 30 days.
      cureDueAt: end ? addDays(end, cureDays) : null,
      note: `second consecutive window below the floor — ${cureDays}-day cure`
    };
  }

  const target = Number(downgradeToPct);
  if (!Number.isFinite(target)) {
    throw new RangeError(`nextLadderState: downgradeToPct must be a number: ${downgradeToPct}`);
  }
  // Already on the referral schedule. The row records the standing; it does not
  // cut anything a second time, and share before === after says so plainly.
  if (current <= target) {
    return {
      outcome: OUTCOMES.DOWNGRADE, consecutiveMisses: nextMisses,
      sharePctBefore: current, sharePctAfter: current, cureDueAt: null,
      note: "already on the referral schedule — no further reduction"
    };
  }
  return {
    outcome: OUTCOMES.DOWNGRADE, consecutiveMisses: nextMisses,
    sharePctBefore: current, sharePctAfter: target, cureDueAt: null,
    note: "third consecutive window below the floor — referral schedule on new business only"
  };
}

/* ─────────────────── THE definition, in exactly one place ─────────────────── */

/**
 * SQL_COUNT_FUNDING_CLIENTS — what a funding client is, and which window it lands
 * in. See the module header for the rule in words; this is the same rule in SQL,
 * and it is the only copy.
 *
 * $1 org_id, $2 partner_id, $3 product code, $4 window start, $5 window end.
 *
 * The inner query takes MIN(paid_at) per client across the partner's WHOLE book
 * and the outer one windows it, rather than filtering by date first. Filtering
 * first would count a client's second deposit as a first one whenever the real
 * first fell outside the window — the same person counted twice, one window apart.
 */
export const SQL_COUNT_FUNDING_CLIENTS = `
  WITH surviving AS (
    SELECT c.id AS client_id, MIN(sp.paid_at) AS first_deposit_at
      FROM clients c
      JOIN sales s          ON s.client_id = c.id AND s.org_id = c.org_id
      JOIN sale_payments sp ON sp.sale_id  = s.id AND sp.org_id = s.org_id
      JOIN products p       ON p.id = sp.product_id
     WHERE c.org_id     = $1
       AND c.partner_id = $2
       AND sp.kind = 'deposit'
       AND lower(btrim(p.code)) = $3
       AND sp.amount > 0
       AND s.status = 'active'
       AND s.is_demo = false
       AND sp.is_demo = false
       -- Fully refunded: the money came back, so nobody paid the deposit. A
       -- PARTIAL refund leaves a paying client and is deliberately not excluded.
       AND NOT EXISTS (
         SELECT 1
           FROM sale_payments r
          WHERE r.sale_id = s.id AND r.org_id = s.org_id
         HAVING COALESCE(SUM(r.amount) FILTER (WHERE r.kind = 'refund'), 0)
             >= COALESCE(SUM(r.amount) FILTER (WHERE r.kind = 'deposit'), 0)
       )
     GROUP BY c.id
  )
  SELECT count(*)::int AS funding_clients
    FROM surviving
   WHERE first_deposit_at >= $4
     AND first_deposit_at <  $5`;

/**
 * Count the partner's countable funding clients in [start, end).
 *
 * @param {{query: Function}} db
 * @param {{orgId?: string|null, partnerId?: string|null, start?: Date|string|null,
 *          end?: Date|string|null, productCode?: string}} args
 * @returns {Promise<number>}
 */
export async function countFundingClients(db, {
  orgId = null, partnerId = null, start = null, end = null,
  productCode = FUNDING_DEPOSIT_PRODUCT_CODE
} = {}) {
  if (!db) throw new Error("countFundingClients: db is required");
  if (!orgId || !partnerId) throw new Error("countFundingClients: orgId and partnerId are required");
  const s = asDate(start), e = asDate(end);
  if (!s || !e) throw new RangeError("countFundingClients: start and end are required");
  const { rows } = await db.query(SQL_COUNT_FUNDING_CLIENTS, [
    orgId, partnerId, String(productCode).trim().toLowerCase(), s, e
  ]);
  return Number(rows[0]?.funding_clients || 0);
}

/* ───────────────────────────── The evaluation ───────────────────────────── */

const SQL_PARTNER = `
  SELECT id, org_id, name, brand_name, status, revenue_share_pct, activated_at
    FROM partners
   WHERE id = $1 AND org_id = $2
   LIMIT 1`;

/** The previous review, whatever its outcome — where consecutive_misses is
    carried from. Newest window first. */
const SQL_LAST_REVIEW = `
  SELECT window_end, outcome, consecutive_misses, met
    FROM partner_production_reviews
   WHERE org_id = $1 AND partner_id = $2 AND window_end < $3
   ORDER BY window_end DESC
   LIMIT 1`;

/** The most recent row where this ladder MOVED the share. If it was a downgrade,
    share_pct_before is the only rate a restore may put back; if it was already a
    restore, there is nothing left to restore. */
const SQL_LAST_SHARE_MOVE = `
  SELECT outcome, share_pct_before, share_pct_after
    FROM partner_production_reviews
   WHERE org_id = $1 AND partner_id = $2
     AND outcome IN ('downgrade', 'restored')
     AND share_pct_before IS DISTINCT FROM share_pct_after
   ORDER BY window_end DESC
   LIMIT 1`;

const SQL_INSERT_REVIEW = `
  INSERT INTO partner_production_reviews
    (org_id, partner_id, window_start, window_end, evaluated_at, funding_clients,
     floor_per_month, floor_clients, met, consecutive_misses, outcome,
     share_pct_before, share_pct_after, cure_due_at, notes)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
  ON CONFLICT DO NOTHING
  RETURNING id, outcome, funding_clients, floor_clients, consecutive_misses,
            share_pct_before, share_pct_after, cure_due_at, window_start, window_end`;

/* The share move. Guarded on the value we believe we are moving off, so a
   concurrent edit by an operator wins rather than being silently overwritten by a
   job that read the old number a second earlier. Zero rows updated is reported,
   not swallowed. */
const SQL_MOVE_SHARE = `
  UPDATE partners
     SET revenue_share_pct = $3, updated_at = now()
   WHERE id = $1 AND org_id = $2 AND revenue_share_pct = $4
   RETURNING revenue_share_pct`;

/**
 * The shape every evaluation returns, decided once so a caller can read a result
 * without knowing which branch produced it. `evaluated: false` with a `reason` is
 * a refusal — 'no_activation_date', 'in_grace', 'already_reviewed', 'dry_run' —
 * and every one of those is the rule working, not a failure.
 *
 * @typedef {object} FloorDecision
 * @property {boolean} evaluated
 * @property {string|null} reason
 * @property {string} [partnerId]
 * @property {string} [orgId]
 * @property {string|null} [partnerName]
 * @property {Date} [windowStart]
 * @property {Date} [windowEnd]
 * @property {number} [fundingClients]
 * @property {number} [floorClients]
 * @property {number} [floorPerMonth]
 * @property {boolean} [met]
 * @property {string} [outcome]
 * @property {number} [consecutiveMisses]
 * @property {number|null} [sharePctBefore]
 * @property {number|null} [sharePctAfter]
 * @property {Date|null} [cureDueAt]
 * @property {string|null} [note]
 * @property {string} [reviewId]
 * @property {boolean} [shareMoved]
 * @property {string} [error]
 */

/**
 * Evaluate ONE partner for the window ending at the start of `asOf`'s month.
 *
 * Writes at most one partner_production_reviews row and, on the two rungs that
 * move money, one UPDATE to partners.revenue_share_pct. Everything else is a read.
 *
 * `apply: false` computes and returns the whole decision and writes NOTHING — the
 * shape an operator wants before letting this loose on a live book, and the shape
 * the read endpoint uses to show a partner where they currently stand.
 *
 * @param {{query: Function}} db
 * @param {{orgId?: string|null, partnerId?: string|null, asOf?: Date|string|null,
 *          floorPerMonth?: number, windowDays?: number, apply?: boolean}} args
 * @returns {Promise<FloorDecision>}
 */
export async function evaluatePartner(db, {
  orgId = null, partnerId = null, asOf = null,
  floorPerMonth = FLOOR_CLIENTS_PER_MONTH, windowDays = WINDOW_DAYS, apply = true
} = {}) {
  if (!db) throw new Error("evaluatePartner: db is required");
  if (!orgId || !partnerId) return { evaluated: false, reason: "missing_context" };

  const partner = (await db.query(SQL_PARTNER, [partnerId, orgId])).rows[0] || null;
  if (!partner) return { evaluated: false, reason: "no_partner" };

  const { start, end } = windowFor(asOf, { windowDays });
  const due = isDue({
    activatedAt: partner.activated_at, status: partner.status,
    windowStart: start, windowEnd: end
  });
  if (!due.due) {
    return {
      evaluated: false, reason: due.reason, partnerId, orgId,
      windowStart: start, windowEnd: end
    };
  }

  // 042 makes revenue_share_pct NOT NULL, so this is a corrupt row rather than a
  // normal absence — and a corrupt rate must never be read as zero.
  if (partner.revenue_share_pct === null || partner.revenue_share_pct === undefined) {
    console.warn(
      `${FLOOR_SKIPPED}: unknown_share_pct (org=${orgId} partner=${partnerId}). ` +
      `The partner row carries no revenue share, so no ladder decision was made.`
    );
    return { evaluated: false, reason: "unknown_share_pct", partnerId, orgId };
  }

  const floorClients = windowFloor({ floorPerMonth, windowDays });
  const count = await countFundingClients(db, { orgId, partnerId, start, end });
  const met = count >= floorClients;

  const last = (await db.query(SQL_LAST_REVIEW, [orgId, partnerId, end])).rows[0] || null;
  const move = (await db.query(SQL_LAST_SHARE_MOVE, [orgId, partnerId])).rows[0] || null;
  const priorDowngradeFrom =
    move && String(move.outcome) === "downgrade" ? Number(move.share_pct_before) : null;

  const state = nextLadderState({
    met,
    priorMisses: last ? Number(last.consecutive_misses || 0) : 0,
    currentSharePct: partner.revenue_share_pct,
    priorDowngradeFrom,
    windowEnd: end,
    cureDays: CURE_DAYS
  });

  const decision = {
    partnerId, orgId,
    partnerName: partner.brand_name || partner.name || null,
    windowStart: start, windowEnd: end,
    fundingClients: count, floorClients, floorPerMonth, met,
    outcome: state.outcome,
    consecutiveMisses: state.consecutiveMisses,
    sharePctBefore: state.sharePctBefore,
    sharePctAfter: state.sharePctAfter,
    cureDueAt: state.cureDueAt,
    note: state.note
  };

  if (!apply) return { evaluated: false, reason: "dry_run", ...decision };

  const ins = await db.query(SQL_INSERT_REVIEW, [
    orgId, partnerId, start, end, new Date(), count,
    floorPerMonth, floorClients, met, state.consecutiveMisses, state.outcome,
    state.sharePctBefore, state.sharePctAfter, state.cureDueAt, state.note
  ]);

  // ON CONFLICT DO NOTHING against ppr_partner_window_uniq. A second pass in the
  // same month is the idempotency guard working, not a failure — and critically,
  // the share is NOT moved again, so a re-run cannot ratchet a partner down.
  if (!ins.rows[0]) {
    return { evaluated: false, reason: "already_reviewed", ...decision };
  }

  let shareMoved = false;
  if (state.sharePctAfter !== null && state.sharePctBefore !== null &&
      Number(state.sharePctAfter) !== Number(state.sharePctBefore)) {
    const upd = await db.query(SQL_MOVE_SHARE, [
      partnerId, orgId, state.sharePctAfter, state.sharePctBefore
    ]);
    shareMoved = upd.rows.length > 0;
    if (!shareMoved) {
      // Somebody changed the rate between the read and the write. The review row
      // stands as the record of the decision; the rate is left where the human
      // put it, and this is said out loud rather than retried.
      console.warn(
        `${FLOOR_SKIPPED}: share_move_conflict (org=${orgId} partner=${partnerId} ` +
        `expected=${state.sharePctBefore}). The review was recorded; the revenue ` +
        `share was changed by somebody else and has been left alone.`
      );
    }
  }

  return { evaluated: true, reason: null, reviewId: ins.rows[0].id, shareMoved, ...decision };
}

const SQL_ACTIVE_PARTNERS = `
  SELECT id, org_id
    FROM partners
   WHERE status = 'active'
     AND activated_at IS NOT NULL
     AND ($1::uuid IS NULL OR org_id = $1)
   ORDER BY org_id, id`;

/**
 * Evaluate every active partner with a known activation date.
 *
 * NEVER THROWS PAST ONE PARTNER. A partner whose evaluation blows up must not stop
 * the other partners being scored — a job that dies on the third of forty leaves
 * thirty-seven partners silently unjudged for a month. The failure is counted,
 * named and returned.
 *
 * @param {{query: Function}} db
 * @param {{orgId?: string|null, asOf?: Date|string|null, floorPerMonth?: number,
 *          windowDays?: number, apply?: boolean, limit?: number}} [args]
 */
export async function evaluateAllPartners(db, {
  orgId = null, asOf = null, floorPerMonth = FLOOR_CLIENTS_PER_MONTH,
  windowDays = WINDOW_DAYS, apply = true, limit = 0
} = {}) {
  if (!db) throw new Error("evaluateAllPartners: db is required");
  const { rows } = await db.query(SQL_ACTIVE_PARTNERS, [orgId]);
  const targets = limit > 0 ? rows.slice(0, limit) : rows;

  /** @type {FloorDecision[]} */
  const results = [];
  /** @type {Record<string, number>} */
  const counts = {
    considered: targets.length, evaluated: 0, skipped: 0, failed: 0,
    good_standing: 0, warning: 0, final_notice: 0, downgrade: 0, restored: 0,
    downgraded_shares: 0, restored_shares: 0
  };

  for (const p of targets) {
    try {
      const r = await evaluatePartner(db, {
        orgId: p.org_id, partnerId: p.id, asOf, floorPerMonth, windowDays, apply
      });
      results.push(r);
      if (r.evaluated) {
        counts.evaluated += 1;
        if (r.outcome && counts[r.outcome] !== undefined) counts[r.outcome] += 1;
        if (r.shareMoved && r.outcome === OUTCOMES.DOWNGRADE) counts.downgraded_shares += 1;
        if (r.shareMoved && r.outcome === OUTCOMES.RESTORED) counts.restored_shares += 1;
      } else {
        counts.skipped += 1;
      }
    } catch (err) {
      counts.failed += 1;
      const msg = String((err && err.message) || err).slice(0, 300);
      console.warn(`${FLOOR_FAILED}: ${msg} (org=${p.org_id} partner=${p.id}).`);
      results.push({ evaluated: false, reason: "error", partnerId: p.id, orgId: p.org_id, error: msg });
    }
  }

  return { ...counts, results };
}

const SQL_LATEST_REVIEW = `
  SELECT id, window_start, window_end, evaluated_at, funding_clients,
         floor_per_month, floor_clients, met, consecutive_misses, outcome,
         share_pct_before, share_pct_after, cure_due_at, notes
    FROM partner_production_reviews
   WHERE org_id = $1 AND partner_id = $2
   ORDER BY window_end DESC
   LIMIT $3`;

/**
 * What a partner's portal banner needs: the last recorded judgement, plus a LIVE
 * count of the window in progress so the banner can say how far off the bar they
 * are today rather than only how far off they were on the 1st.
 *
 * `current` is a dry run — it writes nothing and moves nothing.
 *
 * @param {{query: Function}} db
 * @param {{orgId?: string|null, partnerId?: string|null, asOf?: Date|string|null,
 *          history?: number, floorPerMonth?: number, windowDays?: number}} args
 */
export async function standingFor(db, {
  orgId = null, partnerId = null, asOf = null, history = 6,
  floorPerMonth = FLOOR_CLIENTS_PER_MONTH, windowDays = WINDOW_DAYS
} = {}) {
  if (!db) throw new Error("standingFor: db is required");
  if (!orgId || !partnerId) throw new Error("standingFor: orgId and partnerId are required");

  const limit = Math.min(Math.max(Number(history) || 1, 1), 24);
  const reviews = (await db.query(SQL_LATEST_REVIEW, [orgId, partnerId, limit])).rows;

  // The window in progress: the 90 days ending NOW, not the last completed month.
  const at = asDate(asOf) || new Date();
  const liveStart = addDays(at, -windowDays);
  const floorClients = windowFloor({ floorPerMonth, windowDays });
  const liveCount = await countFundingClients(db, {
    orgId, partnerId, start: liveStart, end: at
  });

  const latest = reviews[0] || null;
  return {
    partnerId,
    floorPerMonth,
    floorClients,
    windowDays,
    // NULL means "never evaluated", which is a different answer from "evaluated
    // and in good standing" and must not render as the second one.
    latest,
    history: reviews,
    current: {
      windowStart: liveStart,
      windowEnd: at,
      fundingClients: liveCount,
      met: liveCount >= floorClients,
      shortBy: Math.max(0, floorClients - liveCount)
    }
  };
}

export default evaluatePartner;
