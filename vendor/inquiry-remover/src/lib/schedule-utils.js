"use strict";

/**
 * schedule-utils.js — Business hour scheduling utilities
 *
 * Bureau phone lines operate M-F ~8am-8pm ET.
 * We schedule AI calls within a safe window: M-F 9am-5pm ET.
 * Uses Intl for correct DST handling.
 */

const BUSINESS_HOUR_START = 9; // 9 AM ET
const BUSINESS_HOUR_END = 17; // 5 PM ET
const TIMEZONE = "America/New_York";

/**
 * Get a Date-like object representing the current time in Eastern.
 * Returns { hour, day, minutes } in ET.
 */
function getETComponents(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    hour12: false
  }).formatToParts(date);

  const hour = parseInt(parts.find((p) => p.type === "hour").value, 10);
  const minute = parseInt(parts.find((p) => p.type === "minute").value, 10);
  const weekday = parts.find((p) => p.type === "weekday").value;

  const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const day = dayMap[weekday];

  return { hour, minute, day };
}

/**
 * Check if a given date falls within business hours (M-F 9am-5pm ET).
 */
function isBusinessHours(date = new Date()) {
  const { hour, day } = getETComponents(date);
  if (day === 0 || day === 6) return false;
  return hour >= BUSINESS_HOUR_START && hour < BUSINESS_HOUR_END;
}

/**
 * Compute the next valid business-hour slot.
 * Returns a Date object for the next 9am ET opening if currently outside hours.
 * If currently inside hours, returns the input date.
 */
function nextBusinessHourSlot(date = new Date()) {
  if (isBusinessHours(date)) return new Date(date);

  const result = new Date(date);
  const { hour, day } = getETComponents(result);

  // If it's a weekday but before business hours, jump to 9am today
  if (day >= 1 && day <= 5 && hour < BUSINESS_HOUR_START) {
    return setToETHour(result, BUSINESS_HOUR_START);
  }

  // Otherwise advance to next day
  result.setDate(result.getDate() + 1);
  result.setUTCHours(14, 0, 0, 0); // rough 9am ET = 14:00 UTC (EST) or 13:00 UTC (EDT)

  // Skip weekends
  let attempts = 0;
  while (attempts < 7) {
    const { day: d } = getETComponents(result);
    if (d >= 1 && d <= 5) break;
    result.setDate(result.getDate() + 1);
    attempts++;
  }

  return setToETHour(result, BUSINESS_HOUR_START);
}

/**
 * Set a date to a specific hour in ET (handles DST via binary search).
 */
function setToETHour(date, targetHour) {
  const result = new Date(date);
  // Start with a rough estimate: 9am ET is ~13-14 UTC
  result.setUTCHours(targetHour + 5, 0, 0, 0);

  // Adjust if DST shifted us
  const { hour } = getETComponents(result);
  const diff = targetHour - hour;
  if (diff !== 0) {
    result.setUTCHours(result.getUTCHours() + diff);
  }

  return result;
}

module.exports = {
  isBusinessHours,
  nextBusinessHourSlot,
  getETComponents,
  BUSINESS_HOUR_START,
  BUSINESS_HOUR_END,
  TIMEZONE
};
