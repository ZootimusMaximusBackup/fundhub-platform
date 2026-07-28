import { test } from "node:test";
import assert from "node:assert";
import { makeFakeDb } from "./fake-db.mjs";
import { registerDocument, markDelivered } from "./register.mjs";
import {
  listClientLibrary, getByClientAndKind, listByKind, getDocument, getHistory,
  getVersion, resolveStorageTarget, shapeDocument, shapeVersion
} from "./retrieve.mjs";
import { KINDS } from "./kinds.mjs";

const ORG = "org-fundhub";
const CLIENT = "client-001";
const OTHER = "client-002";
const SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef";

const doc = (over = {}) => ({
  orgId: ORG, clientId: CLIENT, kind: KINDS.DELIVERABLE, subtype: "credit_analysis_report",
  storageKey: "memory://secret-object-path.pdf", mimeType: "application/pdf",
  byteSize: 1024, checksum: "sha256:" + "a".repeat(64), generatedBy: "u-02", ...over
});

/** Wraps the fake db so a test can assert how many round trips a read costs. */
function counting(db) {
  const calls = [];
  return { db: { query: (sql, p) => (calls.push(sql), db.query(sql, p)) }, calls };
}

async function seedLibrary() {
  const db = makeFakeDb();
  await registerDocument(db, doc({ sourceEventId: "e1" }));
  await registerDocument(db, doc({ sourceEventId: "e2", storageKey: "memory://v2.pdf" })); // v2
  await registerDocument(db, doc({
    kind: KINDS.CONTRACT, subtype: "funding_agreement", sourceEventId: "e3"
  }));
  await registerDocument(db, doc({
    kind: KINDS.AUTHORIZATION, subtype: "soft_pull_consent", sourceEventId: "e4"
  }));
  await registerDocument(db, doc({ clientId: OTHER, sourceEventId: "e5" }));
  return db;
}

// ---------------------------------------------------------------------------
// the portal read
// ---------------------------------------------------------------------------
test("listClientLibrary returns everything the client owns, newest version each", async () => {
  const db = await seedLibrary();
  const rows = await listClientLibrary(db, { orgId: ORG, clientId: CLIENT });

  assert.strictEqual(rows.length, 3, "three documents, not four versions");
  assert.deepStrictEqual(rows.map((r) => r.kind), ["authorization", "contract", "deliverable"]);

  const report = rows.find((r) => r.subtype === "credit_analysis_report");
  assert.strictEqual(report.current_version, 2, "newest version");
  assert.strictEqual(report.version_count, 2, "history is still countable");
});

test("the portal read is ONE query, not N+1", async () => {
  const db = await seedLibrary();
  const { db: counted, calls } = counting(db);
  const rows = await listClientLibrary(counted, { orgId: ORG, clientId: CLIENT });

  assert.strictEqual(calls.length, 1, `expected 1 query, got ${calls.length}`);
  assert.strictEqual(rows.length, 3);
});

test("the portal read stays one query when signed urls are attached", async () => {
  const db = await seedLibrary();
  const { db: counted, calls } = counting(db);
  const rows = await listClientLibrary(counted, {
    orgId: ORG, clientId: CLIENT, sign: { secret: SECRET }
  });

  assert.strictEqual(calls.length, 1);
  for (const r of rows) {
    assert.match(r.download.url, /^\/api\/documents\/.+sig=[0-9a-f]{64}$/);
    assert.ok(r.download.expiresAt > 0);
  }
});

test("another client's documents are not in this client's library", async () => {
  const db = await seedLibrary();
  const rows = await listClientLibrary(db, { orgId: ORG, clientId: CLIENT });
  assert.ok(rows.every((r) => r.client_id === CLIENT));
});

test("kinds filter narrows the library", async () => {
  const db = await seedLibrary();
  const rows = await listClientLibrary(db, {
    orgId: ORG, clientId: CLIENT, kinds: ["contract", "authorization"]
  });
  assert.deepStrictEqual(rows.map((r) => r.kind), ["authorization", "contract"]);
});

test("documentIds filter is the entitlement pre-filter — still one query", async () => {
  const db = await seedLibrary();
  const all = await listClientLibrary(db, { orgId: ORG, clientId: CLIENT });
  const entitled = [all[0].id, all[2].id];

  const { db: counted, calls } = counting(db);
  const rows = await listClientLibrary(counted, {
    orgId: ORG, clientId: CLIENT, documentIds: entitled
  });

  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(rows.map((r) => r.id).sort(), entitled.sort());
});

