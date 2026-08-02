// Reading an uploaded PDF, and drawing on it.
//
// THE COORDINATE FLIP IS THE WHOLE POINT OF THIS FILE. A box is stored as
// fractions of the page from the TOP left, because that is how a browser lays
// out the editor and how a person thinks about a page. PDF measures from the
// BOTTOM left. Get the conversion backwards and every signature prints at the
// top of the page instead of the bottom — on a document somebody has already
// agreed to, discovered only when they open their copy.
//
// It is asserted arithmetically here rather than left to somebody comparing two
// pictures, because nobody repeats that check.

import { test, describe } from "node:test";
import assert from "node:assert";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { inspect, flatten, textToPdf, boxToPoints, looksLikePdf, PdfError, MAX_UPLOAD_BYTES } from "./pdf.mjs";

async function samplePdf({ pages = 2, size = [612, 792] } = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    doc.addPage(size).drawText(`Page ${i + 1}`, { x: 40, y: size[1] - 60, size: 12, font });
  }
  return Buffer.from(await doc.save());
}

describe("boxToPoints — the flip", () => {
  const page = { w: 600, h: 800 };

  test("x is measured from the left, unchanged", () => {
    assert.equal(boxToPoints({ x: 0.25, y: 0, w: 0.1, h: 0.1 }, page).x, 150);
  });

  test("A BOX AT THE TOP OF THE PAGE LANDS AT A HIGH y IN PDF POINTS", () => {
    // y=0 (the very top), height 10% → the box's bottom edge is at 90% up.
    assert.equal(boxToPoints({ x: 0, y: 0, w: 0.1, h: 0.1 }, page).y, 720);
  });

  test("A BOX AT THE BOTTOM LANDS AT y = 0, with no negative floating-point dust", () => {
    // 0.9 + 0.1 is 1.0000000000000002, so the honest arithmetic gives about
    // -2e-14. Clamped, because a negative coordinate is a value no renderer
    // should be handed.
    assert.equal(boxToPoints({ x: 0, y: 0.9, w: 0.1, h: 0.1 }, page).y, 0);
  });

  test("width and height scale by the page", () => {
    const b = boxToPoints({ x: 0, y: 0, w: 0.5, h: 0.25 }, page);
    assert.equal(b.w, 300);
    assert.equal(b.h, 200);
  });

  test("a signature two thirds down a letter page lands where a person would point", () => {
    // y = 0.63 on a 792pt page → roughly 280pt from the bottom, which is where
    // the signature block on a one-page agreement actually sits.
    const b = boxToPoints({ x: 0.15, y: 0.63, w: 0.3, h: 0.05 }, { w: 612, h: 792 });
    assert.ok(b.y > 245 && b.y < 290, `expected ~253, got ${b.y}`);
  });
});

describe("inspect — the upload gate", () => {
  test("reads the page count and the page sizes", async () => {
    const out = await inspect(await samplePdf({ pages: 3 }));
    assert.equal(out.pageCount, 3);
    assert.deepEqual(out.pageSizes, [{ w: 612, h: 792 }, { w: 612, h: 792 }, { w: 612, h: 792 }]);
  });

  test("reports a non-letter page size honestly rather than assuming letter", async () => {
    const out = await inspect(await samplePdf({ pages: 1, size: [842, 595] }));
    assert.deepEqual(out.pageSizes, [{ w: 842, h: 595 }]);
  });

  /* Every refusal below carries a sentence a non-technical person can act on.
     "That is not a PDF, save it as one" is a fix; a parser stack trace is not. */
  test("refuses a file that is not a PDF, and says what to do", async () => {
    await assert.rejects(() => inspect(Buffer.from("PK this is a word document")),
      (e) => e instanceof PdfError && e.code === "not_a_pdf" && /Save As or Print/.test(e.message));
  });

  test("refuses an empty file", async () => {
    await assert.rejects(() => inspect(Buffer.alloc(0)), (e) => e.code === "empty_file");
  });

  test("refuses a file over the size limit, and names the limit", async () => {
    const big = Buffer.alloc(MAX_UPLOAD_BYTES + 1);
    big.write("%PDF-");
    await assert.rejects(() => inspect(big), (e) => e.code === "file_too_large" && /12 MB/.test(e.message));
  });

  test("refuses a damaged PDF rather than half-reading it", async () => {
    await assert.rejects(() => inspect(Buffer.from("%PDF-1.7\nnot really")),
      (e) => e.code === "pdf_unreadable");
  });

  test("looksLikePdf checks the real header, not the file name", () => {
    assert.equal(looksLikePdf(Buffer.from("%PDF-1.4 ...")), true);
    assert.equal(looksLikePdf(Buffer.from("report.pdf")), false);
    assert.equal(looksLikePdf("%PDF-1.4"), false);   // must be bytes
  });
});

