// src/contracts/send.mjs — draft, preview, send.
//
// THE SEND IS THE MOMENT THE WORDS STOP BEING EDITABLE. Everything before it is
// a draft nobody has seen; everything after it is a document somebody may sign.
// So send() does five things in a fixed order and each one exists for a reason:
//
//   1. RENDER against the client record + the blanks the staff member typed.
//   2. STORE the bytes through src/documents/store.mjs — content-addressed, so
//      the object path IS the sha256 of the words.
//   3. REGISTER a documents + document_versions row (030). document_versions
//      .checksum is immutable BY DATABASE TRIGGER, and that column is what the
//      tamper check in sign.mjs compares against later.
//   4. FREEZE the contract row: rendered_body, body_sha, status = 'sent'.
//      117_contracts.sql's trg_contracts_frozen refuses every later change to
//      those columns.
//   5. EMIT contract.sent.
//
// WHY THE WORDS ARE STORED IN TWO PLACES. contracts.rendered_body is what the
// signing page actually serves; document_versions.checksum is what proves it has
// not changed. The object store defaults to the in-memory provider and this
// repository has no storage vendor configured, so bytes put through it do not
// survive the process — a signing page reading the store would render blank in
// production today. The full reasoning is in docs/CONTRACTS-SPEC.md §3.
//
// NOTHING HERE TRANSMITS. There is no email, no SMS, no provider call. send()
// returns a signed link and the CRM shows it with a copy button. Outbound
// transmission is permitted in src/messaging/providers/* and nowhere else
// (CLAUDE.md §12), and adding a fourth exception to that rule was not in scope.
// The gap is recorded in docs/CONTRACTS-SPEC.md §12 rather than worked around.

import { createHash } from "node:crypto";
import { storeFromEnv } from "../documents/store.mjs";
import { storeAndRegister, markDelivered } from "../documents/register.mjs";
import { buildDocumentKey } from "../documents/kinds.mjs";
import { emit } from "../events/bus.mjs";
import { badRequest, notFound, conflict } from "./errors.mjs";
import { getTemplate } from "./templates.mjs";
import {
  clientContext, mergeContext, renderContract, missingTags, missingRequired,
  normaliseManualFields
} from "./render.mjs";
import { signContractUrl, DEFAULT_TTL_SECONDS } from "./signed-link.mjs";

export const CONTRACT_MIME = "text/html";

export const CONTRACT_COLUMNS = `
  id, org_id, client_id, template_id, template_key, title, kind, subtype,
  merge_values, rendered_body, body_sha, document_id, document_version_id,
  signature_statement, signature_required, status,
  sent_at, sent_by, link_expires_at, viewed_at, view_count,
  signed_at, signer_name, signer_ip, signer_user_agent,
  voided_at, voided_by, void_reason,
  created_by, created_at, updated_at`;

/** 'sha256:<hex>' — the same algorithm-prefixed shape documents.checksum uses. */
export const bodyHash = (text) =>
  `sha256:${createHash("sha256").update(Buffer.from(String(text), "utf8")).digest("hex")}`;

export async function getContract(db, { orgId, id } = {}) {
  if (!orgId || !id) return null;
  const { rows } = await db.query(
    `SELECT ${CONTRACT_COLUMNS} FROM contracts
      WHERE id = $1::uuid AND org_id = $2::uuid LIMIT 1`, [id, orgId]);
  return rows[0] || null;
}

/* The list view deliberately does NOT select rendered_body. A contract body is
   the longest column in this schema and the queue shows twenty of them; the one
   screen that needs the words asks for a single contract by id. */
const LIST_COLUMNS = `
  c.id, c.org_id, c.client_id, c.template_id, c.template_key, c.title,
  c.kind, c.subtype, c.body_sha, c.document_id, c.status,
  c.sent_at, c.sent_by, c.link_expires_at, c.viewed_at, c.view_count,
  c.signed_at, c.signer_name, c.voided_at, c.void_reason,
  c.created_at, c.updated_at`;

