// The whole chain, against a real Postgres: a staff member writes a wording,
// drafts a contract, previews it, sends it; the client opens the link and signs;
// both sides can read the signed copy back.
//
// THE ASSERTIONS ARE AGAINST THE ROWS, NOT AGAINST THE RETURN VALUES. A return
// value is the module's account of what it did; the row is what it did. Same
// discipline src/http/finance-soft-pull.pg.test.mjs sets for the consent ledger,
// and for the same reason: "the contract was signed" is only true of the column
// an auditor reads.
//
// Skipped without DATABASE_URL, like every other *.pg.test.mjs.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import {
  createTemplate, updateTemplate, listTemplates, createDraft, saveDraft, preview,
  send, voidContract, getContract, listContracts,
  viewForSigning, sign, verifyContractUrl
} from "./index.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const SECRET = "L".repeat(48);
const CLIENT_EMAIL_LIKE = "contract.life.test.%@example.com";
const STAFF_EMAIL_LIKE = "contract_life_test_%@example.com";
const KEY_LIKE = "CTLIFE-%";

describe("contracts — the full lifecycle", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, staff, client;

  const purge = async () => {
    /* Contracts and templates block DELETE by trigger (117), so the fixture is
       torn down by disabling those triggers rather than by leaving rows behind
       for the next run to trip over. Doing it here rather than in application
       code is the point: nothing in src/ can do this. */
    const ids = (await db.query(`SELECT id FROM clients WHERE email LIKE $1`, [CLIENT_EMAIL_LIKE]))
      .rows.map((r) => r.id);
    if (ids.length) {
      // Signers first: contract_signers references contracts, and both tables
      // block DELETE by trigger, so the fixture has to unwind in dependency
      // order with both guards off. Application code cannot do any of this.
      await db.query(`ALTER TABLE contract_signers DISABLE TRIGGER trg_contract_signers_no_delete`);
      await db.query(
        `DELETE FROM contract_signers WHERE contract_id IN (SELECT id FROM contracts WHERE client_id = ANY($1))`,
        [ids]);
      await db.query(`ALTER TABLE contract_signers ENABLE TRIGGER trg_contract_signers_no_delete`);
      await db.query(`ALTER TABLE contracts DISABLE TRIGGER trg_contracts_no_delete`);
      await db.query(`DELETE FROM contracts WHERE client_id = ANY($1)`, [ids]);
      await db.query(`ALTER TABLE contracts ENABLE TRIGGER trg_contracts_no_delete`);
      await db.query(`ALTER TABLE document_versions DISABLE TRIGGER trg_document_versions_no_delete`);
      await db.query(`ALTER TABLE documents DISABLE TRIGGER trg_documents_no_delete`);
      await db.query(`UPDATE documents SET current_version_id = NULL WHERE client_id = ANY($1)`, [ids]);
      await db.query(`DELETE FROM document_versions WHERE document_id IN (SELECT id FROM documents WHERE client_id = ANY($1))`, [ids]);
      await db.query(`DELETE FROM documents WHERE client_id = ANY($1)`, [ids]);
      await db.query(`ALTER TABLE documents ENABLE TRIGGER trg_documents_no_delete`);
      await db.query(`ALTER TABLE document_versions ENABLE TRIGGER trg_document_versions_no_delete`);
      await db.query(`DELETE FROM events WHERE client_id = ANY($1)`, [ids]);
      await db.query(`DELETE FROM clients WHERE id = ANY($1)`, [ids]);
    }
    await db.query(`ALTER TABLE contract_templates DISABLE TRIGGER trg_contract_templates_no_delete`);
    await db.query(`DELETE FROM contract_templates WHERE template_key LIKE $1`, [KEY_LIKE]);
    await db.query(`ALTER TABLE contract_templates ENABLE TRIGGER trg_contract_templates_no_delete`);
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [STAFF_EMAIL_LIKE]);
  };

  before(async () => {
    org = await resolveDefaultOrg(db);
    await purge();
    staff = (await db.query(
      `INSERT INTO staff (org_id, name, role, email, status)
       VALUES ($1,'Contract Lifetest','owner','contract_life_test_owner@example.com','active')
       RETURNING id`, [org])).rows[0].id;
    client = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email, phone)
       VALUES ($1,'Grace','Hopper','contract.life.test.grace@example.com','+15550100100')
       RETURNING id`, [org])).rows[0].id;
  });

  after(async () => { await purge(); await close(); });

  const newTemplate = (suffix, over = {}) => createTemplate(db, {
    orgId: org, staffId: staff,
    templateKey: `CTLIFE-${suffix}`, name: `Lifecycle ${suffix}`,
    body: "Agreement for {{contact.full_name}}.\nFee: {{field.fee}}\nDated {{today}}.",
    manualFields: [{ key: "fee", label: "Success fee", required: true }],
    ...over
  });

  // ── 1. the wording ────────────────────────────────────────────────────────

  test("a staff member writes a wording and it comes back in the library", async () => {
    const t = await newTemplate("A");
    assert.equal(t.template_key, "CTLIFE-A");
    assert.equal(t.created_by, staff);
    assert.equal(t.active, true);
    assert.equal(t.signature_required, true);

    const row = (await db.query(`SELECT * FROM contract_templates WHERE id = $1`, [t.id])).rows[0];
    assert.equal(row.org_id, org);
    assert.deepEqual(row.manual_fields, [{ key: "fee", label: "Success fee", required: true, help: null }]);

    const lib = await listTemplates(db, { orgId: org });
    assert.ok(lib.some((r) => r.id === t.id));
  });

  test("the short name is normalised, so one wording cannot become two", async () => {
    const t = await newTemplate("b spaced");
    assert.equal(t.template_key, "CTLIFE-B-SPACED");
  });

  test("a second wording with the same short name is refused, not silently merged", async () => {
    await newTemplate("DUP");
    await assert.rejects(() => newTemplate("DUP"), (e) => e.code === "duplicate_template_key");
  });

  test("editing a wording records who edited it", async () => {
    const t = await newTemplate("EDIT");
    const after = await updateTemplate(db, {
      orgId: org, staffId: staff, id: t.id, body: t.body + "\nExtra line."
    });
    assert.match(after.body, /Extra line\./);
    assert.equal(after.updated_by, staff);
  });

  test("a wording belonging to another company is invisible", async () => {
    const t = await newTemplate("SCOPE");
    const other = (await db.query(
      `INSERT INTO orgs (slug, name) VALUES ('ctlife-other-co','Other Co')
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`)).rows[0].id;
    const lib = await listTemplates(db, { orgId: other });
    assert.equal(lib.some((r) => r.id === t.id), false);
  });

  // ── 2. draft and preview ──────────────────────────────────────────────────

  test("a draft has no wording at all, so nothing can be shown by accident", async () => {
    const t = await newTemplate("DRAFT");
    const c = await createDraft(db, {
      orgId: org, staffId: staff, clientId: client, templateId: t.id, values: { fee: "10%" } });
    assert.equal(c.status, "draft");
    assert.equal(c.rendered_body, null);
    assert.equal(c.body_sha, null);
    assert.equal(c.title, t.name);
  });

  test("the preview fills in the real client's details and names every empty blank", async () => {
    const t = await newTemplate("PREVIEW");
    const p = await preview(db, { orgId: org, templateId: t.id, clientId: client, values: {} });
    assert.match(p.body, /Agreement for Grace Hopper\./);
    assert.ok(!p.body.includes("{{"), "a preview must never show merge braces");
    assert.deepEqual(p.missing_required, ["Success fee"]);
    assert.deepEqual(p.missing_tags, [{ tag: "field.fee", reason: "unknown" }]);
  });

  test("an archived wording cannot be started, and an unknown client is refused", async () => {
    const t = await newTemplate("ARCH");
    await updateTemplate(db, { orgId: org, staffId: staff, id: t.id, active: false });
    await assert.rejects(() => createDraft(db, {
      orgId: org, staffId: staff, clientId: client, templateId: t.id }),
      (e) => e.code === "template_archived");

    const live = await newTemplate("ARCH2");
    await assert.rejects(() => createDraft(db, {
      orgId: org, staffId: staff, clientId: "00000000-0000-0000-0000-000000000000",
      templateId: live.id }), (e) => e.code === "client_not_found");
  });

  // ── 3. send ───────────────────────────────────────────────────────────────

  test("sending with a required blank still empty is refused", async () => {
    const t = await newTemplate("EMPTY");
    const c = await createDraft(db, { orgId: org, staffId: staff, clientId: client, templateId: t.id });
    await assert.rejects(() => send(db, { orgId: org, staffId: staff, id: c.id, secret: SECRET }),
      (e) => e.code === "missing_required");
    const row = await getContract(db, { orgId: org, id: c.id });
    assert.equal(row.status, "draft", "a refused send must not have moved the contract");
  });

  test("send freezes the wording, registers an immutable version, and mints a working link", async () => {
    const t = await newTemplate("SEND");
    const c = await createDraft(db, {
      orgId: org, staffId: staff, clientId: client, templateId: t.id, values: { fee: "10% of funded" } });
    const out = await send(db, {
      orgId: org, staffId: staff, id: c.id, secret: SECRET, baseUrl: "https://fh.test" });

    const row = (await db.query(`SELECT * FROM contracts WHERE id = $1`, [c.id])).rows[0];
    assert.equal(row.status, "sent");
    assert.equal(row.sent_by, staff);
    assert.ok(row.sent_at);
    assert.match(row.rendered_body, /Fee: 10% of funded/);
    assert.match(row.body_sha, /^sha256:[0-9a-f]{64}$/);
    assert.ok(row.document_id && row.document_version_id);
    assert.equal(row.signature_statement, t.signature_statement);
    assert.ok(row.link_expires_at);

    // The anchor the tamper check reads, in the OTHER table.
    const ver = (await db.query(`SELECT * FROM document_versions WHERE id = $1`, [row.document_version_id])).rows[0];
    assert.equal(ver.checksum, row.body_sha);
    assert.equal(ver.org_id, org);

    // The link really verifies.
    const u = new URL(out.link.url);
    assert.equal(u.origin + u.pathname, "https://fh.test/contract.html");
    assert.equal(verifyContractUrl({
      contractId: c.id, expiresAt: u.searchParams.get("exp"),
      sig: u.searchParams.get("sig"), secret: SECRET
    }).valid, true);
  });

  test("contract.sent is on the bus exactly once, and carries no wording", async () => {
    const t = await newTemplate("EVENT");
    const c = await createDraft(db, {
      orgId: org, staffId: staff, clientId: client, templateId: t.id, values: { fee: "1" } });
    await send(db, { orgId: org, staffId: staff, id: c.id, secret: SECRET });
    await send(db, { orgId: org, staffId: staff, id: c.id, secret: SECRET });   // resend

    const rows = (await db.query(
      `SELECT payload FROM events WHERE name = 'contract.sent' AND idempotency_key = $1`,
      [`contract.sent:${c.id}`])).rows;
    assert.equal(rows.length, 1, "a resend must not write a second event");
    const p = rows[0].payload;
    assert.equal(p.contract_id, c.id);
    assert.equal(p.client_id, client);
    assert.equal(Object.prototype.hasOwnProperty.call(p, "rendered_body"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(p, "body"), false);
  });

  test("a resend hands back a fresh link and does NOT re-freeze or re-version", async () => {
    const t = await newTemplate("RESEND");
    const c = await createDraft(db, {
      orgId: org, staffId: staff, clientId: client, templateId: t.id, values: { fee: "2" } });
    const first = await send(db, { orgId: org, staffId: staff, id: c.id, secret: SECRET });
    const again = await send(db, { orgId: org, staffId: staff, id: c.id, secret: SECRET });

    assert.equal(again.resent, true);
    assert.equal(again.contract.body_sha, first.contract.body_sha);
    assert.equal(again.contract.document_version_id, first.contract.document_version_id);
    const versions = (await db.query(
      `SELECT count(*)::int AS n FROM document_versions WHERE document_id = $1`,
      [first.contract.document_id])).rows[0].n;
    assert.equal(versions, 1);
  });

  test("a draft can be edited before sending and not after", async () => {
    const t = await newTemplate("LOCK");
    const c = await createDraft(db, {
      orgId: org, staffId: staff, clientId: client, templateId: t.id, values: { fee: "3" } });
    const edited = await saveDraft(db, { orgId: org, id: c.id, values: { fee: "4" } });
    assert.equal(edited.merge_values.fee, "4");

    await send(db, { orgId: org, staffId: staff, id: c.id, secret: SECRET });
    await assert.rejects(() => saveDraft(db, { orgId: org, id: c.id, values: { fee: "0" } }),
      (e) => e.code === "already_sent");
  });

  // ── 4. the client's side ──────────────────────────────────────────────────

  const sendable = async (suffix, values = { fee: "9%" }) => {
    const t = await newTemplate(suffix);
    const c = await createDraft(db, { orgId: org, staffId: staff, clientId: client, templateId: t.id, values });
    const out = await send(db, { orgId: org, staffId: staff, id: c.id, secret: SECRET });
    return { template: t, contract: out.contract, link: out.link };
  };

  test("opening the link records the view and moves the status to opened", async () => {
    const { contract } = await sendable("VIEW");
    const first = await viewForSigning(db, { contractId: contract.id });
    assert.equal(first.contract.status, "viewed");
    assert.equal(first.contract.verified, true);
    assert.equal(first.contract.can_sign, true);
    assert.match(first.contract.body, /Fee: 9%/);

    const stampedAt = (await db.query(
      `SELECT viewed_at FROM contracts WHERE id = $1`, [contract.id])).rows[0].viewed_at;

    await viewForSigning(db, { contractId: contract.id });
    const row = (await db.query(`SELECT * FROM contracts WHERE id = $1`, [contract.id])).rows[0];
    assert.equal(row.view_count, 2);
    assert.equal(row.status, "viewed", "a second view must not walk the status back");
    // viewed_at is when they FIRST opened it, and it never moves afterwards.
    assert.equal(new Date(row.viewed_at).getTime(), new Date(stampedAt).getTime());
  });

  test("the client never sees anything internal", async () => {
    const { contract } = await sendable("SHAPE");
    const out = await viewForSigning(db, { contractId: contract.id });
    for (const leak of ["org_id", "sent_by", "created_by", "document_id", "document_version_id",
                        "merge_values", "client_id"]) {
      assert.equal(Object.prototype.hasOwnProperty.call(out.contract, leak), false,
        `the signing page was handed ${leak}`);
    }
  });

  test("signing writes the name, the time and the IP — and only once", async () => {
    const { contract } = await sendable("SIGN");
    const at = new Date("2026-08-02T09:30:00Z");
    const out = await sign(db, {
      contractId: contract.id, signerName: "  Grace   Hopper ", agreed: true,
      ip: "203.0.113.9", userAgent: "Mozilla/5.0 (test)", at });

    assert.equal(out.contract.status, "signed");
    const row = (await db.query(`SELECT * FROM contracts WHERE id = $1`, [contract.id])).rows[0];
    assert.equal(row.status, "signed");
    assert.equal(row.signer_name, "Grace Hopper", "whitespace should be collapsed, not stored raw");
    assert.equal(row.signer_ip, "203.0.113.9");
    assert.equal(row.signer_user_agent, "Mozilla/5.0 (test)");
    assert.equal(new Date(row.signed_at).toISOString(), at.toISOString());

    // Mirrored onto the immutable version, with no external envelope invented.
    const ver = (await db.query(`SELECT * FROM document_versions WHERE id = $1`, [row.document_version_id])).rows[0];
    assert.equal(ver.signer_name, "Grace Hopper");
    assert.ok(ver.signed_at);
    assert.equal(ver.signature_ref, null);

    await assert.rejects(() => sign(db, { contractId: contract.id, signerName: "Someone Else", agreed: true }),
      (e) => e.code === "already_signed");
    const after = (await db.query(`SELECT signer_name FROM contracts WHERE id = $1`, [contract.id])).rows[0];
    assert.equal(after.signer_name, "Grace Hopper", "a refused second signature must not overwrite the first");
  });

  test("no name and no ticked box mean no signature", async () => {
    const { contract } = await sendable("REFUSE");
    for (const bad of [{ signerName: "", agreed: true }, { signerName: "A", agreed: true },
                       { signerName: "Grace Hopper", agreed: false },
                       { signerName: "Grace Hopper", agreed: "yes" }]) {
      await assert.rejects(() => sign(db, { contractId: contract.id, ...bad }));
    }
    const row = (await db.query(`SELECT status, signed_at FROM contracts WHERE id = $1`, [contract.id])).rows[0];
    assert.equal(row.signed_at, null);
    assert.notEqual(row.status, "signed");
  });

  test("contract.signed is on the bus, once, with the status it landed in", async () => {
    const { contract } = await sendable("SIGNEV");
    await sign(db, { contractId: contract.id, signerName: "Grace Hopper", agreed: true });
    const rows = (await db.query(
      `SELECT payload FROM events WHERE idempotency_key = $1`, [`contract.signed:${contract.id}`])).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].payload.status, "signed");
    assert.equal(rows[0].payload.contract_id, contract.id);
  });

  test("signing straight from 'sent' works — a view is not a precondition", async () => {
    const { contract } = await sendable("NOVIEW");
    const before = (await db.query(`SELECT status FROM contracts WHERE id = $1`, [contract.id])).rows[0];
    assert.equal(before.status, "sent");
    await sign(db, { contractId: contract.id, signerName: "Grace Hopper", agreed: true });
    assert.equal((await db.query(`SELECT status FROM contracts WHERE id = $1`, [contract.id])).rows[0].status, "signed");
  });

  // ── 5. void, and both parties keeping a copy ──────────────────────────────

  test("void needs a reason and stops the link working", async () => {
    const { contract } = await sendable("VOID");
    await assert.rejects(() => voidContract(db, { orgId: org, staffId: staff, id: contract.id, reason: "  " }),
      (e) => e.code === "void_reason_required");

    await voidContract(db, { orgId: org, staffId: staff, id: contract.id, reason: "Client changed the scope" });
    const row = (await db.query(`SELECT * FROM contracts WHERE id = $1`, [contract.id])).rows[0];
    assert.equal(row.status, "void");
    assert.equal(row.void_reason, "Client changed the scope");
    assert.equal(row.voided_by, staff);

    await assert.rejects(() => viewForSigning(db, { contractId: contract.id }), (e) => e.code === "voided");
    await assert.rejects(() => sign(db, { contractId: contract.id, signerName: "Grace Hopper", agreed: true }),
      (e) => e.code === "voided");
  });

  test("a signed contract cannot be voided", async () => {
    const { contract } = await sendable("VOIDSIGNED");
    await sign(db, { contractId: contract.id, signerName: "Grace Hopper", agreed: true });
    await assert.rejects(() => voidContract(db, { orgId: org, staffId: staff, id: contract.id, reason: "changed my mind" }),
      (e) => e.code === "already_signed");
  });

  test("BOTH PARTIES CAN RETRIEVE THE SIGNED COPY afterwards", async () => {
    const { contract } = await sendable("COPY");
    await sign(db, { contractId: contract.id, signerName: "Grace Hopper", agreed: true });

    // The client, on the same link, with no session.
    const clientCopy = await viewForSigning(db, { contractId: contract.id });
    assert.equal(clientCopy.contract.status, "signed");
    assert.equal(clientCopy.contract.signer_name, "Grace Hopper");
    assert.match(clientCopy.contract.body, /Agreement for Grace Hopper/);

    // The staff member, in the CRM.
    const staffCopy = await getContract(db, { orgId: org, id: contract.id });
    assert.equal(staffCopy.rendered_body, clientCopy.contract.body,
      "the two parties must be looking at the same words");

    const queue = await listContracts(db, { orgId: org, clientId: client, status: "signed" });
    assert.ok(queue.some((r) => r.id === contract.id), "a signed contract must be visible in the CRM");
  });

  test("a draft is never visible to a client, even with a valid link", async () => {
    const t = await newTemplate("HIDDEN");
    const c = await createDraft(db, {
      orgId: org, staffId: staff, clientId: client, templateId: t.id, values: { fee: "1" } });
    await assert.rejects(() => viewForSigning(db, { contractId: c.id }), (e) => e.status === 404);
    await assert.rejects(() => sign(db, { contractId: c.id, signerName: "Grace Hopper", agreed: true }),
      (e) => e.status === 404);
  });

  test("a contract belonging to another company is not readable through the CRM", async () => {
    const { contract } = await sendable("ORG");
    const other = (await db.query(
      `INSERT INTO orgs (slug, name) VALUES ('ctlife-other-co','Other Co')
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`)).rows[0].id;
    assert.equal(await getContract(db, { orgId: other, id: contract.id }), null);
    const queue = await listContracts(db, { orgId: other });
    assert.equal(queue.some((r) => r.id === contract.id), false);
  });
});
