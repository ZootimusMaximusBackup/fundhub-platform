import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { encryptToken } from "../adplatforms/tokens.mjs";
import { refreshAccessToken, listChannelVideos, fetchVideoStats } from "./youtube.mjs";

const env = { AD_TOKEN_ENC_KEY: crypto.randomBytes(32).toString("base64") };
const ORG_ID = "11111111-1111-4111-8111-111111111111";

function connectionFor(creds) {
  return {
    org_id: ORG_ID,
    encrypted_credentials: encryptToken(JSON.stringify(creds), { partnerId: ORG_ID, env })
  };
}

/* mockFetch — same shape as src/company-brain/sync.test.mjs's helper: a list
   of {match(url, init), body, status} routes, first match wins. */
function mockFetch(routes) {
  return async (url, init = {}) => {
    const u = String(url);
    const hit = routes.find((r) => r.match(u, init));
    if (!hit) throw new Error(`unexpected fetch: ${u}`);
    const body = typeof hit.body === "function" ? hit.body(u, init) : hit.body;
    const status = hit.status || 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      async text() { return typeof body === "string" ? body : JSON.stringify(body); }
    };
  };
}

const CREDS = { client_id: "cid", client_secret: "csecret", refresh_token: "rtoken" };

test("refreshAccessToken exchanges the refresh token for an access token", async () => {
  const conn = connectionFor(CREDS);
  const fetch = mockFetch([
    {
      match: (u, init) => u === "https://oauth2.googleapis.com/token" && init.method === "POST",
      body: { access_token: "ya29.fresh", expires_in: 3600 }
    }
  ]);
  const out = await refreshAccessToken(conn, { fetch, env });
  assert.equal(out.access_token, "ya29.fresh");
  assert.equal(out.expires_in, 3600);
});

test("refreshAccessToken throws Google's real message on invalid_grant, tagged with code", async () => {
  const conn = connectionFor(CREDS);
  const fetch = mockFetch([
    {
      match: (u) => u === "https://oauth2.googleapis.com/token",
      status: 400,
      body: { error: "invalid_grant", error_description: "Token has been expired or revoked." }
    }
  ]);
  await assert.rejects(
    () => refreshAccessToken(conn, { fetch, env }),
    (err) => {
      assert.equal(err.code, "invalid_grant");
      assert.match(err.message, /invalid_grant/);
      assert.match(err.message, /Token has been expired or revoked\./);
      return true;
    }
  );
});

test("listChannelVideos walks the uploads playlist, paginated", async () => {
  const conn = connectionFor(CREDS);
  const fetch = mockFetch([
    {
      match: (u) => u.startsWith("https://www.googleapis.com/youtube/v3/channels"),
      body: { items: [{ id: "UC_channel", contentDetails: { relatedPlaylists: { uploads: "UU_uploads" } } }] }
    },
    {
      match: (u) => u.includes("playlistItems") && !u.includes("pageToken"),
      body: {
        items: [
          { snippet: { resourceId: { videoId: "vid1" }, title: "First video", publishedAt: "2026-01-01T00:00:00Z" } }
        ],
        nextPageToken: "page2"
      }
    },
    {
      match: (u) => u.includes("playlistItems") && u.includes("pageToken=page2"),
      body: {
        items: [
          { snippet: { resourceId: { videoId: "vid2" }, title: "Second video", publishedAt: "2026-02-01T00:00:00Z" } }
        ]
        // no nextPageToken: last page
      }
    }
  ]);

  const videos = await listChannelVideos(conn, "ya29.fresh", { fetch });
  assert.deepEqual(videos, [
    { id: "vid1", title: "First video", published_at: "2026-01-01T00:00:00Z" },
    { id: "vid2", title: "Second video", published_at: "2026-02-01T00:00:00Z" }
  ]);
});

test("fetchVideoStats maps dimensions=video rows in metrics order, absent video gets no row", async () => {
  const conn = connectionFor(CREDS);
  const fetch = mockFetch([
    {
      match: (u) => u.startsWith("https://youtubeanalytics.googleapis.com/v2/reports"),
      body: {
        columnHeaders: [
          { name: "video" }, { name: "views" }, { name: "estimatedMinutesWatched" },
          { name: "averageViewDuration" }, { name: "averageViewPercentage" }
        ],
        rows: [
          ["vid1", 1000, 543.2, 32.5, 61.4]
          // vid2 has zero rows in the window — simply absent, no synthesized 0
        ]
      }
    }
  ]);

  const stats = await fetchVideoStats(conn, "ya29.fresh", ["vid1", "vid2"], { from: "2026-08-01", to: "2026-08-31" }, { fetch });
  assert.deepEqual(stats, [
    { video_id: "vid1", views: 1000, estimated_minutes_watched: 543.2, average_view_duration_sec: 32.5, average_view_percentage: 61.4 }
  ]);
  assert.equal(stats.some((s) => s.video_id === "vid2"), false);
});

test("fetchVideoStats surfaces the Analytics API's own error message", async () => {
  const conn = connectionFor(CREDS);
  const fetch = mockFetch([
    {
      match: (u) => u.startsWith("https://youtubeanalytics.googleapis.com/v2/reports"),
      status: 403,
      body: { error: { code: 403, message: "The user does not have permission to access this channel.", status: "PERMISSION_DENIED" } }
    }
  ]);
  await assert.rejects(
    () => fetchVideoStats(conn, "ya29.fresh", ["vid1"], { from: "2026-08-01", to: "2026-08-31" }, { fetch }),
    (err) => {
      assert.equal(err.code, "PERMISSION_DENIED");
      assert.match(err.message, /The user does not have permission to access this channel\./);
      return true;
    }
  );
});
