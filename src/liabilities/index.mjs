// Card liabilities — reading a BILLING POSITION out of a bureau payload.
//
// WHAT THIS IS NOT. It is not a second copy of `src/tradelines/index.mjs`. That
// module reads the CREDIT FACILITY off a pull — lender, kind, limit, balance,
// APR — and hands it to the funding waterfall. This module reads the position on
// that facility: what the statement closed at, what the minimum payment is, when
// it is due, what is past due, what was last paid. Migrations 083/084 hold the
// storage; 083's header carries the full "how this differs from tradelines"
// argument and is the place to read it.
//
// REUSE, NOT REIMPLEMENTATION. `toCents()` and `readApr()` are imported from
// `../tradelines/index.mjs` and re-exported, not rewritten. `readApr()` already
// solves the one genuinely hard problem in a bureau payload — the same field
// name carries APR as a percentage number (18.99) and as a fraction (0.1899),
// across vendors — and it refuses anything it cannot read rather than clamping
// it, because a clamped rate is a wrong number wearing a plausible face. Two
// readers of one payload is the defect class this repo keeps finding, so there
// is exactly one, and it lives next door.
//
// NULL IS UNKNOWN AND MUST SURVIVE. This is the rule that matters most here. A
// bureau file that omits the minimum payment has an unknown minimum, not a zero
// one. A zero minimum payment displayed to a client says "nothing is due this
// month". Every reader below returns null on absence and nothing downstream
// coalesces it away.
//
// Pure and I/O-free. Database access is next door in store.mjs so this half
// stays testable without Postgres.

import { toCents, fromCents, readApr, extractTradelineRecords } from "../tradelines/index.mjs";

export { toCents, fromCents, readApr };

// The container lookup is the tradeline normalizer's — same payload, same list,
// so this module does not grow a second copy of TRADELINE_CONTAINERS. Exposed as
// an override on normalizeLiabilitiesFromCrs for a caller with a different
// envelope.
const defaultExtract = extractTradelineRecords;

/* The field names actually seen across the payloads this repo handles, most
   specific first. Kept as data rather than a chain of `??` so that adding a
   vendor is a list edit and the precedence stays visible — same treatment as
   the tradeline normalizer. */
const STATEMENT_BALANCE_KEYS = [
  "statement_balance", "statementBalance", "last_statement_balance",
  "lastStatementBalance", "closing_balance", "closingBalance"
];
const CURRENT_BALANCE_KEYS = [
  "current_balance", "currentBalance", "balance", "balance_amount", "balanceAmount"
];
const MINIMUM_PAYMENT_KEYS = [
  "minimum_payment", "minimumPayment", "min_payment", "minPayment",
  "minimum_payment_due", "minimumPaymentDue", "scheduled_payment", "scheduledPayment"
];
const PAST_DUE_KEYS = ["past_due", "pastDue", "past_due_amount", "pastDueAmount", "amount_past_due"];
const LAST_PAYMENT_AMOUNT_KEYS = [
  "last_payment_amount", "lastPaymentAmount", "last_payment", "lastPayment"
];
const LAST_PAYMENT_DATE_KEYS = ["last_payment_date", "lastPaymentDate", "date_last_payment"];
const STATEMENT_DATE_KEYS = [
  "statement_date", "statementDate", "closing_date", "closingDate", "statement_close_date"
];
const DUE_DATE_KEYS = ["payment_due_date", "paymentDueDate", "due_date", "dueDate"];
const APR_KEYS = ["apr", "interest_rate", "interestRate", "rate"];
const STATUS_KEYS = ["payment_status", "paymentStatus", "account_status", "accountStatus", "status"];
const REF_KEYS = ["account_ref", "account_number", "accountNumber", "account_id", "id"];

function pick(record, keys) {
  for (const k of keys) {
    const v = record?.[k];
    if (v != null && v !== "") return v;
  }
  return null;
}

/* readDate — an ISO calendar date (YYYY-MM-DD), or null.
 *
 * The columns in 083/084 are `date`, not `timestamptz`, deliberately: a
 * statement closes on a day, not at an instant, and giving it a time zone
 * invents a precision the bureau never reported. So this normalizes to the day
 * and refuses anything it cannot parse — an unparseable date is unknown, and an
 * unknown due date must not become "today". */
