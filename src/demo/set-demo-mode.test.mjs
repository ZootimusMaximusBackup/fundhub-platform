import { test } from "node:test";
import assert from "node:assert/strict";
import { setDemoMode } from "./platform-seed.mjs";

function fakeDb(result) {
  return {
    async query() {
      return result;
    }
  };
}

test("setDemoMode throws when UPDATE does not return the requested value", async () => {
  await assert.rejects(
    () => setDemoMode(fakeDb({ rowCount: 0, rows: [] }), { orgId: "org-1", enabled: false }),
    /demo_mode_update_failed/
  );
  await assert.rejects(
    () => setDemoMode(fakeDb({ rowCount: 1, rows: [{ demo_mode_enabled: true }] }), {
      orgId: "org-1",
      enabled: false
    }),
    /demo_mode_update_failed/
  );
});

test("setDemoMode returns enabled:false only after RETURNING confirms", async () => {
  const out = await setDemoMode(
    fakeDb({ rowCount: 1, rows: [{ demo_mode_enabled: false }] }),
    { orgId: "org-1", enabled: false }
  );
  assert.deepEqual(out, { demo_mode_enabled: false, seeded: false });
});
