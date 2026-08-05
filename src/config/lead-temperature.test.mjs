import { test } from "node:test";
import assert from "node:assert";
import { classifyTemperature, currentTemperature } from "./lead-temperature.mjs";

test("classifyTemperature: entry.captured alone is cold", () => {
  assert.equal(classifyTemperature(new Set(["entry.captured"])), "cold");
});

test("classifyTemperature: survey.submitted (with entry.captured) is warm, not cold", () => {
  assert.equal(classifyTemperature(new Set(["entry.captured", "survey.submitted"])), "warm");
});

test("classifyTemperature: booking.created is hot even without survey.submitted", () => {
  assert.equal(classifyTemperature(new Set(["entry.captured", "booking.created"])), "hot");
});

test("classifyTemperature: call.completed alone is hot", () => {
  assert.equal(classifyTemperature(new Set(["call.completed"])), "hot");
});

test("classifyTemperature: full funnel depth (survey + booking) is hot, not warm", () => {
  assert.equal(classifyTemperature(new Set(["entry.captured", "survey.submitted", "booking.created"])), "hot");
});

test("classifyTemperature: diagnostic.paid exits nurture entirely, regardless of other events", () => {
  assert.equal(classifyTemperature(new Set(["entry.captured", "survey.submitted", "booking.created", "diagnostic.paid"])), null);
});

test("classifyTemperature: cancelled booking with survey falls back to warm", () => {
  assert.equal(
    classifyTemperature(new Set(["entry.captured", "survey.submitted", "booking.created", "booking.cancelled"])),
    "warm"
  );
});

test("classifyTemperature: noshow without survey falls back to cold", () => {
  assert.equal(
    classifyTemperature(new Set(["entry.captured", "booking.created", "booking.noshow"])),
    "cold"
  );
});

test("classifyTemperature: no funnel activity classifies as null", () => {
  assert.equal(classifyTemperature(new Set()), null);
});

// --- booking.cancelled / booking.noshow fallback ---
test("classifyTemperature: booking.cancelled alone (survey submitted) falls back to warm", () => {
  assert.equal(classifyTemperature(new Set(["entry.captured", "survey.submitted", "booking.cancelled"])), "warm");
});

test("classifyTemperature: booking.cancelled alone (no survey) falls back to cold", () => {
  assert.equal(classifyTemperature(new Set(["entry.captured", "booking.cancelled"])), "cold");
});

test("classifyTemperature: booking.noshow alone (survey submitted) falls back to warm", () => {
  assert.equal(classifyTemperature(new Set(["entry.captured", "survey.submitted", "booking.noshow"])), "warm");
});

test("classifyTemperature: booking.noshow alone (no survey, no entry) falls back to cold", () => {
  assert.equal(classifyTemperature(new Set(["booking.noshow"])), "cold");
});

test("classifyTemperature: booking.created AND booking.cancelled both present prefers the cancel (falls back)", () => {
  assert.equal(classifyTemperature(new Set(["entry.captured", "survey.submitted", "booking.created", "booking.cancelled"])), "warm");
});

test("classifyTemperature: call.completed after a cancel/noshow keeps them hot (real call happened)", () => {
  assert.equal(classifyTemperature(new Set(["entry.captured", "booking.cancelled", "call.completed"])), "hot");
});

// Minimal fake covering only the events table query currentTemperature issues.
function pgFake(rows) {
  return { async query(sql, params) {
    assert.match(sql, /SELECT DISTINCT name FROM events/);
    const [clientId, names] = params;
    return { rows: rows.filter((r) => r.client_id === clientId && names.includes(r.name)).map((r) => ({ name: r.name })) };
  } };
}

test("currentTemperature: null clientId short-circuits without querying", async () => {
  const db = { query: () => { throw new Error("should not query"); } };
  assert.equal(await currentTemperature(db, null), null);
});

test("currentTemperature: queries events and classifies", async () => {
  const db = pgFake([
    { client_id: "cl-1", name: "entry.captured" },
    { client_id: "cl-1", name: "survey.submitted" },
    { client_id: "cl-2", name: "entry.captured" }
  ]);
  assert.equal(await currentTemperature(db, "cl-1"), "warm");
  assert.equal(await currentTemperature(db, "cl-2"), "cold");
  assert.equal(await currentTemperature(db, "cl-unknown"), null);
});
