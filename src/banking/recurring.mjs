// Recurring bill detection. Pure: no database, no clock, no I/O.
//
// Takes a list of transactions, returns the patterns it thinks are bills, and —
// the part that matters — how much it trusts each one.
//
//
// *** THE CONFIDENCE NUMBER IS THE PRODUCT, NOT A GARNISH. ***
//
// Detecting a pattern is easy and mostly useless on its own. Any two payments to
// the same merchant form a "pattern": two points always make a line, always have
// a perfectly regular interval, and always look flawless to a naive scorer. A
// detector that scores those 0.95 because "the interval variance is zero" is
// worse than no detector, because a screen will render it next to a genuine
// twelve-month insurance bill in identical type, and somebody will plan their
// month around it.
//
// So confidence here is deliberately, structurally pessimistic:
//
//   1. IT IS CAPPED BY OCCURRENCE COUNT BEFORE ANYTHING ELSE IS CONSIDERED.
//      Two occurrences can never exceed MAX_CONFIDENCE_BY_COUNT[2], no matter
//      how perfect the interval and the amount look. Regularity measured over
//      two points is not evidence of regularity.
//   2. IT NEVER REACHES 1. The column CHECKs this too. The next occurrence may
//      simply not happen; certainty is not available from this data.
//   3. IT IS THE PRODUCT OF THREE INDEPENDENT SIGNALS, not their average.
//      Averaging lets one strong signal carry two weak ones — a perfect interval
//      hides wildly varying amounts. A product means every signal has a veto,
//      which is the correct shape for "how much of this do I believe".
//
// The inputs are honest about their own limits too: `irregular` is a real
// verdict, and a bill with no projectable next date says so rather than adding
// thirty days to the last one.

/* The ceiling on confidence for a given number of observed occurrences. Read
   this as: "with N payments, the most anyone should believe is X".

   Two payments is a coincidence with an interval. Three is the first point at
   which a cadence is even falsifiable — a third payment can DISAGREE with the
   gap the first two implied, and until something can be wrong it is not
   evidence. Six is roughly where a monthly bill has survived half a year. */
const MAX_CONFIDENCE_BY_COUNT = { 0: 0, 1: 0, 2: 0.35, 3: 0.55, 4: 0.7, 5: 0.8 };
const MAX_CONFIDENCE = 0.95;   // never 1 — see the header, and 086's CHECK

/* Cadence buckets: [label, expected days, tolerance in days]. Tolerance is
   generous because real billing dates move — weekends, month lengths, and
   billers that charge "on or about" a date. */
const CADENCES = [
  ["weekly", 7, 2],
  ["biweekly", 14, 3],
  ["monthly", 30.4, 6],
  ["quarterly", 91.3, 12],
  ["annual", 365, 30]
];

/* Below this many occurrences nothing is emitted at all. One payment to a
   merchant is not a pattern in any sense and emitting it at confidence 0 would
   fill the table with noise a human has to dismiss one row at a time. */
const MIN_OCCURRENCES = 2;

function round(x, places) {
  const f = 10 ** places;
  return Math.round(x * f) / f;
}

function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/* Population standard deviation. Returns 0 for a single value, which is
   arithmetically right and is exactly the trap the occurrence cap exists to
   cover: perfect regularity over too few points is not regularity. */
