// YouTube adapter — OAuth refresh, video list, watch-time stats.
//
// REAL API SHAPE (verified against Google's own docs 2026-09-07, not derived
// from memory — see the contract this module was built against):
//
//   Token refresh:  POST https://oauth2.googleapis.com/token, form-encoded
//                   {client_id, client_secret, refresh_token,
//                    grant_type:"refresh_token"} -> {access_token, expires_in}
//   Video list:     GET .../youtube/v3/channels?part=contentDetails&mine=true
//                   to get the uploads playlist id, then
//                   GET .../youtube/v3/playlistItems?part=snippet&playlistId=...
//                   paginated with pageToken.
//   Watch stats:    GET https://youtubeanalytics.googleapis.com/v2/reports
//                   ?ids=channel==MINE&startDate=&endDate=
//                   &metrics=views,estimatedMinutesWatched,averageViewDuration,
//                            averageViewPercentage
//                   &dimensions=video&sort=-views&maxResults=50
//                   dimensions=video means row[0] is the video id, and the
//                   remaining columns follow the `metrics` order requested.
//
// TWO DIFFERENT ERROR ENVELOPES. The OAuth token endpoint uses the plain
// OAuth2 shape ({error: "invalid_grant", error_description: "..."}). The
// Data API and Analytics API use Google's API-wide shape
// ({error: {code, message, status}}). Both are unwrapped here so the caller
// always gets Google's own words in the thrown Error's message, never a
// generic "request failed" — CLAUDE.md's rule for platform adapters
// (src/adplatforms/_api.mjs does the same for Meta/TikTok).
//
// NO CREDENTIAL EVER LOGGED OR THROWN INTO AN ERROR MESSAGE. The access
// token is sent only as a bearer header; nothing here interpolates it into a
// message string.
//
// NOTE ON fetchVideoStats(..., videoIds, ...): the contract's verified
// Analytics endpoint has no per-video filter — dimensions=video with
// maxResults=50 sorted by views already scopes the response to (up to) the
// channel's 50 most-viewed videos in the window. `videoIds` is accepted for
// signature parity with the contract and is NOT applied as a request filter,
// because the contract's URL does not include one. A channel with more than
// 50 videos active in a window will not get every video's stats from a
// single call — flagged in this session's report, not silently worked around.

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const YT_DATA_BASE = "https://www.googleapis.com/youtube/v3";
const YT_ANALYTICS_BASE = "https://youtubeanalytics.googleapis.com/v2/reports";

// Hard cap on playlistItems pages, so a pagination loop can never run away
// forever on an unexpected `nextPageToken` cycle. 40 pages * 50 = 2000 videos,
// comfortably above any real channel this product talks to.
const MAX_PLAYLIST_PAGES = 40;

import { decryptToken } from "../adplatforms/tokens.mjs";

function doFetch(ctx) {
  const f = ctx.fetch || globalThis.fetch;
  if (typeof f !== "function") throw new Error("no fetch available");
  return f;
}

/* googleApiError — Data API / Analytics API error envelope:
   {"error": {"code": 403, "message": "...", "status": "PERMISSION_DENIED"}} */
function googleApiError(status, parsed, rawText) {
  const message = parsed?.error?.message || String(rawText || "unknown Google API error").slice(0, 1000);
  const e = new Error(`YouTube API error (${status}): ${message}`);
  e.platformMessage = message;
  e.code = parsed?.error?.status || String(parsed?.error?.code ?? status);
  e.status = status;
  return e;
}

/* googleOAuthError — token endpoint's plain OAuth2 envelope:
   {"error": "invalid_grant", "error_description": "..."} */
function googleOAuthError(status, parsed, rawText) {
  const code = parsed?.error || `http_${status}`;
  const description = parsed?.error_description || String(rawText || "unknown OAuth error").slice(0, 1000);
  const e = new Error(`Google OAuth token refresh failed: ${code} — ${description}`);
  e.platformMessage = description;
  e.code = code;
  e.status = status;
  return e;
}

async function parseBody(res) {
  const text = await res.text().catch(() => "");
  try { return { parsed: text ? JSON.parse(text) : {}, rawText: text }; }
  catch { return { parsed: null, rawText: text }; }
}

/* refreshAccessToken(connection, ctx) → { access_token, expires_in }

   Decrypts connection.encrypted_credentials ({client_id, client_secret,
   refresh_token}) and exchanges the refresh token for a fresh access token.
   Throws with Google's real error on failure — an `invalid_grant` means the
   refresh token was revoked, and the thrown Error carries code:"invalid_grant"
   so a caller (the sync endpoint) can distinguish that from a generic error. */
