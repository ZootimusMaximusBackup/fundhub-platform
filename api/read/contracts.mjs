// GET /api/read/contracts — what the Contracts screen reads.
//
//   ?view=templates             the contract copy library
//   ?view=contracts[&client_id=][&status=][&document_id=]   the queue, newest first
//   ?id=<uuid>                  one contract, INCLUDING its frozen wording
//
// `document_id` takes one uuid or a comma-separated list, and answers the one
// question the Documents screen cannot answer for itself: WHICH CONTRACT DOES
// THIS DOCUMENT ROW BELONG TO. contracts.document_id points at documents; there
// is no column pointing back. Rather than give `documents` a contract column —
// a schema change to serve one screen, and a second place for the same fact to
// live — the Documents screen sends the ids it is showing and gets the owning
// contracts back in a single request. See docs/workflows/contracts-dedup-2026-08-17.md.
//
// Read-only. Auth, role gate and redaction come from src/http/read-api.mjs;
// the SQL is in src/contracts/. Hand-rolled rather than readHandler-based
// because this one endpoint serves three differently-shaped answers and
// readHandler's page() envelope fits only the list ones.
//
// THE ORG COMES FROM THE SESSION AND IS REQUIRED (audit C1). A session with no
// org is refused rather than defaulted — omitting the clause when the org is
// unknown turns a broken session into a firehose over every company's contracts.
//
// ROLE_SETS.STAFF, the same gate that already reads a client's tradelines and
// bank balances everywhere else in this API. A contract is no more sensitive
// than those and gating it more tightly would leave a closer unable to see the
// agreement on the file they are working.
//
// redact() strips storage_key on the way out, so the ?id= answer carries the
// document's identity and never its bearer credential. That is why this endpoint
// can return the full contract row at all.

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import {
  requireRole, ROLE_SETS, isUuid, redact, boundedLimit, CLIENT_DATA_ERRORS
} from "../../src/http/read-api.mjs";
import { safeError } from "../../src/http/health.mjs";
import {
  listTemplates, listContracts, getContract, getTemplate,
  normaliseManualFields, verifyIntegrity, signedCopyHash,
  listSigners, waitingSummary, loadTemplatePdf, documentBytes
} from "../../src/contracts/index.mjs";

const STATUSES = new Set(["draft", "sent", "viewed", "signed", "void"]);

