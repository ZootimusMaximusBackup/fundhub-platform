import { test } from "node:test";
import assert from "node:assert";
import {
  hasMonitoringConsent, activityOverlapsShift, findOverlappingShift,
  mergeActivityEvent, pollAndMergeHubstaff
} from "./hubstaff-ingest.mjs";

const STAFF_OK = {
  id: "11111111-1111-4111-8111-111111111111",
  org_id: "22222222-2222-4222-8222-222222222222",
  hubstaff_user_id: "44",
  monitoring_consent_at: "2026-08-01T00:00:00Z"
};
const STAFF_NO = { ...STAFF_OK, monitoring_consent_at: null };
const SHIFT = { id: "33333333-3333-4333-8333-333333333333", staff_id: STAFF_OK.id, started_at: "2026-08-04T14:00:00Z", ended_at: null };
const ACTIVITY = { external_id: "activity:12", hubstaff_user_id: "44", window_start: "2026-08-04T15:00:00Z", overall: 70, keyboard: 50, mouse: 80, tracked_seconds: 600, apps: [], urls: [] };

function recordingDb() {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (/SELECT 1 AS one/.test(sql)) return { rows: [] };
      if (/INSERT INTO staff_events/.test(sql)) {
        return { rows: [{ id: "ev-1", org_id: STAFF_OK.org_id, staff_id: STAFF_OK.id, shift_id: SHIFT.id, kind: params[3], detail: JSON.parse(params[4]), created_at: new Date().toISOString() }] };
      }
      if (/FROM staff/.test(sql) && /monitoring_consent_at IS NOT NULL/.test(sql)) return { rows: [STAFF_OK] };
      if (/FROM shifts/.test(sql)) return { rows: [SHIFT] };
      return { rows: [] };
    }
  };
}

test("hasMonitoringConsent OFF by default", () => {
  assert.equal(hasMonitoringConsent(null), false);
  assert.equal(hasMonitoringConsent({ monitoring_consent_at: null }), false);
  assert.equal(hasMonitoringConsent(STAFF_OK), true);
});

test("CONSENT GATE: merge skips without consent and does not query", async () => {
  const db = recordingDb();
  const out = await mergeActivityEvent(db, { staff: STAFF_NO, shift: SHIFT, activity: ACTIVITY });
  assert.equal(out.reason, "no_consent");
  assert.equal(db.calls.length, 0);
});

test("merge writes monitor_activity when consented", async () => {
  const db = recordingDb();
  const out = await mergeActivityEvent(db, { staff: STAFF_OK, shift: SHIFT, activity: ACTIVITY });
  assert.equal(out.logged, true);
  const insert = db.calls.find((c) => /INSERT INTO staff_events/.test(c.sql));
  assert.equal(insert.params[3], "monitor_activity");
});

test("outside shift skipped", async () => {
  const out = await mergeActivityEvent(recordingDb(), { staff: STAFF_OK, shift: null, activity: ACTIVITY });
  assert.equal(out.reason, "outside_shift");
});

test("overlap helpers", () => {
  const now = new Date("2026-08-04T18:00:00Z");
  assert.equal(activityOverlapsShift("2026-08-04T15:00:00Z", SHIFT, now), true);
  assert.equal(findOverlappingShift("2026-08-04T15:00:00Z", [SHIFT], STAFF_OK.id, now).id, SHIFT.id);
});

test("poll not_configured without env", async () => {
  const out = await pollAndMergeHubstaff(recordingDb(), { env: {} });
  assert.equal(out.reason, "not_configured");
});

test("poll merges overlapping activity for consented staff", async () => {
  const fetchImpl = async (url) => {
    const isAct = /\/activities/.test(url);
    return {
      ok: true, status: 200,
      async json() {
        if (isAct) return { activities: [{ id: 12, user_id: 44, starts_at: "2026-08-04T15:00:00Z", overall: 70, tracked: 600 }] };
        return { screenshots: [] };
      }
    };
  };
  const out = await pollAndMergeHubstaff(recordingDb(), {
    env: { HUBSTAFF_TOKEN: "tok", HUBSTAFF_ORG_ID: "1" },
    fetchImpl,
    now: new Date("2026-08-04T18:00:00Z")
  });
  assert.equal(out.merged, 1);
});
