import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveClientLocation } from "./sessions.mjs";

test("resolveClientLocation prefers business_city / business_state", () => {
  assert.deepEqual(
    resolveClientLocation({
      business_city: "Mesa",
      business_state: "AZ",
      city: "Phoenix",
      state: "CA"
    }),
    { city: "Mesa", state: "AZ" }
  );
});

test("resolveClientLocation falls back through home_ / plain keys", () => {
  assert.deepEqual(
    resolveClientLocation({ home_city: "Fort Lauderdale", home_state: "FL" }),
    { city: "Fort Lauderdale", state: "FL" }
  );
  assert.deepEqual(
    resolveClientLocation({ city: "Austin", state: "TX" }),
    { city: "Austin", state: "TX" }
  );
  assert.deepEqual(resolveClientLocation({}), { city: null, state: null });
  assert.deepEqual(resolveClientLocation(null), { city: null, state: null });
});

test("resolveClientLocation uses company city/state when the person row has none", () => {
  assert.deepEqual(
    resolveClientLocation({}, [
      { entity_data: { name: "Empty" } },
      { entity_data: { city: "Austin", state: "TX" } }
    ]),
    { city: "Austin", state: "TX" }
  );
});

test("resolveClientLocation prefers the person row over a company", () => {
  assert.deepEqual(
    resolveClientLocation(
      { city: "Mesa", state: "AZ" },
      [{ entity_data: { city: "Austin", state: "TX" } }]
    ),
    { city: "Mesa", state: "AZ" }
  );
});
