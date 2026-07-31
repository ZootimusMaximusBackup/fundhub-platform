// Card liabilities — the pure half. Every derived figure the bank-sourced card
// data produces, and the one place the bank/bureau precedence rule is written.
//
// PURE AND I/O-FREE. No database, no clock, no network. The db access lives in
// store.mjs so this half stays testable without Postgres, exactly as
// src/tradelines/index.mjs and store.mjs are split.
//
// THE RULE THIS MODULE EXISTS TO HOLD: NULL MEANS UNKNOWN AND MUST SURVIVE.
// Unknown utilisation and 0% utilisation are different facts about a client, and
// one of them is a lie. Every function here returns null rather than a
// plausible-looking number when an input it needs is missing. There is no
// branch anywhere in this file that substitutes 0 for an absent value.
//
// WHY toCents COMES FROM ../tradelines/index.mjs AND NOT FROM
// ../commissions/money.mjs. Both modules export a function called toCents and
// they disagree on the single question that matters here:
//
//     money.mjs      toCents(null)  -> 0       ("no payments yet" is a real zero)
//     tradelines     toCents(null)  -> null    ("nobody told us" is not a zero)
//
// money.mjs is right for a commission base and catastrophically wrong for a
// credit limit: it would turn every card whose limit the feed omitted into a
// $0-limit card, and a $0 limit is 100% utilisation on any balance at all.
// readApr comes from the same place for the same kind of reason — it already
// encodes this repo's decision about the percentage-versus-fraction ambiguity,
// and a second copy of that decision is a second thing to get wrong.

import { toCents, readApr } from "../tradelines/index.mjs";

export { toCents, readApr };

/* The columns 084 versions. Named once, here, so the store, the history reader
   and the tests cannot drift from each other about what counts as a "term". */
export const TERM_FIELDS = [
  "credit_limit_cents",
  "apr_purchase",
  "apr_cash_advance",
  "apr_balance_transfer",
  "promo_purchase_apr",
  "promo_purchase_ends_on",
  "promo_balance_transfer_apr",
  "promo_balance_transfer_ends_on",
  "is_business"
];

/* Which TERM_FIELDS are calendar days rather than numbers. Named here because
   the store has to compare them with readDate() — Postgres hands a `date` back
   as a JS Date object, and `dateObject !== '2026-08-15'` is true every single
   time, which would append a history row every night for a promotion that never
   moved. */
export const TERM_DATE_FIELDS = new Set([
  "promo_purchase_ends_on",
  "promo_balance_transfer_ends_on"
]);

/* The columns a bank knows and a bureau file does not. Used by mergeCardView to
   decide which side can even be asked about a field. */
export const BANK_REPORTED_FIELDS = [
  "statement_balance_cents",
  "minimum_payment_cents",
  "statement_close_date",
  "payment_due_date",
  "last4",
  "is_business",
  "apr_cash_advance",
  "apr_balance_transfer",
  // A bureau file reports what an account accrues at, never what the issuer
  // advertised when it opened, so the whole promotional window is bank-only.
  "promo_purchase_apr",
  "promo_purchase_ends_on",
  "promo_balance_transfer_apr",
  "promo_balance_transfer_ends_on"
];

/* asCents — a stored cents value as a JavaScript integer, or null.
 *
 * Postgres hands `bigint` back as a STRING (node-postgres will not narrow it to
 * a Number, because a bigint does not always fit in one). Every derived figure
 * here therefore has to accept "1800000" as readily as 1800000, and a function
 * that quietly did `value > 0` on the string would compare lexically and be
 * wrong in a way that only shows up above a million.
 *
 * Absent -> null. Present-but-not-a-number -> throws, because that is a
 * programming error rather than a missing fact, and swallowing it as null would
 * turn a bug into a silently unknown balance. Non-integer -> throws for the same
 * reason money.mjs's fromCents does: half a cent is not a thing this system has.
 */
export function asCents(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(n)) throw new TypeError(`asCents: not a number: ${JSON.stringify(value)}`);
  if (!Number.isInteger(n)) throw new TypeError(`asCents: cents must be a whole number: ${value}`);
  return n;
}

