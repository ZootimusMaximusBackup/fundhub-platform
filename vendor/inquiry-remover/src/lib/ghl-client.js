"use strict";

/**
 * ghl-client.js — GoHighLevel CRM API Client
 *
 * Thin wrapper for GHL contact operations.
 * Uses Private API Key (location-level) authentication.
 *
 * Follows the same pattern as the underwrite-iq-lite ghl-contact-service.js
 * but scoped to inquiry-removal needs (custom field updates + notes).
 */

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_API_VERSION = "2021-07-28";

function getConfig() {
  const apiKey = process.env.GHL_PRIVATE_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!apiKey) throw new Error("GHL_PRIVATE_API_KEY not configured");
  if (!locationId) throw new Error("GHL_LOCATION_ID not configured");
  return { apiKey, locationId };
}

function isConfigured() {
  return !!(process.env.GHL_PRIVATE_API_KEY && process.env.GHL_LOCATION_ID);
}

async function ghlFetch(path, options = {}) {
  const { apiKey } = getConfig();
  const url = `${GHL_API_BASE}${path}`;
  const resp = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Version: GHL_API_VERSION,
      ...options.headers
    }
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(
      `GHL ${options.method || "GET"} ${path} failed: ${resp.status} ${text.substring(0, 300)}`
    );
  }

  return resp.json();
}

// ---------------------------------------------------------------------------
// Update Contact Custom Fields
// ---------------------------------------------------------------------------

/**
 * Update custom fields on a GHL contact.
 *
 * @param {string} contactId - GHL contact ID
 * @param {Object} customFields - Key/value pairs to set, e.g. { ai_call_master_status: "completed" }
 * @returns {Promise<Object>} GHL API response
 */
async function updateContactCustomFields(contactId, customFields) {
  if (!contactId) throw new Error("contactId is required");

  // GHL expects: customFields: [{ key: "field_name", field_value: "value" }]
  const customFieldsArray = Object.entries(customFields).map(([key, value]) => ({
    key,
    field_value: String(value)
  }));

  return ghlFetch(`/contacts/${contactId}`, {
    method: "PATCH",
    body: JSON.stringify({ customFields: customFieldsArray })
  });
}

// ---------------------------------------------------------------------------
// Add Note to Contact
// ---------------------------------------------------------------------------

/**
 * Add a note to a GHL contact's activity timeline.
 *
 * @param {string} contactId - GHL contact ID
 * @param {string} body - Note text content
 * @returns {Promise<Object>} GHL API response
 */
async function addContactNote(contactId, body) {
  if (!contactId) throw new Error("contactId is required");
  if (!body) throw new Error("Note body is required");

  return ghlFetch(`/contacts/${contactId}/notes`, {
    method: "POST",
    body: JSON.stringify({ body })
  });
}

// ---------------------------------------------------------------------------
// Add Tag to Contact
// ---------------------------------------------------------------------------

/**
 * Add tags to a GHL contact.
 *
 * @param {string} contactId - GHL contact ID
 * @param {string[]} tags - Tags to add
 * @returns {Promise<Object>} GHL API response
 */
async function addContactTags(contactId, tags) {
  if (!contactId) throw new Error("contactId is required");

  return ghlFetch(`/contacts/${contactId}/tags`, {
    method: "POST",
    body: JSON.stringify({ tags })
  });
}

module.exports = {
  isConfigured,
  updateContactCustomFields,
  addContactNote,
  addContactTags,
  getCalendars,
  getFreeSlots,
  createAppointment,
  getContactByPhone
};

// ---------------------------------------------------------------------------
// Calendar Operations
// ---------------------------------------------------------------------------

/**
 * List all calendars in the location.
 * @returns {Promise<Object[]>} Array of calendar objects
 */
async function getCalendars() {
  const data = await ghlFetch("/calendars/");
  return data.calendars || [];
}

/**
 * Get free appointment slots for a calendar.
 *
 * @param {string} calendarId
 * @param {string} startDate - ISO date string (YYYY-MM-DD)
 * @param {string} endDate - ISO date string (YYYY-MM-DD)
 * @param {string} [timezone="America/New_York"]
 * @returns {Promise<Object>} Slot map keyed by date
 */
async function getFreeSlots(calendarId, startDate, endDate, timezone = "America/New_York") {
  if (!calendarId) throw new Error("calendarId is required");
  const startMs = new Date(startDate).getTime();
  const endMs = new Date(endDate).getTime();
  const params = new URLSearchParams({
    startDate: String(startMs),
    endDate: String(endMs),
    timezone
  });
  return ghlFetch(`/calendars/${calendarId}/free-slots?${params}`);
}

/**
 * Create an appointment on a GHL calendar.
 *
 * @param {Object} opts
 * @param {string} opts.calendarId
 * @param {string} opts.contactId - GHL contact ID
 * @param {string} opts.startTime - ISO 8601 timestamp
 * @param {string} opts.endTime - ISO 8601 timestamp
 * @param {string} [opts.title="FundHub Credit Consultation"]
 * @param {string} [opts.assignedUserId]
 * @returns {Promise<Object>} Created appointment
 */
async function createAppointment({ calendarId, contactId, startTime, endTime, title, assignedUserId }) {
  if (!calendarId) throw new Error("calendarId is required");
  if (!contactId) throw new Error("contactId is required");
  if (!startTime) throw new Error("startTime is required");

  const { locationId } = getConfig();
  const body = {
    calendarId,
    locationId,
    contactId,
    startTime,
    endTime: endTime || new Date(new Date(startTime).getTime() + 30 * 60000).toISOString(),
    title: title || "FundHub Credit Consultation",
    appointmentStatus: "confirmed"
  };
  if (assignedUserId) body.assignedUserId = assignedUserId;

  return ghlFetch("/calendars/events/appointments", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

/**
 * Search for a GHL contact by phone number.
 *
 * @param {string} phone - Phone number (E.164 or 10-digit)
 * @returns {Promise<Object|null>} Contact object or null
 */
async function getContactByPhone(phone) {
  if (!phone) throw new Error("phone is required");
  const { locationId } = getConfig();
  const params = new URLSearchParams({
    locationId,
    query: phone
  });
  const data = await ghlFetch(`/contacts/?${params}`);
  const contacts = data.contacts || [];
  return contacts.length > 0 ? contacts[0] : null;
}
