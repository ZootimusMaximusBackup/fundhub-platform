import { test } from "node:test";
import assert from "node:assert";
import { makeFakeDb } from "./fake-db.mjs";
import { createStore, memoryProvider } from "./store.mjs";
import {
  registerDocument, storeAndRegister, markDelivered, markSigned, updatePolicy,
  canTransitionDelivery, isPool, withTransaction
} from "./register.mjs";
import { buildDocumentKey, KINDS } from "./kinds.mjs";

const ORG = "org-fundhub";
const CLIENT = "client-001";

const deliverable = (over = {}) => ({
  orgId: ORG,
  clientId: CLIENT,
  kind: KINDS.DELIVERABLE,
  subtype: "credit_analysis_report",
  storageKey: "memory://documents/org-fundhub/client-001/deliverable/aaa.pdf",
  mimeType: "application/pdf",
  byteSize: 1024,
  checksum: "sha256:" + "a".repeat(64),
  generatedBy: "u-02-analyzer-complete-delivery",
  ...over
});

// ---------------------------------------------------------------------------
// transaction handling
// ---------------------------------------------------------------------------
test("a checked-out client is NOT mistaken for a pool", () => {
  // pg PoolClients still expose connect(); calling it re-connects an in-use
  // client. release() is what tells them apart.
  const poolClient = { query: async () => ({ rows: [] }), connect: async () => {}, release: () => {} };
  assert.strictEqual(isPool(poolClient), false);
});

test("a pg-shaped pool is recognised", () => {
  const pgPool = { query: async () => ({ rows: [] }), connect: async () => {}, totalCount: 0 };
  assert.strictEqual(isPool(pgPool), true);
});

test("the { query } wrapper from src/db.mjs is not treated as transactional", () => {
  assert.strictEqual(isPool({ query: async () => ({ rows: [] }) }), false);
});

test("withTransaction issues BEGIN/COMMIT on a pool and releases the client", async () => {
  const sql = [];
  let released = false;
  const client = {
    query: async (s) => (sql.push(String(s).split(" ")[0]), { rows: [] }),
    release: () => { released = true; }
  };
  const pool = { connect: async () => client, totalCount: 1, query: async () => ({ rows: [] }) };

  await withTransaction(pool, async (tx) => { await tx.query("SELECT 1"); });
  assert.deepStrictEqual(sql, ["BEGIN", "SELECT", "COMMIT"]);
  assert.strictEqual(released, true);
});

test("withTransaction rolls back and rethrows on failure", async () => {
  const sql = [];
  const client = {
    query: async (s) => {
      sql.push(String(s).split(" ")[0]);
      if (String(s).startsWith("BOOM")) throw new Error("boom");
      return { rows: [] };
    },
    release: () => {}
  };
  const pool = { connect: async () => client, totalCount: 1, query: async () => ({ rows: [] }) };

  await assert.rejects(() => withTransaction(pool, (tx) => tx.query("BOOM")), /boom/);
  assert.deepStrictEqual(sql, ["BEGIN", "BOOM", "ROLLBACK"]);
});

// ---------------------------------------------------------------------------
// creation
// ---------------------------------------------------------------------------
test("registerDocument creates the registry row and version 1", async () => {
  const db = makeFakeDb();
  const { document, version, created, appended, deduped } =
    await registerDocument(db, deliverable({ sourceEventId: "evt-1" }));

  assert.strictEqual(created, true);
  assert.strictEqual(appended, false);
  assert.strictEqual(deduped, false);
  assert.strictEqual(document.kind, "deliverable");
  assert.strictEqual(document.current_version, 1);
  assert.strictEqual(document.current_version_id, version.id);
  assert.strictEqual(version.version, 1);
  assert.strictEqual(version.reason, "initial");
});

test("the title falls back to the subtype's real name", async () => {
  const db = makeFakeDb();
  const { document } = await registerDocument(db, deliverable());
  assert.strictEqual(document.title, "Credit Analysis Report");
});

test("document_key defaults to kind|subtype|client", async () => {
  const db = makeFakeDb();
  const { document } = await registerDocument(db, deliverable());
  assert.strictEqual(document.document_key,
    buildDocumentKey({ kind: "deliverable", subtype: "credit_analysis_report", clientId: CLIENT }));
});

