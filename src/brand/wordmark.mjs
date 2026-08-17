// Typographic wordmark from the partner's name and display face.
// No image vendor. Returns a data: URL the brand already accepts.

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

export function renderWordmarkSvg({
  name = "Brand",
  displayFace = "Inter",
  ink = "#0A0A0A",
  paper = "#FCFCFC"
} = {}) {
  const label = String(name || "Brand").trim().slice(0, 48) || "Brand";
  const face = String(displayFace || "Inter").replace(/[<>"]/g, "");
  const fill = /^#[0-9a-fA-F]{6}$/.test(ink) ? ink : "#0A0A0A";
  const bg = /^#[0-9a-fA-F]{6}$/.test(paper) ? paper : "#FCFCFC";
  const width = Math.min(640, Math.max(180, 18 * label.length + 48));
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="64" viewBox="0 0 ${width} 64" role="img" aria-label="${esc(label)}">
  <rect width="100%" height="100%" fill="${bg}"/>
  <text x="24" y="42" fill="${fill}" font-family="${esc(face)}, system-ui, sans-serif" font-size="28" font-weight="700">${esc(label)}</text>
</svg>`;
}

export function wordmarkDataUrl(opts = {}) {
  const svg = renderWordmarkSvg(opts);
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export default { renderWordmarkSvg, wordmarkDataUrl };
