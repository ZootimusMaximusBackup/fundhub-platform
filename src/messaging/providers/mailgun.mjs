// W2 — the email provider. Mailgun's send API.
//
// SEPARATE FROM src/adapters/mailgun.mjs, AND THEY MUST NOT BE MERGED.
// That file is the INBOUND half: it verifies Mailgun's webhook signature and
// classifies bank-forwarded email onto the event bus. It receives. This sends.
// They share a vendor name and nothing else — different credentials, different
// direction, different failure modes.
//
// WHAT THIS FILE IS NOT ALLOWED TO DO (the provider contract, in full):
//   - It never touches the database. The dispatcher persists the outcome.
//   - It never re-checks compliance, and offers no way around it. By the time
//     send() runs, src/messaging/gate.mjs has already returned `allowed`.
//   - It never mutates the message. No truncation, no appended footer, no
//     template rendering. Changing copy is a template change and goes through
//     the gate.
//   - It never throws. Every failure is a returned SendResult.
//
// CONFIGURATION. Three environment variables, read at call time rather than at
// import time so a test can set them and so a missing one is a returned failure
// rather than a module that will not load:
//
//   MAILGUN_SEND_API_KEY   the private API key
//   MAILGUN_SEND_DOMAIN    the sending domain, e.g. mg.example.com
//   MAILGUN_SEND_FROM      the From header, e.g. "Fundhub <no-reply@mg.example.com>"
//   MAILGUN_SEND_BASE_URL  optional; defaults to the US region. Set to
//                          https://api.eu.mailgun.net for EU-hosted domains.
//
// The names are SEND-prefixed precisely because src/adapters/mailgun.mjs already
// consumes a Mailgun signing key for the inbound direction. One variable serving
// both directions would mean rotating the webhook key silently breaks sending.

import { postJson, classify, success, failure, rejection, redact } from "./http.mjs";

/** Must equal the `provider` value in message_channel_routing. */
export const PROVIDER = "mailgun";

/** Channels this provider carries. The dispatcher refuses a mismatch. */
export const CHANNELS = new Set(["email"]);

/** Which field of the client record addresses this provider. The dispatcher
    resolves it; see the contract amendment on the batch board. */
export const ADDRESS_FIELD = "email";

/** True: migration 110 seeds `email` to mailgun, so this is the shipped default.
    A declaration of what routing ships as, not a switch — see index.mjs. */
export const ENABLED = true;

/** True: this provider makes a real outbound HTTP request. Read by
    src/messaging/live-fence.mjs, which refuses to let a journey run reach a
    provider that can leave the building. */
export const TRANSMITS = true;

const DEFAULT_BASE_URL = "https://api.mailgun.net";

/* config — read the environment, or say precisely what is missing.

   Returns { ok, ... } rather than throwing so a misconfigured deploy produces a
   retryable failure with a readable reason on every queued message, instead of
   an exception at import time that takes the whole dispatcher down. Retryable
   is correct: the messages are fine, the configuration is not, and they should
   go out once someone sets the variable. */
function config(env) {
  const apiKey = env.MAILGUN_SEND_API_KEY;
  const domain = env.MAILGUN_SEND_DOMAIN;
  const from = env.MAILGUN_SEND_FROM;
  const missing = [
    !apiKey && "MAILGUN_SEND_API_KEY",
    !domain && "MAILGUN_SEND_DOMAIN",
    !from && "MAILGUN_SEND_FROM"
  ].filter(Boolean);

  if (missing.length) return { ok: false, missing };
  return {
    ok: true,
    apiKey,
    domain,
    from,
    baseUrl: String(env.MAILGUN_SEND_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "")
  };
}

/* send(message, options) → SendResult

   message: { id, orgId, clientId, channel, to, subject, body, providerRef }
   options: { fetchImpl, timeoutMs, signal, env }

   SendResult: { status: "sent"|"failed"|"rejected", providerMessageId, error, retryable } */
export async function send(message = {}, options = {}) {
  try {
    return await attempt(message, options);
  } catch (err) {
    // The contract says never throw. This is the backstop that makes that true
    // even for a bug in the code above — a provider that throws would be caught
    // by the dispatcher anyway, but with less context than this.
    return failure(`mailgun provider error: ${String((err && err.message) || err)}`);
  }
}

async function attempt(message, { fetchImpl, timeoutMs, signal, env = process.env } = {}) {
  const cfg = config(env);
  if (!cfg.ok) {
    return failure(`mailgun is not configured: ${cfg.missing.join(", ")} not set`);
  }

  const to = String(message.to || "").trim();
  // No address is permanent for THIS message: retrying sends it nowhere again.
  // The dispatcher resolves `to` from the client record, so an empty one means
  // the client has no email — which a retry cannot change.
  if (!to) return rejection("no destination email address on the message");

  const body = String(message.body ?? "");
  if (!body) return rejection("message body is empty");

  // Form-encoded, which is what Mailgun's messages endpoint takes. The body is
  // sent EXACTLY as the gate approved it — no footer, no truncation.
  const form = new URLSearchParams();
  form.set("from", cfg.from);
  form.set("to", to);
  if (message.subject) form.set("subject", String(message.subject));
  form.set("text", body);

  // Our own idempotency key, handed to Mailgun as a custom variable. Mailgun has
  // no server-side idempotency on this endpoint, so this does not prevent a
  // duplicate there — it makes one identifiable afterwards from their logs.
  // The real duplicate-send guard is the (org_id, provider_ref) unique index on
  // messages, enforced before we ever get here.
  if (message.providerRef) form.set("v:fundhub_ref", String(message.providerRef));

  const res = await postJson(`${cfg.baseUrl}/v3/${encodeURIComponent(cfg.domain)}/messages`, {
    headers: {
      // Mailgun uses HTTP Basic with the literal username "api".
      Authorization: `Basic ${Buffer.from(`api:${cfg.apiKey}`).toString("base64")}`,
      Accept: "application/json"
    },
    body: form.toString(),
    contentType: "application/x-www-form-urlencoded",
    timeoutMs,
    fetchImpl,
    signal,
    env,
    what: "mailgun email"
  });

  // A transport failure never reached Mailgun. Retryable — see classify().
  if (res.status === 0) return failure(res.error || "mailgun request failed");

  const verdict = classify(res.status);
  if (verdict.status === "rejected") {
    return rejection(res.error || `mailgun rejected the message (HTTP ${res.status})`);
  }
  if (verdict.status === "failed") {
    return failure(res.error || `mailgun returned HTTP ${res.status}`, { retryable: true });
  }

  // Accepted. Mailgun returns { id: "<20260801...@domain>", message: "Queued..." }.
  const providerMessageId = res.body && typeof res.body.id === "string" ? res.body.id : null;
  if (!providerMessageId) {
    // A 2xx with no id is not a send we can track: no id means no way to match a
    // later bounce or delivery event to this row. Treated as a retryable failure
    // rather than a silent success, because "sent" without an id would record a
    // delivery we cannot prove happened.
    return failure(redact(`mailgun accepted the message but returned no id (HTTP ${res.status})`));
  }
  return success(providerMessageId);
}

export default send;
