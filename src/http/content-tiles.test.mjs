/* /api/content/tiles — Content screen read + tile save.
   /api/content/welcome-video — the read side of the same two tables.

   The welcome-video route is covered here rather than in a file of its own
   because it reads content_videos and content_tier_map, which is exactly what
   the Content screen writes, and the fixtures below already describe both. */
import { test, describe, afterEach, before, after } from "node:test";
import assert from "node:assert";

import { db } from "../db.mjs";
import handler from "../../api/content/tiles.mjs";
import welcomeVideoHandler from "../../api/content/welcome-video.mjs";
/* The routing table itself, not a grep of the file that holds it. CLAUDE.md §12
   records the missing-route bug shipping twice; a regex over the source stays
   green when the line it matches moves into a comment, which is the one failure
   mode this check exists to catch. */
import { ROUTES } from "../../netlify/functions/api.mjs";
import { storeFromEnv } from "../documents/store.mjs";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
const STAFF = "44444444-4444-4444-8444-444444444444";
const VID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CLIENT_B = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const realQuery = db.query;

/* `calls` is optional and inert when it is not passed — every test that already
   existed passes nothing and behaves exactly as before. The welcome-video tests
   use it to prove WHICH question reached the database, which is the only way to
   show that a client's ?client_id= changed nothing. */
function stubDb({ session = null, answers = [], calls = null } = {}) {
  db.query = async (text, params) => {
    if (calls) calls.push({ text, params });
    if (/FROM live JOIN staff s/i.test(text)) {
      if (!session) return { rows: [] };
      const pick = (key, fallback) => (key in session ? session[key] : fallback);
      return { rows: [{
        session_id: "sess-1", expires_at: new Date(Date.now() + 3_600_000),
        staff_id: pick("staffId", STAFF), org_id: pick("orgId", ORG_A),
        role: pick("role", "owner"), email: "e@example.com",
        name: "A Staffer", status: pick("status", "active"), active_flag: "true"
      }] };
    }
    for (const [pattern, result] of answers) {
      if (pattern.test(text)) return typeof result === "function" ? result(params) : result;
    }
    return { rows: [] };
  };
}

function mkRes() {
  return {
    statusCode: null, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; }
  };
}

const CATALOG = {
  rows: [{
    code: "metro2-letter-pack", name: "Metro 2 Dispute Letter Pack",
    description: "The paid DIY letter pack.", display_price_cents: null,
    active: true, sort_order: 50
  }]
};

afterEach(() => { db.query = realQuery; });

