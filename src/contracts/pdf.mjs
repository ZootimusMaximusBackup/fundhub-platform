// src/contracts/pdf.mjs — reading an uploaded PDF, and producing the signed one.
//
// Two jobs, and only two:
//
//   inspect()  read a freshly uploaded file: how many pages, and how big is
//              each one. The field editor cannot lay a single box out without
//              this, and the flattener cannot convert a box back into a
//              position on the page without it either.
//
//   flatten()  take the original file, draw every filled field onto the page it
//              belongs on, append a signature record page, and hand back the
//              finished bytes. This is the artifact the client keeps.
//
// ── COORDINATES, WHICH IS WHERE THIS GOES WRONG IF IT GOES WRONG ────────────
//
// A field's position is stored as FRACTIONS of its page — x, y, w, h all
// between 0 and 1 — with the origin at the TOP LEFT, because that is how a
// browser lays out the editor and how a person thinks about a page.
//
// PDF is the other way round: points from the BOTTOM left. So every conversion
// in this file is
//
//     px = x * pageWidth
//     py = (1 - y - h) * pageHeight        ← the flip, and the reason for it
//
// Getting that backwards puts every signature at the top of the page instead of
// the bottom, on a document somebody has already agreed to. It is checked
// directly in src/contracts/pdf.test.mjs rather than left to a visual inspection
// nobody will repeat.
//
// ── WHY pdf-lib ─────────────────────────────────────────────────────────────
// Pure JavaScript, no native build step, no external binary. The alternative —
// leaving the uploaded file untouched and shipping a separate "here is what
// they agreed" certificate — would mean the client's copy is not actually a
// filled-in contract, which is the whole thing that was asked for. Added as a
// dependency on the owner's explicit instruction to build this ("just edit the
// PDF, and then from there put in fields"). Recorded in docs/CONTRACTS-SPEC.md.

import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";

export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;   // 12 MB
export const PDF_MIME = "application/pdf";

/** A PDF always starts with these five bytes. Checked before pdf-lib is asked
    to parse anything, so a renamed .docx fails with a sentence a person can act
    on instead of a parser stack trace. */
export const looksLikePdf = (bytes) =>
  Buffer.isBuffer(bytes) && bytes.length > 4 && bytes.subarray(0, 5).toString("latin1") === "%PDF-";

export class PdfError extends Error {
  constructor(message, code = "pdf_error") {
    super(message);
    this.name = "PdfError";
    this.code = code;
    this.status = 400;
  }
}

/**
 * inspect — page count and page sizes, straight out of the file.
 *
 * Also the upload gate: everything that can be wrong with a file is decided
 * here, once, so no other module has to guess.
 */
export async function inspect(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
    throw new PdfError("That file is empty.", "empty_file");
  }
  if (bytes.length > MAX_UPLOAD_BYTES) {
    throw new PdfError(
      `That file is ${(bytes.length / 1024 / 1024).toFixed(1)} MB. The limit is ` +
      `${MAX_UPLOAD_BYTES / 1024 / 1024} MB — try saving it again at a smaller size.`,
      "file_too_large");
  }
  if (!looksLikePdf(bytes)) {
    throw new PdfError(
      "That is not a PDF. Open the document, choose Save As or Print, pick PDF, " +
      "and upload that file instead.",
      "not_a_pdf");
  }

  /* THE READ AND THE PAGE WALK ARE IN ONE try, and that is not tidiness. A file
     with a valid %PDF- header and a broken body does not fail in load() — it
     fails later, inside getPages(), with a raw "Cannot read properties of
     undefined". Catching only around load() let that escape as a 500 with a
     developer's error message on it, on the one endpoint a staff member uses
     while a client waits. */
  let pages;
  try {
    // ignoreEncryption:false — a password-protected file must be refused rather
    // than half-read. A contract nobody can open is worse than one nobody sent.
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
    pages = doc.getPages();
  } catch (err) {
    if (/encrypt/i.test(String(err && err.message))) {
      throw new PdfError(
        "That PDF is password protected, so its pages cannot be read. " +
        "Save an unprotected copy and upload that.",
        "pdf_encrypted");
    }
    throw new PdfError(
      "That PDF could not be opened — it may be damaged. Try opening it, " +
      "saving a fresh copy, and uploading that.",
      "pdf_unreadable");
  }

  if (!pages || !pages.length) throw new PdfError("That PDF has no pages in it.", "pdf_no_pages");

  return {
    pageCount: pages.length,
    // Rounded to whole points: a stored size of 611.9999 is noise that shows up
    // in every diff and changes nothing about where a box lands.
    pageSizes: pages.map((p) => ({
      w: Math.round(p.getWidth()),
      h: Math.round(p.getHeight())
    }))
  };
}

