// The SMS provider that replaces the CRM relay once A2P 10DLC clears.
//
// WHY THIS EXISTS BEFORE ANYTHING ROUTES TO IT. A2P 10DLC registration clears on
// a schedule nobody here controls. Writing this provider on the day it clears
// means writing untested send code under time pressure against live client
// traffic. Written now, it sits built and unused, and cutover is one UPDATE to
// message_channel_routing rather than a deploy.
//
// SHIPS DISABLED, AND `ENABLED` IS A DECLARATION RATHER THAN A SWITCH.
// ENABLED = false records that the shipped default in
// db/migrations/110_messages_outbound.sql routes `sms` to ghl_relay, not here.
// It is NOT a second kill switch: index.mjs resolve() deliberately does not
// filter on it. If it did, cutover day would need a row flip AND a code edit AND
// a deploy — exactly the trap this file was written early to avoid. What decides
// whether anything sends is message_channel_routing, and nothing else.
//
// SEPARATE FROM src/adapters/twilio.mjs, AND THEY MUST NOT BE MERGED. That file
// is the INBOUND half — it verifies Twilio's webhook signature on messages
// arriving from clients. This sends. Same vendor, opposite direction.
//
// CONFIGURATION, read at call time:
//   TWILIO_SEND_ACCOUNT_SID  the account SID (the "AC..." id)
//   TWILIO_SEND_AUTH_TOKEN   the auth token. Secret.
//   TWILIO_SEND_FROM         either an E.164 number, or a Messaging Service SID
//                            ("MG..."). See below — A2P makes the second normal.
//   TWILIO_SEND_BASE_URL     optional; defaults to Twilio's US host.
//
// THE SEND-PREFIX IS NOT DECORATION. src/http/router.mjs:42 already reads
// TWILIO_AUTH_TOKEN to verify inbound webhook signatures. One variable serving
// both directions would mean rotating the webhook token silently breaks sending
// — the same collision src/messaging/providers/mailgun.mjs avoids the same way.
//
// FROM MAY BE A MESSAGING SERVICE, AND UNDER A2P IT USUALLY IS. A2P 10DLC
// campaigns are attached to a Messaging Service, not to a bare number, and
// Twilio takes the two through different request fields. Supporting both is four
// lines here; discovering the difference on cutover morning is not.

import { postJson, classify, success, failure, rejection } from "./http.mjs";

/** Must equal the `provider` value in message_channel_routing. */
export const PROVIDER = "twilio";

/** Channels this provider carries. The dispatcher refuses a mismatch. */
export const CHANNELS = new Set(["sms"]);

/** Twilio addresses an E.164 phone number; clients.phone (001_init.sql:53). */
export const ADDRESS_FIELD = "phone";

/** True: owner 2026-08-14 — the CRM out, SMS = Twilio (migration 164).
    Prove on device Monday when A2P / number clears; until then sends fail
    with a clear Twilio error rather than calling the CRM.
    A declaration of the shipped default, not an enforcement point — see header. */
export const ENABLED = true;

/** True: this provider makes a real outbound HTTP request. Read by
    src/messaging/live-fence.mjs, which refuses to let a journey run reach a
    provider that can leave the building. */
export const TRANSMITS = true;

const DEFAULT_BASE_URL = "https://api.twilio.com";

/* A Messaging Service SID and an account SID are both 34 characters and differ
   only by their two-letter prefix, which is exactly the kind of thing that gets
   pasted into the wrong variable. */
const MESSAGING_SERVICE_PREFIX = "MG";

/* The public origin this deployment answers on. Same expression the rest of the
   messaging path uses to build links (src/messaging/dispatch.mjs), so there is
   one convention rather than a fourth. */
function statusCallbackUrl(env) {
  const base = String(env.APP_BASE_URL || env.URL || "").replace(/\/+$/, "");
  return base ? `${base}/api/webhooks/twilio-status` : "";
}

function config(env) {
  const accountSid = env.TWILIO_SEND_ACCOUNT_SID;
  const authToken = env.TWILIO_SEND_AUTH_TOKEN;
  const from = env.TWILIO_SEND_FROM;
  const missing = [
    !accountSid && "TWILIO_SEND_ACCOUNT_SID",
    !authToken && "TWILIO_SEND_AUTH_TOKEN",
    !from && "TWILIO_SEND_FROM"
  ].filter(Boolean);

  if (missing.length) return { ok: false, missing };
  return {
    ok: true,
    accountSid,
    authToken,
    from: String(from).trim(),
    /* Where Twilio posts what happened to the message afterwards. Without it
       Twilio has nowhere to report and `delivered` can never be written for a
       text — which is exactly why nobody could prove a text landed (T5-16).
       The receiving end is src/adapters/twilio-status.mjs, already wired.

       Built from the public origin rather than defaulted to the live site, so a
       deploy preview reports to itself instead of to production. Empty when no
       origin is configured: a callback URL pointing at the wrong host is worse
       than none, because the receipts would silently move somebody else's rows. */
    statusCallback: statusCallbackUrl(env),
    baseUrl: String(env.TWILIO_SEND_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "")
  };
}

