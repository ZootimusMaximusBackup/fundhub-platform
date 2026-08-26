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
