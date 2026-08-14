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

import { failure, rejection } from "./http.mjs";

/** Must equal the `provider` value in message_channel_routing. */
export const PROVIDER = "ghl_relay";

/** Channels this provider carries. */
export const CHANNELS = new Set(["sms"]);

/** GHL addresses by contact, so the dispatcher resolves clients.ghl_contact_id. */
export const ADDRESS_FIELD = "ghl_contact_id";

/** False: owner 2026-08-14 — GHL account canceled. SMS routes to Twilio.
    This module stays registered so old rows do not crash; send() is a no-op. */
export const ENABLED = false;

/** False: no longer transmits — send() is a no-op stub. */
export const TRANSMITS = false;

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

/* send — GHL is dead (owner 2026-08-14). Log and no-op so nothing crashes.
   Permanent rejection: do not retry into a canceled account. */
export async function send(message = {}, _options = {}) {
  try {
    const id = message?.id || message?.providerRef || "unknown";
    console.info(`[ghl_relay] no-op — GHL removed; message=${id} not sent`);
    return rejection("ghl_relay removed — SMS routes to twilio (owner 2026-08-14)");
  } catch (err) {
    return failure(`ghl_relay provider error: ${String((err && err.message) || err)}`);
  }
}

export default send;