/* Fit a string inside a box. Shrinks until it fits rather than overflowing,
   because an overflowing value on a contract prints over the sentence next to
   it and is unreadable in exactly the place it matters. Floors at 5pt: below
   that it is not legible anyway and truncating is the honest outcome. */
function fitSize(text, font, boxW, boxH) {
  let size = Math.min(boxH * 0.72, 14);
  while (size > 5 && font.widthOfTextAtSize(String(text), size) > boxW) size -= 0.5;
  return Math.max(size, 5);
}

/* One box, in PDF points, from a fraction-of-the-page field. THE FLIP LIVES
   HERE and nowhere else — every caller goes through this. */
export function boxToPoints(field, pageSize) {
  const w = Math.max(0, Number(field.w) || 0) * pageSize.w;
  const h = Math.max(0, Number(field.h) || 0) * pageSize.h;
  /* CLAMPED AT ZERO. A box flush with the bottom of the page has y + h = 1, and
     in floating point 0.9 + 0.1 is 1.0000000000000002 — so the honest arithmetic
     produces a y of about -2e-14. Visually nothing, but a negative coordinate is
     a value no renderer should be handed, and it is the kind of thing that works
     everywhere until the one viewer that rejects it. */
  return {
    x: Math.max(0, Number(field.x) || 0) * pageSize.w,
    y: Math.max(0, (1 - (Number(field.y) || 0) - (Number(field.h) || 0)) * pageSize.h),
    w,
    h
  };
}

/**
 * flatten — the finished document.
 *
 * @param {Buffer} bytes     the original uploaded PDF
 * @param {object} opts
 *   fields   [{ id, page, x, y, w, h, type, signer, label, value }]
 *   signers  [{ role_label, name, email, signer_name, signed_at, signer_ip, signer_user_agent }]
 *   contract { id, title, body_sha }
 *
 * Returns a Buffer. Never mutates the input.
 *
 * VALUES ARE DRAWN, NOT ADDED AS FORM FIELDS. A PDF form field is editable by
 * whoever opens the file next, which would make the signed copy alterable by
 * the person holding it — the exact property this whole feature exists to deny.
 * Drawn text is part of the page.
 */
export async function flatten(bytes, { fields = [], signers = [], contract = {} } = {}) {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  // The nearest thing to handwriting available without embedding a font file.
  // A typed-name signature is what was captured, so a script-ish face is a fair
  // rendering of it and not a claim that anybody drew anything.
  const script = await doc.embedFont(StandardFonts.TimesRomanItalic);

  const pages = doc.getPages();
  const ink = rgb(0.05, 0.05, 0.09);
  const signatureInk = rgb(0.05, 0.11, 0.42);   // blue, the way a pen is

  for (const f of fields) {
    const page = pages[Number(f.page) || 0];
    if (!page) continue;                        // a field on a page that is not there is dropped, not fatal
    const size = { w: page.getWidth(), h: page.getHeight() };
    const box = boxToPoints(f, size);
    const value = f.value == null ? "" : String(f.value);

    if (f.type === "checkbox") {
      const on = value === "true" || value === "yes" || value === "1" || value === "on";
      if (!on) continue;
      const s = Math.min(box.w, box.h) * 0.9;
      page.drawText("X", {
        x: box.x + (box.w - s * 0.6) / 2,
        y: box.y + (box.h - s * 0.72) / 2,
        size: s, font: bold, color: ink
      });
      continue;
    }

    if (!value.trim()) continue;

    if (f.type === "signature" || f.type === "initials") {
      const size2 = fitSize(value, script, box.w, box.h * 1.25);
      page.drawText(value, {
        x: box.x + 2, y: box.y + box.h * 0.28, size: size2, font: script, color: signatureInk
      });
      // The hairline under a signature. Cosmetic, and it is what makes the
      // finished page read as a signed document rather than as a filled form.
      page.drawLine({
        start: { x: box.x, y: box.y + box.h * 0.18 },
        end: { x: box.x + box.w, y: box.y + box.h * 0.18 },
        thickness: 0.5, color: rgb(0.6, 0.6, 0.65)
      });
      continue;
    }

    const size3 = fitSize(value, helv, box.w - 4, box.h);
    page.drawText(value, {
      x: box.x + 2, y: box.y + (box.h - size3 * 0.8) / 2, size: size3, font: helv, color: ink
    });
  }

  appendCertificate(doc, { helv, bold, signers, contract });

  return Buffer.from(await doc.save());
}

/**
 * The signature record page.
 *
 * THIS IS THE PAGE THAT MAKES THE DOCUMENT EVIDENCE. The pages above it show
 * what was agreed; this one shows who agreed, when, from where, and — through
 * the hash — proves the pages above are the ones they were shown. Every signing
 * service ships one and it is the first thing anybody asks for in a dispute.
 */
