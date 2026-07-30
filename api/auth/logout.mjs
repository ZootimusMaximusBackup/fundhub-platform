// POST /api/auth/logout — revoke the presented session, clear the cookie.
// Always 200: logging out of a dead session is a success, not an error.

import { db } from "../../src/db.mjs";
import { bearerToken } from "../../src/http/middleware/requireAuth.mjs";
import { revokeSession } from "../../src/auth/session.mjs";
import { revokeAccountSession } from "../../src/auth/account-session.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  const token = bearerToken(req);
  if (token) {
    /* BOTH session stores. This revoked only the staff `sessions` table, so a
       client, affiliate or partner got ok:true and a cleared cookie while their
       row in `account_sessions` stayed live until it expired — logging out did
       not actually log them out, and a stolen token kept working.

       The token is opaque, so which store it belongs to is unknown here; try
       each. Revoking is idempotent and a miss is a no-op, so attempting both is
       correct rather than wasteful. */
    try { await revokeSession(db, token); } catch { /* dead session = fine */ }
    try { await revokeAccountSession(db, token); } catch { /* ditto */ }
  }
  res.setHeader("Set-Cookie", "fundhub_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
  return res.status(200).json({ ok: true });
}
