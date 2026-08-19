// Unit tests for src/handlers/contract-signed.mjs — the contract.signed
// reaction that hands over the countersigned copy and puts the signature in
// front of a person.
//
// The five things these have to prove, from the item:
//   1. the handler is really wired to contract.signed and fires through the bus
//   2. a replay writes nothing a second time
//   3. it branches on template_key
//   4. it does NOT write a consent row (that path belongs to /api/consent/capture)
//   5. a missing client id is a safe no-op, not a crash or a duplicate task
//
// Plus one the item asked to be verified rather than assumed: that the event
// sign.mjs emits actually carries template_key and the client id.

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  onContractSigned,
  describeContract,
  deliverSignedCopy,
  register,
  CONTRACT_LABELS,
  SIGNED_WORKFLOW,
  SIGNED_TASK_ROLE
} from "./contract-signed.mjs";
import { emit } from "../events/bus.mjs";
import { emitContractEvent } from "../contracts/send.mjs";
import { clearHandlers, getHandlers } from "../events/registry.mjs";
import { registerAll, _resetRegistered } from "../register-all.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const CONTRACT = "33333333-3333-4333-8333-333333333333";
const SIGNED_DOC = "44444444-4444-4444-8444-444444444444";
const SIGNED_VER = "55555555-5555-4555-8555-555555555555";
const STAFF = "66666666-6666-4666-8666-666666666666";

function contractRow(over = {}) {
  return {
    id: CONTRACT,
    org_id: ORG,
    client_id: CLIENT,
    template_key: "FUNDING-AGREEMENT",
    title: "Funding Agreement",
    status: "signed",
    sent_by: STAFF,
    signed_at: new Date("2026-08-19T15:04:05Z"),
    signer_name: "Dana Reeves",
    signed_document_id: SIGNED_DOC,
    signed_document_version_id: SIGNED_VER,
    ...over
  };
}

/* An in-memory Postgres, small enough to read. Anything this handler is not
   supposed to touch simply has no route and lands in `other`, which is what the
   "no consent row" test reads. */
function fakeDb({ contracts = [contractRow()], hasDocument = true } = {}) {
  const versions = hasDocument
    ? [{ id: SIGNED_VER, delivery_status: "not_delivered", delivery_channel: null, delivered_at: null }]
    : [];
  const documents = hasDocument
    ? [{ id: SIGNED_DOC, current_version_id: SIGNED_VER, delivery_status: "not_delivered", delivery_channel: null, delivered_at: null }]
    : [];
  const state = {
    contracts,
    documents,
    versions,
    tasks: [],
    events: [],
    sql: [],
    other: []
  };
  let n = 0;

  state.query = async (rawSql, params = []) => {
    const sql = String(rawSql);
    state.sql.push({ sql, params });

    if (/INSERT INTO events/i.test(sql)) {
      const [org_id, name, version, idempotency_key, client_id, payload] = params;
      if (idempotency_key && state.events.some((e) => e.idempotency_key === idempotency_key)) {
        return { rows: [] };
      }
      const row = { id: `evt-${++n}`, org_id, name, version, idempotency_key, client_id, payload };
      state.events.push(row);
      return { rows: [{ id: row.id }] };
    }

    if (/FROM contracts/i.test(sql)) {
      const [id, orgId] = params;
      const hit = state.contracts.find(
        (c) => c.id === id && String(c.org_id) === String(orgId)
      );
      return { rows: hit ? [hit] : [] };
    }

    if (/SELECT \* FROM documents WHERE id/i.test(sql)) {
      const hit = state.documents.find((d) => d.id === params[0]);
      return { rows: hit ? [hit] : [] };
    }

    if (/FROM document_versions WHERE id/i.test(sql)) {
      const hit = state.versions.find((v) => v.id === params[0]);
      return { rows: hit ? [hit] : [] };
    }

    if (/UPDATE document_versions/i.test(sql)) {
      const [id, status, channel, at] = params;
      const v = state.versions.find((r) => r.id === id);
      if (!v) return { rows: [] };
      v.delivery_status = status;
      v.delivery_channel = channel;
      if (status === "sent" || status === "delivered") v.delivered_at = v.delivered_at ?? at;
      return { rows: [v] };
    }

    if (/UPDATE documents/i.test(sql)) {
      const [id, status, channel, at] = params;
      const d = state.documents.find((r) => r.id === id);
      if (!d) return { rows: [] };
      d.delivery_status = status;
      d.delivery_channel = channel;
      d.delivered_at = at;
      return { rows: [d] };
    }

    if (/SELECT id FROM tasks/i.test(sql)) {
      const [clientId, workflow, body] = params;
      const hit = state.tasks.find(
        (t) => t.client_id === clientId && t.source_workflow === workflow && t.body === body
      );
      return { rows: hit ? [{ id: hit.id }] : [] };
    }

    if (/INSERT INTO tasks/i.test(sql)) {
      const [org_id, client_id, title, body, due_at, source_workflow, assignee_role, assignee_staff_id] = params;
      const row = {
        id: `task-${++n}`, org_id, client_id, title, body, due_at,
        source_workflow, assignee_role, assignee_staff_id
      };
      state.tasks.push(row);
      return { rows: [{ id: row.id }] };
    }

    state.other.push({ sql, params });
    return { rows: [] };
  };

  return state;
}

