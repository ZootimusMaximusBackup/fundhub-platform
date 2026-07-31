// Cash-flow projection and the card-payment window.
//
// The question this module answers is the owner's, in his words: "when to set up
// your payment so cash flow doesn't get messed up with outgoing." Getting it
// wrong is not a cosmetic bug. Recommend a date that is too early and the client
// overdraws — a real fee on a real account. Recommend one that is too late, or
// refuse to recommend at all when an answer was available, and the client misses
// a card payment — a real late fee and a real credit-report mark on a product
// whose entire purpose is repairing credit.
//
// PURE. No I/O, no database, no network, no clock. `now` is a parameter. There
// is no import from src/banking/plaid, src/banking/liabilities or
// src/banking/recurring (W5/W6/W7) and there must not be one: balances, bills
// and liabilities arrive as arguments. That is what let this module be built and
// exhaustively tested before any of those landed, and it is what keeps the maths
// testable without a fixture database.
//
//
// ── THE ONE RULE THAT GOVERNS EVERY DECISION BELOW ──────────────────────────
//
// *** AN INCOMPLETE INPUT PRODUCES NULL WITH A STATED REASON. NEVER A NUMBER. ***
//
// Not a zero, not a default, not a "reasonable assumption", not the answer you
// would get by ignoring the missing part. Every refusal in this file carries a
// machine-readable `code` and a sentence a person can read, and every one of
// them names the input that was missing. A confident date built on a guess is
// the single most dangerous thing this module could produce, because it looks
// exactly like a date built on facts.
//
// This is the same contract src/calculators/deal-funding.mjs states as "any
// missing required input → null-bearing output", and the same one
// 054_tradelines.sql wrote into the schema for a missing APR: "NULL is a real
// answer and must survive ... defaulting APR to zero here would silently make an
// unknown card the cheapest money the waterfall can find, and it would be drawn
// first."
//
//
// ── THRESHOLDS ARE ROWS. THIS FILE HOLDS NONE. ─────────────────────────────
//
// There is no constant in this file that a person could have decided
// differently. No safety buffer, no confidence floor, no settlement lead time,
// no "warn N days before due". Every one of those is an operator policy, and
// this repository has already paid for putting one in code: src/shifts/timesheet.mjs
// carried $6.25/hr, 0.25% and a $500-per-$3,000 flat as constants while
// commission_rules owned the same question, and read one of them differently
// enough that a $6,000 deposit was $1,000 in one place and $500 in the other.
// Two payable answers to one question is the defect, whether or not they
// disagree yet.
//
// So thresholds come in through the `thresholds` argument, and WHEN ONE IS
// ABSENT THAT ABSENCE IS REPORTED, in `thresholdGaps`, rather than filled in.
// *** THERE IS NO TABLE IN THIS SCHEMA THAT HOLDS ANY OF THEM TODAY. *** Checked
// before writing: no cashflow_settings, no banking_config, no threshold column
// anywhere in db/schema or db/migrations, and src/config/ holds three pure
// classifiers with no operator numbers in them. That gap is a finding and it is
// recorded on the workflow board; it is not this file's to close by inventing a
// number, and migration 087 deliberately does not invent one either.
//
// The one number this file does use is ZERO, as the balance floor, and it is not
// a threshold: "without driving the projected balance below zero" is the
// question the owner asked, stated in the task. A buffer ABOVE zero is a policy
// and needs a row; the zero line itself is the specification.
//
//
// ── WHY THERE ARE TWO BALANCE TRACKS ON EVERY DAY ──────────────────────────
//
// A bill that W7 detected with low confidence is neither a certainty nor a
// nothing, and both ways of forcing it into one number are wrong in a way that
// hurts:
//
//   Drop it        -> the projection shows more cash than may exist -> we clear
//                     a payment that overdraws the account.
//   Treat it as certain -> the projection shows less cash than probably exists
//                     -> we refuse a payment date that was fine, and the client
//                     is told to pay later than they needed to.
//
// The first one costs an overdraft fee. So every day carries BOTH:
//
//   closingCents           committed money only — confirmed bills and known card
//                          minimums. What is definitely happening.
//   worstCaseClosingCents  committed PLUS everything unconfirmed. What could
//                          happen if every uncertain bill is real.
//
// *** paymentWindow() decides feasibility on worstCaseClosingCents, always. ***
// A date is only offered if it survives the pessimistic track. The optimistic
// track is reported so a human can see the spread and see exactly which
// unconfirmed bills caused a date to be refused — that is what `components`
// on each day is for.
//
//
// ── BLIND SPOTS ARE NOT THE SAME AS UNCERTAINTY, AND THEY STOP EVERYTHING ───
//
// An unconfirmed bill has a known amount and a known date and merely might not
// happen; the worst-case track prices it exactly. A BLIND SPOT is an obligation
// this module knows exists and cannot quantify at all — a card with a due date
// and no minimum payment, a card with a balance and no due date. There is no
// pessimistic number to fall back on, because the true figure is unbounded as
// far as anything here knows.
//
// A projection with a blind spot is therefore NOT a basis for a payment date,
// and paymentWindow() refuses outright when one exists rather than returning a
// window computed over the part it happens to be able to see. This is the
// mechanism by which "never a confident date built on a guess" is actually
// enforced, rather than merely intended.
//
//
// ── MONEY IS INTEGER CENTS, AND STRINGS ARE REFUSED ────────────────────────
//
// Every amount in and out of this module is an integer number of cents. There
// is no rounding anywhere in this file, deliberately: a projection is addition
// and subtraction of integers, and an integer-cents pipeline that never divides
// has nothing to round. `fromCents` from src/commissions/money.mjs renders the
// human-readable strings so there is exactly one answer to "how do cents look".
//
// *** A NUMERIC STRING IS REJECTED, NOT PARSED, AND THAT IS ON PURPOSE. ***
// money.mjs's toCents("1050") means ONE THOUSAND AND FIFTY DOLLARS. If this
// module also accepted "1050" and read it as ten dollars fifty, the repository
// would hold two contradictory readings of the same string and the difference
// would be a factor of one hundred in somebody's bank balance. Callers convert
// at the boundary. This matters most for pg: a `bigint` column comes back from
// node-postgres as a STRING, so the read path must convert deliberately instead
// of passing the driver's output straight through.
//
// A bare number for a DATE is refused for the same family of reason that
// src/shifts/timesheet.mjs refuses one: seconds and milliseconds are
// indistinguishable at a glance and guessing wrong is a factor-of-1000 error.
//
//
// ── WHAT THIS MODULE DELIBERATELY DOES NOT DO ──────────────────────────────
//
// NO RECURRENCE ENGINE. `recurringBills` take explicit dated `occurrences`.
// This module does not expand "the 15th of every month" into dates, because
// month-end semantics are a real decision with no source here (does a bill on
// the 31st fall on 28 February, on 1 March, or not at all?) and because
// DETECTING recurrence is W7's job by the scope fence. W7 detects the pattern
// and hands over dates; this module adds up money. That seam is deliberate and
// it is the reason this file could be finished first.
//
// NO WRITES, NO REMINDERS, NO DELIVERY. Nothing here creates a reminder row,
// and nothing here sends anything. Reminder storage is migration 087 and
// src/banking/reminders.mjs; delivery does not exist anywhere in this
// repository and is not being added.
//
// NO SECOND ANSWER TO deal-funding.mjs. src/calculators/deal-funding.mjs asks a
// different question — how much can be drawn across cards, and in what order —
// in floating-point dollars. This module asks when money moves, in integer
// cents. Neither computes the other's number, and neither should start to.