test("registerDocument validates its inputs before writing anything", async () => {
  const db = makeFakeDb();
  await assert.rejects(() => registerDocument(db, deliverable({ kind: "nope" })), /unknown document kind/);
  await assert.rejects(() => registerDocument(db, deliverable({ storageKey: null })), /requires storageKey/);
  await assert.rejects(() => registerDocument(db, deliverable({ mimeType: null })), /requires mimeType/);
  await assert.rejects(() => registerDocument(db, deliverable({ clientId: null })), /requires orgId and clientId/);
  assert.strictEqual(db._documents.length, 0);
});

// ---------------------------------------------------------------------------
// idempotency — Rule 9
// ---------------------------------------------------------------------------
test("same source event twice = one document, one version", async () => {
  const db = makeFakeDb();
  const first = await registerDocument(db, deliverable({ sourceEventId: "evt-1" }));
  const second = await registerDocument(db, deliverable({ sourceEventId: "evt-1" }));

  assert.strictEqual(second.deduped, true);
  assert.strictEqual(second.created, false);
  assert.strictEqual(second.document.id, first.document.id);
  assert.strictEqual(second.version.id, first.version.id);
  assert.strictEqual(db._documents.length, 1);
  assert.strictEqual(db._versions.length, 1);
});

test("replaying an event five times still yields one version", async () => {
  const db = makeFakeDb();
  for (let i = 0; i < 5; i++) await registerDocument(db, deliverable({ sourceEventId: "evt-replay" }));
  assert.strictEqual(db._versions.length, 1);
  assert.strictEqual(db._documents[0].current_version, 1);
});

test("a replayed event does not resurrect superseded content as current", async () => {
  const db = makeFakeDb();
  await registerDocument(db, deliverable({ sourceEventId: "evt-1", checksum: "sha256:" + "1".repeat(64) }));
  await registerDocument(db, deliverable({ sourceEventId: "evt-2", checksum: "sha256:" + "2".repeat(64) }));
  // replay of the FIRST event, long after the regeneration
  const replay = await registerDocument(db, deliverable({ sourceEventId: "evt-1", checksum: "sha256:" + "1".repeat(64) }));

  assert.strictEqual(replay.deduped, true);
  assert.strictEqual(replay.version.version, 1, "replay resolves to the original version");
  assert.strictEqual(db._documents[0].current_version, 2, "current version is untouched");
  assert.strictEqual(db._documents[0].checksum, "sha256:" + "2".repeat(64));
});

test("one event generating all five UnderwriteIQ deliverables registers five documents", async () => {
  const db = makeFakeDb();
  const five = [
    "credit_analysis_report", "metro2_dispute_letter_pack", "credit_optimization_roadmap",
    "funding_snapshot", "bank_lender_match_list"
  ];
  // analysis.completed produces all five in one pass — one event id across five documents
  for (const subtype of five) {
    await registerDocument(db, deliverable({ subtype, sourceEventId: "evt-analysis" }));
  }
  assert.strictEqual(db._documents.length, 5);
  assert.strictEqual(db._versions.length, 5);
  assert.deepStrictEqual(db._documents.map((d) => d.title), [
    "Credit Analysis Report", "Metro 2 Dispute Letter Pack", "Credit Optimization Roadmap",
    "Funding Snapshot", "Bank and Lender Match List"
  ]);

  // ...and replaying that one event re-generates none of them
  for (const subtype of five) {
    const out = await registerDocument(db, deliverable({ subtype, sourceEventId: "evt-analysis" }));
    assert.strictEqual(out.deduped, true, `${subtype} was regenerated on replay`);
  }
  assert.strictEqual(db._versions.length, 5, "replay appended no versions");
});

test("without a source event id, each call is a genuine new generation", async () => {
  const db = makeFakeDb();
  await registerDocument(db, deliverable());
  await registerDocument(db, deliverable());
  assert.strictEqual(db._documents.length, 1, "same logical document");
  assert.strictEqual(db._versions.length, 2, "two versions");
});