test("an empty entitlement list returns nothing rather than everything", async () => {
  const db = await seedLibrary();
  const rows = await listClientLibrary(db, { orgId: ORG, clientId: CLIENT, documentIds: [] });
  assert.strictEqual(rows.length, 0);
});

test("listClientLibrary requires the org and client", async () => {
  const db = makeFakeDb();
  await assert.rejects(() => listClientLibrary(db, { orgId: ORG }), /requires orgId and clientId/);
});

// ---------------------------------------------------------------------------
// expiry — flagged, not hidden
// ---------------------------------------------------------------------------
test("an expired document is flagged, not hidden", async () => {
  const db = makeFakeDb();
  await registerDocument(db, doc({
    kind: KINDS.AUTHORIZATION, subtype: "soft_pull_consent",
    expiresAt: new Date("2020-01-01T00:00:00Z")
  }));
  const rows = await listClientLibrary(db, { orgId: ORG, clientId: CLIENT });
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].expired, true);
});

test("includeExpired: false drops expired documents", async () => {
  const db = makeFakeDb();
  await registerDocument(db, doc({
    kind: KINDS.AUTHORIZATION, subtype: "soft_pull_consent",
    expiresAt: new Date("2020-01-01T00:00:00Z")
  }));
  const rows = await listClientLibrary(db, { orgId: ORG, clientId: CLIENT, includeExpired: false });
  assert.strictEqual(rows.length, 0);
});

test("a document with no expiry is never expired — the common case", async () => {
  const db = makeFakeDb();
  await registerDocument(db, doc());
  const [row] = await listClientLibrary(db, { orgId: ORG, clientId: CLIENT });
  assert.strictEqual(row.expires_at, null);
  assert.strictEqual(row.expired, false);
});

// ---------------------------------------------------------------------------
// by client + kind: newest by default, history on request
// ---------------------------------------------------------------------------
test("getByClientAndKind returns the newest version by default", async () => {
  const db = await seedLibrary();
  const { document, version, history } = await getByClientAndKind(db, {
    orgId: ORG, clientId: CLIENT, kind: KINDS.DELIVERABLE
  });
  assert.strictEqual(version, 2);
  assert.strictEqual(document.current_version, 2);
  assert.strictEqual(history, null, "history is opt-in");
});

test("the default read is a single query", async () => {
  const db = await seedLibrary();
  const { db: counted, calls } = counting(db);
  await getByClientAndKind(counted, { orgId: ORG, clientId: CLIENT, kind: KINDS.DELIVERABLE });
  assert.strictEqual(calls.length, 1);
});

test("history: true returns every version, newest first", async () => {
  const db = await seedLibrary();
  const { history } = await getByClientAndKind(db, {
    orgId: ORG, clientId: CLIENT, kind: KINDS.DELIVERABLE, history: true
  });
  assert.deepStrictEqual(history.map((h) => h.version), [2, 1]);
});

test("subtype narrows within a kind", async () => {
  const db = await seedLibrary();
  const hit = await getByClientAndKind(db, {
    orgId: ORG, clientId: CLIENT, kind: KINDS.CONTRACT, subtype: "funding_agreement"
  });
  assert.ok(hit.document);
  const miss = await getByClientAndKind(db, {
    orgId: ORG, clientId: CLIENT, kind: KINDS.CONTRACT, subtype: "partner_license"
  });
  assert.strictEqual(miss.document, null);
  assert.strictEqual(miss.history, null);
});

test("a client with no documents of that kind gets a clean null", async () => {
  const db = makeFakeDb();
  const out = await getByClientAndKind(db, { orgId: ORG, clientId: CLIENT, kind: KINDS.CONTRACT });
  assert.deepStrictEqual(out, { document: null, version: null, history: null });
});

test("listByKind returns every document of a kind", async () => {
  const db = await seedLibrary();
  const rows = await listByKind(db, { orgId: ORG, clientId: CLIENT, kind: KINDS.DELIVERABLE });
  assert.strictEqual(rows.length, 1);
});

