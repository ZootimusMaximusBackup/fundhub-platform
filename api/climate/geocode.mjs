import { geocode } from "../../src/climate/connectors.mjs";

function readBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body || "{}"); } catch { return null; }
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });
  const body = readBody(req) || {};
  const q = String(body.q || body.address || "").trim();
  if (!q) return res.status(400).json({ ok: false, error: "missing_q" });
  try {
    const result = await geocode(q);
    if (!result?.stateCode) return res.status(404).json({ ok: false, error: "not_found" });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ ok: false, error: "geocode_failed", message: String(err.message || "").slice(0, 180) });
  }
}
