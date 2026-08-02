// POST /api/contracts — the staff write surface of the contract generator.
//
//   { action: "create_template",  ... }  → new contract copy          (owner/admin)
//   { action: "save_template",    id, ...}→ edit contract copy        (owner/admin)
//   { action: "archive_template", id, active? } → take it out of use  (owner/admin)
//   { action: "create_draft", client_id, template_id, values }        (staff)
//   { action: "save_draft",   id, values, title }                     (staff)
//   { action: "preview", template_id, client_id, values }             (staff)
//   { action: "send",    id }                                         (staff)
//   { action: "void",    id, reason }                                 (owner/admin)
//
// POST with an `action` in the body rather than one path per verb — the same
// shape api/inquiries.mjs, api/shifts.mjs and the whole /api/finance/* write
// surface already use, and the shape FHData.write() in public/app/data.js can
// call (it is POST-only).
//
// ─────────────────────────────────────────────────────────────────────────────
// TWO GATES ON ONE ROUTE, AND WHY THEY ARE NOT THE SAME
//
// SENDING a contract is ordinary staff work: a closer sends a funding agreement
// to the client they are working, all day. ROLE_SETS.STAFF.
//
// WRITING THE WORDS is not. Contract copy carries legal weight, and unlike
// message copy there is no second approval step downstream to catch a bad edit —
// the words go straight onto a document somebody signs. So authoring, editing
// and archiving a template are owner/admin, and so is voiding.
//
// This is the same one-screen-two-gates arrangement api/message-templates.mjs
// uses (saving is STAFF, approving is owner/admin) and that
// public/app/template-editor.html mirrors by hiding one card. Move a gate here
// and public/app/contracts.html has to move with it.
//
// THE ROLE GATE IS A SECOND CALL, NEVER AN ARGUMENT. requireAuth's third
// parameter is { db, env }; a `roles` key there is accepted by the object
// literal and silently dropped, which is how api/read/tradelines.mjs shipped an
// ungated endpoint (CLAUDE.md §12, src/http/auth-gate.test.mjs).
//
// ORG COMES FROM THE SESSION AND NOWHERE ELSE. There is no org_id parameter on
// any action here. A session with no org is refused rather than defaulted — a
// contract filed under a guessed org is a contract sent on the wrong company's
// behalf.
//
// NOTHING HERE TRANSMITS. `send` freezes the words, registers the document and
// returns a signed link. It does not email, text or POST anything anywhere.
// Outbound transmission is permitted in src/messaging/providers/* and nowhere
// else (CLAUDE.md §12); the gap is recorded in docs/CONTRACTS-SPEC.md §12.
// ─────────────────────────────────────────────────────────────────────────────

import { db } from "../src/db.mjs";
import { requireAuth } from "../src/http/middleware/requireAuth.mjs";
import { hasRole } from "../src/http/middleware/requireRole.mjs";
import { requireRole, ROLE_SETS, isUuid, CLIENT_DATA_ERRORS } from "../src/http/read-api.mjs";
import { safeError } from "../src/http/health.mjs";
import {
  ContractError, createTemplate, updateTemplate, getTemplate,
  createDraft, saveDraft, preview, send, voidContract, getContract
} from "../src/contracts/index.mjs";

/* Which actions need owner or admin. hasRole() treats "owner" as passing every
   gate (SUPER_ROLES), so naming "admin" here covers both. */
const OWNER_ADMIN_ACTIONS = new Set([
  "create_template", "save_template", "archive_template", "void"
]);

const ALL_ACTIONS = [
  "create_template", "save_template", "archive_template",
  "create_draft", "save_draft", "preview", "send", "void"
];

/* The absolute base a signed link is built on, so the CRM can show a link a
   client can actually click. Falls back to a relative path, which still works
   when the CRM and the signing page are on the same host — which they are. */
