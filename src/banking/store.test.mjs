// Unit tests for the recurring-bill writer.
//
// *** WHAT THIS FAKE IS ALLOWED TO ASSERT, AND WHAT IT IS NOT. ***
//
// AUDIT-FINDINGS' first lesson: "A fake that models the schema you wish you had
// cannot fail when the schema moves." The 031_invoices failure survived for
// months behind exactly such a fake — an in-memory stub that stored `amount`
// and asserted on `amount`, while the real column had been renamed.
//
// So the fake below stores NOTHING and models NO SCHEMA. It records the SQL it
// was handed and the parameters that came with it, and returns a canned row.
// That confines it to questions of the form "what did we send, and in what
// order" — control flow, transaction boundaries, which arrays get written and
// which do not, what gets filtered out on the way.
//
// Every claim about what the DATABASE does with any of it — the columns exist,
// the upsert key is real, the CHECKs fire, the cascade cascades — lives in
// recurring.pg.test.mjs against real Postgres, and nowhere else. If a test here
// ever starts asserting a stored value, it has become the fake that cannot fail.

import { test } from "node:test";
import assert from "node:assert";

import {
  saveDetection,
  upsertRecurringBill,
  replaceEvidence,
  listRecurringBills,
  getBillEvidence
} from "./store.mjs";
import { db as sharedDb, close as closeDb } from "../db.mjs";

const ORG = "44444444-4444-4444-8444-444444444444";
const ACCOUNT = "11111111-1111-4111-8111-111111111111";

/** A detected bill, in the shape detectRecurringBills() emits. */
function bill(overrides = {}) {
  return {
    bankAccountId: ACCOUNT,
    clientId: null,
    merchantKey: "NETFLIX",
    merchantDisplay: "NETFLIX.COM",
    cadence: "monthly",
    typicalAmountCents: -1599,
    nextExpectedDate: "2026-04-15",
    nextExpectedUnknownReason: null,
    confidencePct: 70,
    confidenceLabel: "medium",
    isBusiness: null,
    occurrenceCount: 3,
    firstSeenOn: "2026-01-15",
    lastSeenOn: "2026-03-15",
    detectedAsOf: "2026-03-20T00:00:00.000Z",
    evidenceTransactionIds: ["t-1", "t-2", "t-3"],
    ...overrides
  };
}

/**
 * Records calls. Stores nothing, models nothing. `failOn` makes the nth
 * matching statement throw, so the rollback path is reachable without a
 * database.
 */
function recorder({ transactional = true, failOnSql = null } = {}) {
  const calls = [];
  const handle = {
    query(sql, params) {
      calls.push({ sql: String(sql).replace(/\s+/g, " ").trim(), params });
      if (failOnSql && String(sql).includes(failOnSql)) {
        return Promise.reject(new Error("boom"));
      }
      return Promise.resolve({ rows: [{ id: `row-${calls.length}` }] });
    }
  };
  if (transactional) {
    handle.connect = () => Promise.resolve({
      query: handle.query,
      release() { calls.push({ sql: "RELEASE", params: null }); }
    });
  }
  return { handle, calls, verbs: () => calls.map((c) => c.sql.split(" ")[0]) };
}

const sqlsMatching = (calls, needle) => calls.filter((c) => c.sql.includes(needle));

/* ========================================================================= *
 * Tenancy
 * ========================================================================= */

test("every write and read demands an org — tenancy is never inferred", async () => {
  const { handle, calls } = recorder();

  await assert.rejects(() => saveDetection(handle, { bills: [] }, {}), /orgId is required/);
  await assert.rejects(() => saveDetection(handle, { bills: [] }), /orgId is required/);
  await assert.rejects(() => listRecurringBills(handle, {}), /orgId is required/);
  await assert.rejects(() => upsertRecurringBill(handle, bill(), {}), /orgId is required/);

  assert.deepEqual(calls, [], "nothing may reach the database before the org is known");
});

test("the org written is the caller's, never one read off a detected bill", async () => {
  const { handle, calls } = recorder({ transactional: false });
  // A bill carrying a hostile org_id-shaped field. It must be ignored.
  await upsertRecurringBill(handle, { ...bill(), orgId: "99999999-9999-4999-8999-999999999999" },
    { orgId: ORG });

  const insert = sqlsMatching(calls, "INSERT INTO recurring_bills")[0];
  assert.ok(insert.params.includes(ORG));
  assert.ok(!insert.params.includes("99999999-9999-4999-8999-999999999999"));
});

