"use strict";

const F10R_WEBHOOK_URL =
  "https://services.leadconnectorhq.com/hooks/ORh91GeY4acceSASSnLR/webhook-trigger/8e5e64ce-ba3f-44df-bde2-620aab10c58c";

/**
 * Notify GHL F-11 workflow about a bank funding email event.
 * Non-fatal: errors are logged and returned, never thrown.
 */
async function notifyBankEmailEvent({
  contact_id,
  event_type,
  from,
  subject,
  body_preview,
  detected_amount,
  lender_name_guess,
  timestamp,
}) {
  const url = process.env.GHL_F11_WEBHOOK_URL;

  if (!url) {
    console.error("[ghl-webhook-sender] GHL_F11_WEBHOOK_URL is not set");
    return { ok: false, error: "GHL_F11_WEBHOOK_URL is not set" };
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "funding_email_event",
        contact_id,
        event_type,
        from,
        subject,
        body_preview,
        detected_amount,
        lender_name_guess,
        timestamp,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(
        `[ghl-webhook-sender] F-11 webhook returned ${res.status}: ${text}`
      );
      return { ok: false, error: `HTTP ${res.status}` };
    }

    return { ok: true };
  } catch (err) {
    console.error("[ghl-webhook-sender] F-11 webhook failed:", err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Notify GHL F-10R workflow that inbox forwarding has been verified.
 * Non-fatal: errors are logged and returned, never thrown.
 */
async function notifyInboxVerified({ contact_id }) {
  try {
    const res = await fetch(F10R_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "inbox_forwarding_verified",
        contact_id,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(
        `[ghl-webhook-sender] F-10R webhook returned ${res.status}: ${text}`
      );
      return { ok: false, error: `HTTP ${res.status}` };
    }

    return { ok: true };
  } catch (err) {
    console.error("[ghl-webhook-sender] F-10R webhook failed:", err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = { notifyBankEmailEvent, notifyInboxVerified };