/* asRate — a stored numeric(6,5) as a Number, or null. Same string problem:
 * node-postgres returns `numeric` as a string to preserve precision. */
export function asRate(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(n)) throw new TypeError(`asRate: not a number: ${JSON.stringify(value)}`);
  return n;
}

/**
 * utilisation — balance as a fraction of the limit, or null.
 *
 * THIS IS THE FUNCTION THE WHOLE "NULL SURVIVES" RULE IS ABOUT, so its refusals
 * are listed rather than implied. It returns null when:
 *
 *   * the LIMIT is unknown. There is no utilisation without a denominator.
 *     Returning 0 here would report a maxed-out card as pristine.
 *   * the BALANCE is unknown. Same argument from the other side: a card we
 *     cannot read the balance of is not a card at 0%.
 *   * the limit is exactly 0. A zero limit is a real stored value — a closed or
 *     suspended line — and dividing by it yields Infinity, which would render
 *     as some enormous percentage. "No limit to be used" has no utilisation.
 *
 * Returned as a FRACTION (0.32 is 32%), matching the APR convention in this
 * repo and in 054: fractions in the data, percentages at the screen, converted
 * once at the edge. Values above 1 are returned as-is, not clamped — a card
 * over its limit is a real and important state, and clamping it to 1.0 would
 * hide the single worst thing on a client's file.
 *
 * Rounded to 5 decimal places so the same inputs always produce the same output
 * regardless of float ordering, matching numeric(6,5)'s precision.
 */
export function utilisation(balanceCents, limitCents) {
  const balance = asCents(balanceCents);
  const limit = asCents(limitCents);
  if (balance === null || limit === null) return null;
  if (limit < 0 || balance < 0) {
    // The schema forbids these (CHECK >= 0 on both). Reaching here means the
    // data got in some other way, and answering with a number would launder it.
    throw new RangeError(`utilisation: negative cents: balance=${balance} limit=${limit}`);
  }
  if (limit === 0) return null;
  return Math.round((balance / limit) * 1e5) / 1e5;
}

/**
 * availableCreditCents — headroom left on the card, or null.
 *
 * Floored at 0: a card over its limit has no headroom, it does not have
 * negative headroom you could draw against.
 *
 * NOTE FOR ANYONE COMPARING THIS TO api/read/tradelines.mjs — that endpoint
 * computes `Math.max(0, (limit ?? 0) - (balance ?? 0))`, which reports a card
 * with an unknown limit as having exactly $0 available. That is the substitution
 * this file refuses. It is existing code in another unit's file and is left
 * alone here; it is recorded as a finding on the batch board.
 */
export function availableCreditCents(limitCents, balanceCents) {
  const limit = asCents(limitCents);
  const balance = asCents(balanceCents);
  if (limit === null || balance === null) return null;
  return Math.max(0, limit - balance);
}

/* readIsBusiness — the three-state classification.
 *
 * true / false / null, and NULL IS A LEGITIMATE ANSWER, not a fallback. The one
 * thing this function must never do is decide that an unrecognised input means
 * "personal": personal-versus-business changes who is liable for the debt, which
 * product applies, and how the balance underwrites. An unclassified card has to
 * stay visibly unclassified until somebody classifies it.
 *
 * The accepted vocabularies are listed rather than pattern-matched so that
 * adding one is a visible list edit, the same treatment 054's normalizer gives
 * its field names.
 */
const BUSINESS_WORDS = new Set(["true", "t", "yes", "y", "1", "business", "biz", "commercial", "corporate"]);
const PERSONAL_WORDS = new Set(["false", "f", "no", "n", "0", "personal", "consumer", "individual", "household"]);

export function readIsBusiness(value) {
  if (value === true || value === false) return value;
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
    return null;
  }
  if (typeof value !== "string") return null;
  const s = value.trim().toLowerCase();
  if (s === "") return null;
  if (BUSINESS_WORDS.has(s)) return true;
  if (PERSONAL_WORDS.has(s)) return false;
  return null; // "unknown", "n/a", anything unrecognised
}

