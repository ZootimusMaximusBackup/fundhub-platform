// Whisper a short Meet file. Long calls use the Drive transcript doc instead.
// Outbound HTTP goes through src/lib/outbound-fetch.mjs (INTERNAL).

import { postFormTo, INTERNAL } from "../lib/outbound-fetch.mjs";
import { embedConfigFromEnv } from "./embed.mjs";

export const WHISPER_MAX_BYTES = 24 * 1024 * 1024;
export const WHISPER_MODEL = "whisper-1";
export const WHISPER_CREDITS_ERROR = "credits_exhausted";
export const WHISPER_RATE_LIMIT_ERROR = "rate_limited";

export function whisperConfigFromEnv(env = process.env) {
  return embedConfigFromEnv(env);
}

/** 429 / empty wallet / quota. Leave files pending and try the next sweeper tick. */
export function isWhisperCreditsError({ status, error } = {}) {
  const t = String(error || "").toLowerCase();
  if (/insufficient_quota|credits_exhausted|no credits|exceeded your current quota|check your plan and billing/.test(t)) {
    return true;
  }
  return Number(status) === 429 && /quota|billing|credit/.test(t);
}

export function classifyWhisperFailure({ status, error } = {}) {
  if (isWhisperCreditsError({ status, error })) {
    return { error: WHISPER_CREDITS_ERROR, retryable: true };
  }
  if (Number(status) === 429) {
    return { error: WHISPER_RATE_LIMIT_ERROR, retryable: true };
  }
  return {
    error: error || (status ? `whisper_http_${status}` : "whisper_failed"),
    retryable: Number(status) >= 500
  };
}

/** Local keep-alive wait. Credits / idle: 10 min. Rate limit: 2–15 min. After a hit: 30s. */
export const WHISPER_CREDITS_BACKOFF_MS = 10 * 60 * 1000;
export const WHISPER_IDLE_BACKOFF_MS = 10 * 60 * 1000;
export const WHISPER_SUCCESS_PAUSE_MS = 30 * 1000;

export function whisperKeepAliveSleepMs(reason, attempt = 0) {
  if (reason === WHISPER_CREDITS_ERROR) return WHISPER_CREDITS_BACKOFF_MS;
  if (reason === WHISPER_RATE_LIMIT_ERROR) {
    const n = Math.max(0, Math.min(Number(attempt) || 0, 4));
    return Math.min(15 * 60 * 1000, 120_000 * (2 ** n));
  }
  if (
    reason === "idle"
    || reason === "ffmpeg_missing"
    || reason === "drive_not_ready"
    || String(reason || "").startsWith("not_configured")
  ) {
    return WHISPER_IDLE_BACKOFF_MS;
  }
  return WHISPER_SUCCESS_PAUSE_MS;
}

/**
 * Turn audio/video bytes into words. Never throws.
 * @returns {{ ok: boolean, text: string, error?: string, retryable?: boolean }}
 */
export async function whisperBytes(bytes, {
  fileName = "call.mp4",
  env = process.env,
  fetchImpl,
  timeoutMs = 120_000
} = {}) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  if (!buf.length) return { ok: false, text: "", error: "empty_file" };
  if (buf.length > WHISPER_MAX_BYTES) {
    return { ok: false, text: "", error: "too_large" };
  }

  const cfg = whisperConfigFromEnv(env);
  if (!cfg.ready) {
    return { ok: false, text: "", error: `not_configured:${cfg.missing.join(",")}` };
  }

  const form = new FormData();
  form.append("file", new Blob([buf]), fileName);
  form.append("model", WHISPER_MODEL);
  form.append("response_format", "text");

  const res = await postFormTo(`${cfg.baseUrl}/v1/audio/transcriptions`, {
    headers: { authorization: `Bearer ${cfg.apiKey}` },
    body: form,
    timeoutMs,
    fetchImpl,
    fence: INTERNAL,
    what: "whisper",
    asText: true
  });

  if (!res.ok) {
    const classified = classifyWhisperFailure({
      status: res.status,
      error: res.error || `whisper_http_${res.status}`
    });
    return { ok: false, text: "", ...classified };
  }
  const text = String(res.body || "").trim();
  if (!text) return { ok: false, text: "", error: "empty_transcript" };
  return { ok: true, text };
}
