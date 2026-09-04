// The identity chain, end to end, against real Postgres.
// SKIPS unless DATABASE_URL is set, like every other .pg.test.mjs here.
//
// WHAT THIS PROVES, and why a fake database could not.
//
// The whole point of the change is that a value read off a photograph of a
// government ID survives all the way to the one function the dispute letters
// call. Every link in that chain is a real column: an upsert that must not
// erase what an earlier document proved, a `date` column that must reject an
// unparseable birthday rather than store text, and a jsonb column carrying
// which document version proved which field. An in-memory fake would answer
// every one of those questions by agreeing with the code that wrote it.
//
// The model call and the file bytes are the only things stubbed, because there
// is no photograph of a real driving licence in this repository and there must
// never be one.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { onDocsReceivedDocCheck, AGENT_CODE } from "../handlers/doc-check.mjs";
import { verifiedIdentity } from "./verified.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const STAMP = "identity-chain-pg-test";
const EMAIL = "identity_chain_pg_test@example.com";

let orgId = null;
let clientId = null;
/* Fixed ids rather than a seeded documents row. document_versions is
   append-only — a trigger refuses DELETE — so a test that seeded one could
   never clean up after itself, and the columns under test hold these two ids
   as jsonb with no foreign key. What matters here is that the id the agent was
   handed is the id stamped on the field, which these prove exactly. */
const documentId = "33333333-3333-4333-8333-333333333333";
const versionId = "44444444-4444-4444-8444-444444444444";

async function wipe() {
  await db.query(`DELETE FROM agent_runs   WHERE org_id IN (SELECT id FROM orgs WHERE slug = $1)`, [STAMP])
    .catch(() => {});
  await db.query(`DELETE FROM pii_identity WHERE org_id IN (SELECT id FROM orgs WHERE slug = $1)`, [STAMP]);
  await db.query(`DELETE FROM messages     WHERE org_id IN (SELECT id FROM orgs WHERE slug = $1)`, [STAMP])
    .catch(() => {});
  await db.query(`DELETE FROM agents       WHERE org_id IN (SELECT id FROM orgs WHERE slug = $1)`, [STAMP]);
  await db.query(`DELETE FROM clients      WHERE org_id IN (SELECT id FROM orgs WHERE slug = $1)`, [STAMP]);
  await db.query(`DELETE FROM orgs WHERE slug = $1`, [STAMP]);
}

async function seed() {
  orgId = (await db.query(
    `INSERT INTO orgs (slug, name) VALUES ($1,$1) RETURNING id`, [STAMP])).rows[0].id;
  clientId = (await db.query(
    `INSERT INTO clients (org_id, email, first_name, last_name)
     VALUES ($1,$2,'Chris','Stanbridge') RETURNING id`, [orgId, EMAIL])).rows[0].id;
  await db.query(
    `INSERT INTO agents (org_id, code, name, agent_class, channel, status, runtime, runtime_ref,
                         prompt, output_schema)
     VALUES ($1,$2,'Document Check','client_facing','internal','live','inngest','doc-check',
             'You are the Document Check agent. Return JSON.',
             '{"outcome":"accept, request_more, or hold"}'::jsonb)`,
    [orgId, AGENT_CODE]);
}

/* The only stubs: the bytes of the photograph, and the model that reads it. */
const bytes = async () => ({
  buffer: Buffer.from("not-a-real-licence"),
  mimeType: "image/png",
  versionId
});
const answers = (json) => async () => ({ mode: "live", text: JSON.stringify(json), error: null });

function upload(extra = {}) {
  return {
    id: `evt-identity-${Math.random().toString(16).slice(2)}`,
    name: "docs.received",
    orgId,
    clientId,
    payload: {
      kind: "client_upload",
      subtype: "id_document",
      document_id: documentId,
      ...extra
    }
  };
}

async function row() {
  return (await db.query(
    `SELECT verified_legal_name, verified_address, verified_dob, verified_by,
            verified_at, verified_field_sources
       FROM pii_identity WHERE client_id = $1`, [clientId])).rows[0] || null;
}

before(async () => { if (!HAS_DB) return; await wipe(); await seed(); });
after(async () => { if (!HAS_DB) return; await wipe(); await close(); });

