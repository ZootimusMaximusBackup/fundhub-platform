// The writer for detected recurring bills. The ONLY thing in this repository
// that inserts into `recurring_bills` or `recurring_bill_transactions`.
//
// *** WHY THIS FILE EXISTS AT ALL. ***
//
// AUDIT-FINDINGS' single most expensive entry is 031_invoices.sql: a migration
// renamed three columns, `src/invoices/index.mjs` was never updated, and
// `createInvoice()` — the only writer of the table — threw SQLSTATE 42703 on
// every call. The unit tests stayed green for months because they ran against
// an in-memory fake that still modelled the pre-rename columns. Two whole
// workflows died mid-run and nobody noticed.
//
// The first version of this thread shipped without this file, and the
// consequence was exactly the setup for that failure: the INSERT lived in
// `recurring.pg.test.mjs`, hand-rolled. A mapping that lives in a test is a
// mapping that drifts, because a test is the last place anybody looks when a
// column moves. So the write path is code now, `toBillRow()` in recurring.mjs
// is the one place the column names are spelled, and the pg test calls this
// module instead of writing its own SQL. When 086's columns move, ONE file
// changes and the pg test fails loudly if it did not.
//
//
// PURITY BOUNDARY. `recurring.mjs` is pure — no db, no clock, no I/O — and it
// stays that way. This file is the impure half, deliberately separated so that
// the detection logic can never grow a database call by accident. Everything
// here takes a `db` handle as its first argument and reads no module-level
// state.
//
//
// TENANCY IS THE CALLER'S TO ASSERT. `orgId` is a required parameter and is
// NEVER read off a detected bill or a transaction row. This is the same rule
// src/mail/responses.mjs follows (org comes from the record, never from the
// caller's payload), pointed the other way: here the caller holds the
// authenticated org and the detector holds only arithmetic, so the caller is
// the authority. A detector that could name its own org_id would be a tenancy
// bypass one bad row away.
//
//
// WHAT GETS STORED, AND WHAT DOES NOT.
//
//   result.bills       -> stored. Medium/high confidence.
//   result.candidates  -> stored BY DEFAULT. Low confidence.
//   result.rejected    -> NEVER stored. No usable cadence was found, so there
//                         is no cadence, amount or window to write. There is
//                         nothing to store, not merely something unflattering.
//   result.excluded    -> NEVER stored. These are individual input rows, not
//                         detections.
//
// STORING A LOW-CONFIDENCE CANDIDATE IS NOT THE SAME AS PRESENTING IT AS A
// BILL. The row carries `confidence_label = 'low'` and, by 086's CHECK, a
// `next_expected_unknown_reason` instead of a date; and
// `idx_recurring_bills_due_confident` is partial on medium/high, so a
// projection reading through that index cannot page a guess into a cash-flow
// number by accident. Keeping the low-confidence rows is what makes "this
// merchant looked like a bill and here is why we did not call it one" an
// answerable question rather than a silent absence. Pass
// `includeCandidates: false` if a caller genuinely wants only the confident set.

import { db as sharedDb, pool } from "../db.mjs";

/* ------------------------------------------------------------------------- *
 * Transaction helper
 *
 * A real transaction, which took catching to get right. The broken probe
 * `if (typeof db.connect !== "function")` was always true for the shared handle
 * (db = { query }, no connect), so writes ran unprotected with autocommit in
 * production. Fixed by checking db.connect directly, reaching for pool() if db
 * is the shared singleton, and only then falling back to inline execution for a
 * plain fake in a unit test. See src/finance/soft-pulls.mjs:502.
 * ------------------------------------------------------------------------- */

