// Subscriptions — the billing cycle, as arithmetic. No database, no processor,
// no clock of its own.
//
// COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7): payment rails and fee timing.
// Nothing in this file moves money. It decides WHETHER a row is billable, WHAT
// period the next charge buys, WHAT key identifies that charge, and WHEN a
// failed attempt may be tried again. The database half is billing-store.mjs and
// the processor seam is charger.mjs.
//
// Split out from store.mjs on purpose, same reason index.mjs is split from it:
// these rules have to be testable without Postgres, because they are the rules
// that decide whether somebody's card is charged.
//
//
// THE CYCLE, IN ONE PARAGRAPH. `next_charge_at` is both when the next charge is
// due and where the next period starts — charging in advance makes those the
// same instant (see 276's header). So the period being bought is always
// [next_charge_at, advance(next_charge_at, interval)), the idempotency key is
// anchored on that start, and a successful charge moves the window forward to
// exactly that period and sets next_charge_at to its end. Replaying the whole
// computation on an unadvanced row reproduces the identical period and the
// identical key, which is what makes a replay collide with the ledger instead
// of taking money.

import { assertPriceCents } from "./index.mjs";

/** The two cadences 276's CHECK allows. Kept in sync with the constraint by
    src/subscriptions/billing.test.mjs reading the migration file. */
export const BILLING_INTERVALS = Object.freeze(["monthly", "annual"]);

/**
 * How many times one period may be attempted before it is abandoned.
 *
 * FOUR, and the ceiling matters more than the number. An unbounded retry against
 * a card that is declining is a loop that hits the processor forever, and enough
 * declines in a row is how a merchant account gets reviewed. Four attempts over
 * roughly a day is long enough to ride out a transient failure and short enough
 * that a genuine decline reaches a human the same day.
 */
export const MAX_ATTEMPTS = 4;

/**
 * Backoff before attempt N+1, in minutes: 15m, 4h, 24h.
 *
 * Index i is the wait AFTER attempt (i+1). The last entry is reused if the
 * ceiling ever rises without this array being extended — a wrong-but-long wait
 * is safe, a wrong-but-zero wait is a hot loop.
 */
export const RETRY_BACKOFF_MINUTES = Object.freeze([15, 240, 1440]);

const MINUTE_MS = 60 * 1000;

function toDate(value, where) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new TypeError(`${where}: not a date: ${JSON.stringify(value)}`);
  }
  return d;
}

/**
 * advancePeriod — one interval forward from `start`, in UTC.
 *
 * THE END-OF-MONTH CLAMP IS THE WHOLE REASON THIS IS NOT ONE LINE. JavaScript's
 * setUTCMonth rolls over: 31 January plus one month is 31 February, which Date
 * silently renders as 2 or 3 March depending on the year. A subscription that
 * started on the 31st would drift a day or two into the next month every
 * February and never come back — the customer is billed on a date they did not
 * agree to, and the period boundaries stop lining up with the ledger.
 *
 * Clamping to the last day of the target month is the behaviour every processor
 * uses and the one a human expects: 31 Jan → 28 Feb (29 in a leap year) → 31
 * Mar. The day-of-month is taken from the ORIGINAL start each time, not from
 * the clamped result, so a clamp does not permanently pull the anniversary
 * backwards — but that only holds if the caller advances from the true anchor,
 * which is why `anchorDay` is an explicit argument rather than something this
 * function guesses.
 */
export function advancePeriod(start, interval, { anchorDay = null } = {}) {
  const from = toDate(start, "advancePeriod: start");
  const cadence = String(interval || "").trim();
  if (!BILLING_INTERVALS.includes(cadence)) {
    throw new TypeError(
      `advancePeriod: interval must be one of ${BILLING_INTERVALS.join(", ")} — got ${JSON.stringify(interval)}`
    );
  }

  const months = cadence === "annual" ? 12 : 1;
  const day = anchorDay == null ? from.getUTCDate() : Number(anchorDay);
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    throw new RangeError(`advancePeriod: anchorDay must be 1-31 — got ${JSON.stringify(anchorDay)}`);
  }

  const targetMonthIndex = from.getUTCMonth() + months;
  const year = from.getUTCFullYear() + Math.floor(targetMonthIndex / 12);
  const month = ((targetMonthIndex % 12) + 12) % 12;

  // Day 0 of the following month is the last day of this one.
  const daysInTargetMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  return new Date(Date.UTC(
    year, month, Math.min(day, daysInTargetMonth),
    from.getUTCHours(), from.getUTCMinutes(), from.getUTCSeconds(), from.getUTCMilliseconds()
  ));
}