export default async function handler(req, res) {
  if (req.method && req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await requireAuth(req, res, { db });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.STAFF)) return;

  const orgId = (staff && staff.org_id) || null;
  if (!orgId) {
    return res.status(400).json({
      ok: false, error: "org_required",
      message: "Your sign-in is not attached to a company, so there is nothing to show."
    });
  }

  const q = req.query || {};
  const limit = boundedLimit(q.limit, { fallback: 100, cap: 200 });

  try {
    /* ── the file itself ────────────────────────────────────────────────────
       Returned base64 inside JSON rather than as raw bytes. The (req,res) shim
       these handlers run behind is built for JSON — netlify/functions/api.mjs
       and scripts/dev-server.mjs each implement it separately — and one
       transport that works identically under both is worth more than saving a
       third of the bytes on a screen only staff open. pdf.js reads a byte array
       just as happily as a URL.

       IT IS STILL NEVER THE STORAGE KEY. The bytes are fetched server-side
       through the documents module and the key stays inside it, which is the
       whole rule src/documents/store.mjs's header sets out. */
    if (String(q.file || "") === "template") {
      if (!isUuid(q.template_id)) return res.status(400).json({ ok: false, error: "invalid_template_id" });
      const template = await getTemplate(db, { orgId: staff.org_id, id: q.template_id });
      if (!template) return res.status(404).json({ ok: false, error: "not_found" });
      const bytes = await loadTemplatePdf(db, template);
      if (!bytes) return res.status(404).json({ ok: false, error: "no_file" });
      res.setHeader("cache-control", "private, no-store");
      return res.status(200).json({
        ok: true, file: "template",
        filename: template.original_filename || "document.pdf",
        page_count: template.page_count,
        page_sizes: template.page_sizes || [],
        pdf_base64: bytes.toString("base64")
      });
    }

    if (String(q.file || "") === "contract") {
      if (!isUuid(q.id)) return res.status(400).json({ ok: false, error: "invalid_id" });
      const contract = await getContract(db, { orgId: staff.org_id, id: q.id });
      if (!contract) return res.status(404).json({ ok: false, error: "not_found" });
      // `signed=1` asks for the finished document; the default gives whichever
      // is current, which is the signed one once everybody has signed.
      const wantSigned = q.signed === "1" ? true : (q.signed === "0" ? false : null);
      const out = await documentBytes(db, contract, { signed: wantSigned });
      if (!out) return res.status(404).json({ ok: false, error: "no_file" });
      res.setHeader("cache-control", "private, no-store");
      return res.status(200).json({
        ok: true, file: "contract", filename: out.filename, signed: out.signed,
        pdf_base64: out.bytes.toString("base64")
      });
    }

    // ── one contract, with its words ────────────────────────────────────────
    if (q.id != null && q.id !== "") {
      if (!isUuid(q.id)) return res.status(400).json({ ok: false, error: "invalid_id" });
      const contract = await getContract(db, { orgId: staff.org_id, id: q.id });
      if (!contract) return res.status(404).json({ ok: false, error: "not_found" });

      /* The integrity verdict is computed for the CRM too, not just for the
         signing page. "Is this still the document we sent?" is a question a
         staff member should be able to answer from the screen without asking
         anyone, and a tampered contract must be visible before somebody chases
         a client who cannot sign it. */
      const integrity = await verifyIntegrity(db, contract);
      const template = await getTemplate(db, { orgId: staff.org_id, id: contract.template_id });
      const signers = await listSigners(db, contract.id);

      return res.status(200).json({
        ok: true,
        contract: redact(contract),
        integrity: { ok: integrity.ok, reason: integrity.reason },
        copy_hash: signedCopyHash(contract),
        manual_fields: template ? normaliseManualFields(template.manual_fields) : [],
        signers: redact(signers),
        waiting_on: waitingSummary(signers, contract.signing_order)
      });
    }

    // ── the template library ────────────────────────────────────────────────
    if (String(q.view || "").toLowerCase() === "templates") {
      const rows = await listTemplates(db, {
        orgId: staff.org_id, activeOnly: String(q.active_only || "") === "1", limit
      });
      const items = rows.map((r) => ({
        ...redact(r),
        manual_fields: normaliseManualFields(r.manual_fields)
      }));
      return res.status(200).json({ ok: true, view: "templates", count: items.length, items });
    }

    // ── the queue ───────────────────────────────────────────────────────────
    if (q.client_id != null && q.client_id !== "" && !isUuid(q.client_id)) {
      return res.status(400).json({ ok: false, error: "invalid_client_id" });
    }

    /* A list of document ids, capped. The cap is the same 200 the limit caps at,
       because a caller asking about more rows than can come back is asking a
       question this answer cannot fully answer — and silently truncating it
       would leave a screen showing some contracts decorated and some not, with
       nothing saying why. */
    let documentIds = null;
    if (q.document_id != null && String(q.document_id).trim() !== "") {
      documentIds = String(q.document_id).split(",").map((s) => s.trim()).filter(Boolean);
      if (!documentIds.length || !documentIds.every(isUuid)) {
        return res.status(400).json({
          ok: false, error: "invalid_document_id",
          message: "document_id takes one document id, or several separated by commas."
        });
      }
      if (documentIds.length > 200) {
        return res.status(400).json({
          ok: false, error: "invalid_document_id",
          message: "Ask about 200 documents at a time or fewer."
        });
      }
    }

    const status = q.status && STATUSES.has(String(q.status)) ? String(q.status) : null;
    const rows = await listContracts(db, {
      orgId: staff.org_id, clientId: q.client_id || null, status, documentIds, limit
    });
    return res.status(200).json({
      ok: true, view: "contracts", count: rows.length, items: redact(rows)
    });
  } catch (err) {
    if (err && CLIENT_DATA_ERRORS.has(err.code)) {
      return res.status(400).json({ ok: false, error: "bad_request_parameter" });
    }
    return res.status(500).json({ ok: false, error: "read_failed", message: "Something went wrong loading that contract. Try again in a moment.", detail: safeError(err) });
  }
}
