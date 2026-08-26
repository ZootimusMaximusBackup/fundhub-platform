// Twilio inbound SMS + voice-answer adapter — Master Rebuild Spec Phase 1.
//
// Exactly three responsibilities:
//   1. verify the X-Twilio-Signature (fail-closed),
//   2. normalize the urlencoded POST body into a flat event,
//   3. emit canonical events onto the bus — handlers react.
//
// Twilio inbound webhooks are application/x-www-form-urlencoded.
// SMS fields: MessageSid, From, To, Body, NumMedia, AccountSid.
// Voice fields: CallSid (no MessageSid). A voice POST must return TwiML or
// Twilio hangs up in ~0.13s (demo.twilio.com / empty JSON).
// Only emits when a MessageSid is present (skip non-message webhooks).

import crypto from "node:crypto";
import { emit } from "../events/bus.mjs";

/** Keep the prove line open so Bland can talk. Same pause the night-ship twimlet used. */
export const VOICE_ANSWER_TWIML =
  '<?xml version="1.0" encoding="UTF-8"?><Response><Pause length="120"/></Response>';

// --- 1. Signature verification (fail-closed) --------------------------------
// Twilio HMAC-SHA1 scheme:
//   base64( HMAC-SHA1( key=authToken, data = fullURL + sorted-params-concat ) )
// Sorted = alphabetical by key, each pair concatenated as key+value (no separator).
// Reference: https://www.twilio.com/docs/usage/webhooks/webhooks-security
export function verifyTwilioSignature(url, params, providedHeader, authToken) {
  if (!authToken) return false;
  const provided = String(providedHeader || "").trim();
  if (!provided) return false;

  // Build the string to sign: URL + sorted param key+value pairs.
  const sortedKeys = Object.keys(params || {}).sort();
  const paramStr = sortedKeys.reduce((acc, k) => acc + k + (params[k] ?? ""), "");
  const data = (url || "") + paramStr;

  const expected = crypto.createHmac("sha1", authToken).update(data, "utf8").digest("base64");
  try {
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function mediaUrlsFromParams(params) {
  const n = params.NumMedia ? Number(params.NumMedia) : 0;
  const urls = [];
  for (let i = 0; i < n; i++) {
    const url = params[`MediaUrl${i}`];
    if (url) urls.push({ url, contentType: params[`MediaContentType${i}`] || null });
  }
  return urls;
}

// --- 2. Normalize the urlencoded body into a flat event ---------------------
// Returns a plain object with the fields we care about.
export function normalizeTwilioEvent(rawBody) {
  const params = {};
  try {
    for (const [k, v] of new URLSearchParams(rawBody || "")) {
      params[k] = v;
    }
  } catch {
    // malformed — return empty, caller handles missing MessageSid
  }
  return {
    sid: params.MessageSid || null,
    from: params.From || null,
    to: params.To || null,
    body: params.Body ?? "",
    numMedia: params.NumMedia ? Number(params.NumMedia) : 0,
    mediaUrls: mediaUrlsFromParams(params),
    accountSid: params.AccountSid || null,
    // raw params object for signature verification
    _params: params
  };
}

// --- 3. Map a normalized event to canonical events (pure) -------------------
// An inbound SMS → message.inbound. No MessageSid → not a message webhook → [].
export function mapToCanonical(evt) {
  if (!evt || !evt.sid) return [];
  return [{ name: "message.inbound" }];
}

// --- Adapter entrypoint -----------------------------------------------------
// handleTwilioWebhook({ db, rawBody, signatureHeader, secret, url })
//   → { ok, status, emitted: [{name, id, deduped}], reason? }
export async function handleTwilioWebhook({ db, rawBody, signatureHeader, secret, url }) {
  const evt = normalizeTwilioEvent(rawBody);

  // Verify before doing anything — fail-closed.
  if (!verifyTwilioSignature(url, evt._params, signatureHeader, secret)) {
    return { ok: false, status: 401, reason: "bad_signature", emitted: [] };
  }

  // Voice: CallSid and no MessageSid. Return TwiML so the line stays open.
  if (evt._params.CallSid && !evt.sid) {
    return {
      ok: true,
      status: 200,
      reason: "voice_answer",
      twiml: VOICE_ANSWER_TWIML,
      contentType: "text/xml",
      emitted: []
    };
  }

  // Non-message webhooks (no MessageSid) — acknowledge, do nothing.
  if (!evt.sid) {
    return { ok: true, status: 200, reason: "not_a_message", emitted: [] };
  }

  const canonical = mapToCanonical(evt);
  if (canonical.length === 0) {
    return { ok: true, status: 200, reason: "ignored", emitted: [] };
  }

  const emitted = [];
  for (const c of canonical) {
    const payload = {
      from: evt.from,
      to: evt.to,
      body: evt.body,
      sid: evt.sid,
      channel: "sms",
      source: "twilio",
      numMedia: evt.numMedia,
      mediaUrls: evt.mediaUrls
    };
    const idKey = `twilio:${evt.sid}:${c.name}`;
    const res = await emit(db, c.name, payload, { idempotencyKey: idKey });
    emitted.push({ name: c.name, id: res.id, deduped: res.deduped });
  }
  return { ok: true, status: 200, emitted };
}
