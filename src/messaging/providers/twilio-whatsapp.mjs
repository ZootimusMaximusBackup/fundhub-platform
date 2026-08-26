// Twilio WhatsApp — ops ticket hook for Darwin, not a client channel.
//
// Not registered in the provider map on purpose. Client SMS stays on twilio.
// Pulse calls this only when DARWIN_WHATSAPP is set. No number is invented here.
//
// Outbound fetch stays behind postJson (messaging fence).

import { postJson, classify, success, failure, rejection } from "./http.mjs";

export const PROVIDER = "twilio_whatsapp";
export const CHANNELS = new Set(["whatsapp"]);
export const ADDRESS_FIELD = "phone";
export const ENABLED = false;
export const TRANSMITS = true;

const DEFAULT_BASE_URL = "https://api.twilio.com";
const MESSAGING_SERVICE_PREFIX = "MG";
const E164 = /^\+[1-9]\d{7,14}$/;

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
    baseUrl: String(env.TWILIO_SEND_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "")
  };
}

function whatsappAddress(raw) {
  const s = String(raw || "").trim();
  if (s.startsWith("whatsapp:")) {
    const num = s.slice("whatsapp:".length);
    return E164.test(num) ? s : null;
  }
  return E164.test(s) ? `whatsapp:${s}` : null;
}

export async function send(message = {}, options = {}) {
  try {
    return await attempt(message, options);
  } catch (err) {
    return failure(`twilio whatsapp provider error: ${String((err && err.message) || err)}`);
  }
}

async function attempt(message, { fetchImpl, timeoutMs, signal, env = process.env } = {}) {
  const cfg = config(env);
  if (!cfg.ok) {
    return failure(`twilio is not configured: ${cfg.missing.join(", ")} not set`);
  }

  const to = whatsappAddress(message.to);
  if (!to) {
    return rejection("destination is not an E.164 phone number — DARWIN_WHATSAPP must be + and digits");
  }

  const body = String(message.body ?? "");
  if (!body) return rejection("message body is empty");

  const form = new URLSearchParams();
  form.set("To", to);
  if (cfg.from.startsWith(MESSAGING_SERVICE_PREFIX)) {
    form.set("MessagingServiceSid", cfg.from);
  } else {
    const from = whatsappAddress(cfg.from);
    if (!from) return rejection("TWILIO_SEND_FROM is not an E.164 number or Messaging Service");
    form.set("From", from);
  }
  form.set("Body", body);

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
    what: "twilio whatsapp"
  });

  if (res.status === 0) return failure(res.error || "twilio request failed");
  const verdict = classify(res.status);
  if (verdict.status === "rejected") {
    return rejection(res.error || `twilio rejected the message (HTTP ${res.status})`);
  }
  if (verdict.status === "failed") {
    return failure(res.error || `twilio returned HTTP ${res.status}`, { retryable: true });
  }
  const sid = res.body && res.body.sid;
  const providerMessageId = typeof sid === "string" && sid ? sid : null;
  if (!providerMessageId) {
    return failure(`twilio accepted the message but returned no sid (HTTP ${res.status})`);
  }
  return success(providerMessageId);
}

export default send;