describe("the identity chain against real Postgres", () => {

  test("an accept lands the name, address and date of birth the agent read", { skip: !HAS_DB }, async () => {
    assert.equal(await row(), null, "sanity: nothing verified yet");

    const res = await onDocsReceivedDocCheck(db, upload(), {
      loadBytesImpl: bytes,
      callModelImpl: answers({
        outcome: "accept",
        documents_reviewed: ["Arizona driver licence"],
        issues: [],
        verified_legal_name: "Christopher John Stanbridge",
        verified_address: { line1: "1005 W Hudson Way", city: "Gilbert", state: "AZ", zip: "85233" },
        verified_date_of_birth: "1985-04-02"
      }),
      recordRunImpl: async () => null
    });

    assert.equal(res.done, true);
    assert.equal(res.agent, "DOC-CHECK");
    assert.equal(res.route.outcome, "accept");
    assert.equal(res.route.identity.written, true);

    const r = await row();
    assert.equal(r.verified_legal_name, "Christopher John Stanbridge",
      "the middle name is the whole reason this exists — clients.first_name has never carried one");
    assert.equal(r.verified_address.line1, "1005 W Hudson Way");
    assert.equal(r.verified_address.zip, "85233");
    assert.equal(r.verified_by, "DOC-CHECK");
    assert.ok(r.verified_at, "an unstamped verification is not auditable");
    assert.equal(r.verified_field_sources.legal_name.document_id, documentId);
    assert.equal(r.verified_field_sources.legal_name.document_version_id, versionId,
      "the exact version of the file the agent read, so the claim can be re-checked");
  });

  test("verifiedIdentity reads back exactly what the document proved", { skip: !HAS_DB }, async () => {
    const got = await verifiedIdentity(db, { orgId, clientId });
    assert.equal(got.legalName, "Christopher John Stanbridge");
    assert.equal(got.dateOfBirth, "1985-04-02");
    assert.equal(got.address.formatted, "1005 W Hudson Way Gilbert, AZ 85233");
    assert.equal(got.source, "DOC-CHECK");
    assert.ok(got.verifiedAt);
  });

  test("a field the agent did not report stays NULL and does not erase what is already proved",
    { skip: !HAS_DB }, async () => {
      // A proof of address arrives next. It shows a name and an address and no
      // date of birth — a utility bill never prints one.
      const res = await onDocsReceivedDocCheck(db, upload({ subtype: "proof_of_address" }), {
        loadBytesImpl: bytes,
        callModelImpl: answers({
          outcome: "accept",
          verified_legal_name: "Christopher John Stanbridge",
          verified_address: { line1: "1005 W Hudson Way", city: "Gilbert", state: "AZ", zip: "85233" },
          verified_date_of_birth: null
        }),
        recordRunImpl: async () => null
      });
      assert.equal(res.route.identity.written, true);
      assert.deepEqual(res.route.identity.fields.sort(), ["address", "legal_name"],
        "the date of birth was not on this document, so it is not one of the fields written");

      const r = await row();
      assert.ok(r.verified_dob, "the date of birth the LICENCE proved must survive an upload that lacks one");
      assert.equal(String(r.verified_dob.getFullYear()), "1985");
    });

  test("an accept that reads nothing writes nothing at all", { skip: !HAS_DB }, async () => {
    const before = await row();
    const res = await onDocsReceivedDocCheck(db, upload({ subtype: "bank_statement" }), {
      loadBytesImpl: bytes,
      callModelImpl: answers({ outcome: "accept", documents_reviewed: ["bank statement"], issues: [] }),
      recordRunImpl: async () => null
    });
    assert.equal(res.route.identity.written, false);
    assert.equal(res.route.identity.reason, "nothing_verified");

    const after = await row();
    assert.equal(after.verified_legal_name, before.verified_legal_name);
    assert.equal(after.verified_at.toISOString(), before.verified_at.toISOString(),
      "an accept that proved nothing must not even restamp the record");
  });

  test("*** THE ONE THAT MATTERS: a request_more records no identity, however much the model read ***",
    { skip: !HAS_DB }, async () => {
      await db.query(`DELETE FROM pii_identity WHERE client_id = $1`, [clientId]);
      assert.equal(await row(), null);

      const res = await onDocsReceivedDocCheck(db, upload(), {
        loadBytesImpl: bytes,
        callModelImpl: answers({
          outcome: "request_more",
          message_to_client: "the bottom corner of the licence is cut off",
          // The model still filled these in. A document the agent would not
          // accept has proved nothing, so none of it may be recorded.
          verified_legal_name: "Christopher John Stanbridge",
          verified_address: { line1: "1005 W Hudson Way", city: "Gilbert", state: "AZ", zip: "85233" },
          verified_date_of_birth: "1985-04-02"
        }),
        recordRunImpl: async () => null
      });

      assert.equal(res.route.outcome, "request_more");
      assert.equal(await row(), null, "a rejected document must leave no identity of record");

      const got = await verifiedIdentity(db, { orgId, clientId });
      assert.equal(got.legalName, null);
      assert.equal(got.address, null);
      assert.equal(got.dateOfBirth, null);
    });

  test("a birthday the agent printed in a shape nobody can read stays NULL rather than becoming text",
    { skip: !HAS_DB }, async () => {
      await db.query(`DELETE FROM pii_identity WHERE client_id = $1`, [clientId]);
      const res = await onDocsReceivedDocCheck(db, upload(), {
        loadBytesImpl: bytes,
        callModelImpl: answers({
          outcome: "accept",
          verified_legal_name: "Christopher John Stanbridge",
          verified_date_of_birth: "02-04-85"
        }),
        recordRunImpl: async () => null
      });
      assert.equal(res.route.identity.written, true);
      assert.deepEqual(res.route.identity.fields, ["legal_name"]);
      const r = await row();
      assert.equal(r.verified_dob, null,
        "04 February and 2 April are both readings of 02-04-85; a guess here mails the wrong birthday to a bureau");
      assert.equal(r.verified_address, null);
    });
});
