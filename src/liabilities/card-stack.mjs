// Card stack — the shaping half of /api/finance/liabilities?client_id=.
//
// Same split as everywhere else in this repo: store.mjs talks to Postgres,
// index.mjs parses, and this file does the arithmetic and the presentation
// decisions so they are unit-testable without a database. The handler above it
// (api/finance/liabilities.mjs) does auth, org scoping and SQL and nothing else.
//
// ===========================================================================
// THE PROBLEM THIS FILE EXISTS TO NOT PAPER OVER: TWO TABLES HOLD A BALANCE
// ===========================================================================
// `tradelines.balance_cents` (054) is the balance on the FACILITY, overwritten
// by every pull and by every manual edit — "what is drawn against this line
// right now, as best we know".
//
// `card_liabilities.current_balance_cents` (083) is the balance on the BILLING
// POSITION, pinned to an `as_of` date and preserved as a series in 084 — "what
// this client owed on the date we looked".
//
// They are different questions and they routinely give different answers: the
// facility figure moves the moment somebody edits the card, the position figure
// only moves when a new observation is recorded. The Finance OS grid
// (src/finance/os-grid.mjs) reads the FIRST one. This screen leads with the
// SECOND one, because a dated observation is a stronger claim than an undated
// one.
//
// SO WHERE THEY DISAGREE, THIS FILE REPORTS BOTH AND NAMES THE SOURCE OF EACH.
// It does not average them, it does not pick a winner silently, and it does not
// hide the loser. Two screens showing one client two different balances with no
// explanation is how somebody loses confidence in every number in the product;
// two screens showing two different balances, each labelled with where it came
// from and how old it is, is just the truth about what we know.
//
// ===========================================================================
// NULL IS UNKNOWN, ALL THE WAY THROUGH
// ===========================================================================
// A card whose limit nobody knows has an UNKNOWN limit, not a zero one, and its
// utilization is unknown rather than 0%. A total computed across cards where
// some did not report is a FLOOR, not a total, and it says so through
// `basis.partial` — the same `sumKnown` / `basisOf` pair os-grid.mjs uses,
// imported rather than rewritten, because "a total over a set with holes in it
// is a floor" is one rule and two copies of it would drift.
//
// Pure. No I/O, no clock, no randomness.

import { sumKnown, basisOf, financeOsGrid } from "../finance/os-grid.mjs";
import { fromCents } from "../commissions/money.mjs";

/* pg returns bigint AND numeric as strings. Anything that is not a finite
   number after conversion is UNKNOWN, not zero. Identical rule to
   os-grid.mjs:47 — it is four lines and os-grid does not export it; the drift
   guard is card-stack.agrees-with-os-grid in the test file, which pins the two
   modules' answers to each other on the same input. */
