// Cash-flow projection and payment timing. Pure: no database, no clock, no I/O.
//
// `today` is always passed in. This module never reads the system clock, so its
// output is reproducible, a test does not depend on the day it runs, and a
// caller cannot accidentally project from the server's timezone instead of the
// client's.
//
//
// *** paymentWindow() IS ADVICE ABOUT SOMEBODY'S MONEY. ***
//
// It answers "when should I pay this so I do not overdraw". That answer moves
// real money on a real date, and the single most important property of this
// module is therefore what it does when it CANNOT answer:
//
//   IT RETURNS null AND A REASON. It never returns a date it did not compute.
//
// There is no fallback to the due date, no "the 15th", no rounding a missing
// window into a plausible-looking day. Every null path below names itself, and
// the caller is expected to show that name to the user. "We cannot tell you when
// to pay this, because we do not have your account balance" is a useful sentence.
// A date invented to fill the gap is not — it is a wrong instruction about
// money, delivered with the same confidence as a right one.
//
// The reason codes are a closed set (WINDOW_REASONS) so a screen can render them
// deliberately rather than string-matching prose.

/* Why no window could be produced. Every one of these is a normal, expected
   state of a system whose inputs are chronically incomplete. */
export const WINDOW_REASONS = Object.freeze({
  NO_DUE_DATE: "no_due_date",
  NO_BALANCE: "no_balance",
  STALE_BALANCE: "stale_balance",
  NO_AMOUNT: "no_amount",
  DUE_DATE_PASSED: "due_date_passed",
  INSUFFICIENT_FUNDS: "insufficient_funds"
});

/* Human wording for each code, in one place so two screens cannot word the same
   refusal differently. Deliberately plain: these are read by the person whose
   money it is. */
export const WINDOW_REASON_TEXT = Object.freeze({
  [WINDOW_REASONS.NO_DUE_DATE]: "No due date on file for this account, so we cannot say when to pay it.",
  [WINDOW_REASONS.NO_BALANCE]: "No account balance on file, so we cannot check whether a payment would overdraw you.",
  [WINDOW_REASONS.STALE_BALANCE]: "The balance we have is too old to plan a payment against.",
  [WINDOW_REASONS.NO_AMOUNT]: "No payment amount on file for this account.",
  [WINDOW_REASONS.DUE_DATE_PASSED]: "This payment was due before the date we are planning from.",
  [WINDOW_REASONS.INSUFFICIENT_FUNDS]: "The projected balance does not cover this payment before it is due."
});

/* How old a balance may be before it is not worth planning against. Seven days
   is a judgement, not a fact, and it is named here rather than buried so it can
   be argued with — and passed in by a caller that knows better. */
export const DEFAULT_MAX_BALANCE_AGE_DAYS = 7;

/* What to leave in the account after paying. Zero by default, because a buffer
   this module invented would be silently spending somebody's money on their
   behalf. A caller with a real policy passes one. */
export const DEFAULT_SAFETY_BUFFER_CENTS = 0;

const MS_PER_DAY = 86400000;

/* Strict date reading, same rule as src/banking/liabilities.mjs: `new Date()`
   turns "2026" into 1 January and "07/31" into a date in 2001, and a due-date
   field that accepts those produces a confident wrong answer. */
export function dayNumber(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : Math.floor(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()) / MS_PER_DAY);
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value).trim());
  if (!m) return null;
  const [, y, mo, d] = m.map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return Math.floor(dt.getTime() / MS_PER_DAY);
}

