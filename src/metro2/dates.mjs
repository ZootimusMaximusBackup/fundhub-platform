// Calendar arithmetic for the violation engine.
//
// TWO CONSTRAINTS THIS EXISTS TO HOLD:
//
//   1. NO CLOCK. Nothing here reads `Date.now()`. "Is the 7-year window
//      expired?" is answered against `context.asOf` — the date of the credit
//      report being examined — never against today. A check that read the wall
//      clock would give a different answer on a rerun, and a violation the
//      engine cannot reproduce is a violation it cannot defend.
//
//   2. STRICT PARSING. A date is `YYYY-MM-DD` or it is not a date. No
//      Date-constructor guessing at "03/15/2019" or "March 2019". A
//      misparsed DOFD moves the 7-year clock by years.
//
// Pure. Same inputs, same outputs, forever.

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86400000;

/**
 * Strict YYYY-MM-DD → epoch day number, or null.
 * Rejects anything that does not round-trip (2019-02-30, 2019-13-01).
 */
export function toEpochDay(iso) {
  if (typeof iso !== "string") return null;
  const m = ISO.exec(iso.trim());
  if (!m) return null;
  const [, y, mo, d] = m;
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d));
  if (!Number.isFinite(ms)) return null;
  const back = new Date(ms).toISOString().slice(0, 10);
  if (back !== `${y}-${mo}-${d}`) return null;
  return Math.round(ms / MS_PER_DAY);
}

/** Is this a real YYYY-MM-DD calendar date? */
export function isIsoDate(iso) {
  return toEpochDay(iso) !== null;
}

/** epoch day → YYYY-MM-DD. */
export function fromEpochDay(day) {
  if (!Number.isFinite(day)) return null;
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b`. Negative when `b` is earlier. Null if either is unparseable. */
export function daysBetween(a, b) {
  const da = toEpochDay(a);
  const db = toEpochDay(b);
  if (da === null || db === null) return null;
  return db - da;
}

/**
 * -1 / 0 / 1, or null if either date is unparseable.
 * Null is not 0 — "cannot compare" must not read as "equal".
 */
export function compareIso(a, b) {
  const da = toEpochDay(a);
  const db = toEpochDay(b);
  if (da === null || db === null) return null;
  return da === db ? 0 : da < db ? -1 : 1;
}

/** Add days. */
export function addDays(iso, days) {
  const d = toEpochDay(iso);
  if (d === null || !Number.isFinite(days)) return null;
  return fromEpochDay(d + Math.trunc(days));
}

/**
 * Add whole months, clamping the day to the end of the target month so that
 * 2019-01-31 + 1 month is 2019-02-28 rather than rolling into March.
 */
export function addMonths(iso, months) {
  const m = ISO.exec(String(iso ?? "").trim());
  if (!m || toEpochDay(iso) === null || !Number.isFinite(months)) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const total = y * 12 + mo + Math.trunc(months);
  const ty = Math.floor(total / 12);
  const tm = total - ty * 12;
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return new Date(Date.UTC(ty, tm, Math.min(d, lastDay))).toISOString().slice(0, 10);
}

/** Add whole years, via addMonths so 2020-02-29 + 1 year clamps to 2021-02-28. */
export function addYears(iso, years) {
  return Number.isFinite(years) ? addMonths(iso, Math.trunc(years) * 12) : null;
}

/**
 * Whole elapsed months from `a` to `b` (a partial month does not count).
 * Used for the "reporting cycles" arithmetic in the personal-information
 * checks, where one cycle is one month.
 */
export function monthsBetween(a, b) {
  const ma = ISO.exec(String(a ?? "").trim());
  const mb = ISO.exec(String(b ?? "").trim());
  if (!ma || !mb || toEpochDay(a) === null || toEpochDay(b) === null) return null;
  let months = (Number(mb[1]) - Number(ma[1])) * 12 + (Number(mb[2]) - Number(ma[2]));
  if (Number(mb[3]) < Number(ma[3])) months -= 1;
  return months;
}

/** YYYY-MM for an ISO date, or null. */
export function monthKey(iso) {
  const m = ISO.exec(String(iso ?? "").trim());
  return m && toEpochDay(iso) !== null ? `${m[1]}-${m[2]}` : null;
}
