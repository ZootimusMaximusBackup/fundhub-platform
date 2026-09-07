// POST /api/analytics/clickfunnels-sync — pull funnels, pages and page stats
// from ClickFunnels and mirror them into funnel_page_stats.
//
//   body: { days?: number }   — lookback window, default 7, capped at 90 (the
//                                stats endpoint itself clamps to 90 days).
//
// STAFF ONLY, ORG-WIDE. Same posture as clickfunnels-connect.mjs.
//
// ONE ROW PER PAGE PER SYNC RUN, NOT PER DAY. funnel_page_stats is shaped
// "one row per page per day" (302's own comment), but ClickFunnels' page-stats
// endpoint returns ONE aggregate for whatever timerange you give it — it does
// not hand back a daily breakdown. Calling it once per day in the window would
// multiply this run's ClickFunnels API calls by the window length for no real
// gain, so this endpoint calls fetchPageStats() ONCE per page for the whole
// {from, to} window and stamps the row with stat_date = today (the date this
// sync ran), holding the trailing-N-day aggregate as of right now. Re-running
// the sync the same day upserts (overwrites) today's row with fresh numbers;
// distinct days build a real trend line only across distinct sync runs. This
// is a deliberate reading of "fetchPageStats per page for the window" in the
// build spec, flagged here because the alternative (N calls per page) is also
// defensible and nothing in the spec settles it either way.
//
// NEVER A FAKE ZERO. views/conversions are NULL whenever fetchPageStats
// returned {available:false} — the CLAUDE.md §12 rule for money applies here
// for the identical reason: "we don't know" and "really zero" must never look
// the same on a screen.
//
// ONE TRANSACTION, NO PARTIAL ROLLBACK ON A PLATFORM ERROR. A ClickFunnels
// failure partway through (listFunnels/listPages/fetchPageStats throwing a
// real error, not the handled available:false case) is caught INSIDE the
// asStaff() callback rather than left to propagate — propagating it would roll
// back the whole transaction, including the connection_state='error' row and
// every page already synced this run. Catching it here means both the partial
// progress and the honest error state commit together.

import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid } from "../../src/http/read-api.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import { asStaff } from "../../src/partners/rls.mjs";
import { listFunnels, listPages, fetchPageStats } from "../../src/analytics/clickfunnels.mjs";

const DEFAULT_DAYS = 7;
const MAX_DAYS = 90; // ClickFunnels itself clamps a timerange to 90 days

export default async function handler(req, res, deps = {}) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await requireAuth(req, res, deps);
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.STAFF)) return;

  const orgId = staff.org_id;
  if (!isUuid(orgId)) return res.status(403).json({ ok: false, error: "forbidden" });

  const daysRaw = Number((req.body || {}).days);
  const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(Math.floor(daysRaw), MAX_DAYS) : DEFAULT_DAYS;
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  const statDate = to.toISOString().slice(0, 10);

  try {
    const result = await asStaff(async (tx) => {
      const connRow = (await tx.query(
        `SELECT * FROM analytics_connections WHERE org_id = $1 AND platform = 'clickfunnels'`,
        [orgId]
      )).rows[0];
      if (!connRow) return { notFound: true };

      const ctx = { fetch: deps.fetch }; // shared across every call this run, so resolveWorkspaceId caches once
      let pagesSynced = 0;
      let statsAttempted = false;
      let statsAvailable = false;

      try {
        const funnels = await listFunnels(connRow, ctx);

        for (const funnel of funnels) {
          const pages = await listPages(connRow, funnel.id, ctx);

          for (const page of pages) {
            const stats = await fetchPageStats(
              connRow, page.id, { from: from.toISOString(), to: to.toISOString() }, ctx
            );
            statsAttempted = true;
            if (stats.available) statsAvailable = true;

            await tx.query(
              `INSERT INTO funnel_page_stats
                 (org_id, connection_id, clickfunnels_funnel_id, clickfunnels_page_id,
                  funnel_name, page_name, stat_date, views, conversions)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
               ON CONFLICT (connection_id, clickfunnels_page_id, stat_date) DO UPDATE SET
                 funnel_name = EXCLUDED.funnel_name,
                 page_name   = EXCLUDED.page_name,
                 views       = EXCLUDED.views,
                 conversions = EXCLUDED.conversions,
                 captured_at = now()`,
              [
                orgId, connRow.id, String(funnel.id), String(page.id),
                funnel.name, page.name, statDate,
                stats.available ? stats.views : null,
                stats.available ? stats.conversions : null
              ]
            );
            pagesSynced++;
          }
        }

        await tx.query(
          `UPDATE analytics_connections
              SET last_synced_at = now(), last_error = NULL, connection_state = 'active', updated_at = now()
            WHERE id = $1`,
          [connRow.id]
        );

        return { ok: true, pagesSynced, statsAvailable: statsAttempted ? statsAvailable : false };
      } catch (err) {
        // The call itself failed (auth, network, rate limit, 5xx) — this is a
        // connection error, distinct from "stats unavailable for this page".
        const message = String(err.platformMessage || err.message || "sync failed").slice(0, 2000);
        await tx.query(
          `UPDATE analytics_connections
              SET connection_state = 'error', last_error = $2, updated_at = now()
            WHERE id = $1`,
          [connRow.id, message]
        );
        return { ok: false, pagesSynced, message };
      }
    });

    if (result.notFound) {
      return res.status(404).json({
        ok: false,
        error: "no_connection",
        message: "no ClickFunnels connection — connect one first"
      });
    }
    if (!result.ok) {
      return res.status(502).json({
        ok: false,
        error: "sync_failed",
        message: result.message,
        pages_synced: result.pagesSynced
      });
    }
    return res.status(200).json({ ok: true, pages_synced: result.pagesSynced, stats_available: result.statsAvailable });
  } catch (err) {
    if (dbDown(res, err)) return;
    throw err;
  }
}