// ---------------------------------------------------------------------------
// versioning — never overwrite
// ---------------------------------------------------------------------------
test("regenerating appends a version and never overwrites the old one", async () => {
  const db = makeFakeDb();
  const v1 = await registerDocument(db, deliverable({
    sourceEventId: "evt-1", storageKey: "memory://v1.pdf", checksum: "sha256:" + "1".repeat(64)
  }));
  const v2 = await registerDocument(db, deliverable({
    sourceEventId: "evt-2", storageKey: "memory://v2.pdf", checksum: "sha256:" + "2".repeat(64)
  }));

  assert.strictEqual(v2.appended, true);
  assert.strictEqual(v2.created, false);
  assert.strictEqual(v2.document.id, v1.document.id);
  assert.strictEqual(v2.version.version, 2);
  assert.strictEqual(v2.version.reason, "regenerated");

  // v1's row is untouched — this is what the client can still re-access
  const stored1 = db._versions.find((v) => v.version === 1);
  assert.strictEqual(stored1.storage_key, "memory://v1.pdf");
  assert.strictEqual(stored1.checksum, "sha256:" + "1".repeat(64));
  assert.strictEqual(db._versions.length, 2);
});

test("the registry snapshot follows the newest version", async () => {
  const db = makeFakeDb();
  await registerDocument(db, deliverable({ sourceEventId: "e1", storageKey: "memory://v1.pdf" }));
  const { document } = await registerDocument(db, deliverable({
    sourceEventId: "e2", storageKey: "memory://v2.pdf", byteSize: 2048
  }));

  assert.strictEqual(document.current_version, 2);
  assert.strictEqual(document.byte_size, 2048);
  assert.strictEqual(document.storage_key, "memory://v2.pdf");
});

test("a discriminator keeps per-round documents from collapsing into one", async () => {
  const db = makeFakeDb();
  await registerDocument(db, deliverable({ subtype: "funding_snapshot", discriminator: "round-1" }));
  await registerDocument(db, deliverable({ subtype: "funding_snapshot", discriminator: "round-2" }));

  assert.strictEqual(db._documents.length, 2, "two rounds = two documents, not two versions");
  assert.strictEqual(db._versions.length, 2);
});

test("different kinds for one client are different documents", async () => {
  const db = makeFakeDb();
  await registerDocument(db, deliverable());
  await registerDocument(db, deliverable({ kind: KINDS.CONTRACT, subtype: "funding_agreement" }));
  assert.strictEqual(db._documents.length, 2);
});

// ---------------------------------------------------------------------------
// storeAndRegister — the call a workflow makes
// ---------------------------------------------------------------------------
test("storeAndRegister puts the bytes and records them in one step", async () => {
  const db = makeFakeDb();
  const store = createStore({ provider: memoryProvider() });

  const { document, version } = await storeAndRegister(db, store, {
    orgId: ORG, clientId: CLIENT, kind: KINDS.DELIVERABLE,
    subtype: "metro2_dispute_letter_pack",
    body: "PDF BYTES", mimeType: "application/pdf",
    generatedBy: "ds-02-diy-letters", sourceEventId: "evt-ds02"
  });

  assert.strictEqual(document.title, "Metro 2 Dispute Letter Pack");
  assert.strictEqual(version.byte_size, Buffer.byteLength("PDF BYTES"));
  assert.match(version.checksum, /^sha256:[0-9a-f]{64}$/);

  const bytes = await store.get(db._versions[0].storage_key);
  assert.strictEqual(bytes.body.toString("utf8"), "PDF BYTES");
});

test("storeAndRegister replayed = one document, one stored object", async () => {
  const db = makeFakeDb();
  const provider = memoryProvider();
  const store = createStore({ provider });
  const args = {
    orgId: ORG, clientId: CLIENT, kind: KINDS.DELIVERABLE, subtype: "funding_snapshot",
    body: "SNAPSHOT", mimeType: "application/pdf", sourceEventId: "evt-x"
  };
  await storeAndRegister(db, store, args);
  await storeAndRegister(db, store, args);

  assert.strictEqual(db._versions.length, 1);
  assert.strictEqual(provider._objects.size, 1, "content addressing reuses the object");
});

