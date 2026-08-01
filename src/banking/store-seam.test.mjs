// THE CROSSING NOBODY TESTED: src/banking/store.mjs -> src/banking/cashflow-seam.mjs.
//
// *** WHY THIS FILE EXISTS. ***
//
// The store writes bills. The seam reads bills. Twenty-one seam tests build
// their input by hand or from a live in-memory detector result, and not one of
// them ever called the store and fed what came back to the projector. So the
// line between "what the database hands us" and "what the projector expects"
// was drawn in comments and in nothing else.
//
// It is a line that fails SILENTLY when it is wrong. The store's rows are
// snake_case, the seam reads camelCase, and one field is not merely re-cased
// but renamed — the column is `next_expected_on`, the reader wants
// `nextExpectedDate`. Nothing throws on the way across. Every bill comes back
// "no confident date", every id renders `undefined:undefined:monthly`, every
// confidence is NaN, and the screen shows a client with NO BILLS AT ALL — which
// a person reads as "you are fine", not as "we could not read your bills".
//
//
// WHAT THE FAKE HERE IS ALLOWED TO BE.
//
// AUDIT-FINDINGS' first lesson is that a fake modelling the schema you wish you
// had cannot fail when the schema moves. So the row below is NOT hand-written.
// It is built by toBillRow() — the one place the column names are spelled, and
// the one recurring.pg.test.mjs already checks against the real table — and then
// every value is run through NODE-POSTGRES'S OWN TYPE PARSER for that column's
// type. The `date` columns become Date objects because pg makes them Dates, not
// because this file decided they should be. If 086's columns move, toBillRow
// moves with them or the pg test fails; if pg's decoding changes, these rows
// change with it.
//
// The claim that those really are the column types is checked against real
// Postgres in recurring.pg.test.mjs, which crosses the same line against the
// live database.

import { test } from "node:test";
import assert from "node:assert";
import pg from "pg";

import { detectRecurringBills, toBillRow } from "./recurring.mjs";
import { listRecurringBills, listRecurringBillsFor } from "./store.mjs";
import { toCashflowBills, SEAM_REASONS } from "./cashflow-seam.mjs";

const ORG = "44444444-4444-4444-8444-444444444444";
const ACCOUNT = "11111111-1111-4111-8111-111111111111";

/* ------------------------------------------------------------------------- *
 * The row a SELECT actually returns, built the honest way.
 * ------------------------------------------------------------------------- */

// The column types migration 086 (and 091) declare, by their Postgres type OID.
const TYPE_OID = { uuid: 2950, text: 25, int8: 20, int4: 23, bool: 16, date: 1082, timestamptz: 1184 };

const COLUMN_TYPE = {
  id: "uuid",
  org_id: "uuid",
  bank_account_id: "uuid",
  client_id: "uuid",
  merchant_key: "text",
  merchant_display: "text",
  cadence: "text",
  typical_amount_cents: "int8",
  anchor_day_of_month: "int4",
  next_expected_on: "date",
  next_expected_unknown_reason: "text",
  confidence_pct: "int4",
  confidence_label: "text",
  is_business: "bool",
  occurrence_count: "int4",
  first_seen_on: "date",
  last_seen_on: "date",
  detected_as_of: "timestamptz"
};

/** A JS value -> the text Postgres would put on the wire for that column type. */
function onTheWire(value, type) {
  if (type === "timestamptz") return new Date(value).toISOString().replace("T", " ").replace("Z", "+00");
  return String(value);
}

/** A detected bill -> the row `SELECT * FROM recurring_bills` hands back. */
function asStoredRow(bill, { id = "bbbbbbbb-0000-4000-8000-00000000b001" } = {}) {
  const written = toBillRow(bill, { orgId: ORG });
  const row = { id };
  for (const [column, value] of Object.entries(written)) {
    const type = COLUMN_TYPE[column];
    assert.ok(type, `store-seam.test: no column type known for ${column} — add it`);
    row[column] = value === null || value === undefined
      ? null
      : pg.types.getTypeParser(TYPE_OID[type])(onTheWire(value, type));
  }
  return row;
}

/** A db handle that returns exactly these rows, whatever it is asked. */
const handleReturning = (rows) => ({ query: async () => ({ rows }) });

let seq = 0;
function tx(postedOn, amountCents, overrides = {}) {
  seq += 1;
  return {
    id: `txn-${seq}`,
    bank_account_id: ACCOUNT,
    provider_transaction_id: `prov-${seq}`,
    amount_cents: amountCents,
    posted_on: postedOn,
    merchant_name: "NETFLIX.COM",
    is_pending: false,
    ...overrides
  };
}

/** A confident monthly bill on the 15th, detected as of 2026-06-20. */
function monthlyBill() {
  const rows = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]
    .map((ym) => tx(`${ym}-15`, -1599));
  const r = detectRecurringBills(rows, { now: "2026-06-20" });
  assert.equal(r.bills.length, 1, "fixture must produce exactly one bill");
  return r.bills[0];
}

const WINDOW = { from: "2026-07-01", to: "2026-12-31" };

/* ========================================================================= *
 * The crossing itself
 * ========================================================================= */

