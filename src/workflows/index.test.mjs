import { test } from "node:test";
import assert from "node:assert";

test("index exports exactly 51 functions", async () => {
  const { functions } = await import("./index.mjs");
  /* 51 since s-04b + s-nobook joined (2026-08-15). The
     count is pinned so that adding a function is a visible decision rather than
     a drive-by — registering one is how a job starts running the day
     INNGEST_EVENT_KEY is set, so it should cost somebody a line in a test.

     message-dispatch-sweeper is registered; its own tests cover the outbound switch. */
  assert.equal(functions.length, 51, `expected 51, got ${functions.length}`);
  for (const fn of functions) {
    assert.ok(fn && typeof fn === "object", "each entry should be an Inngest function object");
  }
});

test("api/inngest serve endpoint imports without throwing", async () => {
  // Dynamic import of the serve handler — if the module graph is broken this throws.
  const mod = await import("../../api/inngest.mjs");
  assert.ok(mod.default, "serve handler should be the default export");
  assert.equal(typeof mod.default, "function", "serve handler should be a function");
});
