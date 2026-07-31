// Card liabilities — normalizing a card's terms, and reading them back.
//
// Two halves in one file because the pure half is small: `normalizeLiability`
// turns whatever an aggregator returned into the shape 083 stores, and the
// read functions go to the database. The pure half is exported separately so it
// can be tested without Postgres, which is where every rule below is proven.
//
// APR IS REUSED, NOT REIMPLEMENTED. `readApr` comes from
// src/tradelines/index.mjs. It already encodes the decision this module would
// otherwise have to make again — a value above 1 is a percentage, at or below 1
// is already a fraction, anything over 100% after conversion is refused rather
// than clamped — and two functions answering "what is this APR" differently is
// a bug that surfaces as a client being quoted the wrong interest.
//
//
// THE RULES, ALL OF THEM REFUSALS:
//
//   1. A MISSING DUE DATE IS NULL. Not today, not the 15th, not "end of month".
//      This is the one that would do real damage: the output feeds a screen that
//      tells someone when to move their money.
//   2. A MISSING AMOUNT IS NULL, NOT ZERO. A minimum payment of 0 means "you owe
//      nothing this month". Unknown means we do not know what you owe. A screen
//      that renders the second as the first has told a client to skip a payment.
//   3. is_overdue IS THREE-STATE. false and unknown are different, and only one
//      of them is a reassurance.
//   4. AN UNPARSEABLE DATE IS NULL. Never a partially-parsed one. `new Date()`
//      accepts a startling amount of nonsense and yields a real-looking date
//      from it; everything here goes through a strict reader instead.

import { readApr } from "../tradelines/index.mjs";

export class LiabilityError extends Error {
  constructor(message, { status = 400 } = {}) {
    super(message);
    this.name = "LiabilityError";
    this.status = status;
  }
}

/* Money to integer cents, or null. A negative amount is real here — a card can
   carry a credit balance — so unlike tradelines' toCents this does not refuse
   negatives. It refuses only what it cannot read. */