/* send(message, options) → SendResult — identical contract to every provider.

   message: { id, orgId, clientId, channel, to, subject, body, providerRef }
   options: { fetchImpl, timeoutMs, signal, env } */
export async function send(message = {}, options = {}) {
  try {
    return await attempt(message, options);
  } catch (err) {
    // The contract says never throw. Backstop for a bug in the code above.
    return failure(`twilio provider error: ${String((err && err.message) || err)}`);
  }
}

async function attempt(message, { fetchImpl, timeoutMs, signal, env = process.env } = {}) {
  const cfg = config(env);
  if (!cfg.ok) {
    // Retryable: the messages are fine, the configuration is not, and they
    // should go out once someone sets the variable.
    return failure(`twilio is not configured: ${cfg.missing.join(", ")} not set`);
  }

  const to = String(message.to || "").trim();
  // No number is permanent for THIS message: a retry sends it nowhere again.
  if (!to) return rejection("no destination phone number on the message");

  // The mirror of the guard in ghl-relay.mjs, for the mirror-image bug. These
  // two providers carry the same channel and take different addresses, so a
  // dispatcher wired to the wrong ADDRESS_FIELD would hand a CRM contact id to
  // Twilio. Naming it here makes that a readable rejection rather than an opaque
  // Twilio 400 that looks like a bad phone number.
  if (!/^\+[1-9]\d{7,14}$/.test(to)) {
    return rejection(
      `destination is not an E.164 phone number — twilio addresses numbers, not ids`
    );
  }

  const body = String(message.body ?? "");
  if (!body) return rejection("message body is empty");

  // Form-encoded, which is what Twilio's Messages endpoint takes. The body is
  // sent EXACTLY as the gate approved it — no footer, no truncation, no
  // segmentation rewriting. Twilio splits long messages itself.
  const form = new URLSearchParams();
  form.set("To", to);
  if (cfg.from.startsWith(MESSAGING_SERVICE_PREFIX)) {
    form.set("MessagingServiceSid", cfg.from);
  } else {
    form.set("From", cfg.from);
  }
  form.set("Body", body);
  // Ask Twilio to tell us what happened to it. See statusCallbackUrl.
  if (cfg.statusCallback) form.set("StatusCallback", cfg.statusCallback);

  // Optional MMS: public HTTPS MediaUrl values only (Twilio fetches them).
  // Local file paths are refused — host under public/ and pass absolute https URLs.
  const media = message.mediaUrls || message.media_urls || null;
  if (Array.isArray(media)) {
    for (const raw of media) {
      const u = String(raw || "").trim();
      if (!u) continue;
      if (!/^https:\/\//i.test(u)) {
        return rejection(`twilio MediaUrl must be https — got ${u.slice(0, 48)}`);
      }
      form.append("MediaUrl", u);
    }
  }

  // Twilio's Messages endpoint has no idempotency key. The duplicate-send guard
  // is the (org_id, provider_ref) unique index on messages from migration 004,
  // enforced long before this code runs. providerRef is deliberately NOT sent as
  // a Twilio parameter: an unrecognised parameter is a 400 there, which would
  // turn every message into a permanent rejection.
  const url = `${cfg.baseUrl}/2010-04-01/Accounts/${encodeURIComponent(cfg.accountSid)}/Messages.json`;
  const res = await postJson(url, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString("base64")}`,
      Accept: "application/json"
    },
    body: form.toString(),
    contentType: "application/x-www-form-urlencoded",
    timeoutMs,
    fetchImpl,
    signal,
    env,
    what: "twilio sms"
  });

  // A transport failure never reached Twilio. Retryable — see classify().
  if (res.status === 0) return failure(res.error || "twilio request failed");

  const verdict = classify(res.status);
  if (verdict.status === "rejected") {
    return rejection(res.error || `twilio rejected the message (HTTP ${res.status})`);
  }
  if (verdict.status === "failed") {
    return failure(res.error || `twilio returned HTTP ${res.status}`, { retryable: true });
  }

  // Accepted. Twilio returns { sid: "SM...", status: "queued", ... }.
  const sid = res.body && res.body.sid;
  const providerMessageId = typeof sid === "string" && sid ? sid : null;
  if (!providerMessageId) {
    // A 2xx with no SID is not a send we can track: no id means no way to match
    // a later delivery receipt to this row, so recording it as sent would be
    // recording a delivery we cannot prove.
    return failure(`twilio accepted the message but returned no sid (HTTP ${res.status})`);
  }
  return success(providerMessageId);
}

export default send;
