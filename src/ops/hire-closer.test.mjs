import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  slotsPerCloserDay,
  packedFromCounts,
  beltJammed,
  nextWeekdayRange,
  loadCalendar,
  actOnPacked,
  postCloserLinkedIn
} from "./hire-closer.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

describe("hire closer packed rule", () => {
  it("uses the MODEL 45-minute call and 8-hour day", () => {
    assert.equal(slotsPerCloserDay(), 10);
  });

  it("is not packed when no closer tasks have due_at", () => {
    const out = packedFromCounts({ closerCount: 2, dueAtCount: 0 });
    assert.equal(out.packed, false);
    assert.equal(out.reason, "no_closer_due_at");
    assert.equal(out.source, "MODEL");
  });

  it("is packed when there are zero closers and any slot", () => {
    const out = packedFromCounts({ closerCount: 0, dueAtCount: 1 });
    assert.equal(out.packed, true);
    assert.equal(out.reason, "no_closers_with_slots");
  });

  it("packs at 90 percent of MODEL capacity", () => {
    // 1 closer × 10 slots × 5 days × 0.9 = 45
    assert.equal(packedFromCounts({ closerCount: 1, dueAtCount: 44 }).packed, false);
    assert.equal(packedFromCounts({ closerCount: 1, dueAtCount: 45 }).packed, true);
  });

  it("beltJammed is the packed calendar flag", () => {
    assert.equal(beltJammed({ packed: true }), true);
    assert.equal(beltJammed({ packed: false }), false);
    assert.equal(beltJammed(null), false);
  });

  it("counts five weekdays and skips the weekend", () => {
    const sat = new Date(Date.UTC(2026, 7, 22)); // Saturday
    const { start, end } = nextWeekdayRange(sat, 5);
    assert.equal(start.toISOString().slice(0, 10), "2026-08-22");
    // Sat+Sun skipped; Mon–Fri = 5 weekdays; exclusive end is Saturday 29
    assert.equal(end.toISOString().slice(0, 10), "2026-08-29");
  });

  it("loads calendar counts from closer staff and due_at tasks", async () => {
    const db = {
      async query(sql) {
        if (/FROM staff/.test(sql)) return { rows: [{ n: 1 }] };
        if (/FROM tasks/.test(sql)) return { rows: [{ n: 45 }] };
        throw new Error(sql);
      }
    };
    const cal = await loadCalendar(db, { orgId: "org-1", now: new Date(Date.UTC(2026, 7, 24)) });
    assert.equal(cal.closer_count, 1);
    assert.equal(cal.due_at_count, 45);
    assert.equal(cal.packed, true);
    assert.equal(cal.source, "MODEL");
  });
});

describe("hire closer action", () => {
  it("does not write when the calendar is not packed", async () => {
    let hireCalls = 0;
    let liCalls = 0;
    const db = {
      async query(sql) {
        if (/FROM staff/.test(sql)) return { rows: [{ n: 1 }] };
        if (/FROM tasks/.test(sql) && /due_at/.test(sql)) return { rows: [{ n: 0 }] };
        if (/hiring_job_postings/.test(sql)) return { rows: [] };
        if (/hiring_channel_connections/.test(sql)) return { rows: [] };
        throw new Error(sql);
      }
    };
    const out = await actOnPacked(db, {
      orgId: "org-1",
      now: new Date(Date.UTC(2026, 7, 24)),
      createCsuiteTaskFn: async () => {
        hireCalls += 1;
        return { created: true };
      },
      postCloserLinkedInFn: async () => {
        liCalls += 1;
        return { status: "posted" };
      }
    });
    assert.equal(out.acted, false);
    assert.equal(out.reason, "not_packed");
    assert.equal(hireCalls, 0);
    assert.equal(liCalls, 0);
  });

  it("creates one hire task and posts LinkedIn when packed", async () => {
    const db = {
      async query(sql) {
        if (/FROM staff/.test(sql)) return { rows: [{ n: 0 }] };
        if (/FROM tasks/.test(sql)) return { rows: [{ n: 2 }] };
        throw new Error(sql);
      }
    };
    const out = await actOnPacked(db, {
      orgId: "org-1",
      now: new Date(Date.UTC(2026, 7, 24)),
      createCsuiteTaskFn: async (_db, spec) => {
        assert.equal(spec.kind, "hire");
        return { created: true, id: "t1", kind: "hire" };
      },
      postCloserLinkedInFn: async () => ({ status: "not_configured", posting_id: null })
    });
    assert.equal(out.acted, true);
    assert.equal(out.task.id, "t1");
    assert.equal(out.linkedin.status, "not_configured");
  });

  it("returns not_configured when LinkedIn has no connection", async () => {
    const out = await postCloserLinkedIn(
      { query: async () => ({ rows: [] }) },
      {
        orgId: "org-1",
        connectionForFn: async () => {
          throw new Error("no active LinkedIn connection");
        },
        postJobFn: async () => {
          throw new Error("should not post");
        }
      }
    );
    assert.equal(out.status, "not_configured");
    assert.equal(out.reused, "src/hiring/linkedin.mjs");
  });

  it("does not import suspend or closeJob", () => {
    const src = fs.readFileSync(path.join(HERE, "hire-closer.mjs"), "utf8");
    assert.equal(/suspendStaff/.test(src), false);
    assert.equal(/closeJob/.test(src), false);
    assert.equal(/kind:\s*["']fire["']/.test(src), false);
  });
});
