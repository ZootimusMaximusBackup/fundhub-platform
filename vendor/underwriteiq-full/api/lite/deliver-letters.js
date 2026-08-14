"use strict";

/**
 * POST /api/lite/deliver-letters
 *
 * LEFTOVER Vercel HTTP handler. Live Fundhub mail does NOT POST here —
 * letters ship from in-repo letter-pack (U-02 / DS-02). C-06 no longer
 * hits this URL.
 *
 * Historical behavior: GHL workflow POSTed contactId; this handler invented
 * letter specs and called deliverLetters with personal only (no bureau
 * tradelines). After W6, specs-only correctly emits 0 letters inside
 * letter-delivery — this smash refuses the call earlier so we never invent
 * bureau data or chase header-only PDFs / outbound GHL+upload work.
 *
 * Request body (legacy): { contactId, type?, bureaus?: string[] }
 * Optional real data (only path that may deliver): { bureauData | crsResult }
 * Auth: Authorization: Bearer <DELIVER_LETTERS_SECRET || CONTEXT_FETCHER_SECRET>.
 */

const { logInfo, logWarn, logError } = require("./logger");
const { getGHLContact } = require("./ghl-contact-service");
const { deliverLetters } = require("./letter-delivery");

const ALL_BUREAUS = ["transunion", "experian", "equifax"];
// Full bureau name → the 2-letter GHL fieldKey suffix (transunion → "tu", bug #51).
const BUREAU_ABBR = { experian: "ex", equifax: "eq", transunion: "tu" };

function validateAuth(req) {
  const secret = process.env.DELIVER_LETTERS_SECRET || process.env.CONTEXT_FETCHER_SECRET;
  if (!secret) {
    // FAIL CLOSED in production — this endpoint writes to the customer's CRM
    // record. Never serve it unauthenticated on a live deploy. Dev/local stays open.
    if (process.env.NODE_ENV === "production") {
      logError("deliver-letters: no secret configured — refusing to serve in production");
      return { ok: false };
    }
    logWarn("deliver-letters: no secret set — running unauthenticated (dev mode only)");
    return { ok: true };
  }
  const bearer = req.headers["authorization"] || "";
  const token = bearer.startsWith("Bearer ") ? bearer.slice(7).trim() : null;
  const headerSecret = req.headers["x-deliver-letters-secret"] || null;
  if ((token && token === secret) || (headerSecret && headerSecret === secret)) {
    return { ok: true };
  }
  return { ok: false };
}

/**
 * Real credit payload only — never invent tradelines/inquiries/identity.
 * `body.bureaus` as string[] is a bureau-name filter, not credit data.
 */
function extractBureauPayload(body) {
  if (!body || typeof body !== "object") return null;
  const data = body.bureauData;
  if (data && typeof data === "object" && !Array.isArray(data) && Object.keys(data).length > 0) {
    return { bureaus: data, crsResult: null };
  }
  const crs = body.crsResult;
  if (crs && typeof crs === "object" && !Array.isArray(crs)) {
    const normalized = crs.normalized;
    if (normalized && typeof normalized === "object" && !Array.isArray(normalized)) {
      return { bureaus: null, crsResult: crs };
    }
  }
  return null;
}

