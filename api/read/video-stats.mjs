// GET /api/read/video-stats — YouTube watch-time rows for the org's connected
// channel, plus the connection's own health.
//
//   ?limit=  — bounded, same rule as read-api.mjs's pageParams (default 200,
//              cap MAX_LIMIT). video_watch_stats grows one row per video per
//              sync day, so this is not optional the way it is on a small
//              rollup like ad-books.
//
// Sorted by stat_date desc, then views desc with NULLs last — most recent
// snapshot first, best-performing video first within a date.
//
// Same auth shape as api/read/ad-books.mjs: requireAuth then
// requireRole(STAFF). Org-wide, staff-only, no partner concept — matching
// db/migrations/302_analytics_connections.sql's RLS.
//
// asStaff() for the query, because both tables read here carry
// fundhub_is_staff()-only row-level security (302) — a bare db.query is
// anonymous to that policy and would silently return zero rows rather than
// erroring, which is worse than a crash because it looks like "no data yet".

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid, boundedLimit, MAX_LIMIT } from "../../src/http/read-api.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import { asStaff } from "../../src/partners/rls.mjs";

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;

  if (req.method && req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await requireAuth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.STAFF)) return;

  const orgId = staff.org_id;
  if (!isUuid(orgId)) return res.status(403).json({ ok: false, error: "forbidden" });

  const limit = boundedLimit(req.query?.limit, { fallback: MAX_LIMIT, cap: MAX_LIMIT });

  try {
    const { videos, connection } = await asStaff(async (tx) => {
      const conn = await tx.query(
        `SELECT connection_state, last_synced_at, last_error
           FROM analytics_connections
          WHERE org_id = $1 AND platform = 'youtube'`,
        [orgId]
      ).then((r) => r.rows[0] || null);

      const rows = await tx.query(
        `SELECT vws.video_title, vws.stat_date, vws.views,
                vws.estimated_minutes_watched, vws.average_view_duration_sec,
                vws.average_view_percentage
           FROM video_watch_stats vws
           JOIN analytics_connections c ON c.id = vws.connection_id
          WHERE vws.org_id = $1 AND c.platform = 'youtube'
          ORDER BY vws.stat_date DESC, vws.views DESC NULLS LAST
          LIMIT $2`,
        [orgId, limit]
      ).then((r) => r.rows);

      return { videos: rows, connection: conn };
    });

    return res.status(200).json({
      ok: true,
      videos,
      connection: connection
        ? {
            state: connection.connection_state,
            last_synced_at: connection.last_synced_at,
            last_error: connection.last_error
          }
        : null
    });
  } catch (e) {
    if (dbDown(res, e)) return;
    throw e;
  }
}
