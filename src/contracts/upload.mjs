// src/contracts/upload.mjs — a PDF somebody already has becomes a template.
//
// This is the half of the feature the owner asked for in one sentence: "we
// upload PDFs and do the contract thing... or just edit the PDF, and then from
// there put in fields." A lender's agreement, a landlord's form, a document a
// lawyer drafted — anything — is uploaded once, boxes are dragged onto its
// pages, and from then on it sends like any other template.
//
// WHAT HAPPENS TO THE BYTES. They go through src/documents/store.mjs, which is
// content addressed (the object path is the sha256 of the file), and are then
// registered as a documents + document_versions row (030). Two consequences,
// both wanted: the file is immutable by database trigger the moment it lands,
// and uploading the same file twice stores one copy.
//
// WHERE THEY LAND. Vercel Blob when BLOB_READ_WRITE_TOKEN is set — the owner's
// decision — and Postgres otherwise, so this works the day it deploys rather
// than waiting on an environment variable. providerFromEnv() in store.mjs picks;
// nothing here knows which it got.
//
// HOW THE FILE ARRIVES. Base64 inside a JSON body, not multipart. The Netlify
// adapter reads the request as text and JSON-parses it
// (netlify/functions/api.mjs), and public/app/data.js's write() is a JSON POST —
// so multipart would mean a second request path and a second body parser for
// one endpoint. Base64 costs about a third more bytes on the wire and nothing
// else. The 12 MB limit in pdf.mjs is applied to the DECODED size.

import { storeFromEnv } from "../documents/store.mjs";
import { storeAndRegister } from "../documents/register.mjs";
import { resolveStorageTarget } from "../documents/retrieve.mjs";
import { badRequest, notFound } from "./errors.mjs";
import { inspect, PDF_MIME, MAX_UPLOAD_BYTES, PdfError } from "./pdf.mjs";
import { normaliseKey } from "./templates.mjs";
import { normaliseFields } from "./fields.mjs";

const TEMPLATE_COLUMNS = `
  id, org_id, template_key, name, kind, subtype, body, manual_fields,
  signature_required, signature_statement, active,
  source_kind, document_id, document_version_id, original_filename,
  page_count, page_sizes, fields, signer_roles,
  created_by, updated_by, created_at, updated_at`;

/**
 * decodeUpload — base64 (or a data: URL) to bytes, with the size checked BEFORE
 * decoding as well as after.
 *
 * Checking the encoded length first matters: a caller can post a 400 MB base64
 * string, and buffering it into memory to discover it is too big is the denial
 * of service. base64 is 4 characters per 3 bytes, so the encoded ceiling is
 * derived rather than guessed.
 */
export function decodeUpload(input) {
  if (typeof input !== "string" || !input.trim()) {
    throw badRequest("No file was attached.", "no_file");
  }
  // Browsers hand back "data:application/pdf;base64,JVBERi0..." from a FileReader.
  const comma = input.indexOf(",");
  const b64 = input.startsWith("data:") && comma > -1 ? input.slice(comma + 1) : input;

  const ceiling = Math.ceil((MAX_UPLOAD_BYTES / 3) * 4) + 1024;
  if (b64.length > ceiling) {
    throw badRequest(
      `That file is too big. The limit is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`,
      "file_too_large");
  }
  let bytes;
  try {
    bytes = Buffer.from(b64, "base64");
  } catch {
    throw badRequest("That file could not be read.", "file_unreadable");
  }
  if (!bytes.length) throw badRequest("That file is empty.", "empty_file");
  return bytes;
}

/**
 * uploadTemplate — the whole upload, as one call.
 *
 * Returns the new template row. The fields list starts EMPTY: uploading is not
 * the same act as deciding where things get signed, and a template with no
 * boxes on it is a legitimate half-finished state that the screen shows as
 * "needs boxes" rather than something to be prevented.
 */
