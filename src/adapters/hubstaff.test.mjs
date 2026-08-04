import { test } from "node:test";
import assert from "node:assert";
import {
  hubstaffConfigFromEnv, DEFAULT_API_BASE, asPercent,
  normalizeActivity, normalizeScreenshot, fetchActivities
} from "./hubstaff.mjs";

test("hubstaffConfigFromEnv: missing credentials", () => {
  const bare = hubstaffConfigFromEnv({});
  assert.equal(bare.ready, false);
  assert.equal(bare.baseUrl, DEFAULT_API_BASE);
  assert.deepEqual(bare.missing, ["HUBSTAFF_TOKEN", "HUBSTAFF_ORG_ID"]);
});

test("hubstaffConfigFromEnv: ready when set", () => {
  const full = hubstaffConfigFromEnv({ HUBSTAFF_TOKEN: "t", HUBSTAFF_ORG_ID: "99" });
  assert.equal(full.ready, true);
});

test("asPercent + normalizeActivity/Screenshot", () => {
  assert.equal(asPercent(0.42), 42);
  const a = normalizeActivity({ id: 12, user_id: 44, starts_at: "2026-08-04T15:00:00Z", overall: 0.55, tracked: 600 });
  assert.equal(a.external_id, "activity:12");
  assert.equal(a.overall, 55);
  assert.equal(normalizeActivity({}), null);
  const s = normalizeScreenshot({ id: "s1", user_id: 44, taken_at: "2026-08-04T15:05:00Z" });
  assert.equal(s.external_id, "screenshot:s1");
});

test("fetchActivities uses org path", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return { ok: true, status: 200, async json() { return { activities: [{ id: 1, user_id: 7, starts_at: "2026-08-04T12:00:00Z", overall: 80, tracked: 600 }] }; } };
  };
  const cfg = hubstaffConfigFromEnv({ HUBSTAFF_TOKEN: "tok", HUBSTAFF_ORG_ID: "55" });
  const out = await fetchActivities(cfg, { startIso: "2026-08-04T00:00:00Z", stopIso: "2026-08-04T23:59:59Z", userIds: ["7"], fetchImpl });
  assert.equal(out.ok, true);
  assert.equal(out.activities[0].external_id, "activity:1");
  assert.match(calls[0], /\/v2\/organizations\/55\/activities/);
});
