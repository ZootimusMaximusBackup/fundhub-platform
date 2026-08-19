// Bland AI voice — the outbound half of the phone robot.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY THIS FILE EXISTS
//
// Before it, nothing in this repository could start a phone call. src/adapters/
// bland.mjs listens for Bland's completed-call webhook and nothing ever caused
// one; api/inquiry.mjs proxies to a Vercel app that vendor/inquiry-remover/
// README.md says was never deployed. The only code that has ever dialled lives
// in vendor/inquiry-remover/, is parked, and speaks a script hardcoded in a JS
// file — so editing an agent's prompt in the Agent Editor changed nothing about
// what a real call said, and editing the file changed nothing about the screen.
//
// This closes that: the task Bland speaks is `agents.prompt`, read from the
// database row the Agent Editor writes. One store, one source of truth.
//
//
// WHY IT LIVES IN src/messaging/providers/
//
// CLAUDE.md §12: new outbound transmission may only be added here. A phone call
// reaches a person, so it goes behind the MESSAGING fence, which is what
// postJson() from ./http.mjs binds. src/lib/no-unfenced-transmit.test.mjs fails
// the build if any module reaches the network another way.
//
//
// IT IS NOT REGISTERED IN ./index.mjs, ON PURPOSE.
//
// That registry maps a `provider` string from message_channel_routing onto code
// that sends a `messages` row. This sends no message and writes no row — it
// places a call. Registering it would make a voice runtime selectable as a
// channel's SMS or email sender, which is exactly the "typo in a routing row
// silently sends through the wrong provider" failure index.mjs was written to
// prevent. It is reached only through api/agent-call.mjs.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// FOUR THINGS MUST BE TRUE BEFORE A PHONE RINGS. All four fail closed.
//
//   1. BLAND_API_KEY is set.
//   2. The agent is `live`. Promotion is the human review step, and
//      api/agents.mjs refuses to promote without a written prompt and
//      guardrails, so "live" already means "somebody wrote and approved words".
//   3. The agent has a non-empty prompt. Checked again here rather than trusted:
//      db/migrations/037 seeded two live agents with NULL prompts, which is the
//      whole reason this thread exists. Belt and braces on the exact bug that
//      already happened once.
//   4. MESSAGING_DRY_RUN is explicitly off (src/lib/dry-run.mjs). Unset, empty
//      and unparseable all hold the call. Turning it off is the owner's switch,
//      not this module's.
//
// A refusal is never a fake success. Every path returns a named reason.

import { postJson, classify, redact, success, failure, rejection } from "./http.mjs";

export const PROVIDER = "bland_voice";
export const CHANNELS = new Set(["voice"]);
export const ADDRESS_FIELD = "phone";

/* Not routable as a messaging provider — see the header. Declared so the shape
   is readable next to its siblings and so the fence test can see it transmits. */
export const ENABLED = false;
export const TRANSMITS = true;

export const BLAND_API_BASE = "https://api.bland.ai/v1";

/* Bland POSTs here when the call ends. src/adapters/bland.mjs verifies the
   signature and emits call.completed. Matches the default already used by
   vendor/inquiry-remover/src/lib/bland-client.js:12, so a call placed by either
   half returns to the same door. */
export const DEFAULT_WEBHOOK_URL = "https://fundhub.ai/api/webhooks/bland";

/** E.164-ish. Bland wants a dialable string; this rejects the obviously wrong
    rather than trying to be a phone-number library. */