export async function uploadTemplate(db, {
  orgId, staffId, templateKey, name, file, filename = null,
  kind = "contract", subtype = null, signatureStatement = null, store = null
} = {}) {
  if (!orgId) throw badRequest("A template needs to belong to a company.", "org_required");
  if (!staffId) throw badRequest("An upload has to record who did it.", "staff_required");

  const bytes = decodeUpload(file);

  // Everything that can be wrong with the file is decided in one place, and its
  // messages are written for a person: "that is not a PDF, save it as one".
  let shape;
  try {
    shape = await inspect(bytes);
  } catch (err) {
    if (err instanceof PdfError) throw badRequest(err.message, err.code);
    throw err;
  }

  const key = normaliseKey(templateKey);
  const title = String(name ?? "").trim() || String(filename ?? "").replace(/\.pdf$/i, "") || key;

  /* Stored and registered BEFORE the template row is written. If the insert
     then fails — a duplicate key, most likely — the worst outcome is an
     unreferenced object in the store, which is exactly the orphan case
     store.del() is documented for. The reverse order would produce a template
     row pointing at a file that was never stored, which the editor cannot
     render and which looks like data corruption rather than a failed upload. */
  const documentStore = store || storeFromEnv();
  const registered = await storeAndRegister(db, documentStore, {
    orgId,
    // Uploaded templates are not about one client, and documents.client_id is
    // NOT NULL. The org's own placeholder client would be a lie; instead the
    // template is filed against the ORG-LEVEL client row that
    // ensureTemplateClient() below resolves, and every CONTRACT sent from it
    // registers its own copy against the real client at send.
    clientId: await ensureTemplateClient(db, orgId),
    kind: "contract",
    subtype: "template_source",
    title: `${title} (uploaded file)`,
    body: bytes,
    mimeType: PDF_MIME,
    filename: filename || `${key}.pdf`,
    generatedBy: "contracts:upload",
    reason: "imported",
    metadata: { template_key: key, page_count: shape.pageCount, uploaded_by: staffId }
  });

  try {
    const { rows } = await db.query(
      `INSERT INTO contract_templates
         (org_id, template_key, name, kind, subtype, body, manual_fields,
          signature_required, signature_statement, created_by,
          source_kind, document_id, document_version_id, original_filename,
          page_count, page_sizes, fields, signer_roles)
       VALUES ($1,$2,$3,$4,$5,NULL,'[]'::jsonb,true,$6,$7,
               'pdf',$8,$9,$10,$11,$12::jsonb,'[]'::jsonb,$13::jsonb)
       RETURNING ${TEMPLATE_COLUMNS}`,
      [orgId, key, title, kind, subtype,
       signatureStatement && String(signatureStatement).trim()
         ? String(signatureStatement).trim()
         : "I have read this document and I agree to it. Typing my name here is my signature.",
       staffId,
       registered.document?.id || null, registered.version?.id || null,
       filename || `${key}.pdf`, shape.pageCount,
       JSON.stringify(shape.pageSizes),
       JSON.stringify([{ index: 0, label: "Client", fill_from_client: true }])]
    );
    return rows[0];
  } catch (err) {
    if (err && err.code === "23505") {
      throw badRequest(
        `A template called ${key} already exists. Pick a different short name.`,
        "duplicate_template_key");
    }
    throw err;
  }
}

/**
 * ensureTemplateClient — the org-level row a template's file is filed against.
 *
 * documents.client_id is NOT NULL (030) because every document that existed
 * when it was written belonged to a consumer. A blank template belongs to
 * nobody: it is the wording, before anybody's name is in it — the same
 * distinction api/read/message-templates.mjs makes about message copy.
 *
 * Rather than widen a NOT NULL that fifteen other things rely on, each org gets
 * one clearly-marked internal row to file templates against. It is is_demo=false
 * and named so that anybody who sees it in a client list knows immediately what
 * it is, and it holds no consumer data of any kind.
 */
