// Physical-mail provider for inquiry dispute letters.
// PostGrid is the first implementation behind a provider-agnostic interface.
//
// Env (do not set until wiring): POSTGRID_API_KEY, POSTGRID_WEBHOOK_SECRET.
// Outbound fetch is allowed here (messaging/providers/*) and nowhere else.
//
// PO Box destinations only — never FedEx/UPS service levels (private carriers
// cannot deliver to USPS P.O. Boxes).

import { createHmac, timingSafeEqual } from "node:crypto";
import { postJson, redact } from "./http.mjs";

export const PROVIDER = "postgrid";
export const LETTER_PROVIDER = PROVIDER;

const DEFAULT_BASE = "https://api.postgrid.com/print-mail/v1";

/** Config / send values — USPS mail classes only. */
export const MAIL_SERVICE_LEVELS = Object.freeze([
  "first_class",
  "priority",
  "priority_express"
]);
export const DEFAULT_MAIL_SERVICE_LEVEL = "first_class";

/** Never allowed — private carriers cannot hit bureau P.O. Boxes. */
const FORBIDDEN_CLASSES = Object.freeze([
  "ups_express_overnight",
  "ups_express_2_day",
  "ups_express_3_day",
  "ups_express_3_day_signature_confirmation",
  "ups_express_3_day_adult_signature_confirmation",
  "fedex",
  "fedex_standard_overnight",
  "fedex_priority_overnight",
  "fedex_2_day"
]);

/**
 * Map our config tokens → PostGrid mailingClass (USPS-safe).
 * PostGrid's usps_express_3_day is Priority Mail; generic `express` is the
 * Priority Express lane without selecting UPS/FedEx in our allow-list.
 */
const TO_POSTGRID_MAILING_CLASS = Object.freeze({
  first_class: "usps_first_class",
  priority: "usps_express_3_day",
  priority_express: "express"
});

export function normalizeMailServiceLevel(raw, fallback = DEFAULT_MAIL_SERVICE_LEVEL) {
  const v = String(raw || "").trim().toLowerCase();
  if (/ups|fedex/i.test(v) || FORBIDDEN_CLASSES.includes(v)) {
    return MAIL_SERVICE_LEVELS.includes(fallback) ? fallback : DEFAULT_MAIL_SERVICE_LEVEL;
  }
  if (MAIL_SERVICE_LEVELS.includes(v)) return v;
  const fb = String(fallback || "").trim().toLowerCase();
  return MAIL_SERVICE_LEVELS.includes(fb) ? fb : DEFAULT_MAIL_SERVICE_LEVEL;
}

export function toPostgridMailingClass(serviceLevel) {
  const level = normalizeMailServiceLevel(serviceLevel);
  return TO_POSTGRID_MAILING_CLASS[level] || TO_POSTGRID_MAILING_CLASS.first_class;
}

/** Hardcoded USPS P.O. Box destinations — seeded into ai_bureau_config. */
export const BUREAU_MAIL_ADDRESSES = Object.freeze({
  EX: {
    bureau_code: "EX",
    bureau_name: "Experian",
    company_name: "Experian",
    address_line1: "P.O. Box 4500",
    address_line2: null,
    address_city: "Allen",
    address_state: "TX",
    address_zip: "75013",
    address_country: "US"
  },
  EQ: {
    bureau_code: "EQ",
    bureau_name: "Equifax",
    company_name: "Equifax Information Services LLC",
    address_line1: "P.O. Box 740256",
    address_line2: null,
    address_city: "Atlanta",
    address_state: "GA",
    address_zip: "30374-0256",
    address_country: "US"
  },
  TU: {
    bureau_code: "TU",
    bureau_name: "TransUnion",
    company_name: "TransUnion LLC Consumer Dispute Center",
    address_line1: "P.O. Box 2000",
    address_line2: null,
    address_city: "Chester",
    address_state: "PA",
    address_zip: "19016",
    address_country: "US"
  }
});

export function bureauMailAddress(bureau) {
  const code = String(bureau || "").toUpperCase();
  return BUREAU_MAIL_ADDRESSES[code] || null;
}

