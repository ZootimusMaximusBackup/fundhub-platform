// Minimal OOXML text extraction — no mammoth/exceljs.
// Unzips the package and strips tags from the main XML parts.

import zlib from "node:zlib";

/**
 * Parse a ZIP (stored or deflated) into a Map<path, Buffer>.
 * Enough for DOCX/XLSX/PPTX. Throws on unsupported compression.
 */
export function unzipEntries(buf) {
  const bytes = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const out = new Map();
  let offset = 0;

  while (offset + 4 <= bytes.length) {
    const sig = bytes.readUInt32LE(offset);
    if (sig !== 0x04034b50) break; // local file header
    const compression = bytes.readUInt16LE(offset + 8);
    const compSize = bytes.readUInt32LE(offset + 18);
    const nameLen = bytes.readUInt16LE(offset + 26);
    const extraLen = bytes.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = bytes.slice(nameStart, nameStart + nameLen).toString("utf8");
    const dataStart = nameStart + nameLen + extraLen;
    const compressed = bytes.slice(dataStart, dataStart + compSize);
    let data;
    if (compression === 0) {
      data = compressed;
    } else if (compression === 8) {
      data = zlib.inflateRawSync(compressed);
    } else {
      throw new Error(`unsupported zip compression ${compression} for ${name}`);
    }
    out.set(name, data);
    offset = dataStart + compSize;
  }
  return out;
}

function xmlToText(xmlBuf) {
  const xml = Buffer.isBuffer(xmlBuf) ? xmlBuf.toString("utf8") : String(xmlBuf || "");
  return xml
    .replace(/<w:tab\b[^/]*\/>/g, "\t")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<\/a:p>/g, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function extractDocxText(buf) {
  const entries = unzipEntries(buf);
  const doc = entries.get("word/document.xml");
  if (!doc) throw new Error("docx missing word/document.xml");
  return xmlToText(doc);
}

export function extractXlsxText(buf) {
  const entries = unzipEntries(buf);
  const parts = [];
  for (const [path, data] of entries) {
    if (/^xl\/(sharedStrings|worksheets\/sheet)\d*\.xml$/i.test(path)
      || path === "xl/sharedStrings.xml"
      || /^xl\/worksheets\/sheet\d+\.xml$/i.test(path)) {
      parts.push(xmlToText(data));
    }
  }
  if (parts.length === 0) throw new Error("xlsx missing sheet/sharedStrings xml");
  return parts.filter(Boolean).join("\n");
}

export function extractPptxText(buf) {
  const entries = unzipEntries(buf);
  const slides = [...entries.keys()]
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/i.test(p))
    .sort();
  if (slides.length === 0) throw new Error("pptx missing slides");
  return slides.map((p) => xmlToText(entries.get(p))).filter(Boolean).join("\n\n");
}

export function extractOfficeText(buf, mimeType) {
  const mime = String(mimeType || "").toLowerCase();
  if (mime.includes("wordprocessingml") || mime === "application/msword") {
    if (mime === "application/msword") {
      return { ok: false, reason: "legacy_doc_unsupported", text: "" };
    }
    return { ok: true, text: extractDocxText(buf), reason: null };
  }
  if (mime.includes("spreadsheetml") || mime === "application/vnd.ms-excel") {
    if (mime === "application/vnd.ms-excel") {
      return { ok: false, reason: "legacy_xls_unsupported", text: "" };
    }
    return { ok: true, text: extractXlsxText(buf), reason: null };
  }
  if (mime.includes("presentationml") || mime === "application/vnd.ms-powerpoint") {
    if (mime === "application/vnd.ms-powerpoint") {
      return { ok: false, reason: "legacy_ppt_unsupported", text: "" };
    }
    return { ok: true, text: extractPptxText(buf), reason: null };
  }
  return { ok: false, reason: "unknown_office_mime", text: "" };
}