export async function refreshAccessToken(connection, ctx = {}) {
  const raw = decryptToken(connection.encrypted_credentials, { partnerId: connection.org_id, env: ctx.env });
  if (!raw) throw new Error("connection has no stored credentials");
  const creds = JSON.parse(raw);
  if (!creds.client_id || !creds.client_secret || !creds.refresh_token) {
    throw new Error("stored YouTube credentials are missing client_id, client_secret, or refresh_token");
  }

  const body = new URLSearchParams({
    client_id: creds.client_id,
    client_secret: creds.client_secret,
    refresh_token: creds.refresh_token,
    grant_type: "refresh_token"
  });

  const fetchFn = doFetch(ctx);
  let res;
  try {
    res = await fetchFn(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });
  } catch (err) {
    const e = new Error(`Google OAuth token endpoint unreachable: ${String(err?.message || err)}`);
    e.retryable = true;
    throw e;
  }

  const { parsed, rawText } = await parseBody(res);
  if (!res.ok) throw googleOAuthError(res.status, parsed, rawText);
  if (!parsed?.access_token) throw new Error("Google OAuth token refresh returned no access_token");

  return { access_token: parsed.access_token, expires_in: parsed.expires_in ?? null };
}

async function googleGet(url, accessToken, ctx) {
  const fetchFn = doFetch(ctx);
  let res;
  try {
    res = await fetchFn(url, { method: "GET", headers: { authorization: `Bearer ${accessToken}` } });
  } catch (err) {
    const e = new Error(`YouTube API unreachable: ${String(err?.message || err)}`);
    e.retryable = true;
    throw e;
  }
  const { parsed, rawText } = await parseBody(res);
  if (!res.ok) throw googleApiError(res.status, parsed, rawText);
  return parsed ?? {};
}

/* listChannelVideos(connection, accessToken, ctx) → [{id, title, published_at}]

   channels?part=contentDetails&mine=true resolves the uploads playlist, then
   playlistItems walks it, paginated with pageToken, up to MAX_PLAYLIST_PAGES. */
export async function listChannelVideos(connection, accessToken, ctx = {}) {
  const chRes = await googleGet(`${YT_DATA_BASE}/channels?part=contentDetails&mine=true`, accessToken, ctx);
  const uploadsPlaylistId = chRes?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsPlaylistId) {
    throw new Error("YouTube channels.list returned no uploads playlist — the token may not belong to a channel");
  }

  const videos = [];
  let pageToken;
  let pages = 0;
  do {
    const qs = new URLSearchParams({
      part: "snippet",
      playlistId: uploadsPlaylistId,
      maxResults: "50"
    });
    if (pageToken) qs.set("pageToken", pageToken);

    const page = await googleGet(`${YT_DATA_BASE}/playlistItems?${qs}`, accessToken, ctx);
    for (const item of page?.items || []) {
      const videoId = item?.snippet?.resourceId?.videoId;
      if (!videoId) continue;
      videos.push({
        id: videoId,
        title: item.snippet.title ?? null,
        published_at: item.snippet.publishedAt ?? null
      });
    }
    pageToken = page?.nextPageToken || null;
    pages += 1;
  } while (pageToken && pages < MAX_PLAYLIST_PAGES);

  return videos;
}

/* fetchVideoStats(connection, accessToken, videoIds, {from, to}, ctx)
   → [{video_id, views, estimated_minutes_watched, average_view_duration_sec,
       average_view_percentage}]

   A video with zero rows in the response window is simply absent from the
   returned array — never synthesized as a zero. See this module's header for
   why `videoIds` is accepted but not applied as a request filter. */
export async function fetchVideoStats(connection, accessToken, videoIds, { from, to } = {}, ctx = {}) {
  if (!from || !to) throw new Error("fetchVideoStats: from and to are required");

  const metrics = "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage";
  const qs = new URLSearchParams({
    ids: "channel==MINE",
    startDate: from,
    endDate: to,
    metrics,
    dimensions: "video",
    sort: "-views",
    maxResults: "50"
  });

  const report = await googleGet(`${YT_ANALYTICS_BASE}?${qs}`, accessToken, ctx);
  const rows = Array.isArray(report?.rows) ? report.rows : [];

  // dimensions=video puts the video id in column 0; the remaining columns
  // follow `metrics`'s order exactly, per Google's own documented contract
  // for this endpoint (dimension columns first, then metric columns in the
  // order requested).
  return rows.map((row) => ({
    video_id: row[0],
    views: numOrNull(row[1]),
    estimated_minutes_watched: numOrNull(row[2]),
    average_view_duration_sec: numOrNull(row[3]),
    average_view_percentage: numOrNull(row[4])
  }));
}

function numOrNull(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export default { refreshAccessToken, listChannelVideos, fetchVideoStats };
