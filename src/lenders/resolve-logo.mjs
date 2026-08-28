/* Map a lender name to an existing public/assets/lenders mark. Never invent a bank. */

import { normalizeName, slugFromName } from "./tips.mjs";

/** Same institution, different scrape wording → an existing file. */
function aliasPath(rawName) {
  const raw = String(rawName || "");
  const n = normalizeName(raw).toLowerCase();
  if (/amtrust/.test(n)) return "/assets/lenders/amtrust-fnbo.png";
  if (n.startsWith("elan financial")) return "/assets/lenders/elan-financial.png";
  if (n === "ibc bank" || n === "ibc") return "/assets/lenders/ibc.png";
  if (/first national bank of omaha/.test(n) || /\bfnbo\b/i.test(raw)) {
    return "/assets/lenders/fnbo.png";
  }
  if (/centerstate/i.test(raw) && /southstate/i.test(raw)) return "/assets/lenders/southstate-bank.png";
  if (/^the people.?s bank$/i.test(n)) return "/assets/lenders/the-peoples-bank.png";
  return null;
}

/**
 * @param {{ name?: string, externalRowId?: string|null, sidecar?: Record<string, string>, exists: (relPath: string) => boolean }} opts
 * @returns {string|null} site-root path like /assets/lenders/chase.png
 */
export function resolveLogoPath({ name, externalRowId, sidecar, exists }) {
  const fromSidecar = externalRowId && sidecar ? sidecar[externalRowId] : null;
  if (fromSidecar && exists(fromSidecar)) return fromSidecar;

  const alias = aliasPath(name);
  if (alias && exists(alias)) return alias;

  const slug = slugFromName(normalizeName(name));
  const candidates = [slug, `${slug}-0`];
  if (slug.endsWith("-0")) candidates.push(slug.slice(0, -2));
  for (const s of candidates) {
    const rel = `/assets/lenders/${s}.png`;
    if (exists(rel)) return rel;
  }
  return null;
}

/* ── The placeholder half of this module ─────────────────────────────────────
   Two threads created a file at this path on the same day, for two different
   jobs: this one resolves a bank name to a mark that exists, and the other
   handed a missing mark the neutral tile. The merge kept one file and dropped
   the other, so src/lenders/store.mjs imported a function that was no longer
   here and esbuild refused to bundle the api function — every deploy from
   main failed at "building site" with exit code 2 from 02:24 on 2026-08-28.
   Both halves live here now. Restored from be14a249 unchanged. */

export const LENDER_LOGO_PLACEHOLDER = "/assets/lenders/placeholder.svg";

/**
 * @param {string|null|undefined} logoPath
 * @returns {string}
 */
export function logoPathOrPlaceholder(logoPath) {
  const s = logoPath == null ? "" : String(logoPath).trim();
  return s || LENDER_LOGO_PLACEHOLDER;
}
