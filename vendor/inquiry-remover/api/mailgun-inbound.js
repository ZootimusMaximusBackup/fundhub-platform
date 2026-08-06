"use strict";

/**
 * mailgun-inbound.js — Mailgun Inbound Email Handler
 *
 * Receives forwarded bank emails from Mailgun, classifies them,
 * writes to Airtable BANK_INBOX, and fires GHL F-11 webhook.
 *
 * Replaces the dead Zapier F-11-IN → AX14 → GHL F-11 chain.
 */

const { verifyMailgunSignature } = require("../src/lib/mailgun-verify");
const { classifyEmail } = require("../src/lib/email-classifier");
const {
  extractContactId,
  extractAmount,
  extractLenderName,
  computeMessageHash,
  buildBodyPreview
} = require("../src/lib/email-parser");
const { createRecord, listRecords } = require("../src/lib/airtable-client");
const {
  notifyBankEmailEvent,
  notifyInboxVerified
} = require("../src/lib/ghl-webhook-sender");

const BANK_INBOX_TABLE = "BANK_INBOX";

module.exports = async function handler(req, res) {
  // Only accept POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body || {};

    // Step 1: Verify inbound secret (query param or Mailgun signature)
    const inboundSecret = process.env.MAILGUN_INBOUND_SECRET;
    if (inboundSecret) {
      const querySecret = req.query?.secret || "";
      if (querySecret !== inboundSecret) {
        console.error("[mailgun-inbound] Inbound secret mismatch");
        return res.status(200).json({ ok: false, reason: "invalid_secret" });
      }
    }

    // Step 2: Extract contact_id from recipient
    const recipient = body.recipient || body.To || "";
    const contactId = extractContactId(recipient);
    if (!contactId) {
      console.log("[mailgun-inbound] No contact_id in recipient:", recipient);
      return res.status(200).json({ ok: false, reason: "no_contact_id" });
    }

    // Step 3: Classify email
    const subject = body.subject || body.Subject || "";
    const from = body.sender || body.from || body.From || "";
    const bodyPlain = body["body-plain"] || body.body_plain || "";
    const strippedText = body["stripped-text"] || body.stripped_text || "";

    const classification = classifyEmail({ subject, from, bodyPlain, strippedText });
    const { event_type, confidence, matched_rule } = classification;

    // Step 4: Extract amount, lender, preview
    const textForParsing = strippedText || bodyPlain;
    const detected_amount = extractAmount(`${subject} ${textForParsing}`);
    const lender_name_guess = extractLenderName(from, subject, textForParsing);
    const body_preview = buildBodyPreview(strippedText, bodyPlain);
    const timestamp = body.timestamp
      ? new Date(Number(body.timestamp) * 1000).toISOString()
      : new Date().toISOString();

    // Step 5: Deduplicate via message_hash
    const message_hash = computeMessageHash(contactId, subject, timestamp);

    let isDuplicate = false;
    try {
      const existing = await listRecords(BANK_INBOX_TABLE, {
        filterByFormula: `{message_hash} = "${message_hash}"`,
        maxRecords: 1,
        fields: ["message_hash"]
      });
      if (existing.records && existing.records.length > 0) {
        isDuplicate = true;
      }
    } catch (err) {
      console.error("[mailgun-inbound] Dedupe check failed:", err.message);
      // Continue — better to create a duplicate than to drop an email
    }

    if (isDuplicate) {
      console.log("[mailgun-inbound] Duplicate detected:", message_hash);
      return res.status(200).json({ ok: true, reason: "duplicate", contact_id: contactId });
    }

    // Step 6: Write BANK_INBOX record to Airtable
    let recordId = null;
    try {
      const fields = {
        "Id": contactId,
        "from": from,
        "Body Preview": `[${subject}]\n\n${body_preview}`,
        "Timestamp": timestamp,
        "Type": event_type,
        "lender_name_guess": lender_name_guess || undefined,
        "message_hash": message_hash,
        "raw_payload_json": JSON.stringify({
          sender: from,
          recipient,
          subject,
          body_preview: body_preview.substring(0, 200),
          classification: { event_type, confidence, matched_rule }
        })
      };
      if (detected_amount) fields["Amount"] = detected_amount;
      // Remove undefined values
      Object.keys(fields).forEach(k => fields[k] === undefined && delete fields[k]);
      const record = await createRecord(BANK_INBOX_TABLE, fields);
      recordId = record.id;
      console.log("[mailgun-inbound] Created BANK_INBOX record:", recordId, event_type);
    } catch (err) {
      console.error("[mailgun-inbound] Airtable write failed:", err.message);
      // Still return 200 to prevent Mailgun retry
    }

    // Step 7: Fire GHL F-11 webhook (non-fatal)
    if (event_type !== "NOISE") {
      const ghlResult = await notifyBankEmailEvent({
        contact_id: contactId,
        event_type,
        from,
        subject,
        body_preview,
        detected_amount,
        lender_name_guess,
        timestamp
      });
      if (!ghlResult.ok) {
        console.error("[mailgun-inbound] GHL F-11 webhook failed:", ghlResult.error);
      }
    }

    // Step 8: Check if first email for this contact → fire F-10R
    try {
      const contactEmails = await listRecords(BANK_INBOX_TABLE, {
        filterByFormula: `{Id} = "${contactId}"`,
        maxRecords: 2,
        fields: ["Id"]
      });
      // If only 1 record (the one we just created), this is the first email
      if (contactEmails.records && contactEmails.records.length <= 1) {
        const verifyResult = await notifyInboxVerified({ contact_id: contactId });
        if (verifyResult.ok) {
          console.log("[mailgun-inbound] First email — fired inbox_forwarding_verified for", contactId);
        }
      }
    } catch (err) {
      console.error("[mailgun-inbound] F-10R check failed:", err.message);
    }

    // Always return 200 to prevent Mailgun retries
    return res.status(200).json({
      ok: true,
      contact_id: contactId,
      event_type,
      confidence,
      record_id: recordId
    });
  } catch (err) {
    console.error("[mailgun-inbound] Unhandled error:", err);
    // Still return 200 to prevent Mailgun retries
    return res.status(200).json({ ok: false, reason: "internal_error" });
  }
};