export function isoDate(day) {
  return day == null ? null : new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

function cents(v) {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isFinite(n) ? Math.round(n) : null;
}

/**
 * project — the running balance forward, day by day.
 *
 * @param {object} opts
 * @param {number} opts.openingBalanceCents  required; null yields an empty projection, not a zero one
 * @param {string} opts.from                 required ISO date — the day the opening balance was true
 * @param {number} opts.horizonDays          default 30
 * @param {Array}  opts.outflows             [{ date, amountCents (positive), label?, confidence? }]
 * @param {Array}  opts.inflows              [{ date, amountCents (positive), label? }]
 *
 * @returns {{ days: Array, lowest: object|null, endingBalanceCents: number|null, reason: string|null }}
 *
 * A NULL OPENING BALANCE PRODUCES AN EMPTY PROJECTION WITH A REASON, NOT A
 * PROJECTION FROM ZERO. Starting from zero would draw a chart showing somebody
 * overdrawn on day one, which is a statement about their finances that nobody
 * made.
 *
 * Inflows are OPTIONAL AND UNTRUSTED BY DEFAULT — the caller supplies them, this
 * module never predicts income. Money arriving is exactly the assumption that
 * turns "you can afford this" into a wrong answer, so it must come from
 * somewhere that knows.
 */
export function project({
  openingBalanceCents,
  from,
  horizonDays = 30,
  outflows = [],
  inflows = []
} = {}) {
  const start = dayNumber(from);
  const opening = cents(openingBalanceCents);
  const horizon = Math.max(1, Math.trunc(Number(horizonDays)) || 30);

  const empty = (reason) => ({ days: [], lowest: null, endingBalanceCents: null, reason });
  if (start == null) return empty("no_start_date");
  if (opening == null) return empty(WINDOW_REASONS.NO_BALANCE);

  // Bucket the movements by day. Outflows are given positive (an obligation, per
  // 086) and subtract here; the sign flip happens once, in this line, and is the
  // only place in this module where it happens.
  const byDay = new Map();
  const add = (list, sign) => {
    for (const m of Array.isArray(list) ? list : []) {
      const d = dayNumber(m?.date);
      const amt = cents(m?.amountCents ?? m?.amount_cents);
      if (d == null || amt == null) continue;          // unreadable movements are dropped, never guessed
      if (d < start || d > start + horizon) continue;
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d).push({ ...m, signedCents: sign * Math.abs(amt) });
    }
  };
  add(outflows, -1);
  add(inflows, 1);

  const days = [];
  let balance = opening;
  let lowest = null;

  for (let i = 0; i <= horizon; i++) {
    const day = start + i;
    const movements = byDay.get(day) ?? [];
    for (const m of movements) balance += m.signedCents;

    const entry = { date: isoDate(day), balanceCents: balance, movements };
    days.push(entry);
    if (lowest == null || balance < lowest.balanceCents) lowest = entry;
  }

  return { days, lowest, endingBalanceCents: balance, reason: null };
}

/**
 * paymentWindow — when this payment can be made without overdrawing.
 *
 * @param {object} opts
 * @param {string} opts.today                required ISO date — this module has no clock
 * @param {string} opts.dueDate              the payment's due date; null is a normal input
 * @param {number} opts.amountCents          what is being paid (positive)
 * @param {number} opts.balanceCents         the account balance
 * @param {string} opts.balanceAsOf          when that balance was true
 * @param {Array}  opts.outflows             other known obligations in the window
 * @param {Array}  opts.inflows              known incoming money; NEVER predicted here
 * @param {number} opts.safetyBufferCents    default 0 — see the constant
 * @param {number} opts.maxBalanceAgeDays    default 7
 *
 * @returns {object} always of the shape
 *   { window: { earliest, latest, recommended } | null, reason, reasonText, evidence }
 *
 * `window` is null whenever the answer is not known. `reason` is one of
 * WINDOW_REASONS and is NEVER null when window is null.
 */
