// Unit tests for the ClickFunnels adapter — mocked ctx.fetch, no network and no
// database. Covers the two things the build spec calls out as load-bearing:
// a normal successful call (through the team/workspace resolution this file's
// header documents as a real deviation from the original spec), and the
// 403-on-stats-endpoint case returning {available:false} rather than throwing.

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { encryptToken } from "../adplatforms/tokens.mjs";
import { credsFor, listFunnels, listPages, fetchPageStats } from "./clickfunnels.mjs";

const ORG_ID = "11111111-1111-4111-8111-111111111111";

before(() => {
  // credsFor() → decryptToken() reads process.env directly (it has no env
  // override parameter), so the key has to live there for this file's tests.
  process.env.AD_TOKEN_ENC_KEY = crypto.randomBytes(32).toString("base64");
});

function connectionFor({ api_key = "cf_test_key_123", subdomain = "myworkspace" } = {}) {
  return {
    org_id: ORG_ID,
    encrypted_credentials: encryptToken(JSON.stringify({ api_key, subdomain }), { partnerId: ORG_ID })
  };
}

/* jsonResponse — a minimal fetch Response stand-in: .ok, .status, .text(),
   .headers.get(). That is everything cfFetch() reads. */
function jsonResponse(status, body, headers = {}) {
  const lower = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    headers: { get: (k) => lower.get(String(k).toLowerCase()) ?? null }
  };
}

describe("credsFor", () => {
  test("round-trips api_key and subdomain through encryption", () => {
    const conn = connectionFor({ api_key: "abc123", subdomain: "chris-fund" });
    const creds = credsFor(conn);
    assert.equal(creds.api_key, "abc123");
    assert.equal(creds.subdomain, "chris-fund");
  });
});

describe("listFunnels — resolves the workspace, then lists funnels", () => {
  test("a normal successful call", async () => {
    const conn = connectionFor({ subdomain: "myworkspace" });
    const calls = [];

    const fetch = async (url, opts) => {
      calls.push(String(url));
      assert.equal(opts.headers.authorization, "Bearer cf_test_key_123");
      assert.ok(opts.headers["user-agent"], "ClickFunnels requires a User-Agent header");

      if (String(url).includes("/teams") && !String(url).includes("/workspaces")) {
        return jsonResponse(200, [{ id: 42, name: "My Team" }]);
      }
      if (String(url).includes("/teams/42/workspaces")) {
        return jsonResponse(200, [
          { id: 99, name: "Other", subdomain: "someone-else" },
          { id: 100, name: "Mine", subdomain: "myworkspace" }
        ]);
      }
      if (String(url).includes("/workspaces/100/funnels")) {
        return jsonResponse(200, [{ id: 5, name: "Funding Funnel" }, { id: 6, name: "VSL Funnel" }]);
      }
      throw new Error(`unexpected URL in test: ${url}`);
    };

    const funnels = await listFunnels(conn, { fetch });
    assert.deepEqual(funnels, [{ id: 5, name: "Funding Funnel" }, { id: 6, name: "VSL Funnel" }]);
    // The workspace matched by subdomain, not the first one returned.
    assert.ok(calls.some((u) => u.includes("/workspaces/100/funnels")));
  });

  test("throws a clear error when no workspace matches the connection's subdomain", async () => {
    const conn = connectionFor({ subdomain: "nowhere" });
    const fetch = async (url) => {
      if (String(url).includes("/teams") && !String(url).includes("/workspaces")) {
        return jsonResponse(200, [{ id: 1 }]);
      }
      return jsonResponse(200, [{ id: 1, subdomain: "somewhere-else" }]);
    };
    await assert.rejects(() => listFunnels(conn, { fetch }), /no ClickFunnels workspace with subdomain "nowhere"/);
  });

  test("follows Pagination-Next cursors to the end", async () => {
    const conn = connectionFor({ subdomain: "myworkspace" });
    const fetch = async (url) => {
      const u = String(url);
      if (u.includes("/teams") && !u.includes("/workspaces")) return jsonResponse(200, [{ id: 1 }]);
      if (u.includes("/teams/1/workspaces")) return jsonResponse(200, [{ id: 7, subdomain: "myworkspace" }]);
      if (u.includes("/workspaces/7/funnels")) {
        if (!u.includes("after=")) {
          return jsonResponse(200, [{ id: 1, name: "F1" }], { "Pagination-Next": "1" });
        }
        return jsonResponse(200, [{ id: 2, name: "F2" }]);
      }
      throw new Error(`unexpected URL: ${u}`);
    };
    const funnels = await listFunnels(conn, { fetch });
    assert.deepEqual(funnels.map((f) => f.id), [1, 2]);
  });
});