// ---------------------------------------------------------------------------
// history — what the client was actually sent
// ---------------------------------------------------------------------------
test("each historical version keeps its own delivery record and its own link", async () => {
  const db = makeFakeDb();
  const first = await registerDocument(db, doc({ sourceEventId: "e1" }));
  await markDelivered(db, { documentId: first.document.id, channel: "email" });
  await registerDocument(db, doc({ sourceEventId: "e2", storageKey: "memory://v2.pdf" }));

  const history = await getHistory(db, {
    documentId: first.document.id, sign: { secret: SECRET }
  });

  assert.strictEqual(history.length, 2);
  const [v2, v1] = history;
  assert.strictEqual(v2.delivery_status, "not_delivered");
  assert.strictEqual(v1.delivery_status, "delivered", "the version they were actually sent");
  assert.notStrictEqual(v1.download.url, v2.download.url, "links are version-pinned");
  assert.ok(v1.download.url.includes(`v=${v1.id}`));
});

test("getVersion fetches one specific generation", async () => {
  const db = await seedLibrary();
  const [row] = await listByKind(db, { orgId: ORG, clientId: CLIENT, kind: KINDS.DELIVERABLE });
  const v1 = await getVersion(db, { documentId: row.id, version: 1 });
  assert.strictEqual(v1.version, 1);
});

test("getHistory requires a document id", async () => {
  const db = makeFakeDb();
  await assert.rejects(() => getHistory(db, {}), /requires documentId/);
});

// ---------------------------------------------------------------------------
// storage keys never leak — the whole point of the shaping layer
// ---------------------------------------------------------------------------
test("no read path returns a storage key", async () => {
  const db = await seedLibrary();
  const [row] = await listClientLibrary(db, { orgId: ORG, clientId: CLIENT, kinds: ["deliverable"] });

  const payloads = [
    await listClientLibrary(db, { orgId: ORG, clientId: CLIENT, sign: { secret: SECRET } }),
    await getByClientAndKind(db, { orgId: ORG, clientId: CLIENT, kind: KINDS.DELIVERABLE, history: true, sign: { secret: SECRET } }),
    await getDocument(db, { orgId: ORG, documentId: row.id, sign: { secret: SECRET } }),
    await getHistory(db, { documentId: row.id, sign: { secret: SECRET } }),
    await getVersion(db, { documentId: row.id, version: 1 }),
    await listByKind(db, { orgId: ORG, clientId: CLIENT, kind: KINDS.DELIVERABLE })
  ];

  for (const p of payloads) {
    const blob = JSON.stringify(p);
    assert.ok(!blob.includes("storage_key"), `storage_key leaked into: ${blob.slice(0, 120)}`);
    assert.ok(!blob.includes("memory://"), `a raw object path leaked into: ${blob.slice(0, 120)}`);
  }
});

test("shapeDocument strips a storage key even if a query hands it one", () => {
  const shaped = shapeDocument({
    id: "doc-1", kind: "deliverable", storage_key: "https://blob.vercel-storage.com/secret",
    expires_at: null, current_version_id: "ver-1"
  });
  assert.strictEqual(shaped.storage_key, undefined);
  assert.ok(!JSON.stringify(shaped).includes("vercel-storage"));
});

test("shapeVersion strips a storage key too", () => {
  const shaped = shapeVersion({
    id: "ver-1", document_id: "doc-1", version: 1, storage_key: "memory://x.pdf"
  });
  assert.strictEqual(shaped.storage_key, undefined);
});

test("shaping does not mint a url unless signing was requested", async () => {
  const db = await seedLibrary();
  const rows = await listClientLibrary(db, { orgId: ORG, clientId: CLIENT });
  assert.ok(rows.every((r) => r.download === undefined), "internal reads mint no links");
});

// ---------------------------------------------------------------------------
// the fenced-off function
// ---------------------------------------------------------------------------
test("resolveStorageTarget is the one place a storage key comes back", async () => {
  const db = await seedLibrary();
  const [row] = await listByKind(db, { orgId: ORG, clientId: CLIENT, kind: KINDS.DELIVERABLE });

  const current = await resolveStorageTarget(db, { documentId: row.id });
  assert.strictEqual(current.storage_key, "memory://v2.pdf");
  assert.strictEqual(current.version, 2);

  const v1 = await getVersion(db, { documentId: row.id, version: 1 });
  const pinned = await resolveStorageTarget(db, { documentId: row.id, versionId: v1.id });
  assert.strictEqual(pinned.storage_key, "memory://secret-object-path.pdf");
  assert.strictEqual(pinned.version, 1);
  assert.strictEqual(pinned.client_id, CLIENT, "carries the owner so the route can authorize");
});

test("resolveStorageTarget returns null for an unknown document", async () => {
  const db = makeFakeDb();
  assert.strictEqual(await resolveStorageTarget(db, { documentId: "nope" }), null);
});
