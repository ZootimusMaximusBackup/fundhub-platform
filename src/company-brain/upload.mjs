// src/company-brain/upload.mjs — turn an uploaded file's bytes into stored,
// searchable chunks that nobody can read yet.
//
// THE SAME PIPELINE AS THE DRIVE CONNECTOR, FED FROM A DIFFERENT PLACE.
// src/company-brain/store.mjs does this job for bytes Drive handed us. This
// does it for bytes a staff member handed us, and reuses every step rather
// than growing a second copy of any of them:
//
//   office.mjs / pdf-text.mjs  →  text out of the file
//   chunk.mjs                  →  text into overlapping chunks
//   embed.mjs                  →  chunks into vectors
//   review.mjs                 →  a proposed access tier
//
// TWO GATES, NOT ONE, AND THEY ARE DIFFERENT THINGS.
//
//   access_tier      WHO could read it — set by classification. Defaults to
//                    `owner` here exactly as it does in store.mjs: fail closed.
//   approval_status  WHETHER it may be read AT ALL. Every upload is written
//                    `pending`, and retrieval refuses a pending file whatever
//                    its tier (board §3.6). Only an owner can move it.
//
// A file with no Drive id still needs a drive_file_id: the column is NOT NULL
// and UNIQUE (org_id, drive_file_id). Uploads carry `upload:<uuid>`, which no
// real Drive id can collide with.
//
// Board: docs/workflows/company-brain-chat-2026-08-17.md §3.1, §3.2, §3.6, §3.7.

import crypto from "node:crypto";
import { chunkText } from "./chunk.mjs";
import { embedTexts, toVectorLiteral } from "./embed.mjs";
import { classifyAndApply } from "./review.mjs";
import { extractOfficeText } from "./office.mjs";
import { extractPdfText } from "./pdf-text.mjs";
import { PDF_MIME, TEXT_MIME, OOXML_MIME_TYPES } from "./upload-validate.mjs";

/** Synthetic Drive id for a file that never came from Drive. */
export function uploadDriveFileId(id = crypto.randomUUID()) {
  return `upload:${id}`;
}

