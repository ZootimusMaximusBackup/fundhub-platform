// Number and string helpers for the ported client deliverables.
//
// Straight ports of scripts/black-reports/fundhub_gen.py:203-259 (usd,
// money_range, median, spaced, parse_pct, parse_money).
//
// REUSE NOTE (CLAUDE.md §8). Node twins of usd / moneyRange / median already
// exist at src/underwrite/black-report-node.mjs:34-53 and are the same maths.
// They are module-private there — no `export` — and src/underwrite/ is owned by
// another lane this hour, so exporting them was not available. The handoff on
// this branch asks for those three to be exported and this file to import them
// instead of holding a second copy.
//
// NULL MEANS UNKNOWN. usd(null) is "-", parsePct(null) is null, median of no
// scores is "". Nothing here turns an unknown into a zero.

/** Python usd(): None -> "-", a string passes through, a number formats. */
export function usd(v) {
  if (v === null || v === undefined) return "-";
  if (typeof v === "string") return v;
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return `$${Math.trunc(n).toLocaleString("en-US")}`;
}

/** Python money_range(): whole thousands collapse to $5K, the rest read $3,500. */
export function moneyRange(lo, hi) {
  const k = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return usd(v);
    return n % 1000 === 0 ? `$${Math.trunc(n / 1000)}K` : `$${Math.trunc(n).toLocaleString("en-US")}`;
  };
  return `${k(lo)}-${k(hi)}`;
}

/**
 * Python median(): sorted(scores)[1] — the middle of the three bureau scores,
 * which is the number lenders read. Fewer than three scores is not an error and
 * not a zero; an empty file returns "".
 */
export function median(scores) {
  // Number(null) is 0 and Number("") is 0, so an absent score would sort in as a
  // real zero. Drop the unknowns before converting, never after.
  const vals = (Array.isArray(scores) ? scores : Object.values(scores || {}))
    .filter((n) => n !== null && n !== undefined && n !== "")
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  if (!vals.length) return "";
  return vals[Math.floor(vals.length / 2)];
}

/** Python spaced(): uppercase label. The letter-spacing lives in the CSS. */
export function spaced(s) {
  return String(s ?? "").toUpperCase();
}

/** Python parse_pct(): "93%" -> 93, "" / None / unparseable -> null. */
export function parsePct(util) {
  if (util === null || util === undefined || util === "") return null;
  if (typeof util === "number") return Number.isFinite(util) ? Math.trunc(util) : null;
  const n = Number(String(util).trim().replace("%", ""));
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** Python parse_money(): "$1,762" -> 1762, "$558 (high bal)" -> 558, else null. */
export function parseMoney(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? Math.trunc(v) : null;
  const token = String(v).replace(/\$/g, "").replace(/,/g, "").trim().split(/\s+/)[0];
  if (!token) return null;
  const n = Number(token);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}
