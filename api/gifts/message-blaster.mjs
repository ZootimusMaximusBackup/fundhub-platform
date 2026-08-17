// GET /api/gifts/message-blaster
//
// Locked download for Darwin's Mac Message Blaster. Affiliate and white-label
// partner sessions only — not staff, not clients, not the DIY brokerage path.

import fs from "node:fs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { resolveMessageBlasterAsset } from "../../src/gifts/message-blaster.mjs";

export default async function handler(req, res, deps = {}) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("allow", "GET, HEAD");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const gate = deps.requirePrincipal || requirePrincipal;
  const principal = await gate(req, res, ["affiliate", "partner"], deps);
  if (!principal) return;

  const asset = (deps.resolveMessageBlasterAsset || resolveMessageBlasterAsset)();
  let stat;
  try {
    stat = fs.statSync(asset.path);
  } catch {
    return res.status(503).json({ ok: false, error: "gift_unavailable" });
  }
  if (!stat.isFile() || stat.size <= 0) {
    return res.status(503).json({ ok: false, error: "gift_unavailable" });
  }

  res.setHeader("cache-control", "private, no-store");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("content-type", asset.contentType);
  res.setHeader("content-disposition", `attachment; filename="${asset.filename}"`);
  res.setHeader("content-length", String(stat.size));

  if (req.method === "HEAD") return res.status(200).end("");

  try {
    const body = fs.readFileSync(asset.path);
    return res.status(200).end(body);
  } catch {
    return res.status(503).json({ ok: false, error: "gift_unavailable" });
  }
}
