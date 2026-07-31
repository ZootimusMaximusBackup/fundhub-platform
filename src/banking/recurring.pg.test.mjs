// Real-Postgres integration test for the banking thread.
// SKIPS unless DATABASE_URL is set, like every other .pg.test.mjs here.
// Run live:  DATABASE_URL=postgres://... npm run migrate && DATABASE_URL=... npm test
//
// WHAT THIS PROVES THAT THE PURE TESTS CANNOT.
//
// AUDIT-FINDINGS' first and most expensive lesson: "A fake that models the
// schema you wish you had cannot fail when the schema moves." Its worst single
// finding is 031_invoices.sql renaming three columns while the only writer kept
// using the old names — green unit tests, dead feature, discovered only against
// real Postgres. So everything below is a claim the detector or its migrations
// MAKE about the database, checked against the database:
//
//   - the sign convention is ENFORCED, not merely documented: a positive
//     typical_amount_cents is refused by recurring_bills_outflow_ck;
//   - "a null next date always carries a reason" is a CHECK, not a convention:
//     both-null and both-set are both refused;
//   - a re-sync cannot double-count: uq_bank_transactions_account_provider
//     refuses the second insert even with the detector bypassed entirely, and
//     the same provider id on a DIFFERENT account is still accepted;
//   - re-running detection UPSERTS instead of accumulating fifty-two rows for
//     one subscription;
//   - toBillRow's column names are the columns that exist — the 031 failure,
//     tested for;
//   - a `date` column round-trips through parseDay(). The module's header
//     claims node-postgres decodes a date to LOCAL midnight and that reading
//     UTC parts off it would shift every bill by a day west of Greenwich. That
//     claim is checked here rather than trusted;
//   - a bigint column comes back as a STRING and the detector still reads it as
//     integer cents;
//   - detected_as_of has no DEFAULT, so a writer cannot silently stamp the
//     write time in place of the evaluation instant;
//   - THE STANDING POLICY AUDIT: zero rows anywhere satisfy
//     `occurrence_count = 2 AND next_expected_on IS NOT NULL`. Migration 086's
//     header promises that query returns nothing for as long as the detector is
//     honest. This runs it.

import { test, before, after } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import {
  detectRecurringBills, toBillRow, parseDay, formatDay, normaliseMerchant
} from "./recurring.mjs";
import {
  upsertRecurringBill,
  saveDetection,
  listRecurringBills,
  listRecurringBillsFor,
  getBillEvidence
} from "./store.mjs";
import { toCashflowBills } from "./cashflow-seam.mjs";

const HAS_DB = !!process.env.DATABASE_URL;

// Every row this file writes carries one of these sentinels, so the wipe can
// never reach a real record.
const PROVIDER_PREFIX = "W7PGTEST";
const MERCHANT_PREFIX = "W7PGTEST";
const CLIENT_EMAIL = "recurring_bills_pg_test@example.com";
const OTHER_ORG_SLUG = "w7-pg-test-other-org";

// The sentinel prefix is itself stripped by normaliseMerchant() — it is a mixed
// alphanumeric token, which the normaliser correctly treats as a reference id.
// So a stored merchant_key is the NORMALISED name, and the test must look it up
// that way rather than by the raw descriptor it inserted.
const merchantKeyFor = (merchant) => normaliseMerchant(`${MERCHANT_PREFIX} ${merchant}`);

const ACCOUNT_A = "aaaaaaaa-0000-4000-8000-00000000a001";
const ACCOUNT_B = "bbbbbbbb-0000-4000-8000-00000000b002";
const ACCOUNT_C = "cccccccc-0000-4000-8000-00000000c003";
const ACCOUNT_D = "dddddddd-0000-4000-8000-00000000d004";
const TEST_ACCOUNTS = [ACCOUNT_A, ACCOUNT_B, ACCOUNT_C, ACCOUNT_D];

let orgId = null;
let clientId = null;

async function wipe() {
  await db.query(
    `DELETE FROM recurring_bill_transactions
      WHERE bank_transaction_id IN (
        SELECT id FROM bank_transactions WHERE provider_transaction_id LIKE $1 || '%')`,
    [PROVIDER_PREFIX]
  );
  await db.query(`DELETE FROM recurring_bills WHERE bank_account_id = ANY($1::uuid[])`,
    [TEST_ACCOUNTS]);
  await db.query(`DELETE FROM bank_transactions WHERE provider_transaction_id LIKE $1 || '%'`,
    [PROVIDER_PREFIX]);
  await db.query(`DELETE FROM clients WHERE email = $1`, [CLIENT_EMAIL]);
  await db.query(`DELETE FROM orgs WHERE slug = $1`, [OTHER_ORG_SLUG]);
}