/* readLast4 — exactly four digits, or null.
 *
 * REFUSES ANYTHING LONGER, AND THAT IS THE POINT. "****1234" and "xxxx-1234"
 * both mean 1234 and are accepted; a 15- or 16-digit string is a full card
 * number and is REFUSED rather than truncated to its last four. Truncating
 * would be friendlier and would mean this function silently accepted a PAN into
 * a system that has no business holding one — the value would be safe, the
 * argument that put it there would have been logged, retried and stack-traced.
 * Refusing keeps the number out of the process.
 *
 * Fewer than four digits is also refused: '42' could be a card ending in 0042
 * or a truncated 1042, and guessing which produces a card ending that does not
 * exist.
 */
export function readLast4(value) {
  if (value === null || value === undefined) return null;
  const digits = String(value).replace(/\D/g, "");
  if (digits.length !== 4) return null;
  return digits;
}

/* readDate — a calendar day as 'YYYY-MM-DD', or null.
 *
 * A MISSING DUE DATE IS NULL. Never today, never end-of-month, never "close
 * date plus twenty-one days". A guessed due date is worse than an absent one
 * because it looks actionable, and something downstream eventually pays
 * against it.
 *
 * A Date instance is read in UTC, because the column is a `date` and the issuer
 * named a calendar day rather than an instant; picking the caller's local
 * timezone would move the due date by a day for anyone west of Greenwich.
 */
export function readDate(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  const [, y, mo, d] = m;
  // Reject 2026-02-31 and friends: Date normalises them forward into March, and
  // a due date silently moved by three days is exactly the class of quiet wrong
  // answer this module exists to avoid.
  const probe = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (probe.getUTCFullYear() !== Number(y) ||
      probe.getUTCMonth() !== Number(mo) - 1 ||
      probe.getUTCDate() !== Number(d)) return null;
  return `${y}-${mo}-${d}`;
}

// ---------------------------------------------------------------------------
// the promotional window — which rate is actually in force on a given day
// ---------------------------------------------------------------------------

/* The scopes a card can carry a rate for. Only purchases and balance transfers
   are ever promoted; cash advances are listed so a caller can ask about any of
   the three uniformly and get a truthful "no promotion" rather than a throw. */
export const APR_SCOPES = {
  purchase: { standard: "apr_purchase", promo: "promo_purchase_apr", endsOn: "promo_purchase_ends_on" },
  balance_transfer: {
    standard: "apr_balance_transfer",
    promo: "promo_balance_transfer_apr",
    endsOn: "promo_balance_transfer_ends_on"
  },
  cash_advance: { standard: "apr_cash_advance", promo: null, endsOn: null }
};

const MS_PER_DAY = 86400000;

/* Whole days from one calendar day to another, both as 'YYYY-MM-DD'. Computed
   in UTC off the date parts alone, so it never picks up a daylight-saving hour
   and never depends on where the caller is sitting. */
