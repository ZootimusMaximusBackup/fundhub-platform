// OpenAI embeddings for Company Brain.
// Owner-set: embeddings stay on OpenAI. Completions also use OpenAI for now
// (src/agents/model.mjs). Stored vectors are 1536-dim.
// Outbound HTTP goes through src/messaging/providers/http.mjs (the only
// directory allowed to transmit). This module does not call fetch itself.

import { postJsonTo, INTERNAL } from "../lib/outbound-fetch.mjs";

export const DEFAULT_EMBED_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMS = 1536;

export function embedConfigFromEnv(env = process.env) {
  const apiKey = env.OPENAI_API_KEY || env.COMPANY_BRAIN_OPENAI_API_KEY || null;
  const model = env.COMPANY_BRAIN_EMBED_MODEL || DEFAULT_EMBED_MODEL;
  const baseUrl = String(env.OPENAI_API_BASE || "https://api.openai.com").replace(/\/+$/, "");
  const missing = [];
  if (!apiKey) missing.push("OPENAI_API_KEY");
  return {
    ready: missing.length === 0,
    missing,
    apiKey,
    model,
    baseUrl
  };
}

/**
 * Embed one or more texts. Returns { ok, embeddings: number[][], error? }.
 * Never throws.
 */
export async function embedTexts(texts, {
  env = process.env,
  fetchImpl,
  timeoutMs = 30_000
} = {}) {
  const list = (Array.isArray(texts) ? texts : [texts])
    .map((t) => String(t || "").trim())
    .filter(Boolean);
  if (list.length === 0) return { ok: true, embeddings: [] };

  const cfg = embedConfigFromEnv(env);
  if (!cfg.ready) {
    return { ok: false, embeddings: [], error: `not_configured:${cfg.missing.join(",")}` };
  }

  const res = await postJsonTo(`${cfg.baseUrl}/v1/embeddings`, {
    headers: { authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ model: cfg.model, input: list }),
    timeoutMs,
    fetchImpl,
    fence: INTERNAL,
    what: "embeddings"
  });

  if (!res.ok) {
    return {
      ok: false,
      embeddings: [],
      error: `embed_http_${res.status}:${res.error || "failed"}`
    };
  }

  const data = res.body && Array.isArray(res.body.data) ? res.body.data : null;
  if (!data) {
    return { ok: false, embeddings: [], error: "embed_bad_response" };
  }

  const sorted = [...data].sort((a, b) => (a.index || 0) - (b.index || 0));
  const embeddings = sorted.map((row) => {
    const v = row && row.embedding;
    if (!Array.isArray(v) || v.length !== EMBEDDING_DIMS) return null;
    return v.map(Number);
  });
  if (embeddings.some((v) => !v)) {
    return { ok: false, embeddings: [], error: "embed_bad_dims" };
  }
  return { ok: true, embeddings };
}

/** Format a JS number[] as a pgvector literal: [1,2,3] */
export function toVectorLiteral(embedding) {
  if (!Array.isArray(embedding)) throw new Error("toVectorLiteral requires an array");
  return `[${embedding.map((n) => Number(n)).join(",")}]`;
}
