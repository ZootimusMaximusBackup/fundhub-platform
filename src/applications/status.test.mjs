import test from "node:test";
import assert from "node:assert/strict";
import { setApplicationStatus, ApplicationStatusError } from "./status.mjs";

function stubDb(row) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (/UPDATE applications/i.test(sql) && /RETURNING/i.test(sql)) {
        return { rows: [{ ...row, status: params[2], lender_table: row.lender_table || null }] };
      }
      if (/INSERT INTO application_decisions/i.test(sql)) {
        return { rows: [{ id: "d1" }] };
      }
      return { rows: [] };
    }
  };
}

test("setApplicationStatus rejects unknown status", async () => {
  await assert.rejects(
    () => setApplicationStatus({}, { orgId: "o", applicationId: "a", status: "Nope" }),
    (err) => err instanceof ApplicationStatusError && err.code === "invalid_status"
  );
});

test("setApplicationStatus writes decision audit row", async () => {
  const db = stubDb({
    id: "app-1",
    lender_name: "Bank",
    lender_table: "OnlineBizCC",
    bank: "Bank"
  });
  const row = await setApplicationStatus(db, {
    orgId: "11111111-1111-4111-8111-111111111111",
    applicationId: "22222222-2222-4222-8222-222222222222",
    status: "Approved",
    staff: { name: "Advisor" }
  });
  assert.equal(row.status, "Approved");
  assert.ok(db.calls.some((c) => /INSERT INTO application_decisions/i.test(c.sql)));
  const decision = db.calls.find((c) => /INSERT INTO application_decisions/i.test(c.sql));
  assert.equal(decision.params[3], "Approved");
  assert.equal(decision.params[5], "Advisor");
});