function cents(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function rate(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/* money — cents to a 2dp string, or null. NULL never renders as "0.00". */
const money = (c) => (c === null ? null : fromCents(c));

/* pct — a decimal fraction to a percentage string, or null. 0.1899 → "18.99%".
   The fraction is what is stored (054 and 083 both CHECK 0..1); the percentage
   is what a human reads. The conversion happens here, once, at the edge. */
const pct = (f, dp = 2) => (f === null ? null : `${(f * 100).toFixed(dp)}%`);

/* A date column comes back from pg as a Date when the driver has type info and
   as a string when it does not (a CTE, a stubbed handle). Both must reach the
   screen as YYYY-MM-DD and neither may become "Invalid Date".
 *
 * THE LOCAL COMPONENTS ARE READ, NOT toISOString(). pg hands a `date` column
 * back as a JS Date pinned to LOCAL midnight, so `toISOString().slice(0,10)`
 * moves the day by one for any process running east of UTC — a statement due on
 * the 1st renders as due on the 31st of the month before, which on a payment
 * due date is a whole billing cycle's worth of wrong. src/liabilities/
 * store.pg.test.mjs:70 records the same trap. Using the local components makes
 * the rendered day the day the database holds, in every timezone. */
export function isoDay(v) {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    const p = (n) => String(n).padStart(2, "0");
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  const s = String(v);
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1] : null;
}

/**
 * shapePosition — one `card_liabilities` or `card_liability_history` row → the
 * shape the screen reads. Used for the current position AND for every entry in
 * a card's series, so the two cannot describe the same measure differently.
 *
 * `raw` IS DELIBERATELY NOT ON THE WIRE. It is the unparsed bureau record kept
 * to settle a dispute (083), it can be large, and it is the one field on these
 * tables that could carry something redact() has never seen. Nothing on the
 * screen reads it.
 */
export function shapePosition(row) {
  if (!row) return null;
  const current = cents(row.current_balance_cents);
  const statement = cents(row.statement_balance_cents);
  const minimum = cents(row.minimum_payment_cents);
  const pastDue = cents(row.past_due_cents);
  const lastPayment = cents(row.last_payment_cents);
  const apr = rate(row.apr);
  return {
    id: row.id ?? null,
    as_of: isoDay(row.as_of),
    current_balance_cents: current,
    current_balance: money(current),
    statement_balance_cents: statement,
    statement_balance: money(statement),
    minimum_payment_cents: minimum,
    minimum_payment: money(minimum),
    past_due_cents: pastDue,
    past_due: money(pastDue),
    last_payment_cents: lastPayment,
    last_payment: money(lastPayment),
    last_payment_date: isoDay(row.last_payment_date),
    statement_date: isoDay(row.statement_date),
    payment_due_date: isoDay(row.payment_due_date),
    apr,
    apr_display: pct(apr),
    // NULL here is "the file did not say", which is NOT "current". 083 is
    // explicit that guessing "current" on a delinquent account is the expensive
    // direction to be wrong in, so it stays null and the screen shows a dash.
    payment_status: row.payment_status ?? null,
    source: row.source ?? null
  };
}

/**
 * shapeCard — one tradeline row plus its current position (or null) → one row
 * of the stack.
 *
 * WHICH BALANCE THE ROW LEADS WITH, AND WHY IT SAYS SO. A dated observation
 * beats an undated one, so the position's `current_balance_cents` wins when it
 * is known and the facility's `balance_cents` is the fallback. `balance_source`
 * names which of the two the headline number came from, on every row, always —
 * not only when they disagree — because a reader should never have to work out
 * whether the label is missing because they agree or because the code forgot.
 *
 * WHICH APR. The facility's, when known. 083's header makes the distinction:
 * `card_liabilities.apr` is the rate in effect when THAT statement cut, which
 * for an expired intro rate is not the rate the client is paying now. The stack
 * answers "what does this money cost today", so the facility rate leads and the
 * position rate is the fallback for a card whose facility rate we never got.
 */
export function shapeCard(tradeline, position, observations = 0) {
  const t = tradeline || {};
  const limit = cents(t.credit_limit_cents);
  const facilityBalance = cents(t.balance_cents);
  const pos = shapePosition(position);
  const positionBalance = pos ? pos.current_balance_cents : null;

  const balance = positionBalance !== null ? positionBalance : facilityBalance;
  const balanceSource =
    positionBalance !== null ? "card_liabilities" : (facilityBalance !== null ? "tradelines" : null);

  const facilityApr = rate(t.apr);
  const apr = facilityApr !== null ? facilityApr : (pos ? pos.apr : null);
  const aprSource = facilityApr !== null ? "tradelines" : (pos && pos.apr !== null ? "card_liabilities" : null);

  /* Headroom needs BOTH numbers. A limit minus an unknown balance is not
     headroom, it is a limit. Clamped at zero per card because an over-limit
     card offers nothing to draw and must not cancel out another card's real
     headroom in the total (the same rule os-grid.mjs:114 applies). */
  const headroom = limit === null || balance === null ? null : Math.max(0, limit - balance);

  /* Utilization is undefined against a zero or unknown limit — it is not 0%.
     Dividing by zero and rendering "0.0%" would tell a closer this card is
     untouched. */
  const utilization = limit === null || balance === null || limit <= 0
    ? null
    : Math.round((balance / limit) * 10000) / 10000;

  /* THE DISAGREEMENT. Only reportable when both numbers exist; a missing
     position is not a disagreement, it is a card nobody has observed yet. */
  const disagreement =
    positionBalance !== null && facilityBalance !== null && positionBalance !== facilityBalance
      ? {
          card_liabilities_cents: positionBalance,
          card_liabilities: money(positionBalance),
          tradelines_cents: facilityBalance,
          tradelines: money(facilityBalance),
          difference_cents: positionBalance - facilityBalance,
          difference: money(Math.abs(positionBalance - facilityBalance)),
          as_of: pos.as_of
        }
      : null;

  return {
    tradeline_id: t.id ?? null,
    lender: t.lender ?? null,
    last4: t.last4 ?? null,
    kind: t.kind ?? null,
    opened_on: isoDay(t.opened_on),
    closed_at: isoDay(t.closed_at),
    facility_as_of: isoDay(t.as_of),
    facility_source: t.source ?? null,

    credit_limit_cents: limit,
    credit_limit: money(limit),

    balance_cents: balance,
    balance: money(balance),
    balance_source: balanceSource,

    headroom_cents: headroom,
    headroom: money(headroom),

    apr,
    apr_display: pct(apr),
    apr_source: aprSource,

    utilization,
    utilization_display: utilization === null ? null : pct(utilization, 1),

    // The facility's own balance, kept alongside the headline even when they
    // agree, so the screen can name both sources without a second request.
    facility_balance_cents: facilityBalance,
    facility_balance: money(facilityBalance),

    position: pos,
    disagreement,

    // How many observations stand behind this card. 0 is "nothing has been
    // recorded for this card yet" — which is NOT a zero balance, and the screen
    // says so in words.
    observations: Number.isFinite(Number(observations)) ? Number(observations) : 0
  };
}

/* MOST EXPENSIVE MONEY FIRST. Highest APR heads the list, because that is the
   card whose balance costs the most to carry and the one a closer talks about
   first. An UNKNOWN rate sorts LAST rather than first or in the middle: "we do
   not know what this costs" is not "this costs the most", and putting an
   unpriced card at the top of a list read out loud would be a claim we cannot
   make. This is the mirror of os-grid.mjs's "cheapest money available", which
   refuses to nominate an unpriced line as the cheapest for the same reason.
   Ties break on the larger balance, then on the lender name so the order is
   stable between two reads. */
export function compareCards(a, b) {
  if (a.apr !== b.apr) {
    if (a.apr === null) return 1;
    if (b.apr === null) return -1;
    return b.apr - a.apr;
  }
  const ab = a.balance_cents === null ? -1 : a.balance_cents;
  const bb = b.balance_cents === null ? -1 : b.balance_cents;
  if (ab !== bb) return bb - ab;
  return String(a.lender || "").localeCompare(String(b.lender || ""));
}

/**
 * buildCardStack — tradeline rows + current positions + observation counts →
 * the whole screen.
 *
 * Returns { source, lines, cards, totals, disagreements }.
 *
 * `totals` is deliberately the SAME ROW SHAPE financeOsGrid() returns —
 * { key, label, value, display, unit, basis } — so card-stack.html renders it
 * with the same three lines of markup finance-os.html uses and the two screens
 * cannot drift in how they show an unknown or a floor.
 */
export function buildCardStack({ tradelines = [], positions = [], observationCounts = {} } = {}) {
  const byTradeline = new Map();
  for (const p of positions || []) {
    if (p && p.tradeline_id) byTradeline.set(String(p.tradeline_id), p);
  }

  const cards = (Array.isArray(tradelines) ? tradelines : [])
    .map((t) => shapeCard(
      t,
      byTradeline.get(String(t && t.id)) || null,
      observationCounts[String(t && t.id)] || 0
    ))
    .sort(compareCards);

  /* THE TOTALS ARE OVER DRAWABLE CARDS ONLY, and the list is not. A closed card
     still belongs on the stack — it is why a balance moved, and its series is
     still readable — but it has no headroom to draw and adding its limit to
     "total credit limit" would inflate the one number a closer says out loud on
     a call. An installment line is excluded for the same reason: you cannot draw
     against an auto loan. This is os-grid.mjs:43's DRAWABLE rule applied to the
     same client's rows, so the two screens total the same set. `totalled` on the
     response says how many of the listed cards the totals actually cover, so a
     reader looking at six rows under a four-card total is never left guessing. */
  const drawable = cards.filter((c) => !c.closed_at && c.kind !== "installment");
  const n = drawable.length;
  const limit = sumKnown(drawable.map((c) => c.credit_limit_cents));
  const balance = sumKnown(drawable.map((c) => c.balance_cents));
  const headroom = sumKnown(drawable.map((c) => c.headroom_cents));

  /* WEIGHTED BY CREDIT LIMIT, NOT A PLAIN MEAN. A 29% rate on a $500 card and a
     12% rate on a $50,000 card do not cost the same, and averaging them flat
     produces a number that describes no borrower.

     THIS IS THE SAME ARITHMETIC AS os-grid.mjs:137-149 AND THAT IS ON PURPOSE,
     not an oversight. financeOsGrid() cannot simply be called here: it filters
     to DRAWABLE lines only and it totals the FACILITY balance, so it answers a
     different question over a different row set — this screen can be asked to
     include closed cards, and its balances come from card_liabilities. Copying
     ten lines of arithmetic is the lesser evil; what makes it safe is the drift
     guard in card-stack.test.mjs, which feeds one set of open, drawable,
     facility-priced rows to BOTH modules and fails if the two weighted APRs
     ever stop matching. If you change the weighting rule, change it in
     os-grid.mjs and that test will tell you this copy needs the same edit. */
  let aprWeight = 0;
  let aprAcc = 0;
  let aprKnown = 0;
  let aprUnknown = 0;
  for (const c of drawable) {
    if (c.apr === null || c.credit_limit_cents === null || c.credit_limit_cents <= 0) {
      aprUnknown++;
      continue;
    }
    aprAcc += c.apr * c.credit_limit_cents;
    aprWeight += c.credit_limit_cents;
    aprKnown++;
  }
  const avgApr = aprWeight > 0 ? Math.round((aprAcc / aprWeight) * 100000) / 100000 : null;

  return {
    // Both tables are named, in the order the screen prefers them, because a
    // reader comparing this to Finance OS is entitled to know that grid reads
    // one of these two and this screen reads both.
    source: "card_liabilities+tradelines",
    lines: cards.length,
    totalled: n,
    cards,
    disagreements: cards.filter((c) => c.disagreement).length,
    totals: [
      {
        key: "credit_limit", label: "Total credit limit",
        value: limit.total, display: money(limit.total), unit: "usd",
        basis: basisOf(limit, n)
      },
      {
        key: "balance", label: "Total balance",
        value: balance.total, display: money(balance.total), unit: "usd",
        basis: basisOf(balance, n)
      },
      {
        key: "headroom", label: "Total headroom",
        value: headroom.total, display: money(headroom.total), unit: "usd",
        basis: basisOf(headroom, n)
      },
      {
        key: "avg_apr", label: "Average APR (limit-weighted)",
        value: avgApr, display: avgApr === null ? null : pct(avgApr),
        unit: "fraction",
        basis: { lines: n, counted: aprKnown, unknown: aprUnknown, partial: aprUnknown > 0 }
      }
    ]
  };
}

/* Re-exported so the drift test can reach os-grid through this module's own
   import and prove it is the same function, not a same-named copy. */
export { financeOsGrid };

export default buildCardStack;
