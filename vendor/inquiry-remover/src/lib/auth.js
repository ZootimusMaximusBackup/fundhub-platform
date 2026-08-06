"use strict";

/**
 * Shared API authentication helper.
 * Checks Authorization: Bearer <API_SECRET> header.
 * Returns true if authenticated, false if not (and sends 401 response).
 */
function requireAuth(req, res) {
  const secret = process.env.API_SECRET;
  if (!secret) {
    console.error("[auth] API_SECRET env var not set — rejecting request");
    res.status(500).json({ error: "Server misconfigured" });
    return false;
  }

  const header = (req.headers.authorization || "").trim();
  if (!header || header !== `Bearer ${secret.trim()}`) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }

  return true;
}

module.exports = { requireAuth };