/**
 * chargeIdempotencyKey — the handle for one period's charge.
 *
 * Deterministic from (subscription, period start) and NOTHING ELSE. No attempt
 * number, no timestamp, no random component: the same period must produce the
 * same key on every replay, on every container, forever, or the ledger cannot
 * recognise a repeat. This is the same call src/adapters/commas.mjs makes about
 * keying on `data.payment_id` rather than the per-delivery envelope id.
 *
 * Second-resolution ISO, because a period boundary is a wall-clock instant and
 * millisecond noise from a Date round-trip would mint a second key for one
 * period. The database's UNIQUE (subscription_id, period_start) is what actually
 * adjudicates — this key is what a processor would be handed.
 */
export function chargeIdempotencyKey({ subscriptionId, periodStart } = {}) {
  if (!subscriptionId) throw new TypeError("chargeIdempotencyKey: subscriptionId is required");
  const start = toDate(periodStart, "chargeIdempotencyKey: periodStart");
  const iso = new Date(Math.floor(start.getTime() / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
  return `sub:${subscriptionId}:period:${iso}`;
}

/**
 * notBillableReason — why this row must not be charged, or null if it may be.
 *
 * FAILS CLOSED AND NAMES THE REASON. Every refusal returns a short code the
 * sweeper reports, so "nothing was charged" is never a silent outcome — the
 * whole failure mode 075 shipped with was a subscription that looked active and
 * billed nothing with nobody able to say why.
 *
 * The order is deliberate: identity and lifecycle first, then money, then
 * schedule. A cancelled row is reported as cancelled rather than as "no price",
 * because the first is the answer and the second is a detail.
 */
export function notBillableReason(sub, { now = new Date() } = {}) {
  if (!sub) return "no_subscription";

  if (sub.effective_to != null) return "closed";
  if (sub.cancelled_at != null || sub.status === "cancelled") return "cancelled";
  if (sub.status !== "active" && sub.status !== "past_due") return "status_not_billable";

  // 271: exactly one owner. A row with neither has nobody to bill and a row
  // with both has no answer to whose money it is; the CHECK makes both
  // impossible in the database, and this says so out loud for any caller that
  // built a row in memory.
  const hasClient = sub.client_id != null;
  const hasPartner = sub.partner_id != null;
  if (hasClient === hasPartner) return "no_single_owner";

  // NULL price means nobody recorded what this costs (075). It is not zero and
  // it is never charged.
  if (sub.price_cents == null) return "price_unknown";
  const cents = Number(sub.price_cents);
  if (!Number.isInteger(cents) || cents <= 0) return "price_not_chargeable";

  if (sub.billing_interval == null) return "no_billing_interval";
  if (!BILLING_INTERVALS.includes(String(sub.billing_interval))) return "unknown_billing_interval";

  if (sub.next_charge_at == null) return "not_scheduled";
  if (toDate(sub.next_charge_at, "notBillableReason: next_charge_at") > toDate(now, "notBillableReason: now")) {
    return "not_due";
  }

  return null;
}

/**
 * planCharge — the period, amount and key for the next charge on a row.
 *
 * Throws if the row is not billable, naming the reason, because a caller that
 * skipped notBillableReason() is a caller about to charge something it should
 * not. Returns plain values; nothing here decides that a charge WILL happen.
 */
export function planCharge(sub, { now = new Date() } = {}) {
  const refusal = notBillableReason(sub, { now });
  if (refusal) throw new TypeError(`planCharge: subscription is not billable — ${refusal}`);

  const periodStart = toDate(sub.next_charge_at, "planCharge: next_charge_at");
  const anchor = sub.current_period_start == null
    ? periodStart.getUTCDate()
    : toDate(sub.current_period_start, "planCharge: current_period_start").getUTCDate();
  const periodEnd = advancePeriod(periodStart, sub.billing_interval, { anchorDay: anchor });

  return {
    subscriptionId: sub.id,
    orgId: sub.org_id,
    clientId: sub.client_id ?? null,
    partnerId: sub.partner_id ?? null,
    cardId: sub.card_id ?? null,
    provider: sub.provider || "commas",
    amountCents: assertPriceCents(Number(sub.price_cents), "planCharge: price_cents"),
    currency: sub.currency || "USD",
    periodStart,
    periodEnd,
    idempotencyKey: chargeIdempotencyKey({ subscriptionId: sub.id, periodStart })
  };
}

/**
 * retryAt — when a failed attempt may be tried again, or null if it may not.
 *
 * null at the ceiling is the bounded half of "bounded retry": there is no
 * schedule after the last attempt, so nothing can pick the row up again by
 * accident even if a caller forgets to check the count.
 */
export function retryAt(attempt, from = new Date(), { maxAttempts = MAX_ATTEMPTS } = {}) {
  const n = Number(attempt);
  if (!Number.isInteger(n) || n < 1) {
    throw new RangeError(`retryAt: attempt must be a positive integer — got ${JSON.stringify(attempt)}`);
  }
  if (n >= maxAttempts) return null;
  const idx = Math.min(n - 1, RETRY_BACKOFF_MINUTES.length - 1);
  return new Date(toDate(from, "retryAt: from").getTime() + RETRY_BACKOFF_MINUTES[idx] * MINUTE_MS);
}

/**
 * classifyChargeResult — a processor's answer → what happens to the ledger row.
 *
 * THE DEFAULT IS "RETRYABLE, DO NOT BLAME THE CUSTOMER". A result this function
 * does not understand is a fault on our side of the wire, and flipping somebody
 * to past_due for a shape we failed to parse is the wrong way round. A decline
 * has to be stated, not inferred.
 *
 * The three outcomes and what each one means downstream:
 *   succeeded — money moved. The cycle advances.
 *   declined  — the instrument said no. The subscription goes past_due NOW, so
 *               the CRM shows it today, and the remaining attempts still run in
 *               case the customer fixes the card.
 *   retry     — our side failed: a timeout, a 500, an unreachable host. Nothing
 *               about the customer changed, so the subscription is left exactly
 *               as it was and only the ledger row records the miss.
 * Any of the three becomes `abandoned` once the attempt ceiling is reached.
 */
export function classifyChargeResult(result, { attempt = 1, maxAttempts = MAX_ATTEMPTS, now = new Date() } = {}) {
  const res = result && typeof result === "object" ? result : {};

  if (res.ok === true) {
    return {
      outcome: "succeeded",
      providerRef: res.providerRef ?? res.provider_ref ?? res.paymentId ?? null,
      failureCode: null,
      failureReason: null,
      retryAt: null,
      abandoned: false,
      pastDue: false
    };
  }

  // `retryable: false` is the only way to say "declined". Absent or true is a
  // transport failure by default — see the header.
  const declined = res.retryable === false;
  const exhausted = Number(attempt) >= maxAttempts;
  const next = exhausted ? null : retryAt(attempt, now, { maxAttempts });

  return {
    outcome: declined ? "declined" : "retry",
    providerRef: res.providerRef ?? res.provider_ref ?? null,
    failureCode: String(res.code ?? res.failureCode ?? (declined ? "declined" : "charge_failed")).slice(0, 60),
    failureReason: String(res.reason ?? res.message ?? "the processor did not confirm the charge").slice(0, 300),
    retryAt: next,
    abandoned: exhausted,
    // Exhausting the retries is itself a reason to stop calling the plan paid,
    // whatever the last error was.
    pastDue: declined || exhausted
  };
}

export default { notBillableReason, planCharge, classifyChargeResult, advancePeriod, chargeIdempotencyKey, retryAt };
