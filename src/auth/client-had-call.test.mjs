import { test } from "node:test";
import assert from "node:assert/strict";
import { clientHadCall } from "./client-had-call.mjs";

function fakeDb(handlers = []) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      for (const [re, rows] of handlers) {
        if (re.test(sql)) {
          const out = typeof rows === "function" ? rows(params) : rows;
          if (out instanceof Error) throw out;
          return { rows: out };
        }
      }
      return { rows: [] };
    }
  };
}

test("no org or client is not a call", async () => {
  const db = fakeDb();
  assert.deepEqual(await clientHadCall(db, {}), { had_call: false, had_call_at: null });
  assert.deepEqual(await clientHadCall(db, { orgId: "org-1" }), { had_call: false, had_call_at: null });
  assert.equal(db.calls.length, 0);
});

test("a call_outcomes row means they have been on a call", async () => {
  const at = "2026-08-01T18:00:00.000Z";
  const db = fakeDb([[/FROM call_outcomes/, [{ logged_at: at }]]]);
  const got = await clientHadCall(db, { orgId: "org-1", clientId: "client-1" });
  assert.equal(got.had_call, true);
  assert.equal(got.had_call_at, at);
  assert.equal(db.calls.length, 1);
  assert.deepEqual(db.calls[0].params, ["org-1", "client-1"]);
  assert.match(db.calls[0].sql, /org_id = \$1 AND client_id = \$2/);
});

test("no call_outcomes row means they have not been on a call", async () => {
  const db = fakeDb([[/FROM call_outcomes/, []]]);
  assert.deepEqual(
    await clientHadCall(db, { orgId: "org-1", clientId: "client-1" }),
    { had_call: false, had_call_at: null }
  );
});

test("a Date logged_at is returned as ISO", async () => {
  const d = new Date("2026-07-04T12:00:00.000Z");
  const db = fakeDb([[/FROM call_outcomes/, [{ logged_at: d }]]]);
  const got = await clientHadCall(db, { orgId: "org-1", clientId: "client-1" });
  assert.equal(got.had_call, true);
  assert.equal(got.had_call_at, "2026-07-04T12:00:00.000Z");
});

test("a down call_outcomes table is treated as no call, not a throw", async () => {
  const db = fakeDb([[/FROM call_outcomes/, new Error("relation does not exist")]]);
  assert.deepEqual(
    await clientHadCall(db, { orgId: "org-1", clientId: "client-1" }),
    { had_call: false, had_call_at: null }
  );
});

test("the lookup SQL reads call_outcomes, not outbound_calls", async () => {
  const db = fakeDb();
  await clientHadCall(db, { orgId: "org-1", clientId: "client-1" });
  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].sql, /FROM call_outcomes/);
  assert.doesNotMatch(db.calls[0].sql, /outbound_calls/);
});
