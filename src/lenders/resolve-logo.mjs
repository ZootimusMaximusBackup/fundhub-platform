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

/* Shared lender mark path. Never invent a bank — missing marks use the tile. */
export const LENDER_LOGO_PLACEHOLDER = "/assets/lenders/placeholder.svg";

/**
 * @param {string|null|undefined} logoPath
 * @returns {string}
 */
export function logoPathOrPlaceholder(logoPath) {
  const s = logoPath == null ? "" : String(logoPath).trim();
  return s || LENDER_LOGO_PLACEHOLDER;
}
