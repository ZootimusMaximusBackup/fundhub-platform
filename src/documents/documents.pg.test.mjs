// Real-Postgres integration test for the documents registry.
// SKIPS unless DATABASE_URL is set (so `npm test` stays green without a DB).
// Run live:  DATABASE_URL=postgres://... npm run migrate && DATABASE_URL=... npm test
//
// This is the authoritative proof for the claims the unit tests can only model:
//   * the real column lists never return storage_key
//   * the two unique indexes really do absorb a replayed generation event
//   * the delete guards and the immutability trigger really do fire
//   * the portal read really is one statement against real SQL
//
// Everything runs inside ONE transaction that is rolled back at the end —
// necessary here rather than merely tidy, because the tables block DELETE, so a
// test that committed could never clean up after itself. Statements expected to
// raise are wrapped in savepoints so the outer transaction survives them.

import { test, before, after } from "node:test";
import assert from "node:assert";
import { pool, close } from "../db.mjs";
import { registerDocument, markDelivered, markSigned } from "./register.mjs";
import {
  listClientLibrary, getByClientAndKind, getHistory, getDocument, resolveStorageTarget
} from "./retrieve.mjs";
import { KINDS } from "./kinds.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const EMAIL = "documents_pg_test@example.com";

let db = null;      // a pinned client inside the outer transaction
let ORG = null;
let CLIENT = null;

const doc = (over = {}) => ({
  orgId: ORG, clientId: CLIENT, kind: KINDS.DELIVERABLE, subtype: "credit_analysis_report",
  storageKey: "memory://documents/pg/v1.pdf", mimeType: "application/pdf",
  byteSize: 1024, checksum: "sha256:" + "a".repeat(64), generatedBy: "u-02-analyzer-complete-delivery",
  ...over
});

/** Run a statement that is expected to raise, without poisoning the transaction. */
async function expectRaise(sql, params, matcher) {
  await db.query("SAVEPOINT sp");
  let raised = null;
  try {
    await db.query(sql, params);
  } catch (err) {
    raised = err;
  } finally {
    await db.query("ROLLBACK TO SAVEPOINT sp");
  }
  assert.ok(raised, `expected ${sql.slice(0, 48)}… to raise`);
  if (matcher) assert.match(raised.message, matcher);
  return raised;
}

before(async () => {
  if (!HAS_DB) return;
  db = await pool().connect();
  await db.query("BEGIN");
  ORG = (await db.query(`SELECT id FROM orgs WHERE slug = 'fundhub'`)).rows[0].id;
  CLIENT = (await db.query(
    `INSERT INTO clients (org_id, email, first_name) VALUES ($1, $2, 'Docs') RETURNING id`,
    [ORG, EMAIL])).rows[0].id;
});

after(async () => {
  if (!HAS_DB) return;
  await db.query("ROLLBACK");
  db.release();
  await close();
});

// ---------------------------------------------------------------------------
test("registers a document and version 1 against real SQL", { skip: !HAS_DB }, async () => {
  const { document, version, created } = await registerDocument(db, doc({ sourceEventId: "pg-evt-1" }));

  assert.strictEqual(created, true);
  assert.strictEqual(document.kind, "deliverable");
  assert.strictEqual(document.title, "Credit Analysis Report");
  assert.strictEqual(document.current_version, 1);
  assert.strictEqual(document.current_version_id, version.id);
  assert.strictEqual(document.delivery_status, "not_delivered");
  assert.strictEqual(document.expires_at, null, "most documents never expire");
  assert.strictEqual(Number(version.byte_size), 1024);
});

test("same source event twice = one document (real unique index)", { skip: !HAS_DB }, async () => {
  const again = await registerDocument(db, doc({ sourceEventId: "pg-evt-1" }));
  assert.strictEqual(again.deduped, true);
  assert.strictEqual(again.version.version, 1);

  const n = await db.query(
    `SELECT count(*)::int AS c FROM document_versions WHERE org_id = $1 AND source_event_id = $2`,
    [ORG, "pg-evt-1"]);
  assert.strictEqual(n.rows[0].c, 1);
});

test("regenerating appends version 2 and leaves version 1 byte-for-byte intact",
  { skip: !HAS_DB }, async () => {
    const before1 = (await db.query(
      `SELECT * FROM document_versions WHERE source_event_id = $1`, ["pg-evt-1"])).rows[0];

    const v2 = await registerDocument(db, doc({
      sourceEventId: "pg-evt-2",
      storageKey: "memory://documents/pg/v2.pdf",
      checksum: "sha256:" + "b".repeat(64),
      byteSize: 2048
    }));

    assert.strictEqual(v2.appended, true);
    assert.strictEqual(v2.version.version, 2);
    assert.strictEqual(v2.document.current_version, 2);
    assert.strictEqual(v2.document.storage_key, "memory://documents/pg/v2.pdf");

    const after1 = (await db.query(
      `SELECT * FROM document_versions WHERE source_event_id = $1`, ["pg-evt-1"])).rows[0];
    assert.deepStrictEqual(after1, before1, "version 1 was not touched by the regeneration");
  });

