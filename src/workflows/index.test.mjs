import { test } from "node:test";
import assert from "node:assert";

test("index exports exactly 47 functions", async () => {
  const { functions } = await import("./index.mjs");
  assert.equal(functions.length, 47, `expected 47, got ${functions.length}`);
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
