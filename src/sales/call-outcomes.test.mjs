import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BELIEFS,
  normalizeBelief,
  normalizeOutcome,
  OUTCOMES
} from "../sales/beliefs.mjs";
import {
  CallOutcomeError,
  logCallOutcome,
  resolveCashCollected,
  presentOutcome
} from "../sales/call-outcomes.mjs";

test("beliefs: seven Cole Gordon beliefs", () => {
  assert.deepEqual(BELIEFS, ["pain", "doubt", "cost", "desire", "money", "support", "trust"]);
});

test("normalizeBelief: none and empty become null; unknown is undefined", () => {
  assert.equal(normalizeBelief("none"), null);
  assert.equal(normalizeBelief(""), null);
  assert.equal(normalizeBelief("desire"), "desire");
  assert.equal(normalizeBelief("nope"), undefined);
});

test("normalizeOutcome: accepts spaces and underscores", () => {
  assert.equal(normalizeOutcome("no show"), "no_show");
  assert.equal(normalizeOutcome("deposit"), "deposit");
  assert.equal(normalizeOutcome("bogus"), undefined);
  assert.ok(OUTCOMES.includes("not_a_fit"));
});

function stubDb(handlers = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      for (const [re, fn] of handlers) {
        if (re.test(sql)) return fn(params, sql);
      }
      return { rows: [] };
    }
  };
}

test("resolveCashCollected: non-deposit outcomes are zero", async () => {
  const db = stubDb();
  const r = await resolveCashCollected(db, {
    orgId: "o", clientId: "c", outcome: "callback"
  });
  assert.equal(r.cashCollectedCents, 0);
  assert.equal(db.calls.length, 0);
});

test("resolveCashCollected: reads amount from paid transaction", async () => {
  const db = stubDb([
    [/FROM transactions/, () => ({ rows: [{ id: "tx1", amount_paid: "3000.00" }] })]
  ]);
  const r = await resolveCashCollected(db, {
    orgId: "11111111-1111-4111-8111-111111111111",
    clientId: "22222222-2222-4222-8222-222222222222",
    outcome: "deposit"
  });
  assert.equal(r.cashCollectedCents, 300000);
  assert.equal(r.transactionId, "tx1");
});

test("logCallOutcome: refuses typed cash by never reading amount from input", async () => {
  const org = "11111111-1111-4111-8111-111111111111";
  const client = "22222222-2222-4222-8222-222222222222";
  const staff = "33333333-3333-4333-8333-333333333333";
  const db = stubDb([
    [/FROM clients/, () => ({ rows: [{ id: client }] })],
    [/FROM transactions/, () => ({ rows: [{ id: "tx1", amount_paid: 2000 }] })],
    [/INSERT INTO call_outcomes/, (params) => ({
      rows: [{
        id: "out1", org_id: org, client_id: client, staff_id: staff,
        outcome: "deposit", belief_failed: "desire",
        cash_collected_cents: params[7], transaction_id: params[8],
        logged_at: new Date().toISOString()
      }]
    })]
  ]);
  const { row, created } = await logCallOutcome(db, {
    orgId: org, clientId: client, staffId: staff,
    outcome: "deposit", beliefFailed: "desire",
    // caller tries to pass cash — ignored; module only takes transactionId
    amount: 999999
  });
  assert.equal(created, true);
  assert.equal(row.cash_collected_cents, 200000);
  const presented = presentOutcome(row);
  assert.equal(presented.belief_failed, "desire");
  assert.match(presented.belief_label, /Desire/);
});

test("logCallOutcome: checklist is stored and returned, unchecked boxes are false not missing", async () => {
  const org = "11111111-1111-4111-8111-111111111111";
  const client = "22222222-2222-4222-8222-222222222222";
  const staff = "33333333-3333-4333-8333-333333333333";
  let notes;
  const db = stubDb([
    [/FROM clients/, () => ({ rows: [{ id: client }] })],
    [/INSERT INTO call_outcomes/, (params) => {
      notes = params[11];
      return {
        rows: [{
          id: "out1", org_id: org, client_id: client, staff_id: staff,
          outcome: "callback", belief_failed: null,
          cash_collected_cents: 0, notes
        }]
      };
    }]
  ]);
  const { row } = await logCallOutcome(db, {
    orgId: org, clientId: client, staffId: staff,
    outcome: "callback",
    checklist: { call_recorded: true, personal_guarantee: false }
  });
  assert.match(String(notes), /checklist:/);
  const presented = presentOutcome(row);
  assert.equal(presented.checklist.call_recorded, true);
  assert.equal(presented.checklist.personal_guarantee, false);
  assert.equal(presented.checklist.month_14_cliff, false);
  assert.equal(presented.checklist.bank_decides, false);
});

test("logCallOutcome: bad outcome throws CallOutcomeError", async () => {
  await assert.rejects(
    () => logCallOutcome(stubDb(), {
      orgId: "11111111-1111-4111-8111-111111111111",
      clientId: "22222222-2222-4222-8222-222222222222",
      staffId: "33333333-3333-4333-8333-333333333333",
      outcome: "maybe"
    }),
    (e) => e instanceof CallOutcomeError && e.status === 400
  );
});
