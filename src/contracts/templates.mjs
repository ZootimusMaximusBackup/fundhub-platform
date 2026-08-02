// src/contracts/templates.mjs — the contract copy library.
//
// Create, edit, archive. Every write is org-scoped from the caller's session and
// attributed to a named staff member — contract_templates.created_by is NOT NULL
// for the same reason 077 and 099 make attribution structural: unattributed copy
// that somebody signed is not evidence of anything.
//
// WHAT THIS MODULE REFUSES, AND WHY IT REFUSES RATHER THAN WARNS:
//
//   RENAME. template_key never changes. Same rule api/message-templates.mjs
//   applies to message copy, for the same reason: a key is what other code
//   matches on, and a rename that looks safe today becomes a silent no-op the
//   moment somebody names the old key. Contracts already sent snapshot the key,
//   so a rename would also make the historical record disagree with itself.
//
//   DELETE. Not offered anywhere. 117_contracts.sql blocks it with a trigger,
//   and `active = false` is the supported way to take a template out of use.
//   Contracts already sent point at their template row; deleting it would break
//   the record of what a signed document was generated from.
//
// EDITING COPY DOES NOT TOUCH ANY CONTRACT ALREADY SENT. That is not enforced
// here — it is enforced by the schema: contracts.rendered_body is frozen at
// send, and 117's trg_contracts_frozen refuses to change it. So a template edit
// is safe by construction, which is the property that makes "changing copy never
// requires code" true without also making it dangerous.

import { ContractError, badRequest, notFound } from "./errors.mjs";
import { normaliseManualFields } from "./render.mjs";

export const TEMPLATE_KINDS = Object.freeze(["contract", "authorization"]);

const TEMPLATE_COLUMNS = `
  id, org_id, template_key, name, kind, subtype, body, manual_fields,
  signature_required, signature_statement, active,
  created_by, updated_by, created_at, updated_at`;

/* A key is typed by a person and matched by machines, so it is normalised to one
   shape on the way in: upper case, spaces and underscores folded to hyphens.
   "Funding Agreement" and "funding-agreement" must not become two templates. */
export function normaliseKey(raw) {
  const key = String(raw ?? "").trim().toUpperCase().replace(/[\s_]+/g, "-");
  if (!/^[A-Z0-9][A-Z0-9-]{1,62}$/.test(key)) {
    throw badRequest(
      "A template's short name needs to be 2 to 63 characters of letters, " +
      "numbers and hyphens — for example FUNDING-AGREEMENT.",
      "invalid_template_key");
  }
  return key;
}

const requireText = (v, what, code) => {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) throw badRequest(what, code);
  return s;
};

/** listTemplates — the CRM library. Archived rows are included unless excluded. */
export async function listTemplates(db, { orgId, activeOnly = false, limit = 200 } = {}) {
  if (!orgId) throw badRequest("A template list needs to know which company it is for.", "org_required");
  const { rows } = await db.query(
    `SELECT ${TEMPLATE_COLUMNS}
       FROM contract_templates
      WHERE org_id = $1::uuid
        AND ($2::boolean IS NOT TRUE OR active)
      ORDER BY active DESC, kind, template_key
      LIMIT $3`,
    [orgId, activeOnly, Math.max(1, Math.min(Number(limit) || 200, 500))]
  );
  return rows;
}

/** getTemplate — by id, org-scoped. Returns null rather than throwing. */
export async function getTemplate(db, { orgId, id } = {}) {
  if (!orgId || !id) return null;
  const { rows } = await db.query(
    `SELECT ${TEMPLATE_COLUMNS} FROM contract_templates
      WHERE id = $1::uuid AND org_id = $2::uuid LIMIT 1`,
    [id, orgId]
  );
  return rows[0] || null;
}

/** getTemplateByKey — how a workflow or a seed finds one without knowing its id. */
export async function getTemplateByKey(db, { orgId, templateKey } = {}) {
  if (!orgId || !templateKey) return null;
  const { rows } = await db.query(
    `SELECT ${TEMPLATE_COLUMNS} FROM contract_templates
      WHERE org_id = $1::uuid AND template_key = $2 LIMIT 1`,
    [orgId, normaliseKey(templateKey)]
  );
  return rows[0] || null;
}

