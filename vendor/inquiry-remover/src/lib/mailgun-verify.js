"use strict";

const crypto = require("crypto");

const MAX_TIMESTAMP_AGE_SECONDS = 300; // 5 minutes

/**
 * Verify a Mailgun webhook signature using HMAC-SHA256.
 * @param {object} params
 * @param {string} params.timestamp - Unix timestamp from Mailgun
 * @param {string} params.token   - Random token from Mailgun
 * @param {string} params.signature - HMAC hex digest from Mailgun
 * @returns {boolean} true if valid (or if signing key is not configured)
 */
function verifyMailgunSignature({ timestamp, token, signature }) {
  const signingKey = process.env.MAILGUN_SIGNING_KEY;

  // Skip verification when no signing key is configured (testing/dev)
  if (!signingKey) {
    return true;
  }

  // Replay protection: reject timestamps older than 5 minutes
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > MAX_TIMESTAMP_AGE_SECONDS) {
    return false;
  }

  const expected = crypto
    .createHmac("sha256", signingKey)
    .update(timestamp + token)
    .digest("hex");

  return expected === signature;
}

module.exports = { verifyMailgunSignature };
