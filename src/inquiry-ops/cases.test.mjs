/* listCases — the Specialist's inquiry-removal queue.
 *
 * Two things about this reader decide what the desk sees, and both of them were
 * wrong until 2026-08-30:
 *
 *   1. IT ORDERED NEWEST FIRST. With a LIMIT, the rows that fall off the end are
 *      the OLDEST — exactly the cases the desk exists to clear. The one nobody
 *      had touched sank out of sight while the one just worked jumped to the top.
 *   2. IT REPORTED NO SIZE. The screen counted its headline over whatever page it
 *      happened to get, so past the limit the number silently under-reported. A
 *      queue count that is short on the busiest day is worse than no count.
 *
 * A stub database, so this runs in the unit phase rather than skipping without
 * DATABASE_URL. What is asserted is the SQL this function builds and the shape it
 * returns, which is exactly what those two bugs lived in.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { listCases } from "./cases.mjs";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function fakeDb(rows) {
  return {
    calls: [],
    async query(sql, params) {
      this.calls.push({ sql, params });
      return { rows };
    }
  };
}

test("listCases orders oldest first, so a LIMIT keeps the cases that matter", async () => {
  const db = fakeDb([]);
  await listCases(db, { orgId: ORG });
  const sql = db.calls[0].sql;
  assert.match(sql, /ORDER BY c\.requested_at ASC NULLS LAST, c\.created_at ASC/);
  assert.ok(
    !/ORDER BY c\.requested_at DESC/.test(sql),
    "the queue is ordered newest first again — the oldest cases fall off the LIMIT"
  );
});

test("listCases returns the size of the whole queue beside the page", async () => {
  const db = fakeDb([
    { id: "a", queue_total: "143", open_inquiry_count: 2 },
    { id: "b", queue_total: "143", open_inquiry_count: null }
  ]);
  const out = await listCases(db, { orgId: ORG, limit: 2 });
  assert.match(db.calls[0].sql, /COUNT\(\*\) OVER \(\) AS queue_total/);
  assert.equal(out.total, 143);
  assert.equal(out.cases.length, 2);
  // the window column is an implementation detail and must not reach the screen
  assert.ok(!("queue_total" in out.cases[0]), "queue_total leaked onto a case row");
  assert.equal(out.cases[0].id, "a");
});

test("listCases: an empty page from the top of the queue is honestly zero", async () => {
  const out = await listCases(fakeDb([]), { orgId: ORG });
  assert.equal(out.total, 0);
  assert.deepEqual(out.cases, []);
});

test("listCases: a database that returns no count falls back to what it can see", async () => {
  // Never NaN on a screen. The page length is a true statement about the rows in
  // hand, which is the most this can honestly claim when the window is missing.
  const out = await listCases(fakeDb([{ id: "a" }]), { orgId: ORG });
  assert.equal(out.total, 1);
});

test("listCases still binds the org and the active-status filter", async () => {
  const db = fakeDb([]);
  await listCases(db, { orgId: ORG });
  assert.equal(db.calls[0].params[0], ORG);
  assert.match(db.calls[0].sql, /c\.org_id = \$1::uuid/);
  assert.ok(db.calls[0].params[1].includes("Queued"));
  assert.ok(!db.calls[0].params[1].includes("Completed"));
});
