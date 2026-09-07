/* Postgres-backed tests for the ClickFunnels analytics endpoints:
 *   POST /api/analytics/clickfunnels-connect
 *   POST /api/analytics/clickfunnels-sync
 *   GET  /api/read/funnel-pages
 *
 * WHY THESE NEED A REAL DATABASE. analytics_connections, funnel_page_stats and
 * video_watch_stats (302) are FORCE ROW LEVEL SECURITY, staff-only. A stubbed
 * db.query mock cannot prove the write actually survives that policy, or that
 * a bare (unscoped) connection sees nothing — only a real Postgres with the
 * policy installed can.
 *
 * Every ClickFunnels HTTP call is mocked (deps.fetch) — this file proves the
 * endpoints and the database, not the real ClickFunnels API. That is
 * src/analytics/clickfunnels.test.mjs's job.
 *
 * Lives under src/http/ (not api/), and named *.pg.test.mjs: package.json's
 * glob is src/** and scripts/** only, and this repo's npm test skips a
 * *.pg.test.mjs file when DATABASE_URL is unset (CLAUDE.md, traps).
 */
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { createSession } from "../auth/session.mjs";
import { decryptToken } from "../adplatforms/tokens.mjs";
import { asStaff } from "../partners/rls.mjs";
import { rlsDb } from "../testing/rls-pool.mjs";
import connectHandler from "../../api/analytics/clickfunnels-connect.mjs";
import syncHandler from "../../api/analytics/clickfunnels-sync.mjs";
import readHandler from "../../api/read/funnel-pages.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
if (!process.env.AD_TOKEN_ENC_KEY) process.env.AD_TOKEN_ENC_KEY = crypto.randomBytes(32).toString("base64");

const STAFF_EMAIL_LIKE = "cf_analytics_http_test_%@example.com";

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; return r; };
  return r;
};

/* jsonResponse — the same minimal fetch Response stand-in used in
   clickfunnels.test.mjs. */
function jsonResponse(status, body, headers = {}) {
  const lower = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    headers: { get: (k) => lower.get(String(k).toLowerCase()) ?? null }
  };
}

/* fakeClickFunnels — a working single-workspace, single-funnel, single-page
   account behind api_key "good-key" / subdomain "goodshop". Any other api_key
   is treated as invalid credentials (401), matching real ClickFunnels' own
   error envelope. */
function fakeClickFunnels({ statsStatus = 200, statsBody = null } = {}) {
  return async (url, opts) => {
    const u = new URL(String(url));
    const auth = opts?.headers?.authorization || "";
    if (auth !== "Bearer good-key") {
      return jsonResponse(401, { error: "API key missing or invalid" });
    }
    if (u.pathname.endsWith("/teams")) return jsonResponse(200, [{ id: 1, name: "Team" }]);
    if (u.pathname.endsWith("/workspaces")) return jsonResponse(200, [{ id: 10, subdomain: "goodshop" }]);
    if (u.pathname.endsWith("/funnels")) return jsonResponse(200, [{ id: 5, name: "Main Funnel" }]);
    if (u.pathname.endsWith("/pages")) return jsonResponse(200, [{ id: 100, name: "Order Page" }]);
    if (u.pathname.endsWith("/stats")) {
      if (statsBody) return jsonResponse(statsStatus, statsBody);
      return jsonResponse(200, {
        currency: "USD",
        funnel: { id: 5, name: "Main Funnel" },
        page: { id: 100, name: "Order Page" },
        step: { views_all: 42, views_unique: 40, optins: 7, name: "Order Page" },
        timerange: { from: "2026-08-01T00:00:00Z", to: "2026-09-01T00:00:00Z" }
      });
    }
    throw new Error(`fakeClickFunnels: unexpected URL ${u}`);
  };
}

