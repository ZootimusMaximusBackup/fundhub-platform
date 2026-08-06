"use strict";

/**
 * POST /api/setter-book
 *
 * Bland AI Custom Tool endpoint — called mid-call by the setter agent
 * to book an appointment in GHL after the lead picks a time.
 *
 * Bland sends: { contact_id, selected_time, lead_name }
 * Returns: { confirmation: "Appointment confirmed for Thursday at 2:00 PM" }
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
  const contactId = req.body?.contact_id;
  const selectedTime = req.body?.selected_time;
  const leadName = req.body?.lead_name || "Lead";

  if (!calendarId) {
    return res.status(200).json({
      confirmation: "The booking system is not set up yet. Confirm the appointment time verbally with the lead and let them know they'll receive a confirmation shortly."
    });
  }

  if (!contactId) {
    return res.status(200).json({
      confirmation: "I couldn't identify the contact. Confirm the time verbally and our team will send a confirmation."
    });
  }

  if (!selectedTime) {
    return res.status(200).json({
      confirmation: "No time was selected. Ask the lead to pick a specific day and time."
    });
  }

  if (!ghl.isConfigured()) {
    return res.status(200).json({
      confirmation: "The booking system is temporarily unavailable. Confirm the time verbally with the lead."
    });
  }

  try {
    const startTime = parseSelectedTime(selectedTime);
    if (!startTime) {
      return res.status(200).json({
        confirmation: "I couldn't parse that time. Confirm \"" + String(selectedTime).substring(0, 50) + "\" verbally with the lead and our team will book it manually."
      });
    }

    const endTime = new Date(startTime.getTime() + 30 * 60000).toISOString();

    const appointment = await ghl.createAppointment({
      calendarId,
      contactId,
      startTime: startTime.toISOString(),
      endTime,
      title: "FundHub Credit Consultation — " + leadName
    });

    const confirmedTime = startTime.toLocaleString("en-US", {
      weekday: "long",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "America/New_York"
    });

    console.log("[setter-book] Appointment booked: " + (appointment.id || "ok") + " for " + contactId + " at " + confirmedTime);

    return res.status(200).json({
      confirmation: "Appointment confirmed for " + confirmedTime,
      appointment_id: appointment.id || null
    });
  } catch (err) {
    console.error("[setter-book] Error:", err.message);
    return res.status(200).json({
      confirmation: "There was an issue booking the appointment. Confirm the time verbally with the lead and let them know our team will send a confirmation."
    });
  }
};

/**
 * Attempt to parse a time string from Bland AI into a Date.
 * Handles ISO strings and common natural language patterns.
 */
function parseSelectedTime(input) {
  if (!input) return null;

  // Try ISO parse first
  const iso = new Date(input);
  if (!isNaN(iso.getTime()) && String(input).includes("-")) return iso;

  // Try relative day + time: "Tuesday at 2pm", "tomorrow at 10am"
  const now = new Date();
  const lower = String(input).toLowerCase().trim();

  const dayTimeMatch = lower.match(
    /(?:next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i
  );

  if (dayTimeMatch) {
    const dayStr = dayTimeMatch[1];
    const hourStr = dayTimeMatch[2];
    const minStr = dayTimeMatch[3];
    const ampm = dayTimeMatch[4];
    let hour = parseInt(hourStr, 10);
    const min = parseInt(minStr || "0", 10);
    if (ampm.toLowerCase() === "pm" && hour < 12) hour += 12;
    if (ampm.toLowerCase() === "am" && hour === 12) hour = 0;

    const target = new Date(now);

    if (dayStr === "today") {
      // keep current date
    } else if (dayStr === "tomorrow") {
      target.setDate(target.getDate() + 1);
    } else {
      const dayMap = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
      const targetDay = dayMap[dayStr];
      if (targetDay !== undefined) {
        const currentDay = target.getDay();
        let diff = targetDay - currentDay;
        if (diff <= 0) diff += 7;
        target.setDate(target.getDate() + diff);
      }
    }

    target.setHours(hour, min, 0, 0);
    return target;
  }

  return null;
}