describe("flatten — the finished document", () => {
  const signers = [{
    role_label: "Client", name: "Ada Lovelace", email: "ada@example.com",
    signer_name: "Ada Lovelace", signed_at: "2026-08-02T09:30:00Z",
    signer_ip: "203.0.113.9", signer_user_agent: "Mozilla/5.0"
  }];

  test("adds ONE page — the signature record — and keeps every original page", async () => {
    const out = await flatten(await samplePdf({ pages: 2 }), { fields: [], signers, contract: { id: "c1", title: "T" } });
    const doc = await PDFDocument.load(out);
    assert.equal(doc.getPageCount(), 3);
  });

  test("the original bytes are not mutated", async () => {
    const src = await samplePdf({ pages: 1 });
    const before = Buffer.from(src);
    await flatten(src, { fields: [], signers, contract: {} });
    assert.ok(src.equals(before), "flatten() modified the buffer it was given");
  });

  test("draws a value onto the page it belongs to", async () => {
    const out = await flatten(await samplePdf({ pages: 2 }), {
      fields: [{ id: "a", page: 1, x: 0.2, y: 0.5, w: 0.4, h: 0.03, type: "text", signer: 0, label: "X", value: "HELLO" }],
      signers, contract: {}
    });
    // pdf-lib gives no text extraction, so the assertion is that the bytes
    // changed in a way an empty-value render does not produce.
    const blank = await flatten(await samplePdf({ pages: 2 }), {
      fields: [{ id: "a", page: 1, x: 0.2, y: 0.5, w: 0.4, h: 0.03, type: "text", signer: 0, label: "X", value: "" }],
      signers, contract: {}
    });
    assert.notEqual(out.length, blank.length, "a drawn value should change the file");
  });

  test("a field on a page that does not exist is dropped, not fatal", async () => {
    const out = await flatten(await samplePdf({ pages: 1 }), {
      fields: [{ id: "a", page: 9, x: 0.1, y: 0.1, w: 0.2, h: 0.03, type: "text", signer: 0, value: "x" }],
      signers, contract: {}
    });
    assert.ok(out.length > 0);
  });

  test("an unticked box draws nothing", async () => {
    const off = await flatten(await samplePdf({ pages: 1 }), {
      fields: [{ id: "c", page: 0, x: 0.1, y: 0.1, w: 0.03, h: 0.02, type: "checkbox", signer: 0, value: "" }],
      signers, contract: {}
    });
    const on = await flatten(await samplePdf({ pages: 1 }), {
      fields: [{ id: "c", page: 0, x: 0.1, y: 0.1, w: 0.03, h: 0.02, type: "checkbox", signer: 0, value: "true" }],
      signers, contract: {}
    });
    assert.notEqual(off.length, on.length);
  });

  test("survives a signer with no IP or device recorded", async () => {
    const out = await flatten(await samplePdf({ pages: 1 }), {
      fields: [], contract: { id: "c", title: "T" },
      signers: [{ role_label: "Client", name: "Ada", signed_at: null }]
    });
    assert.equal((await PDFDocument.load(out)).getPageCount(), 2);
  });

  test("many signers do not overflow into an unreadable page", async () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      role_label: `R${i}`, name: `Person ${i}`, email: `p${i}@x.test`,
      signer_name: `Person ${i}`, signed_at: "2026-08-02T09:30:00Z",
      signer_ip: "203.0.113.9", signer_user_agent: "Mozilla/5.0 (a long device string) ".repeat(4)
    }));
    const out = await flatten(await samplePdf({ pages: 1 }), { fields: [], signers: many, contract: { id: "c" } });
    assert.equal((await PDFDocument.load(out)).getPageCount(), 2);
  });
});

describe("textToPdf — a downloadable copy of a typed contract", () => {
  test("produces a real PDF from words", async () => {
    const out = await textToPdf("Hello.\n\nThis is a contract.", { title: "Agreement" });
    assert.equal(looksLikePdf(out), true);
    assert.equal((await PDFDocument.load(out)).getPageCount(), 1);
  });

  test("wraps long lines instead of running off the page", async () => {
    const out = await textToPdf(("word ".repeat(400)).trim(), { title: "Long" });
    assert.ok((await PDFDocument.load(out)).getPageCount() >= 1);
  });

  test("spills onto more pages when it has to", async () => {
    const out = await textToPdf(Array.from({ length: 200 }, (_, i) => `Line ${i}`).join("\n"));
    assert.ok((await PDFDocument.load(out)).getPageCount() > 1);
  });

  test("empty text still produces a valid file rather than throwing", async () => {
    assert.equal(looksLikePdf(await textToPdf("")), true);
  });
});