export function paymentWindow({
  today,
  dueDate,
  amountCents,
  balanceCents,
  balanceAsOf,
  outflows = [],
  inflows = [],
  safetyBufferCents = DEFAULT_SAFETY_BUFFER_CENTS,
  maxBalanceAgeDays = DEFAULT_MAX_BALANCE_AGE_DAYS
} = {}) {
  const refuse = (reason, evidence = {}) => ({
    window: null,
    reason,
    reasonText: WINDOW_REASON_TEXT[reason],
    evidence
  });

  const todayDay = dayNumber(today);
  const dueDay = dayNumber(dueDate);
  const amount = cents(amountCents);
  const balance = cents(balanceCents);
  const asOfDay = dayNumber(balanceAsOf);
  const buffer = cents(safetyBufferCents) ?? 0;
  const maxAge = Math.max(0, Math.trunc(Number(maxBalanceAgeDays)) || 0);

  // A caller with no `today` has not told us what "now" means, and this module
  // will not decide that for them.
  if (todayDay == null) return refuse(WINDOW_REASONS.NO_DUE_DATE, { missing: "today" });

  // Each refusal below is a real, common state — see 083 and 086.
  if (dueDay == null) return refuse(WINDOW_REASONS.NO_DUE_DATE);
  if (amount == null || amount <= 0) return refuse(WINDOW_REASONS.NO_AMOUNT);
  if (balance == null) return refuse(WINDOW_REASONS.NO_BALANCE);

  // A balance with no timestamp cannot be aged, and an unaged balance is exactly
  // the stale number this whole design is trying to keep off the screen. 081
  // makes storing one impossible; this handles a caller that lost it anyway.
  if (asOfDay == null) return refuse(WINDOW_REASONS.STALE_BALANCE, { balanceAsOf: null });
  const ageDays = todayDay - asOfDay;
  if (ageDays > maxAge) {
    return refuse(WINDOW_REASONS.STALE_BALANCE, { ageDays, maxBalanceAgeDays: maxAge, balanceAsOf: isoDate(asOfDay) });
  }

  if (dueDay < todayDay) {
    return refuse(WINDOW_REASONS.DUE_DATE_PASSED, { dueDate: isoDate(dueDay), today: isoDate(todayDay) });
  }

  // Project from today to the due date, with the other known obligations but
  // WITHOUT this payment. Then ask, for each candidate day, whether making the
  // payment that day leaves the balance above the buffer for the rest of the
  // window.
  const horizon = dueDay - todayDay;
  const base = project({
    openingBalanceCents: balance,
    from: isoDate(todayDay),
    horizonDays: horizon,
    outflows,
    inflows
  });

  const safeDays = [];
  for (let i = 0; i <= horizon; i++) {
    const payDay = todayDay + i;
    // Paying on payDay removes `amount` from every day at or after it. A day is
    // safe only if EVERY subsequent day in the window still clears the buffer —
    // a payment that is affordable today and overdraws you on Thursday is not
    // affordable.
    let safe = true;
    for (let j = i; j <= horizon; j++) {
      if (base.days[j].balanceCents - amount < buffer) { safe = false; break; }
    }
    if (safe) safeDays.push(payDay);
  }

  if (!safeDays.length) {
    return refuse(WINDOW_REASONS.INSUFFICIENT_FUNDS, {
      amountCents: amount,
      lowestProjectedCents: base.lowest?.balanceCents ?? null,
      lowestOn: base.lowest?.date ?? null,
      safetyBufferCents: buffer
    });
  }

  // RECOMMEND THE EARLIEST SAFE DAY. Two candidates were possible and this one
  // is chosen deliberately: the latest safe day holds cash longer, which is the
  // textbook answer, but it also means a single missed reminder is a late
  // payment. The earliest safe day trades a few days of float for the failure
  // mode being "you paid early" instead of "you paid late". A caller that wants
  // the float has `latest` and can take it.
  return {
    window: {
      earliest: isoDate(safeDays[0]),
      latest: isoDate(safeDays.at(-1)),
      recommended: isoDate(safeDays[0])
    },
    reason: null,
    reasonText: null,
    evidence: {
      amountCents: amount,
      openingBalanceCents: balance,
      balanceAsOf: isoDate(asOfDay),
      balanceAgeDays: ageDays,
      dueDate: isoDate(dueDay),
      safetyBufferCents: buffer,
      safeDayCount: safeDays.length,
      lowestProjectedCents: base.lowest?.balanceCents ?? null
    }
  };
}

/* How many days before a due date to surface a reminder, by basis. An inferred
   date deserves more warning than a reported one, because it is more likely to
   be wrong and the person may need time to check it. */
const LEAD_DAYS = { reported: 5, inferred: 7 };

/**
 * buildReminders — turn bills and card liabilities into reminder rows.
 *
 * PURE. Returns the rows; writing them is recordReminders' job. Split so the
 * decision logic is testable without a database, which is where every rule below
 * is proven.
 *
 * A subject with no usable due date produces NO reminder. It does not produce a
 * reminder dated today, and it does not produce one dated "soon".
 */
