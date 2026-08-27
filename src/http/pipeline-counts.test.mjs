/* /api/dashboard/pipeline-counts — every rail's card count in one read.
 *
 * The board's rail tabs each show a number. Getting those numbers used to mean
 * fetching every rail's whole board and taking the length, which is eight full
 * board reads per page load. The test that matters here is the last one: that
 * this answers all eight rails with a single query, because the moment it goes
 * back to one-query-per-rail the page is slow again and nothing else notices.
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { db } from "../db.mjs";
import handler from "../../api/dashboard/pipeline-counts.mjs";

const COUNTS_SRC = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../api/dashboard/pipeline-counts.mjs"),
  "utf8"
);
const PIPE_SRC = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../api/dashboard/pipeline.mjs"),
  "utf8"
);

const ORG_A = "11111111-1111-4111-8111-111111111111";
const STAFF = "44444444-4444-4444-8444-444444444444";

const realQuery = db.query;
let calls = [];

function stubDb({ session = {}, countRows = [], demoMode = false, fail = null } = {}) {
  calls = [];
  db.query = async (text, params) => {
    calls.push({ text, params });
    if (/FROM live JOIN staff s/i.test(text)) {
      if (session === null) return { rows: [] };
      return { rows: [{
        session_id: "sess-1", expires_at: new Date(Date.now() + 3_600_000),
        staff_id: session.staffId ?? STAFF, org_id: session.orgId ?? ORG_A,
        role: session.role ?? "owner", email: "e@example.com",
        name: "A Staffer", status: session.status ?? "active", active_flag: "true"
      }] };
    }
    if (/FROM orgs WHERE id/i.test(text)) return { rows: [{ demo_mode_enabled: demoMode }] };
    if (/GROUP BY p\.key/i.test(text)) {
      if (fail) throw fail;
      return { rows: countRows };
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

const GET = { method: "GET", headers: { authorization: "Bearer tok" }, query: {} };

beforeEach(() => { calls = []; });
afterEach(() => { db.query = realQuery; });

describe("/api/dashboard/pipeline-counts", () => {

  test("refuses anything but GET — this route only reads", async () => {
    stubDb();
    const r = mkRes();
    await handler({ ...GET, method: "POST" }, r);
    assert.equal(r.statusCode, 405);
  });

  test("answers every rail from one query, not one query per rail", async () => {
    stubDb({ countRows: [
      { pipeline_key: "sales", count: 16 },
      { pipeline_key: "hiring", count: 0 },
      { pipeline_key: "optimization", count: 3 }
    ] });
    const r = mkRes();
    await handler({ ...GET }, r);

    assert.equal(r.statusCode, 200);
    const countQueries = calls.filter((c) => /GROUP BY p\.key/i.test(c.text));
    assert.equal(countQueries.length, 1, "the counts must come from a single query");
  });

  test("returns a map keyed by pipeline key", async () => {
    stubDb({ countRows: [
      { pipeline_key: "sales", count: 16 },
      { pipeline_key: "optimization", count: 3 }
    ] });
    const r = mkRes();
    await handler({ ...GET }, r);
    assert.deepEqual(r.body, { ok: true, counts: { sales: 16, optimization: 3 } });
  });

  test("a rail with no cards is 0, not missing and not a guess", async () => {
    stubDb({ countRows: [{ pipeline_key: "hiring", count: 0 }] });
    const r = mkRes();
    await handler({ ...GET }, r);
    assert.equal(r.body.counts.hiring, 0);
  });

  test("a rail this org has no pipeline for is absent, so the tab keeps its dash", async () => {
    stubDb({ countRows: [{ pipeline_key: "sales", count: 16 }] });
    const r = mkRes();
    await handler({ ...GET }, r);
    assert.equal("ar_collections" in r.body.counts, false);
  });

  test("scopes on the session's org, never on a caller-supplied one", async () => {
    stubDb({ session: { orgId: ORG_A }, countRows: [] });
    const r = mkRes();
    await handler({ ...GET, query: { org_id: "99999999-9999-4999-8999-999999999999" } }, r);
    const countQuery = calls.find((c) => /GROUP BY p\.key/i.test(c.text));
    assert.equal(countQuery.params[0], ORG_A);
  });

  test("passes the org's demo-mode setting through to the filter", async () => {
    stubDb({ demoMode: true, countRows: [] });
    const r = mkRes();
    await handler({ ...GET }, r);
    const countQuery = calls.find((c) => /GROUP BY p\.key/i.test(c.text));
    assert.equal(countQuery.params[1], true);
  });

  test("a database failure reports as unavailable, it does not crash the board", async () => {
    stubDb({ fail: Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" }) });
    const r = mkRes();
    await handler({ ...GET }, r);
    assert.equal(r.statusCode, 503);
    assert.equal(r.body.ok, false);
  });

  test("no session, no counts", async () => {
    stubDb({ session: null });
    const r = mkRes();
    await handler({ ...GET }, r);
    assert.notEqual(r.statusCode, 200);
  });

  test("R-08 partner cards count and paint without a client row", () => {
    assert.match(COUNTS_SRC, /LEFT JOIN partners/i);
    assert.match(COUNTS_SRC, /pr\.id IS NOT NULL/);
    assert.match(PIPE_SRC, /LEFT JOIN partners/i);
    assert.match(PIPE_SRC, /partner_name/);
  });
});