/**
 * createTemplate — a new piece of contract copy.
 *
 * `staffId` is required and lands in created_by. There is no system path into
 * this function; a template always has a person behind it.
 */
export async function createTemplate(db, {
  orgId, staffId, templateKey, name, kind = "contract", subtype = null,
  body, manualFields = [], signatureRequired = true, signatureStatement = null
} = {}) {
  if (!orgId) throw badRequest("A template needs to belong to a company.", "org_required");
  if (!staffId) throw badRequest("A template has to record who wrote it.", "staff_required");
  if (!TEMPLATE_KINDS.includes(kind)) {
    throw badRequest(
      `A contract template is either a contract or an authorization, not "${kind}".`,
      "invalid_kind");
  }

  const key = normaliseKey(templateKey);
  const fields = normaliseManualFields(manualFields);
  const values = [
    orgId,
    key,
    requireText(name, "A template needs a name people will recognise.", "name_required"),
    kind,
    subtype == null || String(subtype).trim() === "" ? null : String(subtype).trim(),
    requireText(body, "A contract needs words in it.", "body_required"),
    JSON.stringify(fields),
    signatureRequired !== false,
    signatureStatement == null || String(signatureStatement).trim() === ""
      ? "I have read this document and I agree to it. Typing my name here is my signature."
      : String(signatureStatement).trim(),
    staffId
  ];

  try {
    const { rows } = await db.query(
      `INSERT INTO contract_templates
         (org_id, template_key, name, kind, subtype, body, manual_fields,
          signature_required, signature_statement, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)
       RETURNING ${TEMPLATE_COLUMNS}`,
      values
    );
    return rows[0];
  } catch (err) {
    // 23505 = unique_violation on (org_id, template_key).
    if (err && err.code === "23505") {
      throw new ContractError(
        `A template called ${key} already exists. Open it and edit it, or pick a different short name.`,
        { status: 409, code: "duplicate_template_key" });
    }
    throw err;
  }
}

/**
 * updateTemplate — change the copy.
 *
 * Only the fields actually supplied are changed, so a screen that sends the body
 * alone cannot blank the manual-field list by omission. template_key is never
 * accepted here: naming it is a refusal at the handler, not a silent ignore.
 */
export async function updateTemplate(db, {
  orgId, staffId, id, name, subtype, body, manualFields,
  signatureRequired, signatureStatement, active
} = {}) {
  const current = await getTemplate(db, { orgId, id });
  if (!current) throw notFound("That template does not exist.", "template_not_found");
  if (!staffId) throw badRequest("An edit has to record who made it.", "staff_required");

  const next = {
    name: name === undefined ? current.name
      : requireText(name, "A template needs a name people will recognise.", "name_required"),
    subtype: subtype === undefined ? current.subtype
      : (subtype == null || String(subtype).trim() === "" ? null : String(subtype).trim()),
    body: body === undefined ? current.body
      : requireText(body, "A contract needs words in it.", "body_required"),
    manual_fields: manualFields === undefined ? current.manual_fields
      : normaliseManualFields(manualFields),
    signature_required: signatureRequired === undefined
      ? current.signature_required : signatureRequired !== false,
    signature_statement: signatureStatement === undefined
      ? current.signature_statement
      : requireText(signatureStatement,
          "The sentence next to the signing box cannot be empty — it is what the client agrees to.",
          "signature_statement_required"),
    active: active === undefined ? current.active : active !== false
  };

  const { rows } = await db.query(
    `UPDATE contract_templates
        SET name = $3, subtype = $4, body = $5, manual_fields = $6::jsonb,
            signature_required = $7, signature_statement = $8, active = $9,
            updated_by = $10, updated_at = now()
      WHERE id = $1::uuid AND org_id = $2::uuid
      RETURNING ${TEMPLATE_COLUMNS}`,
    [id, orgId, next.name, next.subtype, next.body,
     JSON.stringify(next.manual_fields), next.signature_required,
     next.signature_statement, next.active, staffId]
  );
  return rows[0];
}