// ---------------------------------------------------------------------------
// delivery
// ---------------------------------------------------------------------------
test("delivery transitions move forward only", () => {
  assert.strictEqual(canTransitionDelivery("not_delivered", "sent"), true);
  assert.strictEqual(canTransitionDelivery("sent", "delivered"), true);
  assert.strictEqual(canTransitionDelivery("delivered", "sent"), false, "no walking backwards");
  assert.strictEqual(canTransitionDelivery("delivered", "delivered"), false, "already there");
  assert.strictEqual(canTransitionDelivery("sent", "bounced"), true, "a bounce is always news");
  assert.strictEqual(canTransitionDelivery("failed", "delivered"), true, "a retry can succeed");
});

test("markDelivered records the channel and stamps delivered_at", async () => {
  const db = makeFakeDb();
  const { document } = await registerDocument(db, deliverable());
  const out = await markDelivered(db, { documentId: document.id, channel: "email" });

  assert.strictEqual(out.updated, true);
  assert.strictEqual(out.version.delivery_status, "delivered");
  assert.strictEqual(out.version.delivery_channel, "email");
  assert.ok(out.version.delivered_at);
  assert.strictEqual(out.document.delivery_status, "delivered", "mirrored onto the registry row");
});

test("markDelivered is idempotent — a redelivered event writes nothing", async () => {
  const db = makeFakeDb();
  const { document } = await registerDocument(db, deliverable());
  const first = await markDelivered(db, { documentId: document.id, channel: "email" });
  const again = await markDelivered(db, { documentId: document.id, channel: "email" });

  assert.strictEqual(again.updated, false);
  assert.strictEqual(again.reason, "no_transition");
  assert.strictEqual(again.version.delivered_at.getTime?.() ?? again.version.delivered_at,
    first.version.delivered_at.getTime?.() ?? first.version.delivered_at);
});

test("a replayed 'sent' cannot walk a delivered document backwards", async () => {
  const db = makeFakeDb();
  const { document } = await registerDocument(db, deliverable());
  await markDelivered(db, { documentId: document.id, channel: "email", status: "sent" });
  await markDelivered(db, { documentId: document.id, channel: "email", status: "delivered" });
  const replay = await markDelivered(db, { documentId: document.id, channel: "email", status: "sent" });

  assert.strictEqual(replay.updated, false);
  assert.strictEqual(replay.version.delivery_status, "delivered");
});

test("delivered_at is when the client got it, not when the row was last touched", async () => {
  const db = makeFakeDb();
  const { document } = await registerDocument(db, deliverable());
  const sentAt = new Date("2026-07-01T00:00:00Z");
  await markDelivered(db, { documentId: document.id, channel: "email", status: "sent", deliveredAt: sentAt });
  const out = await markDelivered(db, {
    documentId: document.id, channel: "email", status: "delivered",
    deliveredAt: new Date("2026-07-09T00:00:00Z")
  });
  assert.strictEqual(new Date(out.version.delivered_at).toISOString(), sentAt.toISOString());
});

test("a regeneration resets delivery — the new version has not been sent", async () => {
  const db = makeFakeDb();
  const { document } = await registerDocument(db, deliverable({ sourceEventId: "e1" }));
  await markDelivered(db, { documentId: document.id, channel: "email" });
  const v2 = await registerDocument(db, deliverable({ sourceEventId: "e2", storageKey: "memory://v2.pdf" }));

  assert.strictEqual(v2.document.delivery_status, "not_delivered");
  assert.strictEqual(v2.document.delivered_at, null);
  // ...but version 1's delivery record survives intact
  const v1row = db._versions.find((v) => v.version === 1);
  assert.strictEqual(v1row.delivery_status, "delivered");
  assert.ok(v1row.delivered_at);
});

test("markDelivered can target an older version explicitly", async () => {
  const db = makeFakeDb();
  const first = await registerDocument(db, deliverable({ sourceEventId: "e1" }));
  await registerDocument(db, deliverable({ sourceEventId: "e2", storageKey: "memory://v2.pdf" }));

  const out = await markDelivered(db, {
    documentId: first.document.id, versionId: first.version.id, channel: "portal"
  });
  assert.strictEqual(out.updated, true);
  assert.strictEqual(out.version.version, 1);
  assert.strictEqual(out.document.delivery_status, "not_delivered",
    "an old version's delivery must not overwrite the current snapshot");
});

