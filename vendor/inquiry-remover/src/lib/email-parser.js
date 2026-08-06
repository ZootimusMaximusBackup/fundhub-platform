"use strict";

const crypto = require("crypto");

const BANK_ALIASES = [
  { hints: ["chase", "jpmorgan"], canonical: "Chase" },
  { hints: ["amex", "american express"], canonical: "American Express" },
  { hints: ["capital one", "capitalone"], canonical: "Capital One" },
  { hints: ["citi", "citibank"], canonical: "Citi" },
  { hints: ["wells fargo", "wellsfargo"], canonical: "Wells Fargo" },
  {
    hints: ["bank of america", "bankofamerica", "bofa"],
    canonical: "Bank of America",
  },
  { hints: ["discover"], canonical: "Discover" },
  { hints: ["us bank", "usbank"], canonical: "US Bank" },
  { hints: ["navy federal"], canonical: "Navy Federal" },
  { hints: ["usaa"], canonical: "USAA" },
  { hints: ["synchrony"], canonical: "Synchrony" },
  { hints: ["barclays"], canonical: "Barclays" },
];

/**
 * Extract GHL contact_id from recipient address.
 * Format: monitor+{contact_id}@mg.fundhub.ai
 * Handles comma-separated multiple recipients.
 */
function extractContactId(recipient) {
  if (!recipient || typeof recipient !== "string") return null;

  const addresses = recipient.split(",").map((r) => r.trim());
  for (const addr of addresses) {
    const match = addr.match(/monitor\+([^@]+)@mg\.fundhub\.ai/i);
    if (match) return match[1];
  }
  return null;
}

/**
 * Extract dollar amounts from text.
 * Returns the largest amount found, or null.
 */
function extractAmount(text) {
  if (!text || typeof text !== "string") return null;

  const amounts = [];

  // Match $5,000 / $25,000.00 / $5000 patterns
  const dollarPattern = /\$\s*([\d,]+(?:\.\d{1,2})?)/g;
  let match;
  while ((match = dollarPattern.exec(text)) !== null) {
    const raw = match[1].replace(/,/g, "");
    const num = parseFloat(raw);
    if (!isNaN(num) && num > 0) amounts.push(num);
  }

  // Match "approved for 10000" / "pre-approved 50000" patterns (no $ sign)
  const wordPattern =
    /(?:approved|pre-approved|preapproved)\s+(?:for\s+)?([\d,]+(?:\.\d{1,2})?)/gi;
  while ((match = wordPattern.exec(text)) !== null) {
    const raw = match[1].replace(/,/g, "");
    const num = parseFloat(raw);
    if (!isNaN(num) && num > 0) amounts.push(num);
  }

  if (amounts.length === 0) return null;
  return Math.max(...amounts);
}

/**
 * Match sender/subject/body against known bank aliases.
 * Checks from first, then subject, then body. Returns canonical name or null.
 */
function extractLenderName(from, subject, body) {
  const sources = [from, subject, body];

  for (const source of sources) {
    if (!source || typeof source !== "string") continue;
    const lower = source.toLowerCase();

    for (const bank of BANK_ALIASES) {
      for (const hint of bank.hints) {
        if (lower.includes(hint)) return bank.canonical;
      }
    }
  }

  return null;
}

/**
 * SHA256 hash of contactId|subject|timestamp for dedup.
 */
function computeMessageHash(contactId, subject, timestamp) {
  const input = `${contactId}|${subject}|${timestamp}`;
  return crypto.createHash("sha256").update(input).digest("hex");
}

/**
 * Return first 500 chars of strippedText (preferred) or bodyPlain fallback.
 */
function buildBodyPreview(strippedText, bodyPlain) {
  const text = strippedText || bodyPlain;
  if (!text || typeof text !== "string") return "";
  return text.trim().slice(0, 500);
}

module.exports = {
  extractContactId,
  extractAmount,
  extractLenderName,
  computeMessageHash,
  buildBodyPreview,
};
