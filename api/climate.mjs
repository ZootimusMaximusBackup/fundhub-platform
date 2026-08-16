import { buildComposite } from "../src/climate/aggregate.mjs";
import { mapsBrowserKey } from "../src/climate/config.mjs";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "public, s-maxage=900, stale-while-revalidate=600");
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });
  try {
    const payload = await buildComposite();
    return res.status(200).json({ ok: true, mapsKey: Boolean(mapsBrowserKey()), ...payload });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "climate_unavailable",
      message: err && err.message ? String(err.message).slice(0, 180) : "failed"
    });
  }
}