/** listContracts — the CRM queue. Newest first, optionally narrowed to a client. */
export async function listContracts(db, { orgId, clientId = null, status = null, limit = 100 } = {}) {
  if (!orgId) throw badRequest("A contract list needs to know which company it is for.", "org_required");
  const { rows } = await db.query(
    `SELECT ${LIST_COLUMNS},
            cl.first_name, cl.last_name, cl.email AS client_email,
            s.name AS sent_by_name
       FROM contracts c
       JOIN clients cl ON cl.id = c.client_id
  LEFT JOIN staff   s  ON s.id = c.sent_by
      WHERE c.org_id = $1::uuid
        AND ($2::uuid IS NULL OR c.client_id = $2::uuid)
        AND ($3::text IS NULL OR c.status = $3)
      ORDER BY c.created_at DESC
      LIMIT $4`,
    [orgId, clientId, status, Math.max(1, Math.min(Number(limit) || 100, 200))]
  );
  return rows;
}

/**
 * createDraft — a contract that exists but has no words yet.
 *
 * Kept separate from send() so a staff member can fill the blanks, look at the
 * preview, close the laptop, and come back. A draft carries no rendered_body at
 * all (117's contracts_sent_has_body_ck), so there is nothing a client could
 * ever be shown by accident.
 */
export async function createDraft(db, {
  orgId, staffId, clientId, templateId, values = {}, title = null
} = {}) {
  if (!orgId) throw badRequest("A contract needs to belong to a company.", "org_required");
  if (!staffId) throw badRequest("A contract has to record who created it.", "staff_required");
  if (!clientId) throw badRequest("Pick the client this contract is for.", "client_required");

  const template = await getTemplate(db, { orgId, id: templateId });
  if (!template) throw notFound("That contract template does not exist.", "template_not_found");
  if (!template.active) {
    throw conflict(
      "That template has been archived, so it cannot be sent to anyone new. " +
      "Turn it back on, or pick a different one.",
      "template_archived");
  }

  const owns = await db.query(
    `SELECT 1 FROM clients WHERE id = $1::uuid AND org_id = $2::uuid LIMIT 1`,
    [clientId, orgId]);
  if (!owns.rows[0]) throw notFound("That client is not on file.", "client_not_found");

  const { rows } = await db.query(
    `INSERT INTO contracts
       (org_id, client_id, template_id, template_key, title, kind, subtype,
        merge_values, signature_required, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)
     RETURNING ${CONTRACT_COLUMNS}`,
    [orgId, clientId, template.id, template.template_key,
     (title && String(title).trim()) || template.name,
     template.kind, template.subtype,
     JSON.stringify(values || {}), template.signature_required, staffId]
  );
  return rows[0];
}

/** saveDraft — change which blanks are filled in. Refused once sent. */
export async function saveDraft(db, { orgId, id, values = {}, title = null } = {}) {
  const current = await getContract(db, { orgId, id });
  if (!current) throw notFound();
  if (current.status !== "draft") {
    throw conflict(
      "This contract has already been sent, so its wording is fixed. " +
      "Void it and start a new one if it needs to change.",
      "already_sent");
  }
  const { rows } = await db.query(
    `UPDATE contracts SET merge_values = $3::jsonb,
            title = COALESCE(NULLIF(btrim($4), ''), title), updated_at = now()
      WHERE id = $1::uuid AND org_id = $2::uuid
      RETURNING ${CONTRACT_COLUMNS}`,
    [id, orgId, JSON.stringify(values || {}), title == null ? "" : String(title)]
  );
  return rows[0];
}

/**
 * preview — the finished document, as it would go out, without sending it.
 *
 * This is the control that replaces message_templates' compliance_passed flag
 * (docs/CONTRACTS-SPEC.md §2.1): a human reads the real words, with the real
 * client's data in them, before anything leaves. It also reports every tag that
 * came back empty, so "Hi ," is caught here rather than by the client.
 *
 * Works from a template + values directly OR from a stored draft, so the screen
 * can preview before it has written anything down.
 */
export async function preview(db, {
  orgId, templateId, clientId, values = {}, at = new Date()
} = {}) {
  const template = await getTemplate(db, { orgId, id: templateId });
  if (!template) throw notFound("That contract template does not exist.", "template_not_found");

  const base = await clientContext(db, clientId);
  const context = mergeContext({ contact: base.contact, values, at });
  const body = renderContract(template.body, context);

  return {
    template: {
      id: template.id, template_key: template.template_key, name: template.name,
      kind: template.kind, subtype: template.subtype,
      signature_required: template.signature_required,
      signature_statement: template.signature_statement,
      manual_fields: normaliseManualFields(template.manual_fields)
    },
    body,
    body_sha: bodyHash(body),
    missing_tags: missingTags(template.body, context),
    missing_required: missingRequired(template.manual_fields, values)
  };
}