const baseUrlFrom = (req, env = process.env) => {
  if (env.PUBLIC_BASE_URL) return String(env.PUBLIC_BASE_URL).replace(/\/$/, "");
  const host = req.headers?.["x-forwarded-host"] || req.headers?.host;
  if (!host) return null;
  const proto = req.headers?.["x-forwarded-proto"] || "https";
  return `${proto}://${host}`;
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await requireAuth(req, res, { db });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.STAFF)) return;

  const orgId = (staff && staff.org_id) || null;
  if (!orgId) {
    return res.status(400).json({
      ok: false, error: "org_required",
      message: "Your sign-in is not attached to a company, so nothing can be filed under it."
    });
  }

  const body = req.body || {};
  const action = String(body.action || "").trim().toLowerCase();
  if (!ALL_ACTIONS.includes(action)) {
    return res.status(400).json({ ok: false, error: "unknown_action", allowed: ALL_ACTIONS });
  }

  if (OWNER_ADMIN_ACTIONS.has(action) && !hasRole(staff, ["admin"])) {
    return res.status(403).json({
      ok: false, error: "forbidden", required: ["owner", "admin"],
      message: action === "void"
        ? "Only an owner or an admin can void a contract."
        : "Only an owner or an admin can write or change contract wording."
    });
  }

  try {
    switch (action) {
      // ── templates ─────────────────────────────────────────────────────────
      case "create_template": {
        const template = await createTemplate(db, {
          orgId, staffId: staff.id,
          templateKey: body.template_key,
          name: body.name,
          kind: body.kind || "contract",
          subtype: body.subtype ?? null,
          body: body.body,
          manualFields: body.manual_fields ?? [],
          signatureRequired: body.signature_required,
          signatureStatement: body.signature_statement
        });
        return res.status(200).json({ ok: true, action, template, message: "Template created." });
      }

      case "save_template": {
        if (!isUuid(body.id)) return res.status(400).json({ ok: false, error: "invalid_id" });
        /* A rename is refused outright rather than ignored. Same rule
           api/message-templates.mjs applies: the short name is what other code
           and every already-sent contract match on, so changing it makes the
           record disagree with itself. Saying so beats silently dropping it. */
        if (body.template_key !== undefined) {
          const current = await getTemplate(db, { orgId, id: body.id });
          if (current && String(body.template_key).trim().toUpperCase() !== current.template_key) {
            return res.status(409).json({
              ok: false, error: "rename_refused",
              message: "The short name of a template cannot be changed. Contracts already sent " +
                       "record that name, so changing it would make the history disagree with itself. " +
                       "Create a new template instead.",
              template_key: current.template_key
            });
          }
        }
        const template = await updateTemplate(db, {
          orgId, staffId: staff.id, id: body.id,
          name: body.name, subtype: body.subtype, body: body.body,
          manualFields: body.manual_fields,
          signatureRequired: body.signature_required,
          signatureStatement: body.signature_statement
        });
        return res.status(200).json({
          ok: true, action, template,
          message: "Saved. Contracts already sent are not affected — their wording is frozen."
        });
      }

      case "archive_template": {
        if (!isUuid(body.id)) return res.status(400).json({ ok: false, error: "invalid_id" });
        const active = body.active === true;   // absent or false = archive
        const template = await updateTemplate(db, {
          orgId, staffId: staff.id, id: body.id, active
        });
        return res.status(200).json({
          ok: true, action, template,
          message: active
            ? "Template turned back on. It can be sent again."
            : "Template archived. It stays readable and every contract sent from it is untouched."
        });
      }

      // ── drafts ────────────────────────────────────────────────────────────
      case "create_draft": {
        if (!isUuid(body.client_id)) return res.status(400).json({ ok: false, error: "invalid_client_id" });
        if (!isUuid(body.template_id)) return res.status(400).json({ ok: false, error: "invalid_template_id" });
        const contract = await createDraft(db, {
          orgId, staffId: staff.id,
          clientId: body.client_id, templateId: body.template_id,
          values: body.values || {}, title: body.title || null
        });
        return res.status(200).json({ ok: true, action, contract, message: "Draft created." });
      }

      case "save_draft": {
        if (!isUuid(body.id)) return res.status(400).json({ ok: false, error: "invalid_id" });
        const contract = await saveDraft(db, {
          orgId, id: body.id, values: body.values || {}, title: body.title || null
        });
        return res.status(200).json({ ok: true, action, contract, message: "Saved." });
      }

      // ── preview ───────────────────────────────────────────────────────────
      /* A POST, not a GET, even though it changes nothing. It carries the blanks
         a staff member has typed — which on a funding agreement is a fee
         schedule — and GETs get logged with their query strings, prefetched and
         cached. Same reasoning api/consent/capture.mjs and api/pii.mjs record. */
      case "preview": {
        if (!isUuid(body.template_id)) return res.status(400).json({ ok: false, error: "invalid_template_id" });
        if (body.client_id != null && !isUuid(body.client_id)) {
          return res.status(400).json({ ok: false, error: "invalid_client_id" });
        }
        const out = await preview(db, {
          orgId, templateId: body.template_id,
          clientId: body.client_id || null, values: body.values || {}
        });
        return res.status(200).json({ ok: true, action, preview: out });
      }

      // ── send ──────────────────────────────────────────────────────────────
      case "send": {
        if (!isUuid(body.id)) return res.status(400).json({ ok: false, error: "invalid_id" });
        let out;
        try {
          out = await send(db, {
            orgId, staffId: staff.id, id: body.id, baseUrl: baseUrlFrom(req)
          });
        } catch (err) {
          /* No signing secret is OUR misconfiguration, not the caller's, and it
             is the one failure whose fix is an operator action. Say so plainly
             rather than reporting it as a bad request — see
             docs/CONTRACTS-SPEC.md §6 for the exact command. */
          if (/CONTRACT_URL_SECRET/.test(String(err && err.message))) {
            return res.status(503).json({
              ok: false, error: "not_configured",
              message: "Contract links are not switched on yet. Someone needs to set the " +
                       "signing secret (CONTRACT_URL_SECRET) before contracts can be sent."
            });
          }
          throw err;
        }
        return res.status(200).json({
          ok: true, action, contract: out.contract, link: out.link, resent: out.resent,
          message: out.resent
            ? "This contract was already sent. Here is a fresh link to the same document."
            : "Sent. Copy the link below and give it to the client."
        });
      }

      // ── void ──────────────────────────────────────────────────────────────
      case "void": {
        if (!isUuid(body.id)) return res.status(400).json({ ok: false, error: "invalid_id" });
        const contract = await voidContract(db, {
          orgId, staffId: staff.id, id: body.id, reason: body.reason
        });
        return res.status(200).json({
          ok: true, action, contract,
          message: "Voided. The link stops working and the contract can no longer be signed."
        });
      }

      default:
        return res.status(400).json({ ok: false, error: "unknown_action", allowed: ALL_ACTIONS });
    }
  } catch (err) {
    if (err instanceof ContractError) {
      return res.status(err.status).json({
        ok: false, error: err.code, message: err.message, detail: err.detail ?? undefined
      });
    }
    if (err && CLIENT_DATA_ERRORS.has(err.code)) {
      return res.status(400).json({ ok: false, error: "bad_request_parameter" });
    }
    return res.status(500).json({ ok: false, error: "write_failed", message: safeError(err) });
  }
}

// Exported for the endpoint tests, which assert the gates rather than re-deriving them.
export { OWNER_ADMIN_ACTIONS, ALL_ACTIONS };
export const __test = { baseUrlFrom, getContract };