// ── COMPLIANCE REVIEW REQUIRED — ESTIMATES SHOWN TO A CONSUMER ─────────────
//
// recordReminders() composes sentences that quote PROJECTED figures and
// PREDICTED dates to a client of a regulated consumer-finance product. Two
// things about that need a human's sign-off before any of it reaches a screen:
//
//   1. Every number in a reminder body is an ESTIMATE, and the wording has to
//      keep saying so. The bodies below say "projected" and "estimated" in
//      every sentence that carries a figure, on purpose. That is a compliance
//      choice, not a style one, and it must not be edited out for brevity.
//   2. NOTHING HERE MAY BECOME ADVICE. These sentences state what the arithmetic
//      shows and what is unknown. They do not tell anyone what to do with a
//      credit account, and they make no claim whatsoever about a credit
//      outcome, a score, or what paying on a given date will do to either.
//
// Flagged rather than blocked: this produces rows, and no row reaches a person
// until somebody builds a surface for it, which is a separate decision.

import { fromCents } from "../commissions/money.mjs";

/**
 * CashflowInputError — the caller passed something that is not the kind of thing
 * it claims to be: a date that is not a date, a "cents" value with a fraction in
 * it, a horizon of "twelve".
 *
 * Same shape as ShiftError (src/shifts/store.mjs) and InquiryWriteError
 * (src/inquiries/work.mjs): a message, a name, and a `.status` an endpoint's
 * catch block maps straight onto a response. 400, because every case is the
 * caller's input.
 *
 * *** THIS IS NOT THE SAME THING AS A REFUSAL. *** A refusal (`ok: false` with a
 * reason) means the inputs were well-formed and the answer is genuinely unknown
 * — a missing due date, an unknown balance. That is an ANSWER and callers must
 * handle it. A throw means the inputs were malformed and the caller has a bug.
 * Conflating the two would let "we don't know" and "you called this wrong" reach
 * a screen as the same thing.
 */
export class CashflowInputError extends Error {
  constructor(message, { status = 400 } = {}) {
    super(message);
    this.name = "CashflowInputError";
    this.status = status;
  }
}

const DAY_MS = 86_400_000;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ]/;

/* Largest horizon we will project. Not a policy threshold — a guard against a
   typo'd `horizonDays` allocating a multi-million-entry array and taking the
   process down. Ten years is far past any useful cash-flow horizon and far
   short of anything that hurts. Same intent as MAX_CENTS in money.mjs. */
const MAX_HORIZON_DAYS = 3_650;

const pad2 = (n) => String(n).padStart(2, "0");

/**
 * A calendar day as a whole number of days since 1970-01-01 UTC.
 *
 * EVERYTHING IN THIS MODULE IS UTC CALENDAR DAYS. A projection is a sequence of
 * days, not of instants, and a bill due "on the 4th" is due on the 4th wherever
 * the reader is sitting. Taking the UTC date part of a timestamp keeps a
 * timestamp and a plain date from landing on different days for the same event.
 * A caller whose bank posts on local days converts at the boundary, once, rather
 * than having this module guess at a zone it was never told.
 *
 * Accepts 'YYYY-MM-DD', an ISO datetime, or a Date. Refuses a bare number: an
 * epoch in seconds and an epoch in milliseconds look identical and guessing
 * wrong is a fifty-year error.
 */
function toDayNumber(value, field) {
  if (value === null || value === undefined || value === "") {
    throw new CashflowInputError(`${field} is required`);
  }
  let y;
  let m;
  let d;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new CashflowInputError(`${field} is an Invalid Date`);
    }
    y = value.getUTCFullYear();
    m = value.getUTCMonth() + 1;
    d = value.getUTCDate();
  } else if (typeof value === "string") {
    const s = value.trim();
    const hit = DATE_ONLY.exec(s) || DATE_TIME.exec(s);
    if (!hit) {
      throw new CashflowInputError(`${field} is not an ISO date: ${JSON.stringify(value)}`);
    }
    y = Number(hit[1]);
    m = Number(hit[2]);
    d = Number(hit[3]);
  } else {
    throw new CashflowInputError(
      `${field} must be an ISO date string or a Date, got ${typeof value}`
    );
  }
  const ms = Date.UTC(y, m - 1, d);
  const back = new Date(ms);
  /* Date.UTC is happy to roll 2026-02-30 forward into March and 0000-01-01 back
     to 1900. Round-tripping is the only way to tell a real calendar date from
     one that merely parsed. A silently-shifted due date is a missed payment. */
  if (
    !Number.isFinite(ms) ||
    back.getUTCFullYear() !== y ||
    back.getUTCMonth() + 1 !== m ||
    back.getUTCDate() !== d
  ) {
    throw new CashflowInputError(`${field} is not a real calendar date: ${JSON.stringify(value)}`);
  }
  return Math.round(ms / DAY_MS);
}

/** Day number back to 'YYYY-MM-DD'. */
function fromDayNumber(dayNumber) {
  const dt = new Date(dayNumber * DAY_MS);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/**
 * An integer number of cents, or a throw.
 *
 * Rejects floats (10.5 cents is not a thing), NaN, Infinity, strings, bigints
 * and objects. `Number.isSafeInteger` rather than `Number.isInteger` because
 * beyond 2^53 addition silently stops being exact, and a projection is nothing
 * but repeated addition.
 */
function requireCents(value, field) {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new CashflowInputError(
      `${field} must be an integer number of cents, got ${JSON.stringify(value)}` +
        (typeof value === "string" ? " (strings are refused — convert at the boundary)" : "")
    );
  }
  return value;
}

/** Cents, or null for "genuinely unknown". Anything else still throws. */
function optionalCents(value, field) {
  if (value === null || value === undefined) return null;
  return requireCents(value, field);
}

/** A non-negative integer count of cents — an amount that cannot be negative. */
function requireNonNegativeCents(value, field) {
  const cents = requireCents(value, field);
  if (cents < 0) throw new CashflowInputError(`${field} must not be negative: ${cents}`);
  return cents;
}

function requireArray(value, field) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new CashflowInputError(`${field} must be an array, got ${typeof value}`);
  }
  return value;
}

/** A label that is safe to show a person, without inventing one. */
function labelOf(row, idField) {
  const raw = row?.label ?? row?.name;
  if (typeof raw === "string" && raw.trim() !== "") return raw.trim();
  const id = row?.[idField];
  return id === undefined || id === null || id === "" ? "(unlabelled)" : String(id);
}

function idOf(row, idField, index, kind) {
  const id = row?.[idField];
  if (id === undefined || id === null || id === "") return `${kind}:${index}`;
  return String(id);
}

/** A component of a day's movement, rendered once so every consumer agrees. */
function component({ direction, kind, sourceId, label, amountCents, certainty, confidence = null, subjectId = null }) {
  return {
    direction,
    kind,
    sourceId,
    /* THE DATABASE KEY FOR THIS COMPONENT'S SUBJECT, when it has one.

       sourceId is a STREAM identity and for a bill it is the composite
       "<bankAccountId>:<merchantKey>:<cadence>" that survives re-detection. It
       is not a uuid and must never be written to a uuid column —
       cashflow_reminders.subject_id (087:113) raised Postgres 22P02 on exactly
       that, surfacing as a flat 400 on the one case the cash-flow screen is for.

       NULL when the subject has no stored row. A writer MUST check rather than
       fall back to sourceId, because falling back is the original defect. */
    subjectId,
    label,
    amountCents,
    amount: fromCents(amountCents),
    certainty,
    confidence
  };
}

/**
 * Classify a bill as confirmed or unconfirmed.
 *
 * `confidence` is whatever W7's detector attached. Three cases, and none of them
 * involves choosing a number:
 *
 *   confidence null/absent  -> UNCONFIRMED. Not a guess: nothing said it was
 *                             certain, and the worst-case track prices it. This
 *                             is the conservative reading of "we don't know".
 *   numeric, floor supplied -> compared against the floor. An operator decided.
 *   numeric, NO floor       -> UNCONFIRMED, and the missing threshold is
 *                             reported in thresholdGaps. The bill still lands in
 *                             the worst case, so nothing is silently dropped and
 *                             nothing is silently promoted to certain. Picking a
 *                             floor here to "make it work" is precisely the
 *                             defect this file refuses to reproduce.
 *
 * `confirmed: true` on the bill itself is an explicit statement by the caller
 * and is honoured — that is how a bill a human has eyeballed becomes certain
 * without any threshold existing at all.
 */
