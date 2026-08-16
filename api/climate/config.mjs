import { mapsBrowserKey } from "../../src/climate/config.mjs";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });
  const key = mapsBrowserKey();
  return res.status(200).json({
    ok: true,
    mapsKey: key || null,
    applyUrl: process.env.APPLY_PAGE_URL || "https://apply.fundhub.ai"
  });
}