test("a bill written, read back and handed to the projector produces real occurrences",
  async () => {
    const detected = monthlyBill();
    const db = handleReturning([asStoredRow(detected)]);

    const bills = await listRecurringBillsFor(db, { orgId: ORG });
    const { recurringBills, skipped } = toCashflowBills({ bills }, WINDOW);

    assert.deepEqual(skipped, [], "*** a stored bill must not vanish on the way to the screen ***");
    assert.equal(recurringBills.length, 1);

    const [projected] = recurringBills;
    assert.equal(projected.billId, `${ACCOUNT}:NETFLIX COM:monthly`,
      "not undefined:undefined:monthly");
    assert.equal(projected.label, "NETFLIX.COM");
    assert.equal(projected.confidence, detected.confidencePct / 100,
      "the 0-1 fraction W8 validates, carried across from the stored integer percent");
    assert.ok(Number.isFinite(projected.confidence), "NaN here demotes every bill silently");
    assert.deepEqual(
      projected.occurrences.map((o) => o.date),
      ["2026-07-15", "2026-08-15", "2026-09-15", "2026-10-15", "2026-11-15", "2026-12-15"]
    );
    for (const o of projected.occurrences) {
      assert.equal(o.amountCents, 1599, "positive magnitude — the sign flip happens in the seam");
    }
  });

test("a bill read back arrives in the detector's own vocabulary, unchanged", async () => {
  // THE ROUND TRIP. fromBillRow() calls itself the exact inverse of toBillRow(),
  // and this is that claim, checked. A field that goes in as the string
  // "2026-07-15" and comes back as a Date is not the inverse: it compares
  // unequal, it renders as "2026-07-15T00:00:00.000Z" in any JSON response, and
  // east of Greenwich it renders as the DAY BEFORE, because node-postgres
  // decodes a `date` to LOCAL midnight and JSON serialises in UTC.
  const detected = monthlyBill();
  const db = handleReturning([asStoredRow(detected)]);

  const [readBack] = await listRecurringBillsFor(db, { orgId: ORG });

  for (const field of ["nextExpectedDate", "firstSeenOn", "lastSeenOn"]) {
    assert.equal(typeof readBack[field], "string", `${field} must come back as a day string`);
    assert.match(readBack[field], /^\d{4}-\d{2}-\d{2}$/, `${field} must be YYYY-MM-DD`);
    assert.equal(readBack[field], detected[field], `${field} must survive the round trip`);
  }
  assert.equal(readBack.detectedAsOf, detected.detectedAsOf,
    "the evaluation instant must survive the round trip too");

  // The same assertion from the screen's point of view: what a JSON response
  // carries is what a person ends up reading.
  const rendered = JSON.parse(JSON.stringify(readBack));
  assert.equal(rendered.nextExpectedDate, "2026-07-15");
  assert.equal(rendered.firstSeenOn, "2026-01-15");

  // The values that are not dates must survive as themselves as well.
  assert.equal(readBack.typicalAmountCents, -1599, "bigint arrives as a string and is coerced once");
  assert.equal(readBack.confidencePct, detected.confidencePct);
  assert.equal(readBack.anchorDayOfMonth, detected.anchorDayOfMonth);
  assert.equal(readBack.merchantKey, detected.merchantKey);
  assert.equal(readBack.cadence, detected.cadence);
});

test("the raw read and the mapped read are NOT interchangeable, and the raw one fails quietly",
  async () => {
    // This is the failure the crossing exists to prevent, pinned so that anyone
    // who deletes listRecurringBillsFor() and reaches for listRecurringBills()
    // finds out here rather than from an empty screen.
    const row = asStoredRow(monthlyBill());

    const raw = await listRecurringBills(handleReturning([row]), { orgId: ORG });
    const { recurringBills, skipped } = toCashflowBills({ bills: raw }, WINDOW);

    assert.deepEqual(recurringBills, [], "raw snake_case rows project nothing at all");
    assert.equal(skipped.length, 1);
    assert.equal(skipped[0].billId, "undefined:undefined:monthly",
      "*** and the id it reports names no bill a person could look up — `cadence` was " +
      "the only name that happened to match on both sides ***");
    assert.equal(skipped[0].reason, SEAM_REASONS.NO_CONFIDENT_DATE,
      "a bill with a perfectly good date reported as having none — nothing threw");
  });

test("a stored guess with no date crosses as a skip with its reason, not as an invented date",
  async () => {
    // The honesty rule has to survive the crossing: a low-confidence candidate
    // is stored with next_expected_on NULL and a reason, and the projector must
    // be told that rather than handed a plausible first date.
    const rows = [tx("2026-05-03", -4500, { merchant_name: "GYM" }),
      tx("2026-06-03", -4500, { merchant_name: "GYM" })];
    const r = detectRecurringBills(rows, { now: "2026-06-20" });
    assert.equal(r.candidates.length, 1, "fixture must produce exactly one guess");

    const db = handleReturning([asStoredRow(r.candidates[0])]);
    const bills = await listRecurringBillsFor(db, { orgId: ORG, presentableOnly: false });

    assert.equal(bills[0].nextExpectedDate, null);
    assert.equal(bills[0].nextExpectedUnknownReason, "two_occurrences_is_a_guess_not_a_cadence");

    const { recurringBills, skipped } = toCashflowBills({ bills }, WINDOW);
    assert.deepEqual(recurringBills, []);
    assert.equal(skipped[0].reason, SEAM_REASONS.NO_CONFIDENT_DATE);
  });
