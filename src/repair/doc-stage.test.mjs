// The "we need your documents" stage — the events that were emitted by nothing.
//
// awaiting_documents existed in pipeline.mjs, portal.mjs and sla.mjs from the
// day the rail was written, and no repair client ever reached it because
// repair.docs.needed and repair.docs.complete had no emitter. These tests pin
// the emitter, and pin the three refusals that keep it from moving a card it
// has no business moving.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  identityDocsOnFile,
  announceRepairDocState,
  onRepairDocsReceived
} from "./handlers.mjs";

const ORG = "11111111-1111-1111-1111-111111111111";
const CLIENT = "22222222-2222-2222-2222-222222222222";

/** A database that answers by SQL shape, so no Postgres is needed here. */
function fakeDb({ tier = "REPAIR_ONLY", stage = "awaiting_documents", docs = [], failDocs = false } = {}) {
  const seen = [];
  return {
    seen,
    query: async (sql) => {
      seen.push(sql);
      if (/FROM clients/i.test(sql)) return { rows: [{ outcome_tier: tier }] };
      if (/pipeline_stages/i.test(sql)) return { rows: stage ? [{ stage_key: stage }] : [] };
      if (/FROM documents/i.test(sql)) {
        if (failDocs) throw new Error("documents unavailable");
        return { rows: docs };
      }
      return { rows: [] };
    }
  };
}

const ID_DOC = { kind: "client_upload", subtype: "id_document" };
const ADDRESS_DOC = { kind: "client_upload", subtype: "proof_of_address" };

describe("repair identity documents — is the packet on file", () => {
  it("names both documents as missing when nothing has arrived", async () => {
    const state = await identityDocsOnFile(fakeDb({ docs: [] }), { orgId: ORG, clientId: CLIENT });
    assert.equal(state.complete, false);
    assert.deepEqual(state.missing, ["id_document", "proof_of_address"]);
  });

  it("is complete on the ID plus the proof of address, without waiting on the signature", async () => {
    const state = await identityDocsOnFile(
      fakeDb({ docs: [ID_DOC, ADDRESS_DOC] }), { orgId: ORG, clientId: CLIENT });
    assert.equal(state.complete, true);
    assert.deepEqual(state.missing, []);
  });

  it("a bank statement proves the address, exactly as the shared check says", async () => {
    const state = await identityDocsOnFile(
      fakeDb({ docs: [ID_DOC, { kind: "client_upload", subtype: "bank_statement" }] }),
      { orgId: ORG, clientId: CLIENT });
    assert.equal(state.complete, true);
  });

  it("a database that will not answer is UNKNOWN, never missing", async () => {
    const state = await identityDocsOnFile(fakeDb({ failDocs: true }), { orgId: ORG, clientId: CLIENT });
    assert.equal(state, null);
  });
});

describe("repair.docs.needed / repair.docs.complete are actually emitted", () => {
  it("emits repair.docs.needed with the missing list when the documents are not in", async () => {
    const emitted = [];
    const res = await announceRepairDocState(fakeDb({ docs: [] }), {
      orgId: ORG,
      clientId: CLIENT,
      emitImpl: async (_db, name, payload, opts) => {
        emitted.push({ name, payload, opts });
        return { id: "ev1", deduped: false, dispatched: { handlers: 1 } };
      }
    });
    assert.equal(res.emitted, true);
    assert.equal(emitted[0].name, "repair.docs.needed");
    assert.deepEqual(emitted[0].payload.missing, ["id_document", "proof_of_address"]);
    assert.equal(emitted[0].opts.idempotencyKey, `repair.docs.needed:${ORG}:${CLIENT}`);
  });

  it("emits repair.docs.complete once both are in", async () => {
    const emitted = [];
    await announceRepairDocState(fakeDb({ docs: [ID_DOC, ADDRESS_DOC] }), {
      orgId: ORG,
      clientId: CLIENT,
      emitImpl: async (_db, name) => {
        emitted.push(name);
        return { id: "ev2", deduped: false, dispatched: { handlers: 1 } };
      }
    });
    assert.deepEqual(emitted, ["repair.docs.complete"]);
  });

  it("emits nothing when the documents could not be read", async () => {
    const emitted = [];
    const res = await announceRepairDocState(fakeDb({ failDocs: true }), {
      orgId: ORG,
      clientId: CLIENT,
      emitImpl: async (_db, name) => { emitted.push(name); return { id: "x" }; }
    });
    assert.equal(res.emitted, false);
    assert.equal(res.reason, "documents_unreadable");
    assert.equal(emitted.length, 0);
  });
});

describe("an upload only ends the stage that is waiting for it", () => {
  it("completes the stage when the second document lands", async () => {
    const db = fakeDb({ stage: "awaiting_documents", docs: [ID_DOC, ADDRESS_DOC] });
    const res = await onRepairDocsReceived(
      { orgId: ORG, clientId: CLIENT, payload: { document_id: "d1" } }, db);
    assert.equal(res.done, true);
    assert.equal(res.name, "repair.docs.complete");
  });

  it("says which document is still missing and emits nothing", async () => {
    const db = fakeDb({ stage: "awaiting_documents", docs: [ID_DOC] });
    const res = await onRepairDocsReceived({ orgId: ORG, clientId: CLIENT, payload: {} }, db);
    assert.equal(res.done, false);
    assert.equal(res.reason, "identity_incomplete");
    assert.deepEqual(res.missing, ["proof_of_address"]);
  });

  it("refuses to drag a round-5 card back to analysis", async () => {
    const db = fakeDb({ stage: "awaiting_response", docs: [ID_DOC, ADDRESS_DOC] });
    const res = await onRepairDocsReceived({ orgId: ORG, clientId: CLIENT, payload: {} }, db);
    assert.equal(res.done, false);
    assert.equal(res.reason, "stage_not_waiting_on_documents");
  });

  it("ignores a client with no optimization card at all", async () => {
    const db = fakeDb({ stage: null, docs: [ID_DOC, ADDRESS_DOC] });
    const res = await onRepairDocsReceived({ orgId: ORG, clientId: CLIENT, payload: {} }, db);
    assert.equal(res.done, false);
    assert.equal(res.reason, "stage_not_waiting_on_documents");
  });

  it("ignores an upload from someone who is not a repair client", async () => {
    const db = fakeDb({ tier: "FULL_FUNDING", docs: [ID_DOC, ADDRESS_DOC] });
    const res = await onRepairDocsReceived({ orgId: ORG, clientId: CLIENT, payload: {} }, db);
    assert.equal(res.done, false);
    assert.equal(res.reason, "not_repair_path");
  });
});
