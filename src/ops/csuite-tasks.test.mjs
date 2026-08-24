import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CSUITE_KINDS,
  CSUITE_SOURCE,
  monthKey,
  csuiteBody,
  createCsuiteTask
} from "./csuite-tasks.mjs";

function fakeDb({ existing = null } = {}) {
  const queries = [];
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql, params });
      if (/SELECT id FROM tasks/.test(sql)) {
        return { rows: existing ? [existing] : [] };
      }
      throw new Error("unexpected query: " + sql);
    }
  };
}

describe("csuite tasks", () => {
  it("uses a stable monthly hire body", () => {
    const now = new Date(Date.UTC(2026, 7, 24));
    assert.equal(monthKey(now), "2026-08");
    assert.equal(csuiteBody("hire", { now }), "hire-closer:packed:2026-08");
  });

  it("requires a stable fire dedupe key and does not invent one", () => {
    assert.throws(() => csuiteBody("fire", { now: new Date() }), /dedupeKey/);
    assert.equal(csuiteBody("fire", { dedupeKey: "manual:2026-08" }), "fire:manual:2026-08");
  });

  it("assigns hire to sales_manager and owner kinds to owner", () => {
    assert.equal(CSUITE_KINDS.hire.assigneeRole, "sales_manager");
    assert.equal(CSUITE_KINDS.fire.assigneeRole, "owner");
    assert.equal(CSUITE_KINDS.diagnose.assigneeRole, "owner");
    assert.equal(CSUITE_KINDS.ads_review.assigneeRole, "owner");
    assert.equal(CSUITE_KINDS.raise.assigneeRole, "owner");
    assert.equal(CSUITE_KINDS.bonus.assigneeRole, "owner");
    assert.equal(CSUITE_SOURCE, "ops-coo");
  });

  it("uses a stable monthly diagnose and ads-review body", () => {
    const now = new Date(Date.UTC(2026, 7, 24));
    assert.equal(csuiteBody("diagnose", { now }), "diagnose:gaps:2026-08");
    assert.equal(csuiteBody("ads_review", { now }), "ads-review:2026-08");
  });

  it("requires a stable raise and bonus dedupe key", () => {
    assert.throws(() => csuiteBody("raise", { now: new Date() }), /dedupeKey/);
    assert.throws(() => csuiteBody("bonus", { now: new Date() }), /dedupeKey/);
    assert.equal(csuiteBody("raise", { dedupeKey: "manual:2026-08" }), "raise:manual:2026-08");
    assert.equal(csuiteBody("bonus", { dedupeKey: "manual:2026-08" }), "bonus:manual:2026-08");
  });

  it("dedupes an existing hire task without calling createTask", async () => {
    const db = fakeDb({ existing: { id: "task-1" } });
    let called = 0;
    const out = await createCsuiteTask(db, {
      kind: "hire",
      orgId: "org-1",
      now: new Date(Date.UTC(2026, 7, 24)),
      createTask: async () => {
        called += 1;
        return { created: true, id: "new" };
      }
    });
    assert.equal(called, 0);
    assert.equal(out.created, false);
    assert.equal(out.id, "task-1");
    assert.equal(out.body, "hire-closer:packed:2026-08");
  });

  it("writes a hire task with null client id", async () => {
    const db = fakeDb();
    const seen = [];
    const out = await createCsuiteTask(db, {
      kind: "hire",
      orgId: "org-1",
      now: new Date(Date.UTC(2026, 7, 24)),
      createTask: async (_db, spec) => {
        seen.push(spec);
        return { created: true, id: "new-hire", reason: null };
      }
    });
    assert.equal(out.created, true);
    assert.equal(seen[0].clientId, null);
    assert.equal(seen[0].assigneeRole, "sales_manager");
    assert.equal(seen[0].sourceWorkflow, "ops-coo");
    assert.equal(seen[0].body, "hire-closer:packed:2026-08");
  });

  it("writes a fire shape to owner and never names suspend", async () => {
    const db = fakeDb();
    const out = await createCsuiteTask(db, {
      kind: "fire",
      orgId: "org-1",
      dedupeKey: "review:2026-08",
      createTask: async (_db, spec) => {
        assert.equal(spec.assigneeRole, "owner");
        assert.equal(spec.clientId, null);
        return { created: true, id: "fire-1", reason: null };
      }
    });
    assert.equal(out.kind, "fire");
    assert.equal(out.body, "fire:review:2026-08");
    assert.equal(out.assigneeRole, "owner");
  });

  it("writes raise and bonus shapes to owner without inventing percents or dollars", async () => {
    const db = fakeDb();
    const raise = await createCsuiteTask(db, {
      kind: "raise",
      orgId: "org-1",
      dedupeKey: "review:2026-08",
      createTask: async (_db, spec) => {
        assert.equal(spec.assigneeRole, "owner");
        assert.doesNotMatch(spec.title, /%/);
        return { created: true, id: "raise-1", reason: null };
      }
    });
    const bonus = await createCsuiteTask(db, {
      kind: "bonus",
      orgId: "org-1",
      dedupeKey: "review:2026-08",
      createTask: async (_db, spec) => {
        assert.equal(spec.assigneeRole, "owner");
        assert.doesNotMatch(spec.title, /\$/);
        return { created: true, id: "bonus-1", reason: null };
      }
    });
    assert.equal(raise.body, "raise:review:2026-08");
    assert.equal(bonus.body, "bonus:review:2026-08");
  });
});
