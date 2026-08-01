// POST /api/journeys/ask — server-side proxy to Claude for the Journeys
// editor (public/app/journeys.html). The editor used to call
// api.anthropic.com straight from the browser, which cannot work: a browser
// has no safe place to hold ANTHROPIC_API_KEY. This endpoint holds the key
// server-side instead and does the same call on the client's behalf.
//
// Gated owner/admin — journeys drive live SMS/email copy and pipeline
// wiring, so this is authoring, not a read screen.
//
// { system, user } → { ok, text }  or  { ok:false, error }

import { requireRole } from "../../src/http/middleware/requireRole.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await requireRole("owner", "admin")(req, res);
  if (!staff) return; // requireRole already wrote the 401/403

  const { system, user } = req.body || {};
  if (!system || !user) {
    return res.status(400).json({ ok: false, error: "system_and_user_required" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ ok: false, error: "anthropic_api_key_not_configured" });
  }

  let upstream;
  try {
    upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 1000,
        system,
        messages: [{ role: "user", content: user }]
      })
    });
  } catch {
    return res.status(502).json({ ok: false, error: "anthropic_unreachable" });
  }

  if (!upstream.ok) {
    return res.status(502).json({ ok: false, error: "anthropic_http_" + upstream.status });
  }

  const data = await upstream.json();
  const text = (data.content || []).filter(c => c.type === "text").map(c => c.text).join("");
  return res.status(200).json({ ok: true, text });
}