/** Insert a bank transaction. Returns the row as the database stored it. */
async function insertTxn({
  account = ACCOUNT_A,
  providerId,
  amountCents,
  postedOn,
  authorizedOn = null,
  merchant = `${MERCHANT_PREFIX} NETFLIX`,
  pending = false
}) {
  const r = await db.query(
    `INSERT INTO bank_transactions
       (org_id, bank_account_id, client_id, amount_cents, posted_on, authorized_on,
        merchant_name, is_pending, provider_transaction_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [orgId, account, clientId, amountCents, postedOn, authorizedOn, merchant, pending,
      `${PROVIDER_PREFIX}${providerId}`]
  );
  return r.rows[0];
}

/**
 * Write a detected bill through the REAL writer.
 *
 * This used to be hand-rolled INSERT ... ON CONFLICT SQL right here, which is
 * how the 031_invoices failure begins: the column names live in a test, the
 * migration moves them, and the test is the last place anybody looks. The write
 * path is src/banking/store.mjs now, and this test exercises it rather than
 * imitating it.
 */
const upsertBill = (bill) => upsertRecurringBill(db, bill, { orgId });

const errorOf = async (fn) => {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
};

before(async () => {
  if (!HAS_DB) return;
  await wipe();
  orgId = (await db.query(`SELECT id FROM orgs ORDER BY created_at LIMIT 1`)).rows[0]?.id;
  assert.ok(orgId, "an org must exist — run the migrations");
  clientId = (await db.query(
    `INSERT INTO clients (org_id, email, first_name) VALUES ($1,$2,'Banking') RETURNING id`,
    [orgId, CLIENT_EMAIL]
  )).rows[0].id;
});

after(async () => {
  if (!HAS_DB) return;
  await wipe();
  await close();
});

/* ========================================================================= *
 * The schema is the schema the code thinks it is
 * ========================================================================= */

test("085 and 086 created the tables and columns the code writes to", { skip: !HAS_DB }, async () => {
  // This is the 031_invoices.sql failure, tested for: the only writer used
  // column names a migration had renamed, and nothing noticed until Postgres
  // was involved.
  const cols = async (table) => (await db.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = $1`, [table]
  )).rows.map((r) => r.column_name).sort();

  const txnCols = await cols("bank_transactions");
  for (const c of ["org_id", "bank_account_id", "client_id", "amount_cents", "posted_on",
    "authorized_on", "merchant_name", "category", "is_pending", "provider_transaction_id",
    "provider", "raw"]) {
    assert.ok(txnCols.includes(c), `bank_transactions.${c} is missing`);
  }

  // Every key toBillRow emits must be a real column on recurring_bills.
  const billCols = await cols("recurring_bills");
  const shaped = toBillRow({
    bankAccountId: ACCOUNT_A, clientId: null, merchantKey: "X", merchantDisplay: "X",
    cadence: "monthly", typicalAmountCents: -100, nextExpectedDate: null,
    nextExpectedUnknownReason: "r", confidencePct: 40, confidenceLabel: "low",
    isBusiness: null, occurrenceCount: 2, firstSeenOn: "2026-01-01",
    lastSeenOn: "2026-02-01", detectedAsOf: "2026-03-01T00:00:00.000Z"
  }, { orgId });
  for (const key of Object.keys(shaped)) {
    assert.ok(billCols.includes(key), `toBillRow emits ${key}, which recurring_bills does not have`);
  }
});

/* ========================================================================= *
 * The sign convention is ENFORCED
 * ========================================================================= */