export function normalizePhone(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const digits = s.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits.length >= 8 ? digits : null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/**
 * readiness(agent, env) → { ok } | { ok:false, reason, message }
 *
 * Exported so api/agent-call.mjs and the Agent Editor can ask "could this agent
 * call anyone?" WITHOUT dialling. A screen that shows a green LIVE badge should
 * be able to say why the badge is or is not backed by a working phone line.
 */
export function agentReadiness(agent) {
  if (!agent) {
    return {
      ok: false, reason: "no_agent",
      message: "No agent was chosen, so there is nobody to make the call."
    };
  }
  if (agent.runtime !== "bland") {
    return {
      ok: false, reason: "not_a_voice_runtime",
      message: "This agent does not run on the phone system, so it cannot place a call."
    };
  }
  if (agent.status !== "live") {
    return {
      ok: false, reason: "not_live",
      message: "This agent is not live. Write its prompt and guardrails, then promote it."
    };
  }
  if (!agent.prompt || !String(agent.prompt).trim()) {
    return {
      ok: false, reason: "no_prompt",
      message: "This agent has no script saved, so there is nothing for it to say."
    };
  }
  return { ok: true };
}

/**
 * readiness(agent, env) — agentReadiness plus "is the phone system plugged in".
 *
 * THE TWO ARE SEPARATE BECAUSE THE ORDER MATTERS. Checking the API key first
 * made every answer "not configured" — including for a person who has asked
 * never to be phoned. Whether somebody may be called is true or false no matter
 * what this deployment has configured, so api/agent-call.mjs asks the questions
 * about the agent and the person FIRST and only then asks whether we could
 * actually dial. A do-not-call flag must never be reported as a setup problem.
 */
export function readiness(agent, env = process.env) {
  const shape = agentReadiness(agent);
  if (!shape.ok) return shape;
  if (!String(env.BLAND_API_KEY || "").trim()) {
    return {
      ok: false, reason: "not_configured",
      message: "The phone system is not connected on this deployment, so no call can be placed."
    };
  }
  return { ok: true };
}

/**
 * placeCall({ agent, phone, clientId, metadata, env, fetchImpl, webhookUrl })
 *   → { status, providerMessageId, callId, error, retryable, blocked?, reason? }
 *
 * `providerMessageId` / `callId` both carry Bland's call_id — the same id
 * src/adapters/bland.mjs reads back off the completed-call webhook, and the key
 * recordDispatch() stores so the return leg is not anonymous.
 *
 * NEVER THROWS. postJson() classifies transport failures; this classifies
 * everything upstream of them.
 */
export async function placeCall({
  agent,
  phone,
  clientId = null,
  metadata = null,
  env = process.env,
  fetchImpl,
  webhookUrl
} = {}) {
  const ready = readiness(agent, env);
  if (!ready.ok) {
    return { ...rejection(ready.message), callId: null, reason: ready.reason };
  }

  const to = normalizePhone(phone);
  if (!to) {
    return {
      ...rejection("No usable phone number for this person."),
      callId: null, reason: "no_phone"
    };
  }

  const body = {
    phone_number: to,
    // THE POINT OF THE WHOLE FILE: the words come from the database row the
    // Agent Editor saves, never from a file in vendor/.
    task: String(agent.prompt),
    wait_for_greeting: true,
    webhook: webhookUrl || String(env.BLAND_WEBHOOK_URL || "").trim() || DEFAULT_WEBHOOK_URL,
    metadata: {
      ...(metadata || {}),
      agent_code: agent.code || null,
      client_id: clientId,
      source: "fundhub-agent-editor"
    }
  };

  /* Bland takes the key raw in Authorization, with no "Bearer" — see
     vendor/inquiry-remover/src/lib/bland-client.js:26. Sending Bearer here 401s. */
  /* STRINGIFY HERE. postJsonTo (src/lib/outbound-fetch.mjs:210-217) sets the
     JSON content-type but passes `body` through to fetch untouched, so handing
     it an object sends the literal text "[object Object]". Every other JSON
     provider in this directory serialises for the same reason. */
  const res = await postJson(`${BLAND_API_BASE}/calls`, {
    headers: { Authorization: String(env.BLAND_API_KEY).trim() },
    body: JSON.stringify(body),
    env,
    fetchImpl,
    what: `bland call ${agent.code || "?"}`
  });

  if (res.blocked) {
    return {
      status: "blocked", providerMessageId: null, callId: null,
      error: "Outbound sending is switched off on this deployment, so no call was placed.",
      retryable: true, blocked: true, reason: "dry_run"
    };
  }
  /* status 0 means no HTTP response happened at all — timeout, DNS, socket.
     Anything with a status is a real answer from Bland and must go to classify()
     so a 400 stays a rejection instead of being retried forever. transmit() sets
     `error` on every non-2xx, so keying on `error` alone hid the status. */
  if (res.status === 0) {
    return { ...failure(res.error || "The phone system could not be reached."), callId: null, reason: "transport" };
  }

  const verdict = classify(res.status);
  if (verdict.status !== "sent") {
    return {
      status: verdict.status,
      providerMessageId: null,
      callId: null,
      error: redact(typeof res.body === "string" ? res.body : JSON.stringify(res.body || {})),
      retryable: verdict.retryable,
      reason: "bland_rejected"
    };
  }

  const payload = typeof res.body === "string" ? safeJson(res.body) : (res.body || {});
  const callId = payload.call_id || payload.callId || payload.id || null;
  if (!callId) {
    /* Bland accepted it but told us nothing we can join on. The call may well be
       ringing, so this is not "rejected" — but the return webhook will land
       anonymous and we say so rather than reporting a clean send. */
    return {
      status: "failed", providerMessageId: null, callId: null,
      error: "The phone system accepted the call but did not return a call id, so the result cannot be matched back to this person.",
      retryable: false, reason: "no_call_id"
    };
  }

  return { ...success(callId), callId, reason: "placed" };
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return {}; }
}

export default { PROVIDER, placeCall, readiness, agentReadiness, normalizePhone };