const signedEvent = (payload = {}) => ({
  id: "evt-contract-signed-1",
  name: "contract.signed",
  orgId: ORG,
  clientId: CLIENT,
  payload: {
    contract_id: CONTRACT,
    client_id: CLIENT,
    template_key: "FUNDING-AGREEMENT",
    kind: "contract",
    subtype: "funding_agreement",
    status: "signed",
    ...payload
  }
});

// ---------------------------------------------------------------------------
// 1. it is actually wired up
// ---------------------------------------------------------------------------

describe("registration", () => {
  let savedInngestKey;

  beforeEach(() => {
    /* The bus fans out to Inngest when this is set, and a unit test must never
       reach a live workflow engine. Removed for the duration and put back. */
    savedInngestKey = process.env.INNGEST_EVENT_KEY;
    delete process.env.INNGEST_EVENT_KEY;
    clearHandlers();
    _resetRegistered();
  });

  afterEach(() => {
    if (savedInngestKey === undefined) delete process.env.INNGEST_EVENT_KEY;
    else process.env.INNGEST_EVENT_KEY = savedInngestKey;
    clearHandlers();
    _resetRegistered();
  });

  test("registerAll() puts a handler on contract.signed", () => {
    assert.equal(
      getHandlers("contract.signed").length, 0,
      "nothing should be listening before boot"
    );
    registerAll();
    const handlers = getHandlers("contract.signed");
    /* Two listeners now, not one. This one delivers the signed copy and raises
       the task; src/handlers/contract-consent.mjs is the second, and it writes
       the soft-pull consent row a signed SOFT-PULL-CONSENT earns (owner call,
       2026-08-19 — it reverses the "NO CONSENT ROW" note at the top of
       contract-signed.mjs, which is left in place as the record of the earlier
       decision). They are independent: src/events/bus.mjs runs each in
       isolation, so neither can break the other. Assert on membership rather
       than on a count, so the next handler to subscribe does not fail this. */
    assert.ok(
      handlers.includes(onContractSigned),
      "this handler must still be on contract.signed after boot"
    );
  });

  test("register() alone is enough, and registering twice adds one handler", () => {
    register();
    register();
    assert.equal(getHandlers("contract.signed").length, 1);
  });

  test("emitting contract.signed through the real bus delivers the copy and makes a task", async () => {
    const db = fakeDb();
    register();

    const res = await emit(db, "contract.signed", signedEvent().payload, {
      orgId: ORG,
      clientId: CLIENT,
      idempotencyKey: `contract.signed:${CONTRACT}`,
      throwOnHandlerError: true
    });

    assert.equal(res.deduped, false);
    assert.equal(db.versions[0].delivery_status, "sent",
      "the countersigned copy is still marked not_delivered — this is the whole of T2-24");
    assert.equal(db.versions[0].delivery_channel, "portal");
    assert.equal(db.tasks.length, 1, "a signature that reaches no person is the whole of T2-17");
  });
});

// ---------------------------------------------------------------------------
// 2. the payload sign.mjs emits really carries what this handler needs
// ---------------------------------------------------------------------------

test("the contract.signed payload carries template_key and the client id", async () => {
  const db = fakeDb();
  clearHandlers();

  await emitContractEvent(db, "contract.signed", contractRow());

  const row = db.events[0];
  assert.ok(row, "no event was written at all");
  assert.equal(row.name, "contract.signed");
  assert.equal(row.org_id, ORG);
  assert.equal(row.client_id, CLIENT, "the event row itself must name the client");
  assert.equal(row.payload.template_key, "FUNDING-AGREEMENT");
  assert.equal(row.payload.client_id, CLIENT);
  assert.equal(row.payload.contract_id, CONTRACT);
  assert.equal(row.idempotency_key, `contract.signed:${CONTRACT}`);
  assert.equal(row.payload.rendered_body, undefined,
    "a consumer's signed agreement must never be copied into the events table");
});

// ---------------------------------------------------------------------------
// 3. the signed copy is handed over
// ---------------------------------------------------------------------------

