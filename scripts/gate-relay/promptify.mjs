// Voice → text → clean structured input.
//
// WHY THIS EXISTS. Chris talks in long rambling paragraphs. Dumping a raw
// transcript into a waiting agent produces bad results. This step turns ramble
// into clean input BEFORE any agent sees it.
//
// One shot. No history. No personality. Messenger, not assistant.
//
// Transcribe: OpenAI Whisper (OPENAI_API_KEY).
// Clean-up: existing Anthropic helper (ANTHROPIC_API_KEY) — do not invent a
// second client.

import { callModel } from "../../src/agents/model.mjs";

const PROMPTIFY_SYSTEM = `You turn Chris's spoken or typed reply into clean input for a waiting build agent.

Rules:
- No conversation. No personality. No greeting.
- Output only the structured result.
- If he picked one of the allowed answers, put that word first, on its own, then any extra instruction in plain English.
- Do not invent facts he did not say.
- Do not mention files, agents, or tools unless he did.`;

export async function transcribe({
  bytes,
  filename = "voice.ogg",
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const key = env && env.OPENAI_API_KEY;
  if (!key) return { ok: false, error: "transcribe_unavailable" };
  if (!bytes || !bytes.length) return { ok: false, error: "transcribe_empty" };
  if (typeof fetchImpl !== "function") return { ok: false, error: "transcribe_unavailable" };

  try {
    const form = new FormData();
    form.append("model", "whisper-1");
    form.append("file", new Blob([bytes]), filename);

    const res = await fetchImpl("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { authorization: `Bearer ${key}` },
      body: form
    });
    const raw = await res.json().catch(() => null);
    const text = raw && typeof raw.text === "string" ? raw.text.trim() : "";
    if (!res.ok || !text) return { ok: false, error: "transcribe_failed" };
    return { ok: true, text };
  } catch {
    return { ok: false, error: "transcribe_failed" };
  }
}

export function lightPass(text, options = []) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;
  const first = trimmed.split(/\s+/)[0];
  const hit = options.find(
    (o) => String(o).toLowerCase() === first.toLowerCase()
  );
  if (hit && trimmed.split(/\s+/).length === 1) {
    return { answer: hit, promptified: hit };
  }
  return null;
}

export async function promptify({
  text,
  options = [],
  question = "",
  env = process.env,
  fetchImpl = globalThis.fetch,
  callModelImpl = callModel
} = {}) {
  const raw = String(text || "").trim();
  const passed = lightPass(raw, options);
  if (passed) return { ok: true, ...passed, raw, skippedModel: true };

  const user = [
    question ? `Question: ${question}` : null,
    options.length ? `Allowed answers: ${options.join(", ")}` : null,
    `Chris said:\n${raw || "(empty)"}`
  ]
    .filter(Boolean)
    .join("\n\n");

  const result = await callModelImpl({
    system: PROMPTIFY_SYSTEM,
    user,
    env,
    fetchImpl,
    maxTokens: 400
  });

  const promptified = String(result && result.text ? result.text : raw).trim() || raw;
  const answer = pickAnswer(promptified, options) || raw;
  return {
    ok: true,
    answer,
    promptified,
    raw,
    skippedModel: false,
    modelError: result && result.error ? result.error : null
  };
}

export function pickAnswer(promptified, options = []) {
  const text = String(promptified || "").trim();
  if (!text) return "";
  const firstLine = text.split(/\n/)[0].trim();
  const firstWord = firstLine.split(/\s+/)[0].replace(/[^A-Za-z0-9_-]/g, "");
  const hit = options.find(
    (o) => String(o).toLowerCase() === firstWord.toLowerCase()
  );
  return hit || text;
}