test("the version history is visible and ordered newest first", { skip: !HAS_DB }, async () => {
  const { document } = await getByClientAndKind(db, {
    orgId: ORG, clientId: CLIENT, kind: KINDS.DELIVERABLE
  });
  const history = await getHistory(db, { orgId: ORG, documentId: document.id });
  assert.deepStrictEqual(history.map((h) => h.version), [2, 1]);
  assert.strictEqual(history[1].reason, "initial");
  assert.strictEqual(history[0].reason, "regenerated");
});

// ---------------------------------------------------------------------------
// the guarantees that only the database can enforce
// ---------------------------------------------------------------------------
test("documents cannot be deleted", { skip: !HAS_DB }, async () => {
  await expectRaise(`DELETE FROM documents WHERE client_id = $1`, [CLIENT],
    /documents are never deleted/);
});

test("version history cannot be deleted", { skip: !HAS_DB }, async () => {
  await expectRaise(`DELETE FROM document_versions WHERE org_id = $1`, [ORG],
    /append-only and cannot be deleted/);
});

test("a stored artifact cannot be overwritten in place", { skip: !HAS_DB }, async () => {
  await expectRaise(
    `UPDATE document_versions SET storage_key = 'memory://swapped.pdf' WHERE org_id = $1`, [ORG],
    /immutable — register a new version instead/);
  await expectRaise(
    `UPDATE document_versions SET checksum = 'sha256:${"c".repeat(64)}' WHERE org_id = $1`, [ORG],
    /immutable/);
});

test("delivery and signature columns stay writable on a stored version", { skip: !HAS_DB }, async () => {
  const res = await db.query(
    `UPDATE document_versions SET delivery_status = 'pending'
      WHERE org_id = $1 AND version = 1 RETURNING delivery_status`, [ORG]);
  assert.strictEqual(res.rows[0].delivery_status, "pending");
  await db.query(`UPDATE document_versions SET delivery_status = 'not_delivered' WHERE org_id = $1 AND version = 1`, [ORG]);
});

test("the kind enum rejects anything outside the four classes", { skip: !HAS_DB }, async () => {
  await expectRaise(
    `INSERT INTO documents (org_id, client_id, document_key, kind, title, storage_key, mime_type)
     VALUES ($1, $2, 'bad|key', 'receipt', 't', 'k', 'application/pdf')`,
    [ORG, CLIENT], /documents_kind_check/);
});

test("a checksum without an algorithm prefix is rejected", { skip: !HAS_DB }, async () => {
  await expectRaise(
    `INSERT INTO documents (org_id, client_id, document_key, kind, title, storage_key, mime_type, checksum)
     VALUES ($1, $2, 'ck|key', 'deliverable', 't', 'k', 'application/pdf', 'deadbeef')`,
    [ORG, CLIENT], /checksum/);
});

test("a delivery with no channel is rejected", { skip: !HAS_DB }, async () => {
  await expectRaise(
    `UPDATE documents SET delivered_at = now() WHERE client_id = $1`, [CLIENT], /documents_check/);
});

// ---------------------------------------------------------------------------
// delivery + signature
// ---------------------------------------------------------------------------
test("delivery is recorded on the version and mirrored to the registry row",
  { skip: !HAS_DB }, async () => {
    const { document } = await getByClientAndKind(db, {
      orgId: ORG, clientId: CLIENT, kind: KINDS.DELIVERABLE
    });
    const out = await markDelivered(db, { documentId: document.id, channel: "email" });
    assert.strictEqual(out.updated, true);
    assert.strictEqual(out.document.delivery_status, "delivered");
    assert.strictEqual(out.document.delivery_channel, "email");

    const again = await markDelivered(db, { documentId: document.id, channel: "email" });
    assert.strictEqual(again.updated, false, "redelivery of the same state writes nothing");
  });

test("a signature is recorded once and cannot be overwritten", { skip: !HAS_DB }, async () => {
  const { document } = await registerDocument(db, doc({
    kind: KINDS.CONTRACT, subtype: "partner_license", signatureRequired: true,
    sourceEventId: "pg-evt-license"
  }));
  assert.strictEqual(document.signature_required, true);

  const signed = await markSigned(db, {
    documentId: document.id, signerName: "Jane Partner", signatureRef: "envelope-9"
  });
  assert.strictEqual(signed.updated, true);
  assert.strictEqual(signed.document.signer_name, "Jane Partner");

  const again = await markSigned(db, { documentId: document.id, signerName: "Someone Else" });
  assert.strictEqual(again.updated, false);
  assert.strictEqual(again.reason, "already_signed");
  assert.strictEqual(again.version.signer_name, "Jane Partner");
});

