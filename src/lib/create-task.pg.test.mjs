// Postgres-backed tests for createTask — the single task-creation helper.
// Skipped without DATABASE_URL, like the other *.pg.test.mjs files.

import { test, before, beforeEach, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { createTask, TASK_ROLES } from "./create-task.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const WF = "test-wf-createtask";

describe("createTask", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, clientId, otherClientId, staffId;

  before(async () => {
    org = (await db.query(`SELECT id FROM orgs WHERE is_default LIMIT 1`)).rows[0].id;
    clientId = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name)
       VALUES ($1,'Task','Fixture') RETURNING id`, [org])).rows[0].id;
    otherClientId = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name)
       VALUES ($1,'Other','Fixture') RETURNING id`, [org])).rows[0].id;
    staffId = (await db.query(
      `INSERT INTO staff (org_id, email, name, role, status)
       VALUES ($1,'createtask-fixture@x.io','Fixture','closer','active') RETURNING id`,
      [org])).rows[0].id;
  });

  beforeEach(async () => {
    await db.query(`DELETE FROM tasks WHERE source_workflow = $1`, [WF]);
  });

  after(async () => {
    await db.query(`DELETE FROM tasks WHERE source_workflow = $1`, [WF]);
    await db.query(`DELETE FROM clients WHERE id = ANY($1)`, [[clientId, otherClientId]]);
    await db.query(`DELETE FROM staff WHERE id = $1`, [staffId]);
    await close();
  });

  const spec = (over = {}) => ({
    orgId: org, clientId, title: "Do the thing",
    sourceWorkflow: WF, assigneeRole: "funding_advisor",
    eventId: "11111111-1111-1111-1111-111111111111", ...over
  });

  const rows = async () => (await db.query(
    `SELECT * FROM tasks WHERE source_workflow = $1 ORDER BY created_at`, [WF])).rows;

  test("creates a task carrying the owning role", async () => {
    const r = await createTask(db, spec());
    assert.equal(r.created, true);
    assert.ok(r.id);

    const [row] = await rows();
    assert.equal(row.assignee_role, "funding_advisor");
    assert.equal(row.assignee_staff_id, null, "a new task is unclaimed");
    assert.equal(row.title, "Do the thing");
    assert.equal(row.done, false);
    assert.equal(row.assignee, null, "the dead text column stays unused");
  });

  // ── the rule that makes this unit worth doing ──

  test("a missing role is a hard error, not a silent NULL", async () => {
    await assert.rejects(
      () => createTask(db, spec({ assigneeRole: undefined })),
      /assigneeRole is required/
    );
    assert.equal((await rows()).length, 0, "nothing should have been written");
  });

  test("a principal type can never own internal work", async () => {
    for (const bad of ["client", "affiliate", "partner"]) {
      await assert.rejects(
        () => createTask(db, spec({ assigneeRole: bad })),
        /not an employee role/,
        bad
      );
    }
    assert.equal((await rows()).length, 0);
  });

  test("an unknown role is rejected before it reaches the database", async () => {
    await assert.rejects(() => createTask(db, spec({ assigneeRole: "vp_sales" })),
      /not an employee role/);
  });

  test("the role is folded, so 'Funding_Advisor ' still resolves", async () => {
    const r = await createTask(db, spec({ assigneeRole: " Funding_Advisor " }));
    assert.equal(r.created, true);
    assert.equal((await rows())[0].assignee_role, "funding_advisor");
  });

  test("every role the helper accepts is accepted by the database CHECK", async () => {
    // Catches the map and the constraint drifting apart.
    let i = 0;
    for (const role of TASK_ROLES) {
      const r = await createTask(db, spec({
        assigneeRole: role, eventId: `2222222${i}-1111-1111-1111-111111111111`
      }));
      assert.equal(r.created, true, role);
      i += 1;
    }
    assert.equal((await rows()).length, TASK_ROLES.size);
  });

  // ── idempotency: per event, which is what the standing rule asks for ──

  test("the same event twice is one row", async () => {
    const a = await createTask(db, spec());
    const b = await createTask(db, spec());
    assert.equal(a.created, true);
    assert.equal(b.created, false);
    assert.equal(b.reason, "duplicate_event");
    assert.equal(b.id, a.id);
    assert.equal((await rows()).length, 1);
  });

  test("two DIFFERENT events for one client are two rows — work is not dropped", async () => {
    // The behaviour that keying on title would have destroyed: a client on a
    // second round must get a second task, same title and all.
    await createTask(db, spec({ eventId: "33333333-1111-1111-1111-111111111111" }));
    await createTask(db, spec({ eventId: "44444444-1111-1111-1111-111111111111" }));
    const all = await rows();
    assert.equal(all.length, 2);
    assert.equal(all[0].title, all[1].title, "same title, two occurrences");
  });

  test("dedupeOn:'title' is available and does collapse repeats", async () => {
    await createTask(db, spec({ eventId: "55555555-1111-1111-1111-111111111111",
      dedupeOn: "title" }));
    const b = await createTask(db, spec({ eventId: "66666666-1111-1111-1111-111111111111",
      dedupeOn: "title" }));
    assert.equal(b.created, false);
    assert.equal(b.reason, "duplicate_title");
    assert.equal((await rows()).length, 1);
  });

  test("the same event for two different clients is two rows", async () => {
    await createTask(db, spec());
    await createTask(db, spec({ clientId: otherClientId }));
    assert.equal((await rows()).length, 2);
  });

  test("an explicit body wins and becomes the dedupe value", async () => {
    const a = await createTask(db, spec({ body: "explicit detail" }));
    const b = await createTask(db, spec({ body: "explicit detail" }));
    assert.equal(a.created, true);
    assert.equal(b.created, false);
    assert.equal((await rows())[0].body, "explicit detail");
  });

  test("the unique index absorbs a concurrent insert of the same event", async () => {
    // Both calls race past the SELECT; the index has to be what saves it.
    const s = spec({ eventId: "77777777-1111-1111-1111-111111111111" });
    const [a, b] = await Promise.all([createTask(db, s), createTask(db, s)]);
    const created = [a, b].filter((r) => r.created).length;
    assert.equal(created, 1, `expected exactly one insert, got ${created}`);
    assert.equal((await rows()).length, 1);
    const loser = [a, b].find((r) => !r.created);
    assert.ok(["duplicate_event", "duplicate_race"].includes(loser.reason), loser.reason);
  });

  // ── required arguments ──

  test("orgId, title and sourceWorkflow are all required", async () => {
    await assert.rejects(() => createTask(db, spec({ orgId: null })), /orgId is required/);
    await assert.rejects(() => createTask(db, spec({ title: "" })), /title is required/);
    await assert.rejects(() => createTask(db, spec({ sourceWorkflow: null })),
      /sourceWorkflow is required/);
  });

  test("dueAt and an explicit assignee are stored", async () => {
    const when = new Date("2026-09-01T12:00:00Z");
    await createTask(db, spec({ dueAt: when, assigneeStaffId: staffId }));
    const [row] = await rows();
    assert.equal(row.due_at.toISOString(), when.toISOString());
    assert.equal(row.assignee_staff_id, staffId);
  });

  // ── the queue read the index exists for ──

  /* These two assert on v_task_queue_depth, which aggregates across the WHOLE
     org. They used to assert absolute counts, so any other open task for these
     roles — a fixture from another suite, or the real work in a developer's
     database — failed them with no hint that the view itself was fine. They now
     measure the DELTA their own writes cause, which tests exactly the same
     behaviour and cannot be broken by unrelated rows. */
  async function depthFor(roles) {
    const { rows } = await db.query(
      `SELECT assignee_role, open_tasks, unclaimed, claimed
         FROM v_task_queue_depth WHERE org_id = $1 AND assignee_role = ANY($2)`,
      [org, roles]
    );
    const out = {};
    for (const r of roles) {
      const hit = rows.find((d) => d.assignee_role === r);
      out[r] = hit
        ? { open: Number(hit.open_tasks), unclaimed: Number(hit.unclaimed), claimed: Number(hit.claimed) }
        : { open: 0, unclaimed: 0, claimed: 0 };
    }
    return out;
  }

  test("v_task_queue_depth counts open work per role, claimed and not", async () => {
    const ROLES = ["funding_advisor", "closer"];
    const before = await depthFor(ROLES);

    await createTask(db, spec({ eventId: "88888888-1111-1111-1111-111111111111" }));
    await createTask(db, spec({ eventId: "99999999-1111-1111-1111-111111111111",
      assigneeStaffId: staffId }));
    await createTask(db, spec({ eventId: "aaaaaaaa-1111-1111-1111-111111111111",
      assigneeRole: "closer" }));

    const after = await depthFor(ROLES);
    assert.equal(after.funding_advisor.open - before.funding_advisor.open, 2);
    assert.equal(after.funding_advisor.unclaimed - before.funding_advisor.unclaimed, 1);
    assert.equal(after.funding_advisor.claimed - before.funding_advisor.claimed, 1);
    assert.equal(after.closer.open - before.closer.open, 1);
  });

  test("a completed task leaves the queue depth", async () => {
    const before = await depthFor(["funding_advisor"]);
    const r = await createTask(db, spec());
    const withTask = await depthFor(["funding_advisor"]);
    assert.equal(withTask.funding_advisor.open - before.funding_advisor.open, 1,
      "the new task never entered the queue");

    await db.query(`UPDATE tasks SET done = true WHERE id = $1`, [r.id]);
    const after = await depthFor(["funding_advisor"]);
    assert.equal(after.funding_advisor.open, before.funding_advisor.open,
      "a completed task did not leave the queue depth");
  });

  test("the database rejects a principal role even if the helper is bypassed", async () => {
    await assert.rejects(
      () => db.query(
        `INSERT INTO tasks (org_id, client_id, title, source_workflow, assignee_role)
         VALUES ($1,$2,'direct',$3,'partner')`, [org, clientId, WF]),
      /tasks_assignee_role_ck/
    );
  });
});
