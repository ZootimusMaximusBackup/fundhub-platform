import { test } from "node:test";
import assert from "node:assert";
import { recordDispatch, resolveClientByCallId } from "./outbound-calls.mjs";

// In-memory db stub that tracks inserted rows.
function makeDb() {
  const rows = new Map(); // call_id → {client_id, org_id, kind}
  return {
    query(sql, params) {
      if (/INSERT INTO outbound_calls/.test(sql)) {
        const [call_id, client_id, org_id, kind] = params;
        // ON CONFLICT DO NOTHING semantics
        if (!rows.has(call_id)) rows.set(call_id, { client_id, org_id, kind });
        return { rows: [] };
      }
      if (/SELECT client_id FROM outbound_calls/.test(sql)) {
        const [call_id] = params;
        const row = rows.get(call_id);
        return row ? { rows: [{ client_id: row.client_id }] } : { rows: [] };
      }
      return { rows: [] };
    },
    _rows: rows
  };
}

test("recordDispatch: inserts a new dispatch record", async () => {
  const db = makeDb();
  await recordDispatch({ callId: "call_1", clientId: "client-a", orgId: "org-1", kind: "inquiry_removal", db });
  assert.equal(db._rows.size, 1);
  assert.equal(db._rows.get("call_1").client_id, "client-a");
});

test("recordDispatch: idempotent — second call with same callId does not overwrite", async () => {
  const db = makeDb();
  await recordDispatch({ callId: "call_2", clientId: "client-a", orgId: "org-1", kind: "inquiry_removal", db });
  await recordDispatch({ callId: "call_2", clientId: "client-b", orgId: "org-1", kind: "inquiry_removal", db });
  // Still client-a (first write wins)
  assert.equal(db._rows.get("call_2").client_id, "client-a");
});

test("resolveClientByCallId: returns client_id for known callId", async () => {
  const db = makeDb();
  await recordDispatch({ callId: "call_3", clientId: "client-c", orgId: "org-1", kind: "inquiry_removal", db });
  const clientId = await resolveClientByCallId("call_3", db);
  assert.equal(clientId, "client-c");
});

test("resolveClientByCallId: returns null for unknown callId", async () => {
  const db = makeDb();
  const clientId = await resolveClientByCallId("call_unknown", db);
  assert.equal(clientId, null);
});
