import test from "node:test";
import assert from "node:assert/strict";
import {
  whisperBytes,
  WHISPER_MAX_BYTES,
  WHISPER_CREDITS_ERROR,
  WHISPER_RATE_LIMIT_ERROR,
  WHISPER_CREDITS_BACKOFF_MS,
  WHISPER_IDLE_BACKOFF_MS,
  WHISPER_SUCCESS_PAUSE_MS,
  isWhisperCreditsError,
  classifyWhisperFailure,
  whisperKeepAliveSleepMs
} from "./transcribe.mjs";

test("whisperBytes refuses an empty or huge file", async () => {
  const empty = await whisperBytes(Buffer.alloc(0), { env: { OPENAI_API_KEY: "sk-test" } });
  assert.equal(empty.ok, false);
  assert.equal(empty.error, "empty_file");

  const huge = await whisperBytes(Buffer.alloc(WHISPER_MAX_BYTES + 1), {
    env: { OPENAI_API_KEY: "sk-test" }
  });
  assert.equal(huge.ok, false);
  assert.equal(huge.error, "too_large");
});

test("whisperBytes posts the file through the fence and returns words", async () => {
  let seen = null;
  const out = await whisperBytes(Buffer.from("ID3fake"), {
    fileName: "call.mp4",
    env: { OPENAI_API_KEY: "sk-test" },
    fetchImpl: async (url, init) => {
      seen = { url, hasBody: !!init.body };
      return {
        ok: true,
        status: 200,
        text: async () => "hello this is the call",
        headers: { forEach() {} }
      };
    }
  });
  assert.equal(out.ok, true);
  assert.equal(out.text, "hello this is the call");
  assert.match(seen.url, /audio\/transcriptions/);
  assert.equal(seen.hasBody, true);
});

test("429 with no credits is retryable, not a dead batch", async () => {
  assert.equal(isWhisperCreditsError({
    status: 429,
    error: '{"error":{"type":"insufficient_quota","message":"You exceeded your current quota"}}'
  }), true);
  const classified = classifyWhisperFailure({
    status: 429,
    error: "insufficient_quota"
  });
  assert.equal(classified.error, WHISPER_CREDITS_ERROR);
  assert.equal(classified.retryable, true);

  let calls = 0;
  const out = await whisperBytes(Buffer.from("ID3fake"), {
    env: { OPENAI_API_KEY: "sk-test" },
    fetchImpl: async () => {
      calls += 1;
      return {
        ok: false,
        status: 429,
        text: async () => JSON.stringify({
          error: { type: "insufficient_quota", message: "You exceeded your current quota" }
        }),
        headers: { forEach() {} }
      };
    }
  });
  assert.equal(calls, 1);
  assert.equal(out.ok, false);
  assert.equal(out.error, WHISPER_CREDITS_ERROR);
  assert.equal(out.retryable, true);
});

test("plain 429 without quota text backs off as a rate limit", () => {
  const classified = classifyWhisperFailure({ status: 429, error: "HTTP 429" });
  assert.equal(classified.error, WHISPER_RATE_LIMIT_ERROR);
  assert.equal(classified.retryable, true);
});

test("keep-alive sleep waits ten minutes on no credits and does not rush", () => {
  assert.equal(whisperKeepAliveSleepMs(WHISPER_CREDITS_ERROR), WHISPER_CREDITS_BACKOFF_MS);
  assert.equal(whisperKeepAliveSleepMs("idle"), WHISPER_IDLE_BACKOFF_MS);
  assert.equal(whisperKeepAliveSleepMs(null), WHISPER_SUCCESS_PAUSE_MS);
  assert.ok(whisperKeepAliveSleepMs(WHISPER_RATE_LIMIT_ERROR, 0) >= 120_000);
  assert.ok(whisperKeepAliveSleepMs(WHISPER_RATE_LIMIT_ERROR, 9) <= 15 * 60 * 1000);
});
