// Unit 4's guarantee: every workflow that creates work names the role that owns
// it, and it is the role the routing spec assigns.
//
// Two layers, because neither alone is enough:
//
//  1. RUNTIME — drive four workflows (one per destination role) through their real
//     handle() against the pgFake and assert the row that lands. This is the only
//     proof that the value reaches the database rather than merely appearing in
//     the source.
//
//  2. COMPLETENESS — assert the remaining fifteen pass a role from the spec map
//     and that no workflow still writes a raw INSERT. This is a source check and
//     is honest about being one; what makes it more than a grep is that
//     createTask() THROWS on a missing or non-employee role, so the nineteen
//     existing workflow test files are themselves runtime proof that whatever
//     each site passes is present and valid.

import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { pgFake, fakeStep, ev } from "./test-support.mjs";
import { TASK_ROLES } from "../lib/create-task.mjs";

// The routing table from the unit spec, keyed by workflow id prefix.
const SPEC = {
  "f-01": "funding_advisor", "f-07": "funding_advisor", "f-08": "funding_advisor",
  "f-09": "funding_advisor", "f-10": "funding_advisor", "f-11": "funding_advisor",
  "c-05": "funding_advisor", "c-06": "funding_advisor", "dpc-03": "funding_advisor",
  "dpc-05": "funding_advisor", "n-06": "funding_advisor", "u-02": "funding_advisor",
  "u-05": "funding_advisor", "ai-set-04": "funding_advisor",
  "c-02": "inquiry_specialist", "c-03": "inquiry_specialist",
  "s-06": "closer", "s-08": "closer",
  "ds-02": "admin"
};

/* Templates are defined per-test-file in this suite rather than exported from
   test-support, so this is the local one. It is permissive on purpose: these
   tests assert the TASK row, and a missing template must not stop a workflow
   reaching its task branch. */
const anyTemplates = () => {
  const keys = [];
  for (const f of fs.readdirSync(path.join(process.cwd(), "src/workflows"))) {
    if (!f.endsWith(".mjs") || f.includes(".test.")) continue;
    const src = fs.readFileSync(path.join(process.cwd(), "src/workflows", f), "utf8");
    for (const m of src.matchAll(/["'`]((?:EMAIL|SMS)-[A-Z0-9-]+)["'`]/g)) keys.push(m[1]);
  }
  return [...new Set(keys)].flatMap((k) => ["sms", "email"].map((channel) => ({
    org_id: "org-1", template_key: k, channel, body: k, compliance_passed: true
  })));
};

const DIR = path.join(process.cwd(), "src/workflows");
const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".mjs") && !f.includes(".test."));
const fileFor = (key) => files.find((f) => f.startsWith(key + "-"));

describe("task role routing", () => {

  // ── layer 1: the row that actually lands ──

  test("f-01 routes its pod task to funding_advisor", async () => {
    const { handle } = await import("./f-01-funding-intake.mjs");
    // Fixture copied from f-01-funding-intake.test.mjs's happy path — a funding
    // tier with no pod assigned is what reaches the task branch.
    const db = pgFake({
      clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com",
                  outcome_tier: "FULL_FUNDING", custom_fields: {} }]
    });
    await handle({ event: ev("round.started", {}, { clientId: "cl-1" }), db, step: fakeStep() });
    assert.equal(db.tasks.length, 1, "f-01 created no task");
    assert.equal(db.tasks[0].assignee_role, "funding_advisor");
    assert.equal(db.tasks[0].assignee_staff_id, null, "a new task must be unclaimed");
  });

  test("c-02 routes inquiry work to inquiry_specialist", async () => {
    const { handle } = await import("./c-02-inquiry-created.mjs");
    const db = pgFake({
      clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
      templates: anyTemplates()
    });
    await handle({
      event: ev("inquiry.created", { newInquiries: [{ bureau: "EX", name: "X" }] }, { clientId: "cl-1" }),
      db, step: fakeStep()
    });
    assert.equal(db.tasks.length, 1, "c-02 created no task");
    assert.equal(db.tasks[0].assignee_role, "inquiry_specialist");
  });

  test("s-08 routes post-call follow-up to closer", async () => {
    const { handle } = await import("./s-08-post-call-funding-declined.mjs");
    // Fixture from s-08-post-call-funding-declined.test.mjs: the gate is
    // payload.outcome === "declined".
    const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }] });
    await handle({
      event: ev("call.completed", { outcome: "declined" }, { clientId: "cl-1" }),
      db, step: fakeStep()
    });
    assert.equal(db.tasks.length, 1, "s-08 created no task");
    assert.equal(db.tasks[0].assignee_role, "closer");
  });

  test("ds-02 routes the invoice task to admin", async () => {
    const { handle } = await import("./ds-02-diy-letters.mjs");
    // Fixture from ds-02-diy-letters.test.mjs: the downsell path is
    // REPAIR_ONLY + the DIY product name. HARD RULE 1 keeps it off the funding
    // route, so the tier here is load-bearing.
    const { EMAIL_TEMPLATE_KEY } = await import("./ds-02-diy-letters.mjs");
    const db = pgFake({
      clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com",
                  outcome_tier: "REPAIR_ONLY", custom_fields: {} }],
      templates: [{ org_id: "org-1", template_key: EMAIL_TEMPLATE_KEY, channel: "email",
                    body: "letters ready", compliance_passed: true }]
    });
    await handle({
      event: ev("payment.received", { productName: "Consulting Services Package", amount: 1000 },
                { clientId: "cl-1" }),
      db, step: fakeStep(), fetchImpl: async () => ({ ok: true, status: 200 })
    });
    assert.equal(db.tasks.length, 1, "ds-02 created no task");
    assert.equal(db.tasks[0].assignee_role, "admin");
  });

  // ── layer 2: completeness across all nineteen ──

  test("all nineteen routed workflows exist and pass a role from the spec", () => {
    const missing = [];
    const wrong = [];
    for (const [key, role] of Object.entries(SPEC)) {
      const f = fileFor(key);
      if (!f) { missing.push(key); continue; }
      const src = fs.readFileSync(path.join(DIR, f), "utf8");
      const found = [...src.matchAll(/assigneeRole:\s*"([a-z_]+)"/g)].map((m) => m[1]);
      if (!found.length) missing.push(`${key} (no assigneeRole)`);
      else if (!found.every((r) => r === role)) wrong.push(`${key}: ${found} ≠ ${role}`);
    }
    assert.deepEqual(missing, [], `workflows with no role: ${missing}`);
    assert.deepEqual(wrong, [], `workflows routed to the wrong role: ${wrong}`);
  });

  test("every role in the spec is one createTask accepts", () => {
    for (const role of new Set(Object.values(SPEC))) {
      assert.ok(TASK_ROLES.has(role), `${role} is not an employee role`);
    }
  });

  test("no workflow writes a raw INSERT INTO tasks any more", () => {
    const offenders = files.filter((f) =>
      f !== "test-support.mjs" &&
      /INSERT INTO tasks/.test(fs.readFileSync(path.join(DIR, f), "utf8")));
    assert.deepEqual(offenders, [],
      `these bypass createTask and so can create work with no owner: ${offenders}`);
  });

  test("f-06 is named in the spec but creates no task — recorded, not silently dropped", () => {
    const f = fileFor("f-06");
    assert.ok(f, "f-06 should exist");
    const src = fs.readFileSync(path.join(DIR, f), "utf8");
    assert.equal(/INSERT INTO tasks|createTask\(/.test(src), false,
      "f-06 now creates a task — add it to the SPEC map above and route it");
  });
});
