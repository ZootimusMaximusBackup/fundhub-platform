// Static recurrence guard: every api/ handler that accepts an id / client_id
// must either be sessionless-allowlisted or show an org-scoping marker.
//
// No database. Runs on every `npm test`. A new endpoint that forgets org
// scope fails this file before anyone ships it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { discoverIdEndpoints } from "./cross-org-guard.mjs";

test("every id-shaped api handler is org-scoped or explicitly sessionless", () => {
  const endpoints = discoverIdEndpoints();
  assert.ok(endpoints.length >= 20,
    `expected to discover many id-shaped handlers, got ${endpoints.length}`);

  const unscoped = endpoints.filter((e) => !e.scoped);
  assert.deepEqual(
    unscoped.map((e) => e.rel),
    [],
    "handlers accept an id/client_id but show no org/partner scope marker:\n" +
      unscoped.map((e) => `  - ${e.rel}`).join("\n")
  );
});

test("confirmed P0 surfaces are in the discovery set and marked scoped", () => {
  const byRel = new Map(discoverIdEndpoints().map((e) => [e.rel, e]));
  for (const rel of [
    "dashboard/client.mjs",
    "dashboard/clients.mjs",
    "dashboard/pipeline.mjs",
    "tasks.mjs",
    "hiring/application.mjs",
    "inquiry-cases.mjs"
  ]) {
    const e = byRel.get(rel);
    assert.ok(e, `${rel} must be discovered as id-shaped`);
    assert.equal(e.scoped, true, `${rel} must be marked org-scoped`);
  }
});