/* ========================================================================= *
 * What is written and what is not
 * ========================================================================= */

test("rejected groups and excluded rows are never written", async () => {
  const { handle, calls } = recorder();

  const summary = await saveDetection(handle, {
    bills: [bill()],
    candidates: [],
    rejected: [{ merchantKey: "ONEOFF", reason: "single_occurrence_is_not_recurring" }],
    excluded: [{ index: 0, reason: "inflow_not_an_outflow" }]
  }, { orgId: ORG });

  assert.equal(sqlsMatching(calls, "INSERT INTO recurring_bills").length, 1,
    "one bill, one insert — the rejected group is not a row");
  assert.equal(summary.rejectedNotStored, 1);
  assert.equal(summary.excludedNotStored, 1);
  // Nothing anywhere in the sent parameters mentions the rejected merchant.
  assert.ok(!calls.some((c) => (c.params ?? []).includes("ONEOFF")));
});

test("candidates are stored by default, and can be turned off by name", async () => {
  const result = {
    bills: [bill()],
    candidates: [bill({ merchantKey: "GYM", confidenceLabel: "low", confidencePct: 42 })],
    rejected: [], excluded: []
  };

  const withGuesses = recorder();
  const s1 = await saveDetection(withGuesses.handle, result, { orgId: ORG });
  assert.equal(sqlsMatching(withGuesses.calls, "INSERT INTO recurring_bills").length, 2);
  assert.equal(s1.candidates, 1);

  const confidentOnly = recorder();
  const s2 = await saveDetection(confidentOnly.handle, result,
    { orgId: ORG, includeCandidates: false });
  assert.equal(sqlsMatching(confidentOnly.calls, "INSERT INTO recurring_bills").length, 1);
  assert.equal(s2.candidates, 0);
  assert.ok(!confidentOnly.calls.some((c) => (c.params ?? []).includes("GYM")));
});

test("the upsert never overwrites the columns that identify the row", async () => {
  const { handle, calls } = recorder({ transactional: false });
  await upsertRecurringBill(handle, bill(), { orgId: ORG });

  const sql = sqlsMatching(calls, "INSERT INTO recurring_bills")[0].sql;
  const doUpdate = sql.slice(sql.indexOf("DO UPDATE SET"));

  assert.ok(sql.includes("ON CONFLICT (bank_account_id, merchant_key, cadence)"),
    "the key migration 086 declares");
  for (const identity of ["org_id =", "bank_account_id =", "merchant_key =", "cadence ="]) {
    assert.ok(!doUpdate.includes(identity), `${identity} must not be in the update set`);
  }
  for (const mutable of ["typical_amount_cents =", "confidence_pct =", "next_expected_on =",
    "detected_as_of =", "updated_at ="]) {
    assert.ok(doUpdate.includes(mutable), `${mutable} must be refreshed on re-detection`);
  }
});

test("a re-detection carries the evaluation instant, not the write time", async () => {
  const { handle, calls } = recorder({ transactional: false });
  await upsertRecurringBill(handle, bill({ detectedAsOf: "2026-05-27T00:00:00.000Z" }),
    { orgId: ORG });

  const insert = sqlsMatching(calls, "INSERT INTO recurring_bills")[0];
  assert.ok(insert.params.includes("2026-05-27T00:00:00.000Z"));
  assert.ok(!insert.sql.includes("detected_as_of = now()"), "never the clock");
});

/* ========================================================================= *
 * Evidence
 * ========================================================================= */

test("evidence is replaced, not appended — the delete comes first", async () => {
  const { handle, calls } = recorder({ transactional: false });

  const out = await replaceEvidence(handle, "bill-1", ["t-1", "t-2"]);

  assert.deepEqual(calls.map((c) => c.sql.split(" ")[0]), ["DELETE", "INSERT"]);
  assert.deepEqual(calls[1].params, ["bill-1", ["t-1", "t-2"]]);
  assert.equal(out.linked, 2);
  assert.equal(out.unidentified, 0);
});