function classifyBill(bill, confidenceFloor, gaps) {
  if (bill?.confirmed === true) return { certainty: "confirmed", confidence: null, reason: null };

  const raw = bill?.confidence;
  if (raw === null || raw === undefined) {
    return {
      certainty: "unconfirmed",
      confidence: null,
      reason: "no confidence was supplied for this bill, so it is carried as unconfirmed"
    };
  }
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    throw new CashflowInputError(
      `recurringBills[].confidence must be a finite number or null, got ${JSON.stringify(raw)}`
    );
  }
  if (raw < 0 || raw > 1) {
    throw new CashflowInputError(
      `recurringBills[].confidence must be between 0 and 1, got ${raw}`
    );
  }
  if (confidenceFloor === null) {
    gaps.add("confidenceFloor");
    return {
      certainty: "unconfirmed",
      confidence: raw,
      reason:
        "this bill carries a confidence score but no confidence floor was supplied, " +
        "so it cannot be classified and is carried as unconfirmed"
    };
  }
  return raw >= confidenceFloor
    ? { certainty: "confirmed", confidence: raw, reason: null }
    : {
        certainty: "unconfirmed",
        confidence: raw,
        reason: `confidence ${raw} is below the supplied floor of ${confidenceFloor}`
      };
}

/**
 * Read and validate the thresholds bag.
 *
 * Every field is optional and every absence is recorded rather than filled in.
 * The bag exists so that the day a `cashflow_settings` table is created, the
 * only change here is where the caller reads the row from.
 */
function readThresholds(thresholds) {
  if (thresholds === undefined || thresholds === null) {
    return { minBufferCents: null, confidenceFloor: null, settlementLeadDays: null };
  }
  if (typeof thresholds !== "object" || Array.isArray(thresholds)) {
    throw new CashflowInputError("thresholds must be an object");
  }
  const minBufferCents =
    thresholds.minBufferCents === undefined || thresholds.minBufferCents === null
      ? null
      : requireNonNegativeCents(thresholds.minBufferCents, "thresholds.minBufferCents");

  let confidenceFloor = null;
  if (thresholds.confidenceFloor !== undefined && thresholds.confidenceFloor !== null) {
    const f = thresholds.confidenceFloor;
    if (typeof f !== "number" || !Number.isFinite(f) || f < 0 || f > 1) {
      throw new CashflowInputError(
        `thresholds.confidenceFloor must be a number between 0 and 1, got ${JSON.stringify(f)}`
      );
    }
    confidenceFloor = f;
  }

  let settlementLeadDays = null;
  if (thresholds.settlementLeadDays !== undefined && thresholds.settlementLeadDays !== null) {
    const n = thresholds.settlementLeadDays;
    if (!Number.isSafeInteger(n) || n < 0) {
      throw new CashflowInputError(
        `thresholds.settlementLeadDays must be a non-negative whole number of days, got ${JSON.stringify(n)}`
      );
    }
    settlementLeadDays = n;
  }

  return { minBufferCents, confidenceFloor, settlementLeadDays };
}

/** The stated-reason shape. Every refusal in this file produces one of these. */
function reason(code, message, details = {}) {
  return { code, message, details };
}

const GAP_NOTES = {
  minBufferCents:
    "No safety buffer was supplied, so the floor is the zero the task states. " +
    "A buffer above zero is an operator policy and needs a row; there is no table for it in this schema.",
  confidenceFloor:
    "At least one bill carries a confidence score and no floor was supplied to compare it against, " +
    "so those bills are carried as unconfirmed. The floor is an operator policy and needs a row.",
  settlementLeadDays:
    "No settlement lead time was supplied, so this module will not say when to INITIATE a payment — " +
    "only when it must land. Assuming a payment posts the same day is a claim about payment rails " +
    "that is often false, and being wrong about it is a missed payment."
};

function gapsToList(gapSet) {
  return [...gapSet].map((name) => ({ name, note: GAP_NOTES[name] }));
}

/**
 * project({ balances, expectedInflows, recurringBills, cardLiabilities, now, horizonDays, thresholds })
 *
 * A day-by-day projected balance, and every inflow and outflow that produced it.
 *
 * THE OUTPUT IS THE EXPLANATION, NOT A NUMBER WITH AN EXPLANATION BOLTED ON.
 * Each day carries the components that moved money that day, each tagged with
 * where it came from, so "why is Thursday low" is answered by reading the day
 * rather than by re-deriving it. paymentWindow() then works off those same
 * components, which is what lets it subtract a card's own scheduled minimum
 * without the caller having to build a second projection.
 *
 * @param {object}  opts
 * @param {Array}   opts.balances        [{ accountId, balanceCents, asOf?, label? }]
 *                                       balanceCents may be null — that is "unknown",
 *                                       and it refuses the projection rather than reading as 0.
 * @param {Array}   [opts.expectedInflows] [{ inflowId, label?, occurrences: [{date, amountCents}] }]
 *                                       Money arriving. Optional: an empty list means no income is
 *                                       modelled, which UNDERSTATES cash and is therefore safe —
 *                                       it can only make this module refuse a payment date it would
 *                                       otherwise have allowed, never the reverse.
 * @param {Array}   [opts.recurringBills] [{ billId, label?, confidence?, confirmed?,
 *                                           occurrences: [{date, amountCents}] }]
 * @param {Array}   [opts.cardLiabilities] [{ liabilityId, label?, dueDate?, minimumPaymentCents?,
 *                                            statementBalanceCents?, statementClose? }]
 * @param {string|Date} opts.now         the day the projection starts. No clock in here.
 * @param {number}  opts.horizonDays     how many days to project, including `now`. Required:
 *                                       a default horizon is a policy nobody stated.
 * @param {object}  [opts.thresholds]    { minBufferCents?, confidenceFloor?, settlementLeadDays? }
 *
 * @returns {object} ok:true with days, or ok:false with a reason. Never throws for
 *                   a missing fact; always throws for a malformed one.
 */