/**
 * send — freeze the words, register the artifact, mint the link, emit the event.
 *
 * Idempotent on the contract row itself: a contract that is already sent gets a
 * FRESH LINK and no second document version. Re-minting rather than refusing is
 * deliberate — the commonest reason a staff member presses Send twice is that
 * the client lost the email, and refusing would make the useful case impossible
 * while preventing nothing (the words are frozen either way).
 *
 * `store` is injectable so tests do not need a storage vendor; it defaults to
 * storeFromEnv(), which is the in-memory provider unless one is configured.
 */
export async function send(db, {
  orgId, staffId, id, store = null, ttlSeconds = DEFAULT_TTL_SECONDS,
  baseUrl = null, secret = undefined, at = new Date(), now = Date.now
} = {}) {
  if (!staffId) throw badRequest("A send has to record who sent it.", "staff_required");

  const current = await getContract(db, { orgId, id });
  if (!current) throw notFound();
  if (current.status === "void") {
    throw conflict("This contract was voided, so it cannot be sent.", "voided");
  }
  if (current.status === "signed") {
    throw conflict("This contract is already signed.", "already_signed");
  }

  // ── already sent: re-mint the link, touch nothing else ────────────────────
  if (current.status !== "draft") {
    const link = signContractUrl({ contractId: current.id, ttlSeconds, baseUrl, secret, now });
    await db.query(
      `UPDATE contracts SET link_expires_at = $3, updated_at = now()
        WHERE id = $1::uuid AND org_id = $2::uuid`,
      [current.id, orgId, new Date(link.expiresAt * 1000)]);
    return { contract: await getContract(db, { orgId, id }), link, resent: true };
  }

  const template = await getTemplate(db, { orgId, id: current.template_id });
  if (!template) throw notFound("That contract template does not exist.", "template_not_found");

  const values = current.merge_values || {};
  const stillEmpty = missingRequired(template.manual_fields, values);
  if (stillEmpty.length) {
    throw badRequest(
      `This contract still has blanks in it: ${stillEmpty.join(", ")}. ` +
      "Fill them in before sending.",
      "missing_required", stillEmpty);
  }

  const base = await clientContext(db, current.client_id);
  const context = mergeContext({ contact: base.contact, values, at });
  const body = renderContract(template.body, context);
  if (!body.trim()) {
    throw badRequest(
      "This contract rendered as an empty page. Check the template's wording.",
      "empty_body");
  }

  // ── the immutable artifact (030) ──────────────────────────────────────────
  // The discriminator is the contract id, so every contract gets its own
  // document rather than every contract for a client collapsing onto one
  // document_key and appending versions to each other.
  const documentStore = store || storeFromEnv();
  const registered = await storeAndRegister(db, documentStore, {
    orgId,
    clientId: current.client_id,
    kind: current.kind,
    subtype: current.subtype,
    title: current.title,
    body,
    mimeType: CONTRACT_MIME,
    filename: `${current.template_key}.html`,
    documentKey: buildDocumentKey({
      kind: current.kind, subtype: current.subtype,
      clientId: current.client_id, discriminator: current.id
    }),
    generatedBy: "contracts",
    signatureRequired: current.signature_required,
    // Rule 9: a replayed send cannot append a second version to this document.
    sourceEventId: `contract.sent:${current.id}`,
    reason: "initial",
    metadata: { contract_id: current.id, template_key: current.template_key }
  });

  const sha = registered.version?.checksum || bodyHash(body);
  const link = signContractUrl({ contractId: current.id, ttlSeconds, baseUrl, secret, now });

  /* The UPDATE is conditional on status still being 'draft'. Two staff members
     pressing Send at the same instant must not both freeze the row — the second
     one gets no row back and falls through to the already-sent path, which
     hands them a link to the document the first one actually sent. */
  const { rows } = await db.query(
    `UPDATE contracts
        SET status = 'sent', rendered_body = $3, body_sha = $4,
            document_id = $5, document_version_id = $6,
            signature_statement = $7, signature_required = $8,
            sent_at = $9, sent_by = $10::uuid, link_expires_at = $11,
            updated_at = now()
      WHERE id = $1::uuid AND org_id = $2::uuid AND status = 'draft'
      RETURNING ${CONTRACT_COLUMNS}`,
    [current.id, orgId, body, sha,
     registered.document?.id || null, registered.version?.id || null,
     template.signature_statement, template.signature_required,
     at, staffId, new Date(link.expiresAt * 1000)]
  );

  if (!rows[0]) {
    // Lost the race. Somebody else sent it a moment ago; hand back what they sent.
    return { contract: await getContract(db, { orgId, id }), link, resent: true };
  }
  const contract = rows[0];

  // The document's own delivery state, so a "what did we send this client"
  // audit over documents/ reads correctly without joining contracts.
  // channel 'portal': the client fetches it from a link, nothing is transmitted.
  if (registered.document?.id) {
    await markDelivered(db, {
      documentId: registered.document.id,
      versionId: registered.version?.id || null,
      channel: "portal", status: "sent", deliveredAt: at
    }).catch(() => { /* the contract is sent; a delivery-status write is not worth losing it over */ });
  }

  await emitContractEvent(db, "contract.sent", contract);
  return { contract, link, resent: false, document: registered.document || null };
}