test("evidence the detector could not name is dropped and COUNTED, never silently skipped",
  async () => {
    const { handle, calls } = recorder({ transactional: false });

    const out = await replaceEvidence(handle, "bill-1", ["t-1", null, "", undefined, "t-2"]);

    assert.equal(out.linked, 2);
    assert.equal(out.unidentified, 3, "*** the absence is the finding ***");
    assert.deepEqual(calls[1].params[1], ["t-1", "t-2"], "no nulls reach the insert");
  });

test("a bill with no identifiable evidence still clears the old links", async () => {
  const { handle, calls } = recorder({ transactional: false });

  const out = await replaceEvidence(handle, "bill-1", [null, null]);

  assert.deepEqual(calls.map((c) => c.sql.split(" ")[0]), ["DELETE"],
    "the delete must still run, or stale evidence outlives the answer that cited it");
  assert.equal(out.linked, 0);
  assert.equal(out.unidentified, 2);
});

test("saveDetection reports unidentified evidence up to the caller", async () => {
  const { handle } = recorder();
  const summary = await saveDetection(handle, {
    bills: [bill({ evidenceTransactionIds: ["t-1", null, null] })],
    candidates: [], rejected: [], excluded: []
  }, { orgId: ORG });

  assert.equal(summary.evidenceLinked, 1);
  assert.equal(summary.unidentifiedEvidence, 2);
});

/* ========================================================================= *
 * The transaction boundary
 * ========================================================================= */

test("a bill and its evidence are written inside one transaction", async () => {
  const { handle, calls } = recorder();

  await saveDetection(handle, { bills: [bill()], candidates: [], rejected: [], excluded: [] },
    { orgId: ORG });

  const verbs = calls.map((c) => c.sql.split(" ")[0]);
  assert.equal(verbs[0], "BEGIN");
  assert.equal(verbs[verbs.length - 2], "COMMIT");
  assert.equal(verbs[verbs.length - 1], "RELEASE");
  assert.ok(verbs.includes("INSERT") && verbs.includes("DELETE"));
});

test("a failure part-way through rolls the whole detection back", async () => {
  // A bill that lands with no evidence behind it is worse than no bill: it is
  // indistinguishable from a well-evidenced one at every call site that does
  // not join.
  const { handle, calls } = recorder({ failOnSql: "recurring_bill_transactions" });

  await assert.rejects(
    () => saveDetection(handle, { bills: [bill()], candidates: [], rejected: [], excluded: [] },
      { orgId: ORG }),
    /boom/
  );

  const verbs = calls.map((c) => c.sql.split(" ")[0]);
  assert.ok(verbs.includes("ROLLBACK"), "the partial write must not survive");
  assert.ok(!verbs.includes("COMMIT"));
  assert.equal(verbs[verbs.length - 1], "RELEASE", "the connection is always returned");
});

test("a handle with no connect() still runs, so the path is not database-only", async () => {
  // Same fallback as withTransaction() in src/inquiries/work.mjs.
  const { handle, calls } = recorder({ transactional: false });

  const summary = await saveDetection(handle,
    { bills: [bill()], candidates: [], rejected: [], excluded: [] }, { orgId: ORG });

  assert.equal(summary.bills, 1);
  assert.ok(!calls.some((c) => c.sql === "BEGIN"));
});

/* THE HANDLE PRODUCTION ACTUALLY PASSES. The fallback above is for a plain fake
   in a unit test. Every real caller passes `db` from src/db.mjs, which is
   `{ query }` and nothing else — so a probe of the form "no connect(), run it
   inline" sends the LIVE path down the fallback, and saveDetection deletes a
   bill's supporting charges and re-inserts them with no transaction around the
   pair. A failure in between leaves a bill asserting a monthly charge with
   nothing behind it.

   No database is needed to ask this. DATABASE_URL points at a port nothing
   listens on, so acquiring a dedicated connection must fail — and the write must
   fail with it, rather than quietly running through the shared handle. */
test("saveDetection given the shared production handle never writes through it", async () => {
  process.env.DATABASE_URL = "postgres://nobody:nothing@127.0.0.1:1/unreachable";
  process.env.PG_CONNECT_TIMEOUT_MS = "1000";

  const issued = [];
  const original = sharedDb.query;
  sharedDb.query = async (sql) => {
    issued.push(String(sql).replace(/\s+/g, " ").trim());
    return { rows: [{ id: "bill-1" }] };
  };

  let error = null;
  try {
    await saveDetection(sharedDb,
      { bills: [bill()], candidates: [], rejected: [], excluded: [] }, { orgId: ORG });
  } catch (e) {
    error = e;
  } finally {
    sharedDb.query = original;
    await closeDb();
  }

  assert.deepEqual(issued, [],
    "the bill upsert and the evidence swap were issued straight through the shared " +
    "handle, which autocommits each statement separately");
  assert.ok(error,
    "with no connection obtainable the write must fail; a success here means it ran " +
    "unprotected");
});