describe("the signed copy", () => {
  test("is marked sent over the portal, dated when they signed", async () => {
    const db = fakeDb();
    const res = await onContractSigned(signedEvent(), db);

    assert.equal(res.done, true);
    assert.equal(res.delivery.delivered, true);
    assert.equal(db.versions[0].delivery_status, "sent");
    assert.equal(db.versions[0].delivery_channel, "portal");
    assert.equal(
      new Date(db.versions[0].delivered_at).toISOString(),
      "2026-08-19T15:04:05.000Z",
      "delivered_at must be when they signed, not when this happened to run"
    );
    assert.equal(db.documents[0].delivery_status, "sent");
  });

  test("a contract whose signed PDF never built is reported, not invented", async () => {
    const db = fakeDb({ contracts: [contractRow({ signed_document_id: null, signed_document_version_id: null })] });
    const res = await onContractSigned(signedEvent(), db);

    assert.equal(res.delivery.delivered, false);
    assert.equal(res.delivery.reason, "no_signed_document");
    assert.equal(db.versions[0].delivery_status, "not_delivered");
    assert.match(db.tasks[0].body, /NO SIGNED FILE WAS PRODUCED/,
      "staff must be told there is no copy before they promise one");
  });

  test("a document row that has gone missing is a no-op, not a crash", async () => {
    const db = fakeDb({ hasDocument: false });
    const res = await onContractSigned(signedEvent(), db);
    assert.equal(res.done, true);
    assert.equal(res.delivery.delivered, false);
    assert.equal(res.delivery.reason, "no_such_document");
  });

  test("deliverSignedCopy on nothing at all does not throw", async () => {
    const db = fakeDb();
    assert.deepEqual(await deliverSignedCopy(db, null), {
      delivered: false, reason: "no_signed_document"
    });
  });
});

// ---------------------------------------------------------------------------
// 4. the task
// ---------------------------------------------------------------------------

describe("the task", () => {
  test("goes to whoever sent the contract, owned by the closer queue", async () => {
    const db = fakeDb();
    await onContractSigned(signedEvent(), db);

    const task = db.tasks[0];
    assert.equal(task.org_id, ORG);
    assert.equal(task.client_id, CLIENT);
    assert.equal(task.source_workflow, SIGNED_WORKFLOW);
    assert.equal(task.assignee_role, SIGNED_TASK_ROLE);
    assert.equal(task.assignee_staff_id, STAFF);
    assert.match(task.title, /^Contract signed: Funding Agreement — Dana Reeves$/);
    assert.match(task.body, /Dana Reeves signed "Funding Agreement"/);
    assert.match(task.body, /on 2026-08-19/);
    assert.match(task.body, new RegExp(`Contract ${CONTRACT}`));
  });

  test("an unsigned-looking row with no signer name still reads as a sentence", async () => {
    const db = fakeDb({ contracts: [contractRow({ signer_name: "  " })] });
    await onContractSigned(signedEvent(), db);
    assert.match(db.tasks[0].body, /^The client signed "Funding Agreement"/);
  });
});

// ---------------------------------------------------------------------------
// 5. it branches on template_key
// ---------------------------------------------------------------------------

describe("branching on template_key", () => {
  test("every template key this platform sends has plain words", () => {
    assert.equal(describeContract("SOFT-PULL-CONSENT"), "soft-pull consent");
    assert.equal(describeContract("FUNDING-AGREEMENT"), "funding agreement");
    assert.equal(describeContract("CREDIT-REPAIR-AGREEMENT"), "credit repair agreement");
    assert.equal(describeContract("REPAIR-TRIAL-AGREEMENT"), "repair test-run agreement");
    assert.equal(describeContract("REPAIR-AND-FUNDING-AGREEMENT"), "repair and funding agreement");
    assert.equal(Object.keys(CONTRACT_LABELS).length, 5);
  });

  test("a key we do not know gets NO invented description", () => {
    assert.equal(describeContract("SOME-UPLOADED-PDF"), null);
    assert.equal(describeContract(null), null);
    assert.equal(describeContract(""), null);
  });

  test("each branch reaches the task body", async () => {
    for (const [key, label] of Object.entries(CONTRACT_LABELS)) {
      const db = fakeDb({ contracts: [contractRow({ template_key: key, title: `Doc ${key}` })] });
      await onContractSigned(signedEvent({ template_key: key }), db);
      assert.equal(db.tasks.length, 1);
      assert.match(db.tasks[0].body, new RegExp(`\\(${label}\\)`), `${key} did not reach the task`);
      assert.equal(db.tasks[0].source_workflow, SIGNED_WORKFLOW);
    }
  });

  test("an unknown template still delivers the copy and still makes a task", async () => {
    const db = fakeDb({ contracts: [contractRow({ template_key: "CUSTOM-THING", title: "Side letter" })] });
    const res = await onContractSigned(signedEvent({ template_key: "CUSTOM-THING" }), db);

    assert.equal(res.label, null);
    assert.equal(db.versions[0].delivery_status, "sent");
    assert.equal(db.tasks.length, 1);
    assert.ok(!db.tasks[0].body.includes("("), "an unknown contract must not be described as something");
  });
});