describe("/api/content/tiles", () => {
  test("refuses a closer — owner/admin only", async () => {
    stubDb({ session: { role: "closer", orgId: ORG_A } });
    const r = mkRes();
    await handler({ method: "GET", headers: { authorization: "Bearer tok" } }, r);
    assert.equal(r.statusCode, 403);
    assert.equal(r.body.ok, false);
  });

  test("GET returns catalog tiles, not invented ones", async () => {
    stubDb({
      session: { role: "owner", orgId: ORG_A },
      answers: [
        [/FROM entitlement_catalog/i, CATALOG],
        [/FROM content_videos/i, { rows: [] }],
        [/FROM content_tier_map/i, { rows: [] }],
        [/FROM products/i, { rows: [{ code: "repair-bundle", name: "Credit Repair Bundle", description: "" }] }]
      ]
    });
    const r = mkRes();
    await handler({ method: "GET", headers: { authorization: "Bearer tok" } }, r);
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.tiles.length, 1);
    assert.equal(r.body.tiles[0].code, "metro2-letter-pack");
    assert.equal(r.body.tiles[0].price_cents, null);
    assert.equal(r.body.products[0].id, "repair-bundle");
  });

  test("save updates an existing catalog row", async () => {
    stubDb({
      session: { role: "admin", orgId: ORG_A },
      answers: [
        [/UPDATE entitlement_catalog/i, { rows: [{ code: "metro2-letter-pack" }] }],
        [/FROM entitlement_catalog/i, {
          rows: [{
            code: "metro2-letter-pack", name: "Metro 2 — Rounds 2 & 3",
            description: "Two more rounds.", display_price_cents: 45000,
            active: true, sort_order: 50
          }]
        }],
        [/FROM content_videos/i, { rows: [] }],
        [/FROM content_tier_map/i, { rows: [] }],
        [/FROM products/i, { rows: [] }]
      ]
    });
    const r = mkRes();
    await handler({
      method: "POST",
      headers: { authorization: "Bearer tok" },
      body: {
        action: "save",
        tiles: [{
          code: "metro2-letter-pack",
          name: "Metro 2 — Rounds 2 & 3",
          copy: "Two more rounds.",
          price_cents: 45000,
          on: true
        }]
      }
    }, r);
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.tiles[0].name, "Metro 2 — Rounds 2 & 3");
    assert.equal(r.body.tiles[0].price_cents, 45000);
  });

  test("save refuses a tile code that is not on file", async () => {
    stubDb({
      session: { role: "owner", orgId: ORG_A },
      answers: [
        [/UPDATE entitlement_catalog/i, { rows: [] }]
      ]
    });
    const r = mkRes();
    await handler({
      method: "POST",
      headers: { authorization: "Bearer tok" },
      body: {
        action: "save",
        tiles: [{ code: "invented-tile", name: "Nope", copy: "", on: true }]
      }
    }, r);
    assert.equal(r.statusCode, 400);
    assert.match(r.body.message, /no locked tile on file/i);
  });

  test("save maps a video that belongs to the org", async () => {
    stubDb({
      session: { role: "owner", orgId: ORG_A },
      answers: [
        [/SELECT id FROM content_videos/i, { rows: [{ id: VID }] }],
        [/INSERT INTO content_tier_map/i, { rows: [] }],
        [/FROM entitlement_catalog/i, CATALOG],
        [/FROM content_videos/i, { rows: [{
          id: VID, title: "Welcome", duration_label: "1:00",
          mime_type: "video/mp4", byte_size: 12, uploaded_by: STAFF,
          created_at: new Date()
        }] }],
        [/FROM content_tier_map/i, { rows: [{ tier_code: "default", video_id: VID }] }],
        [/FROM products/i, { rows: [] }]
      ]
    });
    const r = mkRes();
    await handler({
      method: "POST",
      headers: { authorization: "Bearer tok" },
      body: { action: "save", map: { default: VID } }
    }, r);
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.map.default, VID);
  });

  /* ── the library must fail honestly ──────────────────────────────────────
     Every test above answers { rows: [] } for anything it did not name, so
     nothing in this file ever made a query THROW, and the four catch blocks in
     the handler were never exercised. That is exactly how "0 videos" hid a
     permission failure for as long as it did. These make the database refuse. */

  test("a content_videos table that is not there yet still reads as an empty library", async () => {
    const missing = Object.assign(new Error('relation "content_videos" does not exist'), { code: "42P01" });
    stubDb({
      session: { role: "owner", orgId: ORG_A },
      answers: [
        [/FROM entitlement_catalog/i, CATALOG],
        [/FROM content_videos/i, () => { throw missing; }],
        [/FROM products/i, { rows: [] }]
      ]
    });
    const r = mkRes();
    await handler({ method: "GET", headers: { authorization: "Bearer tok" } }, r);
    assert.equal(r.statusCode, 200);
    assert.deepEqual(r.body.videos, []);
  });

  test("a refused content_videos read is surfaced, not painted as 0 videos", async () => {
    const denied = Object.assign(new Error("permission denied for table content_videos"), { code: "42501" });
    stubDb({
      session: { role: "owner", orgId: ORG_A },
      answers: [
        [/FROM entitlement_catalog/i, CATALOG],
        [/FROM content_videos/i, () => { throw denied; }]
      ]
    });
    const r = mkRes();
    await handler({ method: "GET", headers: { authorization: "Bearer tok" } }, r);
    assert.equal(r.statusCode, 500);
    assert.equal(r.body.error, "query_failed");
    assert.match(r.body.detail, /permission denied/i);
    /* NOBODY WAS SAVING. This is a page load, and the outer catch's message was
       written for a POST — it told a reader who had typed nothing that their
       save had failed. */
    assert.match(r.body.message, /could not be read/i);
    assert.doesNotMatch(r.body.message, /sav(e|ing)/i);
  });

  test("a database with no display_price_cents column still lists tiles, with price unknown", async () => {
    /* 42703, not 42P01: entitlement_catalog predates 171_content.sql and only
       the column is new. The price must come back NULL — "nobody saved one" —
       and never 0. */
    const noColumn = Object.assign(
      new Error('column "display_price_cents" does not exist'), { code: "42703" });
    let first = true;
    stubDb({
      session: { role: "owner", orgId: ORG_A },
      answers: [
        [/FROM entitlement_catalog/i, () => {
          // The tile SELECT runs first and must succeed; the price SELECT is
          // the second hit on the same table and is the one that fails.
          if (first) { first = false; return CATALOG; }
          throw noColumn;
        }],
        [/FROM content_videos/i, { rows: [] }],
        [/FROM content_tier_map/i, { rows: [] }],
        [/FROM products/i, { rows: [] }]
      ]
    });
    const r = mkRes();
    await handler({ method: "GET", headers: { authorization: "Bearer tok" } }, r);
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.tiles.length, 1);
    assert.equal(r.body.tiles[0].price_cents, null);
  });

  test("a refused price read is surfaced — it does not silently blank the price", async () => {
    const denied = Object.assign(
      new Error("permission denied for table entitlement_catalog"), { code: "42501" });
    let first = true;
    stubDb({
      session: { role: "owner", orgId: ORG_A },
      answers: [
        [/FROM entitlement_catalog/i, () => {
          if (first) { first = false; return CATALOG; }
          throw denied;
        }]
      ]
    });
    const r = mkRes();
    await handler({ method: "GET", headers: { authorization: "Bearer tok" } }, r);
    assert.equal(r.statusCode, 500);
    assert.equal(r.body.error, "query_failed");
    assert.match(r.body.detail, /permission denied/i);
  });

  test("a failed video map names the failure — it never claims videos are unstored", async () => {
    const denied = Object.assign(
      new Error("permission denied for table content_tier_map"), { code: "42501" });
    stubDb({
      session: { role: "owner", orgId: ORG_A },
      answers: [
        [/SELECT id FROM content_videos/i, { rows: [{ id: VID }] }],
        [/INSERT INTO content_tier_map/i, () => { throw denied; }]
      ]
    });
    const r = mkRes();
    await handler({
      method: "POST",
      headers: { authorization: "Bearer tok" },
      body: { action: "save", map: { default: VID } }
    }, r);
    assert.equal(r.statusCode, 500);
    assert.equal(r.body.error, "map_save_failed");
    assert.doesNotMatch(r.body.message, /not stored in the database yet/i);
    /* THE OTHER HALF OF THE SENTENCE. This request carries no tiles at all —
       the exact shape public/app/content-admin.html posts when only the video
       dropdown moved — so a message claiming tile words were saved is false.
       Checking only the "unstored" half green-lit that lie. */
    assert.doesNotMatch(r.body.message, /tile words were saved/i);
    assert.match(r.body.message, /could not be mapped/i);
  });

  test("a map that failed halfway does not claim the tiers that landed also failed", async () => {
    /* Three tiers, and the third INSERT is refused. The two that committed are
       on file — this handler runs no transaction — so "the welcome video could
       not be mapped" is false about them. */
    const denied = Object.assign(
      new Error("permission denied for table content_tier_map"), { code: "42501" });
    let inserts = 0;
    stubDb({
      session: { role: "owner", orgId: ORG_A },
      answers: [
        [/SELECT id FROM content_videos/i, { rows: [{ id: VID }] }],
        [/INSERT INTO content_tier_map/i, () => {
          inserts += 1;
          if (inserts > 2) throw denied;
          return { rows: [] };
        }]
      ]
    });
    const r = mkRes();
    await handler({
      method: "POST",
      headers: { authorization: "Bearer tok" },
      body: {
        action: "save",
        tiles: [],
        map: { default: VID, gold: VID, platinum: VID }
      }
    }, r);
    assert.equal(r.statusCode, 500);
    assert.equal(r.body.error, "map_save_failed");
    assert.match(r.body.message, /2 video choices were saved/i);
    assert.match(r.body.message, /the rest of the video choices could not be saved/i);
    // An empty tiles array is not a tile save, so it must not be claimed as one.
    assert.doesNotMatch(r.body.message, /tile words were saved/i);
  });

  test("a save that committed is not reported as a failed save when only the refresh breaks", async () => {
    /* THE REGRESSION THIS TEST EXISTS FOR. Nothing here opens a transaction, so
       by the time the handler re-reads the bundle every write has already
       committed. A refusal on that re-read used to reach the outer catch and
       answer "Something went wrong saving content." — sending the owner back to
       retry a save that had already worked. */
    const denied = Object.assign(
      new Error("permission denied for table content_videos"), { code: "42501" });
    stubDb({
      session: { role: "owner", orgId: ORG_A },
      answers: [
        [/UPDATE entitlement_catalog/i, { rows: [{ code: "metro2-letter-pack" }] }],
        [/FROM entitlement_catalog/i, CATALOG],
        // The re-read after the save is the only thing that fails.
        [/FROM content_videos/i, () => { throw denied; }]
      ]
    });
    const r = mkRes();
    await handler({
      method: "POST",
      headers: { authorization: "Bearer tok" },
      body: {
        action: "save",
        tiles: [{ code: "metro2-letter-pack", name: "Metro 2", copy: "", on: true }]
      }
    }, r);
    assert.equal(r.statusCode, 500);
    assert.equal(r.body.error, "saved_but_reread_failed");
    assert.equal(r.body.saved, true);
    assert.match(r.body.message, /tile words were saved/i);
    assert.match(r.body.message, /reload the page/i);
    // It must never read as a save that did not happen.
    assert.doesNotMatch(r.body.message, /something went wrong saving/i);
    assert.doesNotMatch(r.body.message, /could not be saved/i);
    assert.notEqual(r.body.error, "query_failed");
  });

  test("an UNMAP that failed is not reported as a save that worked", async () => {
    /* The old catch only answered when some tier still wanted a video. Clearing
       every dropdown made wantsVideo false, nothing was returned, and the
       handler fell through to 200 {ok:true} with the row still in the table. */
    const denied = Object.assign(
      new Error("permission denied for table content_tier_map"), { code: "42501" });
    stubDb({
      session: { role: "owner", orgId: ORG_A },
      answers: [
        [/DELETE FROM content_tier_map/i, () => { throw denied; }]
      ]
    });
    const r = mkRes();
    await handler({
      method: "POST",
      headers: { authorization: "Bearer tok" },
      body: { action: "save", map: { default: "" } }
    }, r);
    assert.equal(r.statusCode, 500);
    assert.equal(r.body.error, "map_save_failed");
  });
});

