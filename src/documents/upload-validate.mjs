// src/documents/upload-validate.mjs — what a client-uploaded FILE must look
// like before it ever reaches storage.
//
// TWO CHECKS, BOTH ON THE BYTES THEMSELVES, NEVER ON A CLAIM. A multipart
// field's declared filename and Content-Type are exactly that — declared, by
// whoever is holding the upload button — so a ".pdf" extension or a
// "image/png" part header proves nothing on its own. Every accepted type has
// a fixed magic-number prefix, so the file is sniffed and the DECLARED type is
// only ever used as a courtesy in error messages.

export const ALLOWED_MIME_TYPES = Object.freeze(["image/jpeg", "image/png", "application/pdf"]);

export const DEFAULT_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export function maxUploadBytes(env = process.env) {
  const raw = Number(env.DOCUMENT_UPLOAD_MAX_BYTES);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_BYTES;
}

// [prefix bytes, mime]. JPEG's magic number is only 3 bytes (FF D8 FF); PNG
// and PDF cover their whole fixed signature.
const SIGNATURES = Object.freeze([
  { mime: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46] },               // %PDF
  { mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] }
]);

/** sniffMimeType — the file's REAL type by magic number, or null if none match. */
export function sniffMimeType(buffer) {
  if (!buffer || buffer.length === 0) return null;
  for (const sig of SIGNATURES) {
    if (buffer.length < sig.bytes.length) continue;
    if (sig.bytes.every((b, i) => buffer[i] === b)) return sig.mime;
  }
  return null;
}

/* ---------------------------------------------------------------------------
   CSV — A SEPARATE, NAMED BRANCH. NOT part of sniffMimeType().
   ---------------------------------------------------------------------------
   A CSV has no magic number, so it cannot be proven the way %PDF or the PNG
   signature can. The best available check is negative: the bytes decode cleanly
   as UTF-8, hold no NUL, and the first line has a comma in it.

   That check is loose enough that it would ACCEPT ORDINARY PROSE — the string
   "just some text, not a document at all" passes it — which is exactly why it
   lives in its own function instead of inside sniffMimeType(). Every existing
   caller of sniffMimeType()/validateUpload() relies on a NULL for anything that
   is not a jpg, png or pdf, and api/documents-upload.mjs's whole file-type gate
   is built on that. Widening it here to let one new endpoint take a CSV would
   quietly widen it for every endpoint.

   So: text/csv is opt-in. Only a caller that WANTS a CSV calls these, and it
   then has to parse the thing before it trusts it (src/autopsy/parse.mjs does).
   ALLOWED_MIME_TYPES is deliberately unchanged.
--------------------------------------------------------------------------- */

export const CSV_MIME_TYPE = "text/csv";

/** How much of the head is examined. Enough to catch a binary, cheap on a big
 *  file. */
export const CSV_SNIFF_BYTES = 8 * 1024;

/** sniffCsv — "text/csv" when the bytes could be a CSV, otherwise null. */
export function sniffCsv(buffer) {
  if (!buffer || buffer.length === 0) return null;
  const head = buffer.subarray(0, CSV_SNIFF_BYTES);
  if (head.includes(0x00)) return null;                 // a NUL means binary
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(head);
  } catch {
    return null;                                        // not valid UTF-8
  }
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  if (!firstLine.includes(",")) return null;            // no separator, no CSV
  return CSV_MIME_TYPE;
}

/**
 * validateCsvUpload — the size cap and the CSV sniff, in one verdict. Same
 * shape as validateUpload() so a caller handles both the same way. Never throws.
 *
 * @returns {{ok:true, mimeType:"text/csv"} | {ok:false, code:string, message:string}}
 */
export function validateCsvUpload({ buffer, declaredMimeType = null, maxBytes = DEFAULT_MAX_BYTES } = {}) {
  if (!buffer || buffer.length === 0) {
    return { ok: false, code: "empty_file", message: "the file is empty" };
  }
  if (buffer.length > maxBytes) {
    return {
      ok: false, code: "file_too_large",
      message: `file is ${buffer.length} bytes, over the ${maxBytes} byte limit`
    };
  }
  if (sniffCsv(buffer) !== CSV_MIME_TYPE) {
    return {
      ok: false, code: "invalid_file_type",
      message: `that does not read as a CSV — save it as comma-separated text and try again (declared type: ${declaredMimeType || "unknown"})`
    };
  }
  return { ok: true, mimeType: CSV_MIME_TYPE };
}

/**
 * validateUpload — one file in, a verdict out. Never throws; the caller turns
 * a rejection into the HTTP response.
 *
 * @returns {{ ok: true, mimeType: string } | { ok: false, code: string, message: string }}
 */
export function validateUpload({ buffer, declaredMimeType = null, maxBytes = DEFAULT_MAX_BYTES } = {}) {
  if (!buffer || buffer.length === 0) {
    return { ok: false, code: "empty_file", message: "the file is empty" };
  }
  if (buffer.length > maxBytes) {
    return {
      ok: false, code: "file_too_large",
      message: `file is ${buffer.length} bytes, over the ${maxBytes} byte limit`
    };
  }
  const sniffed = sniffMimeType(buffer);
  if (!sniffed || !ALLOWED_MIME_TYPES.includes(sniffed)) {
    return {
      ok: false, code: "invalid_file_type",
      message: `only jpg, png and pdf are accepted (declared type: ${declaredMimeType || "unknown"})`
    };
  }
  return { ok: true, mimeType: sniffed };
}
