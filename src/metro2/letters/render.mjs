// Plain consumer business-letter PDF via pdf-lib. No brand, no logo, no footer.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

function wrap(text, font, size, maxWidth) {
  const words = String(text || "").split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    const trial = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(trial, size) <= maxWidth) line = trial;
    else {
      if (line) lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * @param {{ text: string, identity?: object }} opts
 * @returns {Promise<Uint8Array>}
 */
export async function renderLetterPdf({ text, identity } = {}) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.TimesRoman);
  const fontBold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  let page = pdf.addPage([612, 792]);
  const margin = 72;
  const maxW = 612 - margin * 2;
  let y = 792 - margin;
  const size = 11;
  const leading = 14;

  const paragraphs = String(text || "").split(/\n/);
  for (const raw of paragraphs) {
    if (raw === "") {
      y -= leading * 0.6;
      continue;
    }
    const isHeader = /^(Re:|CITATIONS:|CLOSING:|Sincerely,)/i.test(raw);
    const f = isHeader ? fontBold : font;
    const lines = wrap(raw, f, size, maxW);
    for (const line of lines) {
      if (y < margin + leading) {
        page = pdf.addPage([612, 792]);
        y = 792 - margin;
      }
      page.drawText(line, { x: margin, y, size, font: f, color: rgb(0, 0, 0) });
      y -= leading;
    }
  }

  // Identity block already in text; identity arg reserved for future signature image jitter.
  void identity;
  return pdf.save();
}

export async function renderLetterPdfBase64(opts) {
  const bytes = await renderLetterPdf(opts);
  return Buffer.from(bytes).toString("base64");
}
