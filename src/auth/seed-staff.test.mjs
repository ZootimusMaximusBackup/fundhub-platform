import { test } from "node:test";
import assert from "node:assert";
import { FOUNDING_STAFF, SEED_FURNITURE_EMAILS } from "./seed-staff.mjs";

test("FOUNDING_STAFF is only Chris Stanbridge", () => {
  assert.deepEqual(FOUNDING_STAFF, [
    { email: "chris@fundhub.ai", role: "owner", name: "Chris Stanbridge" }
  ]);
});

test("Alvin and the other seed names are furniture, not staff", () => {
  assert.ok(SEED_FURNITURE_EMAILS.includes("alvin@fundhub.ai"));
  assert.ok(!SEED_FURNITURE_EMAILS.includes("chris@fundhub.ai"));
});
