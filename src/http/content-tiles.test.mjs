/* /api/content/tiles — Content screen read + tile save. */
import { test, describe, afterEach } from "node:test";
import assert from "node:assert";

import { db } from "../db.mjs";
import handler from "../../api/content/tiles.mjs";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const STAFF = "44444444-4444-4444-8444-444444444444";
const VID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const realQuery = db.query;

function stubDb({ session = null, answers = [] } = {}) {
  db.query = async (text, params) => {
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
});