/**
 * void — take a contract out of play.
 *
 * A reason is required (117's contracts_void_reason_ck), because "why is this
 * void" is the first question anybody asks and a blank answer is not one. A
 * signed contract cannot be voided — the database refuses it, not just this
 * function.
 */
export async function voidContract(db, { orgId, staffId, id, reason, at = new Date() } = {}) {
  const current = await getContract(db, { orgId, id });
  if (!current) throw notFound();
  const why = String(reason ?? "").trim();
  if (!why) {
    throw badRequest("Say why this contract is being voided — a blank reason is not a record.",
      "void_reason_required");
  }
  if (current.status === "signed") {
    throw conflict("This contract is signed. A signed contract cannot be voided.", "already_signed");
  }
  if (current.status === "void") return current;

  const { rows } = await db.query(
    `UPDATE contracts
        SET status = 'void', voided_at = $3, voided_by = $4::uuid, void_reason = $5,
            updated_at = now()
      WHERE id = $1::uuid AND org_id = $2::uuid AND status <> 'signed'
      RETURNING ${CONTRACT_COLUMNS}`,
    [current.id, orgId, at, staffId || null, why]);
  if (!rows[0]) throw conflict("This contract changed while you were voiding it. Reload and look again.", "conflict");
  return rows[0];
}

/**
 * emitContractEvent — one place both events are written.
 *
 * THE PAYLOAD NEVER CARRIES THE CONTRACT BODY. The `events` table is read by the
 * dead-letter queue, the replay harness and the journey runner; none of them
 * should end up holding a copy of a consumer's signed agreement. Ids and status
 * only.
 *
 * Idempotency key is derived from the contract id, so a replay writes one event
 * rather than two.
 *
 * A FAILING BUS DOES NOT UN-SEND A CONTRACT. emit() dispatches handlers and
 * records their failures to the dead-letter queue itself; what is caught here is
 * the bus being unreachable at all. The contract row is already committed and is
 * the source of truth — throwing at this point would report a send as failed
 * that in fact happened, which is the worse of the two wrong answers.
 */
export async function emitContractEvent(db, name, contract) {
  const payload = {
    contract_id: contract.id,
    client_id: contract.client_id,
    template_key: contract.template_key,
    kind: contract.kind,
    subtype: contract.subtype,
    status: contract.status,
    document_id: contract.document_id,
    document_version_id: contract.document_version_id,
    body_sha: contract.body_sha
  };
  try {
    return await emit(db, name, payload, {
      orgId: contract.org_id,
      clientId: contract.client_id,
      idempotencyKey: `${name}:${contract.id}`
    });
  } catch (err) {
    console.warn(`[contracts] ${name} could not be written to the event bus: ${err.message}`);
    return { id: null, deduped: false, failed: true };
  }
}