/* ========================================================================= *
 * Reads
 * ========================================================================= */

test("listRecurringBills hides low-confidence guesses unless asked by name", async () => {
  const safe = recorder({ transactional: false });
  await listRecurringBills(safe.handle, { orgId: ORG });
  assert.equal(safe.calls[0].params[3], true, "presentableOnly defaults to true");

  const all = recorder({ transactional: false });
  await listRecurringBills(all.handle, { orgId: ORG, presentableOnly: false });
  assert.equal(all.calls[0].params[3], false);
  assert.ok(all.calls[0].sql.includes("confidence_label IN ('medium', 'high')"),
    "the filter is in the query, not left to the caller to remember");
});

test("listRecurringBills filters are optional and are passed as parameters, never interpolated",
  async () => {
    const { handle, calls } = recorder({ transactional: false });
    await listRecurringBills(handle, { orgId: ORG, bankAccountId: ACCOUNT, clientId: "c-1" });

    assert.deepEqual(calls[0].params, [ORG, ACCOUNT, "c-1", true, 500]);
    assert.ok(!calls[0].sql.includes(ORG), "no value is interpolated into the SQL");
    assert.ok(calls[0].sql.includes("ORDER BY typical_amount_cents ASC"),
      "amounts are negative, so ASC is largest outflow first");

    // BOUNDED. The result has no natural bound — one row per account x merchant
    // x cadence across every client — and there was no LIMIT and no page size to
    // turn down. A company with 3,000 clients averaging 12 bills each is 36,000
    // rows read, sorted and serialised inside a 10-second function budget.
    assert.ok(calls[0].sql.includes("LIMIT $5"),
      "*** the read is bounded and the bound is a parameter, not interpolated ***");

    // MUTATION-CHECKED. Asserting the PARAMETERS alone survived replacing
    // `WHERE org_id = $1` with a no-op predicate that still bound $1 — the
    // tenancy filter could be deleted and every param assertion above stayed
    // green. The clause itself has to be asserted.
    assert.ok(calls[0].sql.includes("WHERE org_id = $1"),
      "*** the org filter is the tenancy boundary and must be in the WHERE clause ***");
  });

test("getBillEvidence joins to the transactions and orders them oldest first", async () => {
  const { handle, calls } = recorder({ transactional: false });
  await getBillEvidence(handle, "bill-1");

  assert.deepEqual(calls[0].params, ["bill-1"]);
  assert.ok(calls[0].sql.includes("JOIN bank_transactions"));
  assert.ok(calls[0].sql.includes("ORDER BY t.posted_on ASC"));
});

/* ========================================================================= *
 * Refusals
 * ========================================================================= */

test("saveDetection refuses something that is not a detection result", async () => {
  const { handle } = recorder();
  for (const junk of [null, undefined, "bills", 42]) {
    await assert.rejects(() => saveDetection(handle, junk, { orgId: ORG }),
      /expected a detectRecurringBills\(\) result/);
  }
});

test("an inflow cannot be written as a bill, even by a caller bypassing the detector", async () => {
  // The last line of defence before migration 086's recurring_bills_outflow_ck.
  const { handle, calls } = recorder({ transactional: false });
  await assert.rejects(
    () => upsertRecurringBill(handle, bill({ typicalAmountCents: 1599 }), { orgId: ORG }),
    /must be an outflow/
  );
  assert.deepEqual(calls, [], "it never reaches the database");
});

test("a detection with nothing in it writes nothing and says so", async () => {
  const { handle, calls } = recorder();
  const summary = await saveDetection(handle,
    { bills: [], candidates: [], rejected: [], excluded: [] }, { orgId: ORG });

  assert.deepEqual(summary, {
    bills: 0, candidates: 0, evidenceLinked: 0, unidentifiedEvidence: 0,
    rejectedNotStored: 0, excludedNotStored: 0
  });
  assert.ok(!calls.some((c) => c.sql.startsWith("INSERT")));
});
