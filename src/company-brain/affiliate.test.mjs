import test from "node:test";
import assert from "node:assert/strict";

import { ROLE_SETS } from "../http/read-api.mjs";
import {
  tiersForRole,
  tiersForAffiliateRole,
  assertBrainAccess,
  assertAffiliateBrainAccess,
  assertTierListSafe,
  canQueryBrain,
  canQueryAffiliateBrain,
  isExternalBrainRole
} from "./access.mjs";
import { retrieveChunks, retrieveAffiliateChunks } from "./retrieve.mjs";

test("staff tiers never include affiliate", () => {
  for (const role of ["closer", "setter", "funding_advisor", "owner", "admin", "sales_manager"]) {
    assert.ok(ROLE_SETS.STAFF.has(role) || role === "owner" || role === "admin");
    const tiers = tiersForRole(role);
    assert.ok(!tiers.includes("affiliate"), role);
    assert.equal(canQueryAffiliateBrain(role), false);
  }
});

test("external roles get ONLY affiliate via tiersForAffiliateRole", () => {
  for (const role of ["affiliate", "partner"]) {
    assert.equal(isExternalBrainRole(role), true);
    assert.deepEqual(tiersForAffiliateRole(role), ["affiliate"]);
    assert.deepEqual(tiersForRole(role), []); // staff path empty
    assert.equal(canQueryBrain(role), false);
    assert.equal(canQueryAffiliateBrain(role), true);
    assert.ok(assertAffiliateBrainAccess(role).ok);
    assert.equal(assertBrainAccess(role).ok, false);
  }
});

test("assertTierListSafe refuses mixed affiliate+internal lists", () => {
  assert.equal(assertTierListSafe(["affiliate", "staff"], { external: true }).ok, false);
  assert.equal(assertTierListSafe(["affiliate"], { external: false }).ok, false);
  assert.equal(assertTierListSafe(["affiliate"], { external: true }).ok, true);
  assert.equal(assertTierListSafe(["public", "sales"], { external: false }).ok, true);
});

test("retrieveChunks refuses affiliate role (must use affiliate path)", async () => {
  let called = false;
  const db = { async query() { called = true; return { rows: [] }; } };
  const out = await retrieveChunks(db, {
    orgId: "org-1",
    role: "affiliate",
    query: "kit",
    embed: async () => ({ ok: true, embeddings: [new Array(1536).fill(0)] })
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "use_affiliate_path");
  assert.equal(called, false);
});

test("retrieveAffiliateChunks SQL requires allowlist join and affiliate tier only", async () => {
  let seen;
  const db = {
    async query(sql, params) {
      seen = { sql, params };
      return {
        rows: [{
          chunk_id: "c1",
          content: "Partner kit",
          access_tier: "affiliate",
          chunk_index: 0,
          file_id: "f1",
          drive_file_id: "d1",
          file_name: "kit.doc",
          web_view_link: null,
          client_id: null,
          mime_type: "text/plain",
          distance: 0.1
        }]
      };
    }
  };
  const out = await retrieveAffiliateChunks(db, {
    orgId: "org-1",
    role: "affiliate",
    query: "partner kit",
    embed: async () => ({ ok: true, embeddings: [new Array(1536).fill(0)] })
  });
  assert.equal(out.ok, true);
  assert.match(seen.sql, /brain_affiliate_allowlist/i);
  assert.match(seen.sql, /access_tier = 'affiliate'/i);
  assert.deepEqual(seen.params[1], ["affiliate"]);
  assert.ok(!seen.params[1].includes("public"));
  assert.ok(!seen.params[1].includes("owner"));
});

test("retrieveAffiliateChunks refuses closer", async () => {
  let called = false;
  const db = { async query() { called = true; return { rows: [] }; } };
  const out = await retrieveAffiliateChunks(db, {
    orgId: "org-1",
    role: "closer",
    query: "scripts",
    embed: async () => ({ ok: true, embeddings: [new Array(1536).fill(0)] })
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "forbidden_role");
  assert.equal(called, false);
});

test("staff retrieveChunks SQL excludes affiliate tier explicitly", async () => {
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
    query: "objection",
    embed: async () => ({ ok: true, embeddings: [new Array(1536).fill(0)] })
  });
  assert.equal(out.ok, true);
  assert.match(seen.sql, /access_tier <> 'affiliate'/i);
  assert.ok(!seen.params[1].includes("affiliate"));
});
