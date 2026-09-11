// POST /api/analytics/youtube-sync
//
// Body: { days } — optional, default 30. Pulls the org's YouTube connection,
// refreshes its access token, lists channel videos, and fetches watch stats
// for the last `days` days, then upserts video_watch_stats.
//
// ONE ROW PER VIDEO PER SYNC DAY, NOT PER CALENDAR DAY OF VIEWS. The verified
// Analytics endpoint this reads from (src/analytics/youtube.mjs) has no day
// dimension — dimensions=video returns one aggregate row per video for the
// whole [from, to] window, not a per-day breakdown. So each row this writes
// is a snapshot: "as of today (stat_date), this video's stats over the last
// `days` days were X." Running this daily builds a rolling-window trend line
// over time, the same way funnel_page_stats accumulates one row per page per
// day. FLAGGED: this is this session's own resolution of a gap the contract
// left open (the contract specifies the aggregate endpoint but the schema
// wants a date-keyed row) — not a literal instruction, so it is worth Chris
// confirming this is the shape he wants before this runs on a schedule.
//
// NO FAKE ZEROS. A video absent from the stats response for this window gets
// no row written for stat_date — never a written 0. video_watch_stats already
// enforces this at the schema-comment level (302); this endpoint is where
// that rule is actually kept.
//
// connection_state ON FAILURE: 'expired' specifically for refreshAccessToken
// failing with invalid_grant (the refresh token was revoked — the fix is
// "reconnect", which is a different, actionable thing from a generic error).
// Anything else that fails the sync — listChannelVideos, fetchVideoStats,
// network — sets 'error'.
//
// asStaff() for every query against these RLS-staff-only tables. See
// youtube-connect.mjs's header for why a bare db.query is not enough.

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid } from "../../src/http/read-api.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import { asStaff } from "../../src/partners/rls.mjs";
import { refreshAccessToken, listChannelVideos, fetchVideoStats } from "../../src/analytics/youtube.mjs";

const isoDate = (d) => d.toISOString().slice(0, 10);

async function markConnectionFailed(connectionId, { state, message }) {
  await asStaff((tx) => tx.query(
    `UPDATE analytics_connections
        SET connection_state = $2, last_error = $3, updated_at = now()
      WHERE id = $1`,
    [connectionId, state, String(message || "").slice(0, 1000)]
  )).catch(() => null); // best-effort: the sync's own error response is what matters most
}

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;

  if (req.method && req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await requireAuth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.STAFF)) return;

  const orgId = staff.org_id;
  if (!isUuid(orgId)) return res.status(403).json({ ok: false, error: "forbidden" });

  const body = req.body || {};
  const rawDays = parseInt(body.days ?? "30", 10);
  const days = Number.isFinite(rawDays) && rawDays > 0 ? Math.min(rawDays, 365) : 30;

  let connection;
  try {
    connection = await asStaff((tx) => tx.query(
      `SELECT * FROM analytics_connections WHERE org_id = $1 AND platform = 'youtube'`,
      [orgId]
    ).then((r) => r.rows[0]));
  } catch (e) {
    if (dbDown(res, e)) return;
    throw e;
  }

  if (!connection) {
    return res.status(404).json({ ok: false, error: "not_connected", message: "no YouTube connection for this org" });
  }

  const to = new Date();
  const from = new Date(to.getTime() - days * 86400000);
  const window = { from: isoDate(from), to: isoDate(to) };

  let accessToken;
  try {
    const token = await refreshAccessToken(connection, deps);
    accessToken = token.access_token;
  } catch (e) {
    const state = e.code === "invalid_grant" ? "expired" : "error";
    await markConnectionFailed(connection.id, { state, message: e.platformMessage || e.message });
    return res.status(502).json({
      ok: false,
      error: "youtube_refresh_failed",
      connection_state: state,
      message: e.platformMessage || String(e.message || e)
    });
  }

  let videos;
  try {
    videos = await listChannelVideos(connection, accessToken, deps);
  } catch (e) {
    await markConnectionFailed(connection.id, { state: "error", message: e.platformMessage || e.message });
    return res.status(502).json({
      ok: false,
      error: "youtube_video_list_failed",
      connection_state: "error",
      message: e.platformMessage || String(e.message || e)
    });
  }

  let stats;
  try {
    stats = await fetchVideoStats(connection, accessToken, videos.map((v) => v.id), window, deps);
  } catch (e) {
    await markConnectionFailed(connection.id, { state: "error", message: e.platformMessage || e.message });
    return res.status(502).json({
      ok: false,
      error: "youtube_stats_failed",
      connection_state: "error",
      message: e.platformMessage || String(e.message || e)
    });
  }

  const titleFor = new Map(videos.map((v) => [v.id, v.title]));

  try {
    await asStaff(async (tx) => {
      for (const s of stats) {
        if (!s.video_id) continue; // never write a row with no video to key on
        await tx.query(
          `INSERT INTO video_watch_stats (
             org_id, connection_id, youtube_video_id, video_title, stat_date,
             views, estimated_minutes_watched, average_view_duration_sec, average_view_percentage
           ) VALUES ($1,$2,$3,$4,$5::date,$6,$7,$8,$9)
           ON CONFLICT (connection_id, youtube_video_id, stat_date) DO UPDATE SET
             video_title = EXCLUDED.video_title,
             views = EXCLUDED.views,
             estimated_minutes_watched = EXCLUDED.estimated_minutes_watched,
             average_view_duration_sec = EXCLUDED.average_view_duration_sec,
             average_view_percentage = EXCLUDED.average_view_percentage,
             captured_at = now()`,
          [
            orgId, connection.id, s.video_id, titleFor.get(s.video_id) ?? null, window.to,
            s.views, s.estimated_minutes_watched, s.average_view_duration_sec, s.average_view_percentage
          ]
        );
      }

      await tx.query(
        `UPDATE analytics_connections
            SET last_synced_at = now(), last_error = NULL, connection_state = 'active', updated_at = now()
          WHERE id = $1`,
        [connection.id]
      );
    });
  } catch (e) {
    if (dbDown(res, e)) return;
    throw e;
  }

  return res.status(200).json({ ok: true, videos_synced: stats.length });
}
