import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertHarnessSafe,
  LIVE_CLIENTS_ERROR,
  PRIVILEGED_ROLE_ERROR
} from "./scratch-guard.mjs";

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
