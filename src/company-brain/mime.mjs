// MIME classification for Company Brain extraction.

export const GOOGLE_DOC = "application/vnd.google-apps.document";
export const GOOGLE_SHEET = "application/vnd.google-apps.spreadsheet";
export const GOOGLE_SLIDE = "application/vnd.google-apps.presentation";
export const GOOGLE_FOLDER = "application/vnd.google-apps.folder";

const IMAGE_PREFIX = "image/";
const AUDIO_PREFIX = "audio/";
const VIDEO_PREFIX = "video/";

const OFFICE = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint"
]);

/** How to pull content for a Drive mime type. */
export function classifyMime(mimeType) {
  const mime = String(mimeType || "").trim().toLowerCase();
  if (!mime) return { kind: "unknown", action: "skip" };
  if (mime === GOOGLE_FOLDER) return { kind: "folder", action: "skip" };
  if (mime.startsWith(IMAGE_PREFIX)) return { kind: "image", action: "skip" }; // v1 skips images
  if (mime === GOOGLE_DOC) {
    return { kind: "google_doc", action: "export", exportMime: "text/plain" };
  }
  if (mime === GOOGLE_SHEET) {
    return { kind: "google_sheet", action: "export", exportMime: "text/csv" };
  }
  if (mime === GOOGLE_SLIDE) {
    return { kind: "google_slide", action: "export", exportMime: "text/plain" };
  }
  if (mime === "application/pdf") return { kind: "pdf", action: "download" };
  if (OFFICE.has(mime)) return { kind: "office", action: "download" };
  if (mime.startsWith(AUDIO_PREFIX) || mime.startsWith(VIDEO_PREFIX)) {
    // Whisper later. Index metadata only — do not download Meet recordings.
    return { kind: "av", action: "download" };
  }
  if (mime.startsWith("text/") || mime === "application/json") {
    return { kind: "text", action: "download" };
  }
  return { kind: "other", action: "skip" };
}

/** Pull bytes for text-ish files. Skip A/V — Meet recordings stay in Drive. */
export function needsMediaDownload(classified) {
  return classified?.action === "download" && classified.kind !== "av";
}
