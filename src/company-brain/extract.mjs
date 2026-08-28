// Extract searchable text from a Drive file (metadata + optional bytes/export).
// A/V stays metadata-only here. Words land in meet-transcript.mjs
// (Drive sibling Transcript doc, or Whisper on a short file).

import { classifyMime } from "./mime.mjs";
import { extractOfficeText } from "./office.mjs";
import { extractPdfText } from "./pdf-text.mjs";
import { sniffClientId } from "./client-id.mjs";

/**
 * @param {object} file — Drive file metadata
 * @param {object} opts
 * @param {() => Promise<Buffer>} [opts.download] — media downloader
 * @param {(mime: string) => Promise<Buffer>} [opts.exportTo] — Google export
 * @param {string[]} [opts.parentNames]
 */
export async function extractFromDriveFile(file, {
  download,
  exportTo,
  parentNames = []
} = {}) {
  const mimeType = file?.mimeType || "";
  const name = file?.name || "";
  const classified = classifyMime(mimeType);
  const base = {
    fileId: file?.id || null,
    name,
    mimeType,
    kind: classified.kind,
    webViewLink: file?.webViewLink || null,
    text: "",
    ok: false,
    reason: null,
    needsOcr: false,
    needsTranscription: false,
    clientId: null,
    unattached: false
  };

  if (classified.action === "skip") {
    return { ...base, reason: `skipped:${classified.kind}` };
  }

  if (classified.kind === "av") {
    const sniff = sniffClientId({ name, parentNames });
    // Prove we can read bytes when a downloader is provided; do not call Whisper yet.
    let byteLength = null;
    if (typeof download === "function") {
      const buf = await download();
      byteLength = buf?.length ?? 0;
    }
    return {
      ...base,
      ok: true,
      reason: "needs_transcription",
      needsTranscription: true,
      byteLength,
      clientId: sniff.clientId,
      unattached: sniff.unattached
    };
  }

  try {
    if (classified.action === "export") {
      if (typeof exportTo !== "function") {
        return { ...base, reason: "export_fn_missing" };
      }
      const buf = await exportTo(classified.exportMime);
      const text = buf.toString("utf8").trim();
      return { ...base, ok: true, text, reason: text ? null : "empty_export" };
    }

    if (classified.action === "download") {
      if (typeof download !== "function") {
        return { ...base, reason: "download_fn_missing" };
      }
      const buf = await download();

      if (classified.kind === "pdf") {
        const pdf = await extractPdfText(buf);
        return {
          ...base,
          ok: true,
          text: pdf.text,
          needsOcr: pdf.needsOcr,
          reason: pdf.needsOcr ? "needs_ocr" : (pdf.text ? null : "empty_pdf")
        };
      }

      if (classified.kind === "office") {
        const office = extractOfficeText(buf, mimeType);
        return {
          ...base,
          ok: office.ok,
          text: office.text,
          reason: office.reason
        };
      }

      if (classified.kind === "text") {
        const text = buf.toString("utf8").trim();
        return { ...base, ok: true, text, reason: text ? null : "empty_text" };
      }
    }

    return { ...base, reason: `unhandled:${classified.kind}` };
  } catch (err) {
    return {
      ...base,
      ok: false,
      reason: `extract_error:${err && err.message ? err.message : String(err)}`
    };
  }
}