export function toCents(value) {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/* readDate — an ISO date (YYYY-MM-DD), or null.
 *
 * STRICT ON PURPOSE. `new Date("next tuesday")` is Invalid Date, but
 * `new Date("2026")` is 1 January 2026 and `new Date("07/31")` is a date in
 * 2001. A due-date field that quietly accepts those produces a confident wrong
 * answer on the one screen where a wrong date costs money. So: an explicit
 * pattern, a real calendar check, and null for everything else.
 */
export function readDate(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(s);
  if (!m) return null;

  const [, y, mo, d] = m.map(Number);
  // Reject 2026-02-30 and friends: the round-trip catches a rolled-over date.
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/* Three-state boolean. Absent stays absent; only a real boolean (or the exact
   strings a JSON payload uses for one) becomes true or false. */
export function readBool(value) {
  if (value === true || value === false) return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

/* The field names actually seen across aggregator payloads, most specific
   first — kept as data rather than a chain of `??` so adding a vendor is a list
   edit and the precedence stays visible. Same treatment as
   src/tradelines/index.mjs. */
const KEYS = {
  statementBalance: ["last_statement_balance", "lastStatementBalance", "statement_balance"],
  statementDate: ["last_statement_issue_date", "lastStatementIssueDate", "statement_date"],
  minimumPayment: ["minimum_payment_amount", "minimumPaymentAmount", "minimum_payment", "min_payment"],
  dueDate: ["next_payment_due_date", "nextPaymentDueDate", "due_date", "payment_due_date"],
  lastPaymentAmount: ["last_payment_amount", "lastPaymentAmount"],
  lastPaymentDate: ["last_payment_date", "lastPaymentDate"],
  overdue: ["is_overdue", "isOverdue", "overdue"],
  aprs: ["aprs", "apr_list", "aprList"]
};

function pick(record, keys) {
  for (const k of keys) {
    const v = record?.[k];
    if (v != null && v !== "") return v;
  }
  return null;
}

/* One APR entry. `type` is the vendor's string (purchase_apr, cash_apr,
   balance_transfer_apr) and is kept as-is: it is a label, not a decision, and
   normalizing it would only invent a vocabulary. An entry whose rate cannot be
   read is DROPPED rather than kept with a null rate — a breakdown row that
   cannot say its own rate is not a breakdown of anything. */
function normalizeApr(entry) {
  const apr = readApr(entry?.apr_percentage ?? entry?.aprPercentage ?? entry?.apr ?? entry?.rate);
  if (apr == null) return null;
  return {
    type: entry?.apr_type ?? entry?.aprType ?? entry?.type ?? null,
    apr,
    balanceSubjectToAprCents: toCents(entry?.balance_subject_to_apr ?? entry?.balanceSubjectToApr),
    interestChargeAmountCents: toCents(entry?.interest_charge_amount ?? entry?.interestChargeAmount)
  };
}

/**
 * normalizeLiability — an aggregator payload to the shape 083 stores.
 *
 * Pure. Returns nulls generously and guesses never. `asOf` is passed in rather
 * than read from a clock, so the output is reproducible and a test does not
 * depend on when it runs.
 *
 * The headline `apr` is taken from the purchase APR when the breakdown names
 * one, because that is the rate that applies to a card being used normally. It
 * falls back to an explicit top-level apr, and to null — never to the first
 * entry in the list, which on many cards is the cash-advance rate and is the
 * highest number on the card.
 */
export function normalizeLiability(payload = {}, { asOf = null } = {}) {
  const aprs = (Array.isArray(pick(payload, KEYS.aprs)) ? pick(payload, KEYS.aprs) : [])
    .map(normalizeApr)
    .filter(Boolean);

  const purchase = aprs.find((a) => /purchase/i.test(a.type ?? ""));
  const headline = purchase?.apr ?? readApr(payload?.apr) ?? null;

  return {
    lastStatementBalanceCents: toCents(pick(payload, KEYS.statementBalance)),
    lastStatementIssueDate: readDate(pick(payload, KEYS.statementDate)),
    minimumPaymentCents: toCents(pick(payload, KEYS.minimumPayment)),
    nextPaymentDueDate: readDate(pick(payload, KEYS.dueDate)),
    lastPaymentAmountCents: toCents(pick(payload, KEYS.lastPaymentAmount)),
    lastPaymentDate: readDate(pick(payload, KEYS.lastPaymentDate)),
    isOverdue: readBool(pick(payload, KEYS.overdue)),
    apr: headline,
    aprs,
    asOf
  };
}

const SELECT_COLUMNS = `
  l.id, l.org_id, l.client_id, l.bank_account_id,
  l.last_statement_balance_cents, l.last_statement_issue_date,
  l.minimum_payment_cents, l.next_payment_due_date,
  l.last_payment_amount_cents, l.last_payment_date,
  l.is_overdue, l.apr, l.aprs, l.as_of`;

/**
 * getCurrentLiability — the terms on one account right now, or null.
 *
 * null means no liability record, which is the normal state for a checking
 * account and for a card nobody has synced. It is NOT an error and must not be
 * rendered as "nothing due".
 */
export async function getCurrentLiability(db, { bankAccountId } = {}) {
  if (!bankAccountId) throw new LiabilityError("bankAccountId is required");

  const res = await db.query(
    `SELECT ${SELECT_COLUMNS} FROM card_liabilities l WHERE l.bank_account_id = $1`,
    [bankAccountId]
  );
  return res.rows[0] ?? null;
}

/**
 * listCurrentLiabilities — every card's terms for one client, soonest due first.
 *
 * NULLS LAST is not cosmetic. An unknown due date sorted first would appear at
 * the top of a "what is due next" list and be read as the most urgent item on
 * the screen, which is the exact inversion of what it means.
 */
export async function listCurrentLiabilities(db, { clientId } = {}) {
  if (!clientId) throw new LiabilityError("clientId is required");

  const res = await db.query(
    `SELECT ${SELECT_COLUMNS},
            a.name AS account_name, a.mask, a.entity_kind, a.entity_kind_source
       FROM card_liabilities l
       JOIN bank_accounts a ON a.id = l.bank_account_id
      WHERE l.client_id = $1 AND a.status = 'open'
      ORDER BY l.next_payment_due_date ASC NULLS LAST, a.name ASC`,
    [clientId]
  );
  return res.rows;
}

/**
 * getLiabilityHistory — every snapshot for one account, newest first.
 *
 * Bounded: an unbounded history read on a shared endpoint is how a summary
 * becomes a firehose. The bound is applied to the parameter rather than trusted
 * from the caller, for the same reason listPulls does it.
 */
export async function getLiabilityHistory(db, { bankAccountId, limit = 50 } = {}) {
  if (!bankAccountId) throw new LiabilityError("bankAccountId is required");

  const n = Number(limit);
  const bounded = Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 1), 200) : 50;

  const res = await db.query(
    `SELECT id, bank_account_id, last_statement_balance_cents, last_statement_issue_date,
            minimum_payment_cents, next_payment_due_date, last_payment_amount_cents,
            last_payment_date, is_overdue, apr, aprs, as_of
       FROM card_liability_history
      WHERE bank_account_id = $1
      ORDER BY as_of DESC, id DESC
      LIMIT $2`,
    [bankAccountId, bounded]
  );
  return res.rows;
}
