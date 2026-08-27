// Model call — OpenAI Chat Completions first, Anthropic Messages as fallback.
//
// Owner-set (2026-08-25): use OPENAI_API_KEY for now. COMPANY_BRAIN_OPENAI_API_KEY
// is accepted as the same key (embeddings already read it). ANTHROPIC_API_KEY
// still works when no OpenAI key is set. PDF/document media stays on Anthropic
// when that key is present, because that path already knows documents.
//
// With no key, callModel() returns a shadow result: nothing is sent, nothing
// throws, and the caller logs the would-be request.
//
// No new npm dependency — raw fetch, same posture as src/messaging/providers/*.

export const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";
export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
export const DEFAULT_MAX_TOKENS = 600;

function openaiKeyOf(env) {
  if (!env) return null;
  return env.OPENAI_API_KEY || env.COMPANY_BRAIN_OPENAI_API_KEY || null;
}

/**
 * Which live vendor callModel will use for a text turn.
 * OpenAI wins when its key is set (owner: use OpenAI for now).
 */
export function liveModelProvider(env = process.env) {
  if (openaiKeyOf(env)) return "openai";
  if (env && env.ANTHROPIC_API_KEY) return "anthropic";
  return null;
}

function openaiModelName(requested, env) {
  const override = env && env.OPENAI_MODEL;
  if (override) return String(override);
  const m = String(requested || "");
  if (/^gpt-|^o[1-9]|^chatgpt-/i.test(m)) return m;
  return DEFAULT_OPENAI_MODEL;
}

function openaiBaseUrl(env) {
  return String((env && env.OPENAI_API_BASE) || "https://api.openai.com").replace(/\/+$/, "");
}

function hasDocumentMedia(mediaParts) {
  return (mediaParts || []).some((m) => {
    const mediaType = (m && (m.mediaType || m.media_type)) || "";
    return (m && m.type === "document") || mediaType === "application/pdf";
  });
}

function pickProvider(env, mediaParts) {
  const openai = openaiKeyOf(env);
  const anthropic = env && env.ANTHROPIC_API_KEY;
  if (hasDocumentMedia(mediaParts) && anthropic) return "anthropic";
  if (openai) return "openai";
  if (anthropic) return "anthropic";
  return null;
}

/**
 * callModel({ system, user, env?, fetchImpl?, model?, maxTokens? })
 * → {
 *     mode: 'live' | 'shadow',
 *     text: string | null,          // assistant reply (synthetic marker when keyless)
 *     raw: object | null,
 *     request: { model, system, user, max_tokens },
 *     error: string | null
 *   }
 */
export async function callModel({
  system, user, env = process.env, fetchImpl = globalThis.fetch,
  model = DEFAULT_MODEL, maxTokens = DEFAULT_MAX_TOKENS,
  media = []
} = {}) {
  const mediaParts = Array.isArray(media) ? media.filter(Boolean) : [];
  const provider = pickProvider(env, mediaParts);
  const request = {
    model: provider === "openai" ? openaiModelName(model, env) : model,
    system: String(system || ""),
    user: String(user || ""),
    max_tokens: maxTokens,
    media_count: mediaParts.length,
    provider: provider || null
  };

  if (!provider) {
    // Intended reply is unavailable without a key — still return a non-empty
    // shadow body so agent_shadow_log is inspectable (empty log = unverifiable).
    const inbound = String(user || "").slice(0, 280);
    return {
      mode: "shadow",
      text: `[SHADOW — no API key] Model was not called. Inbound: ${inbound || "(empty)"}`,
      raw: null,
      request,
      error: null,
      detail: "no live model key — shadow mode, no model call",
      usage: { input_tokens: 0, output_tokens: 0 }
    };
  }

  if (typeof fetchImpl !== "function") {
    return {
      mode: "shadow",
      text: null,
      raw: null,
      request,
      error: "fetch unavailable",
      detail: "no fetch implementation",
      usage: { input_tokens: 0, output_tokens: 0 }
    };
  }

  try {
    if (provider === "openai") {
      return await callOpenAI({ env, fetchImpl, request, mediaParts });
    }
    return await callAnthropic({ env, fetchImpl, request, mediaParts });
  } catch (err) {
    return {
      mode: "live",
      text: null,
      raw: null,
      request,
      error: String((err && err.message) || err).slice(0, 300),
      usage: { input_tokens: 0, output_tokens: 0 }
    };
  }
}