function contactPayload(addr) {
  if (!addr) return null;
  const line1 =
    addr.address_line1 || addr.addressLine1 || addr.line1 || addr.street || null;
  if (!line1) return null;
  const firstName = addr.first_name || addr.firstName || undefined;
  const lastName = addr.last_name || addr.lastName || undefined;
  let companyName = addr.company_name || addr.companyName || undefined;
  // Free-form `name` → first/last when structured names absent.
  if (!firstName && !lastName && !companyName && addr.name) {
    const parts = String(addr.name).trim().split(/\s+/);
    if (parts.length === 1) companyName = parts[0];
    else {
      return {
        firstName: parts[0],
        lastName: parts.slice(1).join(" "),
        addressLine1: line1,
        addressLine2: addr.address_line2 || addr.addressLine2 || addr.line2 || undefined,
        city: addr.address_city || addr.city,
        provinceOrState: addr.address_state || addr.provinceOrState || addr.state,
        postalOrZip: addr.address_zip || addr.postalOrZip || addr.zip || addr.zip5,
        countryCode: addr.address_country || addr.countryCode || addr.country || "US"
      };
    }
  }
  return {
    companyName,
    firstName,
    lastName,
    addressLine1: line1,
    addressLine2: addr.address_line2 || addr.addressLine2 || addr.line2 || undefined,
    city: addr.address_city || addr.city,
    provinceOrState: addr.address_state || addr.provinceOrState || addr.state,
    postalOrZip: addr.address_zip || addr.postalOrZip || addr.zip || addr.zip5,
    countryCode: addr.address_country || addr.countryCode || addr.country || "US"
  };
}

/* preTransmission — EVERY FAILURE OUT OF sendLetter CARRIES THIS, AND IT IS A
   FACT, NOT A GUESS.

   true  — nothing left this process. Either a check below refused above the
           postJson call, or the chokepoint itself reported transmitted:false
           (the dry-run fence held it, no fence was declared, or there is no
           fetch implementation). Whatever was going to be mailed was not.
   false — a request was handed to fetch. A 500, a timeout, a dropped socket:
           the letter may be in PostGrid's queue and may already be printed.

   Callers that must not mail the same letter twice read THIS and not the error
   text. src/repair/send.mjs used to string-match the message to decide whether
   to release its claim, so a fence hold — which says outright that nothing was
   transmitted — kept the claim and permanently destroyed the letter. Handing a
   fact up the stack is the fix; the string list there survives only as a
   fallback for callers that drop this field. */

/**
 * Send a dispute letter via PostGrid.
 *
 * Every `{ ok: false }` return also carries `preTransmission: boolean` — see
 * the note above.
 *
 * @param {{
 *   to?: object,
 *   bureau?: string,
 *   from: object,  // client's own name + address (return address) — NOT Fundhub
 *   pdf?: string|Buffer,  // base64 or URL
 *   html?: string,
 *   description?: string,
 *   serviceLevel?: 'first_class'|'priority'|'priority_express',
 *   metadata?: object,
 *   env?: object,
 *   fetchImpl?: typeof fetch
 * }} opts
 */
