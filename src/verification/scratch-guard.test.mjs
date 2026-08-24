import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertHarnessSafe,
  LIVE_CLIENTS_ERROR,
  PRIVILEGED_ROLE_ERROR
} from "./scratch-guard.mjs";

const here = dirname(fileURLToPath(import.meta.url));

function fakeDb(rowsByCall) {
  let i = 0;
  return {
    query: async () => {
      const rows = rowsByCall[i++] || [];
      return { rows };
    }
  };
}

test("refuses a superuser or BYPASSRLS login before any write", async () => {
  const db = fakeDb([[{ usename: "postgres", privileged: true }]]);
  await assert.rejects(() => assertHarnessSafe(db), (err) => {
    assert.equal(err.message, PRIVILEGED_ROLE_ERROR);
    return true;
  });
});

test("refuses a database that already has live clients", async () => {
  const db = fakeDb([
    [{ usename: "fundhub_app", privileged: false }],
    [{ n: 12 }]
  ]);
  await assert.rejects(() => assertHarnessSafe(db), (err) => {
    assert.ok(err.message.startsWith(LIVE_CLIENTS_ERROR));
    assert.match(err.message, /12 live files/);
    return true;
  });
});

test("allows fundhub_app on a database with no live clients", async () => {
  const db = fakeDb([
    [{ usename: "fundhub_app", privileged: false }],
    [{ n: 0 }]
  ]);
  await assertHarnessSafe(db);
});

test("agent journey re-asserts scratch-safe before mass-retire", () => {
  const src = readFileSync(join(here, "journeys/agent.mjs"), "utf8");
  const retireIdx = src.indexOf("status = 'retired'");
  assert.ok(retireIdx > 0, "expected mass-retire UPDATE in agent journey");
  const guardIdx = src.lastIndexOf("assertHarnessSafe", retireIdx);
  assert.ok(guardIdx > 0 && guardIdx < retireIdx,
    "assertHarnessSafe must run before mass-retire");
});

test("fixtures re-asserts scratch-safe before outbound pause", () => {
  const src = readFileSync(join(here, "fixtures.mjs"), "utf8");
  const pauseIdx = src.indexOf("outbound_enabled = false");
  assert.ok(pauseIdx > 0, "expected outbound pause in fixtures");
  const guardIdx = src.lastIndexOf("assertHarnessSafe", pauseIdx);
  assert.ok(guardIdx > 0 && guardIdx < pauseIdx,
    "assertHarnessSafe must run before outbound pause");
});
