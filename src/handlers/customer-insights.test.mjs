import { test } from "node:test";
import assert from "node:assert/strict";
import { clearHandlers, getHandlers } from "../events/registry.mjs";
import {
  register,
  onRoundFundedInsights,
  onPaidMidCheckin,
  SOURCE_WORKFLOW,
  TASK_TITLE,
  ASSIGNEE_ROLE,
  MID_SOURCE_WORKFLOW,
  MID_TASK_TITLE,
  MID_DUE_DAYS,
  interviewTaskBody
} from "./customer-insights.mjs";

function fakeDb({ existingTasks = [] } = {}) {
  const tasks = [...existingTasks];
  let n = 0;
  return {
    tasks,
    async query(sql, params) {
      if (/FROM clients WHERE org_id/.test(sql)) {
        return { rows: [{ id: "client-1", ghl_contact_id: "ghl-1" }] };
      }
      if (/SELECT id FROM tasks/.test(sql)) {
        const [clientId, workflow, key] = params;
        const byTitle = /title =/.test(sql);
        const hit = tasks.find((t) =>
          t.client_id === clientId
          && t.source_workflow === workflow
          && (byTitle ? t.title === key : t.body === key)
        );
        return { rows: hit ? [{ id: hit.id }] : [] };
      }
      if (/INSERT INTO tasks/.test(sql)) {
        const [org_id, client_id, title, body, due_at, source_workflow, assignee_role] = params;
        const row = {
          id: `task-${++n}`, org_id, client_id, title, body, due_at,
          source_workflow, assignee_role
        };
        tasks.push(row);
        return { rows: [{ id: row.id }] };
      }
      return { rows: [] };
    }
  };
}

test("register wires funded interview and paid mid check-in", () => {
  clearHandlers();
  register();
  assert.ok(getHandlers("round.funded").includes(onRoundFundedInsights));
  assert.ok(getHandlers("deposit.paid").includes(onPaidMidCheckin));
  assert.ok(getHandlers("sale.closed").includes(onPaidMidCheckin));
});

test("funded round creates a Google Meet interview task for the funding advisor", async () => {
  const db = fakeDb();
  const res = await onRoundFundedInsights(
    { id: "evt-funded-1", orgId: "org-1", clientId: "client-1", payload: {} },
    db
  );
  assert.equal(res.created, true);
  const task = db.tasks[0];
  assert.equal(task.title, TASK_TITLE);
  assert.equal(task.assignee_role, ASSIGNEE_ROLE);
  assert.equal(task.source_workflow, SOURCE_WORKFLOW);
  assert.match(task.body, /Google Meet/);
  assert.match(task.body, /What almost stopped you/);
  assert.match(task.body, /\[event:evt-funded-1\]/);
});

test("same funded event twice does not make a second task", async () => {
  const body = interviewTaskBody("evt-funded-1");
  const db = fakeDb({
    existingTasks: [{
      id: "task-existing",
      client_id: "client-1",
      source_workflow: SOURCE_WORKFLOW,
      body
    }]
  });
  const res = await onRoundFundedInsights(
    { id: "evt-funded-1", orgId: "org-1", clientId: "client-1", payload: {} },
    db
  );
  assert.equal(res.created, false);
  assert.equal(db.tasks.length, 1);
});

test("no client means no task", async () => {
  const db = {
    async query() { return { rows: [] }; }
  };
  const res = await onRoundFundedInsights(
    { id: "evt-x", orgId: "org-1", payload: {} },
    db
  );
  assert.equal(res.created, false);
  assert.equal(res.reason, "no_client");
});

test("deposit.paid creates a mid check-in due in a week, not a Google Meet", async () => {
  const db = fakeDb();
  const before = Date.now();
  const res = await onPaidMidCheckin(
    { id: "evt-deposit-1", orgId: "org-1", clientId: "client-1", payload: {} },
    db
  );
  assert.equal(res.created, true);
  const task = db.tasks[0];
  assert.equal(task.title, MID_TASK_TITLE);
  assert.equal(task.source_workflow, MID_SOURCE_WORKFLOW);
  assert.equal(task.assignee_role, ASSIGNEE_ROLE);
  assert.match(task.body, /not a Google Meet/);
  assert.match(task.body, /hardest part/);
  assert.doesNotMatch(task.body, /Book a Google Meet/);
  const due = task.due_at instanceof Date ? task.due_at.getTime() : Date.parse(task.due_at);
  const week = MID_DUE_DAYS * 24 * 60 * 60 * 1000;
  assert.ok(due >= before + week - 2000);
  assert.ok(due <= Date.now() + week + 2000);
});

test("sale.closed does not make a second mid check-in for the same client", async () => {
  const db = fakeDb({
    existingTasks: [{
      id: "task-mid",
      client_id: "client-1",
      source_workflow: MID_SOURCE_WORKFLOW,
      title: MID_TASK_TITLE,
      body: "already"
    }]
  });
  const res = await onPaidMidCheckin(
    { id: "evt-sale-1", orgId: "org-1", clientId: "client-1", payload: {} },
    db
  );
  assert.equal(res.created, false);
  assert.equal(db.tasks.length, 1);
});
