// POST /api/auth/logout — revoke the presented session, clear the cookie.
// Always 200: logging out of a dead session is a success, not an error.

import { db } from "../../src/db.mjs";
import { bearerToken } from "../../src/http/middleware/requireAuth.mjs";
import { revokeSession } from "../../src/auth/session.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  const token = bearerToken(req);
  if (token) {
    try { await revokeSession(db, token); } catch { /* dead session = fine */ }
  }
  res.setHeader("Set-Cookie", "fundhub_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
  return res.status(200).json({ ok: true });
}
