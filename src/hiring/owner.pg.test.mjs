// Hiring req ownership and the role brief, against a real Postgres.
//
// Skipped without DATABASE_URL.
//
// The test that matters most here is the INVITED manager one. A person who has
// been named but cannot log in yet is the failure mode that looks fine in the
// database and loses the candidate in real life: the req points at someone, so
// nothing reports a gap, and the task lands in an inbox nobody opens. Routing
// has to treat "named" and "reachable" as different questions.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { ownerFor, assigneeFor, briefFor, reviseBrief } from "./owner.mjs";
import { checkBench } from "./bench.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const TAG = "ownertest";

describe("hiring req ownership", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, activeStaff, invitedStaff, roleKey;

  before(async () => {
    org = (await db.query(`SELECT id FROM orgs WHERE is_default LIMIT 1`)).rows[0].id;
    await cleanup();

    activeStaff = (await db.query(
      `INSERT INTO staff (org_id, name, email, role, status, active)
       VALUES ($1,$2,$3,'sales_manager','active',true) RETURNING id`,
      [org, `${TAG} sarah`, `${TAG}-sarah@example.test`])).rows[0].id;

    // Named, but has never set a password. Login requires status='active', so
    // this person cannot open a task today.
    invitedStaff = (await db.query(
      `INSERT INTO staff (org_id, name, email, role, status, active)
       VALUES ($1,$2,$3,'sales_manager','invited',true) RETURNING id`,
      [org, `${TAG} pending`, `${TAG}-pending@example.test`])).rows[0].id;

    // A throwaway req so the tests never mutate the seeded closer/csm rows.
    roleKey = `${TAG}_req`;
    await db.query(
      `INSERT INTO hiring_roles (org_id, key, name, bench_target, owner_role)
       VALUES ($1,$2,'Ownership fixture',1,'sales_manager')`, [org, roleKey]);
  });

  after(async () => { await cleanup(); await close(); });

  // ------------------------------------------------------------- the rule

  test("the owner's routing rule is stored as data, not code", async () => {
    // Owner-described 2026-09-05: sales-facing seats go to the sales manager.
    const { rows } = await db.query(
      `SELECT key, owner_role FROM hiring_roles
        WHERE org_id = $1 AND key IN ('closer','setter','sales_coordinator','csm')
        ORDER BY key`, [org]);
    assert.equal(rows.length, 4, "294 should have seeded csm alongside the three from 051");
    for (const r of rows) {
      assert.equal(r.owner_role, "sales_manager", `${r.key} should route to the sales manager`);
    }
  });

  test("a req with no rule falls back to the owner rather than to nobody", async () => {
    const key = `${TAG}_default`;
    await db.query(
      `INSERT INTO hiring_roles (org_id, key, name) VALUES ($1,$2,'No rule set')`,
      [org, key]);
    const out = await ownerFor(db, { orgId: org, roleKey: key });
    assert.equal(out.role, "owner");
    assert.equal(out.source, "rule", "'owner' is the column default, so it resolves as a rule");
    assert.equal(out.staffId, null);
  });

  test("an unknown role is an error, not a silent fallback", async () => {
    await assert.rejects(
      () => ownerFor(db, { orgId: org, roleKey: "no_such_role_here" }),
      (e) => e.code === "NOT_FOUND");
  });

  // --------------------------------------------------------- the override

  test("a named ACTIVE manager beats the rule", async () => {
    await db.query(
      `UPDATE hiring_roles SET hiring_manager_staff_id = $2
        WHERE org_id = $1 AND key = $3`, [org, activeStaff, roleKey]);

    const out = await ownerFor(db, { orgId: org, roleKey });
    assert.equal(out.source, "person");
    assert.equal(out.staffId, activeStaff);
  });

  test("a named INVITED manager does NOT beat the rule — they cannot open the task", async () => {
    await db.query(
      `UPDATE hiring_roles SET hiring_manager_staff_id = $2
        WHERE org_id = $1 AND key = $3`, [org, invitedStaff, roleKey]);

    const out = await ownerFor(db, { orgId: org, roleKey });
    assert.equal(out.source, "rule",
      "a person who cannot log in must not absorb the req");
    assert.equal(out.role, "sales_manager");
    assert.equal(out.staffId, null);
  });

  test("assigneeFor always returns a role, even when a person is named", async () => {
    await db.query(
      `UPDATE hiring_roles SET hiring_manager_staff_id = $2
        WHERE org_id = $1 AND key = $3`, [org, activeStaff, roleKey]);

    const out = await assigneeFor(db, { orgId: org, roleKey });
    assert.equal(out.assigneeStaffId, activeStaff);
    assert.equal(out.assigneeRole, "sales_manager",
      "createTask needs a role so the work has a queue if that person leaves");

    // Put it back for the brief tests below.
    await db.query(
      `UPDATE hiring_roles SET hiring_manager_staff_id = NULL
        WHERE org_id = $1 AND key = $2`, [org, roleKey]);
  });

  // -------------------------------------------------------------- the brief

  test("a role starts with no brief, and that is a real state", async () => {
    const out = await briefFor(db, { orgId: org, roleKey });
    assert.equal(out.brief, null);
    assert.deepEqual(out.revisions, []);
  });

  test("a revision updates the live text and keeps the history", async () => {
    const first = await reviseBrief(db, {
      orgId: org, roleKey, brief: "Closes inbound calls. Wants commission.",
      reason: "first draft", byStaffId: activeStaff
    });
    assert.ok(first.revisionId);

    const second = await reviseBrief(db, {
      orgId: org, roleKey, brief: "Closes inbound calls. Comfortable on the phone all day.",
      reason: "sharpened after two bad hires", byAgent: "OP-06"
    });
    assert.ok(second.revisionId);

    const out = await briefFor(db, { orgId: org, roleKey });
    assert.match(out.brief, /all day/, "live text should be the newest revision");
    assert.equal(out.revisions.length, 2);
    assert.match(out.revisions[0].reason, /two bad hires/, "newest first");
    assert.equal(out.revisions[0].revised_by_agent, "OP-06",
      "an automated revision has to name the agent that made it");
  });

  test("a revision without a reason is refused", async () => {
    await assert.rejects(
      () => reviseBrief(db, {
        orgId: org, roleKey, brief: "something", reason: "  ", byStaffId: activeStaff
      }), /reason is required/);
  });

  test("a revision must name exactly one author", async () => {
    await assert.rejects(
      () => reviseBrief(db, {
        orgId: org, roleKey, brief: "x", reason: "y",
        byStaffId: activeStaff, byAgent: "OP-06"
      }), /exactly one/);

    await assert.rejects(
      () => reviseBrief(db, { orgId: org, roleKey, brief: "x", reason: "y" }),
      /exactly one/);
  });

  test("history cannot be rewritten or deleted", async () => {
    const { rows } = await db.query(
      `SELECT v.id FROM hiring_role_brief_revisions v
         JOIN hiring_roles r ON r.id = v.role_id
        WHERE r.org_id = $1 AND r.key = $2 LIMIT 1`, [org, roleKey]);
    const id = rows[0].id;

    await assert.rejects(
      () => db.query(`UPDATE hiring_role_brief_revisions SET brief = 'edited' WHERE id = $1`, [id]),
      /append-only/);
    await assert.rejects(
      () => db.query(`DELETE FROM hiring_role_brief_revisions WHERE id = $1`, [id]),
      /append-only/);
  });

  test("an empty brief is reported as a gap the same way an empty scorecard is", async () => {
    const { rows } = await db.query(
      `SELECT config, detail FROM v_hiring_config_gaps
        WHERE org_id = $1 AND config = 'hiring_roles.role_brief'`, [org]);
    assert.ok(rows.length > 0, "the seeded roles have no brief, so they should show up");
    assert.ok(rows.every((r) => /no role brief written for/.test(r.detail)));
  });

  // ------------------------------------------------- the rule, end to end

  test("a bench alert goes to the sales manager, not to the admin pile", async () => {
    // The whole point of 294. checkBench used to hardcode assigneeRole 'admin'
    // for every role, so a short closer bench and a short bookkeeper bench
    // landed in the same queue and neither named an owner.
    const out = await checkBench(db, { orgId: org, today: "2026-09-05" });

    const sales = out.shortfalls.filter(
      (s) => ["closer", "setter", "sales_coordinator", "csm"].includes(s.role_key));
    assert.ok(sales.length > 0, "the seeded sales benches start empty, so they are short");

    for (const s of sales) {
      assert.equal(s.assignee_role, "sales_manager",
        `${s.role_key} should route to the sales manager, not admin`);
    }

    // The other half of the rule: this file's own fixture req has no sales
    // lane, so it must land on the owner. Both branches in one pass is the
    // point — a routing rule that only ever produces one answer is not routing.
    const fallback = out.shortfalls.find((s) => s.role_key === `${TAG}_default`);
    assert.ok(fallback, "the no-rule fixture req should also be short");
    assert.equal(fallback.assignee_role, "owner");

    /* And the tasks really carry it — not just the return value.
       Checked against each role's OWN owner_role rather than a hardcoded list
       of role names: the rule is "the task matches the column", and pinning it
       to today's role names would fail the moment someone adds a req. */
    const { rows } = await db.query(
      `SELECT t.body, t.assignee_role, r.key, r.owner_role
         FROM tasks t
         JOIN hiring_roles r
           ON t.body = 'hiring:bench:' || r.key || ':2026-09-05'
        WHERE t.source_workflow = 'hiring-bench-monitor'
          AND r.org_id = $1`, [org]);
    assert.ok(rows.length > 0, "a task should have been written");
    for (const row of rows) {
      assert.equal(row.assignee_role, row.owner_role,
        `${row.key} routed to ${row.assignee_role} but its rule says ${row.owner_role}`);
    }
  });

  async function cleanup() {
    await db.query(
      `DELETE FROM tasks WHERE source_workflow = 'hiring-bench-monitor'
        AND body LIKE '%2026-09-05'`);
    await db.query(
      `DELETE FROM hiring_roles WHERE org_id = $1 AND key LIKE $2`, [org, `${TAG}%`]);
    await db.query(
      `DELETE FROM staff WHERE org_id = $1 AND email LIKE $2`, [org, `${TAG}-%`]);
  }
});
