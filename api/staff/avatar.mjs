// POST/GET /api/staff/avatar — an employee's own profile photo.
//
// SELF-SCOPED, NO EXCEPTIONS. Every internal role (owner, sales-manager,
// closer, funding-advisor, inquiry-remover) may upload and read back their
// own photo — requireAuth only, no role gate, no staffId parameter anywhere
// in this file. There is nothing to gate because there is nothing to name:
// both handlers act on req.staff.id and only req.staff.id.
//
// PNG/JPEG ONLY, SNIFFED BY MAGIC NUMBER. A declared Content-Type or a
// filename extension is whatever the uploader's browser said it was — see
// src/documents/upload-validate.mjs's header for why that is never trusted.
// This reuses that file's sniffMimeType() but keeps its own allow-list
// (png/jpeg, not pdf) and its own 5MB cap: a profile photo is a much smaller,
// narrower thing than a client document, so it gets a tighter policy rather
// than reusing validateUpload()'s 10MB/pdf-inclusive default.
//
// STORAGE, NOT THE DOCUMENTS REGISTRY. api/documents-upload.mjs's pattern
// (store + register a documents/document_versions row) is for CLIENT-owned
// documents. An avatar belongs to a staff member, not a client, so there is
// no client_id to file it under and no reason to create an audit trail of
// versions for it — it is one mutable photo, replaced wholesale on each
// upload. So this calls storeFromEnv().provider.put()/get() directly (the
// same store.mjs provider documents-upload.mjs uses) and keeps the single
// resulting opaque storage key on staff.avatar_key
// (db/migrations/262_staff_avatar_key.sql) instead of a documents row.
//
// THE KEY NEVER LEAVES THIS PROCESS. Under some providers (see store.mjs's
// header) a storage key is itself a bearer credential. It is written to the
// db and read back to fetch bytes, and it is never present in a JSON
// response — the frontend gets a fixed path ("/api/staff/avatar") instead,
// which is exactly the shape src/auth/session.mjs's avatarUrl projection and
// this file's own 200 responses both hand out.

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { sniffMimeType } from "../../src/documents/upload-validate.mjs";
import { storeFromEnv, checksumOf, extensionFor, toBytes } from "../../src/documents/store.mjs";
import { safeError } from "../../src/http/health.mjs";

const ALLOWED_MIME_TYPES = Object.freeze(["image/png", "image/jpeg"]);
const MAX_BYTES = 5 * 1024 * 1024; // 5MB — a square profile photo, not a document.
const AVATAR_URL = "/api/staff/avatar";

export default async function handler(req, res) {
  const staff = await requireAuth(req, res, { db });
  if (!staff) return;

  if (req.method === "POST") return handleUpload(req, res, staff);
  if (req.method === "GET") return handleDownload(req, res, staff);

  res.setHeader("allow", "GET, POST");
  return res.status(405).json({ ok: false, error: "method_not_allowed" });
}

async function handleUpload(req, res, staff) {
  const body = req.body || {};
  const files = Array.isArray(body.files) ? body.files : [];
  const file = files.find((f) => f.field === "photo");
  if (!file || !file.buffer || !file.buffer.length) {
    return res.status(400).json({
      ok: false, error: "no_file", message: "expected a multipart 'photo' field"
    });
  }

  const verdict = validateAvatarUpload({ buffer: file.buffer, declaredMimeType: file.mimeType });
  if (!verdict.ok) {
    return res.status(400).json({ ok: false, error: verdict.code, message: verdict.message });
  }

  const store = storeFromEnv();
  const bytes = toBytes(file.buffer);
  const checksum = checksumOf(bytes);
  const hex = checksum.includes(":") ? checksum.split(":")[1] : checksum;
  const pathname = `staff-avatars/${safe(staff.org_id)}/${safe(staff.id)}/${hex}${extensionFor(verdict.mimeType)}`;

  let storageKey;
  try {
    storageKey = await store.provider.put(pathname, bytes, { contentType: verdict.mimeType });
  } catch (err) {
    return res.status(500).json({ ok: false, error: safeError(err) });
  }

  await db.query(
    `UPDATE staff SET avatar_key = $1, updated_at = now() WHERE id = $2`,
    [storageKey, staff.id]
  );

  return res.status(200).json({ ok: true, avatarUrl: AVATAR_URL });
}

async function handleDownload(req, res, staff) {
  const row = (await db.query(
    `SELECT avatar_key FROM staff WHERE id = $1`, [staff.id]
  )).rows[0];
  if (!row || !row.avatar_key) {
    return res.status(404).json({ ok: false, error: "not_found" });
  }

  const store = storeFromEnv();
  let object;
  try {
    object = await store.provider.get(row.avatar_key);
  } catch (err) {
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
  if (!object) return res.status(404).json({ ok: false, error: "not_found" });

  res.setHeader("cache-control", "private, no-store");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("content-type", object.contentType || "application/octet-stream");
  return res.status(200).end(toBytes(object.body));
}

/**
 * validateAvatarUpload — same shape as src/documents/upload-validate.mjs's
 * validateUpload() (never throws; { ok:true, mimeType } or { ok:false, code,
 * message }), narrowed to this feature's own allow-list and size cap rather
 * than that file's document-wide ones.
 */
function validateAvatarUpload({ buffer, declaredMimeType = null }) {
  if (!buffer || buffer.length === 0) {
    return { ok: false, code: "empty_file", message: "the file is empty" };
  }
  if (buffer.length > MAX_BYTES) {
    return {
      ok: false, code: "file_too_large",
      message: `file is ${buffer.length} bytes, over the ${MAX_BYTES} byte limit`
    };
  }
  const sniffed = sniffMimeType(buffer);
  if (!sniffed || !ALLOWED_MIME_TYPES.includes(sniffed)) {
    return {
      ok: false, code: "invalid_file_type",
      message: `only jpg and png photos are accepted (declared type: ${declaredMimeType || "unknown"})`
    };
  }
  return { ok: true, mimeType: sniffed };
}

// Dots stripped along with everything else non-alphanumeric — same rule
// store.mjs's own path builder uses, so a storage path segment can never
// smuggle a ".." traversal.
function safe(s) {
  return String(s ?? "").replace(/[^a-zA-Z0-9_-]/g, "-");
}
