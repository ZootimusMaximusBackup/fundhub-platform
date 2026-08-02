// Synthesize a cited answer from retrieved chunks.
// Outbound LLM calls go through messaging/providers/http.mjs.
// If no API key (or the model fails), fall back to an extractive answer —
// never invent a document that was not retrieved.

import { postJson } from "../messaging/providers/http.mjs";

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
      `OpenAI is not configured, so this is the matching text rather than a written summary:\n\n` +
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

  const apiKey = env.OPENAI_API_KEY || env.COMPANY_BRAIN_OPENAI_API_KEY;
  if (!apiKey) return extractiveAnswer(query, chunks);

  const model = env.COMPANY_BRAIN_ANSWER_MODEL || "gpt-4o-mini";
  const baseUrl = String(env.OPENAI_API_BASE || "https://api.openai.com").replace(/\/+$/, "");

  const context = cites.map((c) =>
    `[${c.n}] file="${c.fileName}" tier=${c.accessTier || "?"}\n${c.excerpt}`
  ).join("\n\n");

  const res = await postJson(`${baseUrl}/v1/chat/completions`, {
    headers: { authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You answer staff questions using ONLY the numbered sources provided. " +
            "Cite sources as [1], [2], etc. If the sources do not contain the answer, say so. " +
            "Do not invent files, policies, or numbers. Keep the answer under 200 words."
        },
        {
          role: "user",
          content: `Question: ${query}\n\nSources:\n${context}`
        }
      ]
    }),
    timeoutMs: 45_000,
    fetchImpl
  });

  if (!res.ok || !res.body?.choices?.[0]?.message?.content) {
    return extractiveAnswer(query, chunks);
  }

  return {
    ok: true,
    text: String(res.body.choices[0].message.content).trim(),
    thin: false,
    source: "model",
    citations: cites
  };
}