describe("listPages", () => {
  test("filters the workspace's pages by funnel id", async () => {
    const conn = connectionFor({ subdomain: "myworkspace" });
    let sawFilter = null;
    const fetch = async (url) => {
      const u = new URL(String(url));
      if (u.pathname.endsWith("/teams")) return jsonResponse(200, [{ id: 1 }]);
      if (u.pathname.endsWith("/workspaces")) return jsonResponse(200, [{ id: 7, subdomain: "myworkspace" }]);
      if (u.pathname.endsWith("/pages")) {
        sawFilter = u.searchParams.get("filter[funnel_ids]");
        return jsonResponse(200, [{ id: 200, name: "Order Page" }]);
      }
      throw new Error(`unexpected URL: ${u}`);
    };
    const pages = await listPages(conn, 5, { fetch });
    assert.equal(sawFilter, "5");
    assert.deepEqual(pages, [{ id: 200, name: "Order Page", funnel_id: 5 }]);
  });
});

describe("fetchPageStats", () => {
  test("a normal successful call maps step.views_all/optins to views/conversions", async () => {
    const conn = connectionFor();
    const fetch = async (url) => {
      const u = new URL(String(url));
      assert.equal(u.pathname, "/api/v2/pages/300/stats");
      assert.equal(u.searchParams.get("timerange_start"), "2026-08-01T00:00:00.000Z");
      assert.equal(u.searchParams.get("timerange_end"), "2026-09-01T00:00:00.000Z");
      return jsonResponse(200, {
        currency: "USD",
        funnel: { id: 3, name: "Sales Funnel", public_id: "xYzAbC" },
        page: { id: 300, name: "Order Page" },
        step: { views_all: 100, views_unique: 80, optins: 3, name: "Order Page" },
        timerange: { from: "2026-08-01T00:00:00Z", to: "2026-09-01T00:00:00Z" }
      });
    };
    const out = await fetchPageStats(
      conn, 300, { from: "2026-08-01T00:00:00.000Z", to: "2026-09-01T00:00:00.000Z" }, { fetch }
    );
    assert.deepEqual(out, { available: true, views: 100, conversions: 3 });
  });

  test("a page not reached via a funnel step (step is null) is available:false, not a throw", async () => {
    const conn = connectionFor();
    const fetch = async () => jsonResponse(200, {
      currency: "USD", funnel: null, page: { id: 301, name: "Standalone" }, step: null,
      timerange: { from: "2026-08-01T00:00:00Z", to: "2026-09-01T00:00:00Z" }
    });
    const out = await fetchPageStats(conn, 301, {}, { fetch });
    assert.equal(out.available, false);
    assert.match(out.reason, /not reached via a funnel step/);
  });

  test("the closed-beta case: a 403 from the stats endpoint returns {available:false}, never throws", async () => {
    const conn = connectionFor();
    const fetch = async () => jsonResponse(403, { error: "This feature is not available on your plan" });
    const out = await fetchPageStats(conn, 302, {}, { fetch });
    assert.deepEqual(out, { available: false, reason: "This feature is not available on your plan" });
  });

  test("a 404 from the stats endpoint also returns {available:false}, never throws", async () => {
    const conn = connectionFor();
    const fetch = async () => jsonResponse(404, { error: "Not found: Record missing" });
    const out = await fetchPageStats(conn, 303, {}, { fetch });
    assert.equal(out.available, false);
    assert.equal(out.reason, "Not found: Record missing");
  });

  test("a 401 (real auth failure) still throws, with ClickFunnels' own message preserved", async () => {
    const conn = connectionFor();
    const fetch = async () => jsonResponse(401, { error: "API key missing or invalid" });
    await assert.rejects(
      () => fetchPageStats(conn, 304, {}, { fetch }),
      (err) => {
        assert.equal(err.status, 401);
        assert.equal(err.platformMessage, "API key missing or invalid");
        return true;
      }
    );
  });

  test("a 5xx is retryable and still throws", async () => {
    const conn = connectionFor();
    const fetch = async () => jsonResponse(500, { error: "internal error" });
    await assert.rejects(() => fetchPageStats(conn, 305, {}, { fetch }), (err) => {
      assert.equal(err.retryable, true);
      return true;
    });
  });

  test("the API key never appears in a thrown error message", async () => {
    const conn = connectionFor({ api_key: "super-secret-key-value" });
    const fetch = async () => {
      throw new Error("network exploded, key was super-secret-key-value");
    };
    await assert.rejects(() => fetchPageStats(conn, 306, {}, { fetch }), (err) => {
      assert.ok(!err.message.includes("super-secret-key-value"));
      return true;
    });
  });
});