/* ---------------------------------------------------------------------------
   /api/content/welcome-video — the read that makes an uploaded video reachable
   ------------------------------------------------------------------------ */

/* A fake signing key, generated for this file and used nowhere else. The
   endpoint refuses to mint a link without DOCUMENT_URL_SECRET (>= 32 chars),
   so the tests have to supply one. */
const TEST_URL_SECRET = "test-only-welcome-video-secret-0123456789";
let priorUrlSecret;

/* A signed-in CLIENT, built the way requirePrincipal actually resolves one:
   the staff session query misses, then account_sessions and accounts answer.
   `orgId` is the company on the SESSION — the thing a query string must never
   be able to change. */
function clientAnswers({ orgId = ORG_A, clientId = CLIENT_A } = {}) {
  return [
    [/UPDATE account_sessions/i, { rows: [{
      id: "acct-sess-1", account_id: "acct-1", org_id: orgId,
      expires_at: new Date(Date.now() + 3_600_000)
    }] }],
    [/FROM accounts WHERE id/i, { rows: [{
      id: "acct-1", org_id: orgId, kind: "client", email: "c@example.com",
      name: "A Client", status: "active", client_id: clientId,
      affiliate_id: null, partner_id: null
    }] }]
  ];
}

const MAPPED_VIDEO = {
  rows: [{
    tier_code: "default", id: VID, title: "Welcome to Fundhub",
    duration_label: "1:42", mime_type: "video/mp4", byte_size: null,
    created_at: new Date()
  }]
};

