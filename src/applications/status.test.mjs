import test from "node:test";
import assert from "node:assert/strict";
import { setApplicationStatus, logBankDecision, listClientDecisionPlays, ApplicationStatusError } from "./status.mjs";

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
  assert.equal(decision.params[7], null);
});

test("setApplicationStatus stamps a play name on the yes/no row", async () => {
  const db = stubDb({
    id: "app-1",
    lender_name: "Bank",
    lender_table: "OnlineBizCC",
    bank: "Bank"
  });
  await setApplicationStatus(db, {
    orgId: "11111111-1111-4111-8111-111111111111",
    applicationId: "22222222-2222-4222-8222-222222222222",
    status: "Denied",
    playName: "Card stacking first pull",
    staff: { name: "Advisor" }
  });
  const decision = db.calls.find((c) => /INSERT INTO application_decisions/i.test(c.sql));
  assert.equal(decision.params[3], "Denied");
  assert.equal(decision.params[7], "Card stacking first pull");
});

test("logBankDecision reuses an existing application for the lender", async () => {
  const db = {
    calls: [],
    async query(sql, params) {
      this.calls.push({ sql, params });
      if (/FROM applications/i.test(sql) && /lender_id/i.test(sql)) {
        return { rows: [{ id: "app-existing" }] };
      }
      if (/UPDATE applications/i.test(sql) && /RETURNING/i.test(sql)) {
        return { rows: [{ id: "app-existing", status: params[2], lender_table: "OnlineBizCC" }] };
      }
      if (/INSERT INTO application_decisions/i.test(sql)) {
        return { rows: [{ id: "d1" }] };
      }
      return { rows: [] };
    }
  };
  const row = await logBankDecision(db, {
    orgId: "11111111-1111-4111-8111-111111111111",
    clientId: "33333333-3333-4333-8333-333333333333",
    lenderId: "44444444-4444-4444-8444-444444444444",
    status: "Approved",
    playName: "In-branch visit",
    staff: { name: "Advisor" }
  });
  assert.equal(row.id, "app-existing");
  const decision = db.calls.find((c) => /INSERT INTO application_decisions/i.test(c.sql));
  assert.equal(decision.params[7], "In-branch visit");
});

test("listClientDecisionPlays reads named plays for a client", async () => {
  const db = {
    async query(sql, params) {
      assert.match(sql, /application_decisions/);
      assert.match(sql, /a\.client_id/);
      assert.match(sql, /d\.play_name/);
      assert.equal(params[1], "33333333-3333-4333-8333-333333333333");
      return {
        rows: [{
          play_name: "DeskWalk CardStack 0826",
          status: "Denied",
          lender_id: "44444444-4444-4444-8444-444444444444",
          lender_name: "American Express"
        }]
      };
    }
  };
  const rows = await listClientDecisionPlays(db, {
    orgId: "11111111-1111-4111-8111-111111111111",
    clientId: "33333333-3333-4333-8333-333333333333"
  });
  assert.equal(rows[0].play_name, "DeskWalk CardStack 0826");
});

/* ── How much the bank approved ──────────────────────────────────────────────
   "Bank yes" used to record only that a bank said yes, never for how much, so
   applications.approved_amount stayed empty. That column is what the Pipeline
   board reads back to suggest a funded amount
   (src/funding/card-stacking-rounds.mjs sumApprovedApplications), so an
   approval with no dollars on it left the Funded move with nothing to answer.

   The rule these pin: a MISSING amount stays missing. It must never be written
   as 0 — a zero says the bank approved nothing, which is a different and false
   claim (docs/CLOSEOUT-FEE-BASIS.md). */

function bankDecisionDb() {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (/SELECT id FROM applications/i.test(sql)) {
        return { rows: [{ id: "app-existing" }] };
      }
      if (/UPDATE applications/i.test(sql) && /RETURNING/i.test(sql)) {
        return { rows: [{ id: "app-existing", status: params[2], lender_table: null }] };
      }
      return { rows: [] };
    }
  };
}

function updateCall(db) {
  return db.calls.find((c) => /UPDATE applications/i.test(c.sql) && /RETURNING/i.test(c.sql));
}

const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "33333333-3333-4333-8333-333333333333";
const LENDER = "44444444-4444-4444-8444-444444444444";

test("logBankDecision writes approved_amount as fixed 2dp dollars", async () => {
  const db = bankDecisionDb();
  await logBankDecision(db, {
    orgId: ORG, clientId: CLIENT, lenderId: LENDER,
    status: "Approved",
    approvedAmount: "$45,000"
  });
  const up = updateCall(db);
  assert.match(up.sql, /approved_amount = \$/);
  assert.ok(up.params.includes("45000.00"), `params were ${JSON.stringify(up.params)}`);
});

test("logBankDecision round-trips cents without float drift", async () => {
  // 450.10 * 100 is 45009.999999999996 in JavaScript. If this ever comes back
  // "450.09", the money path started multiplying again.
  const db = bankDecisionDb();
  await logBankDecision(db, {
    orgId: ORG, clientId: CLIENT, lenderId: LENDER,
    status: "Approved",
    approvedAmount: "450.10"
  });
  assert.ok(updateCall(db).params.includes("450.10"));
});

test("a missing approved amount does not touch the column at all", async () => {
  for (const missing of [undefined, null, "", "   "]) {
    const db = bankDecisionDb();
    await logBankDecision(db, {
      orgId: ORG, clientId: CLIENT, lenderId: LENDER,
      status: "Approved",
      approvedAmount: missing
    });
    const up = updateCall(db);
    assert.ok(
      !/approved_amount/.test(up.sql),
      `blank ${JSON.stringify(missing)} must leave approved_amount alone, got: ${up.sql}`
    );
    assert.ok(
      !up.params.includes(0) && !up.params.includes("0.00"),
      "an unknown amount must never be written as zero"
    );
  }
});

test("logBankDecision refuses an amount that is not a real amount", async () => {
  for (const bad of ["abc", "-500", "0", "0.00", "45000.999", "4.5.6", "45k"]) {
    const db = bankDecisionDb();
    await assert.rejects(
      () => logBankDecision(db, {
        orgId: ORG, clientId: CLIENT, lenderId: LENDER,
        status: "Approved",
        approvedAmount: bad
      }),
      (err) => err instanceof ApplicationStatusError && err.code === "invalid_approved_amount",
      `${bad} should have been refused`
    );
    assert.equal(db.calls.length, 0, `${bad} must be refused before any row is written`);
  }
});

test("a denial ignores any amount and writes no approved_amount", async () => {
  const db = bankDecisionDb();
  await logBankDecision(db, {
    orgId: ORG, clientId: CLIENT, lenderId: LENDER,
    status: "Denied"
  });
  assert.ok(!/approved_amount/.test(updateCall(db).sql));
});
