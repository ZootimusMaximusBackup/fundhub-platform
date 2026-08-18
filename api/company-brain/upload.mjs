// POST /api/company-brain/upload — a staff member adds a document to Company Brain.
// GET  /api/company-brain/upload — the documents this org has uploaded.
//
// Contracts: docs/workflows/company-brain-chat-2026-08-17.md §3.1 and §3.2.
//
// ROLE COMES FROM THE SESSION. The auth chain is the same three steps as
// api/read/company-brain.mjs, in the same order, deliberately: requireAuth,
// then ROLE_SETS.STAFF, then the Company Brain tier gate. Nothing is read off
// the request body to decide who the caller is.
//
// THE UPLOAD LANDS UNANSWERABLE. Every file stored here is written with
// approval_status 'pending'. Retrieval refuses a pending file whatever tier
// classification proposed, so an uploaded document cannot appear in an answer
// until the owner approves it (§3.6).
//
// THE MULTIPART IS ALREADY PARSED. netlify/functions/api.mjs turns
// multipart/form-data into req.body.fields and req.body.files before a handler
// ever runs. No parser and no new dependency belong in this file.

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole } from "../../src/http/read-api.mjs";
import { canQueryBrain } from "../../src/company-brain/access.mjs";
import {
  validateCompanyBrainUpload,
  maxUploadBytes
} from "../../src/company-brain/upload-validate.mjs";
import { ingestUploadedFile, listUploads } from "../../src/company-brain/upload.mjs";

// Validator code → HTTP status, straight from §3.1's error list.
const VALIDATION_STATUS = {
  empty_file: 400,
  file_too_large: 413,
  unsupported_file_type: 415
};

export default async function handler(req, res, deps = {}) {
  const database = deps.db || db;
  const env = deps.env || process.env;
  const ingest = deps.ingestUploadedFile || ingestUploadedFile;
  const list = deps.listUploads || listUploads;

  if (req.method !== "POST" && req.method !== "GET") {
    res.setHeader("allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = deps.requireAuth
    ? await deps.requireAuth(req, res, { db: database })
    : await requireAuth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.STAFF)) return;

  // External roles have no upload path at all.
  if (!canQueryBrain(staff.role)) {
    return res.status(403).json({ ok: false, error: "forbidden_role" });
  }

  if (!staff.org_id) return res.status(403).json({ ok: false, error: "no_org_scope" });

  if (req.method === "GET") {
    const found = await list(database, { orgId: staff.org_id });
    if (!found.ok) {
      return res.status(502).json({ ok: false, error: found.reason || "list_failed" });
    }
    return res.status(200).json({
      ok: true,
      uploads: found.uploads || [],
      pendingCount: found.pendingCount || 0
    });
  }

  const body = req.body || {};
  const files = Array.isArray(body.files) ? body.files : [];
  // One file per request, field name `file`. Anything else that arrived is
  // ignored rather than quietly indexed.
  const file = files.find((f) => f && f.field === "file") || files[0] || null;
  if (!file) return res.status(400).json({ ok: false, error: "no_file" });

  const buffer = file.buffer;
  if (!buffer || buffer.length === 0) {
    return res.status(400).json({ ok: false, error: "empty_file" });
  }

  const verdict = validateCompanyBrainUpload({
    buffer,
    declaredMimeType: file.mimeType,
    maxBytes: maxUploadBytes(env)
  });
  if (!verdict.ok) {
    const status = VALIDATION_STATUS[verdict.code] || 415;
    return res.status(status).json({ ok: false, error: verdict.code });
  }

  const stored = await ingest(database, {
    orgId: staff.org_id,
    staffId: staff.id || null,
    buffer,
    mimeType: verdict.mimeType,
    originalName: file.filename || "",
    env,
    fetchImpl: deps.fetchImpl
  });

  if (!stored.ok) {
    if (stored.reason === "embed_failed") {
      return res.status(502).json({ ok: false, error: "embed_failed" });
    }
    // A file whose bytes passed the signature check but whose contents could
    // not be read is, to the person who sent it, a file we do not accept.
    return res.status(415).json({ ok: false, error: "unsupported_file_type" });
  }

  return res.status(200).json({
    ok: true,
    file: {
      id: stored.fileId,
      name: file.filename || "",
      mimeType: verdict.mimeType,
      sizeBytes: buffer.length,
      source: "upload",
      approvalStatus: stored.approvalStatus,
      chunkCount: stored.chunkCount,
      proposedTier: stored.proposedTier,
      reviewId: stored.reviewId,
      uploadedAt: stored.uploadedAt || new Date().toISOString()
    }
  });
}
