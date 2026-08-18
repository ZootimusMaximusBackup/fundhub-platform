// src/company-brain/upload-validate.mjs — what a staff-uploaded Company Brain
// file must look like before a single byte of it is read, chunked or stored.
//
// SEPARATE FROM src/documents/upload-validate.mjs ON PURPOSE. That file guards
// client identity documents and accepts jpg / png / pdf only. Company Brain
// takes the knowledge-document set instead — pdf, plain text / markdown, and
// the three OOXML office formats — so widening the documents validator would
// have widened what a client may upload as an ID. Two accept lists, two files,
// one shared idea: sniff the bytes, never believe the claim.
//
// THE CLAIM PROVES NOTHING. A multipart part's `filename` and `Content-Type`
// are typed by whoever is holding the upload button. A file named
// "policy.pdf" whose bytes are a Mach-O binary is a Mach-O binary.
//
// THE ONE PLACE THE DECLARED TYPE IS USED, AND WHY. docx, xlsx and pptx are
// all zip archives: their bytes begin with the same four `PK\x03\x04` and
// nothing in that prefix says which one it is. So the signature is checked
// FIRST — the bytes must really be a zip — and only then is the declared type
// read to decide which of the three it is. A declared type that is not one of
// those three is rejected, and a declared type that contradicts the sniffed
// bytes is rejected. The declared value narrows; it never promotes.
//
// Error codes match the frozen contract in
// docs/workflows/company-brain-chat-2026-08-17.md §3.1 so a handler maps them
// straight to a status with no translation table.

export const PDF_MIME = "application/pdf";
export const TEXT_MIME = "text/plain";

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

/** The three zip-based office formats, keyed by their declared MIME type. */
export const OOXML_MIME_TYPES = Object.freeze([DOCX_MIME, XLSX_MIME, PPTX_MIME]);

export const ALLOWED_MIME_TYPES = Object.freeze([
  PDF_MIME,
  TEXT_MIME,
  ...OOXML_MIME_TYPES
]);

export const DEFAULT_MAX_BYTES = 25 * 1024 * 1024; // 25 MB — board §3.1

export function maxUploadBytes(env = process.env) {
  const raw = Number(env && env.COMPANY_BRAIN_UPLOAD_MAX_BYTES);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_BYTES;
}

const PDF_SIG = [0x25, 0x50, 0x44, 0x46];        // %PDF
const ZIP_SIG = [0x50, 0x4b, 0x03, 0x04];        // PK\x03\x04

// Declared types that say nothing at all. A browser sends one of these for a
// .md file, and for anything it does not recognise, so they must not be read
// as a contradiction of what the bytes say.
const UNINFORMATIVE_DECLARED = new Set(["", "application/octet-stream", "binary/octet-stream"]);

/** Strip the parameters off a Content-Type: "text/plain; charset=utf-8" → "text/plain". */
export function normalizeDeclaredType(declared) {
  return String(declared || "").split(";")[0].trim().toLowerCase();
}

function startsWith(buffer, bytes) {
  if (buffer.length < bytes.length) return false;
  return bytes.every((b, i) => buffer[i] === b);
}

/**
 * looksLikeUtf8Text — plain text has no signature, so it is proved by what it
 * is NOT: it must decode as strict UTF-8 and must not carry the NUL bytes and
 * control characters that every binary format is full of.
 *
 * The strict decode alone is not enough. An ELF executable begins
 * `\x7fELF\x02\x01\x01\x00` — four printable ASCII characters followed by
 * bytes that are each individually valid UTF-8. The NUL check is what catches
 * it, and it catches Windows PE and most other binaries for the same reason.
 */
export function looksLikeUtf8Text(buffer) {
  if (!buffer || buffer.length === 0) return false;
  // A NUL byte never appears in a text document and always appears in a binary.
  if (buffer.includes(0x00)) return false;
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return false;
  }
  // Tab, newline, carriage return and form feed are the only control
  // characters a text file has any business containing.
  let control = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d && code !== 0x0c) control++;
    if (code === 0x7f) control++;
  }
  return control === 0;
}

/**
 * sniffKind — what the BYTES are, with no reference to any claim.
 * @returns {"pdf" | "zip" | "text" | null}
 */
export function sniffKind(buffer) {
  if (!buffer || buffer.length === 0) return null;
  if (startsWith(buffer, PDF_SIG)) return "pdf";
  if (startsWith(buffer, ZIP_SIG)) return "zip";
  if (looksLikeUtf8Text(buffer)) return "text";
  return null;
}

function reject(code, message) {
  return { ok: false, code, message };
}

/**
 * validateCompanyBrainUpload — one file in, a verdict out. Never throws; the
 * caller turns a rejection into the HTTP response.
 *
 * @param {object} input
 * @param {Buffer} input.buffer          the uploaded bytes
 * @param {string|null} input.declaredMimeType  the multipart part's Content-Type
 * @param {number} input.maxBytes        size ceiling in bytes
 * @returns {{ ok: true, mimeType: string } | { ok: false, code: string, message: string }}
 */
export function validateCompanyBrainUpload({
  buffer,
  declaredMimeType = null,
  maxBytes = DEFAULT_MAX_BYTES
} = {}) {
  if (!buffer || buffer.length === 0) {
    return reject("empty_file", "that file is empty");
  }
  if (buffer.length > maxBytes) {
    return reject(
      "file_too_large",
      `that file is ${buffer.length} bytes, over the ${maxBytes} byte limit`
    );
  }

  const declared = normalizeDeclaredType(declaredMimeType);
  const vague = UNINFORMATIVE_DECLARED.has(declared);
  const kind = sniffKind(buffer);

  if (kind === "pdf") {
    // A declared type that names a different accepted format is a contradiction.
    if (!vague && declared !== PDF_MIME) {
      return reject(
        "unsupported_file_type",
        `the file says it is ${declared} but the bytes are a PDF`
      );
    }
    return { ok: true, mimeType: PDF_MIME };
  }

  if (kind === "zip") {
    // The signature checked out, so the declared type is now allowed to say
    // WHICH office format this is — and nothing else.
    if (!OOXML_MIME_TYPES.includes(declared)) {
      return reject(
        "unsupported_file_type",
        "only Word, Excel and PowerPoint files are accepted in this format"
      );
    }
    return { ok: true, mimeType: declared };
  }

  if (kind === "text") {
    // Bytes that are plain text cannot also be a PDF or an office document.
    if (!vague && (declared === PDF_MIME || OOXML_MIME_TYPES.includes(declared))) {
      return reject(
        "unsupported_file_type",
        `the file says it is ${declared} but the bytes are plain text`
      );
    }
    return { ok: true, mimeType: TEXT_MIME };
  }

  return reject(
    "unsupported_file_type",
    `only pdf, text, markdown, Word, Excel and PowerPoint files are accepted (declared type: ${declared || "unknown"})`
  );
}