/* A ROW IS NOT A FILE. The metadata read now asks the object store whether the
   bytes are still there before it hands anybody a link, so a fixture that only
   stubs the database describes a video whose FILE IS GONE. These put real bytes
   in the in-memory store (the default provider, so no vendor is involved) and
   answer the storage-key lookup with the key that store handed back. */
const STORED_VIDEO_KEY = await storeFromEnv().provider.put(
  "documents/test-org/test-client/welcome/welcome-video-fixture.mp4",
  Buffer.from("not really a video"),
  { contentType: "video/mp4" }
);

/* The lookup welcomeVideoFileState() makes. `SELECT id, storage_key …` is the
   only query in this file that names storage_key, which is why the pattern can
   be this specific. */
const STORAGE_KEY_ROW = [/SELECT id, storage_key/i, {
  rows: [{ id: VID, storage_key: STORED_VIDEO_KEY, mime_type: "video/mp4", byte_size: null }]
}];

/* The same row with the object gone from the store — a key nothing was ever
   written to. This is what production looks like today. */
const MISSING_KEY_ROW = [/SELECT id, storage_key/i, {
  rows: [{ id: VID, storage_key: "memory://documents/gone/never-written.mp4", mime_type: "video/mp4", byte_size: null }]
}];

describe("/api/content/welcome-video", () => {
  before(() => {
    priorUrlSecret = process.env.DOCUMENT_URL_SECRET;
    process.env.DOCUMENT_URL_SECRET = TEST_URL_SECRET;
  });
  after(() => {
    if (priorUrlSecret === undefined) delete process.env.DOCUMENT_URL_SECRET;
    else process.env.DOCUMENT_URL_SECRET = priorUrlSecret;
  });

  test("the route is in the routing table, so it is reachable at all", () => {
    /* CLAUDE.md §12: a handler file is not a route. This asserts the LIVE
       binding — the object netlify/functions/api.mjs would actually dispatch to
       — rather than matching text in the file, which stays green if the line
       moves into a comment. */
    assert.equal(ROUTES["content/welcome-video"], welcomeVideoHandler);
  });

  test("no session, no answer — and the gate's refusal actually stops the handler", async () => {
    /* Both halves matter. The 401 proves the gate refused; the empty call list
       proves the handler READ that refusal and stopped, instead of carrying on
       to read a video for nobody. */
    const calls = [];
    stubDb({ session: null, calls });
    const r = mkRes();
    await welcomeVideoHandler({ method: "GET", headers: {} }, r);
    assert.equal(r.statusCode, 401);
    assert.equal(r.body.ok, false);
    assert.deepEqual(calls.filter((c) => /content_tier_map/i.test(c.text)), []);
  });

  test("a kind this endpoint does not serve is refused, and no video is read for it", async () => {
    const calls = [];
    stubDb({
      session: null, calls,
      answers: [
        [/UPDATE account_sessions/i, { rows: [{
          id: "acct-sess-1", account_id: "acct-1", org_id: ORG_A,
          expires_at: new Date(Date.now() + 3_600_000)
        }] }],
        [/FROM accounts WHERE id/i, { rows: [{
          id: "acct-1", org_id: ORG_A, kind: "affiliate", email: "a@example.com",
          name: "An Affiliate", status: "active", client_id: null,
          affiliate_id: "aff-1", partner_id: null
        }] }]
      ]
    });
    const r = mkRes();
    await welcomeVideoHandler({ method: "GET", headers: { authorization: "Bearer tok" } }, r);
    assert.equal(r.statusCode, 403);
    // The gate refused an affiliate, and the handler stopped rather than
    // reading a welcome video for a principal it does not serve.
    assert.deepEqual(calls.filter((c) => /content_tier_map/i.test(c.text)), []);
  });

  test("no video mapped is an honest 200, not a 404", async () => {
    stubDb({
      session: null,
      answers: [
        ...clientAnswers(),
        [/FROM content_tier_map m/i, { rows: [] }]
      ]
    });
    const r = mkRes();
    await welcomeVideoHandler({ method: "GET", headers: { authorization: "Bearer tok" } }, r);
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.video, null);
    assert.equal(r.body.reason, "no_video_mapped");
    /* The tier rule does not exist in this codebase and the response says so
       rather than letting "default" read as a decision somebody made. */
    assert.equal(r.body.tier_code, null);
    assert.equal(r.body.tier_reason, "no_tier_rule_in_code");
  });

  test("a mapped video comes back with a signed link and no storage key", async () => {
    stubDb({
      session: null,
      answers: [
        ...clientAnswers(),
        [/FROM content_tier_map m/i, MAPPED_VIDEO],
        STORAGE_KEY_ROW
      ]
    });
    const r = mkRes();
    await welcomeVideoHandler({ method: "GET", headers: { authorization: "Bearer tok" } }, r);
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.video.id, VID);
    assert.equal(r.body.video.title, "Welcome to Fundhub");
    assert.equal(r.body.video.matched, "default");
    // The bytes were found in the store, so there is nothing to explain away.
    assert.equal(r.body.reason, null);

    /* The id must ride in the QUERY STRING. netlify/functions/api.mjs matches
       ROUTES keys exactly and has no prefix branch for content/, so a link
       shaped /api/content/welcome-video/<id> would 404 for everyone. */
    const url = r.body.video.stream.url;
    assert.ok(url.startsWith("/api/content/welcome-video?"), url);
    assert.match(url, /[?&]id=/);
    assert.match(url, /[?&]exp=/);
    assert.match(url, /[?&]sig=/);

    // byte_size is nullable and NULL means unknown. It must not become 0.
    assert.equal(r.body.video.byte_size, null);

    const body = JSON.stringify(r.body);
    assert.doesNotMatch(body, /storage_key/i);
    assert.doesNotMatch(body, /memory:\/\//i);
  });

  test("a client cannot widen the read by naming someone else's client_id", async () => {
    /* Same session, two requests: one plain, one carrying a foreign client id
       AND a foreign org. The database must be asked the IDENTICAL question both
       times — that is what "a client is their session and nothing else" means
       in practice. */
    const plain = [];
    stubDb({
      session: null, calls: plain,
      answers: [
        ...clientAnswers(),
        [/FROM content_tier_map m/i, MAPPED_VIDEO],
        STORAGE_KEY_ROW
      ]
    });
    const r1 = mkRes();
    await welcomeVideoHandler({ method: "GET", headers: { authorization: "Bearer tok" } }, r1);

    const spoofed = [];
    stubDb({
      session: null, calls: spoofed,
      answers: [
        ...clientAnswers(),
        [/FROM content_tier_map m/i, MAPPED_VIDEO],
        STORAGE_KEY_ROW
      ]
    });
    const r2 = mkRes();
    await welcomeVideoHandler({
      method: "GET",
      headers: { authorization: "Bearer tok" },
      query: { client_id: CLIENT_B, org_id: ORG_B }
    }, r2);

    const pick = (calls) => calls.filter((c) => /FROM content_tier_map m/i.test(c.text));
    assert.equal(pick(plain).length, 1);
    assert.equal(pick(spoofed).length, 1);
    assert.deepEqual(pick(spoofed)[0].params, pick(plain)[0].params);
    assert.equal(pick(spoofed)[0].params[0], ORG_A);
    assert.equal(r2.body.video.id, r1.body.video.id);
  });

  test("a mapped video whose file is gone says so — it does not hand out a link that 404s", async () => {
    /* The row and the bytes are two different things. Answering ok:true with a
       signed link on the strength of the row alone promised a video that then
       404'd at the player, and the endpoint had no way to say "mapped, but the
       file is missing" — which is the only one of the three that is true when
       nothing was ever written to the store. */
    stubDb({
      session: null,
      answers: [
        ...clientAnswers(),
        [/FROM content_tier_map m/i, MAPPED_VIDEO],
        MISSING_KEY_ROW
      ]
    });
    const r = mkRes();
    await welcomeVideoHandler({ method: "GET", headers: { authorization: "Bearer tok" } }, r);
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.video, null);
    assert.equal(r.body.reason, "video_file_missing");
    // And it must stay distinguishable from "nobody ever mapped one".
    assert.notEqual(r.body.reason, "no_video_mapped");
  });

  test("a store that cannot be asked is reported as unknown, never as a working video", async () => {
    /* A misspelt DOCUMENT_STORE_PROVIDER means there is no store to ask. We do
       not know whether the bytes exist, and "present" would be as much of a
       guess as "missing" — so the answer says outright that it was not checked.
       The cause goes to the function log, which is captured here so the test
       output stays readable and the logging is proved at the same time. */
    const priorProvider = process.env.DOCUMENT_STORE_PROVIDER;
    process.env.DOCUMENT_STORE_PROVIDER = "not-a-real-provider";
    const realConsoleError = console.error;
    const logged = [];
    console.error = (...a) => logged.push(a.join(" "));
    try {
      stubDb({
        session: null,
        answers: [
          ...clientAnswers(),
          [/FROM content_tier_map m/i, MAPPED_VIDEO],
          STORAGE_KEY_ROW
        ]
      });
      const r = mkRes();
      await welcomeVideoHandler({ method: "GET", headers: { authorization: "Bearer tok" } }, r);
      assert.equal(r.statusCode, 200);
      assert.equal(r.body.ok, true);
      assert.equal(r.body.reason, "video_file_unverified");
      assert.equal(r.body.video.id, VID);
      assert.match(logged.join("\n"), /no usable document store/i);
    } finally {
      console.error = realConsoleError;
      if (priorProvider === undefined) delete process.env.DOCUMENT_STORE_PROVIDER;
      else process.env.DOCUMENT_STORE_PROVIDER = priorProvider;
    }
  });

  test("a staff preview with no client named still reports the missing tier rule", async () => {
    /* "no_client" reads as "name a client and we would pick a tier", and we
       would not — there is no tier rule for anyone. Reporting it that way hid
       the real gap exactly when a human was previewing the portal, which is the
       one moment the field exists for. */
    stubDb({
      session: { role: "owner", orgId: ORG_A },
      answers: [[/FROM content_tier_map m/i, { rows: [] }]]
    });
    const r = mkRes();
    await welcomeVideoHandler({ method: "GET", headers: { authorization: "Bearer tok" } }, r);
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.tier_code, null);
    assert.equal(r.body.tier_reason, "no_tier_rule_in_code");
    assert.notEqual(r.body.tier_reason, "no_client");
  });

  test("a client is never told what the database said", async () => {
    /* safeError() scrubs connection strings, hosts and IPs. It does not scrub
       "permission denied for table content_videos", and this endpoint serves
       clients — unlike /api/content/tiles, which only an owner or admin can
       reach. The cause belongs in the function log. */
    const denied = Object.assign(
      new Error("permission denied for table content_videos"), { code: "42501" });
    stubDb({
      session: null,
      answers: [...clientAnswers(), [/FROM content_tier_map m/i, () => { throw denied; }]]
    });
    const r = mkRes();
    await welcomeVideoHandler({ method: "GET", headers: { authorization: "Bearer tok" } }, r);
    assert.equal(r.statusCode, 500);
    assert.equal(r.body.error, "read_failed");
    assert.equal(r.body.detail, undefined);
    assert.doesNotMatch(JSON.stringify(r.body), /permission denied/i);
  });

  test("staff still get the cause, because they are the ones who can fix it", async () => {
    const denied = Object.assign(
      new Error("permission denied for table content_videos"), { code: "42501" });
    stubDb({
      session: { role: "owner", orgId: ORG_A },
      answers: [[/FROM content_tier_map m/i, () => { throw denied; }]]
    });
    const r = mkRes();
    await welcomeVideoHandler({ method: "GET", headers: { authorization: "Bearer tok" } }, r);
    assert.equal(r.statusCode, 500);
    assert.match(r.body.detail, /permission denied/i);
  });

  test("a missing signing key never reads as the database being down", async () => {
    /* public/app/data.js turns EVERY 503 into source "nodb" and, with no
       message to show, prints "The database is not reachable right now." The
       database is fine; the key that signs video links is not set. Both 503s on
       this route have to carry a sentence of their own or they send somebody to
       Postgres for an hour. */
    const prior = process.env.DOCUMENT_URL_SECRET;
    delete process.env.DOCUMENT_URL_SECRET;
    try {
      stubDb({
        session: null,
        answers: [...clientAnswers(), [/FROM content_tier_map m/i, MAPPED_VIDEO]]
      });
      const meta = mkRes();
      await welcomeVideoHandler({ method: "GET", headers: { authorization: "Bearer tok" } }, meta);
      assert.equal(meta.statusCode, 503);
      assert.equal(meta.body.error, "not_configured");
      assert.match(meta.body.message, /sign video links/i);
      assert.doesNotMatch(meta.body.message, /database/i);
      // Never name the environment variable to whoever is holding the screen.
      assert.doesNotMatch(meta.body.message, /DOCUMENT_URL_SECRET/);

      const bytes = mkRes();
      await welcomeVideoHandler({
        method: "GET",
        headers: {},
        query: { id: VID, exp: String(Math.floor(Date.now() / 1000) + 600), sig: "deadbeef" }
      }, bytes);
      assert.equal(bytes.statusCode, 503);
      assert.equal(bytes.body.error, "not_configured");
      assert.match(bytes.body.message, /sign video links/i);
      assert.doesNotMatch(bytes.body.message, /database/i);
      assert.doesNotMatch(bytes.body.message, /DOCUMENT_URL_SECRET/);
    } finally {
      if (prior === undefined) delete process.env.DOCUMENT_URL_SECRET;
      else process.env.DOCUMENT_URL_SECRET = prior;
    }
  });

  test("a forged playback link is a 404, and it never reaches the database", async () => {
    /* The bytes branch takes no session on purpose — a <video src> cannot send
       an Authorization header — so the signature has to be the whole gate. */
    const calls = [];
    stubDb({ session: null, calls });
    const r = mkRes();
    await welcomeVideoHandler({
      method: "GET",
      headers: {},
      query: { id: VID, exp: String(Math.floor(Date.now() / 1000) + 600), sig: "deadbeef" }
    }, r);
    assert.equal(r.statusCode, 404);
    assert.equal(r.body.error, "not_found");
    assert.deepEqual(calls.filter((c) => /content_videos/i.test(c.text)), []);
  });
});
