import { test } from "node:test";
import assert from "node:assert";
import { sniffMimeType, validateUpload, maxUploadBytes, DEFAULT_MAX_BYTES, ALLOWED_MIME_TYPES } from "./upload-validate.mjs";

const PDF = Buffer.from("%PDF-1.4\nfake pdf body");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2]);
const TEXT = Buffer.from("just some text, not a document at all");

// ---------------------------------------------------------------------------
// sniffMimeType — the bytes decide, not the filename or declared header
// ---------------------------------------------------------------------------
test("sniffs a pdf by its %PDF magic number", () => {
  assert.strictEqual(sniffMimeType(PDF), "application/pdf");
});
test("sniffs a png by its 8-byte signature", () => {
  assert.strictEqual(sniffMimeType(PNG), "image/png");
});
test("sniffs a jpeg by its FF D8 FF prefix", () => {
  assert.strictEqual(sniffMimeType(JPG), "image/jpeg");
});
test("returns null for bytes matching none of the accepted types", () => {
  assert.strictEqual(sniffMimeType(TEXT), null);
});
test("returns null for an empty buffer", () => {
  assert.strictEqual(sniffMimeType(Buffer.alloc(0)), null);
  assert.strictEqual(sniffMimeType(null), null);
});
test("a short buffer that happens to prefix-match a longer signature does not false-positive", () => {
  // Two bytes of PNG's 8-byte signature — must not be reported as a png.
  assert.strictEqual(sniffMimeType(Buffer.from([0x89, 0x50])), null);
});
test("a renamed .pdf that is actually plain text is NOT sniffed as a pdf", () => {
  assert.notStrictEqual(sniffMimeType(TEXT), "application/pdf");
});

// ---------------------------------------------------------------------------
// validateUpload — the verdict validate-upload actually returns
// ---------------------------------------------------------------------------
test("accepts a real pdf under the size cap", () => {
  const v = validateUpload({ buffer: PDF, declaredMimeType: "application/pdf", maxBytes: 1024 });
  assert.deepStrictEqual(v, { ok: true, mimeType: "application/pdf" });
});

test("rejects a file whose declared type lies about its bytes", () => {
  const v = validateUpload({ buffer: TEXT, declaredMimeType: "application/pdf", maxBytes: 1024 });
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.code, "invalid_file_type");
});

test("rejects a disallowed real type (e.g. a zip, gif, exe)", () => {
  const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);
  const v = validateUpload({ buffer: ZIP, declaredMimeType: "application/zip", maxBytes: 1024 });
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.code, "invalid_file_type");
});

test("rejects an empty file", () => {
  const v = validateUpload({ buffer: Buffer.alloc(0), maxBytes: 1024 });
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.code, "empty_file");
});

test("rejects a file over the size cap", () => {
  const big = Buffer.concat([PDF, Buffer.alloc(2000)]);
  const v = validateUpload({ buffer: big, maxBytes: 100 });
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.code, "file_too_large");
});

test("accepts a file exactly at the size cap", () => {
  const exact = Buffer.concat([PDF, Buffer.alloc(100 - PDF.length)]);
  assert.strictEqual(exact.length, 100);
  const v = validateUpload({ buffer: exact, maxBytes: 100 });
  assert.strictEqual(v.ok, true);
});

test("never throws on garbage input", () => {
  assert.doesNotThrow(() => validateUpload({}));
  assert.doesNotThrow(() => validateUpload({ buffer: undefined }));
});

// ---------------------------------------------------------------------------
// maxUploadBytes — env override, sane default
// ---------------------------------------------------------------------------
test("defaults to DEFAULT_MAX_BYTES with no env override", () => {
  assert.strictEqual(maxUploadBytes({}), DEFAULT_MAX_BYTES);
});
test("DOCUMENT_UPLOAD_MAX_BYTES overrides the default", () => {
  assert.strictEqual(maxUploadBytes({ DOCUMENT_UPLOAD_MAX_BYTES: "500" }), 500);
});
test("an invalid override falls back to the default rather than disabling the cap", () => {
  assert.strictEqual(maxUploadBytes({ DOCUMENT_UPLOAD_MAX_BYTES: "not-a-number" }), DEFAULT_MAX_BYTES);
  assert.strictEqual(maxUploadBytes({ DOCUMENT_UPLOAD_MAX_BYTES: "-5" }), DEFAULT_MAX_BYTES);
  assert.strictEqual(maxUploadBytes({ DOCUMENT_UPLOAD_MAX_BYTES: "0" }), DEFAULT_MAX_BYTES);
});

test("ALLOWED_MIME_TYPES is exactly jpg/png/pdf, per spec", () => {
  assert.deepStrictEqual([...ALLOWED_MIME_TYPES].sort(), ["application/pdf", "image/jpeg", "image/png"]);
});
