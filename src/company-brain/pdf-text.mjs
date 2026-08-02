// PDF text extraction via pdfjs-dist (already a dependency).
// OCR for image-only scans is not in step 1 — empty extract → needs_ocr flag.

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export async function extractPdfText(buf) {
  // pdfjs rejects Node Buffer; copy into a plain Uint8Array.
  const src = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const data = new Uint8Array(src.byteLength);
  data.set(src);
  const loadingTask = getDocument({ data, useSystemFonts: true, disableWorker: true });
  const pdf = await loadingTask.promise;
  const parts = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const line = (content.items || [])
      .map((it) => (it && typeof it.str === "string" ? it.str : ""))
      .join(" ");
    if (line.trim()) parts.push(line.trim());
  }
  const text = parts.join("\n").trim();
  return {
    ok: true,
    text,
    pageCount: pdf.numPages,
    needsOcr: text.length === 0 && pdf.numPages > 0
  };
}
