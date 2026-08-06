// Physical-mail provider for inquiry dispute letters.
// Lob is the reference implementation; swap by changing LETTER_MAIL_PROVIDER.
//
// Env (do not set until wiring): LOB_API_KEY, LOB_WEBHOOK_SECRET.
// Outbound fetch is allowed here (messaging/providers/*) and nowhere else.

import { createHmac, timingSafeEqual } from "node:crypto";

export const LETTER_PROVIDER = "lob";

const DEFAULT_BASE = "https://api.lob.com/v1";

/**
 * @param {{
 *   to: { name: string, address_line1: string, address_city: string, address_state: string, address_zip: string },
 *   from?: object,
 *   file: string,  // HTML or URL
 *   description?: string,
 *   env?: object,
 *   fetchImpl?: typeof fetch
 * }} opts
 * @returns {Promise<{ ok: boolean, providerId?: string, error?: string, raw?: object }>}
 */
export async function sendLetter(opts = {}) {
  const env = opts.env || process.env;
  const key = env.LOB_API_KEY;
  if (!key) {
    return { ok: false, error: "LOB_API_KEY unset — letter not sent" };
  }
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return { ok: false, error: "fetch unavailable" };
  }

  const from = opts.from || {
    name: env.LOB_FROM_NAME || "Fundhub",
    address_line1: env.LOB_FROM_LINE1 || "1 Market St",
    address_city: env.LOB_FROM_CITY || "San Francisco",
    address_state: env.LOB_FROM_STATE || "CA",
    address_zip: env.LOB_FROM_ZIP || "94105"
  };

  const body = {
    description: opts.description || "Inquiry dispute letter",
    to: opts.to,
    from,
    file: opts.file,
    color: false
  };

  try {
    const res = await fetchImpl(`${env.LOB_API_BASE || DEFAULT_BASE}/letters`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    const raw = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: raw?.error?.message || `lob_http_${res.status}`, raw };
    }
    return { ok: true, providerId: raw.id || raw.tracking_number || null, raw };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

/** Verify Lob webhook signature. Returns false when secret unset (safe fail). */
export function verifyLobWebhook(rawBody, headers = {}, env = process.env) {
  const secret = env.LOB_WEBHOOK_SECRET;
  if (!secret) return false;
  const sig = headers["lob-signature"] || headers["Lob-Signature"] || "";
  if (!sig) return false;
  const expected = createHmac("sha256", secret).update(String(rawBody || "")).digest("hex");
  try {
    const a = Buffer.from(String(sig));
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Parse a Lob event payload for letter delivered.
 * @returns {{ letterId: string|null, deliveredAt: string|null, eventType: string|null }}
 */
export function parseLobDeliveryEvent(payload) {
  const body = typeof payload === "string" ? JSON.parse(payload) : payload || {};
  const eventType = body.event_type?.id || body.event_type || body.type || null;
  const letter = body.body || body.letter || body.data || {};
  const letterId = letter.id || body.letter_id || null;
  const delivered =
    /letter\.delivered|letter\.certified\.delivered/i.test(String(eventType || "")) ||
    String(letter.status || "").toLowerCase() === "delivered";
  if (!delivered) {
    return { letterId, deliveredAt: null, eventType, delivered: false };
  }
  const deliveredAt =
    letter.date_delivered ||
    letter.delivered_at ||
    body.date_created ||
    new Date().toISOString();
  return { letterId, deliveredAt, eventType, delivered: true };
}