// ---------------------------------------------------------------------------
// 6. it stays out of the consent lane
// ---------------------------------------------------------------------------

describe("what it must never write", () => {
  test("signing SOFT-PULL-CONSENT writes NO consent row", async () => {
    const db = fakeDb({ contracts: [contractRow({ template_key: "SOFT-PULL-CONSENT", title: "Soft pull consent" })] });
    await onContractSigned(signedEvent({ template_key: "SOFT-PULL-CONSENT" }), db);

    const consentWrites = db.sql.filter((q) => /consent/i.test(q.sql));
    assert.deepEqual(
      consentWrites, [],
      "consent is captured by POST /api/consent/capture — two writers for one permission is how a revocation stops biting"
    );
    assert.deepEqual(db.other, [], "this handler issued a query nothing here accounts for");
  });

  test("nothing is granted, moved or mailed", async () => {
    const db = fakeDb();
    await onContractSigned(signedEvent(), db);

    const forbidden = /entitlement|INSERT INTO messages|INSERT INTO cards|UPDATE cards|product_entitlements|INSERT INTO sales/i;
    assert.deepEqual(
      db.sql.filter((q) => forbidden.test(q.sql)), [],
      "unlocking, moving a card or mailing a client are all undecided — none may happen here"
    );
  });
});

// ---------------------------------------------------------------------------
// 7. replay
// ---------------------------------------------------------------------------

describe("idempotency", () => {
  test("the same signature twice delivers once and makes ONE task", async () => {
    const db = fakeDb();
    const first = await onContractSigned(signedEvent(), db);
    const second = await onContractSigned(signedEvent(), db);

    assert.equal(first.delivery.delivered, true);
    assert.equal(second.delivery.delivered, false,
      "delivery only moves forward — a replayed 'sent' must write nothing");
    assert.equal(second.delivery.reason, "no_transition");
    assert.equal(db.tasks.length, 1);
    assert.equal(second.task.created, false);
    assert.equal(second.task.reason, "duplicate_event");
  });

  test("a replay cannot move the delivery date", async () => {
    const db = fakeDb();
    await onContractSigned(signedEvent(), db);
    const stamped = db.versions[0].delivered_at;
    await onContractSigned(signedEvent(), db);
    assert.equal(db.versions[0].delivered_at, stamped);
  });

  test("ten replays are still one task", async () => {
    const db = fakeDb();
    for (let i = 0; i < 10; i++) await onContractSigned(signedEvent(), db);
    assert.equal(db.tasks.length, 1);
  });
});

// ---------------------------------------------------------------------------
// 8. bad or hostile events
// ---------------------------------------------------------------------------

describe("events that are missing something", () => {
  test("no client id on the contract means no task, and no crash", async () => {
    const db = fakeDb({ contracts: [contractRow({ client_id: null })] });
    const res = await onContractSigned(
      { id: "evt-x", name: "contract.signed", orgId: ORG, payload: { contract_id: CONTRACT } },
      db
    );

    assert.equal(res.done, false);
    assert.equal(res.reason, "no_client");
    assert.equal(db.tasks.length, 0,
      "a task with no client id cannot be deduped, so a replay would write a second one");
    assert.equal(db.versions[0].delivery_status, "sent",
      "the copy is still handed over — the missing id only blocks the task");
  });

  test("no contract id on the payload touches nothing", async () => {
    const db = fakeDb();
    const res = await onContractSigned({ orgId: ORG, payload: {} }, db);
    assert.deepEqual(res, { done: false, reason: "no_contract" });
    assert.equal(db.sql.length, 0);
  });

  test("no org id touches nothing", async () => {
    const db = fakeDb();
    const res = await onContractSigned({ payload: { contract_id: CONTRACT } }, db);
    assert.deepEqual(res, { done: false, reason: "no_contract" });
    assert.equal(db.sql.length, 0);
  });

  test("an event naming another company's contract finds nothing", async () => {
    const db = fakeDb();
    const res = await onContractSigned(
      { orgId: "99999999-9999-4999-8999-999999999999", payload: { contract_id: CONTRACT } },
      db
    );
    assert.deepEqual(res, { done: false, reason: "contract_not_found" });
    assert.equal(db.tasks.length, 0);
    assert.equal(db.versions[0].delivery_status, "not_delivered");
  });

  test("an empty event object does not throw", async () => {
    const db = fakeDb();
    const res = await onContractSigned({}, db);
    assert.equal(res.done, false);
  });
});