function appendCertificate(doc, { helv, bold, signers, contract }) {
  const page = doc.addPage([612, 792]);
  const left = 56;
  let y = 736;

  const line = (text, { font = helv, size = 10, gap = 15, color = rgb(0.1, 0.1, 0.12) } = {}) => {
    page.drawText(String(text), { x: left, y, size, font, color });
    y -= gap;
  };

  page.drawRectangle({ x: 0, y: 782, width: 612, height: 3, color: rgb(0.65, 0.78, 0.69) });
  line("SIGNATURE RECORD", { font: bold, size: 15, gap: 26 });
  line("This page is produced automatically. It is part of the signed document.",
    { size: 9, gap: 22, color: rgb(0.35, 0.35, 0.4) });

  line(`Document: ${contract.title || "Contract"}`, { font: bold, size: 11, gap: 17 });
  line(`Reference: ${contract.id || "—"}`, { size: 9, gap: 13, color: rgb(0.35, 0.35, 0.4) });
  if (contract.body_sha) {
    /* The fingerprint of the ORIGINAL file, as sent. Anybody can hash their copy
       and compare, which is what makes "this has not been altered" checkable by
       someone who does not trust us rather than only assertable by us. */
    line(`Fingerprint of the document as sent: ${String(contract.body_sha).replace(/^sha256:/, "").slice(0, 32)}…`,
      { size: 8, gap: 24, color: rgb(0.35, 0.35, 0.4) });
  } else {
    y -= 10;
  }

  line("SIGNED BY", { font: bold, size: 10, gap: 8 });
  page.drawLine({ start: { x: left, y: y + 2 }, end: { x: 556, y: y + 2 },
    thickness: 0.7, color: rgb(0.8, 0.8, 0.84) });
  y -= 14;

  for (const s of signers) {
    if (y < 90) break;                       // one page; a longer list is truncated rather than overflowing
    line(`${s.signer_name || s.name}  —  ${s.role_label || "Signer"}`, { font: bold, size: 11, gap: 14 });
    if (s.email) line(`Email: ${s.email}`, { size: 9, gap: 12, color: rgb(0.35, 0.35, 0.4) });
    line(`Signed: ${s.signed_at ? new Date(s.signed_at).toISOString().replace("T", " ").slice(0, 19) + " UTC" : "not signed"}`,
      { size: 9, gap: 12, color: rgb(0.35, 0.35, 0.4) });
    if (s.signer_ip) {
      line(`From internet address: ${s.signer_ip}`, { size: 9, gap: 12, color: rgb(0.35, 0.35, 0.4) });
    }
    if (s.signer_user_agent) {
      line(`Device: ${String(s.signer_user_agent).slice(0, 78)}`, { size: 8, gap: 12, color: rgb(0.45, 0.45, 0.5) });
    }
    y -= 8;
  }

  page.drawText("Typed name signature, captured with the date, time and internet address shown above.",
    { x: left, y: 56, size: 8, font: helv, color: rgb(0.45, 0.45, 0.5) });
  return page;
}

/**
 * placeholderPdf — a one-page PDF saying what the document is.
 *
 * Used for the TEXT contracts that predate uploads, so that "download a PDF
 * copy" works for every contract rather than only the uploaded ones. It is
 * deliberately plain: the words are the contract, and decorating them would
 * only introduce a way for the printed copy to disagree with the stored one.
 */
export async function textToPdf(text, { title = "Contract" } = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Courier);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const SIZE = 9.5, LEADING = 13.4, LEFT = 56, TOP = 736, BOTTOM = 64, WIDTH = 500;

  // Wrap on width, not on character count: a proportional guess leaves a ragged
  // right edge on some lines and overflows the page on others.
  const wrapped = [];
  for (const para of String(text).split("\n")) {
    if (!para.trim()) { wrapped.push(""); continue; }
    let line = "";
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, SIZE) > WIDTH && line) { wrapped.push(line); line = word; }
      else line = next;
    }
    wrapped.push(line);
  }

  let page = doc.addPage([612, 792]);
  page.drawRectangle({ x: 0, y: 782, width: 612, height: 3, color: rgb(0.65, 0.78, 0.69) });
  page.drawText(String(title).slice(0, 70), { x: LEFT, y: 754, size: 12, font: bold, color: rgb(0.05, 0.05, 0.09) });
  let y = TOP;

  for (const l of wrapped) {
    if (y < BOTTOM) {
      page = doc.addPage([612, 792]);
      y = TOP + 20;
    }
    if (l) page.drawText(l, { x: LEFT, y, size: SIZE, font, color: rgb(0.05, 0.05, 0.09) });
    y -= LEADING;
  }
  return Buffer.from(await doc.save());
}

// Re-exported so callers do not each import pdf-lib directly. One module owns
// the dependency; if it is ever swapped, this file is the only one that changes.
export { PDFDocument, StandardFonts, rgb, degrees };