export function project({
  balances,
  expectedInflows,
  recurringBills,
  cardLiabilities,
  now,
  horizonDays,
  thresholds
} = {}) {
  const { confidenceFloor } = readThresholds(thresholds);
  const gaps = new Set();

  const startDay = toDayNumber(now, "now");

  if (!Number.isSafeInteger(horizonDays)) {
    throw new CashflowInputError(
      `horizonDays must be a whole number of days, got ${JSON.stringify(horizonDays)}`
    );
  }
  if (horizonDays < 1) {
    throw new CashflowInputError(`horizonDays must be at least 1, got ${horizonDays}`);
  }
  if (horizonDays > MAX_HORIZON_DAYS) {
    throw new CashflowInputError(
      `horizonDays must not exceed ${MAX_HORIZON_DAYS}, got ${horizonDays}`
    );
  }

  const balanceRows = requireArray(balances, "balances");
  const inflowRows = requireArray(expectedInflows, "expectedInflows");
  const billRows = requireArray(recurringBills, "recurringBills");
  const cardRows = requireArray(cardLiabilities, "cardLiabilities");

  const endDay = startDay + horizonDays - 1;
  const shell = {
    ok: false,
    reason: null,
    startDate: fromDayNumber(startDay),
    endDate: fromDayNumber(endDay),
    horizonDays,
    openingBalanceCents: null,
    openingBalance: null,
    accounts: [],
    days: null,
    lowestClosingCents: null,
    lowestClosingDate: null,
    lowestWorstCaseClosingCents: null,
    lowestWorstCaseClosingDate: null,
    blindSpots: [],
    excluded: [],
    unconfirmed: [],
    thresholdGaps: []
  };

  // ── 1. Opening balance. An unknown account balance stops everything. ───────
  //
  // There is no honest way to project from a balance you do not know. Summing
  // the accounts you DO know and calling it the opening balance would produce a
  // number that is confidently too low, and a payment window built on it would
  // be confidently too tight — which sounds safe and is not, because the client
  // then pays late to satisfy a constraint that was never real.
  if (balanceRows.length === 0) {
    return {
      ...shell,
      reason: reason(
        "NO_BALANCES",
        "No account balances were supplied, so there is nothing to project from."
      )
    };
  }

  const accounts = [];
  const unknownAccounts = [];
  let openingBalanceCents = 0;
  for (const [i, row] of balanceRows.entries()) {
    const accountId = idOf(row, "accountId", i, "account");
    const label = labelOf(row, "accountId");
    const cents = optionalCents(row?.balanceCents, `balances[${i}].balanceCents`);
    accounts.push({
      accountId,
      label,
      balanceCents: cents,
      balance: cents === null ? null : fromCents(cents),
      asOf: row?.asOf === undefined || row?.asOf === null ? null : fromDayNumber(toDayNumber(row.asOf, `balances[${i}].asOf`))
    });
    if (cents === null) unknownAccounts.push({ accountId, label });
    else openingBalanceCents += cents;
  }

  if (unknownAccounts.length > 0) {
    return {
      ...shell,
      accounts,
      reason: reason(
        "UNKNOWN_BALANCE",
        unknownAccounts.length === 1
          ? `The balance of account "${unknownAccounts[0].label}" is unknown, so the opening balance is unknown. An unknown balance is not zero.`
          : `${unknownAccounts.length} account balances are unknown, so the opening balance is unknown. An unknown balance is not zero.`,
        { accounts: unknownAccounts }
      )
    };
  }

  // ── 2. Lay every dated movement onto its day. ─────────────────────────────
  const perDay = Array.from({ length: horizonDays }, () => []);
  const excluded = [];
  const unconfirmedIndex = new Map();
  const blindSpots = [];

  const place = (dayNumber, comp, { kind, sourceId, label }) => {
    if (dayNumber < startDay) {
      excluded.push({
        kind,
        sourceId,
        label,
        date: fromDayNumber(dayNumber),
        reason:
          "dated before the projection starts — whether it was paid or is overdue is not this module's call"
      });
      return;
    }
    if (dayNumber > endDay) {
      excluded.push({
        kind,
        sourceId,
        label,
        date: fromDayNumber(dayNumber),
        reason: "dated after the end of the horizon"
      });
      return;
    }
    perDay[dayNumber - startDay].push(comp);
  };

  const readOccurrences = (row, i, field) => {
    const occ = row?.occurrences;
    if (!Array.isArray(occ)) {
      throw new CashflowInputError(
        `${field}[${i}].occurrences must be an array of {date, amountCents} — this module does not expand recurrence rules, see the header`
      );
    }
    return occ;
  };

  for (const [i, row] of inflowRows.entries()) {
    const sourceId = idOf(row, "inflowId", i, "inflow");
    const label = labelOf(row, "inflowId");
    for (const [j, occ] of readOccurrences(row, i, "expectedInflows").entries()) {
      const day = toDayNumber(occ?.date, `expectedInflows[${i}].occurrences[${j}].date`);
      const cents = requireNonNegativeCents(
        occ?.amountCents,
        `expectedInflows[${i}].occurrences[${j}].amountCents`
      );
      place(
        day,
        component({
          direction: "in",
          kind: "inflow",
          sourceId,
          label,
          amountCents: cents,
          certainty: row?.confirmed === true ? "confirmed" : "unconfirmed"
        }),
        { kind: "inflow", sourceId, label }
      );
    }
  }

  for (const [i, row] of billRows.entries()) {
    const sourceId = idOf(row, "billId", i, "bill");
    const label = labelOf(row, "billId");
    const cls = classifyBill(row, confidenceFloor, gaps);
    if (cls.certainty === "unconfirmed" && !unconfirmedIndex.has(sourceId)) {
      unconfirmedIndex.set(sourceId, {
        kind: "bill",
        sourceId,
        label,
        confidence: cls.confidence,
        reason: cls.reason
      });
    }
    for (const [j, occ] of readOccurrences(row, i, "recurringBills").entries()) {
      const day = toDayNumber(occ?.date, `recurringBills[${i}].occurrences[${j}].date`);
      const cents = requireNonNegativeCents(
        occ?.amountCents,
        `recurringBills[${i}].occurrences[${j}].amountCents`
      );
      place(
        day,
        component({
          direction: "out",
          kind: "bill",
          sourceId,
          // The stored recurring_bills uuid, carried by toCashflowBill(). NULL
          // for a hand-built bill that was never stored.
          subjectId: row?.subjectId ?? null,
          label,
          amountCents: cents,
          certainty: cls.certainty,
          confidence: cls.confidence
        }),
        { kind: "bill", sourceId, label }
      );
    }
  }

  // ── 3. Card liabilities. A card you cannot price is a blind spot. ─────────
  //
  // A card contributes its MINIMUM payment on its due date, because paying the
  // minimum is the floor of what must leave the account to avoid a missed
  // payment. It does not contribute the statement balance: how much above the
  // minimum to pay is the decision paymentWindow() is being asked to support,
  // not an assumption to bake into the projection.
  for (const [i, row] of cardRows.entries()) {
    const sourceId = idOf(row, "liabilityId", i, "card");
    const label = labelOf(row, "liabilityId");
    const hasDue = row?.dueDate !== undefined && row?.dueDate !== null && row?.dueDate !== "";
    const minCents = optionalCents(row?.minimumPaymentCents, `cardLiabilities[${i}].minimumPaymentCents`);

    if (!hasDue) {
      blindSpots.push({
        kind: "card",
        sourceId,
        // A card's sourceId is the card_liabilities uuid, so it is a real
        // database key. Carried explicitly so recordReminders() can write it.
        subjectId: sourceId,
        label,
        reason:
          "this card has no due date, so the day its payment must leave the account is unknown"
      });
      continue;
    }
    const dueDay = toDayNumber(row.dueDate, `cardLiabilities[${i}].dueDate`);

    if (minCents === null) {
      blindSpots.push({
        kind: "card",
        sourceId,
        // A card's sourceId is the card_liabilities uuid, so it is a real
        // database key. Carried explicitly so recordReminders() can write it.
        subjectId: sourceId,
        label,
        date: fromDayNumber(dueDay),
        reason:
          "this card has a due date but no minimum payment, so the amount that must leave the account is unknown — and an unknown amount is not zero"
      });
      continue;
    }
    if (minCents < 0) {
      throw new CashflowInputError(
        `cardLiabilities[${i}].minimumPaymentCents must not be negative: ${minCents}`
      );
    }
    if (dueDay > endDay) {
      excluded.push({
        kind: "card",
        sourceId,
        label,
        date: fromDayNumber(dueDay),
        reason: "due after the end of the horizon"
      });
      continue;
    }
    /* A due date already in the past is NOT quietly dropped the way a past bill
       occurrence is. A bill dated last week has plausibly been paid; a card
       payment whose due date has passed is either paid or already late, and
       "already late" is exactly the state a person needs told about. It becomes
       a blind spot so no window is built over it. */
    if (dueDay < startDay) {
      blindSpots.push({
        kind: "card",
        sourceId,
        // A card's sourceId is the card_liabilities uuid, so it is a real
        // database key. Carried explicitly so recordReminders() can write it.
        subjectId: sourceId,
        label,
        date: fromDayNumber(dueDay),
        reason:
          "this card's due date has already passed — whether it was paid is unknown here, and a window must not be built over a payment that may already be late"
      });
      continue;
    }
    place(
      dueDay,
      component({
        direction: "out",
        kind: "card_minimum",
        sourceId,
        // A card's sourceId IS the card_liabilities uuid, so it is already a
        // valid database key. Stated explicitly rather than defaulted, so the
        // bill case cannot silently inherit a fallback and reintroduce 22P02.
        subjectId: sourceId,
        label,
        amountCents: minCents,
        certainty: "confirmed"
      }),
      { kind: "card", sourceId, label }
    );
  }

  // ── 4. Walk the days, carrying both tracks. ───────────────────────────────
  const days = [];
  let running = openingBalanceCents;
  let worstRunning = openingBalanceCents;
  let lowestClosingCents = null;
  let lowestClosingDate = null;
  let lowestWorstCaseClosingCents = null;
  let lowestWorstCaseClosingDate = null;

  for (let i = 0; i < horizonDays; i += 1) {
    const dayNumber = startDay + i;
    const date = fromDayNumber(dayNumber);
    const comps = perDay[i];

    let inflowCents = 0;
    let committedOutflowCents = 0;
    let unconfirmedOutflowCents = 0;
    let unconfirmedInflowCents = 0;
    for (const c of comps) {
      if (c.direction === "in") {
        /* An UNCONFIRMED INFLOW IS WORTH NOTHING IN EITHER TRACK, and that
           asymmetry is deliberate. The worst case for a bank balance is that
           expected money does not arrive and expected bills do. Counting a
           maybe-paycheck in the pessimistic track would make the pessimistic
           track optimistic, which defeats the only reason it exists. */
        if (c.certainty === "confirmed") inflowCents += c.amountCents;
        else unconfirmedInflowCents += c.amountCents;
      } else if (c.certainty === "confirmed") {
        committedOutflowCents += c.amountCents;
      } else {
        unconfirmedOutflowCents += c.amountCents;
      }
    }

    const openingCents = running;
    const worstCaseOpeningCents = worstRunning;
    running = running + inflowCents - committedOutflowCents;
    worstRunning = worstRunning + inflowCents - committedOutflowCents - unconfirmedOutflowCents;

    days.push({
      date,
      dayIndex: i,
      openingCents,
      openingBalance: fromCents(openingCents),
      inflowCents,
      unconfirmedInflowCents,
      committedOutflowCents,
      unconfirmedOutflowCents,
      netCents: inflowCents - committedOutflowCents,
      worstCaseNetCents: inflowCents - committedOutflowCents - unconfirmedOutflowCents,
      closingCents: running,
      closingBalance: fromCents(running),
      worstCaseOpeningCents,
      worstCaseClosingCents: worstRunning,
      worstCaseClosingBalance: fromCents(worstRunning),
      belowZero: running < 0,
      worstCaseBelowZero: worstRunning < 0,
      components: comps
    });

    if (lowestClosingCents === null || running < lowestClosingCents) {
      lowestClosingCents = running;
      lowestClosingDate = date;
    }
    if (lowestWorstCaseClosingCents === null || worstRunning < lowestWorstCaseClosingCents) {
      lowestWorstCaseClosingCents = worstRunning;
      lowestWorstCaseClosingDate = date;
    }
  }

  return {
    ...shell,
    ok: true,
    reason: null,
    openingBalanceCents,
    openingBalance: fromCents(openingBalanceCents),
    accounts,
    days,
    lowestClosingCents,
    lowestClosingDate,
    lowestWorstCaseClosingCents,
    lowestWorstCaseClosingDate,
    blindSpots,
    excluded,
    unconfirmed: [...unconfirmedIndex.values()],
    thresholdGaps: gapsToList(gaps)
  };
}

