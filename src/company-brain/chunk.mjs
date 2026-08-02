// Text chunking for Company Brain embeddings.

export const DEFAULT_CHUNK_CHARS = 1800;
export const DEFAULT_CHUNK_OVERLAP = 200;

/**
 * Split plain text into overlapping chunks.
 * Skips empty input. Overlap is clamped so it never exceeds size-1.
 */
export function chunkText(text, {
  size = DEFAULT_CHUNK_CHARS,
  overlap = DEFAULT_CHUNK_OVERLAP
} = {}) {
  const raw = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!raw) return [];
  const chunkSize = Math.max(200, Number(size) || DEFAULT_CHUNK_CHARS);
  const ov = Math.max(0, Math.min(Number(overlap) || 0, chunkSize - 1));
  const out = [];
  let start = 0;
  while (start < raw.length) {
    let end = Math.min(raw.length, start + chunkSize);
    if (end < raw.length) {
      const window = raw.slice(start, end);
      const para = window.lastIndexOf("\n\n");
      const space = window.lastIndexOf(" ");
      const breakAt = para >= chunkSize * 0.5 ? para : (space >= chunkSize * 0.5 ? space : -1);
      if (breakAt > 0) end = start + breakAt;
    }
    const piece = raw.slice(start, end).trim();
    if (piece) out.push(piece);
    if (end >= raw.length) break;
    start = Math.max(0, end - ov);
    if (start >= end) start = end;
  }
  return out;
}
