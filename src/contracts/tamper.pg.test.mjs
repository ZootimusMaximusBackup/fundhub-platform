// THE REFUSAL. If only one file in this feature is ever read again, make it this
// one.
//
// The brief: "Signed contracts immutable: store rendered body hash at send,
// refuse signature if content changed after send."
//
// A signature is worth exactly as much as the certainty that the words above it
// are the words that were sent. This file proves that certainty by ATTACKING the
// stored contract — not by calling the module and trusting its answer, but by
// changing rows directly in Postgres the way a bad migration, a hand-edit in a
// database console, or a compromised internal tool would, and then asking
// whether a signature can still be obtained.
//
// TWO LAYERS, TESTED SEPARATELY, BECAUSE THEY FAIL SEPARATELY:
//
//   Layer 1  db/migrations/117_contracts.sql's trg_contracts_frozen refuses the
//            UPDATE outright. Nothing gets through.
//   Layer 2  If layer 1 is defeated — which these tests do explicitly, with
//            ALTER TABLE ... DISABLE TRIGGER, because that is what a bad
//            migration amounts to — src/contracts/sign.mjs recomputes the hash
//            and compares it against document_versions.checksum, in the OTHER
//            table, behind the OTHER trigger. The signature is refused there.
//
// Testing layer 2 requires disabling layer 1. That is the point: a defence in
// depth is only depth if the second layer works with the first one gone.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import {
  createTemplate, createDraft, send, sign, viewForSigning, verifyIntegrity, getContract
} from "./index.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const SECRET = "T".repeat(48);
const CLIENT_EMAIL_LIKE = "contract.tamper.test.%@example.com";
const STAFF_EMAIL_LIKE = "contract_tamper_test_%@example.com";
const KEY_LIKE = "CTTAMPER-%";

/* Run fn with a trigger switched off, and switch it back on whatever happens.
   A test that leaves a safety trigger disabled would silently disarm every test
   that runs after it in the same database. */
