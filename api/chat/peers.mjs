// GET /api/chat/peers — staff directory for internal chat (any staff role).
// Narrower than /api/read/staff (which is FINANCE-only).

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole } from "../../src/http/read-api.mjs";
import { safeError } from "../../src/http/health.mjs";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  const staff = await requireAuth(req, res, { db });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.STAFF)) return;
  if (!staff.org_id) return res.status(403).json({ ok: false, error: "no_org_scope" });

  try {
    const r = await db.query(
      `SELECT id, name, email, role
         FROM staff
        WHERE org_id = $1
          AND status = 'active'
          AND id <> $2
          AND COALESCE(is_demo, false) = false
        ORDER BY name ASC
        LIMIT 200`,
      [staff.org_id, staff.id]
    );
    return res.status(200).json({ ok: true, staff: r.rows });
  } catch (err) {
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}