/**
 * Rebuild the pessimistic running balance with some components removed.
 *
 * WHY THIS EXISTS, AND IT IS THE SUBTLEST THING IN THE FILE. project() already
 * charged each card's minimum payment on its due date. paymentWindow() is then
 * asked "when should I pay this card" — and if it simply subtracted the payment
 * from that same projection, the card's money would leave the account twice and
 * every date would look worse than it is. Dates would be refused that were
 * genuinely fine, and the client would be told to pay later than necessary.
 *
 * So the subject card's own components are removed from the projection first,
 * and the payment is then applied on the candidate date. Removing them by
 * sourceId — rather than asking the caller to build a second, card-less
 * projection — keeps one projection as the single explanation of the month and
 * makes the double-count structurally impossible instead of merely documented.
 */
function pessimisticTrack(days, openingBalanceCents, excludeSourceIds) {
  const drop = new Set(excludeSourceIds);
  const out = [];
  let running = openingBalanceCents;
  for (const day of days) {
    for (const c of day.components) {
      if (drop.has(c.sourceId)) continue;
      if (c.direction === "in") {
        if (c.certainty === "confirmed") running += c.amountCents;
      } else {
        running -= c.amountCents;
      }
    }
    out.push({ date: day.date, closingCents: running });
  }
  return out;
}

/**
 * paymentWindow({ projectedBalances, dueDate, statementClose, minimumPaymentCents, ... })
 *
 * The range of dates a card payment can land without driving the projected
 * balance below zero, and the recommended date within it.
 *
 * WHAT "FEASIBLE" MEANS HERE, PRECISELY. A payment landing on day D takes money
 * out on D and it never comes back, so it lowers every day from D to the end of
 * the horizon by the same amount. D is feasible when the LOWEST pessimistic
 * balance anywhere from D onward, less the payment, still clears the floor. It
 * is not enough to check D itself: a payment that leaves the account healthy on
 * Tuesday and overdrawn on Friday is an overdraft, just a slower one.
 *
 * @param {object}       opts
 * @param {object|Array} opts.projectedBalances  a project() result (preferred — it carries the
 *                                               components and blind spots this function needs),
 *                                               or a plain [{date, closingCents}] array.
 * @param {string|Date}  opts.dueDate            when the payment must have landed. No due date is
 *                                               a refusal, never a guess.
 * @param {string|Date}  [opts.statementClose]   when the statement closed.
 * @param {number}       [opts.minimumPaymentCents]
 * @param {number}       [opts.paymentAmountCents] what will actually be paid. Falls back to the
 *                                                 minimum, and says so in `amountBasis`.
 * @param {string[]}     [opts.excludeSourceIds]   components of the projection that represent THIS
 *                                                 card, so its minimum is not counted twice.
 * @param {string|Date}  [opts.now]              defaults to the projection's first day.
 * @param {object}       [opts.thresholds]       { minBufferCents?, settlementLeadDays? }
 */