function zeroDelivery(res, extra = {}) {
  return res.status(200).json({
    ok: true,
    delivered: 0,
    letters: { generated: 0, uploaded: 0, failed: 0 },
    ...extra
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-deliver-letters-secret"
  );

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  if (!validateAuth(req).ok) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  const body = req.body && typeof req.body === "object" ? req.body : {};
  const contactId =
    body.contactId || body.contact_id || (body.customData && body.customData.contactId) || null;

  // Empty body / no real credit data → 0 files. Do not invent bureau rows.
  // Specs-only (contactId + type only) is the W6 leftover: emit 0, no outbound.
  const payload = extractBureauPayload(body);
  if (!payload) {
    logInfo("deliver-letters: specs-only or empty — emitting 0 letters", {
      hasContactId: !!contactId,
      keys: Object.keys(body)
    });
    return zeroDelivery(res, {
      contactId: contactId || null,
      type: body.type === "funding" ? "funding" : body.type ? "repair" : null,
      note: "specs_only_no_bureau_data",
      ghlUpdated: false
    });
  }

  if (!contactId) {
    return res.status(400).json({ ok: false, error: "contactId is required" });
  }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(contactId)) {
    return res.status(400).json({ ok: false, error: "Invalid contactId" });
  }

  const type = body.type === "funding" ? "funding" : "repair";
  const bureauNames =
    Array.isArray(body.bureaus) && body.bureaus.length
      ? body.bureaus
          .map(b => String(b).toLowerCase())
          .filter(b => ALL_BUREAUS.includes(b))
          .filter((b, i, arr) => arr.indexOf(b) === i)
      : ALL_BUREAUS;

  // Look up the client's name/address off their GHL record (needed on the letters).
  let personal;
  try {
    const ghl = await getGHLContact(contactId);
    if (!ghl || !ghl.ok || !ghl.contact) {
      logWarn("deliver-letters: GHL contact lookup failed", { contactId, error: ghl && ghl.error });
      return res.status(502).json({ ok: false, error: "Contact lookup failed" });
    }
    const c = ghl.contact;
    const name =
      `${c.firstName || ""} ${c.lastName || ""}`.trim() ||
      c.contactName ||
      c.fullNameLowerCase ||
      "";
    // The letter generators draw `address` as a single STRING (same shape the pull
    // builds: "line1, city, state zip"). Passing a structured object crashes pdf-lib
    // (drawText needs a string). Compose the one-line string here.
    const cityState = [c.city, c.state].filter(Boolean).join(", ");
    const address = [c.address1 || c.address, cityState, c.postalCode]
      .filter(Boolean)
      .join(" ")
      .trim();
    personal = { name, address };
  } catch (err) {
    logError("deliver-letters: GHL lookup threw", { contactId, error: err.message });
    return res.status(502).json({ ok: false, error: "Contact lookup failed" });
  }

  // Specs describe which PDFs to attempt; bureau payload supplies accounts.
  // Empty item lists inside letter-delivery still emit 0 (W6) — never header-only.
  const letters = [];
  for (const b of bureauNames) {
    const ab = BUREAU_ABBR[b] || b.slice(0, 2);
    if (type === "funding") {
      letters.push({
        type: "personal_info",
        bureau: b,
        round: null,
        fieldKey: `funding_letter_url__personal_info_cleanup__${ab}`
      });
      letters.push({
        type: "inquiry_removal",
        bureau: b,
        round: null,
        fieldKey: `funding_letter_url__inquiry_cleanup__${ab}`
      });
    } else {
      letters.push({
        type: "personal_info",
        bureau: b,
        round: null,
        fieldKey: `repair_letter_url__personal_info_dispute__${ab}`
      });
      for (const round of [1, 2, 3]) {
        letters.push({
          type: "dispute",
          bureau: b,
          round,
          bundled: true,
          fieldKey: `repair_letter_url__round_${round}__${ab}`
        });
      }
    }
  }
  const crsDocuments = {
    package: type === "funding" ? "funding" : "repair",
    letters,
    summaryDocuments: []
  };

  if (!crsDocuments.letters?.length) {
    return zeroDelivery(res, {
      contactId,
      type,
      note: "no letters for this type/bureaus",
      ghlUpdated: false
    });
  }

  logInfo("deliver-letters: delivering", {
    contactId,
    type,
    bureauNames,
    letterCount: crsDocuments.letters.length,
    hasBureauData: !!payload.bureaus,
    hasCrsResult: !!payload.crsResult
  });

  try {
    const result = await deliverLetters({
      contactId,
      personal,
      crsDocuments,
      bureaus: payload.bureaus || undefined,
      crsResult: payload.crsResult || undefined
    });
    if (!result.ok) {
      logError("deliver-letters: delivery failed", { contactId, error: result.error });
      return res.status(502).json({ ok: false, error: result.error || "Delivery failed" });
    }
    const generated = (result.letters && result.letters.generated) || 0;
    return res.status(200).json({
      ok: true,
      contactId,
      type,
      bureaus: bureauNames,
      delivered: generated,
      letters: result.letters,
      uploadErrors: result.uploadErrors,
      ghlUpdated: result.ghlUpdated
    });
  } catch (err) {
    logError("deliver-letters: threw", { contactId, error: err.message });
    return res.status(500).json({ ok: false, error: "Delivery error" });
  }
};