describe("ClickFunnels analytics endpoints", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, owner, closer;

  const call = async (h, { method = "POST", body, query = {}, token, fetch } = {}) => {
    const r = res();
    await h(
      { method, query, body, headers: token ? { authorization: "Bearer " + token } : {} },
      r,
      fetch ? { fetch } : {}
    );
    return r;
  };

  /* staffQuery — analytics_connections and funnel_page_stats are FORCE ROW
     LEVEL SECURITY, staff-only (302). A bare db.query sees zero rows here —
     not an error, just silently empty — so every test assertion against
     these two tables (not just the endpoints under test) goes through
     asStaff() to actually stamp fundhub.actor='staff' first. */
  const staffQuery = (sql, params) => asStaff((tx) => tx.query(sql, params));

  async function purge() {
    if (org) {
      await staffQuery(`DELETE FROM funnel_page_stats WHERE org_id = $1`, [org]);
      await staffQuery(`DELETE FROM analytics_connections WHERE org_id = $1 AND platform = 'clickfunnels'`, [org]);
    }
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [STAFF_EMAIL_LIKE]);
  }

  before(async () => {
    org = await resolveDefaultOrg(db);
    await purge();

    const mkStaff = async (role, email, name) => {
      const id = (await db.query(
        `INSERT INTO staff (org_id, name, role, email, status)
         VALUES ($1,$2,$3,$4,'active') RETURNING id`, [org, name, role, email])).rows[0].id;
      return { id, token: (await createSession(db, { staffId: id, orgId: org })).token };
    };

    owner = await mkStaff("owner", "cf_analytics_http_test_owner@example.com", "CF Httptest Owner");
    // In ROLE_SETS.STAFF but with no special privilege — proves the gate is
    // "any staff", not "owner only".
    closer = await mkStaff("closer", "cf_analytics_http_test_closer@example.com", "CF Httptest Closer");
  });

  after(async () => { await purge(); await close(); });

  describe("connect — refuses before it ever saves", () => {
    test("a non-staff caller gets 401", async () => {
      const r = await call(connectHandler, { body: { api_key: "good-key", subdomain: "goodshop" } });
      assert.equal(r.code, 401);
    });

    test("bad credentials are refused with ClickFunnels' own message, and nothing is saved", async () => {
      const r = await call(connectHandler, {
        token: owner.token,
        body: { api_key: "bad-key", subdomain: "goodshop" },
        fetch: fakeClickFunnels()
      });
      assert.equal(r.code, 400);
      assert.equal(r.body.error, "clickfunnels_rejected");
      assert.match(r.body.message, /API key missing or invalid/);

      const row = (await staffQuery(
        `SELECT id FROM analytics_connections WHERE org_id = $1 AND platform = 'clickfunnels'`, [org]
      )).rows[0];
      assert.equal(row, undefined, "a refused connect must not write a row");
    });

    test("a malformed subdomain is refused before any network call", async () => {
      const r = await call(connectHandler, {
        token: owner.token,
        body: { api_key: "good-key", subdomain: "not a domain!" },
        fetch: async () => { throw new Error("should never be called"); }
      });
      assert.equal(r.code, 400);
      assert.equal(r.body.error, "subdomain_invalid");
    });
  });

  describe("connect — succeeds and stores an encrypted row", () => {
    test("good credentials save active, and the ciphertext decrypts back to the original JSON", async () => {
      const r = await call(connectHandler, {
        token: owner.token,
        body: { api_key: "good-key", subdomain: "goodshop" },
        fetch: fakeClickFunnels()
      });
      assert.equal(r.code, 200);
      assert.equal(r.body.ok, true);
      assert.equal(r.body.connection.external_account_id, "goodshop");
      assert.equal(r.body.connection.connection_state, "active");
      // NEVER the credential back, encrypted or otherwise.
      assert.equal(r.body.connection.encrypted_credentials, undefined);
      assert.equal(JSON.stringify(r.body).includes("good-key"), false);

      const row = (await staffQuery(
        `SELECT encrypted_credentials, org_id FROM analytics_connections
          WHERE org_id = $1 AND platform = 'clickfunnels'`, [org]
      )).rows[0];
      assert.ok(row, "connect must save a row");
      assert.ok(!String(row.encrypted_credentials).includes("good-key"), "ciphertext must not contain the plaintext key");

      const decrypted = JSON.parse(decryptToken(row.encrypted_credentials, { partnerId: row.org_id }));
      assert.equal(decrypted.api_key, "good-key");
      assert.equal(decrypted.subdomain, "goodshop");
    });

    test("reconnecting the same org/platform upserts rather than duplicating", async () => {
      const before2 = (await staffQuery(
        `SELECT count(*)::int AS n FROM analytics_connections WHERE org_id = $1 AND platform = 'clickfunnels'`, [org]
      )).rows[0].n;
      await call(connectHandler, {
        token: owner.token,
        body: { api_key: "good-key", subdomain: "goodshop" },
        fetch: fakeClickFunnels()
      });
      const after2 = (await staffQuery(
        `SELECT count(*)::int AS n FROM analytics_connections WHERE org_id = $1 AND platform = 'clickfunnels'`, [org]
      )).rows[0].n;
      assert.equal(after2, before2);
    });
  });

  describe("sync — upserts rows, and read returns them", () => {
    test("a full sync run writes funnel_page_stats and updates last_synced_at", async () => {
      const r = await call(syncHandler, { token: owner.token, body: {}, fetch: fakeClickFunnels() });
      assert.equal(r.code, 200);
      assert.equal(r.body.ok, true);
      assert.equal(r.body.pages_synced, 1);
      assert.equal(r.body.stats_available, true);

      const stat = (await staffQuery(
        `SELECT funnel_name, page_name, views, conversions
           FROM funnel_page_stats
          WHERE org_id = $1 AND clickfunnels_page_id = '100'`, [org]
      )).rows[0];
      assert.ok(stat);
      assert.equal(stat.funnel_name, "Main Funnel");
      assert.equal(stat.page_name, "Order Page");
      assert.equal(stat.views, 42);
      assert.equal(stat.conversions, 7);

      const conn = (await staffQuery(
        `SELECT connection_state, last_synced_at, last_error
           FROM analytics_connections WHERE org_id = $1 AND platform = 'clickfunnels'`, [org]
      )).rows[0];
      assert.equal(conn.connection_state, "active");
      assert.ok(conn.last_synced_at);
      assert.equal(conn.last_error, null);
    });

    test("a re-sync upserts the same row rather than duplicating it", async () => {
      await call(syncHandler, { token: owner.token, body: {}, fetch: fakeClickFunnels() });
      const rows = (await staffQuery(
        `SELECT count(*)::int AS n FROM funnel_page_stats WHERE org_id = $1 AND clickfunnels_page_id = '100'`, [org]
      )).rows[0].n;
      assert.equal(rows, 1);
    });

    test("stats unavailable (403, closed beta) writes NULL views/conversions, never a fake 0", async () => {
      const r = await call(syncHandler, {
        token: owner.token, body: {},
        fetch: fakeClickFunnels({ statsStatus: 403, statsBody: { error: "This feature is not available on your plan" } })
      });
      assert.equal(r.code, 200);
      assert.equal(r.body.ok, true);
      assert.equal(r.body.stats_available, false);

      const stat = (await staffQuery(
        `SELECT views, conversions FROM funnel_page_stats
          WHERE org_id = $1 AND clickfunnels_page_id = '100'`, [org]
      )).rows[0];
      assert.equal(stat.views, null);
      assert.equal(stat.conversions, null);

      const conn = (await staffQuery(
        `SELECT connection_state, last_error FROM analytics_connections
          WHERE org_id = $1 AND platform = 'clickfunnels'`, [org]
      )).rows[0];
      // Unavailable STATS is not a connection error — the connection itself
      // still worked.
      assert.equal(conn.connection_state, "active");
      assert.equal(conn.last_error, null);
    });

    test("a real platform failure marks the connection 'error' with the platform's own message", async () => {
      const r = await call(syncHandler, {
        token: owner.token, body: {},
        fetch: async (url, opts) => {
          const u = new URL(String(url));
          if (u.pathname.endsWith("/teams")) return jsonResponse(401, { error: "API key missing or invalid" });
          throw new Error(`unexpected URL: ${u}`);
        }
      });
      assert.equal(r.code, 502);
      assert.equal(r.body.error, "sync_failed");
      assert.match(r.body.message, /API key missing or invalid/);

      const conn = (await staffQuery(
        `SELECT connection_state, last_error FROM analytics_connections
          WHERE org_id = $1 AND platform = 'clickfunnels'`, [org]
      )).rows[0];
      assert.equal(conn.connection_state, "error");
      assert.match(conn.last_error, /API key missing or invalid/);
    });

    test("sync with no connection returns a clean 404, not a crash", async () => {
      await staffQuery(`DELETE FROM funnel_page_stats WHERE org_id = $1`, [org]);
      await staffQuery(`DELETE FROM analytics_connections WHERE org_id = $1 AND platform = 'clickfunnels'`, [org]);

      const r = await call(syncHandler, { token: owner.token, body: {}, fetch: fakeClickFunnels() });
      assert.equal(r.code, 404);
      assert.equal(r.body.error, "no_connection");

      // Re-connect so later describes (if any run after this one) still have a row.
      await call(connectHandler, {
        token: owner.token,
        body: { api_key: "good-key", subdomain: "goodshop" },
        fetch: fakeClickFunnels()
      });
      await call(syncHandler, { token: owner.token, body: {}, fetch: fakeClickFunnels() });
    });
  });

  describe("read — /api/read/funnel-pages", () => {
    test("a non-staff session gets 401, and a staff role outside no special set still gets 200", async () => {
      const anon = await call(readHandler, { method: "GET" });
      assert.equal(anon.code, 401);

      const staffRead = await call(readHandler, { method: "GET", token: closer.token });
      assert.equal(staffRead.code, 200);
    });

    test("returns the synced page with its connection state", async () => {
      const r = await call(readHandler, { method: "GET", token: owner.token });
      assert.equal(r.code, 200);
      assert.equal(r.body.ok, true);
      assert.ok(Array.isArray(r.body.pages));
      const row = r.body.pages.find((p) => p.page_name === "Order Page");
      assert.ok(row, "the synced page must be in the read response");
      assert.equal(row.funnel_name, "Main Funnel");
      assert.equal(r.body.connection.state, "active");
      assert.ok(r.body.connection.last_synced_at);
    });

    test("connection is null when nothing has ever been connected for the org", async () => {
      await staffQuery(`DELETE FROM funnel_page_stats WHERE org_id = $1`, [org]);
      await staffQuery(`DELETE FROM analytics_connections WHERE org_id = $1 AND platform = 'clickfunnels'`, [org]);

      const r = await call(readHandler, { method: "GET", token: owner.token });
      assert.equal(r.code, 200);
      assert.equal(r.body.connection, null);
      assert.deepEqual(r.body.pages, []);
    });
  });

  describe("RLS — a bare, unscoped query sees nothing", () => {
    test("analytics_connections is invisible outside asStaff()/withPartnerScope()", async () => {
      await call(connectHandler, {
        token: owner.token,
        body: { api_key: "good-key", subdomain: "goodshop" },
        fetch: fakeClickFunnels()
      });
      // FIXED 2026-09-07, found by adversarial review: this used to query
      // through the plain `db` import, which connects as whatever
      // DATABASE_URL resolves to — often the table owner or a superuser in
      // this repo's dual-env test setup, and BOTH bypass RLS regardless of
      // FORCE. That is a false pass waiting to happen, not a real assertion.
      // rlsDb (src/testing/rls-pool.mjs) is the pool every other
      // RLS-isolation test in this repo already routes this exact kind of
      // check through, because it resolves to APP_DATABASE_URL — the
      // unprivileged fundhub_app role — which genuinely cannot bypass RLS.
      // With no fundhub.actor ever set on this connection, fundhub_is_staff()
      // is false, and FORCE ROW LEVEL SECURITY hides the row even from a
      // query that names the exact org_id.
      const bare = await rlsDb.query(
        `SELECT id FROM analytics_connections WHERE org_id = $1 AND platform = 'clickfunnels'`, [org]
      );
      assert.equal(bare.rows.length, 0);
    });
  });
});
