// GET /api/auth/session — who am I. 200 { ok, staff } or 401.
// The screens call this on load to gate themselves and render role-aware nav.

import { db } from "../../src/db.mjs";
import { attachStaff } from "../../src/http/middleware/requireAuth.mjs";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  const staff = await attachStaff(req, { db });
  if (!staff) return res.status(401).json({ ok: false, error: "unauthorized" });
  return res.status(200).json({ ok: true, staff });
}
