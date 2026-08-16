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

import { readFile } from "node:fs/promises";
import { postJson, classify, success, failure, rejection, redact } from "./http.mjs";
import { resolveMessageAsset } from "../assets.mjs";

/** Must equal the `provider` value in message_channel_routing. */
export const PROVIDER = "resend";

export const CHANNELS = new Set(["email"]);

export const ADDRESS_FIELD = "email";

/** True once migration 164 seeds email → resend. */
export const ENABLED = true;

export const TRANSMITS = true;

const DEFAULT_BASE_URL = "https://api.resend.com";

function asBase64(content, encoding) {
  if (Buffer.isBuffer(content)) return content.toString("base64");
  const raw = String(content ?? "");
  if (encoding === "utf8") return Buffer.from(raw, "utf8").toString("base64");
  return raw.replace(/\s+/g, "");
}

/** Named assets, or inline { filename, content } bytes for generated files. */
async function loadAttachments(list) {
  if (list == null) return { files: [], error: null };
  if (!Array.isArray(list)) return { files: [], error: "attachments must be an array" };
  const files = [];
  for (const item of list) {
    if (item && item.content != null && item.filename) {
      files.push({
        filename: String(item.filename),
        content: asBase64(item.content, item.encoding),
        content_type: item.contentType || item.content_type || "application/pdf"
      });
      continue;
    }
    const key = item && (item.asset || item.key);
    const asset = resolveMessageAsset(key);
    if (!asset) {
      return { files: [], error: `unknown attachment asset: ${String(key || "")}` };
    }
    try {
      const bytes = await readFile(asset.absPath);
      files.push({
        filename: (item && item.filename) || asset.filename,
        content: bytes.toString("base64"),
        content_type: asset.contentType
      });
    } catch (err) {
      return {
        files: [],
        error: `could not read attachment ${asset.filename}: ${String(err && err.message || err)}`
      };
    }
  }
  return { files, error: null };
}

/** Rough plain-text fallback when the template body is HTML (multipart text part). */
function htmlToText(html) {
  return String(html)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/(div|tr|h[1-6]|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "'")
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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

  const looksHtml = /<!DOCTYPE\s+html|<html[\s>]|<table[\s>]/i.test(body);
  const payload = {
    from: cfg.from,
    to: [to],
    subject: message.subject ? String(message.subject) : "(no subject)"
  };
  if (looksHtml) {
    payload.html = body;
    payload.text = htmlToText(body);
  } else {
    payload.text = body;
  }
  if (message.providerRef) {
    payload.headers = { "X-Fundhub-Ref": String(message.providerRef) };
  }

  const attached = await loadAttachments(message.attachments);
  if (attached.error) return rejection(attached.error);
  if (attached.files.length) payload.attachments = attached.files;

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