export function paymentWindow({
  projectedBalances,
  dueDate,
  statementClose,
  minimumPaymentCents,
  paymentAmountCents,
  excludeSourceIds,
  now,
  thresholds
} = {}) {
  const { minBufferCents, settlementLeadDays } = readThresholds(thresholds);
  const gaps = new Set();

  const shell = {
    ok: false,
    reason: null,
    earliestDate: null,
    latestDate: null,
    recommendedDate: null,
    recommendedReason: null,
    initiateByDate: null,
    initiateByReason: null,
    amountCents: null,
    amount: null,
    amountBasis: null,
    floorCents: null,
    floorSource: null,
    statementCloseKnown: false,
    candidates: [],
    notes: [],
    thresholdGaps: []
  };

  // ── 1. Is there a projection at all, and is it safe to build on? ──────────
  if (projectedBalances === null || projectedBalances === undefined) {
    return {
      ...shell,
      reason: reason(
        "PROJECTION_UNAVAILABLE",
        "No projection was supplied, so there is no balance to test a payment against."
      )
    };
  }

  let days = null;
  let openingBalanceCents = null;
  let blindSpots = [];
  const excludes = requireArray(excludeSourceIds, "excludeSourceIds").map(String);

  if (Array.isArray(projectedBalances)) {
    if (excludes.length > 0) {
      throw new CashflowInputError(
        "excludeSourceIds needs a project() result to work against — a plain balance array carries no components to exclude"
      );
    }
    days = projectedBalances.map((d, i) => {
      const date = fromDayNumber(toDayNumber(d?.date, `projectedBalances[${i}].date`));
      const closingCents = requireCents(d?.closingCents, `projectedBalances[${i}].closingCents`);
      return { date, closingCents, components: [] };
    });
    openingBalanceCents = null;
  } else if (typeof projectedBalances === "object") {
    if (projectedBalances.ok !== true) {
      return {
        ...shell,
        reason: reason(
          "PROJECTION_UNAVAILABLE",
          "The projection could not be produced, so no payment date can be recommended.",
          { projectionReason: projectedBalances.reason ?? null }
        )
      };
    }
    days = projectedBalances.days ?? [];
    openingBalanceCents = projectedBalances.openingBalanceCents;
    blindSpots = projectedBalances.blindSpots ?? [];
    for (const g of projectedBalances.thresholdGaps ?? []) gaps.add(g.name);
  } else {
    throw new CashflowInputError(
      `projectedBalances must be a project() result or an array, got ${typeof projectedBalances}`
    );
  }

  if (days.length === 0) {
    return {
      ...shell,
      reason: reason("PROJECTION_UNAVAILABLE", "The projection contains no days.")
    };
  }

  /* A blind spot is money that is definitely leaving and whose size or date is
     unknown. There is no pessimistic figure to fall back on, so every date in
     the window would be a guess dressed as arithmetic. Refuse. */
  if (blindSpots.length > 0) {
    return {
      ...shell,
      reason: reason(
        "PROJECTION_HAS_BLIND_SPOTS",
        blindSpots.length === 1
          ? `The projection cannot see one obligation ("${blindSpots[0].label}"), so any payment date would be a guess.`
          : `The projection cannot see ${blindSpots.length} obligations, so any payment date would be a guess.`,
        { blindSpots }
      ),
      thresholdGaps: gapsToList(gaps)
    };
  }

  // ── 2. The date the payment has to have landed by. ────────────────────────
  if (dueDate === null || dueDate === undefined || dueDate === "") {
    return {
      ...shell,
      reason: reason(
        "MISSING_DUE_DATE",
        "This card has no due date, so there is no window to compute. A date invented here would be a guess about when a real payment is late.",
        { field: "dueDate" }
      ),
      thresholdGaps: gapsToList(gaps)
    };
  }
  const dueDay = toDayNumber(dueDate, "dueDate");

  const firstDay = toDayNumber(days[0].date, "projectedBalances[0].date");
  const lastDay = toDayNumber(days[days.length - 1].date, "projectedBalances[last].date");
  const nowDay = now === undefined || now === null || now === "" ? firstDay : toDayNumber(now, "now");

  if (dueDay < nowDay) {
    return {
      ...shell,
      reason: reason(
        "DUE_DATE_IN_PAST",
        "The due date has already passed. Whether this payment is late is a fact about the account, not something this module can schedule around.",
        { dueDate: fromDayNumber(dueDay), now: fromDayNumber(nowDay) }
      ),
      thresholdGaps: gapsToList(gaps)
    };
  }
  if (dueDay > lastDay) {
    return {
      ...shell,
      reason: reason(
        "DUE_DATE_BEYOND_HORIZON",
        "The projection does not reach the due date, so the days a payment would have to survive have not been projected.",
        { dueDate: fromDayNumber(dueDay), horizonEnds: fromDayNumber(lastDay) }
      ),
      thresholdGaps: gapsToList(gaps)
    };
  }

  let closeDay = null;
  if (statementClose !== undefined && statementClose !== null && statementClose !== "") {
    closeDay = toDayNumber(statementClose, "statementClose");
    if (closeDay > dueDay) {
      return {
        ...shell,
        reason: reason(
          "STATEMENT_CLOSE_AFTER_DUE_DATE",
          "The statement close is after the due date, so these two dates do not describe the same billing cycle and pairing them would produce a window for a statement that has not been issued.",
          { statementClose: fromDayNumber(closeDay), dueDate: fromDayNumber(dueDay) }
        ),
        thresholdGaps: gapsToList(gaps)
      };
    }
  }

  // ── 3. How much is leaving. ───────────────────────────────────────────────
  let amountCents = null;
  let amountBasis = null;
  if (paymentAmountCents !== undefined && paymentAmountCents !== null) {
    amountCents = requireNonNegativeCents(paymentAmountCents, "paymentAmountCents");
    amountBasis = "explicit";
  } else if (minimumPaymentCents !== undefined && minimumPaymentCents !== null) {
    amountCents = requireNonNegativeCents(minimumPaymentCents, "minimumPaymentCents");
    amountBasis = "minimum";
  } else {
    return {
      ...shell,
      reason: reason(
        "UNKNOWN_PAYMENT_AMOUNT",
        "Neither a payment amount nor a minimum payment was supplied, so there is no figure to test against the balance. An unknown amount is not zero.",
        { fields: ["paymentAmountCents", "minimumPaymentCents"] }
      ),
      thresholdGaps: gapsToList(gaps)
    };
  }

  // ── 4. The floor. Zero is the task; a buffer above it is a policy. ────────
  let floorCents = 0;
  let floorSource = "spec-zero";
  if (minBufferCents === null) {
    gaps.add("minBufferCents");
  } else {
    floorCents = minBufferCents;
    floorSource = "buffer-supplied";
  }

  // ── 5. Which landing dates survive. ───────────────────────────────────────
  //
  // Three ways to get the balances to test against, and the choice is not a
  // preference — each one is the only correct reading of what was handed in:
  //
  //   plain array           the caller has already decided what its numbers
  //                         mean, so they are used as given.
  //   project(), no excludes  the PESSIMISTIC track. Always. See the header.
  //   project(), excludes     the pessimistic track recomputed with this card's
  //                         own components removed, so its minimum is not
  //                         charged twice.
  let testable;
  if (Array.isArray(projectedBalances)) {
    testable = days.map((d) => ({ date: d.date, closingCents: d.closingCents }));
  } else if (excludes.length > 0) {
    testable = pessimisticTrack(days, openingBalanceCents, excludes);
  } else {
    testable = days.map((d) => ({ date: d.date, closingCents: d.worstCaseClosingCents }));
  }

  /* Feasibility is looked up by (day - firstDay), which is only a valid index if
     the days really are one per calendar day in ascending order. A project()
     result always is. A caller-supplied array might not be, and a gap would
     silently read the wrong day's balance — a wrong answer that looks like a
     right one, which is the failure mode this whole module exists to avoid. */
  for (let i = 0; i < testable.length; i += 1) {
    const expected = fromDayNumber(firstDay + i);
    if (testable[i].date !== expected) {
      throw new CashflowInputError(
        `projectedBalances must be one row per consecutive day: expected ${expected} at index ${i}, got ${testable[i].date}`
      );
    }
  }

  /* Suffix minima: the lowest balance from each day to the end of the horizon.
     One pass, so feasibility for every candidate date is a lookup rather than a
     rescan, and — more importantly — it is impossible to check only the payment
     day by accident. */
  const suffixMin = new Array(testable.length);
  for (let i = testable.length - 1; i >= 0; i -= 1) {
    suffixMin[i] =
      i === testable.length - 1
        ? testable[i].closingCents
        : Math.min(testable[i].closingCents, suffixMin[i + 1]);
  }

  const notes = [];
  let earliestCandidateDay = nowDay > firstDay ? nowDay : firstDay;
  if (closeDay !== null) {
    /* Paying before the statement closes does not settle the balance this due
       date refers to — it pays down whatever is outstanding now and can leave
       the statement balance still owing. So the window opens at the close. */
    if (closeDay > earliestCandidateDay) earliestCandidateDay = closeDay;
  } else {
    notes.push(
      "No statement close date was supplied, so this window may include dates before the statement closed. A payment made then reduces the current balance but may not settle the statement balance this due date refers to."
    );
  }

  if (earliestCandidateDay > dueDay) {
    return {
      ...shell,
      amountCents,
      amount: fromCents(amountCents),
      amountBasis,
      floorCents,
      floorSource,
      statementCloseKnown: closeDay !== null,
      notes,
      reason: reason(
        "NO_CANDIDATE_DATES",
        "There is no day between the start of the window and the due date for a payment to land on.",
        {
          windowOpens: fromDayNumber(earliestCandidateDay),
          dueDate: fromDayNumber(dueDay)
        }
      ),
      thresholdGaps: gapsToList(gaps)
    };
  }

  const candidates = [];
  let earliestFeasibleDay = null;
  let latestFeasibleDay = null;
  for (let day = earliestCandidateDay; day <= dueDay; day += 1) {
    const idx = day - firstDay;
    if (idx < 0 || idx >= suffixMin.length) continue;
    const lowestAfterCents = suffixMin[idx] - amountCents;
    const feasible = lowestAfterCents >= floorCents;
    candidates.push({
      date: fromDayNumber(day),
      feasible,
      lowestBalanceAfterPaymentCents: lowestAfterCents,
      lowestBalanceAfterPayment: fromCents(lowestAfterCents),
      shortfallCents: feasible ? 0 : floorCents - lowestAfterCents
    });
    if (feasible) {
      if (earliestFeasibleDay === null) earliestFeasibleDay = day;
      latestFeasibleDay = day;
    }
  }

  if (earliestFeasibleDay === null) {
    /* Every date overdraws. This is a refusal and it must stay one — the
       temptation is to hand back "pay on the due date anyway", which is how a
       real overdraft happens. The shortfall is reported so the answer is
       actionable: this is how much more has to be in the account. */
    const best = candidates.reduce((a, b) => (b.shortfallCents < a.shortfallCents ? b : a));
    return {
      ...shell,
      amountCents,
      amount: fromCents(amountCents),
      amountBasis,
      floorCents,
      floorSource,
      statementCloseKnown: closeDay !== null,
      candidates,
      notes,
      reason: reason(
        "WOULD_OVERDRAW",
        `Paying ${fromCents(amountCents)} would push the projected balance below ${fromCents(floorCents)} on every date in the window. The best date is still short by ${fromCents(best.shortfallCents)}.`,
        {
          bestDate: best.date,
          shortfallCents: best.shortfallCents,
          shortfall: fromCents(best.shortfallCents),
          amountBasis
        }
      ),
      thresholdGaps: gapsToList(gaps)
    };
  }

  // ── 6. The recommendation. ────────────────────────────────────────────────
  //
  // The LATEST feasible landing date. The owner's question is how to keep the
  // outgoing from wrecking the cash flow, and money that stays in the account
  // longer is money available for everything else that lands first. Every day
  // between the earliest and the latest is offered so a person who wants slack
  // can take it.
  //
  // WORTH KNOWING: `latestDate` is ALWAYS the due date whenever the window is
  // non-empty, and that is a property of the maths, not a coincidence.
  // Feasibility is monotone — suffixMin[] is non-decreasing in the day, because
  // a later day minimises over a smaller tail, and a payment is a one-off
  // outflow with no other effect. So paying later is never worse than paying
  // earlier. The bound that actually carries information is `earliestDate`:
  // the first day the account can stand it.
  const recommendedDay = latestFeasibleDay;
  let initiateByDate = null;
  let initiateByReason = null;
  if (settlementLeadDays === null) {
    gaps.add("settlementLeadDays");
    initiateByReason = reason(
      "MISSING_SETTLEMENT_LEAD_TIME",
      "No settlement lead time was supplied, so this is the date the payment must LAND, not the date to start it. How many days a payment takes to post depends on the rail and there is no row for it in this system."
    );
  } else {
    initiateByDate = fromDayNumber(recommendedDay - settlementLeadDays);
  }

  if (recommendedDay === dueDay) {
    notes.push(
      "The recommended date is the due date itself, which leaves no slack for a payment that posts late."
    );
  }

  return {
    ...shell,
    ok: true,
    reason: null,
    earliestDate: fromDayNumber(earliestFeasibleDay),
    latestDate: fromDayNumber(latestFeasibleDay),
    recommendedDate: fromDayNumber(recommendedDay),
    recommendedReason: null,
    initiateByDate,
    initiateByReason,
    amountCents,
    amount: fromCents(amountCents),
    amountBasis,
    floorCents,
    floorSource,
    statementCloseKnown: closeDay !== null,
    candidates,
    notes,
    thresholdGaps: gapsToList(gaps)
  };
}

