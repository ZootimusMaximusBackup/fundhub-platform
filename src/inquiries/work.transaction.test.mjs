// The transaction guard, tested against the handle production actually passes.
//
// work.test.mjs proves the transactional SHAPE — BEGIN, the row lock, COMMIT,
// ROLLBACK on failure — but it proves it with a stub that implements connect().
// Every production caller passes `db` from src/db.mjs, which is `{ query }` and
// nothing else. The probe this file guards is the one that decides which of
// those two worlds a write lands in, and the stub with connect() can never
// exercise it. So this file passes the real exported singleton.
//
// The defect being pinned: `if (typeof db.connect !== "function") return fn(db)`
// is always true for `{ query }`, so the three writes inside logAttempt ran with
// autocommit. A failure between them left the attempt row committed and the
// recomputed counter not — the screen shows two attempts and the audit table
// holds three, on a consumer's credit-dispute record.
//
// No database is needed to ask the question. Point DATABASE_URL at a port
// nothing listens on: acquiring a dedicated connection must FAIL, and the write
// must fail with it. If instead the shared handle is asked to run the statements
// itself, the write is unprotected — and that is what this test catches.

import { test, after } from "node:test";
import assert from "node:assert";

import { db as sharedDb, close } from "../db.mjs";
import { logAttempt } from "./work.mjs";

// Set before anything can build the pool: src/db.mjs reads DATABASE_URL lazily,
// inside pool(), so this lands ahead of the first call.
process.env.DATABASE_URL = "postgres://nobody:nothing@127.0.0.1:1/unreachable";
process.env.PG_CONNECT_TIMEOUT_MS = "1000";

const INQUIRY = "11111111-1111-4111-8111-111111111111";
const STAFF = "22222222-2222-4222-8222-222222222222";
const ORG = "33333333-3333-4333-8333-333333333333";
const CLIENT = "44444444-4444-4444-8444-444444444444";

after(async () => { await close(); });

/* Replaces the singleton's own query() with a recorder that answers every shape
   logAttempt needs, so the unprotected path would run to a clean success. That
   is deliberate: the failure this test must produce is "the write happened
   outside a transaction", not "the fake ran out of rows". */
function watchSharedHandle() {
  const issued = [];
  const original = sharedDb.query;
  sharedDb.query = async (sql, params = []) => {
    issued.push(String(sql).replace(/\s+/g, " ").trim());
    if (/INSERT INTO staff_events/.test(sql)) return { rows: [{ id: "ev-1" }] };
    if (/FROM shifts/.test(sql)) return { rows: [] };
    if (/FOR UPDATE/.test(sql)) return { rows: [{ id: INQUIRY, org_id: ORG }] };
    if (/RETURNING/.test(sql)) {
      return { rows: [{ id: INQUIRY, org_id: ORG, client_id: CLIENT, call_attempts: 1 }] };
    }
    return { rows: [] };
  };
  return { issued, restore: () => { sharedDb.query = original; } };
}

test("logAttempt given the shared production handle never writes through it", async () => {
  const watch = watchSharedHandle();
  let error = null;
  try {
    await logAttempt(sharedDb, { inquiryId: INQUIRY, staffId: STAFF, kind: "call" });
  } catch (e) {
    error = e;
  } finally {
    watch.restore();
  }

  const wrote = watch.issued.filter((sql) => /inquiry_attempts|inquiry_log/.test(sql));
  assert.deepEqual(wrote, [],
    "the attempt and the counter were issued straight through the shared handle, " +
    "which autocommits each statement separately — a half-applied write is reachable");

  assert.ok(error,
    "with no connection obtainable the write must fail; a success here means it " +
    "quietly ran unprotected");
});
