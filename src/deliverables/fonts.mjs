// @font-face for the ported deliverables.
//
// THE BUG THIS CLOSES. The Python stylesheet names "Inter" and "JetBrains Mono"
// and declares no @font-face at all (fundhub_gen.py:334, :341 and thirty more).
// It only ever ran on a Mac with both families installed. Anywhere else — a
// Netlify function, a client's Windows laptop, a phone — every rule silently
// fell back to Arial and the whole design changed.
//
// The nine .ttf files were already git-tracked at
// docs/workflows/gold-deliverables-v5/fonts/ and referenced by nothing. They are
// copied to assets/fonts/ and pointed at here.
//
// HOW THEY REACH THE PAGE. netlify.toml publishes `public/`, and assets/ is not
// under it, so a plain /assets/fonts/... URL would 404 in production. The
// default is therefore to embed each face as a data: URI read off disk at render
// time, which needs only netlify.toml's `included_files` to carry the directory
// into the function bundle — the exact edit is in this branch's handoff. Pass
// `href` instead when the fonts are being served from somewhere real; then the
// browser fetches them and the page stays small.
//
// Only the four faces the stylesheet can actually select are embedded: nothing
// in the CSS asks for weight 500, 600, 800 or 900. All nine are registered in
// href mode, where an unused face costs no bytes.
//
// DEGRADES, NEVER THROWS. A face whose file is missing is left out, and the
// "Inter", "Arial", sans-serif stack in css.mjs takes over for it.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const FONT_DIR = join(HERE, "../../assets/fonts");

/** [family, weight, file]. Weight is the real weight of the face. */
export const FACES = Object.freeze([
  ["Inter", 400, "Inter-Regular.ttf"],
  ["Inter", 500, "Inter-Medium.ttf"],
  ["Inter", 600, "Inter-SemiBold.ttf"],
  ["Inter", 700, "Inter-Bold.ttf"],
  ["Inter", 800, "Inter-ExtraBold.ttf"],
  ["Inter", 900, "Inter-Black.ttf"],
  ["JetBrains Mono", 400, "JetBrainsMono-Regular.ttf"],
  ["JetBrains Mono", 500, "JetBrainsMono-Medium.ttf"],
  ["JetBrains Mono", 700, "JetBrainsMono-Bold.ttf"]
]);

/** The weights css.mjs can select: body copy and `font-weight: bold`. */
const INLINE_WEIGHTS = Object.freeze([400, 700]);

const dataUriCache = new Map();

function dataUri(dir, file) {
  const cacheKey = `${dir}\u0000${file}`;
  if (dataUriCache.has(cacheKey)) return dataUriCache.get(cacheKey);
  let uri = null;
  try {
    uri = `data:font/ttf;base64,${readFileSync(join(dir, file)).toString("base64")}`;
  } catch {
    uri = null; // missing face: fall through to the CSS fallback stack
  }
  dataUriCache.set(cacheKey, uri);
  return uri;
}

function face(family, weight, src) {
  return `@font-face { font-family: "${family}"; font-style: normal; font-weight: ${weight};`
    + ` font-display: swap; src: url(${src}) format("truetype"); }`;
}

/**
 * @param {{ href?: string, dir?: string }} [opts] href = base URL the .ttf files
 *   are served from, e.g. "/assets/fonts". Omit it to embed the faces in the
 *   page. dir = where to read them from; a test seam, defaults to assets/fonts.
 * @returns {string} CSS. Empty when nothing could be embedded.
 */
export function fontFaceCss({ href = "", dir = FONT_DIR } = {}) {
  const base = String(href || "").replace(/\/+$/, "");
  if (base) {
    return FACES.map(([family, weight, file]) => face(family, weight, `"${base}/${file}"`)).join("\n");
  }
  const out = [];
  for (const [family, weight, file] of FACES) {
    if (!INLINE_WEIGHTS.includes(weight)) continue;
    const uri = dataUri(dir, file);
    if (!uri) continue;
    out.push(face(family, weight, uri));
  }
  return out.join("\n");
}

/** Test seam: drop the embedded-font cache. */
export function resetFontCache() {
  dataUriCache.clear();
}
