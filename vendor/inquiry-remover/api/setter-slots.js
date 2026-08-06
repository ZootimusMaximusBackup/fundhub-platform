"use strict";

/**
 * POST /api/setter-slots
 *
 * Bland AI Custom Tool endpoint — called mid-call by the setter agent
 * to check GHL calendar availability.
 *
 * Bland sends: { preference: "morning" | "afternoon" | "any" }
 * Returns: { available_slots: "Tuesday 10am, Tuesday 2pm, Wednesday 11am" }
 *
 * Auth: Uses API_SECRET Bearer token (configured in Bland tool headers).
 */

const ghl = require("../src/lib/ghl-client");
const { requireAuth } = require("../src/lib/auth");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!requireAuth(req, res)) return;

  const calendarId = req.body?.calendar_id || process.env.GHL_CALENDAR_ID;

  if (!calendarId) {
    return res.status(200).json({
      available_slots: "I don't have the scheduling system available right now. Ask the lead what day and time works best for them and confirm it verbally."
    });
  }

  if (!ghl.isConfigured()) {
    return res.status(200).json({
      available_slots: "The scheduling system is temporarily unavailable. Ask the lead for their preferred day and time."
    });
  }

  try {
    const preference = (req.body?.preference || "any").toLowerCase();
    const now = new Date();
    const startDate = now.toISOString().split("T")[0];

    // Look 7 days ahead
    const endDate = new Date(now.getTime() + 7 * 86400000).toISOString().split("T")[0];

    const slotsData = await ghl.getFreeSlots(calendarId, startDate, endDate);
    const slots = slotsData.slots || slotsData;

    // Format slots into natural language
    const formatted = formatSlots(slots, preference);

    if (!formatted) {
      return res.status(200).json({
        available_slots: "We're pretty booked this week. Ask the lead what day and time works best and we'll make it work."
      });
    }

    return res.status(200).json({ available_slots: formatted });
  } catch (err) {
    console.error("[setter-slots] Error:", err.message);
    return res.status(200).json({
      available_slots: "I'm having trouble checking the calendar right now. Ask the lead for their preferred day and time."
    });
  }
};

/**
 * Format raw GHL slots into natural language for the agent.
 * Returns up to 3 slot options as a readable string.
 */
function formatSlots(slots, preference) {
  if (!slots || typeof slots !== "object") return null;

  const allSlots = [];
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  for (const [, times] of Object.entries(slots)) {
    if (!Array.isArray(times)) continue;
    for (const time of times) {
      const dt = new Date(time);
      if (isNaN(dt.getTime())) continue;
      const hour = dt.getHours();
      const isMorning = hour < 12;

      if (preference === "morning" && !isMorning) continue;
      if (preference === "afternoon" && isMorning) continue;

      const dayName = dayNames[dt.getDay()];
      const timeStr = dt.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        timeZone: "America/New_York"
      });

      allSlots.push(`${dayName} at ${timeStr}`);
    }
  }

  if (allSlots.length === 0) return null;
  return allSlots.slice(0, 3).join(", ");
}