// ---------------------------------------------------------------------------
// the portal read
// ---------------------------------------------------------------------------
test("the portal read is one statement and returns newest version each",
  { skip: !HAS_DB }, async () => {
    await registerDocument(db, doc({
      kind: KINDS.AUTHORIZATION, subtype: "soft_pull_consent", sourceEventId: "pg-evt-auth"
    }));

    const calls = [];
    const counted = { query: (sql, p) => (calls.push(sql), db.query(sql, p)) };
    const rows = await listClientLibrary(counted, { orgId: ORG, clientId: CLIENT });

    assert.strictEqual(calls.length, 1, `expected 1 query, got ${calls.length}`);
    assert.strictEqual(rows.length, 3, "deliverable + contract + authorization");

    const report = rows.find((r) => r.subtype === "credit_analysis_report");
    assert.strictEqual(report.current_version, 2);
    assert.strictEqual(report.version_count, 2);
    assert.strictEqual(report.expired, false);
  });

test("no read path returns a storage key — against the real column lists",
  { skip: !HAS_DB }, async () => {
    const [row] = await listClientLibrary(db, {
      orgId: ORG, clientId: CLIENT, kinds: ["deliverable"]
    });
    const secret = "0123456789abcdef0123456789abcdef0123456789abcdef";

    const payloads = [
      await listClientLibrary(db, { orgId: ORG, clientId: CLIENT, sign: { secret } }),
      await getByClientAndKind(db, {
        orgId: ORG, clientId: CLIENT, kind: KINDS.DELIVERABLE, history: true, sign: { secret }
      }),
      await getDocument(db, { orgId: ORG, documentId: row.id, sign: { secret } }),
      await getHistory(db, { orgId: ORG, documentId: row.id, sign: { secret } })
    ];

    for (const p of payloads) {
      const blob = JSON.stringify(p);
      assert.ok(!blob.includes("storage_key"), `storage_key leaked: ${blob.slice(0, 160)}`);
      assert.ok(!blob.includes("memory://"), `raw object path leaked: ${blob.slice(0, 160)}`);
    }
  });

test("resolveStorageTarget is the only path back to a storage key", { skip: !HAS_DB }, async () => {
  const [row] = await listClientLibrary(db, { orgId: ORG, clientId: CLIENT, kinds: ["deliverable"] });

  const current = await resolveStorageTarget(db, { documentId: row.id });
  assert.strictEqual(current.storage_key, "memory://documents/pg/v2.pdf");
  assert.strictEqual(current.client_id, CLIENT, "the route needs the owner to authorize");

  const history = await getHistory(db, { orgId: ORG, documentId: row.id });
  const v1 = history.find((h) => h.version === 1);
  const pinned = await resolveStorageTarget(db, { documentId: row.id, versionId: v1.id });
  assert.strictEqual(pinned.storage_key, "memory://documents/pg/v1.pdf",
    "an old link still resolves to what the client was actually sent");
});

test("one event generates all five UnderwriteIQ deliverables, and replays none of them",
  { skip: !HAS_DB }, async () => {
    const five = [
      "credit_analysis_report", "metro2_dispute_letter_pack", "credit_optimization_roadmap",
      "funding_snapshot", "bank_lender_match_list"
    ];
    const client = (await db.query(
      `INSERT INTO clients (org_id, email) VALUES ($1, 'docs_pg_five@example.com') RETURNING id`,
      [ORG])).rows[0].id;

    for (const subtype of five) {
      const out = await registerDocument(db, doc({
        clientId: client, subtype, sourceEventId: "pg-evt-analysis"
      }));
      assert.strictEqual(out.created, true, `${subtype} was not created`);
    }

    // the same event id on five documents — rejected only if it repeats on ONE
    for (const subtype of five) {
      const out = await registerDocument(db, doc({
        clientId: client, subtype, sourceEventId: "pg-evt-analysis"
      }));
      assert.strictEqual(out.deduped, true, `${subtype} was regenerated on replay`);
    }

    const n = await db.query(
      `SELECT count(*)::int AS c FROM document_versions v
         JOIN documents d ON d.id = v.document_id
        WHERE d.client_id = $1`, [client]);
    assert.strictEqual(n.rows[0].c, 5, "five versions, not ten");
  });

test("registering under a second org does not collide on the same logical key",
  { skip: !HAS_DB }, async () => {
    const org2 = (await db.query(
      `INSERT INTO orgs (slug, name) VALUES ('docs-pg-test-org', 'Docs Test') RETURNING id`)).rows[0].id;
    const client2 = (await db.query(
      `INSERT INTO clients (org_id, email) VALUES ($1, 'docs_pg_org2@example.com') RETURNING id`,
      [org2])).rows[0].id;

    const out = await registerDocument(db, doc({
      orgId: org2, clientId: client2, sourceEventId: "pg-evt-1"  // same event id, different org
    }));
    assert.strictEqual(out.created, true, "org_id scopes the idempotency key (Rule 7)");
  });
