import test from "node:test";
import assert from "node:assert/strict";

import { ROLE_SETS } from "../http/read-api.mjs";
import {
  tiersForRole,
  assertBrainAccess,
  canQueryBrain
} from "./access.mjs";
import { retrieveChunks } from "./retrieve.mjs";

test("tiersForRole: STAFF get public/sales/staff, not owner or affiliate", () => {
  for (const role of ["closer", "setter", "funding_advisor", "inquiry_specialist", "sales_manager"]) {
    assert.ok(ROLE_SETS.STAFF.has(role), role);
    const tiers = tiersForRole(role);
    assert.deepEqual(tiers, ["public", "sales", "staff"], role);
    assert.ok(!tiers.includes("owner"), role);
    assert.ok(!tiers.includes("affiliate"), role);
    assert.equal(canQueryBrain(role), true);
  }
});

test("tiersForRole: OPS (owner/admin) also get owner tier", () => {
  for (const role of ["owner", "admin"]) {
    assert.ok(ROLE_SETS.OPS.has(role));
    const tiers = tiersForRole(role);
    assert.deepEqual(tiers, ["public", "sales", "staff", "owner"]);
    assert.ok(!tiers.includes("affiliate"));
  }
});

test("tiersForRole: unknown / partner roles get nothing", () => {
  assert.deepEqual(tiersForRole("partner"), []);
  assert.deepEqual(tiersForRole("affiliate"), []);
  assert.deepEqual(tiersForRole(""), []);
  assert.deepEqual(tiersForRole(null), []);
  assert.equal(assertBrainAccess("partner").ok, false);
});

test("retrieveChunks lets closer search but only with STAFF tiers in SQL", async () => {
  let seen;
  const db = {
    async query(sql, params) {
      seen = { sql, params };
      return { rows: [] };
    }
  };
  const out = await retrieveChunks(db, {
    orgId: "org-1",
    role: "closer",
    query: "objection script",
    embed: async () => ({ ok: true, embeddings: [new Array(1536).fill(0)] })
  });
  assert.equal(out.ok, true);
  assert.match(seen.sql, /access_tier = ANY/i);
  assert.deepEqual(seen.params[1], ["public", "sales", "staff"]);
  assert.ok(!seen.params[1].includes("owner"));
  assert.ok(!seen.params[1].includes("affiliate"));
});

test("retrieveChunks still refuses non-STAFF before any db call", async () => {
  let called = false;
  const db = { async query() { called = true; return { rows: [] }; } };
  const out = await retrieveChunks(db, {
    orgId: "org-1",
    role: "partner",
    query: "anything",
    embed: async () => ({ ok: true, embeddings: [new Array(1536).fill(0)] })
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "forbidden_role");
  assert.equal(called, false);
});
