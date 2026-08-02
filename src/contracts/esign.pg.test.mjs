// Upload a PDF, place boxes on it, send it to two people in order, and have
// both of them sign — against a real Postgres.
//
// This is the file that proves the feature the owner actually asked for: "we
// upload PDFs and do the contract thing... put in fields, like date, name,
// address, whatever, from the client information... and then you sign."
//
// THE ASSERTIONS ARE AGAINST THE ROWS AND THE PRODUCED FILE, not against return
// values. A return value is the module's account of what it did; the row is
// what it did, and the PDF is what the client actually receives.
//
// Skipped without DATABASE_URL, like every other *.pg.test.mjs.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import {
  uploadTemplate, saveFields, createDraft, send, sign, viewForSigning,
  listSigners, getContract, documentBytes, verifyContractUrl, declineSigner,
  getTemplate, loadTemplatePdf, decodeUpload
} from "./index.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const SECRET = "S".repeat(48);
const CLIENT_EMAIL_LIKE = "contract.esign.test.%@example.com";
const STAFF_EMAIL_LIKE = "contract_esign_test_%@example.com";
const KEY_LIKE = "CTESIGN-%";

async function withTriggerDisabled(table, trigger, fn) {
  await db.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
  try { return await fn(); }
  finally { await db.query(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`); }
}

/** A two-page document, standing in for something a lender emailed over. */
async function samplePdf(pages = 2) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    doc.addPage([612, 792]).drawText(`Agreement page ${i + 1}`, { x: 56, y: 700, size: 14, font });
  }
  return Buffer.from(await doc.save());
}

describe("contracts — uploaded PDFs, fields and several signers",
  { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, staff, client, n = 0;

  const purge = async () => {
    const ids = (await db.query(`SELECT id FROM clients WHERE email LIKE $1`, [CLIENT_EMAIL_LIKE]))
      .rows.map((r) => r.id);
    if (ids.length) {
      await withTriggerDisabled("contract_signers", "trg_contract_signers_no_delete", () =>
        db.query(
          `DELETE FROM contract_signers WHERE contract_id IN (SELECT id FROM contracts WHERE client_id = ANY($1))`,
          [ids]));
      await withTriggerDisabled("contracts", "trg_contracts_no_delete", () =>
        db.query(`DELETE FROM contracts WHERE client_id = ANY($1)`, [ids]));
      await withTriggerDisabled("documents", "trg_documents_no_delete", () =>
        withTriggerDisabled("document_versions", "trg_document_versions_no_delete", async () => {
          await db.query(`UPDATE documents SET current_version_id = NULL WHERE client_id = ANY($1)`, [ids]);
          await db.query(
            `DELETE FROM document_versions WHERE document_id IN (SELECT id FROM documents WHERE client_id = ANY($1))`, [ids]);
          await db.query(`DELETE FROM documents WHERE client_id = ANY($1)`, [ids]);
        }));
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
       VALUES ($1,'Contract Esigntest','owner','contract_esign_test_owner@example.com','active')
       RETURNING id`, [org])).rows[0].id;
    client = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email, phone)
       VALUES ($1,'Marcus','Webb','contract.esign.test.marcus@example.com','+15550100200')
       RETURNING id`, [org])).rows[0].id;
  });

  after(async () => { await purge(); await close(); });

  /** An uploaded template with boxes on it and `signerCount` signing roles. */
  async function uploaded({ signerCount = 1, extraFields = [] } = {}) {
    n += 1;
    const t = await uploadTemplate(db, {
      orgId: org, staffId: staff, templateKey: `CTESIGN-${n}`, name: `Esign ${n}`,
      file: (await samplePdf(2)).toString("base64"), filename: "lender.pdf"
    });
    const roles = Array.from({ length: signerCount }, (_, i) =>
      ({ label: i === 0 ? "Client" : `Party ${i + 1}`, fill_from_client: i === 0 }));
    const fields = [
      { id: "who", page: 0, x: 0.2, y: 0.24, w: 0.4, h: 0.03, type: "text", signer: 0,
        label: "Borrower name", source: "contact.full_name" },
      { id: "when", page: 0, x: 0.65, y: 0.24, w: 0.2, h: 0.03, type: "date", signer: 0,
        label: "Date", source: "today" },
      { id: "amt", page: 0, x: 0.2, y: 0.30, w: 0.3, h: 0.03, type: "text", signer: 0,
        label: "Amount", source: "manual" },
      ...Array.from({ length: signerCount }, (_, i) => ({
        id: `sig${i}`, page: 1, x: 0.05 + i * 0.3, y: 0.6, w: 0.25, h: 0.05,
        type: "signature", signer: i, label: `Signature ${i + 1}`, source: "manual"
      })),
      ...extraFields
    ];
    return saveFields(db, { orgId: org, staffId: staff, id: t.id, fields, signerRoles: roles });
  }

  async function sent({ signerCount = 1, order = "sequential", values = { amt: "$250,000" } } = {}) {
    const t = await uploaded({ signerCount });
    const signers = Array.from({ length: signerCount }, (_, i) => ({
      role_label: i === 0 ? "Client" : `Party ${i + 1}`,
      name: i === 0 ? "Marcus Webb" : `Counterparty ${i}`,
      email: i === 0 ? "contract.esign.test.marcus@example.com" : `party${i}@x.test`,
      client_id: i === 0 ? client : null
    }));
    const draft = await createDraft(db, {
      orgId: org, staffId: staff, clientId: client, templateId: t.id,
      signers, signingOrder: order
    });
    const out = await send(db, { orgId: org, staffId: staff, id: draft.id, secret: SECRET });
    return { template: t, ...out, values };
  }

  // ── upload ────────────────────────────────────────────────────────────────

  describe("uploading a document", () => {
    test("reads its pages and files the bytes immutably", async () => {
      n += 1;
      const bytes = await samplePdf(3);
      const t = await uploadTemplate(db, {
        orgId: org, staffId: staff, templateKey: `CTESIGN-U${n}`, name: "Uploaded",
        file: bytes.toString("base64"), filename: "deal.pdf"
      });
      assert.equal(t.source_kind, "pdf");
      assert.equal(t.page_count, 3);
      assert.deepEqual(t.page_sizes, [{ w: 612, h: 792 }, { w: 612, h: 792 }, { w: 612, h: 792 }]);
      assert.equal(t.original_filename, "deal.pdf");
      assert.equal(t.body, null, "an uploaded template has no typed body");

      // The bytes come back byte-for-byte, through the documents registry.
      const back = await loadTemplatePdf(db, t);
      assert.ok(back.equals(bytes), "the stored file is not the file that was uploaded");

      // And the version behind it is immutable, like every other document.
      await assert.rejects(
        () => db.query(`UPDATE document_versions SET checksum = 'sha256:' || repeat('a',64) WHERE id = $1`,
          [t.document_version_id]), /immutable/);
    });

    test("accepts a browser's data: URL as well as bare base64", () => {
      const raw = Buffer.from("%PDF-1.4 hello");
      assert.ok(decodeUpload(raw.toString("base64")).equals(raw));
      assert.ok(decodeUpload("data:application/pdf;base64," + raw.toString("base64")).equals(raw));
    });

    test("refuses something that is not a PDF, in words a person can act on", async () => {
      n += 1;
      await assert.rejects(() => uploadTemplate(db, {
        orgId: org, staffId: staff, templateKey: `CTESIGN-X${n}`, name: "Bad",
        file: Buffer.from("PK a word document").toString("base64"), filename: "deal.docx"
      }), (e) => e.code === "not_a_pdf" && /Save As or Print/.test(e.message));
    });

    test("a second upload under the same short name is refused, not silently merged", async () => {
      n += 1;
      const args = {
        orgId: org, staffId: staff, templateKey: `CTESIGN-D${n}`, name: "Dup",
        file: (await samplePdf(1)).toString("base64"), filename: "d.pdf"
      };
      await uploadTemplate(db, args);
      await assert.rejects(() => uploadTemplate(db, args), (e) => e.code === "duplicate_template_key");
    });
  });

  // ── boxes ─────────────────────────────────────────────────────────────────

  describe("placing the boxes", () => {
    test("saves them and refuses a box on a page the document does not have", async () => {
      const t = await uploaded();
      assert.equal(t.fields.length, 4);
      await assert.rejects(() => saveFields(db, {
        orgId: org, staffId: staff, id: t.id,
        fields: [{ id: "x", page: 7, x: 0.1, y: 0.1, w: 0.2, h: 0.03, type: "text", signer: 0 }]
      }), (e) => e.code === "field_page_out_of_range");
    });

    test("EDITING BOXES DOES NOT MOVE THEM ON A CONTRACT ALREADY SENT", async () => {
      const out = await sent();
      const before = (await getContract(db, { orgId: org, id: out.contract.id })).fields;

      await saveFields(db, {
        orgId: org, staffId: staff, id: out.template.id,
        fields: [{ id: "moved", page: 0, x: 0.9, y: 0.9, w: 0.05, h: 0.02, type: "signature", signer: 0 }],
        signerRoles: [{ label: "Client" }]
      });

      const after = (await getContract(db, { orgId: org, id: out.contract.id })).fields;
      assert.deepEqual(after, before, "a template edit reached a contract that was already sent");
    });

    test("and the sent contract's boxes cannot be edited directly either", async () => {
      const out = await sent();
      await assert.rejects(
        () => db.query(`UPDATE contracts SET fields = '[]'::jsonb WHERE id = $1`, [out.contract.id]),
        /frozen/);
    });
  });

  // ── send ──────────────────────────────────────────────────────────────────

  describe("sending", () => {
    test("freezes the file, the boxes and a readable manifest of both", async () => {
      const out = await sent();
      const row = (await db.query(`SELECT * FROM contracts WHERE id = $1`, [out.contract.id])).rows[0];

      assert.equal(row.source_kind, "pdf");
      assert.ok(row.source_document_id, "the file was not snapshotted onto the contract");
      assert.ok(row.document_id, "no manifest was registered");
      assert.match(row.body_sha, /^sha256:[0-9a-f]{64}$/);

      // The manifest is the one string that captures BOTH the file and the
      // values, which is what lets 117's tamper check cover a PDF unchanged.
      assert.match(row.rendered_body, /SIGNED PDF DOCUMENT/);
      assert.match(row.rendered_body, /File fingerprint: sha256:/);
      assert.match(row.rendered_body, /Borrower name.*contact\.full_name.*Marcus Webb/s);

      // And it hashes to the checksum in the OTHER table.
      const ver = (await db.query(`SELECT checksum FROM document_versions WHERE id = $1`,
        [row.document_version_id])).rows[0];
      assert.equal(ver.checksum, row.body_sha);
    });

    test("fills in everything the CRM already knows, and freezes those values", async () => {
      const out = await sent();
      const fields = (await getContract(db, { orgId: org, id: out.contract.id })).fields;
      assert.equal(fields.find((f) => f.id === "who").value, "Marcus Webb");
      assert.match(fields.find((f) => f.id === "when").value, /^\d{4}-\d{2}-\d{2}$/);
      assert.equal(fields.find((f) => f.id === "amt").value, "", "a manual box must not be pre-filled");
    });

    test("refuses to send a document with no boxes on it", async () => {
      n += 1;
      const t = await uploadTemplate(db, {
        orgId: org, staffId: staff, templateKey: `CTESIGN-N${n}`, name: "No boxes",
        file: (await samplePdf(1)).toString("base64"), filename: "n.pdf"
      });
      const draft = await createDraft(db, { orgId: org, staffId: staff, clientId: client, templateId: t.id });
      await assert.rejects(() => send(db, { orgId: org, staffId: staff, id: draft.id, secret: SECRET }),
        (e) => e.code === "no_fields");
    });

    test("REFUSES TO SEND A DOCUMENT A SIGNER COULD NOT SIGN", async () => {
      n += 1;
      const t = await uploadTemplate(db, {
        orgId: org, staffId: staff, templateKey: `CTESIGN-S${n}`, name: "One sig",
        file: (await samplePdf(1)).toString("base64"), filename: "s.pdf"
      });
      await saveFields(db, {
        orgId: org, staffId: staff, id: t.id,
        signerRoles: [{ label: "Client" }, { label: "Lender" }],
        fields: [{ id: "sig0", page: 0, x: 0.1, y: 0.5, w: 0.3, h: 0.05, type: "signature", signer: 0 }]
      });
      const draft = await createDraft(db, {
        orgId: org, staffId: staff, clientId: client, templateId: t.id,
        signers: [{ name: "Marcus Webb", client_id: client }, { name: "Someone Else" }]
      });
      await assert.rejects(() => send(db, { orgId: org, staffId: staff, id: draft.id, secret: SECRET }),
        (e) => e.code === "signer_has_no_signature_box");
    });

    test("mints ONE LINK PER SIGNER, and they are different links", async () => {
      const out = await sent({ signerCount: 3 });
      assert.equal(out.links.length, 3);
      const sigs = out.links.map((l) => new URL(l.url, "http://x.invalid").searchParams.get("sig"));
      assert.equal(new Set(sigs).size, 3, "two signers were given the same signature");

      for (const l of out.links) {
        const u = new URL(l.url, "http://x.invalid");
        assert.equal(verifyContractUrl({
          contractId: out.contract.id, signerId: l.signer_id,
          expiresAt: u.searchParams.get("exp"), sig: u.searchParams.get("sig"), secret: SECRET
        }).valid, true);
      }
    });

    test("ONE SIGNER'S LINK CANNOT BE USED AS ANOTHER'S", async () => {
      const out = await sent({ signerCount: 2 });
      const a = new URL(out.links[0].url, "http://x.invalid");
      const v = verifyContractUrl({
        contractId: out.contract.id,
        signerId: out.links[1].signer_id,          // the OTHER signer
        expiresAt: a.searchParams.get("exp"),
        sig: a.searchParams.get("sig"),            // with the FIRST one's signature
        secret: SECRET
      });
      assert.equal(v.valid, false, "one signer's link verified as another signer's");
    });
  });

  // ── the signing order ─────────────────────────────────────────────────────

  describe("the signing order", () => {
    test("SIGNER 2 CANNOT EVEN OPEN IT UNTIL SIGNER 1 HAS SIGNED", async () => {
      const out = await sent({ signerCount: 2 });
      const [s1, s2] = await listSigners(db, out.contract.id);

      await assert.rejects(
        () => viewForSigning(db, { contractId: out.contract.id, signerId: s2.id }),
        (e) => e.code === "not_your_turn" && /Marcus Webb/.test(e.message));
      await assert.rejects(
        () => sign(db, { contractId: out.contract.id, signerId: s2.id, signerName: "Counterparty 1", agreed: true }),
        (e) => e.code === "not_your_turn");

      const row = (await db.query(`SELECT * FROM contract_signers WHERE id = $1`, [s2.id])).rows[0];
      assert.equal(row.signed_at, null, "a refused signature must write nothing");
      assert.equal(row.view_count, 0, "a refused view must not be recorded as a view");

      // Signer 1 goes, and the door opens.
      await sign(db, {
        contractId: out.contract.id, signerId: s1.id, signerName: "Marcus Webb",
        agreed: true, fieldValues: { amt: "$250,000" }
      });
      const v = await viewForSigning(db, { contractId: out.contract.id, signerId: s2.id });
      assert.equal(v.contract.can_sign, true);
    });

    test("under a parallel contract anybody may go first", async () => {
      const out = await sent({ signerCount: 2, order: "parallel" });
      const [, s2] = await listSigners(db, out.contract.id);
      const v = await viewForSigning(db, { contractId: out.contract.id, signerId: s2.id });
      assert.equal(v.contract.can_sign, true);
    });

    test("a multi-signer contract refuses a link that does not say who you are", async () => {
      const out = await sent({ signerCount: 2 });
      await assert.rejects(() => viewForSigning(db, { contractId: out.contract.id }),
        (e) => e.code === "signer_required");
    });

    test("a single-signer contract still works with no signer named — the old flow", async () => {
      const out = await sent({ signerCount: 1 });
      const v = await viewForSigning(db, { contractId: out.contract.id });
      assert.equal(v.contract.can_sign, true);
    });
  });

  // ── what a signer sees and may write ──────────────────────────────────────

  describe("what one signer sees", () => {
    test("only their own boxes, with the auto-filled ones locked", async () => {
      const out = await sent({ signerCount: 2 });
      const [s1] = await listSigners(db, out.contract.id);
      const v = await viewForSigning(db, { contractId: out.contract.id, signerId: s1.id });

      assert.deepEqual(v.contract.fields.map((f) => f.id).sort(), ["amt", "sig0", "when", "who"]);
      const who = v.contract.fields.find((f) => f.id === "who");
      assert.equal(who.locked, true);
      assert.equal(who.value, "Marcus Webb");
      const amt = v.contract.fields.find((f) => f.id === "amt");
      assert.equal(amt.locked, false);
      assert.equal(amt.value, "", "a box they have to fill in must not arrive pre-filled");
    });

    test("never the other party's contact details or the internals", async () => {
      const out = await sent({ signerCount: 2 });
      const [s1] = await listSigners(db, out.contract.id);
      const v = await viewForSigning(db, { contractId: out.contract.id, signerId: s1.id });
      const json = JSON.stringify(v.contract);
      assert.equal(json.includes("party1@x.test"), false, "one signer was handed another's email");
      for (const leak of ["org_id", "sent_by", "created_by", "merge_values", "source_document_id"]) {
        assert.equal(Object.prototype.hasOwnProperty.call(v.contract, leak), false, `leaked ${leak}`);
      }
    });

    test("A SIGNER CANNOT WRITE INTO ANOTHER SIGNER'S BOX", async () => {
      const out = await sent({ signerCount: 2 });
      const [s1, s2] = await listSigners(db, out.contract.id);
      await sign(db, {
        contractId: out.contract.id, signerId: s1.id, signerName: "Marcus Webb", agreed: true,
        fieldValues: { amt: "$250,000", sig1: "FORGED", who: "Somebody Else" }
      });
      const rows = await listSigners(db, out.contract.id);
      assert.deepEqual(Object.keys(rows[0].field_values).sort(), ["amt", "sig0"]);
      assert.equal(rows[0].field_values.sig0, "Marcus Webb", "the typed name is the signature");
      assert.deepEqual(rows[1].field_values, {}, "the other signer's entries were written by somebody else");
    });

    test("a required box left empty refuses the signature and writes nothing", async () => {
      const out = await sent({ signerCount: 1 });
      const [s1] = await listSigners(db, out.contract.id);
      await assert.rejects(
        () => sign(db, { contractId: out.contract.id, signerId: s1.id, signerName: "Marcus Webb", agreed: true }),
        (e) => e.code === "missing_fields" && e.detail.includes("Amount"));
      const row = (await db.query(`SELECT * FROM contract_signers WHERE id = $1`, [s1.id])).rows[0];
      assert.equal(row.signed_at, null);
    });
  });

  // ── completion ────────────────────────────────────────────────────────────

  describe("completing", () => {
    test("the contract is not signed until EVERYBODY has signed", async () => {
      const out = await sent({ signerCount: 2 });
      const [s1, s2] = await listSigners(db, out.contract.id);

      const first = await sign(db, {
        contractId: out.contract.id, signerId: s1.id, signerName: "Marcus Webb",
        agreed: true, fieldValues: { amt: "$250,000" }
      });
      assert.equal(first.complete, false);
      let row = await getContract(db, { orgId: org, id: out.contract.id });
      assert.notEqual(row.status, "signed");
      assert.equal(row.signed_document_id, null, "a final file was built before everybody signed");

      const second = await sign(db, {
        contractId: out.contract.id, signerId: s2.id, signerName: "Counterparty 1", agreed: true
      });
      assert.equal(second.complete, true);
      row = await getContract(db, { orgId: org, id: out.contract.id });
      assert.equal(row.status, "signed");
      assert.ok(row.completed_at);
      assert.ok(row.signed_document_id, "no final file was produced");
      assert.match(row.signed_body_sha, /^sha256:[0-9a-f]{64}$/);
    });

    test("THE FINISHED FILE HAS EVERY PAGE PLUS A SIGNATURE RECORD", async () => {
      const out = await sent({ signerCount: 2 });
      const [s1, s2] = await listSigners(db, out.contract.id);
      await sign(db, { contractId: out.contract.id, signerId: s1.id, signerName: "Marcus Webb",
        agreed: true, fieldValues: { amt: "$250,000" }, ip: "203.0.113.7" });
      await sign(db, { contractId: out.contract.id, signerId: s2.id, signerName: "Counterparty 1",
        agreed: true, ip: "198.51.100.4" });

      const row = await getContract(db, { orgId: org, id: out.contract.id });
      const file = await documentBytes(db, row);
      assert.equal(file.signed, true);
      assert.match(file.filename, /-signed\.pdf$/);
      const doc = await PDFDocument.load(file.bytes);
      assert.equal(doc.getPageCount(), 3, "2 source pages + 1 signature record");
      // Bigger than the source, because entries and a whole page were added.
      const source = await documentBytes(db, row, { signed: false });
      assert.ok(file.bytes.length > source.bytes.length);
    });

    test("a text contract also gets a downloadable signed PDF", async () => {
      // The old typed-copy path, unchanged, now produces a file too — so
      // "download a copy" means the same thing for both kinds of contract.
      const { createTemplate } = await import("./templates.mjs");
      n += 1;
      const t = await createTemplate(db, {
        orgId: org, staffId: staff, templateKey: `CTESIGN-T${n}`, name: "Typed",
        body: "Agreement for {{contact.full_name}}. Dated {{today}}."
      });
      const draft = await createDraft(db, { orgId: org, staffId: staff, clientId: client, templateId: t.id });
      const out = await send(db, { orgId: org, staffId: staff, id: draft.id, secret: SECRET });
      const [s1] = await listSigners(db, out.contract.id);
      await sign(db, { contractId: out.contract.id, signerId: s1.id, signerName: "Marcus Webb", agreed: true });

      const row = await getContract(db, { orgId: org, id: out.contract.id });
      const file = await documentBytes(db, row);
      assert.equal(file.signed, true);
      assert.ok((await PDFDocument.load(file.bytes)).getPageCount() >= 2);
    });

    test("declining is recorded and stops the contract completing", async () => {
      const out = await sent({ signerCount: 2 });
      const [s1, s2] = await listSigners(db, out.contract.id);
      await sign(db, { contractId: out.contract.id, signerId: s1.id, signerName: "Marcus Webb",
        agreed: true, fieldValues: { amt: "$1" } });
      await declineSigner(db, { signerId: s2.id, reason: "The fee is wrong" });

      const rows = await listSigners(db, out.contract.id);
      assert.equal(rows[1].status, "declined");
      assert.equal(rows[1].decline_reason, "The fee is wrong");
      const row = await getContract(db, { orgId: org, id: out.contract.id });
      assert.notEqual(row.status, "signed");
    });

    test("declining without a reason is refused", async () => {
      const out = await sent({ signerCount: 1 });
      const [s1] = await listSigners(db, out.contract.id);
      await assert.rejects(() => declineSigner(db, { signerId: s1.id, reason: "  " }),
        (e) => e.code === "decline_reason_required");
    });
  });

  // ── immutability ──────────────────────────────────────────────────────────

  describe("nothing signed can be changed afterwards", () => {
    test("a signer's entries and signature are frozen", async () => {
      const out = await sent({ signerCount: 1 });
      const [s1] = await listSigners(db, out.contract.id);
      await sign(db, { contractId: out.contract.id, signerId: s1.id, signerName: "Marcus Webb",
        agreed: true, fieldValues: { amt: "$250,000" }, ip: "203.0.113.7" });

      for (const sql of [
        `UPDATE contract_signers SET signer_name = 'Mallory' WHERE id = $1`,
        `UPDATE contract_signers SET field_values = '{"amt":"$1"}'::jsonb WHERE id = $1`,
        `UPDATE contract_signers SET signer_ip = '10.0.0.1' WHERE id = $1`,
        `UPDATE contract_signers SET status = 'pending' WHERE id = $1`,
        `UPDATE contract_signers SET email = 'other@x.test' WHERE id = $1`
      ]) {
        await assert.rejects(() => db.query(sql, [s1.id]), /has signed/, `this got through: ${sql}`);
      }
    });

    test("a signer cannot be removed from a contract, or moved in the order", async () => {
      const out = await sent({ signerCount: 2 });
      const [s1] = await listSigners(db, out.contract.id);
      await assert.rejects(() => db.query(`DELETE FROM contract_signers WHERE id = $1`, [s1.id]),
        /never deleted/);
      await assert.rejects(() => db.query(`UPDATE contract_signers SET signer_index = 5 WHERE id = $1`, [s1.id]),
        /position in the order/);
    });

    test("A TAMPERED PDF CONTRACT STILL REFUSES A SIGNATURE", async () => {
      const out = await sent({ signerCount: 1 });
      const [s1] = await listSigners(db, out.contract.id);
      // Defeat the row-level freeze the way a bad migration would, then change
      // the manifest — which is what the hash check reads.
      await withTriggerDisabled("contracts", "trg_contracts_frozen", () =>
        db.query(`UPDATE contracts SET rendered_body = rendered_body || ' AND ALSO $1M' WHERE id = $1`,
          [out.contract.id]));

      await assert.rejects(
        () => sign(db, { contractId: out.contract.id, signerId: s1.id, signerName: "Marcus Webb",
          agreed: true, fieldValues: { amt: "$250,000" } }),
        (e) => e.code === "content_changed");

      const row = (await db.query(`SELECT * FROM contract_signers WHERE id = $1`, [s1.id])).rows[0];
      assert.equal(row.signed_at, null);
    });
  });
});