function stddev(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

/* A UTC day number. Dates only — a bill posted at 23:00 and one at 01:00 are a
   day apart to a person and should be a day apart here. */
function dayNumber(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  if (!m) return null;
  const [, y, mo, d] = m.map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return Math.floor(dt.getTime() / 86400000);
}

function isoFromDayNumber(n) {
  return new Date(n * 86400000).toISOString().slice(0, 10);
}

/* The grouping key. Merchant name, case- and whitespace-folded. Deliberately NOT
   the aggregator's category: a category groups "Netflix" with "Hulu", which
   produces a single confident bill for two unrelated subscriptions. */
function merchantKey(t) {
  const name = t?.merchantName ?? t?.merchant_name ?? t?.name ?? null;
  if (name == null) return null;
  const key = String(name).trim().toLowerCase().replace(/\s+/g, " ");
  return key === "" ? null : key;
}

function amountCents(t) {
  const v = t?.amountCents ?? t?.amount_cents;
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isFinite(n) ? Math.round(n) : null;
}

/* Which cadence, if any, an average gap matches. Returns null rather than the
   nearest bucket: a 47-day average is not "monthly, roughly", it is a merchant
   being paid at no particular schedule, and rounding it to monthly would put a
   projected date on a screen that nothing supports. */
function classifyCadence(avgGap) {
  if (avgGap == null) return null;
  for (const [label, days, tolerance] of CADENCES) {
    if (Math.abs(avgGap - days) <= tolerance) return { label, days };
  }
  return null;
}

/**
 * detectRecurring — find repeated outgoing payments and score them honestly.
 *
 * @param {object}  opts
 * @param {Array}   opts.transactions   [{ merchantName, amountCents, postedDate, pending?, bankAccountId? }]
 *                                      amountCents NEGATIVE for outflows (085's convention).
 * @param {boolean} opts.includePending default false — a pending charge can change or vanish,
 *                                      and a cadence built on one is a cadence built on a maybe.
 * @param {number}  opts.minOccurrences default 2
 *
 * @returns {{ bills: Array, skipped: Array }}
 *   bills   — one candidate per merchant, each carrying its confidence, its
 *             occurrence count, and the evidence it was computed from.
 *   skipped — merchants seen but not emitted, with the reason. A caller can
 *             always distinguish "no bills" from "nothing to look at".
 */
export function detectRecurring({
  transactions = [],
  includePending = false,
  minOccurrences = MIN_OCCURRENCES
} = {}) {
  const floor = Math.max(2, Number(minOccurrences) || MIN_OCCURRENCES);

  // Outflows only. An incoming refund from the same merchant is not an instance
  // of the bill; including it would both inflate the count and corrupt the gaps.
  const groups = new Map();
  for (const t of Array.isArray(transactions) ? transactions : []) {
    if (!includePending && (t?.pending === true)) continue;
    const key = merchantKey(t);
    const cents = amountCents(t);
    const day = dayNumber(t?.postedDate ?? t?.posted_date);
    if (key == null || cents == null || day == null || cents >= 0) continue;

    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({
      key,
      display: String(t?.merchantName ?? t?.merchant_name ?? t?.name).trim(),
      amount: Math.abs(cents),      // 086 stores obligations positive
      day,
      bankAccountId: t?.bankAccountId ?? t?.bank_account_id ?? null
    });
  }

  const bills = [];
  const skipped = [];

  for (const [key, rawItems] of groups) {
    const items = [...rawItems].sort((a, b) => a.day - b.day);

    if (items.length < floor) {
      skipped.push({ merchant: items[0].display, occurrences: items.length, reason: `only ${items.length} payment(s) — not a pattern` });
      continue;
    }

    const gaps = items.slice(1).map((t, i) => t.day - items[i].day);
    // Same-day duplicates produce a zero gap and would fake a perfect cadence.
    const realGaps = gaps.filter((g) => g > 0);
    if (!realGaps.length) {
      skipped.push({ merchant: items[0].display, occurrences: items.length, reason: "all payments fell on the same day — no interval to measure" });
      continue;
    }

    const avgGap = mean(realGaps);
    const gapSd = stddev(realGaps);
    const amounts = items.map((t) => t.amount);
    const avgAmount = mean(amounts);
    const amountSd = stddev(amounts);

    const cadence = classifyCadence(avgGap);

    // --- the three independent signals, each in [0,1] ---

    // 1. Interval regularity. Coefficient of variation against the mean gap; a
    //    cadence that wobbles by a fifth of its own period is not a cadence.
    const intervalScore = clamp01(1 - (gapSd / avgGap) / 0.5);

    // 2. Amount consistency. Same idea against the mean amount. A varying
    //    utility bill scores low here and SHOULD — the bill is real, our ability
    //    to state its amount is not.
    const amountScore = avgAmount > 0 ? clamp01(1 - (amountSd / avgAmount) / 0.5) : 0;

    // 3. Does the cadence match anything a biller actually uses? An unmatched
    //    average gap is not disqualifying, but it is weak evidence.
    const cadenceScore = cadence ? 1 : 0.35;

    // PRODUCT, not average. Every signal gets a veto — see the header.
    const raw = intervalScore * amountScore * cadenceScore;

    // THE CAP COMES LAST AND IS ABSOLUTE.
    const ceiling = Math.min(
      MAX_CONFIDENCE_BY_COUNT[items.length] ?? MAX_CONFIDENCE,
      MAX_CONFIDENCE
    );
    const confidence = round(Math.min(raw, ceiling), 3);

    // Only project when there is a cadence to project from — 086 CHECKs this
    // too. Adding the average gap to the last payment when the gap means nothing
    // is arithmetic performed on an admission of ignorance.
    const nextExpectedDate = cadence ? isoFromDayNumber(items.at(-1).day + Math.round(cadence.days)) : null;

    // One account only if every occurrence came from the same one.
    const accountIds = new Set(items.map((t) => t.bankAccountId).filter(Boolean));
    const bankAccountId = accountIds.size === 1 ? [...accountIds][0] : null;

    bills.push({
      merchantName: items.at(-1).display,
      merchantKey: key,
      bankAccountId,
      amountCents: Math.round(avgAmount),
      amountVarianceCents: Math.round(amountSd),
      cadence: cadence?.label ?? "irregular",
      intervalDays: round(avgGap, 2),
      confidence,
      occurrenceCount: items.length,
      firstSeenDate: isoFromDayNumber(items[0].day),
      lastSeenDate: isoFromDayNumber(items.at(-1).day),
      nextExpectedDate,
      evidence: {
        gaps: realGaps,
        amounts,
        intervalScore: round(intervalScore, 3),
        amountScore: round(amountScore, 3),
        cadenceScore,
        rawScore: round(raw, 3),
        // Named so a reader can see WHY a perfect-looking pattern scored 0.35.
        confidenceCeiling: ceiling,
        cappedByOccurrenceCount: raw > ceiling
      }
    });
  }

  // Most trusted first; ties broken by how much evidence there is.
  bills.sort((a, b) => b.confidence - a.confidence || b.occurrenceCount - a.occurrenceCount);
  return { bills, skipped };
}

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * confidenceLabel — the words a screen should use for a score.
 *
 * Exists so "low" means the same thing on every screen. A caller that invents
 * its own bands will eventually pick friendlier ones, and the friendly version
 * of "we are guessing" is what this module exists to prevent.
 */
export function confidenceLabel(confidence) {
  // null and "" must NOT reach Number(), which turns both into 0 and would
  // label an absent confidence "low" — a band, where the truth is that there is
  // no band. 086 makes the column NOT NULL, so a null here means the caller lost
  // it somewhere, and that deserves to look different from a weak bill.
  if (confidence == null || confidence === "") return "unknown";
  const c = Number(confidence);
  if (!Number.isFinite(c)) return "unknown";
  if (c < 0.4) return "low";
  if (c < 0.7) return "medium";
  return "high";
}
