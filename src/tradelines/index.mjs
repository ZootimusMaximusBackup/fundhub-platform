// Tradelines — reading credit lines out of a soft pull, and handing them to the
// Closer Dashboard's funding calculator in the shape it already expects.
//
// This module is the seam between two things that were both finished and could
// not talk to each other: `crs_results.result` (a bureau payload, jsonb, shape
// set by the vendor) and `calcFunding()` (pure, expects
// { lender, creditLimit, currentBalance, apr }). Migration 054 is the storage in
// between.
//
// THE NORMALIZER IS DELIBERATELY CONSERVATIVE. Bureau payloads disagree with
// each other about field names and about units, and the standing rule in this
// repo is that a missing input yields null, never a guess. So:
//
//   * a field this module cannot find is null, and stays null all the way to the
//     calculator, which is built to null out the dependent output;
//   * an APR is only accepted if it can be read unambiguously (see readApr);
//   * an open date is only accepted if it parses as a real calendar date (see
//     readOpenedOn) — never inferred from any other field;
//   * every line keeps its unparsed source record in `raw`.
//
// Pure and I/O-free. The db access lives in store.mjs so this half stays
// testable without a database.

/* Money in this table is integer cents (see 054). Bureau files report dollars,
   sometimes as strings, sometimes with separators and a currency mark. */
export function toCents(value) {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function fromCents(cents) {
  return cents == null ? null : Math.round(Number(cents)) / 100;
}

/* readApr — a rate as a decimal fraction (0.1899), or null.
 *
 * THE AMBIGUITY THIS EXISTS TO REFUSE. Bureau payloads carry APR both as a
 * percentage number (18.99) and as a fraction (0.1899), in the same field name,
 * across vendors. For most values the reading is obvious: nothing above 1 is a
 * fraction, and no credit card charges 0.19% a year. The genuinely ambiguous
 * band is (0, 1]: `1` could be 1% or 100%.
 *
 * We treat >1 as a percentage and <=1 as a fraction, because a sub-1% card APR
 * does not exist in the wild while a 1%-and-under fraction (any card under 100%)
 * is every card. A 0% intro rate reads as 0 under both, which is why it is
 * excluded from the band.
 *
 * Anything outside 0..100% after conversion is refused rather than clamped: a
 * clamped rate is a wrong number wearing a plausible face, and it would be drawn
 * first by a waterfall that sorts on price. */
export function readApr(value) {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/[%\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) return null;
  const fraction = n > 1 ? n / 100 : n;
  if (fraction > 1) return null; // >100% APR — not a rate we will act on
  return Math.round(fraction * 1e5) / 1e5; // numeric(6,5) in the column
}

/* readOpenedOn — a calendar date as YYYY-MM-DD, or null. Same refusal rule as
 * readApr and toCents: a value that cannot be read unambiguously is refused,
 * not guessed at, and nothing here infers a date from any other field. The
 * round-trip through Date is deterministic (a fixed string in, the same
 * string out) — it does not read the clock, so this module stays PURE. */
export function readOpenedOn(value) {
  if (value == null || value === "") return null;
  const s = String(value).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  const iso = m[0];
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) return null;
  return iso;
}

/* The field names actually seen across the payloads this repo handles, most
   specific first. Kept as data rather than a chain of `??` so that adding a
   vendor is a list edit and the precedence stays visible.
   creditorName / creditLimitAmount / highBalanceAmount / currentBalanceAmount /
   accountIdentifier / accountOpenedDate are the CRS sandbox's real TransUnion,
   Experian and Equifax field names, confirmed 2026-08-01 against the vendor's
   own JSON payload library — added alongside the earlier guesses rather than
   replacing them, since those older names may still be exercised by fixtures
   or by a source this repo has not seen a live sample of. */
const LENDER_KEYS = ["lender", "creditor", "creditor_name", "subscriber_name", "name", "creditorName"];
const LIMIT_KEYS = [
  "credit_limit", "creditLimit", "limit", "high_credit", "highCredit",
  "creditLimitAmount", "highBalanceAmount"
];
const BALANCE_KEYS = ["balance", "current_balance", "currentBalance", "balance_amount", "currentBalanceAmount"];
const APR_KEYS = ["apr", "interest_rate", "interestRate", "rate"];
const REF_KEYS = ["account_ref", "account_number", "accountNumber", "account_id", "id", "accountIdentifier"];
const KIND_KEYS = ["kind", "account_type", "accountType", "type"];
/* The account-opened date. NOT read anywhere before 2026-08-01: an earlier
   report concluded this field did not exist in the CRS payload at all — wrong,
   confirmed against the vendor's sandbox library, where `accountOpenedDate`
   sits on every tradeline across all three bureaus. The other three names are
   defensive variants, not confirmed live. */
