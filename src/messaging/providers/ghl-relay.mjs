// W3 — the SMS provider. GoHighLevel LeadConnector v2, conversations endpoint.
//
// WHY GHL AND NOT A CARRIER DIRECTLY. The cutover moves email off GHL first and
// leaves SMS running through it, because the numbers, the A2P 10DLC
// registration and the conversation threads all live there. This provider is
// the seam that lets email leave without SMS having to move on the same day —
// which is the entire reason message_channel_routing has a row per channel
// rather than one provider per org.
//
// WHERE THIS API SHAPE COMES FROM, AND WHAT IS ASSUMED.
// The base URL, the bearer scheme and the `Version: 2021-07-28` header are the
// ones this repository already uses successfully against GHL in
// scripts/gen-custom-field-migration.mjs — not invented here. The specific
// endpoint used for sending (POST /conversations/messages with
// { type: "SMS", contactId, message }) is GHL's documented v2 send call.
//
// ASSUMPTION WORTH KNOWING, recorded rather than hidden: there is no GHL relay
// specification anywhere in this repository — the routing table just names the
// provider `ghl_relay`. If "relay" means an intermediary service of ours rather
// than GHL directly, the only thing that changes is GHL_RELAY_BASE_URL, which
// is why it is an environment variable rather than a constant.
//
// ADDRESSED BY CONTACT ID, NOT PHONE NUMBER. This is the contract detail that
// differs from the email provider and the reason ADDRESS_FIELD exists. GHL's
// conversations endpoint sends to a contact, and clients.ghl_contact_id
// (db/schema/001_init.sql:47) is where that id already lives. The dispatcher
// resolves it. A phone number is not a substitute and this provider will not
// take one.
//
// CONFIGURATION, read at call time:
//   GHL_RELAY_API_KEY    private API key (bearer)
//   GHL_RELAY_BASE_URL   optional; defaults to GHL's LeadConnector host
//   GHL_RELAY_VERSION    optional; defaults to the version already proven here
//
// No location id is needed: the contact id identifies the location implicitly,
// and passing a mismatched one is a 401 that looks like an auth problem.

import { postJson, classify, success, failure, rejection } from "./http.mjs";

/** Must equal the `provider` value in message_channel_routing. */
export const PROVIDER = "ghl_relay";

/** Channels this provider carries. */
export const CHANNELS = new Set(["sms"]);

/** GHL addresses by contact, so the dispatcher resolves clients.ghl_contact_id. */
export const ADDRESS_FIELD = "ghl_contact_id";

/** True: migration 110 seeds `sms` to ghl_relay, so this is the shipped default.
    It stops being true the day A2P 10DLC clears and sms is repointed at twilio —
    at which point this file is deleted and that flag moves. See index.mjs. */
export const ENABLED = true;

const DEFAULT_BASE_URL = "https://services.leadconnectorhq.com";
// The same version scripts/gen-custom-field-migration.mjs pins. GHL requires the
// header and rejects the request without it.
const DEFAULT_VERSION = "2021-07-28";

function config(env) {
  const apiKey = env.GHL_RELAY_API_KEY;
  if (!apiKey) return { ok: false, missing: ["GHL_RELAY_API_KEY"] };
  return {
    ok: true,
    apiKey,
    baseUrl: String(env.GHL_RELAY_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    version: String(env.GHL_RELAY_VERSION || DEFAULT_VERSION)
  };
}

/* send(message, options) → SendResult — identical contract to every provider. */
export async function send(message = {}, options = {}) {
  try {
    return await attempt(message, options);
  } catch (err) {
    return failure(`ghl_relay provider error: ${String((err && err.message) || err)}`);
  }
}

async function attempt(message, { fetchImpl, timeoutMs, signal, env = process.env } = {}) {
  const cfg = config(env);
  if (!cfg.ok) {
    return failure(`ghl_relay is not configured: ${cfg.missing.join(", ")} not set`);
  }

  // `to` is a GHL contact id here, not a phone number. A client that was never
  // synced to GHL has none, and no retry will produce one — so this is
  // permanent for this message rather than a transient failure that spins.
  const contactId = String(message.to || "").trim();
  if (!contactId) {
    return rejection("no GHL contact id on the message — the client has no ghl_contact_id");
  }

  // Guard against the confusion this contract invites: a phone number passed
  // where a contact id belongs would otherwise be sent to GHL and come back as
  // an opaque 4xx. Naming it here makes the dispatcher bug obvious.
  if (/^\+?[0-9][0-9\s().-]{6,}$/.test(contactId)) {
    return rejection(
      "destination looks like a phone number, but this provider addresses GHL contact ids"
    );
  }

  const body = String(message.body ?? "");
  if (!body) return rejection("message body is empty");

  const res = await postJson(`${cfg.baseUrl}/conversations/messages`, {
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      Version: cfg.version,
      Accept: "application/json"
    },
    // Sent exactly as the gate approved it. No footer is appended here — the
    // STOP language belongs in the template, where the gate can see it.
    body: JSON.stringify({ type: "SMS", contactId, message: body }),
    timeoutMs,
    fetchImpl,
    signal
  });

  if (res.status === 0) return failure(res.error || "ghl_relay request failed");

  const verdict = classify(res.status);
  if (verdict.status === "rejected") {
    return rejection(res.error || `ghl_relay rejected the message (HTTP ${res.status})`);
  }
  if (verdict.status === "failed") {
    return failure(res.error || `ghl_relay returned HTTP ${res.status}`, { retryable: true });
  }

  // GHL returns { messageId, conversationId, ... }. Accept either spelling of
  // the id field; some v2 responses use `messageId` and some `id`.
  const id = res.body && (res.body.messageId || res.body.id);
  const providerMessageId = typeof id === "string" && id ? id : null;
  if (!providerMessageId) {
    return failure(`ghl_relay accepted the message but returned no id (HTTP ${res.status})`);
  }
  return success(providerMessageId);
}

export default send;
