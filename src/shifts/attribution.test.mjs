import { test } from "node:test";
import assert from "node:assert";
import { resolveShiftId } from "./attribution.mjs";

const STAFF = "22222222-2222-4222-8222-222222222222";
const SHIFT = "55555555-5555-4555-8555-555555555555";

function stubDb({ open = null, throws = false } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (throws) throw Object.assign(new Error("simulated outage"), { code: "08006" });
      return { rows: open ? [{ id: open }] : [] };
    }
  };
}

async function quietly(fn) {
  const real = console.error;
  const lines = [];
  console.error = (...a) => lines.push(a.join(" "));
  try { return { value: await fn(), lines }; } finally { console.error = real; }
}

test("an explicitly passed shift wins and costs no query", async () => {
  const db = stubDb({ open: "some-other-shift" });
  assert.equal(await resolveShiftId(db, { staffId: STAFF, shiftId: SHIFT }), SHIFT);
  assert.equal(db.calls.length, 0, "the caller already knew — asking again is a wasted round trip");
});

test("an explicit null is a statement, not an omission", async () => {
  // "This work is off the clock" is a fact the caller may know. Overriding it
  // with a lookup would attach the work to a shift the caller ruled out.
  const db = stubDb({ open: SHIFT });
  assert.equal(await resolveShiftId(db, { staffId: STAFF, shiftId: null }), null);
  assert.equal(db.calls.length, 0);
});

test("an absent shift is looked up", async () => {
  const db = stubDb({ open: SHIFT });
  assert.equal(await resolveShiftId(db, { staffId: STAFF }), SHIFT);
  assert.equal(db.calls.length, 1);
});

test("nobody clocked in resolves to null, which is a legitimate answer", async () => {
  const db = stubDb({ open: null });
  assert.equal(await resolveShiftId(db, { staffId: STAFF }), null);
});

test("no staff id means no query and no shift", async () => {
  // currentShift() throws its own error on a missing id. Asking first keeps a
  // wiring bug from arriving here looking exactly like a database outage.
  const db = stubDb({ open: SHIFT });
  assert.equal(await resolveShiftId(db, {}), null);
  assert.equal(await resolveShiftId(db), null);
  assert.equal(db.calls.length, 0);
});

test("a failed lookup is null and a log line, never a throw", async () => {
  const { value, lines } = await quietly(() => resolveShiftId(stubDb({ throws: true }), { staffId: STAFF }));
  assert.equal(value, null);
  assert.ok(lines.some((l) => /open-shift lookup failed/.test(l)), JSON.stringify(lines));
});