async function callOpenAI({ env, fetchImpl, request, mediaParts }) {
  const key = openaiKeyOf(env);
  const userContent = buildOpenAIUserContent(request.user, mediaParts);
  const messages = [];
  if (request.system) messages.push({ role: "system", content: request.system });
  messages.push({ role: "user", content: userContent });

  const res = await fetchImpl(`${openaiBaseUrl(env)}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`
    },
    body: JSON.stringify({
      model: request.model,
      max_tokens: request.max_tokens,
      messages
    })
  });

  const raw = await res.json().catch(() => null);
  const usage = usageOf(raw);
  if (!res.ok) {
    return {
      mode: "live",
      text: null,
      raw,
      request,
      error: `openai ${res.status}: ${JSON.stringify(raw).slice(0, 300)}`,
      usage
    };
  }

  const text = extractText(raw);
  return { mode: "live", text, raw, request, error: null, usage };
}

async function callAnthropic({ env, fetchImpl, request, mediaParts }) {
  const key = env.ANTHROPIC_API_KEY;
  const userContent = buildUserContent(request.user, mediaParts);
  const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: request.model,
      max_tokens: request.max_tokens,
      system: request.system,
      messages: [{ role: "user", content: userContent }]
    })
  });

  const raw = await res.json().catch(() => null);
  const usage = usageOf(raw);
  if (!res.ok) {
    return {
      mode: "live",
      text: null,
      raw,
      request,
      error: `anthropic ${res.status}: ${JSON.stringify(raw).slice(0, 300)}`,
      usage
    };
  }

  const text = extractText(raw);
  return { mode: "live", text, raw, request, error: null, usage };
}

function buildUserContent(userText, mediaParts = []) {
  if (!mediaParts.length) return String(userText || "");
  const parts = [];
  for (const m of mediaParts) {
    const data = m.dataBase64 || m.data;
    const mediaType = m.mediaType || m.media_type || "image/jpeg";
    if (!data) continue;
    if (m.type === "document" || mediaType === "application/pdf") {
      parts.push({ type: "document", source: { type: "base64", media_type: mediaType, data } });
    } else {
      parts.push({ type: "image", source: { type: "base64", media_type: mediaType, data } });
    }
  }
  parts.push({ type: "text", text: String(userText || "") });
  return parts;
}

function buildOpenAIUserContent(userText, mediaParts = []) {
  if (!mediaParts.length) return String(userText || "");
  const parts = [];
  for (const m of mediaParts) {
    const data = m.dataBase64 || m.data;
    const mediaType = m.mediaType || m.media_type || "image/jpeg";
    if (!data) continue;
    if (m.type === "document" || mediaType === "application/pdf") continue;
    parts.push({
      type: "image_url",
      image_url: { url: `data:${mediaType};base64,${data}` }
    });
  }
  parts.push({ type: "text", text: String(userText || "") });
  return parts.length === 1 ? String(userText || "") : parts;
}

function extractText(raw) {
  if (!raw) return null;
  if (Array.isArray(raw.content)) {
    const parts = raw.content
      .filter((b) => b && b.type === "text" && typeof b.text === "string")
      .map((b) => b.text);
    const joined = parts.join("\n").trim();
    if (joined) return joined;
  }
  const choice = raw.choices && raw.choices[0];
  const content = choice && choice.message && choice.message.content;
  if (typeof content === "string" && content.trim()) return content.trim();
  if (Array.isArray(content)) {
    const parts = content
      .filter((b) => b && (b.type === "text" || typeof b.text === "string") && typeof b.text === "string")
      .map((b) => b.text);
    const joined = parts.join("\n").trim();
    if (joined) return joined;
  }
  return null;
}

function usageOf(raw) {
  const u = raw && raw.usage;
  return {
    input_tokens: Math.max(0, Number(u && (u.input_tokens || u.prompt_tokens)) || 0),
    output_tokens: Math.max(0, Number(u && (u.output_tokens || u.completion_tokens)) || 0)
  };
}

export default callModel;
