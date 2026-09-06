import { test } from "node:test";
import assert from "node:assert";
import {
  onPaymentDisputed,
  onPaymentRefunded,
  parseDueBy,
  DISPUTE_ROLE
} from "./commas-disputes.mjs";

/* Fake db. The client already exists, so resolveClient takes its lookup branch
   and never touches the CRM — these tests are about the task, not about client
   creation, which client-lifecycle.test.mjs already covers. */
function fakeDb({ existingTasks = [] } = {}) {
  const tasks = [...existingTasks];
  let n = 0;
  return {
    tasks,
    async query(sql, params) {
      if (/FROM clients WHERE org_id/.test(sql)) {
        return { rows: [{ id: "client-1", ghl_contact_id: "crm-1" }] };
      }
      if (/SELECT id FROM tasks/.test(sql)) {
        const [clientId, workflow, body] = params;
        const hit = tasks.find(
          (t) => t.client_id === clientId && t.source_workflow === workflow && t.body === body
        );
        return { rows: hit ? [{ id: hit.id }] : [] };
      }
      if (/INSERT INTO tasks/.test(sql)) {
        const [org_id, client_id, title, body, due_at, source_workflow, assignee_role] = params;
        const row = {
          id: `task-${++n}`, org_id, client_id, title, body, due_at, source_workflow, assignee_role
        };
        tasks.push(row);
        return { rows: [{ id: row.id }] };
      }
      return { rows: [] };
    }
  };
}

const disputeEvent = (payload = {}) => ({
  id: "evt-dispute-1",
  name: "payment.disputed",
  orgId: "org-1",
  payload: {
    email: "angry@example.com",
    amount: 3000,
    productName: "Consulting Services Deposit",
    paymentId: "pay_disputed_1",
    dueBy: "2026-08-20T00:00:00Z",
    source: "commas",
    ...payload
  }
});

// --- the deadline ----------------------------------------------------------

test("parseDueBy reads a real date and refuses to invent one", () => {
  assert.equal(parseDueBy("2026-08-20T00:00:00Z").toISOString(), "2026-08-20T00:00:00.000Z");
  assert.equal(parseDueBy(null), null);
  assert.equal(parseDueBy(""), null);
  assert.equal(parseDueBy("not a date"), null, "an unreadable deadline must not become a guessed one");
});

test("a dispute becomes an URGENT task carrying the provider's deadline", async () => {
  const db = fakeDb();
  const res = await onPaymentDisputed(disputeEvent(), db);

  assert.equal(res.created, true);
  const task = db.tasks[0];
  assert.match(task.title, /^URGENT/, "a chargeback must read as urgent in a task list");
  assert.match(task.title, /\$3,000\.00/);
  assert.equal(task.assignee_role, DISPUTE_ROLE);
  assert.equal(task.source_workflow, "commas-dispute");
  assert.equal(task.client_id, "client-1");
  assert.equal(
    task.due_at.toISOString(),
    "2026-08-20T00:00:00.000Z",
    "the response deadline did not reach the task — this is how a dispute is lost by default"
  );
  assert.match(task.body, /pay_disputed_1/);
});

test("no deadline from the processor => no due date, and the task SAYS so", async () => {
  const db = fakeDb();
  await onPaymentDisputed(disputeEvent({ dueBy: null }), db);
  const task = db.tasks[0];
  assert.equal(task.due_at, null, "an invented deadline reads as 'there is time' until the money is gone");
  assert.match(task.body, /NO DEADLINE WAS SUPPLIED/);
});

test("an unreadable amount does not produce a task claiming $0", async () => {
  const db = fakeDb();
  await onPaymentDisputed(disputeEvent({ amount: null }), db);
  assert.match(db.tasks[0].title, /an unknown amount/);
  assert.ok(!db.tasks[0].title.includes("$0.00"), "a missing amount was reported as zero");
});

// --- idempotency -----------------------------------------------------------

test("the same dispute event twice creates ONE task", async () => {
  const db = fakeDb();
  const first = await onPaymentDisputed(disputeEvent(), db);
  const second = await onPaymentDisputed(disputeEvent(), db);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(db.tasks.length, 1);
});

// --- refunds ---------------------------------------------------------------

test("a refund creates its own task and never touches commission", async () => {
  const db = fakeDb();
  const res = await onPaymentRefunded({
    id: "evt-refund-1",
    name: "payment.refunded",
    orgId: "org-1",
    payload: {
      email: "refunded@example.com",
      amount: 1000,
      productName: "Consulting Services Package",
      paymentId: "pay_ref_1",
      source: "commas"
    }
  }, db);

  assert.equal(res.created, true);
  const task = db.tasks[0];
  assert.equal(task.source_workflow, "commas-refund");
  assert.match(task.title, /^Refund issued/);
  assert.ok(!/URGENT/.test(task.title), "a refund is not a deadline-bearing emergency");
  /* The money rule, asserted in the task text because that is where a human
     reads it: clawback policy is undecided, so nothing was reversed. */
  assert.match(task.body, /NOT adjusted/);
});

test("a dispute and a refund on the SAME payment are two separate tasks", async () => {
  const db = fakeDb();
  await onPaymentDisputed(disputeEvent(), db);
  await onPaymentRefunded({
    id: "evt-refund-2", name: "payment.refunded", orgId: "org-1",
    payload: { email: "angry@example.com", amount: 3000, paymentId: "pay_disputed_1" }
  }, db);
  assert.equal(db.tasks.length, 2);
  assert.deepEqual(
    db.tasks.map((t) => t.source_workflow).sort(),
    ["commas-dispute", "commas-refund"]
  );
});
