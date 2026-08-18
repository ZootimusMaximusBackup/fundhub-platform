import test from "node:test";
import assert from "node:assert/strict";

import {
  validateCompanyBrainUpload,
  maxUploadBytes,
  sniffKind,
  looksLikeUtf8Text,
  normalizeDeclaredType,
  DEFAULT_MAX_BYTES,
  PDF_MIME,
  TEXT_MIME,
  DOCX_MIME,
  XLSX_MIME,
  PPTX_MIME
} from "./upload-validate.mjs";

const PDF_BYTES = Buffer.concat([
  Buffer.from("%PDF-1.4\n", "ascii"),
  Buffer.from("1 0 obj<</Type/Catalog>>endobj\n%%EOF\n", "ascii")
]);

// The first four bytes are all any of the three office formats has in common.
function zipBytes() {
  return Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from("word/document.xml junk", "ascii")
  ]);
}

// ELF: four printable ASCII characters, then bytes a text file never carries.
const ELF_BYTES = Buffer.from([
  0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
]);

test("maxUploadBytes is 25 MB and honours the env override", () => {
  assert.equal(DEFAULT_MAX_BYTES, 25 * 1024 * 1024);
  assert.equal(maxUploadBytes({}), DEFAULT_MAX_BYTES);
  assert.equal(maxUploadBytes({ COMPANY_BRAIN_UPLOAD_MAX_BYTES: "1024" }), 1024);
  // Nonsense falls back rather than opening the door.
  assert.equal(maxUploadBytes({ COMPANY_BRAIN_UPLOAD_MAX_BYTES: "nope" }), DEFAULT_MAX_BYTES);
  assert.equal(maxUploadBytes({ COMPANY_BRAIN_UPLOAD_MAX_BYTES: "-5" }), DEFAULT_MAX_BYTES);
});

test("normalizeDeclaredType drops parameters and casing", () => {
  assert.equal(normalizeDeclaredType("Text/Plain; charset=UTF-8"), "text/plain");
  assert.equal(normalizeDeclaredType(null), "");
});

test("accepts a pdf by its magic number", () => {
  assert.equal(sniffKind(PDF_BYTES), "pdf");
  const out = validateCompanyBrainUpload({
    buffer: PDF_BYTES,
    declaredMimeType: "application/pdf"
  });
  assert.deepEqual(out, { ok: true, mimeType: PDF_MIME });
});

test("accepts plain text and markdown with no signature at all", () => {
  const md = Buffer.from("# Closer script\n\nWhen they say the rate is high…\n", "utf8");
  assert.equal(looksLikeUtf8Text(md), true);
  assert.equal(sniffKind(md), "text");

  // A browser sends text/markdown, or nothing, or octet-stream for a .md file.
  for (const declared of ["text/markdown", "text/plain", "", null, "application/octet-stream"]) {
    const out = validateCompanyBrainUpload({ buffer: md, declaredMimeType: declared });
    assert.deepEqual(out, { ok: true, mimeType: TEXT_MIME }, `declared: ${declared}`);
  }
});

test("accepts docx, xlsx and pptx — zip signature first, declared type only to tell them apart", () => {
  assert.equal(sniffKind(zipBytes()), "zip");
  for (const mime of [DOCX_MIME, XLSX_MIME, PPTX_MIME]) {
    const out = validateCompanyBrainUpload({ buffer: zipBytes(), declaredMimeType: mime });
    assert.deepEqual(out, { ok: true, mimeType: mime });
  }
});

test("rejects a zip that does not declare which office format it is", () => {
  for (const declared of ["application/zip", "", "application/pdf", null]) {
    const out = validateCompanyBrainUpload({ buffer: zipBytes(), declaredMimeType: declared });
    assert.equal(out.ok, false, `declared: ${declared}`);
    assert.equal(out.code, "unsupported_file_type");
  }
});

test("rejects an executable renamed to look like a document", () => {
  assert.equal(sniffKind(ELF_BYTES), null);
  const out = validateCompanyBrainUpload({
    buffer: ELF_BYTES,
    declaredMimeType: "application/pdf" // the claim, and it is a lie
  });
  assert.equal(out.ok, false);
  assert.equal(out.code, "unsupported_file_type");

  // A Windows binary is refused the same way.
  const pe = Buffer.concat([Buffer.from("MZ", "ascii"), Buffer.alloc(30)]);
  const outPe = validateCompanyBrainUpload({ buffer: pe, declaredMimeType: "text/plain" });
  assert.equal(outPe.ok, false);
  assert.equal(outPe.code, "unsupported_file_type");
});

test("rejects an empty file", () => {
  const out = validateCompanyBrainUpload({
    buffer: Buffer.alloc(0),
    declaredMimeType: "application/pdf"
  });
  assert.equal(out.ok, false);
  assert.equal(out.code, "empty_file");

  const missing = validateCompanyBrainUpload({ buffer: null });
  assert.equal(missing.ok, false);
  assert.equal(missing.code, "empty_file");
});

test("rejects a file over the size limit", () => {
  const out = validateCompanyBrainUpload({
    buffer: PDF_BYTES,
    declaredMimeType: "application/pdf",
    maxBytes: 4
  });
  assert.equal(out.ok, false);
  assert.equal(out.code, "file_too_large");
});

test("rejects when the declared type and the sniffed bytes disagree", () => {
  // Really a PDF, claims to be a Word document.
  const lyingPdf = validateCompanyBrainUpload({
    buffer: PDF_BYTES,
    declaredMimeType: DOCX_MIME
  });
  assert.equal(lyingPdf.ok, false);
  assert.equal(lyingPdf.code, "unsupported_file_type");

  // Really plain text, claims to be a spreadsheet.
  const lyingText = validateCompanyBrainUpload({
    buffer: Buffer.from("just words", "utf8"),
    declaredMimeType: XLSX_MIME
  });
  assert.equal(lyingText.ok, false);
  assert.equal(lyingText.code, "unsupported_file_type");

  // Really plain text, claims to be a PDF.
  const lyingPdfClaim = validateCompanyBrainUpload({
    buffer: Buffer.from("just words", "utf8"),
    declaredMimeType: PDF_MIME
  });
  assert.equal(lyingPdfClaim.ok, false);
  assert.equal(lyingPdfClaim.code, "unsupported_file_type");
});

test("invalid utf8 is not text", () => {
  // 0xcf starts a two-byte sequence; 0xfa cannot continue it.
  assert.equal(looksLikeUtf8Text(Buffer.from([0xcf, 0xfa, 0xed, 0xfe])), false);
  // Valid multi-byte utf8 IS text.
  assert.equal(looksLikeUtf8Text(Buffer.from("café — naïve\n", "utf8")), true);
});