test("markDelivered on an unknown document reports rather than throws", async () => {
  const db = makeFakeDb();
  const out = await markDelivered(db, { documentId: "doc-nope", channel: "email" });
  assert.strictEqual(out.updated, false);
  assert.strictEqual(out.reason, "no_such_document");
});

test("markDelivered requires a channel — 'delivered somehow' is not a record", async () => {
  const db = makeFakeDb();
  await assert.rejects(() => markDelivered(db, { documentId: "d" }), /requires a delivery channel/);
});

// ---------------------------------------------------------------------------
// signature
// ---------------------------------------------------------------------------
test("markSigned records who signed and when", async () => {
  const db = makeFakeDb();
  const { document } = await registerDocument(db, deliverable({
    kind: KINDS.CONTRACT, subtype: "partner_license", signatureRequired: true
  }));
  const out = await markSigned(db, {
    documentId: document.id, signerName: "Jane Partner", signatureRef: "envelope-9"
  });

  assert.strictEqual(out.updated, true);
  assert.strictEqual(out.version.signer_name, "Jane Partner");
  assert.strictEqual(out.version.signature_ref, "envelope-9");
  assert.ok(out.version.signed_at);
  assert.strictEqual(out.document.signed_at, out.version.signed_at, "mirrored to the registry row");
});

test("the first signature wins — a second call cannot overwrite it", async () => {
  const db = makeFakeDb();
  const { document } = await registerDocument(db, deliverable({ kind: KINDS.CONTRACT, subtype: "funding_agreement" }));
  await markSigned(db, { documentId: document.id, signerName: "Real Signer" });
  const again = await markSigned(db, { documentId: document.id, signerName: "Someone Else" });

  assert.strictEqual(again.updated, false);
  assert.strictEqual(again.reason, "already_signed");
  assert.strictEqual(again.version.signer_name, "Real Signer");
});

test("a regeneration clears the signature on the registry row but not on the signed version", async () => {
  const db = makeFakeDb();
  const { document } = await registerDocument(db, deliverable({
    kind: KINDS.CONTRACT, subtype: "funding_agreement", sourceEventId: "e1"
  }));
  await markSigned(db, { documentId: document.id, signerName: "Jane" });
  const v2 = await registerDocument(db, deliverable({
    kind: KINDS.CONTRACT, subtype: "funding_agreement", sourceEventId: "e2", storageKey: "memory://v2.pdf"
  }));

  assert.strictEqual(v2.document.signed_at, null, "a redrafted contract is unsigned again");
  assert.strictEqual(db._versions.find((v) => v.version === 1).signer_name, "Jane");
});

// ---------------------------------------------------------------------------
// policy
// ---------------------------------------------------------------------------
test("a regeneration cannot wipe policy by omission", async () => {
  const db = makeFakeDb();
  const expires = new Date("2026-12-31T00:00:00Z");
  const { document } = await registerDocument(db, deliverable({
    kind: KINDS.AUTHORIZATION, subtype: "soft_pull_consent",
    signatureRequired: true, expiresAt: expires, sourceEventId: "e1"
  }));
  assert.strictEqual(document.signature_required, true);

  const v2 = await registerDocument(db, deliverable({
    kind: KINDS.AUTHORIZATION, subtype: "soft_pull_consent",
    sourceEventId: "e2", storageKey: "memory://v2.pdf"
  }));
  assert.strictEqual(v2.document.signature_required, true, "policy survived the regeneration");
  assert.strictEqual(v2.document.expires_at, expires);
});

test("updatePolicy is how policy is changed or cleared", async () => {
  const db = makeFakeDb();
  const { document } = await registerDocument(db, deliverable({
    kind: KINDS.AUTHORIZATION, subtype: "soft_pull_consent", expiresAt: new Date("2026-12-31T00:00:00Z")
  }));
  const updated = await updatePolicy(db, {
    documentId: document.id, expiresAt: null, title: "Soft Pull Authorization (2026)"
  });
  assert.strictEqual(updated.expires_at, null);
  assert.strictEqual(updated.title, "Soft Pull Authorization (2026)");
});
