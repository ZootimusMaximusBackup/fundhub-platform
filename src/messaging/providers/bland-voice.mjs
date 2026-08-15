// Bland AI outbound voice. Inquiry follow-up and owner prove calls.
//
// THIS FILE IS THE ONLY PLACE FUNDHUB POSTS TO Bland TO PLACE A CALL.
// The inbound webhook stays in src/adapters/bland.mjs. Same vendor, opposite
// direction — do not merge them (same split as twilio.mjs vs adapters/twilio).
//
// NOT registered in providers/index.mjs. Voice is not a message_channel_routing
// channel. Registering it would let the email/SMS dispatcher pick it up.
// Outbound fetch still lives here so the chokepoint test can see it.
//
// Voicemail is mandatory. A call without AMD + voicemail_message greets and
// hangs up — that is the prove bug we are closing. placeCall refuses to POST
// if voicemail_message is missing or blank.
//
// Copy must not claim credit outcomes (scores, approvals, removals). Owner law.

import { postJson, classify, success, failure, rejection } from "./http.mjs";
import { recordDispatch } from "../../lib/outbound-calls.mjs";

export const PROVIDER = "bland_voice";
export const CHANNELS = new Set(["voice"]);
export const ADDRESS_FIELD = "phone";
/** Not a message-channel default. Declaration only — not in the registry. */
export const ENABLED = false;
export const TRANSMITS = true;

const DEFAULT_BASE = "https://api.bland.ai/v1";
const E164 = /^\+[1-9]\d{7,14}$/;

/** Safe default drop. No scores, no approvals, no removal promises. */
export const DEFAULT_VOICEMAIL_MESSAGE =
  "Hey, this is Fundhub. We tried to reach you. Please call us back when you can. Talk soon.";

export const DEFAULT_INQUIRY_TASK =
  "This is a Fundhub inquiry follow-up call. Greet the person. Say you are calling from Fundhub about an inquiry on their file that we are helping with. Do not quote scores. Do not promise removals, funding, or approvals. If they want a callback, take a number. Then say goodbye and hang up.";

export const DEFAULT_INQUIRY_FIRST_SENTENCE =
  "Hey, this is Fundhub calling with a quick follow-up.";

export const DEFAULT_PROVE_TASK =
  "This is a short Fundhub prove call. Greet Chris. Say you are calling from Fundhub to confirm the phone line works, and that if he had missed this you would have left a voicemail. Do not talk about credit scores or money. Then say goodbye and hang up.";

export const DEFAULT_PROVE_FIRST_SENTENCE =
  "Hey Chris, this is a short Fundhub prove call.";

export const DEFAULT_PROVE_VOICEMAIL =
  "Hey Chris, this is Fundhub. We just tried to reach you to prove the phone line. Call us back when you can. Talk soon.";

function config(env) {
  const apiKey = env.BLAND_API_KEY;
  if (!apiKey) return { ok: false, missing: ["BLAND_API_KEY"] };
  return {
    ok: true,
    apiKey,
    baseUrl: String(env.BLAND_BASE_URL || DEFAULT_BASE).replace(/\/+$/, ""),
    webhook: String(env.BLAND_WEBHOOK_URL || "https://fundhub.ai/api/webhooks/bland").trim(),
    voice: env.BLAND_VOICE ? String(env.BLAND_VOICE).trim() : null
  };
}

export function requireVoicemailMessage(raw) {
  const text = String(raw || "").trim();
  if (!text) {
    return { ok: false, error: "voicemail_message is required — Bland must leave a voicemail if nobody picks up" };
  }
  if (/\b(fico|credit score|approved for|pre-approv)/i.test(text)) {
    return { ok: false, error: "voicemail_message must not claim credit scores or approvals" };
  }
  return { ok: true, text };
}

/**
 * Place one outbound Bland call. Never throws.
 * Always sends amd: true and voicemail_message.
 *
 * @returns {Promise<{status:string, providerMessageId:string|null, error:string|null, retryable:boolean, blocked?:boolean}>}
 */
export async function placeCall(opts = {}) {
  try {
    return await attempt(opts);
  } catch (err) {
    return failure(`bland voice provider error: ${String((err && err.message) || err)}`);
  }
}

async function attempt({
  phone,
  task,
  firstSentence,
  voicemailMessage = DEFAULT_VOICEMAIL_MESSAGE,
  clientId = null,
  orgId = null,
  kind = "inquiry_removal",
  metadata = null,
  maxDuration = 8,
  waitForGreeting = true,
  record = false,
  db = null,
  fetchImpl,
  timeoutMs,
  signal,
  env = process.env
} = {}) {
  const vm = requireVoicemailMessage(voicemailMessage);
  if (!vm.ok) return rejection(vm.error);

  const to = String(phone || "").trim();
  if (!E164.test(to)) {
    return rejection("destination is not an E.164 phone number");
  }

  const spoken = String(task || "").trim();
  if (!spoken) return rejection("call task is empty");

  const cfg = config(env);
  if (!cfg.ok) {
    return failure(`bland is not configured: ${cfg.missing.join(", ")} not set`);
  }

  const payload = {
    phone_number: to,
    task: spoken,
    wait_for_greeting: waitForGreeting !== false,
    amd: true,
    voicemail_message: vm.text,
    max_duration: Number.isFinite(Number(maxDuration)) ? Number(maxDuration) : 8,
    record: record === true,
    webhook: cfg.webhook
  };
  if (firstSentence) payload.first_sentence = String(firstSentence);
  if (cfg.voice) payload.voice = cfg.voice;
  if (metadata && typeof metadata === "object") payload.metadata = metadata;

  const res = await postJson(`${cfg.baseUrl}/calls`, {
    headers: {
      Authorization: cfg.apiKey,
      Accept: "application/json"
    },
    body: JSON.stringify(payload),
    contentType: "application/json",
    timeoutMs,
    fetchImpl,
    signal,
    env,
    what: "bland voice call"
  });

  if (res.blocked) {
    return { ...failure(res.error || "bland call held by messaging fence"), blocked: true };
  }
  if (res.status === 0) return failure(res.error || "bland request failed");

  const verdict = classify(res.status);
  if (verdict.status === "rejected") {
    return rejection(res.error || `bland rejected the call (HTTP ${res.status})`);
  }
  if (verdict.status === "failed") {
    return failure(res.error || `bland returned HTTP ${res.status}`, { retryable: true });
  }

  const callId = res.body?.call_id || res.body?.callId || null;
  if (!callId) {
    return failure(`bland accepted the call but returned no call_id (HTTP ${res.status})`);
  }

  if (db && clientId && orgId) {
    await recordDispatch({ callId: String(callId), clientId, orgId, kind, db });
  }

  return success(String(callId));
}

export default placeCall;
