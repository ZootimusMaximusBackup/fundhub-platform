// Synthesize a cited answer from retrieved chunks.
// The model call goes through src/agents/model.mjs (Claude / Anthropic Messages
// API) — the one completion path in this repo. Embeddings stay on OpenAI
// (see embed.mjs); Anthropic has no embeddings API.
// If no API key (or the model fails), fall back to an extractive answer —
// never invent a document that was not retrieved.

import { callModel } from "../agents/model.mjs";

function citationsFrom(chunks) {
  return (chunks || []).map((c, i) => ({
    n: i + 1,
    fileName: c.fileName || "Untitled",
    webViewLink: c.webViewLink || null,
    driveFileId: c.driveFileId || null,
    accessTier: c.accessTier || null,
    clientId: c.clientId || null,
    mimeType: c.mimeType || null,
    excerpt: String(c.content || "").slice(0, 280)
  }));
}

function extractiveAnswer(query, chunks) {
  const cites = citationsFrom(chunks);
  if (!cites.length) {
    return {
      ok: true,
      text: "No matching documents in your clearance for that question.",
      thin: true,
      source: "none",
      citations: []
    };
  }
  const lines = cites.map((c) =>
    `[${c.n}] ${c.fileName}: ${c.excerpt.replace(/\s+/g, " ").trim()}`
  );
  return {
    ok: true,
    text:
      `Found ${cites.length} source(s) for “${String(query || "").trim()}”. ` +
      `The answer model is not configured, so this is the matching text rather than a written summary:\n\n` +
      lines.join("\n\n"),
    thin: true,
    source: "extractive",
    citations: cites
  };
}

/**
 * @returns {{ ok, text, thin, source, citations }}
 */
export async function synthesizeAnswer({
  query,
  chunks,
  env = process.env,
  fetchImpl
} = {}) {
  const cites = citationsFrom(chunks);
  if (!cites.length) return extractiveAnswer(query, chunks);

  if (!env.ANTHROPIC_API_KEY) return extractiveAnswer(query, chunks);

  const context = cites.map((c) =>
    `[${c.n}] file="${c.fileName}" tier=${c.accessTier || "?"}\n${c.excerpt}`
  ).join("\n\n");

  const res = await callModel({
    system:
      "You answer staff questions using ONLY the numbered sources provided. " +
      "Cite sources as [1], [2], etc. If the sources do not contain the answer, say so. " +
      "Do not invent files, policies, or numbers. Keep the answer under 200 words.",
    user: `Question: ${query}\n\nSources:\n${context}`,
    env,
    fetchImpl
  });

  if (res.mode !== "live" || res.error || !res.text) {
    return extractiveAnswer(query, chunks);
  }

  return {
    ok: true,
    text: String(res.text).trim(),
    thin: false,
    source: "model",
    citations: cites
  };
}