const OPENED_KEYS = ["accountOpenedDate", "account_opened_date", "dateOpened", "opened"];

function pick(record, keys) {
  for (const k of keys) {
    const v = record?.[k];
    if (v != null && v !== "") return v;
  }
  return null;
}

/* Where the lines live inside a CRS payload. Same treatment as the field names:
   a list, not a guess. */
const TRADELINE_CONTAINERS = ["tradelines", "trade_lines", "accounts", "creditLines"];

export function extractTradelineRecords(crsResult) {
  if (!crsResult || typeof crsResult !== "object") return [];
  for (const key of TRADELINE_CONTAINERS) {
    if (Array.isArray(crsResult[key])) return crsResult[key];
  }
  // One level of nesting, for payloads that wrap the report in a `report` or
  // `data` envelope. Deeper than that we do not go looking — a tradeline array
  // buried three levels down is a payload shape nobody has confirmed, and
  // silently finding one would be the kind of guess this module refuses.
  for (const v of Object.values(crsResult)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const key of TRADELINE_CONTAINERS) {
        if (Array.isArray(v[key])) return v[key];
      }
    }
  }
  return [];
}

/* Which of the three `kind` values a raw account-type string means.
   Unrecognised → 'revolving', because the container it came from is a credit
   report's tradeline list and the calculator excludes installment lines from
   allocation. Guessing 'installment' would silently drop a real card out of the
   client's available credit; guessing 'revolving' at worst includes a line the
   closer can see and delete. */
export function readKind(value) {
  const s = String(value ?? "").toLowerCase();
  if (/install|auto|mortgage|student|personal loan/.test(s)) return "installment";
  if (/line of credit|\bloc\b|heloc/.test(s)) return "loc";
  return "revolving";
}

/**
 * normalizeTradeline — one raw bureau record → one row shaped for `tradelines`.
 * Returns null for a record with no lender AND no limit, which is not a
 * tradeline in any useful sense.
 */
export function normalizeTradeline(record, { source = "crs", sourceRef = null, asOf = null } = {}) {
  if (!record || typeof record !== "object") return null;

  const lender = pick(record, LENDER_KEYS);
  const creditLimitCents = toCents(pick(record, LIMIT_KEYS));
  if (lender == null && creditLimitCents == null) return null;

  return {
    lender: lender == null ? "Unknown lender" : String(lender).trim(),
    kind: readKind(pick(record, KIND_KEYS)),
    credit_limit_cents: creditLimitCents,
    balance_cents: toCents(pick(record, BALANCE_KEYS)),
    apr: readApr(pick(record, APR_KEYS)),
    source,
    source_ref: sourceRef,
    account_ref: pick(record, REF_KEYS) == null ? null : String(pick(record, REF_KEYS)),
    opened_on: readOpenedOn(pick(record, OPENED_KEYS)),
    raw: record,
    as_of: asOf
  };
}

/** normalizeFromCrs — a whole crs_results row → the rows to upsert. */
export function normalizeFromCrs(crsRow) {
  const records = extractTradelineRecords(crsRow?.result);
  const asOf = crsRow?.created_at ?? null;
  return records
    .map((r) => normalizeTradeline(r, { source: "crs", sourceRef: crsRow?.id ?? null, asOf }))
    .filter(Boolean);
}

/**
 * toCalculatorCards — stored rows → `calcFunding({ cards })` input.
 *
 * TWO EXCLUSIONS, BOTH DELIBERATE:
 *   * closed lines (`closed_at` set) — a closed card has no headroom to draw;
 *   * installment lines — you cannot draw against an auto loan. Including them
 *     would inflate Total Available Credit, which is the single number the
 *     closer says out loud on the call.
 *
 * A null APR is passed through as null rather than dropped. calcFunding sorts
 * cheapest-first and a null sorts last, so an unpriced card is offered only
 * after every priced one — which is the correct treatment of an unknown price.
 */
export function toCalculatorCards(rows = []) {
  return rows
    .filter((r) => r && !r.closed_at && r.kind !== "installment")
    .map((r) => ({
      id: r.id,
      lender: r.lender,
      creditLimit: fromCents(r.credit_limit_cents),
      currentBalance: fromCents(r.balance_cents) ?? 0,
      apr: r.apr == null ? null : Number(r.apr)
    }));
}
