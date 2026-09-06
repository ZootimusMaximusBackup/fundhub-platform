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

/* ── one client, one bureau, one open case ─────────────────────────────────
 * Measured 2026-09-06 on the funding walkthrough client: four inquiries, SEVEN
 * open cases. Three made at 03:06 when the deposit was paid, three more at
 * 11:20 once a funding round existed — the same three bureaus, twice. Had they
 * been sent, every bureau would have had the same dispute letter posted to it
 * twice.
 */
import { createCase } from "./cases.mjs";

const CLIENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ROUND = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function caseDb(existing) {
  return {
    inserts: [],
    updates: [],
    async query(sql, params) {
      const s = String(sql).replace(/\s+/g, " ");
      if (s.startsWith("SELECT * FROM inquiry_removal_cases")) return { rows: existing };
      if (s.includes("INSERT INTO inquiry_removal_cases")) {
        this.inserts.push(params);
        return { rows: [{ id: "new-case", selected_bureaus_raw: params[5] }] };
      }
      if (s.includes("UPDATE inquiry_removal_cases")) {
        this.updates.push(params);
        const row = existing.find((c) => c.id === params[0]) || {};
        return { rows: [{ ...row, funding_round_id: params[1] }] };
      }
      return { rows: [] };
    }
  };
}

test("createCase adopts the open case for that bureau instead of making a second one", async () => {
  const db = caseDb([
    { id: "case-ex", client_id: CLIENT, selected_bureaus_raw: "EX", funding_round_id: null }
  ]);
  const out = await createCase(db, {
    orgId: ORG,
    row: { client_id: CLIENT, selected_bureaus_raw: "EX", funding_round_id: ROUND }
  });
  assert.equal(db.inserts.length, 0, "a second Experian case was inserted");
  assert.equal(out.id, "case-ex");
  assert.equal(out.reused, true);
  assert.equal(out.funding_round_id, ROUND, "the open case takes the round it did not have");
});

test("createCase does not reopen the round on a case that already has one", async () => {
  const db = caseDb([
    { id: "case-ex", client_id: CLIENT, selected_bureaus_raw: "EX", funding_round_id: "older" }
  ]);
  const out = await createCase(db, {
    orgId: ORG,
    row: { client_id: CLIENT, selected_bureaus_raw: "EX", funding_round_id: ROUND }
  });
  assert.equal(db.updates.length, 0);
  assert.equal(out.funding_round_id, "older");
});

test("createCase still opens a case for a bureau that has none", async () => {
  const db = caseDb([
    { id: "case-ex", client_id: CLIENT, selected_bureaus_raw: "EX", funding_round_id: null }
  ]);
  await createCase(db, {
    orgId: ORG,
    row: { client_id: CLIENT, selected_bureaus_raw: "TU" }
  });
  assert.equal(db.inserts.length, 1, "TransUnion is a different bureau and needs its own case");
});

test("createCase never folds a case that names no bureau into one that does", async () => {
  const db = caseDb([
    { id: "case-ex", client_id: CLIENT, selected_bureaus_raw: "EX", funding_round_id: null }
  ]);
  await createCase(db, { orgId: ORG, row: { client_id: CLIENT } });
  assert.equal(db.inserts.length, 1, "we cannot tell what a bureau-less case is for — do not guess");
});

test("createCase reads bureaus as a set, so 'EQ/EX' is the same case as 'EX, EQ'", async () => {
  const db = caseDb([
    { id: "case-both", client_id: CLIENT, selected_bureaus_raw: "EQ/EX", funding_round_id: null }
  ]);
  const out = await createCase(db, {
    orgId: ORG,
    row: { client_id: CLIENT, selected_bureaus_raw: "EX, EQ" }
  });
  assert.equal(db.inserts.length, 0);
  assert.equal(out.id, "case-both");
});

test("createCase: adopting carries the item count the caller had just counted", async () => {
  const db = caseDb([
    { id: "case-ex", client_id: CLIENT, selected_bureaus_raw: "EX",
      funding_round_id: null, case_status: "Blocked", open_inquiry_count: 0 }
  ]);
  await createCase(db, {
    orgId: ORG,
    row: { client_id: CLIENT, selected_bureaus_raw: "EX", case_status: "Queued", open_inquiry_count: 2 }
  });
  assert.equal(db.inserts.length, 0);
  assert.equal(db.updates.length, 1, "the open case is refreshed, not left stale");
  assert.ok(db.updates[0].includes(2), "the new item count is written");
  assert.ok(db.updates[0].includes("Queued"), "and the gate's fresh verdict with it");
});

test("createCase never writes a sent case back to Queued", async () => {
  const db = caseDb([
    { id: "case-ex", client_id: CLIENT, selected_bureaus_raw: "EX",
      funding_round_id: null, case_status: "In Progress", open_inquiry_count: 2 }
  ]);
  await createCase(db, {
    orgId: ORG,
    row: { client_id: CLIENT, selected_bureaus_raw: "EX", case_status: "Queued" }
  });
  assert.equal(db.inserts.length, 0);
  assert.equal(db.updates.length, 0,
    "a letter already in the mail must never be re-offered as ready to send");
});