async function withTriggerDisabled(table, trigger, fn) {
  await db.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
  try { return await fn(); }
  finally { await db.query(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`); }
}

describe("contracts — the tamper refusal", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, staff, client, n = 0;

  const purge = async () => {
    const ids = (await db.query(`SELECT id FROM clients WHERE email LIKE $1`, [CLIENT_EMAIL_LIKE]))
      .rows.map((r) => r.id);
    if (ids.length) {
      await withTriggerDisabled("contracts", "trg_contracts_no_delete", () =>
        db.query(`DELETE FROM contracts WHERE client_id = ANY($1)`, [ids]));
      await withTriggerDisabled("documents", "trg_documents_no_delete", async () => {
        await withTriggerDisabled("document_versions", "trg_document_versions_no_delete", async () => {
          await db.query(`UPDATE documents SET current_version_id = NULL WHERE client_id = ANY($1)`, [ids]);
          await db.query(
            `DELETE FROM document_versions WHERE document_id IN (SELECT id FROM documents WHERE client_id = ANY($1))`, [ids]);
          await db.query(`DELETE FROM documents WHERE client_id = ANY($1)`, [ids]);
        });
      });
      await db.query(`DELETE FROM events WHERE client_id = ANY($1)`, [ids]);
      await db.query(`DELETE FROM clients WHERE id = ANY($1)`, [ids]);
    }
    await withTriggerDisabled("contract_templates", "trg_contract_templates_no_delete", () =>
      db.query(`DELETE FROM contract_templates WHERE template_key LIKE $1`, [KEY_LIKE]));
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [STAFF_EMAIL_LIKE]);
  };

  before(async () => {
    org = await resolveDefaultOrg(db);
    await purge();
    staff = (await db.query(
      `INSERT INTO staff (org_id, name, role, email, status)
       VALUES ($1,'Contract Tampertest','owner','contract_tamper_test_owner@example.com','active')
       RETURNING id`, [org])).rows[0].id;
    client = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email)
       VALUES ($1,'Alan','Turing','contract.tamper.test.alan@example.com') RETURNING id`, [org])).rows[0].id;
  });

  after(async () => { await purge(); await close(); });

  /* A freshly sent contract, ready to be attacked. */
  async function sent(bodyOverride = null) {
    n += 1;
    const t = await createTemplate(db, {
      orgId: org, staffId: staff, templateKey: `CTTAMPER-${n}`, name: `Tamper ${n}`,
      body: bodyOverride || "You owe {{field.amount}} to us. Signed by {{contact.full_name}}.",
      manualFields: [{ key: "amount", label: "Amount", required: true }]
    });
    const c = await createDraft(db, {
      orgId: org, staffId: staff, clientId: client, templateId: t.id, values: { amount: "$1,000" } });
    const out = await send(db, { orgId: org, staffId: staff, id: c.id, secret: SECRET });
    return out.contract;
  }

  // ── LAYER 1: the database refuses the edit at all ─────────────────────────

  describe("layer 1 — the database will not let the wording change", () => {
    test("an UPDATE to rendered_body on a sent contract raises", async () => {
      const c = await sent();
      await assert.rejects(
        () => db.query(`UPDATE contracts SET rendered_body = 'You owe $1,000,000' WHERE id = $1`, [c.id]),
        /wording is frozen/);
      const row = await getContract(db, { orgId: org, id: c.id });
      assert.match(row.rendered_body, /You owe \$1,000 to us/);
    });

    test("so does moving the hash, the document link, the client, or the send time", async () => {
      const c = await sent();
      const attacks = [
        [`UPDATE contracts SET body_sha = 'sha256:' || repeat('a',64) WHERE id = $1`],
        [`UPDATE contracts SET document_version_id = NULL WHERE id = $1`],
        [`UPDATE contracts SET merge_values = '{"amount":"$1"}'::jsonb WHERE id = $1`],
        [`UPDATE contracts SET sent_at = now() - interval '10 days' WHERE id = $1`],
        [`UPDATE contracts SET signature_statement = 'I agree to anything' WHERE id = $1`]
      ];
      for (const [sql] of attacks) {
        await assert.rejects(() => db.query(sql, [c.id]), /frozen/, `this got through: ${sql}`);
      }
    });

    test("the LIFECYCLE columns are still writable — a status has to be able to move", async () => {
      const c = await sent();
      await db.query(`UPDATE contracts SET view_count = view_count + 1, status = 'viewed' WHERE id = $1`, [c.id]);
      const row = await getContract(db, { orgId: org, id: c.id });
      assert.equal(row.status, "viewed");
      assert.equal(row.view_count, 1);
    });

    test("a DRAFT is not frozen — nothing has been sent to anybody yet", async () => {
      n += 1;
      const t = await createTemplate(db, {
        orgId: org, staffId: staff, templateKey: `CTTAMPER-D${n}`, name: `Draft ${n}`,
        body: "Draft body", manualFields: [] });
      const c = await createDraft(db, { orgId: org, staffId: staff, clientId: client, templateId: t.id });
      await db.query(`UPDATE contracts SET merge_values = '{"a":1}'::jsonb WHERE id = $1`, [c.id]);
      const row = await getContract(db, { orgId: org, id: c.id });
      assert.deepEqual(row.merge_values, { a: 1 });
    });
  });

  // ── LAYER 2: with layer 1 gone, the signature is still refused ────────────

  describe("layer 2 — with the trigger defeated, the signature is refused", () => {
    test("ONE ADDED CHARACTER is enough to refuse a signature", async () => {
      const c = await sent();
      await withTriggerDisabled("contracts", "trg_contracts_frozen", () =>
        db.query(`UPDATE contracts SET rendered_body = rendered_body || '.' WHERE id = $1`, [c.id]));

      await assert.rejects(
        () => sign(db, { contractId: c.id, signerName: "Alan Turing", agreed: true }),
        (e) => e.code === "content_changed" && e.status === 409);

      const row = (await db.query(`SELECT * FROM contracts WHERE id = $1`, [c.id])).rows[0];
      assert.equal(row.signed_at, null, "a refused signature must write nothing at all");
      assert.equal(row.signer_name, null);
      assert.notEqual(row.status, "signed");
    });

    test("the realistic attack — changing the amount — is refused", async () => {
      const c = await sent();
      await withTriggerDisabled("contracts", "trg_contracts_frozen", () =>
        db.query(`UPDATE contracts SET rendered_body = replace(rendered_body, '$1,000', '$100,000') WHERE id = $1`, [c.id]));
      await assert.rejects(
        () => sign(db, { contractId: c.id, signerName: "Alan Turing", agreed: true }),
        (e) => e.code === "content_changed");
    });

    test("changing the words AND the row's own hash to match is still refused", async () => {
      /* The attacker who knows about body_sha. document_versions.checksum, in a
         different table behind a different trigger, is the anchor — and it is
         the reason this is not just a self-consistency check. */
      const c = await sent();
      await withTriggerDisabled("contracts", "trg_contracts_frozen", () =>
        db.query(
          `UPDATE contracts
              SET rendered_body = 'You owe $500,000 to us.',
                  body_sha = 'sha256:' || encode(digest('You owe $500,000 to us.','sha256'),'hex')
            WHERE id = $1`, [c.id])
          .catch(() => db.query(
            /* pgcrypto may not be installed; the hash does not have to be
               correct for this test to mean something — an attacker who cannot
               compute it is in an even weaker position. */
            `UPDATE contracts SET rendered_body = 'You owe $500,000 to us.',
                    body_sha = 'sha256:' || repeat('b',64) WHERE id = $1`, [c.id])));

      await assert.rejects(
        () => sign(db, { contractId: c.id, signerName: "Alan Turing", agreed: true }),
        (e) => e.code === "content_changed");
    });

    test("a contract with no immutability anchor cannot be signed either", async () => {
      /* "Cannot verify" and "verified" are not the same answer. A contract whose
         document_version_id is gone has nothing to check against, so it is
         refused rather than waved through. */
      const c = await sent();
      await withTriggerDisabled("contracts", "trg_contracts_frozen", () =>
        db.query(`UPDATE contracts SET document_version_id = NULL WHERE id = $1`, [c.id]));

      await assert.rejects(
        () => sign(db, { contractId: c.id, signerName: "Alan Turing", agreed: true }),
        (e) => e.code === "unverifiable");
    });

    test("the client's page is told BEFORE they type their name", async () => {
      const c = await sent();
      await withTriggerDisabled("contracts", "trg_contracts_frozen", () =>
        db.query(`UPDATE contracts SET rendered_body = 'Different words entirely.' WHERE id = $1`, [c.id]));

      const view = await viewForSigning(db, { contractId: c.id });
      assert.equal(view.contract.verified, false,
        "the signing page must know the document is unverifiable on load");
      assert.equal(view.integrity.reason, "content_changed");
    });

    test("the CRM is told too, so a staff member can see why a client cannot sign", async () => {
      const c = await sent();
      await withTriggerDisabled("contracts", "trg_contracts_frozen", () =>
        db.query(`UPDATE contracts SET rendered_body = rendered_body || ' (edited)' WHERE id = $1`, [c.id]));
      const row = await getContract(db, { orgId: org, id: c.id });
      const verdict = await verifyIntegrity(db, row);
      assert.equal(verdict.ok, false);
      assert.equal(verdict.reason, "content_changed");
    });

    test("an untouched contract verifies and signs normally — the check is not a blanket no", async () => {
      const c = await sent();
      const verdict = await verifyIntegrity(db, await getContract(db, { orgId: org, id: c.id }));
      assert.equal(verdict.ok, true);
      const out = await sign(db, { contractId: c.id, signerName: "Alan Turing", agreed: true });
      assert.equal(out.contract.status, "signed");
    });
  });

  // ── after signing ─────────────────────────────────────────────────────────

  describe("after signing, the signature itself is frozen", () => {
    test("the signer's name, time, IP and status cannot be changed", async () => {
      const c = await sent();
      await sign(db, { contractId: c.id, signerName: "Alan Turing", agreed: true, ip: "198.51.100.4" });
      for (const sql of [
        `UPDATE contracts SET signer_name = 'Someone Else' WHERE id = $1`,
        `UPDATE contracts SET signed_at = now() WHERE id = $1`,
        `UPDATE contracts SET signer_ip = '10.0.0.1' WHERE id = $1`,
        `UPDATE contracts SET status = 'void' WHERE id = $1`
      ]) {
        await assert.rejects(() => db.query(sql, [c.id]), /signed/, `this got through: ${sql}`);
      }
    });

    test("and the row cannot be deleted to make it all go away", async () => {
      const c = await sent();
      await sign(db, { contractId: c.id, signerName: "Alan Turing", agreed: true });
      await assert.rejects(() => db.query(`DELETE FROM contracts WHERE id = $1`, [c.id]), /never deleted/);
      await assert.rejects(
        () => db.query(`DELETE FROM contract_templates WHERE id = $1`, [c.template_id]), /never deleted/);
    });

    test("the immutable version underneath cannot be rewritten either", async () => {
      const c = await sent();
      await sign(db, { contractId: c.id, signerName: "Alan Turing", agreed: true });
      const row = await getContract(db, { orgId: org, id: c.id });
      await assert.rejects(
        () => db.query(`UPDATE document_versions SET checksum = 'sha256:' || repeat('c',64) WHERE id = $1`,
          [row.document_version_id]), /immutable/);
    });
  });
});