function daysBetween(fromDay, toDay) {
  const a = Date.parse(`${fromDay}T00:00:00Z`);
  const b = Date.parse(`${toDay}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / MS_PER_DAY);
}

/**
 * effectiveApr — the rate this card ACTUALLY charges on a given day, and why.
 *
 * WHY THIS IS THE MOST IMPORTANT FUNCTION IN THE MODULE. The business draws on
 * cards inside their 0% intro window and repays before it closes. A system that
 * knows only the go-to rate quotes 18.99% on a card that is currently free
 * money and sends the draw to the wrong card; a system that knows only the
 * promotional rate quotes 0% on a card whose window shut in March. Neither is a
 * rounding error — both change which card the money comes from.
 *
 * `asOf` IS REQUIRED AND IS NOT DEFAULTED TO TODAY. This module is pure and
 * reads no clock; defaulting would make it read one. It is also the honest
 * shape: a caller asking "what did this card charge in March" and a caller
 * asking "what does it charge now" are asking different questions, and the
 * second one should have to say so. The clock lives at the edge, in the
 * endpoint, which is where 054 already puts unit conversions.
 *
 * THE FOUR STATES, and the one that matters:
 *
 *   none            no promotional rate recorded  -> the go-to rate
 *   active          promo recorded, ends on or after asOf -> the PROMO rate
 *   expired         promo recorded, ended before asOf -> the go-to rate
 *   expiry_unknown  promo recorded, NO end date   -> the GO-TO rate
 *
 * That last one is the deliberate call. A promotion with no known end date is
 * NOT applied. Being wrong in that direction understates a benefit the client
 * turns out to have; being wrong the other way tells a client their money is
 * free when it is not, and this is a regulated consumer-finance product where
 * those two errors are not symmetric. The state is reported so a screen can say
 * "0% intro on file, expiry unknown — confirm before drawing" rather than
 * silently pretending the promotion does not exist.
 *
 * The end date is INCLUSIVE: a promotion ending 2026-08-15 is still in force on
 * 2026-08-15, which is how issuers state it. daysRemaining is 0 on that day.
 */
export function effectiveApr(card, { scope = "purchase", asOf } = {}) {
  const spec = APR_SCOPES[scope];
  if (!spec) throw new RangeError(`effectiveApr: unknown scope: ${scope}`);
  const day = readDate(asOf);
  if (!day) throw new TypeError("effectiveApr: `asOf` is required — a calendar day, not a default of today");

  const standardApr = card ? asRate(card[spec.standard]) : null;
  const promoApr = spec.promo && card ? asRate(card[spec.promo]) : null;
  const promoEndsOn = spec.endsOn && card ? readDate(card[spec.endsOn]) : null;

  let promoState = "none";
  let daysRemaining = null;

  if (promoApr !== null) {
    if (promoEndsOn === null) {
      promoState = "expiry_unknown";
    } else {
      const remaining = daysBetween(day, promoEndsOn);
      if (remaining !== null && remaining >= 0) {
        promoState = "active";
        daysRemaining = remaining;
      } else {
        promoState = "expired";
      }
    }
  }

  const usePromo = promoState === "active";
  const apr = usePromo ? promoApr : standardApr;

  return {
    apr,
    // null, not "standard", when nothing is known at all: a card with no rate
    // on file has no basis, and saying "standard" would imply we had read one.
    basis: apr === null ? null : (usePromo ? "promo" : "standard"),
    standardApr,
    promoApr,
    promoEndsOn,
    promoState,
    daysRemaining
  };
}

/**
 * promoWindow — the card-stacking question, answered over a client's whole book:
 * which cards are inside a promotional window right now, how much can be drawn
 * at those rates, and which window closes first.
 *
 * Closed cards are skipped, and so are promotions whose expiry is unknown —
 * those are counted separately in `expiryUnknownCount` so they are visible
 * without being counted as available. Same reasoning as effectiveApr: a window
 * nobody can date is not a window anyone should draw against.
 *
 * `availableCents` is the sum over promo-active cards whose headroom is KNOWN,
 * with `availableUnknownCount` alongside it — the same honest-partial-sum shape
 * summarise() uses, for the same reason.
 */
export function promoWindow(rows = [], { scope = "purchase", asOf } = {}) {
  const out = {
    cards: [],
    count: 0,
    availableCents: 0,
    availableUnknownCount: 0,
    expiryUnknownCount: 0,
    soonestExpiry: null
  };

  for (const row of rows) {
    if (!row || row.closed_at) continue;
    const rate = effectiveApr(row, { scope, asOf });
    if (rate.promoState === "expiry_unknown") out.expiryUnknownCount += 1;
    // ONLY "active" is drawable. An undatable window was counted just above so
    // it stays visible, an expired one is gone, and neither is credit anybody
    // should be told they can draw at a promotional rate.
    if (rate.promoState !== "active") continue;

    const available = availableCreditCents(row.credit_limit_cents, row.balance_cents);
    out.count += 1;
    if (available === null) out.availableUnknownCount += 1; else out.availableCents += available;
    if (out.soonestExpiry === null || rate.promoEndsOn < out.soonestExpiry) {
      out.soonestExpiry = rate.promoEndsOn;
    }
    out.cards.push({
      id: row.id ?? null,
      issuer: row.issuer ?? null,
      last4: row.last4 ?? null,
      isBusiness: row.is_business ?? null,
      apr: rate.apr,
      promoEndsOn: rate.promoEndsOn,
      daysRemaining: rate.daysRemaining,
      availableCents: available
    });
  }

  // Soonest to close first — the order a closer works the list in.
  out.cards.sort((a, b) => (a.promoEndsOn < b.promoEndsOn ? -1 : a.promoEndsOn > b.promoEndsOn ? 1 : 0));
  return out;
}

/**
 * coerceLiabilityRow — a caller-supplied card into the shape 083 stores.
 *
 * THIS IS THE SEAM W5 CALLS. W5 owns the aggregator adapter and the shape of
 * whatever payload it gets; this function owns the conversion into storage
 * units, and it takes `accountRef` as a parameter rather than reaching for an
 * accounts table that does not exist yet.
 *
 * MONEY ARRIVES IN DOLLARS AND LEAVES IN CENTS, because that is how every feed
 * that will ever call this reports it. An absent amount stays absent: toCents
 * from ../tradelines returns null for null, unlike money.mjs's, which returns 0.
 *
 * Nothing here is required except issuer and accountRef, which are the two
 * things a row cannot mean anything without. Everything else that is missing
 * arrives as null and stays null.
 */
export function coerceLiabilityRow(input = {}) {
  const pick = (...keys) => {
    for (const k of keys) {
      const v = input[k];
      if (v !== undefined) return v;
    }
    return null;
  };

  const issuer = pick("issuer", "lender", "name");

  return {
    account_ref: input.accountRef == null || String(input.accountRef).trim() === ""
      ? null
      : String(input.accountRef).trim(),
    issuer: issuer == null ? null : String(issuer).trim(),
    last4: readLast4(pick("last4", "mask", "last_four")),
    is_business: readIsBusiness(pick("isBusiness", "is_business", "business")),

    credit_limit_cents: toCents(pick("creditLimit", "credit_limit", "limit")),
    balance_cents: toCents(pick("balance", "currentBalance", "current_balance")),
    statement_balance_cents: toCents(pick("statementBalance", "statement_balance", "lastStatementBalance")),
    minimum_payment_cents: toCents(pick("minimumPayment", "minimum_payment", "minimumPaymentAmount")),

    apr_purchase: readApr(pick("aprPurchase", "apr_purchase", "purchaseApr", "apr")),
    apr_cash_advance: readApr(pick("aprCashAdvance", "apr_cash_advance", "cashApr")),
    apr_balance_transfer: readApr(pick("aprBalanceTransfer", "apr_balance_transfer", "balanceTransferApr")),

    // The promotional rate and its end date are read as a PAIR, but coerced
    // independently: "0% until we-do-not-know-when" has to survive as exactly
    // that, so effectiveApr can refuse to apply it. Pairing them here — say,
    // dropping the rate when the date is missing — would erase the fact that a
    // promotion exists at all, and nobody would know to go and confirm it.
    promo_purchase_apr: readApr(pick("promoPurchaseApr", "promo_purchase_apr", "introApr", "promoApr")),
    promo_purchase_ends_on: readDate(
      pick("promoPurchaseEndsOn", "promo_purchase_ends_on", "introEndsOn", "promoEndsOn")),
    promo_balance_transfer_apr: readApr(
      pick("promoBalanceTransferApr", "promo_balance_transfer_apr", "btIntroApr")),
    promo_balance_transfer_ends_on: readDate(
      pick("promoBalanceTransferEndsOn", "promo_balance_transfer_ends_on", "btIntroEndsOn")),

    statement_close_date: readDate(pick("statementCloseDate", "statement_close_date", "lastStatementIssueDate")),
    payment_due_date: readDate(pick("paymentDueDate", "payment_due_date", "nextPaymentDueDate")),

    tradeline_id: pick("tradelineId", "tradeline_id"),
    as_of: pick("asOf", "as_of"),
    raw: input.raw && typeof input.raw === "object" ? input.raw : {}
  };
}

/**
 * summarise — totals across a client's cards, split by classification.
 *
 * THE HARD PART IS THE UNKNOWNS, and this is why the return shape is not just
 * four numbers. Summing a column where some rows are NULL has two honest
 * answers and one dishonest one:
 *
 *   honest   (a) refuse: the total is unknown because part of it is.
 *   honest   (b) report the known part AND how much was not known.
 *   DISHONEST    treat NULL as 0 and report the known part as if it were whole.
 *
 * This returns (b). `limitCents` is the sum over the rows whose limit is known,
 * and `limitUnknownCount` says how many rows are missing from it. A caller that
 * wants (a) has everything it needs to choose it; a caller that does not read
 * the count gets a number that is at least honestly labelled as a partial sum.
 *
 * `utilisation` is the exception and takes answer (a): it is null unless EVERY
 * contributing row has both a known limit and a known balance. A blended
 * utilisation computed over a partial denominator is not a smaller version of
 * the real figure, it is a different and lower number — the one place where (b)
 * would produce something that reads as reassuring and is simply wrong.
 *
 * CLOSED CARDS ARE SKIPPED. A closed line has no limit to draw against and
 * counting it inflates both the credit total and the utilisation denominator.
 *
 * Buckets: `business` (is_business true), `personal` (false), `unclassified`
 * (null), and `all`. The unclassified bucket is reported separately and is
 * never folded into either side — that is the whole reason the column has three
 * states.
 */
function emptyBucket() {
  return {
    count: 0,
    limitCents: 0, limitUnknownCount: 0,
    balanceCents: 0, balanceUnknownCount: 0,
    availableCents: 0, availableUnknownCount: 0,
    utilisation: null
  };
}

export function summarise(rows = []) {
  const out = {
    all: emptyBucket(),
    business: emptyBucket(),
    personal: emptyBucket(),
    unclassified: emptyBucket()
  };

  for (const row of rows) {
    if (!row || row.closed_at) continue;
    const limit = asCents(row.credit_limit_cents);
    const balance = asCents(row.balance_cents);
    const available = availableCreditCents(limit, balance);
    const bucketName = row.is_business === true ? "business"
      : row.is_business === false ? "personal"
        : "unclassified";

    for (const b of [out.all, out[bucketName]]) {
      b.count += 1;
      if (limit === null) b.limitUnknownCount += 1; else b.limitCents += limit;
      if (balance === null) b.balanceUnknownCount += 1; else b.balanceCents += balance;
      if (available === null) b.availableUnknownCount += 1; else b.availableCents += available;
    }
  }

  for (const b of Object.values(out)) {
    // Answer (a) for utilisation, per the note above: any unknown anywhere in
    // the bucket, and there is no blended figure to report. utilisation() then
    // handles the zero-denominator case on its own.
    b.utilisation = (b.count > 0 && b.limitUnknownCount === 0 && b.balanceUnknownCount === 0)
      ? utilisation(b.balanceCents, b.limitCents)
      : null;
  }

  return out;
}

/* The field-by-field map mergeCardView works from. Kept as data rather than a
   chain of `??` so the precedence is visible in one place and a reviewer can
   check it against the two schemas without reading any logic.

   `bank` and `bureau` are column names in card_liabilities and tradelines
   respectively; null on either side means that source does not carry the field
   at all, which is a different thing from carrying it and not knowing it. */
const MERGE_FIELDS = [
  { key: "issuer", bank: "issuer", bureau: "lender" },
  { key: "creditLimitCents", bank: "credit_limit_cents", bureau: "credit_limit_cents", cents: true },
  { key: "balanceCents", bank: "balance_cents", bureau: "balance_cents", cents: true },
  // A bureau file reports ONE apr. The purchase rate is the one it means: it is
  // the rate the card advertises and the rate a revolving balance accrues at.
  { key: "aprPurchase", bank: "apr_purchase", bureau: "apr", rate: true },
  { key: "aprCashAdvance", bank: "apr_cash_advance", bureau: null, rate: true },
  { key: "aprBalanceTransfer", bank: "apr_balance_transfer", bureau: null, rate: true },
  // A bureau file has no concept of a promotional rate — it reports what the
  // account accrues at, not what the issuer advertised when it opened. So these
  // four are bank-only, and a card known only to the bureau has no promo.
  { key: "promoPurchaseApr", bank: "promo_purchase_apr", bureau: null, rate: true },
  { key: "promoPurchaseEndsOn", bank: "promo_purchase_ends_on", bureau: null },
  { key: "promoBalanceTransferApr", bank: "promo_balance_transfer_apr", bureau: null, rate: true },
  { key: "promoBalanceTransferEndsOn", bank: "promo_balance_transfer_ends_on", bureau: null },
  { key: "statementBalanceCents", bank: "statement_balance_cents", bureau: null, cents: true },
  { key: "minimumPaymentCents", bank: "minimum_payment_cents", bureau: null, cents: true },
  { key: "statementCloseDate", bank: "statement_close_date", bureau: null },
  { key: "paymentDueDate", bank: "payment_due_date", bureau: null },
  { key: "last4", bank: "last4", bureau: null },
  { key: "isBusiness", bank: "is_business", bureau: null },
  // `kind` (revolving / loc / installment) is the bureau's classification and
  // the bank has no equivalent, so it comes across untouched.
  { key: "kind", bank: null, bureau: "kind" },
  { key: "closedAt", bank: "closed_at", bureau: "closed_at" },
  { key: "asOf", bank: "as_of", bureau: "as_of" }
];

/**
 * mergeCardView — ONE answer for a card that two sources both describe.
 *
 * THIS IS THE FUNCTION THAT KEEPS card_liabilities FROM BECOMING A SECOND
 * ANSWER TO "WHAT DOES THIS CLIENT OWE". Having two tables that both hold card
 * data is only defensible if there is exactly one place that says which of them
 * wins, per field, and that place is here.
 *
 * THE PRECEDENCE RULE, IN ONE SENTENCE: the bank wins any field the bank
 * actually reported, and a NULL from the bank is not a correction.
 *
 * Why the bank wins: it is reading the issuer's own ledger. A bureau file is a
 * monthly-ish report of what an issuer chose to furnish, is commonly 30 to 60
 * days stale, and does not carry a statement balance, a minimum payment or a
 * real due date at all.
 *
 * Why an absent bank value does NOT overwrite: absence is not a correction —
 * the same rule src/tradelines/store.mjs already applies when it COALESCEs the
 * APR rather than overwriting it. A refresh that returns a card without its
 * cash-advance rate has not told us the rate is unknown; it has told us
 * nothing.
 *
 * Every field carries its provenance, because a closer must never be unable to
 * tell which number came off the bank feed and which came off the bureau —
 * 054's header makes that same argument about its own `source` column.
 *
 * Either argument may be null: one card known to only one source merges to
 * itself. Both null returns null.
 */
export function mergeCardView(tradeline, liability) {
  if (!tradeline && !liability) return null;

  const bureauSource = tradeline ? (tradeline.source || "crs") : null;
  const value = {};
  const provenance = {};

  for (const f of MERGE_FIELDS) {
    const rawBank = f.bank && liability ? liability[f.bank] : undefined;
    const rawBureau = f.bureau && tradeline ? tradeline[f.bureau] : undefined;
    const bankValue = rawBank === undefined || rawBank === null ? null : rawBank;
    const bureauValue = rawBureau === undefined || rawBureau === null ? null : rawBureau;

    const chosen = bankValue !== null ? bankValue : bureauValue;
    const from = bankValue !== null ? "bank" : (bureauValue !== null ? bureauSource : null);

    value[f.key] = chosen === null ? null
      : f.cents ? asCents(chosen)
        : f.rate ? asRate(chosen)
          : chosen;
    provenance[f.key] = from;
  }

  return {
    cardLiabilityId: liability ? liability.id ?? null : null,
    tradelineId: tradeline ? tradeline.id ?? null : (liability ? liability.tradeline_id ?? null : null),
    clientId: (liability && liability.client_id) || (tradeline && tradeline.client_id) || null,
    ...value,
    // Derived here rather than stored anywhere, same rule 054 states: one
    // answer, computed at read time, from the merged values rather than from
    // either source alone.
    utilisation: utilisation(value.balanceCents, value.creditLimitCents),
    availableCents: availableCreditCents(value.creditLimitCents, value.balanceCents),
    provenance
  };
}
