import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  actionRow,
  joinHubstaffAndCrm,
  measureMinutes
} from "./measure-minutes.mjs";
import { MIN_N_TIME } from "./discoveries.mjs";

describe("joinHubstaffAndCrm", () => {
  it("returns medians for Hubstaff seconds and CRM minutes", () => {
    const out = joinHubstaffAndCrm({
      hubstaffSeconds: [600, 1800, 1200],
      crmMinutes: [40, 50, 45]
    });
    assert.equal(out.hubstaff_median_minutes, 20);
    assert.equal(out.hubstaff_n, 3);
    assert.equal(out.crm_median_minutes, 45);
    assert.equal(out.crm_n, 3);
  });

  it("drops zeros and non-numbers", () => {
    const out = joinHubstaffAndCrm({
      hubstaffSeconds: [0, "x", 3600],
      crmMinutes: [null, -1, 30]
    });
    assert.equal(out.hubstaff_median_minutes, 60);
    assert.equal(out.hubstaff_n, 1);
    assert.equal(out.crm_median_minutes, 30);
    assert.equal(out.crm_n, 1);
  });
});

describe("actionRow", () => {
  it("is INSUFFICIENT when n is under 20", () => {
    const row = actionRow({
      id: "closer_call",
      label: "Closer call",
      minutes: 38,
      n: MIN_N_TIME - 1,
      note: "CRM durations."
    });
    assert.equal(row.source, "INSUFFICIENT");
    assert.equal(row.minutes, null);
    assert.equal(row.n, 19);
    assert.equal(row.locked, false);
    assert.match(row.note, /Need 20/);
  });

  it("is MEASURED when n is 20 or more but still locked:false", () => {
    const row = actionRow({
      id: "closer_call",
      label: "Closer call",
      minutes: 38.4,
      n: MIN_N_TIME,
      note: "CRM durations."
    });
    assert.equal(row.source, "MEASURED");
    assert.equal(row.minutes, 38);
    assert.equal(row.n, 20);
    assert.equal(row.locked, false);
    assert.match(row.note, /not overwritten/);
  });
});

describe("measureMinutes", () => {
  it("joins a fake db and never locks MODEL minutes", async () => {
    const calls = Array.from({ length: 20 }, () => ({ duration_seconds: 2700 }));
    const db = {
      query: async (sql) => {
        if (sql.includes("staff_events")) {
          return { rows: [{ seconds: 1800 }, { seconds: 2400 }] };
        }
        if (sql.includes("call_outcomes")) {
          return { rows: calls };
        }
        return { rows: [] };
      }
    };
    const out = await measureMinutes(db, { orgId: "org-1", days: 30 });
    assert.equal(out.floor, 20);
    assert.equal(out.locked, false);
    const closer = out.actions.find((a) => a.id === "closer_call");
    assert.equal(closer.source, "MEASURED");
    assert.equal(closer.minutes, 45);
    assert.equal(closer.locked, false);
    assert.equal(out.actions.every((a) => a.locked === false), true);
  });

  it("returns INSUFFICIENT actions when each query fails", async () => {
    const db = {
      query: async () => {
        throw new Error("no such column");
      }
    };
    const out = await measureMinutes(db, { orgId: "org-1" });
    assert.equal(out.locked, false);
    assert.ok(out.actions.length > 0);
    assert.equal(out.actions.every((a) => a.source === "INSUFFICIENT"), true);
    assert.equal(out.actions.every((a) => a.locked === false), true);
  });

  it("returns empty rows when query is not callable", async () => {
    const out = await measureMinutes({ query: null }, { orgId: "org-1" });
    assert.equal(out.locked, false);
    assert.deepEqual(out.actions, []);
    assert.match(out.note, /MODEL/);
  });

  it("requires orgId", async () => {
    await assert.rejects(() => measureMinutes({}, {}), /orgId required/);
  });
});
