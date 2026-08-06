"use strict";

/**
 * GET /api/health
 *
 * Lightweight liveness probe. Returns 200 so the UnderwriteIQ system
 * health-monitor (which pings this path every 5 min) can confirm IRA is up.
 * No auth (a liveness probe must be reachable) and — deliberately — NO config
 * detail: an unauthenticated probe must not disclose which env/integrations are
 * present, only that the service is alive.
 */

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  return res.status(200).json({
    ok: true,
    service: "inquiry-removal-ai",
    timestamp: new Date().toISOString()
  });
};