export function buildReminders({ today, bills = [], liabilities = [], leadDays = LEAD_DAYS } = {}) {
  const todayDay = dayNumber(today);
  if (todayDay == null) return { reminders: [], skipped: [{ reason: "no_today" }] };

  const reminders = [];
  const skipped = [];

  const push = ({ kind, subjectType, subjectId, basis, confidence, dueDate, amountCents, label, evidence }) => {
    const dueDay = dayNumber(dueDate);
    if (dueDay == null) {
      skipped.push({ subjectId, label, reason: WINDOW_REASONS.NO_DUE_DATE });
      return;
    }
    if (dueDay < todayDay) {
      skipped.push({ subjectId, label, reason: WINDOW_REASONS.DUE_DATE_PASSED });
      return;
    }
    const lead = leadDays[basis] ?? 5;
    // Clamped to today: 087 CHECKs remind_on <= due_date, and a reminder dated
    // in the past would fire immediately or never depending on the reader.
    const remindDay = Math.max(todayDay, dueDay - lead);

    reminders.push({
      kind,
      subjectType,
      subjectId,
      basis,
      // 087 CHECKs this pairing: inferred must carry a confidence, reported must
      // not. Enforced here too so a caller gets a testable object rather than a
      // constraint violation.
      confidence: basis === "inferred" ? confidence ?? 0 : null,
      dueDate: isoDate(dueDay),
      remindOn: isoDate(remindDay),
      amountCents: amountCents ?? null,
      // Stable across recomputes for the same obligation, so a nightly rebuild
      // updates one row instead of adding one.
      dedupeKey: `${kind}:${subjectId}:${isoDate(dueDay)}`,
      evidence: evidence ?? {}
    });
  };

  for (const l of Array.isArray(liabilities) ? liabilities : []) {
    push({
      kind: "card_payment",
      subjectType: "card_liability",
      subjectId: l?.id ?? l?.bank_account_id ?? null,
      basis: "reported",
      confidence: null,
      dueDate: l?.nextPaymentDueDate ?? l?.next_payment_due_date,
      amountCents: cents(l?.minimumPaymentCents ?? l?.minimum_payment_cents),
      label: l?.accountName ?? l?.account_name ?? null,
      evidence: { source: "card_liabilities" }
    });
  }

  for (const b of Array.isArray(bills) ? bills : []) {
    push({
      kind: "bill_due",
      subjectType: "recurring_bill",
      subjectId: b?.id ?? null,
      basis: "inferred",
      confidence: b?.confidence ?? 0,
      dueDate: b?.nextExpectedDate ?? b?.next_expected_date,
      amountCents: cents(b?.amountCents ?? b?.amount_cents),
      label: b?.merchantName ?? b?.merchant_name ?? null,
      evidence: { source: "recurring_bills", cadence: b?.cadence ?? null, occurrenceCount: b?.occurrenceCount ?? b?.occurrence_count ?? null }
    });
  }

  reminders.sort((a, b) => a.remindOn.localeCompare(b.remindOn) || a.dueDate.localeCompare(b.dueDate));
  return { reminders, skipped };
}

/**
 * recordReminders — persist what buildReminders produced.
 *
 * The one impure function here, and it is deliberately thin: it writes rows and
 * makes no decisions. ON CONFLICT against 087's live-dedupe index, so a nightly
 * recompute updates rather than duplicating.
 *
 * NOTHING IS SENT. This writes rows. sent_at stays NULL, because nothing in this
 * repository transmits.
 */
export async function recordReminders(db, { orgId, clientId, reminders = [] } = {}) {
  if (!orgId) throw new TypeError("recordReminders: orgId is required");
  if (!clientId) throw new TypeError("recordReminders: clientId is required");
  if (!reminders.length) return [];

  const out = [];
  for (const r of reminders) {
    const res = await db.query(
      `INSERT INTO reminders
         (org_id, client_id, kind, subject_type, subject_id, basis, confidence,
          due_date, remind_on, amount_cents, evidence, dedupe_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (client_id, kind, dedupe_key)
         WHERE dedupe_key IS NOT NULL AND status IN ('pending','surfaced')
       DO UPDATE SET
         due_date     = EXCLUDED.due_date,
         remind_on    = EXCLUDED.remind_on,
         amount_cents = EXCLUDED.amount_cents,
         confidence   = EXCLUDED.confidence,
         evidence     = EXCLUDED.evidence,
         updated_at   = now()
       RETURNING *`,
      [
        orgId, clientId, r.kind, r.subjectType, r.subjectId, r.basis, r.confidence,
        r.dueDate, r.remindOn, r.amountCents, JSON.stringify(r.evidence ?? {}), r.dedupeKey
      ]
    );
    if (res.rows[0]) out.push(res.rows[0]);
  }
  return out;
}
