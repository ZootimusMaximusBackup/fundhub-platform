// GET /api/read/funnel-pages — ClickFunnels page performance for the org.
//
// Staff only, ROLE_SETS.STAFF, matching api/read/ad-books.mjs's exact shape:
// requireAuth then requireRole, no partner branch (analytics_connections and
// funnel_page_stats are org-wide, per 302's own header).
//
// RLS on both tables is FORCE + staff-only (fundhub_is_staff()), so every read
// here goes through asStaff() — a bare db.query would see zero rows, not an
// error, which is a worse bug than a crash because it looks like "no data yet".

import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid } from "../../src/http/read-api.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import { asStaff } from "../../src/partners/rls.mjs";

export default async function handler(req, res) {
  if (req.method && req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await requireAuth(req, res);
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.STAFF)) return;

  const orgId = staff.org_id;
  if (!isUuid(orgId)) return res.status(403).json({ ok: false, error: "forbidden" });

  try {
    const { pages, connection } = await asStaff(async (tx) => {
      const pagesRes = await tx.query(
        `SELECT funnel_name, page_name, stat_date, views, conversions
           FROM funnel_page_stats
          WHERE org_id = $1
          ORDER BY stat_date DESC, views DESC NULLS LAST`,
        [orgId]
      );
      const connRes = await tx.query(
        `SELECT connection_state AS state, last_synced_at, last_error
           FROM analytics_connections
          WHERE org_id = $1 AND platform = 'clickfunnels'`,
        [orgId]
      );
      return { pages: pagesRes.rows, connection: connRes.rows[0] || null };
    });

    return res.status(200).json({ ok: true, pages, connection });
  } catch (err) {
    if (dbDown(res, err)) return;
    throw err;
  }
}