/* A reminder surfaces at the start of its UTC day. project() works in calendar
   days and `cashflow_reminders.surface_at` is a timestamptz, so the two have to
   meet somewhere and midnight UTC is the only point on a day that does not
   require inventing an hour somebody would have had to choose. */
const atStartOfDay = (date) => `${date}T00:00:00.000Z`;

/** Map a projection component's kind onto the reminder table's subject_kind. */
function subjectKindFor(kind) {
  if (kind === "card" || kind === "card_minimum") return "card_liability";
  if (kind === "bill") return "recurring_bill";
  return null;
}

/**
 * recordReminders({ orgId, clientId, projection, window, subject }) — turn a
 * projection and a payment window into the reminder rows they justify.
 *
 * PURE. It RETURNS rows; it does not write them, and it could not send one if
 * it wanted to. Hand the result to createReminder() in src/banking/reminders.mjs.
 * Splitting "decide what to say" from "store it" is what keeps this testable
 * without a database and keeps the storage layer free of judgement.
 *
 * ── WHICH REMINDERS THIS CAN PRODUCE, AND WHY THOSE ────────────────────────
 *
 * Every reminder needs a `surface_at`, and the obvious rule for one — "warn N
 * days before the due date" — HAS NO ROW ANYWHERE IN THIS SCHEMA. So this
 * function only emits reminders whose surfacing date falls out of the model
 * itself, and refuses the rest. Each one below is derived, not chosen:
 *
 *   input_missing        at `now`. Something is unknown and somebody needs to
 *                        go and find it out; there is no reason to wait.
 *   projected_shortfall  at `now`, for the same reason.
 *   statement_closed     on the statement close date. The date IS the event.
 *   payment_due          on the recommended date. The model worked out the day
 *                        the money should move, so that is the day to say so.
 *   payment_window_closing  on the last safe date, and ONLY when that date is
 *                        earlier than the due date — that gap is the surprising,
 *                        dangerous case ("this is due on the 20th but you have
 *                        to pay it by the 12th"). When the two coincide it would
 *                        just be a second copy of payment_due, so it is skipped.
 *
 * Anything that would need a warn-ahead number is not emitted, and the missing
 * threshold is reported in `thresholdGaps` instead. Everything not emitted is
 * listed in `skipped` with its reason, so a caller can tell "nothing to say"
 * from "could not work out what to say".
 *
 * ── ATTRIBUTING A SHORTFALL ────────────────────────────────────────────────
 * `cashflow_reminders.subject_kind` is a card or a bill and nothing else, so a
 * shortfall — which is a fact about the whole account — is attributed to the
 * LARGEST outflow on the day it happens, which is the bill or card most
 * responsible for it. If that day has no outflow at all (the account was
 * already short before anything left it) there is nothing honest to attribute
 * it to, so no reminder is produced and the skip is recorded.
 */
