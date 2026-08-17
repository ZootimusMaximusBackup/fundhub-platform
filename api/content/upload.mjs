// POST /api/content/upload — a welcome video lands in storage and in
// content_videos, in one call. Same multipart shape as /api/documents-upload
// (req.body.files / req.body.fields from netlify/functions/api.mjs).
//
// Owner/admin only — ROLE_SETS.OPS, same gate as /api/content/tiles.
// Bytes go through the document store's provider, not the client-document
// registry: store.put() requires a client id, and a welcome video is not
// a client's file.

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { requireRole, ROLE_SETS } from "../../src/http/read-api.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import { safeError } from "../../src/http/health.mjs";
import { storeFromEnv, checksumOf, extensionFor } from "../../src/documents/store.mjs";
import { maxUploadBytes } from "../../src/documents/upload-validate.mjs";

const VIDEO_MIME = new Set(["video/mp4", "video/quicktime", "video/webm"]);

function sniffVideo(buffer) {
  if (!buffer || buffer.length < 8) return null;
  const tag = buffer.slice(4, 8).toString("ascii");
  if (tag === "ftyp") return "video/mp4";
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
    return "video/webm";
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      ok: false, error: "method_not_allowed",
      message: "Upload a file. This is not a page load."
    });
  }

  const staff = await requireAuth(req, res, { db });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.OPS)) return;

  const orgId = (staff && staff.org_id) || null;
  if (!orgId) {
    return res.status(400).json({
      ok: false, error: "org_required",
      message: "Your sign-in is not attached to a company."
    });
  }

  const body = req.body || {};
  const fields = body.fields || {};
  const files = Array.isArray(body.files) ? body.files : [];
  if (!files.length) {
    return res.status(400).json({
      ok: false, error: "no_file",
      message: "Choose a video file first."
    });
  }

  const file = files[0];
  const buf = file.buffer;
  if (!buf || !buf.length) {
    return res.status(400).json({
      ok: false, error: "empty_file",
      message: "That file is empty."
    });
  }

  const max = maxUploadBytes();
  if (buf.length > max) {
    return res.status(400).json({
      ok: false, error: "too_large",
      message: "That file is too large to upload here."
    });
  }

  const sniffed = sniffVideo(buf);
  const declared = String(file.mimeType || fields.mime_type || "").toLowerCase();
  if (!sniffed) {
    return res.status(400).json({
      ok: false, error: "not_a_video",
      message: "That file is not a video we can store (MP4, MOV, or WebM)."
    });
  }
  if (declared && !VIDEO_MIME.has(declared) && declared !== sniffed) {
    return res.status(400).json({
      ok: false, error: "not_a_video",
      message: "That file is not a video we can store (MP4, MOV, or WebM)."
    });
  }

  const title = String(fields.title || file.filename || "Welcome video").trim() || "Welcome video";
  const duration = String(fields.duration || fields.duration_label || "").trim() || null;
  const mime = sniffed === "video/mp4" && declared === "video/quicktime"
    ? "video/quicktime"
    : sniffed;

  try {
    const store = storeFromEnv();
    const checksum = checksumOf(buf);
    const hex = String(checksum).includes(":") ? String(checksum).split(":")[1] : String(checksum);
    const pathname = [
      "content",
      String(orgId).replace(/[^a-zA-Z0-9_-]/g, "-"),
      "videos",
      hex + extensionFor(mime, file.filename)
    ].join("/");
    const storageKey = await store.provider.put(pathname, buf, { contentType: mime });

    const inserted = await db.query(
      `INSERT INTO content_videos
         (org_id, title, duration_label, storage_key, mime_type, byte_size, uploaded_by)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::uuid)
       RETURNING id, title, duration_label, mime_type, byte_size, uploaded_by, created_at`,
      [orgId, title, duration, storageKey, mime, buf.length, staff.id || null]
    );

    const row = inserted.rows[0];
    return res.status(201).json({
      ok: true,
      video: {
        id: row.id,
        title: row.title,
        duration_label: row.duration_label || "",
        mime_type: row.mime_type,
        byte_size: row.byte_size == null ? null : Number(row.byte_size),
        uploaded_by: row.uploaded_by || null,
        uploaded_at: row.created_at
      }
    });
  } catch (err) {
    if (dbDown(res, err)) return;
    return res.status(500).json({
      ok: false,
      error: "upload_failed",
      message: "The video could not be stored.",
      detail: safeError(err)
    });
  }
}
