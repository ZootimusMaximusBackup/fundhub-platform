// Business-day clock math for the inquiry call scheduler.
// Hour-preserving: deliver Tue 16:00 + 1 business day → Wed 16:00.
// Skips weekends and a fixed US federal holiday set (owner can extend later).

/** Fixed-date + observed US federal holidays for a given year (UTC date keys). */
export function usFederalHolidays(year) {
  const y = Number(year);
  const set = new Set();
  const add = (m, d) => set.add(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);

  add(1, 1);   // New Year's
  add(6, 19);  // Juneteenth
  add(7, 4);   // Independence Day
  add(11, 11); // Veterans Day
  add(12, 25); // Christmas

  // MLK — 3rd Monday of January
  addNthWeekday(set, y, 1, 1, 3);
  // Presidents — 3rd Monday of February
  addNthWeekday(set, y, 2, 1, 3);
  // Memorial — last Monday of May
  addLastWeekday(set, y, 5, 1);
  // Labor — 1st Monday of September
  addNthWeekday(set, y, 9, 1, 1);
  // Columbus — 2nd Monday of October
  addNthWeekday(set, y, 10, 1, 2);
  // Thanksgiving — 4th Thursday of November
  addNthWeekday(set, y, 11, 4, 4);

  return set;
}

function addNthWeekday(set, year, month, weekday, n) {
  let count = 0;
  for (let d = 1; d <= 31; d++) {
    const dt = new Date(Date.UTC(year, month - 1, d));
    if (dt.getUTCMonth() !== month - 1) break;
    if (dt.getUTCDay() === weekday) {
      count += 1;
      if (count === n) {
        set.add(dt.toISOString().slice(0, 10));
        return;
      }
    }
  }
}

function addLastWeekday(set, year, month, weekday) {
  for (let d = 31; d >= 1; d--) {
    const dt = new Date(Date.UTC(year, month - 1, d));
    if (dt.getUTCMonth() !== month - 1) continue;
    if (dt.getUTCDay() === weekday) {
      set.add(dt.toISOString().slice(0, 10));
      return;
    }
  }
}

function dateKeyUTC(d) {
  return d.toISOString().slice(0, 10);
}

function isWeekend(d) {
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

function isHoliday(d, holidaySet) {
  return holidaySet.has(dateKeyUTC(d));
}

function isBusinessDay(d, holidaySet) {
  return !isWeekend(d) && !isHoliday(d, holidaySet);
}

/**
 * Advance `from` by `businessDays` full business days, keeping the time of day.
 * businessDays=0 returns the same instant (still snapped forward if it lands
 * on a weekend/holiday — caller usually passes >= 1).
 *
 * @param {Date|string|number} from
 * @param {number} businessDays
 * @param {{ holidays?: Set<string> }} [opts]
 * @returns {Date}
 */
export function addBusinessDays(from, businessDays, opts = {}) {
  const start = new Date(from);
  if (!Number.isFinite(start.getTime())) {
    throw new Error("invalid from date");
  }
  const n = Math.max(0, Math.floor(Number(businessDays) || 0));
  const years = new Set([start.getUTCFullYear(), start.getUTCFullYear() + 1]);
  const holidays = opts.holidays || new Set([...years].flatMap((y) => [...usFederalHolidays(y)]));

  // Preserve clock time in UTC (hour-preserving across calendar days).
  const hours = start.getUTCHours();
  const minutes = start.getUTCMinutes();
  const seconds = start.getUTCSeconds();
  const ms = start.getUTCMilliseconds();

  let cursor = new Date(Date.UTC(
    start.getUTCFullYear(),
    start.getUTCMonth(),
    start.getUTCDate(),
    hours, minutes, seconds, ms
  ));

  let remaining = n;
  // If n=0 and today is not a business day, still return same instant.
  while (remaining > 0) {
    cursor = new Date(cursor.getTime() + 86400000);
    // refresh holiday set if year rolls
    if (!holidays.has(`${cursor.getUTCFullYear()}-01-01`) && cursor.getUTCMonth() === 0) {
      for (const h of usFederalHolidays(cursor.getUTCFullYear())) holidays.add(h);
    }
    if (isBusinessDay(cursor, holidays)) remaining -= 1;
  }
  return cursor;
}

export { isBusinessDay, isWeekend };