function sha256(text) {
  return crypto.createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

/**
 * extractUploadText — bytes in, plain text out. Never throws: a file we cannot
 * read is a verdict, not a crash.
 *
 * @returns {{ ok: true, text: string, needsOcr: boolean } | { ok: false, reason: string }}
 */
export async function extractUploadText(buffer, mimeType, {
  extractOffice = extractOfficeText,
  extractPdf = extractPdfText
} = {}) {
  const mime = String(mimeType || "").toLowerCase();
  try {
    if (mime === PDF_MIME) {
      const out = await extractPdf(buffer);
      return { ok: true, text: String(out?.text || ""), needsOcr: !!out?.needsOcr };
    }
    if (OOXML_MIME_TYPES.includes(mime)) {
      const out = extractOffice(buffer, mime);
      if (!out || !out.ok) return { ok: false, reason: out?.reason || "extract_failed" };
      return { ok: true, text: String(out.text || ""), needsOcr: false };
    }
    if (mime === TEXT_MIME) {
      // The validator already proved these bytes decode as strict UTF-8.
      return { ok: true, text: Buffer.from(buffer).toString("utf8"), needsOcr: false };
    }
  } catch {
    // A corrupt or mislabelled file lands here. Fail closed — no text, no store.
    return { ok: false, reason: "extract_failed" };
  }
  return { ok: false, reason: "unsupported_file_type" };
}

/**
 * ingestUploadedFile — the whole journey for one uploaded file.
 *
 * Order matters and is deliberate: nothing is written until the embeddings
 * came back, so a failed embed leaves no half-indexed row behind.
 *
 * @returns {{ ok: true, fileId, driveFileId, chunkCount, approvalStatus,
 *             accessTier, proposedTier, reviewId, needsOcr, reason } |
 *           { ok: false, reason: string }}
 */
export async function ingestUploadedFile(db, {
  orgId,
  staffId = null,
  buffer,
  mimeType,
  originalName = "",
  env = process.env,
  fetchImpl,
  embed = embedTexts,
  classify = true,
  classifyFn = null,
  applyClassification = classifyAndApply,
  extractText = extractUploadText,
  newDriveFileId = uploadDriveFileId
} = {}) {
  if (!orgId) return { ok: false, reason: "org_id_required" };
  if (!buffer || buffer.length === 0) return { ok: false, reason: "empty_file" };
  if (!mimeType) return { ok: false, reason: "mime_type_required" };

  const name = String(originalName || "").trim() || "Untitled upload";

  const extracted = await extractText(buffer, mimeType);
  if (!extracted.ok) return { ok: false, reason: extracted.reason || "extract_failed" };

  const text = String(extracted.text || "").trim();
  const chunks = text ? chunkText(text) : [];

  // Embed BEFORE the insert. A 502 from the embedding provider must not leave
  // a row in brain_files that nobody can ever search.
  let embeddings = [];
  if (chunks.length > 0) {
    const embedded = await embed(chunks, { env, fetchImpl });
    if (!embedded.ok) return { ok: false, reason: "embed_failed" };
    embeddings = embedded.embeddings || [];
    if (embeddings.length !== chunks.length) return { ok: false, reason: "embed_failed" };
  }

  const driveFileId = newDriveFileId();

  const ins = await db.query(
    `INSERT INTO brain_files (
       org_id, drive_file_id, name, mime_type, web_view_link,
       access_tier, client_id, unattached, needs_transcription, needs_ocr,
       content_sha256, indexed_at,
       source, approval_status, original_name, size_bytes, uploaded_by
     ) VALUES ($1,$2,$3,$4,NULL,
               'owner',NULL,false,false,$5,
               $6, now(),
               'upload','pending',$7,$8,$9)
     RETURNING id, created_at`,
    [
      orgId,
      driveFileId,
      name,
      mimeType,
      !!extracted.needsOcr,
      text ? sha256(text) : null,
      String(originalName || ""),
      buffer.length,
      staffId || null
    ]
  );
  const fileId = ins.rows?.[0]?.id;
  if (!fileId) return { ok: false, reason: "insert_failed" };

  for (let i = 0; i < chunks.length; i++) {
    await db.query(
      `INSERT INTO brain_chunks (org_id, file_id, chunk_index, content, access_tier, embedding)
       VALUES ($1, $2, $3, $4, 'owner', $5::vector)`,
      [orgId, fileId, i, chunks[i], toVectorLiteral(embeddings[i])]
    );
  }

  // Classification proposes a tier. It never changes approval_status — an
  // auto-assigned `sales` tier on a pending file is still unanswerable.
  //
  // `kind: "upload"` is what board §3.6 needs so an upload proposing a tier
  // that would auto-assign on the Drive path still queues for the owner.
  // review.mjs is W5's file; passing the key here is inert until they read it.
  let classification = null;
  if (classify) {
    classification = await applyClassification(db, {
      orgId,
      fileId,
      driveFileId,
      name,
      path: name,
      text,
      parentNames: [],
      kind: "upload",
      env,
      fetchImpl,
      classify: classifyFn
    });
  }

  return {
    ok: true,
    fileId,
    driveFileId,
    chunkCount: chunks.length,
    approvalStatus: "pending",
    accessTier: classification?.accessTier || "owner",
    proposedTier: classification?.proposedTier || null,
    reviewId: classification?.reviewId || null,
    needsOcr: !!extracted.needsOcr,
    uploadedAt: ins.rows?.[0]?.created_at || null,
    reason: chunks.length === 0 ? "no_text" : null
  };
}

/**
 * listUploads — the uploaded documents for one org, newest first (board §3.2).
 * Drive-synced rows are deliberately excluded: this list is what a staff member
 * uploaded and what the owner still has to approve.
 */
export async function listUploads(db, { orgId, limit = 50 } = {}) {
  if (!orgId) return { ok: false, reason: "org_id_required", uploads: [], pendingCount: 0 };
  const lim = Math.max(1, Math.min(200, Number(limit) || 50));

  const res = await db.query(
    `SELECT f.id, f.name, f.original_name, f.mime_type, f.size_bytes,
            f.approval_status, f.access_tier, f.proposed_tier, f.created_at,
            s.name AS uploaded_by_name,
            (SELECT count(*) FROM brain_chunks c WHERE c.file_id = f.id) AS chunk_count
       FROM brain_files f
       LEFT JOIN staff s ON s.id = f.uploaded_by
      WHERE f.org_id = $1 AND f.source = 'upload'
      ORDER BY f.created_at DESC
      LIMIT $2`,
    [orgId, lim]
  );

  const counted = await db.query(
    `SELECT count(*)::int AS pending
       FROM brain_files
      WHERE org_id = $1 AND source = 'upload' AND approval_status = 'pending'`,
    [orgId]
  );

  const uploads = (res.rows || []).map((r) => ({
    id: r.id,
    name: r.name || r.original_name || "",
    mimeType: r.mime_type || "",
    // NULL means unknown, and unknown must survive as null — never 0.
    sizeBytes: r.size_bytes == null ? null : Number(r.size_bytes),
    approvalStatus: r.approval_status,
    accessTier: r.access_tier,
    proposedTier: r.proposed_tier || null,
    chunkCount: r.chunk_count == null ? null : Number(r.chunk_count),
    uploadedAt: r.created_at,
    uploadedByName: r.uploaded_by_name || null
  }));

  return {
    ok: true,
    reason: null,
    uploads,
    pendingCount: Number(counted.rows?.[0]?.pending || 0)
  };
}
