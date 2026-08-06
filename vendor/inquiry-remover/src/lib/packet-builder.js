"use strict";

/**
 * packet-builder.js — Build call packets from client/CRS data
 *
 * Takes client information and CRS credit data, produces a normalized
 * packet that maps to Bland AI request_data variables for the voice agent.
 */

/**
 * Sanitize a string for safe inclusion in prompt text.
 * Strips characters that could be used for prompt injection.
 */
function sanitize(str, maxLen = 100) {
  return String(str || "")
    .replace(/[^a-zA-Z0-9\s\-&.,\/()]/g, "")
    .substring(0, maxLen);
}

/**
 * Extract the leading numeric street number from an address line.
 * e.g. "456 Oak Ave" → "456"
 */
function extractStreetNumber(addressLine) {
  const match = String(addressLine || "").match(/^(\d+)/);
  return match ? match[1] : "";
}

/**
 * Convert a DOB string (MM/DD/YYYY or YYYY-MM-DD) to MMDDYYYY digits.
 * e.g. "09/02/1995" → "09021995", "1995-09-02" → "09021995"
 */
function dobToDigits(dob) {
  const s = String(dob || "").trim();
  // MM/DD/YYYY format
  const slashMatch = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (slashMatch) return slashMatch[1] + slashMatch[2] + slashMatch[3];
  // YYYY-MM-DD format
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return isoMatch[2] + isoMatch[3] + isoMatch[1];
  // Already digits
  return s.replace(/\D/g, "");
}

/**
 * Build a generic call packet for any bureau dispute call.
 * All three bureaus need the same client identity variables.
 *
 * @param {Object} clientData - Client identity information
 * @param {Array} inquiries - Bureau-specific inquiries to dispute
 * @param {string} transferNumber - FundHub rep phone number (E.164)
 * @param {string} bureau - "EX", "EQ", or "TU"
 * @returns {Object} Bland AI request_data variables object
 */
function buildCallPacket(clientData, inquiries, transferNumber, bureau) {
  if (!clientData.firstName || !clientData.lastName) {
    throw new Error("Client first and last name are required");
  }
  if (!clientData.ssn || clientData.ssn.replace(/\D/g, "").length !== 9) {
    throw new Error("Valid 9-digit SSN is required");
  }
  if (!clientData.address?.zip) {
    throw new Error("Client zip code is required");
  }
  if (!transferNumber) {
    throw new Error("Transfer number is required");
  }

  const cleanSSN = clientData.ssn.replace(/\D/g, "");
  const ssnFormatted = `${cleanSSN.slice(0, 3)}-${cleanSSN.slice(3, 5)}-${cleanSSN.slice(5)}`;
  const cleanZip = (clientData.address.zip || "").replace(/\D/g, "");
  const streetNumber = extractStreetNumber(clientData.address.line1);
  const dobDigits = dobToDigits(clientData.dob);

  const bureauName = { EX: "Experian", EQ: "Equifax", TU: "TransUnion" }[bureau] || bureau;
  const inquiryList = inquiries && inquiries.length > 0
    ? inquiries.map(inq => `- ${sanitize(inq.creditorName)} (${sanitize(inq.date, 10)})`).join("\n")
    : `No specific inquiries listed — dispute all unauthorized inquiries on my ${bureauName} report.`;

  return {
    client_first_name: clientData.firstName,
    client_middle_name: clientData.middleName || "",
    client_last_name: clientData.lastName,
    client_ssn: ssnFormatted,
    client_ssn_digits: cleanSSN,
    client_dob: clientData.dob || "",
    client_dob_digits: dobDigits,
    client_zip: cleanZip,
    client_address: clientData.address.line1 || "",
    client_city: clientData.address.city || "",
    client_state: clientData.address.state || "",
    client_phone: clientData.phone || "",
    client_street_number: streetNumber,
    client_street_number_digits: streetNumber,
    inquiry_list: inquiryList,
    transfer_number: transferNumber,
    client_sex: clientData.sex || "",
    client_employer: clientData.currentEmployer || "",
    client_stale_address: [
      clientData.staleAddress,
      [clientData.staleCity, clientData.staleState].filter(Boolean).join(", ")
    ].filter(Boolean).join(" "),
    client_stale_employer: clientData.staleEmployer || ""
  };
}

/**
 * Build a call packet for an Experian dispute call.
 * Backwards-compatible wrapper around buildCallPacket.
 */
function buildExperianPacket(clientData, inquiries, transferNumber) {
  return buildCallPacket(clientData, inquiries, transferNumber, "EX");
}

/**
 * Build call metadata for tracking.
 */
function buildCallMetadata(clientId, bureau, batchId) {
  return {
    client_id: clientId,
    bureau: bureau,
    batch_id: batchId || `batch_${Date.now()}`,
    initiated_at: new Date().toISOString()
  };
}

/**
 * Extract client data from Airtable PII_IDENTITY + CLIENTS fields.
 * Shared by schedule-call.js and dispatch-scheduled.js.
 */
function extractClientData(piiFields, clientFields) {
  return {
    firstName: piiFields.owner_first_name || "",
    lastName: piiFields.owner_last_name || "",
    middleName: piiFields.owner_middle_name || "",
    // Stored client_sex (PII_IDENTITY single-select male/female/unknown) drives the
    // gendered voice; empty falls back to first-name inference in the launcher.
    sex: piiFields.client_sex || "",
    ssn: piiFields.ssn_full || "",
    dob: piiFields.dob || "",
    phone: piiFields.phone || clientFields.phone || "",
    address: {
      line1: piiFields.street1 || "",
      city: piiFields.city || "",
      state: piiFields.state || "",
      zip: piiFields.zip || ""
    },
    currentEmployer: piiFields.current_employer || "",
    staleAddress: piiFields.stale_address_line1 || "",
    staleCity: piiFields.stale_city || "",
    staleState: piiFields.stale_state || "",
    staleEmployer: piiFields.stale_employer || ""
  };
}

module.exports = {
  buildCallPacket,
  buildExperianPacket,
  buildCallMetadata,
  extractClientData
};
