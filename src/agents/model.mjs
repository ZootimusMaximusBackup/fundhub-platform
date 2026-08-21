// Model call — Anthropic Messages API.
//
// Key: ANTHROPIC_API_KEY from the environment. Left unset on purpose until the
// owner sets it (see docs/STILL-MISSING.md). With no key, callModel() returns
// a shadow result: nothing is sent to Anthropic, nothing throws, and the
// caller logs the would-be request.
//
// No new npm dependency — raw fetch, same posture as src/messaging/providers/*.

export const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";
export const DEFAULT_MAX_TOKENS = 600;

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
  const request = {
    model,
    system: String(system || ""),
    user: String(user || ""),
    max_tokens: maxTokens,
    media_count: mediaParts.length
  };

  const key = env && env.ANTHROPIC_API_KEY;
  if (!key) {
    // Intended reply is unavailable without a key — still return a non-empty
    // shadow body so agent_shadow_log is inspectable (empty log = unverifiable).
    const inbound = String(user || "").slice(0, 280);
    return {
      mode: "shadow",
      text: `[SHADOW — no API key] Model was not called. Inbound: ${inbound || "(empty)"}`,
      raw: null,
      request,
      error: null,
      detail: "ANTHROPIC_API_KEY unset — shadow mode, no model call",
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

function extractText(raw) {
  if (!raw || !Array.isArray(raw.content)) return null;
  const parts = raw.content
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text);
  const joined = parts.join("\n").trim();
  return joined || null;
}

function usageOf(raw) {
  const u = raw && raw.usage;
  return {
    input_tokens: Math.max(0, Number(u && u.input_tokens) || 0),
    output_tokens: Math.max(0, Number(u && u.output_tokens) || 0)
  };
}

export default callModel;