export function readDate(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  if (!s) return null;
  // Already an ISO date or ISO timestamp: take the day, no timezone shifting.
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) {
    const d = new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : `${iso[1]}-${iso[2]}-${iso[3]}`;
  }
  // MM/DD/YYYY — the other form bureau files use. Parsed explicitly rather than
  // handed to Date(), whose behaviour on ambiguous strings differs by runtime.
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (us) {
    const [, m, d, y] = us;
    const mm = String(m).padStart(2, "0");
    const dd = String(d).padStart(2, "0");
    const parsed = new Date(`${y}-${mm}-${dd}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return null;
    // Round-trip check: 02/31/2025 parses to March 3 in a lenient reader. A date
    // that does not survive the round trip was never a real date.
    if (parsed.toISOString().slice(0, 10) !== `${y}-${mm}-${dd}`) return null;
    return `${y}-${mm}-${dd}`;
  }
  return null;
}

/* readPaymentStatus — a bureau's payment standing → one of the seven values the
 * CHECK constraint in 083 allows, or null.
 *
 * UNRECOGNISED READS AS NULL, NOT AS 'current'. This is the opposite default
 * from `readKind()` next door, and on purpose: readKind guesses 'revolving'
 * because the worst case is a card the closer can see and delete, whereas
 * guessing 'current' on a delinquent account tells staff an account is in good
 * standing when it is in collections. Unknown standing is a fact worth
 * reporting; a fabricated good standing is not. */
export function readPaymentStatus(value) {
  if (value == null || value === "") return null;
  const s = String(value).toLowerCase();
  if (/charge[\s_-]?off|charged[\s_-]?off/.test(s)) return "charge_off";
  if (/collection/.test(s)) return "collection";
  if (/120/.test(s)) return "late_120";
  if (/90/.test(s)) return "late_90";
  if (/60/.test(s)) return "late_60";
  if (/30/.test(s)) return "late_30";
  if (/current|pays as agreed|paid as agreed|\bok\b/.test(s)) return "current";
  return null;
}

/**
 * normalizeLiability — one raw bureau record → one row shaped for
 * `card_liabilities` / `card_liability_history`.
 *
 * `asOf` is OUR OBSERVATION DATE and is required. It is not a fact read out of
 * the payload; it is the date on which we looked, which we always know. The
 * bureau's own statement close date is a separate, nullable column. Conflating
 * them is what makes a stale backfill look current — see 083's ordering note.
 *
 * Returns null when the record carries NO liability measure at all. That is not
 * fussiness: a record with a lender and nothing else is a tradeline, and writing
 * it here would create a position row where every number is unknown, which
 * renders on a screen as a card with no balance and no minimum. Absence of data
 * must look like absence, not like a zeroed-out bill.
 */
export function normalizeLiability(record, { asOf, source = "crs", sourceRef = null } = {}) {
  if (!record || typeof record !== "object") return null;
  const observedOn = readDate(asOf);
  if (!observedOn) return null; // undateable observation — see 084's header

  const row = {
    as_of: observedOn,
    statement_balance_cents: toCents(pick(record, STATEMENT_BALANCE_KEYS)),
    current_balance_cents: toCents(pick(record, CURRENT_BALANCE_KEYS)),
    minimum_payment_cents: toCents(pick(record, MINIMUM_PAYMENT_KEYS)),
    past_due_cents: toCents(pick(record, PAST_DUE_KEYS)),
    last_payment_cents: toCents(pick(record, LAST_PAYMENT_AMOUNT_KEYS)),
    last_payment_date: readDate(pick(record, LAST_PAYMENT_DATE_KEYS)),
    statement_date: readDate(pick(record, STATEMENT_DATE_KEYS)),
    payment_due_date: readDate(pick(record, DUE_DATE_KEYS)),
    apr: readApr(pick(record, APR_KEYS)),
    payment_status: readPaymentStatus(pick(record, STATUS_KEYS)),
    source,
    source_ref: sourceRef,
    raw: record
  };

  const MEASURES = [
    "statement_balance_cents", "current_balance_cents", "minimum_payment_cents",
    "past_due_cents", "last_payment_cents", "last_payment_date",
    "statement_date", "payment_due_date", "payment_status"
  ];
  if (MEASURES.every((k) => row[k] == null)) return null;

  return row;
}

/**
 * accountRefOf — the bureau account identifier on a raw record, or null.
 * Used by the store to find the `tradelines` row this position belongs to. Kept
 * here rather than in store.mjs so the key list stays beside the other key
 * lists, and matches `REF_KEYS` in the tradeline normalizer exactly — the two
 * must agree or a position will never find its card.
 */
export function accountRefOf(record) {
  const v = pick(record, REF_KEYS);
  return v == null ? null : String(v);
}

/**
 * normalizeLiabilitiesFromCrs — a whole `crs_results` row → the positions to
 * store, each tagged with the account_ref that identifies its card.
 *
 * The observation date is the pull's `created_at`. That is not an invented fact:
 * it is literally when the data was read. Records with no account_ref are
 * dropped, because a position that cannot be attached to a card cannot be shown
 * against one, and attaching it by lender name would merge two Amex cards into
 * one — the same reasoning `src/tradelines/store.mjs` gives for refusing to
 * match unreferenced lines.
 */
export function normalizeLiabilitiesFromCrs(crsRow, { extract } = {}) {
  const records = (extract ?? defaultExtract)(crsRow?.result);
  const asOf = crsRow?.created_at ?? null;
  const out = [];
  for (const r of records) {
    const accountRef = accountRefOf(r);
    if (!accountRef) continue;
    const row = normalizeLiability(r, { asOf, source: "crs", sourceRef: crsRow?.id ?? null });
    if (row) out.push({ ...row, account_ref: accountRef });
  }
  return out;
}
