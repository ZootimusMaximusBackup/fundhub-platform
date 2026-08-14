// Resend email provider — replaces Mailgun as the outbound email path.
//
// OWNER LAW (2026-08-14): Email = Resend. Mailgun stays in the tree for
// inbound webhook signing only; do not route new outbound email through it.
//
// Same contract as mailgun.mjs: no DB, no compliance re-check, never throw,
// body sent exactly as approved. Env only — never hardcode the key.
//
//   RESEND_API_KEY   API key (re_…)
//   RESEND_FROM      From header, e.g. "Fundhub <noreply@fundhub.ai>"
//                    Owner law: brand is Fundhub — never FundHub in From.
//                    Free-tier onboarding may use onboarding@resend.dev until
//                    the real domain is verified (SPF/DKIM).
//   RESEND_BASE_URL  optional; defaults to https://api.resend.com

import { postJson, classify, success, failure, rejection, redact } from "./http.mjs";

/** Must equal the `provider` value in message_channel_routing. */
export const PROVIDER = "resend";

export const CHANNELS = new Set(["email"]);

export const ADDRESS_FIELD = "email";

/** True once migration 164 seeds email → resend. */
export const ENABLED = true;

export const TRANSMITS = true;

const DEFAULT_BASE_URL = "https://api.resend.com";

/** Cap after sanitize — Resend/OS path limits; a multi-KB name is abuse. */
const MAX_ATTACHMENT_NAME = 180;

/**
 * Safe PDF filename only. Strips path traversal (`../`, absolute paths),
 * forces a `.pdf` extension, and caps length. Never invents pack.pdf for junk.
 */
function safePdfFilename(name) {
  let base = String(name ?? "letter.pdf").replace(/\\/g, "/").split("/").pop() || "letter.pdf";
  base = base.replace(/[^\w.\- ()[\]]+/g, "_").replace(/^\.+/, "");
  if (!base) base = "letter.pdf";
  if (!/\.pdf$/i.test(base)) {
    base = `${base.replace(/\.[^.]+$/, "") || "letter"}.pdf`;
  }
  if (base.length > MAX_ATTACHMENT_NAME) {
    base = `${base.slice(0, MAX_ATTACHMENT_NAME - 4)}.pdf`;
  }
  return base;
}

/**
 * PDF bytes as base64, or null. Missing/empty/whitespace/non-PDF → drop.
 * Must not throw. Must not ship a 0-byte fake PDF.
 */
function asPdfBase64(raw) {
  let b64 = null;
  if (Buffer.isBuffer(raw)) {
    if (!raw.length) return null;
    b64 = raw.toString("base64");
  } else if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    b64 = trimmed;
  } else {
    return null;
  }
  let bytes;
  try {
    bytes = Buffer.from(b64, "base64");
  } catch {
    return null;
  }
  if (!bytes.length) return null;
  if (bytes.toString("latin1", 0, 4) !== "%PDF") return null;
  return b64;
}

/**
 * Encode attachments for Resend: `{ filename, content }` base64 only.
 * Empty list stays empty (non-pack mail). Bad files are dropped, never faked.
 */
function encodeAttachments(list) {
  if (!Array.isArray(list) || list.length === 0) return [];
  const out = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const content = asPdfBase64(item.contentBase64 ?? item.content);
    if (!content) continue;
    out.push({ filename: safePdfFilename(item.filename), content });
  }
  return out;
}

function config(env) {
  const apiKey = env.RESEND_API_KEY;
  const from = env.RESEND_FROM;
  const missing = [
    !apiKey && "RESEND_API_KEY",
    !from && "RESEND_FROM"
  ].filter(Boolean);
  if (missing.length) return { ok: false, missing };
  return {
    ok: true,
    apiKey,
    from,
    baseUrl: String(env.RESEND_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "")
  };
}

export async function send(message = {}, options = {}) {
  try {
    return await attempt(message, options);
  } catch (err) {
    return failure(`resend provider error: ${String((err && err.message) || err)}`);
  }
}

async function attempt(message, { fetchImpl, timeoutMs, signal, env = process.env } = {}) {
  const cfg = config(env);
  if (!cfg.ok) {
    return failure(`resend is not configured: ${cfg.missing.join(", ")} not set`);
  }

  const to = String(message.to || "").trim();
  if (!to) return rejection("no destination email address on the message");

  const body = String(message.body ?? "");
  if (!body) return rejection("message body is empty");

  const payload = {
    from: cfg.from,
    to: [to],
    subject: message.subject ? String(message.subject) : "(no subject)",
    text: body
  };
  if (message.providerRef) {
    payload.headers = { "X-Fundhub-Ref": String(message.providerRef) };
  }
  const files = encodeAttachments(message.attachments);
  if (files.length) payload.attachments = files;

  const res = await postJson(`${cfg.baseUrl}/emails`, {
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      Accept: "application/json"
    },
    body: JSON.stringify(payload),
    contentType: "application/json",
    timeoutMs,
    fetchImpl,
    signal,
    env,
    what: "resend email"
  });

  if (res.status === 0) return failure(res.error || "resend request failed");

  const verdict = classify(res.status);
  if (verdict.status === "rejected") {
    return rejection(res.error || `resend rejected the message (HTTP ${res.status})`);
  }
  if (verdict.status === "failed") {
    return failure(res.error || `resend returned HTTP ${res.status}`, { retryable: true });
  }

  const providerMessageId = res.body && typeof res.body.id === "string" ? res.body.id : null;
  if (!providerMessageId) {
    return failure(redact(`resend accepted the message but returned no id (HTTP ${res.status})`));
  }
  return success(providerMessageId);
}

export default send;