export async function sendLetter(opts = {}) {
  const env = opts.env || process.env;
  const key = env.POSTGRID_API_KEY;
  if (!key) {
    return { ok: false, preTransmission: true, error: "POSTGRID_API_KEY unset — letter not sent" };
  }

  const serviceLevel = normalizeMailServiceLevel(opts.serviceLevel);
  const mailingClass = toPostgridMailingClass(serviceLevel);
  if (/ups|fedex/i.test(mailingClass)) {
    return { ok: false, preTransmission: true, error: "private_carrier_forbidden_for_po_box", serviceLevel };
  }

  const toAddr = opts.to || bureauMailAddress(opts.bureau);
  if (!toAddr) {
    return { ok: false, preTransmission: true, error: "bureau_mail_address_missing", serviceLevel };
  }
  if (!opts.from) {
    return { ok: false, preTransmission: true, error: "return_address_required — use client name and address, not Fundhub", serviceLevel };
  }

  const body = {
    to: contactPayload(toAddr),
    from: contactPayload(opts.from),
    // Closed-face (non-window) envelope — bureaus reject credit-repair-looking mail.
    envelopeType: "flat",
    // Addresses print on the letter/envelope; blank page is for windowed stock.
    addressPlacement: "top_first_page",
    color: false,
    doubleSided: true,
    mailingClass,
    description: opts.description || "Inquiry dispute letter",
    metadata: opts.metadata || undefined
  };
  if (!body.to || !body.from) {
    return {
      ok: false,
      preTransmission: true,
      error: !body.to ? "bureau_mail_address_incomplete" : "return_address_incomplete",
      serviceLevel
    };
  }

  if (opts.pdf) {
    body.pdf = typeof opts.pdf === "string" ? opts.pdf : Buffer.from(opts.pdf).toString("base64");
  } else if (opts.html || opts.file) {
    body.html = opts.html || opts.file;
  } else {
    return { ok: false, preTransmission: true, error: "pdf_or_html_required", serviceLevel };
  }

  const base = env.POSTGRID_API_BASE || DEFAULT_BASE;
  const res = await postJson(`${base}/letters`, {
    headers: {
      "x-api-key": key
    },
    body: JSON.stringify(body),
    fetchImpl: opts.fetchImpl,
    env,
    what: "postgrid letter"
  });

  if (!res.ok) {
    return {
      ok: false,
      // The chokepoint knows whether a request was actually handed to fetch.
      // Carry that up rather than throwing it away and leaving the caller to
      // guess from the message. Absent (an old stand-in transport in a test),
      // assume it MAY have gone: never invent permission to re-send.
      preTransmission: res.transmitted === false,
      error: redact(res.error || res.body?.error?.message || `postgrid_http_${res.status}`),
      serviceLevel,
      mailingClass,
      raw: res.body
    };
  }

  const raw = res.body?.data || res.body || {};
  return {
    ok: true,
    providerId: raw.id || null,
    serviceLevel,
    mailingClass,
    raw
  };
}

/** Verify PostGrid webhook signature (HMAC-SHA256 of raw body). */
export function verifyMailWebhook(rawBody, headers = {}, env = process.env) {
  const secret = env.POSTGRID_WEBHOOK_SECRET;
  if (!secret) return false;
  const sig =
    headers["postgrid-signature"] ||
    headers["Postgrid-Signature"] ||
    headers["x-postgrid-signature"] ||
    headers["X-Postgrid-Signature"] ||
    "";
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

// Back-compat aliases used while Lob was the reference name.
export const verifyPostgridWebhook = verifyMailWebhook;

/**
 * Parse PostGrid delivery webhook. Load-bearing event: delivery.confirmed.
 * @returns {{ letterId: string|null, deliveredAt: string|null, eventType: string|null, delivered: boolean }}
 */
export function parseMailDeliveryEvent(payload) {
  const body = typeof payload === "string" ? JSON.parse(payload) : payload || {};
  const eventType =
    body.event ||
    body.type ||
    body.event_type ||
    body.eventType ||
    null;
  const data = body.data || body.letter || body.body || body;
  const letterId =
    body.job_id ||
    data.id ||
    body.letter_id ||
    body.letterId ||
    data.letter_id ||
    null;

  const delivered =
    String(eventType || "").toLowerCase() === "delivery.confirmed" ||
    String(data.status || body.status || "").toLowerCase() === "delivered";

  if (!delivered) {
    return { letterId, deliveredAt: null, eventType, delivered: false };
  }

  const deliveredAt =
    body.timestamp ||
    data.deliveredAt ||
    data.delivered_at ||
    data.dateDelivered ||
    body.delivered_at ||
    new Date().toISOString();

  return { letterId, deliveredAt, eventType, delivered: true };
}

export const parsePostgridDeliveryEvent = parseMailDeliveryEvent;

/** Test double — never transmits. */
export function createFakeMailLetterProvider({ fail = false, providerId = "ltr_fake_1" } = {}) {
  const sent = [];
  return {
    PROVIDER,
    sent,
    async sendLetter(opts) {
      sent.push(opts);
      if (fail) return { ok: false, error: "fake_fail", serviceLevel: normalizeMailServiceLevel(opts.serviceLevel) };
      return {
        ok: true,
        providerId,
        serviceLevel: normalizeMailServiceLevel(opts.serviceLevel),
        mailingClass: toPostgridMailingClass(opts.serviceLevel),
        raw: { id: providerId }
      };
    }
  };
}