/* A subject can only be RECORDED if it has a real database key.
   cashflow_reminders.subject_id is a `uuid` column (087:113). A bill's
   `sourceId` is the composite "<bankAccountId>:<merchantKey>:<cadence>" that
   identifies a STREAM across re-detection, and writing it raised Postgres 22P02
   — surfacing as a flat 400 "invalid_parameter" on the exact case this screen
   exists for, a projected balance going negative BECAUSE OF a bill — while a
   card reminder written earlier in the same request stayed behind.

   toCashflowBill() now carries the stored row's own uuid as `subjectId`. NULL
   means the subject was never stored (a hand-built bill in a test), and the
   honest answer is to SKIP with a named reason rather than fall back to
   sourceId, which is the original defect wearing a different name. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const recordableId = (c) =>
  typeof c?.subjectId === "string" && UUID_RE.test(c.subjectId) ? c.subjectId : null;

export function recordReminders({ orgId, clientId, projection, window, subject } = {}) {
  const reminders = [];
  const skipped = [];
  const gaps = new Set();

  const push = (r) => reminders.push({ orgId: orgId ?? null, clientId: clientId ?? null, ...r });
  const skip = (reminderKind, reason) => skipped.push({ reminderKind, reason });

  if (projection === null || projection === undefined) {
    throw new CashflowInputError("recordReminders: a projection is required");
  }
  if (typeof projection !== "object" || Array.isArray(projection)) {
    throw new CashflowInputError("recordReminders: projection must be a project() result");
  }

  // A projection that could not be produced at all is itself the thing to say,
  // but it has no subject to hang a row on — the reason it failed is an unknown
  // balance or no accounts, and neither is a card or a bill.
  if (projection.ok !== true) {
    skip(
      "input_missing",
      `the projection could not be produced (${projection.reason?.code ?? "unknown"}) and the reason is not about a card or a bill, so there is no subject to record it against`
    );
    return { reminders, skipped, thresholdGaps: gapsToList(gaps) };
  }

  const nowAt = atStartOfDay(projection.startDate);
  for (const g of projection.thresholdGaps ?? []) gaps.add(g.name);

  // ── 1. Blind spots. Something is owed and its size or date is unknown. ────
  for (const spot of projection.blindSpots ?? []) {
    const subjectKind = subjectKindFor(spot.kind);
    if (subjectKind === null) {
      skip("input_missing", `a blind spot of kind "${spot.kind}" has no subject_kind to record it under`);
      continue;
    }
    const spotId = recordableId(spot);
    if (spotId === null) {
      skip("input_missing", `"${spot.label}" has no stored record to attach a reminder to, so it cannot be saved`);
      continue;
    }
    push({
      subjectKind,
      subjectId: spotId,
      subjectLabel: spot.label,
      reminderKind: "input_missing",
      body: `We cannot project your cash flow around "${spot.label}" yet: ${spot.reason}. Until that is known, no payment date is being estimated for it.`,
      surfaceAt: nowAt
    });
  }

  // ── 2. A projected shortfall. ─────────────────────────────────────────────
  const shortDay = (projection.days ?? []).find((d) => d.worstCaseBelowZero);
  if (shortDay) {
    const outflows = shortDay.components.filter((c) => c.direction === "out");
    if (outflows.length === 0) {
      skip(
        "projected_shortfall",
        `the projected balance is below zero on ${shortDay.date} but nothing leaves the account that day, so there is no card or bill to attribute it to`
      );
    } else {
      const biggest = outflows.reduce((a, b) => (b.amountCents > a.amountCents ? b : a));
      const subjectKind = subjectKindFor(biggest.kind);
      if (subjectKind === null) {
        skip("projected_shortfall", `the largest outflow on ${shortDay.date} is of kind "${biggest.kind}", which has no subject_kind`);
      } else if (recordableId(biggest) === null) {
        skip("projected_shortfall", `the largest outflow on ${shortDay.date} is "${biggest.label}", which has no stored record to attach a reminder to`);
      } else {
        push({
          subjectKind,
          subjectId: recordableId(biggest),
          subjectLabel: biggest.label,
          reminderKind: "projected_shortfall",
          body: `Your projected balance falls to ${fromCents(shortDay.worstCaseClosingCents)} on ${shortDay.date}, below zero. The largest amount leaving that day is "${biggest.label}" at ${biggest.amount}. This is an estimate based on the bills and balances on file.`,
          surfaceAt: nowAt
        });
      }
    }
  }

  // ── 3. Everything below is about one card, and needs one to have been named. ──
  if (window === null || window === undefined) return { reminders, skipped, thresholdGaps: gapsToList(gaps) };

  if (!subject || !subject.subjectId || !subject.subjectLabel) {
    skip(
      "payment_due",
      "a payment window was supplied but no subject card was named, so there is nothing to record the reminder against"
    );
    return { reminders, skipped, thresholdGaps: gapsToList(gaps) };
  }
  const card = {
    subjectKind: "card_liability",
    subjectId: subject.subjectId,
    subjectLabel: subject.subjectLabel
  };
  for (const g of window.thresholdGaps ?? []) gaps.add(g.name);

  // The statement closing is an event with its own date, so it needs no rule.
  // Only worth saying if it has not already happened.
  if (subject.statementClose) {
    const closeDay = toDayNumber(subject.statementClose, "subject.statementClose");
    const startDay = toDayNumber(projection.startDate, "projection.startDate");
    if (closeDay >= startDay) {
      push({
        ...card,
        reminderKind: "statement_closed",
        body: `The statement for "${subject.subjectLabel}" closes on ${fromDayNumber(closeDay)}. The balance is fixed from that date and a payment made before it may not settle it.`,
        surfaceAt: atStartOfDay(fromDayNumber(closeDay))
      });
    }
  }

  if (window.ok !== true) {
    // A refused window is the most important thing this function can say. It is
    // the difference between "no reminder" and "we could not work out a safe
    // date and you need to know that".
    push({
      ...card,
      reminderKind: "input_missing",
      body: `We cannot estimate a safe payment date for "${subject.subjectLabel}": ${window.reason?.message ?? "the inputs were incomplete."}`,
      surfaceAt: nowAt
    });
    return { reminders, skipped, thresholdGaps: gapsToList(gaps) };
  }

  /* WHERE THE PAYMENT REMINDER SURFACES, AND WHY IT MOVES.
     With a settlement lead time known, `initiateByDate` is the day somebody has
     to actually press the button for the money to land on the recommended date.
     That is the day worth telling them about — a reminder that arrives on the
     landing date is a reminder that arrives too late to act on. With no lead
     time known, paymentWindow() refuses to give an initiate-by date at all
     rather than assume same-day posting, so the reminder falls back to the
     landing date and the body says plainly that it is a landing date. Both
     dates are derived by the model; neither is picked here. */
  const startBy = window.initiateByDate;
  push({
    ...card,
    reminderKind: "payment_due",
    body: startBy
      ? `Start the payment of ${window.amount} on "${subject.subjectLabel}" by ${startBy} so it lands by the estimated best date of ${window.recommendedDate}. Based on the projected balance, that should not take the account below ${fromCents(window.floorCents)}.`
      : `Estimated best date for a payment of ${window.amount} on "${subject.subjectLabel}" to LAND is ${window.recommendedDate}. How long your payment takes to arrive is not recorded in this system, so start it early enough to be sure. Based on the projected balance, landing on or before that date should not take the account below ${fromCents(window.floorCents)}.`,
    surfaceAt: atStartOfDay(startBy ?? window.recommendedDate)
  });

  /* *** payment_window_closing CANNOT FIRE, AND THAT IS A PROPERTY OF THE
     MATHS RATHER THAN A GAP IN THIS FUNCTION. ***

     Feasibility is monotone in the payment date. suffixMin[] is the lowest
     balance from a day to the end of the horizon, so it is non-decreasing as
     the day moves later — a later day minimises over a strictly smaller set.
     A payment is a one-off outflow with no other effect, so if paying on day D
     clears the floor, paying on any day after D clears it by at least as much.
     PAYING LATER IS NEVER WORSE.

     Therefore the safe window ALWAYS ends on the due date, and there is no
     "last safe day" earlier than the due date to warn anybody about. The only
     genuinely interesting bound is the EARLIEST safe date, which is what
     `earliestDate` carries.

     The kind stays in 087's CHECK constraint because a caller with a
     constraint this module does not model — a promotional rate expiring, a
     transfer that must clear first — could legitimately have one. Nothing
     emits it today, and the skip below says so at runtime rather than leaving
     a future reader to wonder whether it was forgotten. */
  skip(
    "payment_window_closing",
    "paying later is never worse than paying earlier, so the safe window always ends on the due date and there is no earlier last-safe-day to warn about"
  );

  return { reminders, skipped, thresholdGaps: gapsToList(gaps) };
}