export async function ensureTemplateClient(db, orgId) {
  const EMAIL = "contract-templates@internal.fundhub";
  const found = await db.query(
    `SELECT id FROM clients WHERE org_id = $1::uuid AND email = $2 LIMIT 1`, [orgId, EMAIL]);
  if (found.rows[0]) return found.rows[0].id;

  const { rows } = await db.query(
    `INSERT INTO clients (org_id, first_name, last_name, email)
     VALUES ($1,'[Contract','Templates]',$2)
     ON CONFLICT DO NOTHING
     RETURNING id`, [orgId, EMAIL]);
  if (rows[0]) return rows[0].id;

  const again = await db.query(
    `SELECT id FROM clients WHERE org_id = $1::uuid AND email = $2 LIMIT 1`, [orgId, EMAIL]);
  if (!again.rows[0]) throw badRequest("Could not file the uploaded template.", "template_client_failed");
  return again.rows[0].id;
}

/**
 * saveFields — where the boxes go, and who signs.
 *
 * Editing boxes on a template NEVER moves a box on a contract already sent:
 * send() snapshots the whole field list onto the contract, and 117's
 * trg_contracts_frozen refuses to change it afterwards. That is what makes this
 * screen safe to use on a live template.
 */
export async function saveFields(db, { orgId, staffId, id, fields, signerRoles } = {}) {
  const cur = await db.query(
    `SELECT ${TEMPLATE_COLUMNS} FROM contract_templates
      WHERE id = $1::uuid AND org_id = $2::uuid LIMIT 1`, [id, orgId]);
  const template = cur.rows[0];
  if (!template) throw notFound("That template does not exist.", "template_not_found");

  const roles = normaliseSignerRoles(
    signerRoles === undefined ? template.signer_roles : signerRoles);
  const clean = normaliseFields(fields === undefined ? template.fields : fields, {
    pageCount: template.page_count,
    signerCount: roles.length
  });

  const { rows } = await db.query(
    `UPDATE contract_templates
        SET fields = $3::jsonb, signer_roles = $4::jsonb, updated_by = $5, updated_at = now()
      WHERE id = $1::uuid AND org_id = $2::uuid
      RETURNING ${TEMPLATE_COLUMNS}`,
    [id, orgId, JSON.stringify(clean), JSON.stringify(roles), staffId || null]);
  return rows[0];
}

/** normaliseSignerRoles — how many signatures, in what order, under what names. */
export function normaliseSignerRoles(raw) {
  const list = Array.isArray(raw) ? raw : [];
  if (!list.length) return [{ index: 0, label: "Client", fill_from_client: true }];
  if (list.length > 10) throw badRequest("A contract can have at most 10 signers.", "too_many_signers");
  return list.map((r, i) => ({
    index: i,
    label: String((r && r.label) ?? "").trim() || (i === 0 ? "Client" : `Signer ${i + 1}`),
    // Only one role can be auto-filled from the client record — "the client" is
    // one person, and two roles claiming to be them would make the auto-filled
    // boxes ambiguous.
    fill_from_client: i === 0 ? (r ? r.fill_from_client !== false : true) : false
  }));
}

/**
 * loadTemplatePdf — the original bytes back out of the store.
 *
 * Goes through resolveStorageTarget() so the storage key stays inside the
 * documents module and never becomes something this file holds, logs, or
 * returns.
 */
export async function loadTemplatePdf(db, template, { store = null } = {}) {
  if (!template || template.source_kind !== "pdf" || !template.document_id) return null;
  const target = await resolveStorageTarget(db, {
    documentId: template.document_id,
    versionId: template.document_version_id || null
  });
  if (!target || !target.storage_key) return null;
  const documentStore = store || storeFromEnv();
  const got = await documentStore.get(target.storage_key, { expectedChecksum: target.checksum || null });
  return got ? got.body : null;
}

export { TEMPLATE_COLUMNS as UPLOAD_TEMPLATE_COLUMNS };
