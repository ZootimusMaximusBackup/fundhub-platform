// POST /api/analytics/youtube-connect
//
// Body: { client_id, client_secret, refresh_token } — the three fields Chris
// pastes once, from an OAuth client he made in Google Cloud Console and a
// refresh token he generated against his own channel in Google's OAuth
// Playground. See src/analytics/youtube.mjs's header for the verified API
// shape this talks to.
//
// VALIDATES BEFORE SAVING. refreshAccessToken and listChannelVideos both run
// once against the real credentials before anything touches the database —
// on either failure, nothing is saved and Google's own error message is
// returned so Chris knows exactly what to fix. This is the same "verify then
// persist" order api/campaigns/connections write-side callers already use for
// ad platform tokens.
//
// STAFF ONLY, ORG-WIDE. This is Chris's own channel, not a partner's — no
// partner_id anywhere in this file. See db/migrations/302_analytics_connections.sql.
//
// asStaff(), NOT a bare db.query. analytics_connections has row-level
// security keyed on fundhub_is_staff() (302), and a raw pooled connection is
// anonymous to that policy — an unscoped write is denied, not "written as
// staff". src/creative/runner.mjs (fixed today, 2026-09-07) is the exact bug
// this avoids: a query that forgot to stamp fundhub.actor='staff' silently
// saw/wrote nothing and reported success.
//
// NEVER RETURNS THE CREDENTIALS. The response carries only
// {id, external_account_id, connection_state}.

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid } from "../../src/http/read-api.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import { encryptToken } from "../../src/adplatforms/tokens.mjs";
import { asStaff } from "../../src/partners/rls.mjs";
import { refreshAccessToken, listChannelVideos } from "../../src/analytics/youtube.mjs";

/* fetchChannelId — GET channels?part=id&mine=true. A separate call from
   listChannelVideos's channels?part=contentDetails&mine=true per the
   contract, kept local to this endpoint since it exists only to fill
   external_account_id on connect, not as a reusable adapter function. */
async function fetchChannelId(accessToken, ctx = {}) {
  const fetchFn = ctx.fetch || globalThis.fetch;
  if (typeof fetchFn !== "function") throw new Error("no fetch available");

  const res = await fetchFn("https://www.googleapis.com/youtube/v3/channels?part=id&mine=true", {
    method: "GET",
    headers: { authorization: `Bearer ${accessToken}` }
  });
  const text = await res.text().catch(() => "");
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : {}; } catch { /* keep parsed null */ }

  if (!res.ok) {
    const message = parsed?.error?.message || String(text || "unknown YouTube API error").slice(0, 1000);
    const e = new Error(`YouTube API error (${res.status}): ${message}`);
    e.platformMessage = message;
    throw e;
  }
  return parsed?.items?.[0]?.id || null;
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
  const client_id = String(body.client_id || "").trim();
  const client_secret = String(body.client_secret || "").trim();
  const refresh_token = String(body.refresh_token || "").trim();
  if (!client_id || !client_secret || !refresh_token) {
    return res.status(400).json({
      ok: false,
      error: "missing_fields",
      message: "client_id, client_secret, and refresh_token are all required"
    });
  }

  let encrypted;
  try {
    encrypted = encryptToken(JSON.stringify({ client_id, client_secret, refresh_token }), { partnerId: orgId });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "encryption_unavailable", message: String(e.message || e) });
  }

  // A probe object shaped like a connection row, so refreshAccessToken /
  // listChannelVideos run exactly the code path a real sync will use — never
  // a separate "validate" path that could drift from the real one.
  const probe = { org_id: orgId, encrypted_credentials: encrypted };

  let accessToken;
  let channelId;
  try {
    const token = await refreshAccessToken(probe, deps);
    accessToken = token.access_token;
    await listChannelVideos(probe, accessToken, deps);
    channelId = await fetchChannelId(accessToken, deps);
  } catch (e) {
    // Refuse with Google's real words. Nothing is saved past this point.
    return res.status(400).json({
      ok: false,
      error: "youtube_validation_failed",
      message: e.platformMessage || String(e.message || e)
    });
  }

  try {
    const row = await asStaff((tx) => tx.query(
      `INSERT INTO analytics_connections (org_id, platform, external_account_id, encrypted_credentials, connection_state, last_error)
       VALUES ($1, 'youtube', $2, $3, 'active', NULL)
       ON CONFLICT (org_id, platform) DO UPDATE SET
         external_account_id = EXCLUDED.external_account_id,
         encrypted_credentials = EXCLUDED.encrypted_credentials,
         connection_state = 'active',
         last_error = NULL,
         updated_at = now()
       RETURNING id, external_account_id, connection_state`,
      [orgId, channelId, encrypted]
    ).then((r) => r.rows[0]));

    return res.status(200).json({ ok: true, connection: row });
  } catch (e) {
    if (dbDown(res, e)) return;
    throw e;
  }
}