test("recurring_bills refuses a bill that is not an outflow", { skip: !HAS_DB }, async () => {
  const base = {
    org_id: orgId, bank_account_id: ACCOUNT_A, merchant_key: `${MERCHANT_PREFIX} SIGN`,
    cadence: "monthly", next_expected_on: null,
    next_expected_unknown_reason: "confidence_too_low_to_predict_a_date",
    confidence_pct: 40, confidence_label: "low", occurrence_count: 3,
    first_seen_on: "2026-01-15", last_seen_on: "2026-03-15",
    detected_as_of: "2026-03-20T00:00:00.000Z"
  };
  const write = (amount) => db.query(
    `INSERT INTO recurring_bills (org_id, bank_account_id, merchant_key, cadence,
       typical_amount_cents, next_expected_on, next_expected_unknown_reason,
       confidence_pct, confidence_label, occurrence_count, first_seen_on, last_seen_on,
       detected_as_of)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [base.org_id, base.bank_account_id, base.merchant_key, base.cadence, amount,
      base.next_expected_on, base.next_expected_unknown_reason, base.confidence_pct,
      base.confidence_label, base.occurrence_count, base.first_seen_on, base.last_seen_on,
      base.detected_as_of]
  );

  // An ingest that forgot to negate at the Plaid boundary fails HERE, loudly,
  // instead of a projection quietly reporting the client's rent as income.
  const positive = await errorOf(() => write(1599));
  assert.ok(positive, "a positive amount must be refused");
  assert.match(positive.message, /recurring_bills_outflow_ck/);

  const zero = await errorOf(() => write(0));
  assert.ok(zero, "zero is not an outflow either");

  await write(-1599);
  await db.query(`DELETE FROM recurring_bills WHERE merchant_key = $1`, [base.merchant_key]);
});

test("bank_transactions refuses a zero amount and a row with no date at all",
  { skip: !HAS_DB }, async () => {
    const zero = await errorOf(() => insertTxn({
      providerId: "ZERO", amountCents: 0, postedOn: "2026-01-15"
    }));
    assert.match(zero.message, /bank_transactions_amount_nonzero_ck/);

    const undated = await errorOf(() => db.query(
      `INSERT INTO bank_transactions (org_id, bank_account_id, amount_cents,
         provider_transaction_id, is_pending)
       VALUES ($1,$2,$3,$4,true)`,
      [orgId, ACCOUNT_A, -100, `${PROVIDER_PREFIX}NODATE`]
    ));
    assert.match(undated.message, /bank_transactions_has_a_date_ck/);

    // A settled row must say when it settled.
    const settledNoDate = await errorOf(() => db.query(
      `INSERT INTO bank_transactions (org_id, bank_account_id, amount_cents,
         authorized_on, provider_transaction_id, is_pending)
       VALUES ($1,$2,$3,$4,$5,false)`,
      [orgId, ACCOUNT_A, -100, "2026-01-15", `${PROVIDER_PREFIX}SETTLEDNODATE`]
    ));
    assert.match(settledNoDate.message, /bank_transactions_posted_date_ck/);

    // Settlement before authorisation is a swapped pair, and a swapped pair
    // shifts every cadence it touches.
    const backwards = await errorOf(() => insertTxn({
      providerId: "BACKWARDS", amountCents: -100,
      postedOn: "2026-01-10", authorizedOn: "2026-01-15"
    }));
    assert.match(backwards.message, /bank_transactions_date_order_ck/);
  });

/* ========================================================================= *
 * "A null date always carries a reason" is a CHECK, not a convention
 * ========================================================================= */

test("recurring_bills refuses both-null and both-set for the next-date pair",
  { skip: !HAS_DB }, async () => {
    const write = (nextOn, reason) => db.query(
      `INSERT INTO recurring_bills (org_id, bank_account_id, merchant_key, cadence,
         typical_amount_cents, next_expected_on, next_expected_unknown_reason,
         confidence_pct, confidence_label, occurrence_count, first_seen_on, last_seen_on,
         detected_as_of)
       VALUES ($1,$2,$3,'monthly',-1000,$4,$5,60,'medium',3,'2026-01-15','2026-03-15',
               '2026-03-20T00:00:00Z')`,
      [orgId, ACCOUNT_A, `${MERCHANT_PREFIX} XOR`, nextOn, reason]
    );

    // Silence — a row that just does not say. This is the shape the CHECK
    // exists to make impossible.
    const bothNull = await errorOf(() => write(null, null));
    assert.match(bothNull.message, /recurring_bills_next_expected_reason_ck/);

    // A date AND an excuse for not having one. Equally incoherent.
    const bothSet = await errorOf(() => write("2026-04-15", "confidence_too_low_to_predict_a_date"));
    assert.match(bothSet.message, /recurring_bills_next_expected_reason_ck/);

    const emptyReason = await errorOf(() => write(null, "   "));
    assert.match(emptyReason.message, /recurring_bills_reason_nonempty_ck/);

    await write("2026-04-15", null);
    await db.query(`DELETE FROM recurring_bills WHERE merchant_key = $1`, [`${MERCHANT_PREFIX} XOR`]);
  });

test("detected_as_of has no DEFAULT, so the write time cannot stand in for the evaluation time",
  { skip: !HAS_DB }, async () => {
    const e = await errorOf(() => db.query(
      `INSERT INTO recurring_bills (org_id, bank_account_id, merchant_key, cadence,
         typical_amount_cents, next_expected_on, confidence_pct, confidence_label,
         occurrence_count, first_seen_on, last_seen_on)
       VALUES ($1,$2,$3,'monthly',-1000,'2026-04-15',60,'medium',3,'2026-01-15','2026-03-15')`,
      [orgId, ACCOUNT_A, `${MERCHANT_PREFIX} NODEFAULT`]
    ));
    assert.ok(e, "omitting detected_as_of must fail");
    assert.match(e.message, /detected_as_of/);

    const def = (await db.query(
      `SELECT column_default FROM information_schema.columns
        WHERE table_name = 'recurring_bills' AND column_name = 'detected_as_of'`
    )).rows[0].column_default;
    assert.equal(def, null, "a default here would re-introduce the hidden clock");
  });

/* ========================================================================= *
 * A re-sync cannot double-count
 * ========================================================================= */

test("the same provider id twice on one account is refused by the database itself",
  { skip: !HAS_DB }, async () => {
    // The detector's own dedupe is bypassed entirely here — this is the
    // database's rule, which is what has to hold when two concurrent syncs race.
    await insertTxn({ providerId: "DUP1", amountCents: -1599, postedOn: "2026-01-15" });

    const e = await errorOf(() => insertTxn({
      providerId: "DUP1", amountCents: -1599, postedOn: "2026-01-15"
    }));
    assert.ok(e, "the second insert must be refused");
    assert.match(e.message, /uq_bank_transactions_account_provider/);

    // ...and the same id on a DIFFERENT account is a different transaction.
    // Two banks can both hand out the id "1".
    await insertTxn({ account: ACCOUNT_B, providerId: "DUP1", amountCents: -2500, postedOn: "2026-01-15" });

    const n = Number((await db.query(
      `SELECT count(*)::int AS n FROM bank_transactions WHERE provider_transaction_id = $1`,
      [`${PROVIDER_PREFIX}DUP1`]
    )).rows[0].n);
    assert.equal(n, 2, "one row per account, never two on the same account");
  });

test("a pending row that later posts UPDATEs in place rather than becoming a second charge",
  { skip: !HAS_DB }, async () => {
    await insertTxn({
      providerId: "SETTLE", amountCents: -1550, postedOn: null,
      authorizedOn: "2026-02-14", pending: true
    });
    await db.query(
      `INSERT INTO bank_transactions (org_id, bank_account_id, amount_cents, posted_on,
         authorized_on, merchant_name, is_pending, provider_transaction_id)
       VALUES ($1,$2,$3,$4,$5,$6,false,$7)
       ON CONFLICT (bank_account_id, provider_transaction_id)
       DO UPDATE SET amount_cents = EXCLUDED.amount_cents, posted_on = EXCLUDED.posted_on,
                     is_pending = false`,
      [orgId, ACCOUNT_A, -1599, "2026-02-16", "2026-02-14",
        `${MERCHANT_PREFIX} NETFLIX`, `${PROVIDER_PREFIX}SETTLE`]
    );

    const rows = (await db.query(
      `SELECT * FROM bank_transactions WHERE provider_transaction_id = $1`,
      [`${PROVIDER_PREFIX}SETTLE`]
    )).rows;
    assert.equal(rows.length, 1, "one purchase, one row");
    assert.equal(rows[0].is_pending, false);
    assert.equal(Number(rows[0].amount_cents), -1599);
  });

/* ========================================================================= *
 * Real rows through the real detector
 * ========================================================================= */

test("a real bank_transactions history detects, and pg's own types survive the trip",
  { skip: !HAS_DB }, async () => {
    const months = ["2026-01-15", "2026-02-15", "2026-03-15", "2026-04-15", "2026-05-15"];
    for (const [i, d] of months.entries()) {
      await insertTxn({ providerId: `HIST${i}`, amountCents: -1599, postedOn: d });
    }
    // A pending charge for the same merchant that must NOT count.
    await insertTxn({
      providerId: "HISTPEND", amountCents: -1599, postedOn: null,
      authorizedOn: "2026-05-28", pending: true
    });
    // An inflow (a refund) that must NOT count.
    await insertTxn({ providerId: "HISTREFUND", amountCents: 1599, postedOn: "2026-03-20" });

    const rows = (await db.query(
      `SELECT * FROM bank_transactions
        WHERE bank_account_id = $1 AND provider_transaction_id LIKE $2 || 'HIST%'
        ORDER BY posted_on`,
      [ACCOUNT_A, PROVIDER_PREFIX]
    )).rows;

    // What pg actually hands back — the claims the module's header makes.
    assert.equal(typeof rows[0].amount_cents, "string", "bigint arrives as a string");
    assert.ok(rows[0].posted_on instanceof Date, "a date column arrives as a Date");
    assert.equal(
      formatDay(parseDay(rows[0].posted_on)), "2026-01-15",
      "parseDay must read node-postgres's local-midnight Date back as the same calendar day"
    );

    const result = detectRecurringBills(rows, { now: "2026-05-20" });

    assert.equal(result.bills.length, 1);
    const bill = result.bills[0];
    assert.equal(bill.cadence, "monthly");
    assert.equal(bill.occurrenceCount, 5, "the pending row and the refund are not occurrences");
    assert.equal(bill.typicalAmountCents, -1599);
    assert.equal(bill.firstSeenOn, "2026-01-15");
    assert.equal(bill.lastSeenOn, "2026-05-15");
    assert.equal(bill.nextExpectedDate, "2026-06-15");
    assert.equal(bill.confidenceLabel, "high");
    assert.deepEqual(
      result.excluded.map((e) => e.reason).sort(),
      ["inflow_not_an_outflow", "pending_transaction"]
    );
  });

test("re-running detection UPSERTS the bill instead of accumulating one row per run",
  { skip: !HAS_DB }, async () => {
    const rows = (await db.query(
      `SELECT * FROM bank_transactions
        WHERE bank_account_id = $1 AND provider_transaction_id LIKE $2 || 'HIST%'`,
      [ACCOUNT_A, PROVIDER_PREFIX]
    )).rows;

    const first = detectRecurringBills(rows, { now: "2026-05-20" }).bills[0];
    const stored = await upsertBill(first);

    // A week later, nothing new has arrived. Detection runs again.
    const second = detectRecurringBills(rows, { now: "2026-05-27" }).bills[0];
    const restored = await upsertBill(second);

    const n = Number((await db.query(
      `SELECT count(*)::int AS n FROM recurring_bills WHERE bank_account_id = $1`, [ACCOUNT_A]
    )).rows[0].n);
    assert.equal(n, 1, "*** one subscription is one row, however often detection runs ***");
    assert.equal(restored.id, stored.id, "it is the same row, updated");
    assert.equal(
      new Date(restored.detected_as_of).toISOString(), "2026-05-27T00:00:00.000Z",
      "and it carries the clock the second run was given"
    );
    assert.equal(Number(restored.typical_amount_cents), -1599);
    assert.equal(formatDay(parseDay(restored.next_expected_on)), "2026-06-15");
  });

test("a monthly bill and an annual renewal coexist as two rows on one account",
  { skip: !HAS_DB }, async () => {
    // *** KNOWN LIMITATION, TESTED AT ITS REAL BOUNDARY. *** The detector groups
    // by (account, merchant_key), so ONE merchant descriptor yields AT MOST ONE
    // cadence. Two cadences therefore require two distinguishable descriptors —
    // which is what providers actually send for a monthly plan versus an annual
    // renewal, and it is why 086 keys on cadence as well as merchant. A merchant
    // that bills monthly AND annually under a byte-identical descriptor is
    // detected as one bill today; that gap is reported on the shared board and
    // in the module header rather than papered over here.
    for (const [i, d] of ["2024-07-04", "2025-07-04", "2026-07-04"].entries()) {
      await insertTxn({
        providerId: `ANN${i}`, amountCents: -19900, postedOn: d,
        merchant: `${MERCHANT_PREFIX} NETFLIX ANNUAL`
      });
    }
    const rows = (await db.query(
      `SELECT * FROM bank_transactions WHERE bank_account_id = $1`, [ACCOUNT_A]
    )).rows;

    const result = detectRecurringBills(rows, { now: "2026-07-20" });
    for (const bill of result.bills) await upsertBill(bill);

    const stored = (await db.query(
      `SELECT cadence, typical_amount_cents FROM recurring_bills
        WHERE bank_account_id = $1 ORDER BY cadence`, [ACCOUNT_A]
    )).rows;
    assert.deepEqual(stored.map((r) => r.cadence), ["annual", "monthly"],
      "cadence is part of the unique key precisely so this is possible");
  });

/* ========================================================================= *
 * The evidence link
 * ========================================================================= */

test("evidence links survive as rows and vanish with the transaction they point at",
  { skip: !HAS_DB }, async () => {
    const bill = (await db.query(
      `SELECT id FROM recurring_bills WHERE bank_account_id = $1 AND cadence = 'monthly'`,
      [ACCOUNT_A]
    )).rows[0];
    assert.ok(bill, "the monthly bill from the earlier test must still be here");

    const txns = (await db.query(
      `SELECT id FROM bank_transactions
        WHERE bank_account_id = $1 AND provider_transaction_id LIKE $2 || 'HIST0%'`,
      [ACCOUNT_A, PROVIDER_PREFIX]
    )).rows;

    for (const t of txns) {
      await db.query(
        `INSERT INTO recurring_bill_transactions (recurring_bill_id, bank_transaction_id)
         VALUES ($1,$2) ON CONFLICT DO NOTHING`, [bill.id, t.id]);
    }

    // The same transaction cannot be listed twice as evidence for one bill.
    const before = Number((await db.query(
      `SELECT count(*)::int AS n FROM recurring_bill_transactions WHERE recurring_bill_id = $1`,
      [bill.id]
    )).rows[0].n);
    await db.query(
      `INSERT INTO recurring_bill_transactions (recurring_bill_id, bank_transaction_id)
       VALUES ($1,$2) ON CONFLICT DO NOTHING`, [bill.id, txns[0].id]);
    const after = Number((await db.query(
      `SELECT count(*)::int AS n FROM recurring_bill_transactions WHERE recurring_bill_id = $1`,
      [bill.id]
    )).rows[0].n);
    assert.equal(after, before, "one link per (bill, transaction)");

    // Purging a transaction takes its evidence link with it. The bill's
    // occurrence_count then no longer matches the surviving evidence, which is
    // the correct signal that the bill is stale — deliberately not repaired.
    await db.query(`DELETE FROM bank_transactions WHERE id = $1`, [txns[0].id]);
    const left = Number((await db.query(
      `SELECT count(*)::int AS n FROM recurring_bill_transactions
        WHERE recurring_bill_id = $1 AND bank_transaction_id = $2`, [bill.id, txns[0].id]
    )).rows[0].n);
    assert.equal(left, 0, "an evidence link to a transaction that no longer exists is not evidence");

    const stillThere = Number((await db.query(
      `SELECT count(*)::int AS n FROM recurring_bills WHERE id = $1`, [bill.id]
    )).rows[0].n);
    assert.equal(stillThere, 1, "and the bill itself survives losing one piece of evidence");
  });

/* ========================================================================= *
 * The standing policy audit
 * ========================================================================= */

test("no stored bill anywhere claims a next date off only two occurrences",
  { skip: !HAS_DB }, async () => {
    // Write a genuine two-occurrence detection first, so this query is looking
    // at the case it exists to police rather than at an empty table.
    for (const [i, d] of ["2026-04-03", "2026-05-03"].entries()) {
      await insertTxn({
        account: ACCOUNT_B, providerId: `TWO${i}`, amountCents: -2599, postedOn: d,
        merchant: `${MERCHANT_PREFIX} TWICE`
      });
    }
    const rows = (await db.query(
      `SELECT * FROM bank_transactions WHERE bank_account_id = $1 AND merchant_name = $2`,
      [ACCOUNT_B, `${MERCHANT_PREFIX} TWICE`]
    )).rows;

    const result = detectRecurringBills(rows, { now: "2026-05-10" });
    assert.equal(result.bills.length, 0, "a two-occurrence guess is never a bill");
    const candidate = result.candidates[0];
    assert.equal(candidate.occurrenceCount, 2);
    await upsertBill(candidate);

    // Migration 086's header promises this query returns nothing for as long as
    // the detector is honest. Run it against everything in the table.
    const offenders = (await db.query(
      `SELECT id, merchant_key, next_expected_on FROM recurring_bills
        WHERE occurrence_count = 2 AND next_expected_on IS NOT NULL`
    )).rows;
    assert.deepEqual(offenders, [], "*** two occurrences must never carry a predicted date ***");

    const stored = (await db.query(
      `SELECT * FROM recurring_bills WHERE bank_account_id = $1 AND merchant_key = $2`,
      [ACCOUNT_B, candidate.merchantKey]
    )).rows[0];
    assert.equal(stored.next_expected_on, null);
    assert.equal(stored.next_expected_unknown_reason, "two_occurrences_is_a_guess_not_a_cadence");
    assert.equal(stored.confidence_label, "low");
    assert.equal(stored.is_business, null, "unknown, not false");
  });

/* ========================================================================= *
 * The writer — src/banking/store.mjs
 * ========================================================================= */

test("saveDetection writes bills, candidates and their evidence in one go",
  { skip: !HAS_DB }, async () => {
    const account = ACCOUNT_C;
    await db.query(`DELETE FROM recurring_bills WHERE bank_account_id = $1`, [account]);

    // A confident monthly bill and a two-occurrence guess, on one account.
    for (const [i, d] of ["2026-01-08", "2026-02-08", "2026-03-08", "2026-04-08"].entries()) {
      await insertTxn({
        account, providerId: `SAVE${i}`, amountCents: -8800, postedOn: d,
        merchant: `${MERCHANT_PREFIX} INSURANCE`
      });
    }
    for (const [i, d] of ["2026-03-02", "2026-04-02"].entries()) {
      await insertTxn({
        account, providerId: `SAVEG${i}`, amountCents: -4500, postedOn: d,
        merchant: `${MERCHANT_PREFIX} MAYBE`
      });
    }
    // A single charge — no cadence, so nothing to store about it.
    await insertTxn({
      account, providerId: "SAVEONE", amountCents: -777, postedOn: "2026-04-11",
      merchant: `${MERCHANT_PREFIX} ONEOFF`
    });

    const rows = (await db.query(
      `SELECT * FROM bank_transactions WHERE bank_account_id = $1`, [account]
    )).rows;
    const result = detectRecurringBills(rows, { now: "2026-04-20" });

    assert.equal(result.bills.length, 1);
    assert.equal(result.candidates.length, 1);
    assert.equal(result.rejected.length, 1);

    const summary = await saveDetection(db, result, { orgId });

    assert.equal(summary.bills, 1);
    assert.equal(summary.candidates, 1);
    assert.equal(summary.evidenceLinked, 6, "four monthly charges plus the two-occurrence pair");
    assert.equal(summary.unidentifiedEvidence, 0);
    assert.equal(summary.rejectedNotStored, 1, "the one-off is reported, not written");

    const stored = (await db.query(
      `SELECT merchant_key, confidence_label, next_expected_on, next_expected_unknown_reason
         FROM recurring_bills WHERE bank_account_id = $1 ORDER BY merchant_key`, [account]
    )).rows;
    assert.equal(stored.length, 2, "the rejected group is NOT a row");
    assert.equal(stored[0].merchant_key, merchantKeyFor("INSURANCE"));
    assert.equal(formatDay(parseDay(stored[0].next_expected_on)), "2026-05-08");
    assert.equal(stored[1].merchant_key, merchantKeyFor("MAYBE"));
    assert.equal(stored[1].confidence_label, "low");
    assert.equal(stored[1].next_expected_on, null);
    assert.equal(stored[1].next_expected_unknown_reason,
      "two_occurrences_is_a_guess_not_a_cadence");
  });

test("listRecurringBills hides the low-confidence guesses unless asked by name",
  { skip: !HAS_DB }, async () => {
    const account = ACCOUNT_C;

    const safe = await listRecurringBills(db, { orgId, bankAccountId: account });
    assert.equal(safe.length, 1, "the default answer contains no guesses");
    assert.equal(safe[0].confidence_label, "medium");

    const all = await listRecurringBills(db, {
      orgId, bankAccountId: account, presentableOnly: false
    });
    assert.equal(all.length, 2);
    assert.deepEqual(all.map((r) => r.confidence_label), ["medium", "low"],
      "ordered largest outflow first — the amounts are negative, so ASC");

    await assert.rejects(() => listRecurringBills(db, {}), /orgId is required/);
  });

test("a bill read out of the real table reaches the cash-flow projector intact",
  { skip: !HAS_DB }, async () => {
    // THE STORE/SEAM CROSSING, AGAINST REAL COLUMN TYPES. The unit version in
    // store-seam.test.mjs decodes its row with node-postgres's own type parsers;
    // this one gets the row from Postgres, so the `date` columns are Dates and
    // the bigint is a string because the DATABASE made them that way. If 086's
    // column types move under the mapping, this is what fails.
    const account = ACCOUNT_C;

    const raw = await listRecurringBills(db, { orgId, bankAccountId: account });
    const bills = await listRecurringBillsFor(db, { orgId, bankAccountId: account });
    assert.equal(bills.length, 1);

    // Read back in the detector's own vocabulary: day strings, integer cents.
    assert.equal(bills[0].nextExpectedDate, "2026-05-08");
    assert.match(bills[0].firstSeenOn, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(bills[0].typicalAmountCents, -8800);
    assert.equal(typeof bills[0].typicalAmountCents, "number", "bigint arrives as a string");

    const window = { from: "2026-05-01", to: "2026-08-31" };
    const projected = toCashflowBills({ bills }, window);
    assert.deepEqual(projected.skipped, [], "a stored bill must not vanish on the way to a screen");
    assert.deepEqual(
      projected.recurringBills[0].occurrences.map((o) => o.date),
      ["2026-05-08", "2026-06-08", "2026-07-08", "2026-08-08"]
    );
    assert.equal(projected.recurringBills[0].occurrences[0].amountCents, 8800,
      "positive magnitude — the sign flip happens in the seam and nowhere else");

    // And the raw rows, which look like the same thing, project nothing at all.
    const rawProjected = toCashflowBills({ bills: raw }, window);
    assert.deepEqual(rawProjected.recurringBills, [],
      "*** snake_case rows fed straight to the projector lose every bill, silently ***");
  });

test("getBillEvidence returns the actual charges behind a stored bill",
  { skip: !HAS_DB }, async () => {
    const account = ACCOUNT_C;
    const bill = (await db.query(
      `SELECT id FROM recurring_bills WHERE bank_account_id = $1 AND merchant_key = $2`,
      [account, merchantKeyFor("INSURANCE")]
    )).rows[0];

    const evidence = await getBillEvidence(db, bill.id);

    assert.equal(evidence.length, 4);
    assert.deepEqual(
      evidence.map((t) => formatDay(parseDay(t.posted_on))),
      ["2026-01-08", "2026-02-08", "2026-03-08", "2026-04-08"]
    );
    for (const t of evidence) assert.equal(Number(t.amount_cents), -8800);
  });

test("re-saving replaces evidence rather than accumulating it", { skip: !HAS_DB }, async () => {
  const account = ACCOUNT_C;
  const rows = (await db.query(
    `SELECT * FROM bank_transactions WHERE bank_account_id = $1`, [account]
  )).rows;

  await saveDetection(db, detectRecurringBills(rows, { now: "2026-04-21" }), { orgId });
  await saveDetection(db, detectRecurringBills(rows, { now: "2026-04-22" }), { orgId });

  const bills = Number((await db.query(
    `SELECT count(*)::int AS n FROM recurring_bills WHERE bank_account_id = $1`, [account]
  )).rows[0].n);
  const links = Number((await db.query(
    `SELECT count(*)::int AS n FROM recurring_bill_transactions l
       JOIN recurring_bills b ON b.id = l.recurring_bill_id
      WHERE b.bank_account_id = $1`, [account]
  )).rows[0].n);

  assert.equal(bills, 2, "three runs, two bills");
  assert.equal(links, 6, "*** evidence is replaced, not appended ***");
});

test("saveDetection can be told to store only the confident set", { skip: !HAS_DB }, async () => {
  const account = ACCOUNT_D;
  for (const [i, d] of ["2026-02-05", "2026-03-05"].entries()) {
    await insertTxn({
      account, providerId: `ONLY${i}`, amountCents: -3300, postedOn: d,
      merchant: `${MERCHANT_PREFIX} ONLYGUESS`
    });
  }
  const rows = (await db.query(
    `SELECT * FROM bank_transactions WHERE bank_account_id = $1`, [account]
  )).rows;
  const result = detectRecurringBills(rows, { now: "2026-03-10" });
  assert.equal(result.candidates.length, 1);

  const summary = await saveDetection(db, result, { orgId, includeCandidates: false });

  assert.equal(summary.candidates, 0);
  const n = Number((await db.query(
    `SELECT count(*)::int AS n FROM recurring_bills WHERE bank_account_id = $1`, [account]
  )).rows[0].n);
  assert.equal(n, 0);
  await db.query(`DELETE FROM recurring_bills WHERE bank_account_id = $1`, [account]);
});

test("saveDetection refuses to write without an org — tenancy is the caller's to assert",
  { skip: !HAS_DB }, async () => {
    await assert.rejects(
      () => saveDetection(db, { bills: [], candidates: [] }, {}),
      /orgId is required/
    );
  });

test("one org cannot read another org's bills", { skip: !HAS_DB }, async () => {
  // The unit test can only prove the WHERE clause was SENT. This proves it
  // actually isolates, against real rows in a real table — the distinction
  // AUDIT-FINDINGS' tenancy findings turn on.
  const otherOrg = (await db.query(
    `INSERT INTO orgs (slug, name) VALUES ($1,$2) RETURNING id`,
    [OTHER_ORG_SLUG, "W7 pg test other org"]
  )).rows[0].id;

  try {
    const mine = await listRecurringBills(db, { orgId, bankAccountId: ACCOUNT_C });
    assert.ok(mine.length > 0, "this org has bills on that account");

    const theirs = await listRecurringBills(db, { orgId: otherOrg, bankAccountId: ACCOUNT_C });
    assert.deepEqual(theirs, [], "*** the same account id, a different org, zero rows ***");

    const theirsUnfiltered = await listRecurringBills(db, {
      orgId: otherOrg, bankAccountId: ACCOUNT_C, presentableOnly: false
    });
    assert.deepEqual(theirsUnfiltered, [],
      "asking for the guesses too must not open a way around the org boundary");
  } finally {
    await db.query(`DELETE FROM orgs WHERE slug = $1`, [OTHER_ORG_SLUG]);
  }
});

test("every stored bill obeys the invariants its migration promises",
  { skip: !HAS_DB }, async () => {
    const bad = (await db.query(
      `SELECT id,
              (typical_amount_cents >= 0)                                    AS not_an_outflow,
              ((next_expected_on IS NULL) = (next_expected_unknown_reason IS NULL))
                                                                             AS incoherent_date,
              (confidence_pct NOT BETWEEN 0 AND 100)                         AS bad_confidence,
              (occurrence_count < 2)                                         AS not_recurring,
              (last_seen_on < first_seen_on)                                 AS backwards_window
         FROM recurring_bills`
    )).rows.filter((r) => Object.values(r).some((v) => v === true));
    assert.deepEqual(bad, []);
  });