async function withTransaction(db, fn) {
  const acquire = typeof db?.connect === "function"
    ? () => db.connect()
    : (db === sharedDb ? () => pool().connect() : null);
  if (!acquire) return fn(db);
  const client = await acquire();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

import { toBillRow, fromBillRow } from "./recurring.mjs";

/* ------------------------------------------------------------------------- *
 * Writes
 * ------------------------------------------------------------------------- */

/**
 * Upsert one detected bill.
 *
 * ON CONFLICT (bank_account_id, merchant_key, cadence) DO UPDATE — the key
 * migration 086 declares. Detection is not an event, it is a standing
 * inference that gets recomputed; without the upsert, running it weekly would
 * leave fifty-two rows for one subscription and any SUM over the table would
 * report a client's outgoings at fifty-two times their true value.
 *
 * org_id, bank_account_id, merchant_key and cadence are NOT in the update set:
 * they are the row's identity. Everything else is the current answer and is
 * overwritten wholesale, including `detected_as_of`, which must track the
 * `now` the detector was given rather than the write time.
 *
 * @returns the stored row.
 */
export async function upsertRecurringBill(db, bill, { orgId }) {
  const row = toBillRow(bill, { orgId });
  const cols = Object.keys(row);
  const IDENTITY = new Set(["org_id", "bank_account_id", "merchant_key", "cadence"]);
  const updates = cols.filter((c) => !IDENTITY.has(c)).map((c) => `${c} = EXCLUDED.${c}`);

  const res = await db.query(
    `INSERT INTO recurring_bills (${cols.join(", ")})
     VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})
     ON CONFLICT (bank_account_id, merchant_key, cadence)
     DO UPDATE SET ${updates.join(", ")}, updated_at = now()
     RETURNING *`,
    cols.map((c) => row[c])
  );
  return res.rows[0];
}

/**
 * Replace a bill's evidence links with exactly this set.
 *
 * REPLACE, NOT APPEND. Re-detection recomputes which transactions support a
 * bill, and appending would leave links from a previous run that the current
 * answer no longer stands behind — evidence that outlives the reasoning that
 * cited it. A bill's evidence should always be readable as "the transactions
 * behind THIS answer", not "everything ever associated with this merchant".
 *
 * Ids the detector could not name are dropped and COUNTED, never silently
 * skipped: a detection run over rows that carry no primary key (a caller
 * passing synthetic rows, or a SELECT that omitted `id`) produces a bill with
 * no evidence, and that is worth knowing rather than discovering later from an
 * empty join.
 *
 * @returns {{ linked: number, unidentified: number }}
 */
export async function replaceEvidence(db, recurringBillId, transactionIds) {
  const ids = (transactionIds ?? []).filter((id) => typeof id === "string" && id !== "");
  const unidentified = (transactionIds ?? []).length - ids.length;

  await db.query(
    `DELETE FROM recurring_bill_transactions WHERE recurring_bill_id = $1`,
    [recurringBillId]
  );
  if (ids.length > 0) {
    // unnest() so this is one statement whatever the length — a bill with two
    // years of monthly evidence should not be twenty-four round trips.
    await db.query(
      `INSERT INTO recurring_bill_transactions (recurring_bill_id, bank_transaction_id)
       SELECT $1, x FROM unnest($2::uuid[]) AS x
       ON CONFLICT DO NOTHING`,
      [recurringBillId, ids]
    );
  }
  return { linked: ids.length, unidentified };
}

/**
 * Persist a whole detection run: every bill and (by default) every candidate,
 * each with its evidence, in ONE transaction.
 *
 * WHY ONE TRANSACTION. A bill and the transactions that justify it are a single
 * claim. Half-writing it — the bill lands, the evidence does not — produces a
 * row that asserts a client pays $54.99 a month with nothing behind it, which
 * is worse than not writing it at all: it is indistinguishable from a
 * well-evidenced bill at every call site that does not join.
 *
 * `result` is exactly what detectRecurringBills() returned. Nothing else about
 * it is inspected — `rejected` and `excluded` are deliberately not persisted;
 * see the header.
 *
 * @returns {{ bills: number, candidates: number, evidenceLinked: number,
 *             unidentifiedEvidence: number, rejectedNotStored: number,
 *             excludedNotStored: number }}
 */
export async function saveDetection(db, result, { orgId, includeCandidates = true } = {}) {
  if (!orgId) throw new TypeError("saveDetection: orgId is required");
  if (!result || typeof result !== "object") {
    throw new TypeError("saveDetection: expected a detectRecurringBills() result");
  }

  const toStore = [
    ...(result.bills ?? []),
    ...(includeCandidates ? (result.candidates ?? []) : [])
  ];

  return withTransaction(db, async (tx) => {
    let evidenceLinked = 0;
    let unidentifiedEvidence = 0;

    for (const bill of toStore) {
      const stored = await upsertRecurringBill(tx, bill, { orgId });
      const ev = await replaceEvidence(tx, stored.id, bill.evidenceTransactionIds);
      evidenceLinked += ev.linked;
      unidentifiedEvidence += ev.unidentified;
    }

    return {
      bills: (result.bills ?? []).length,
      candidates: includeCandidates ? (result.candidates ?? []).length : 0,
      evidenceLinked,
      unidentifiedEvidence,
      rejectedNotStored: (result.rejected ?? []).length,
      excludedNotStored: (result.excluded ?? []).length
    };
  });
}

/* ------------------------------------------------------------------------- *
 * Reads
 * ------------------------------------------------------------------------- */

/**
 * Read stored bills for one org, newest-largest first.
 *
 * `presentableOnly` defaults to TRUE, and that default is the point. A caller
 * that has not thought about confidence gets only the medium/high rows — the
 * ones safe to show a person as a bill. Seeing the low-confidence guesses
 * requires passing `presentableOnly: false`, which is a deliberate act with a
 * name attached to it. This is the same shape as the split between
 * `result.bills` and `result.candidates` in the detector, carried through to
 * the read side so it cannot be lost in between.
 *
 * Ordered by typical_amount_cents ASC — the amounts are negative, so ascending
 * is largest outflow first, which is the order a person reading a list of their
 * own bills wants.
 *
 * BOUNDED. `limit` defaults to 500 and is capped at 2000. The result has no
 * natural bound — one row per account × merchant × cadence across every client —
 * so a company with 3,000 clients averaging 12 bills each is 36,000 rows read,
 * sorted and serialised inside a 10-second function budget. An unbounded read
 * with no page size is not a read anybody can turn down.
 *
 * RETURNS RAW DATABASE ROWS, in snake_case. Anything feeding the cash-flow
 * projector wants listRecurringBillsFor() below instead — the two vocabularies
 * are not interchangeable and mixing them fails silently. See fromBillRow().
 */
export async function listRecurringBills(
  db,
  { orgId, bankAccountId = null, clientId = null, presentableOnly = true, limit = 500 } = {}
) {
  if (!orgId) throw new TypeError("listRecurringBills: orgId is required");

  const n = Number.parseInt(limit, 10);
  const capped = !Number.isFinite(n) || n <= 0 ? 500 : Math.min(n, 2000);

  const res = await db.query(
    `SELECT * FROM recurring_bills
      WHERE org_id = $1
        AND ($2::uuid IS NULL OR bank_account_id = $2)
        AND ($3::uuid IS NULL OR client_id = $3)
        AND ($4 = false OR confidence_label IN ('medium', 'high'))
      ORDER BY typical_amount_cents ASC, merchant_key ASC
      LIMIT $5`,
    [orgId, bankAccountId, clientId, presentableOnly, capped]
  );
  return res.rows;
}

/**
 * The same read, in the vocabulary every consumer of a bill actually speaks.
 *
 * THIS IS THE ONE THAT CROSSES THE STORE/SEAM LINE. listRecurringBills() hands
 * back raw snake_case rows; src/banking/cashflow-seam.mjs reads camelCase and
 * one field is renamed outright (`next_expected_on` -> `nextExpectedDate`).
 * Feeding raw rows to the projector threw nothing and produced a client with no
 * bills at all — see fromBillRow() for the full account.
 *
 * Takes the same options, returns the same rows, mapped once through the one
 * place the mapping is written.
 */
export async function listRecurringBillsFor(db, opts = {}) {
  const rows = await listRecurringBills(db, opts);
  return rows.map(fromBillRow);
}

/**
 * The transactions behind one stored bill, oldest first.
 *
 * This is the "show me the four charges that made you say this" read. It is the
 * reason the evidence link is a join table rather than a uuid[] column, and it
 * is what a human uses to check a detected bill by hand before trusting it.
 */
export async function getBillEvidence(db, recurringBillId) {
  const res = await db.query(
    `SELECT t.*
       FROM recurring_bill_transactions l
       JOIN bank_transactions t ON t.id = l.bank_transaction_id
      WHERE l.recurring_bill_id = $1
      ORDER BY t.posted_on ASC, t.provider_transaction_id ASC`,
    [recurringBillId]
  );
  return res.rows;
}
