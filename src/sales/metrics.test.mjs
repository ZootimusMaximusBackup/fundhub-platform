import { test } from "node:test";
import fs from "node:fs";
import assert from "node:assert/strict";
import {
  belongsOnCloserBoard,
  closerRoster,
  filterCloserRoster,
  isBlockedCloserIdentity,
  isOwnerSetCloser,
  nyDateString,
  OWNER_SET_CLOSER
} from "./metrics.mjs";

test("nyDateString is YYYY-MM-DD in America/New_York", () => {
  assert.match(nyDateString(new Date("2026-08-17T16:00:00.000Z")), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(nyDateString(new Date("2026-08-17T16:00:00.000Z")), "2026-08-17");
});

test("owner-set closer is Chris Stanbridge", () => {
  assert.equal(OWNER_SET_CLOSER.name, "Chris Stanbridge");
  assert.equal(OWNER_SET_CLOSER.email, "chris@fundhub.ai");
  assert.equal(isOwnerSetCloser({ name: "Chris Stanbridge", role: "owner" }), true);
  assert.equal(isOwnerSetCloser({ email: "chris@fundhub.ai", role: "owner" }), true);
  assert.equal(isOwnerSetCloser({ name: "TEST — Owner Role", email: "owner@fundhub.ai" }), false);
});

test("blocked closer identities: seed, demo, sandbox, test — never Chris", () => {
  const blocked = [
    { name: "Jordan Blake", email: "jordan@fundhub.ai", role: "closer", is_demo: false },
    { name: "Nina Castellano", email: "nina@fundhub.ai", role: "closer", is_demo: false },
    { name: "CRS Sandbox Smoke", email: "crs_sandbox_smoke_staff@example.com", role: "closer", is_demo: false },
    { name: "TEST — Closer Role", email: "closer@fundhub.ai", role: "closer", is_demo: false },
    { name: "DEMO Closer", email: "closer@demo.fundhub.local", role: "closer", is_demo: true },
    { name: "Marcus Webb", email: "marcus@fundhub.ai", role: "closer", is_demo: false }
  ];
  for (const row of blocked) {
    assert.equal(isBlockedCloserIdentity(row), true, row.name);
    assert.equal(belongsOnCloserBoard(row), false, row.name);
  }
  assert.equal(
    isBlockedCloserIdentity({ name: "Chris Stanbridge", email: "chris@fundhub.ai", is_demo: false }),
    false
  );
});

test("closer board excludes owners; keeps a real closer and the owner-set closer", () => {
  const chris = { name: "Chris Stanbridge", email: "chris@fundhub.ai", role: "owner", is_demo: false };
  const real = { name: "Riley Chen", email: "riley@fundhub.ai", role: "closer", is_demo: false };
  const ownerOnly = { name: "TEST — Owner Role", email: "owner@fundhub.ai", role: "owner", is_demo: false };
  // Owner-set: Chris takes calls, so he is on the board. Other owners are not.
  assert.equal(belongsOnCloserBoard(chris), true);
  assert.equal(belongsOnCloserBoard(real), true);
  assert.equal(belongsOnCloserBoard(ownerOnly), false);
});

test("filterCloserRoster drops demo names and owners; does not mutate the source list", () => {
  const rows = [
    { name: "Jordan Blake", email: "jordan@fundhub.ai", role: "closer", is_demo: false },
    { name: "Nina Castellano", email: "nina@fundhub.ai", role: "closer", is_demo: false },
    { name: "CRS Sandbox Smoke", email: "crs_sandbox@example.com", role: "closer", is_demo: false },
    { name: "TEST — Closer Role", email: "closer@fundhub.ai", role: "closer", is_demo: false },
    { name: "Chris Stanbridge", email: "chris@fundhub.ai", role: "owner", is_demo: false },
    { name: "Riley Chen", email: "riley@fundhub.ai", role: "closer", is_demo: false }
  ];
  const frozen = rows.slice();
  const out = filterCloserRoster(rows);
  assert.deepEqual(out.map((r) => r.name), ["Chris Stanbridge", "Riley Chen"]);
  assert.equal(rows.length, frozen.length, "filter must not delete staff rows");
  assert.equal(rows[0].name, "Jordan Blake");
});

test("DEMO closers show only when Demo Mode is on", () => {
  const demo = { name: "DEMO Closer", email: "closer@demo.fundhub.local", role: "closer", is_demo: true };
  assert.equal(belongsOnCloserBoard(demo), false);
  assert.equal(belongsOnCloserBoard(demo, { demoMode: true }), true);
});

test("closerRoster SQL is closers only, never DELETEs, and returns live rates or null", async () => {
  const db = {
    async query(sql) {
      if (/FROM staff s/.test(sql)) {
        assert.doesNotMatch(sql, /chris@fundhub\.ai/);
        assert.doesNotMatch(sql, /chris stanbridge/);
        assert.match(sql, /lower\(btrim\(s\.role\)\) = 'closer'/);
        assert.doesNotMatch(sql, /\bDELETE\b/i);
        return {
          rows: [
            {
              staff_id: "j", name: "Jordan Blake", email: "jordan@fundhub.ai",
              role: "closer", is_demo: false, shift_started: null,
              cash_cents: 99999, held: 20, deposits: 10
            },
            {
              staff_id: "c", name: "Chris Stanbridge", email: "chris@fundhub.ai",
              role: "owner", is_demo: false, shift_started: null,
              cash_cents: 200, held: 2, deposits: 0
            },
            {
              staff_id: "r", name: "Riley Chen", email: "riley@fundhub.ai",
              role: "closer", is_demo: false, shift_started: null,
              cash_cents: 200, held: 2, deposits: 0
            },
            {
              staff_id: "s", name: "CRS Sandbox Smoke",
              email: "crs_sandbox_smoke@example.com",
              role: "closer", is_demo: false, shift_started: null,
              cash_cents: 1, held: 1, deposits: 0
            },
            {
              staff_id: "t", name: "TEST — Closer Role", email: "closer@fundhub.ai",
              role: "closer", is_demo: false, shift_started: null,
              cash_cents: 0, held: 0, deposits: 0
            }
          ]
        };
      }
      return { rows: [{ deposits: 0, funded: 0 }] };
    }
  };
  const rows = await closerRoster(db, {
    orgId: "org-1",
    start: new Date("2026-08-01T00:00:00Z"),
    end: new Date("2026-09-01T00:00:00Z"),
    now: new Date("2026-08-16T12:00:00Z")
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, "Chris Stanbridge");
  assert.equal(rows[1].name, "Riley Chen");
  assert.equal(rows[0].calls, 2);
  assert.equal(rows[0].close_rate, 0);
  assert.equal(rows[0].funded_rate, null);
  assert.equal(rows[0].cash_cents, 200);
  assert.equal(rows[0].cash_display, "$2");
  assert.equal(rows[0].action, null);
  assert.equal(rows[0].on_shift, false);
});

/* Builder notes are not operator English. My Numbers and Sales Floor paint
   target_reason straight onto the page, so "No monthly deposits target in
   staff_targets" appeared in front of a reader who has never heard of a table
   called staff_targets. The value must stay null — the wording is the fix. */
test("metrics.mjs ships no table names in reader-facing reasons", () => {
  const src = fs.readFileSync(
    new URL("./metrics.mjs", import.meta.url), "utf8");
  const reasons = src.match(/reason:\s*"[^"]*"/g) || [];
  assert.ok(reasons.length > 0, "there should be reason strings to check");
  for (const r of reasons) {
    assert.ok(!/staff_targets/.test(r), "reader-facing reason names a table: " + r);
  }
});
