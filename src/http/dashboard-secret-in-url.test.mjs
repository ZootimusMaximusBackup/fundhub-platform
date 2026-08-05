/* Audit M2 — the dashboard master secret must never be accepted from the URL.
 *
 * THE DEFECT. src/http/dashboard-auth.mjs read the shared secret from
 * `req.query.key` as well as from the `x-dashboard-key` header:
 *
 *     const provided = req?.headers?.["x-dashboard-key"] || req?.query?.key || "";
 *
 * DASHBOARD_SECRET is a single, never-expiring, non-revocable, non-attributable
 * credential that unlocks the whole client book (names, emails, phones, message
 * bodies, consent flags). A URL query string is the worst possible carrier for
 * it: it is written to browser history, saved into bookmarks and shared links,
 * forwarded to third parties in the Referer header, and recorded verbatim in
 * every proxy/CDN/server access log along the way.
 *
 * This repo already forbids exactly this for session tokens, in writing, at
 * src/http/middleware/requireAuth.mjs:22-23 ("Query strings are deliberately NOT
 * accepted: they land in access logs, and this token is a live credential").
 * The master secret is strictly more dangerous than one session token, so it
 * cannot be held to a weaker standard.
 *
 * The header remains the only accepted carrier. public/dashboard.html already
 * sends the header on every API call, so nothing about the transport changes —
 * only where the page is allowed to pick the key up from.
 *
 * WHY THIS FILE LIVES UNDER src/http/. package.json's test glob is "src/**" and
 * "scripts/**"; a test placed under api/ is silently never collected.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkDashboardAuth, requireDashboardAccess } from "./dashboard-auth.mjs";
import { db } from "../db.mjs";
import clientsHandler from "../../api/dashboard/clients.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_HTML = path.resolve(HERE, "../../public/dashboard.html");

const SECRET = "sup3r-s3cret-master-key";

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; return r; };
  return r;
};

describe("M2: the dashboard master secret is not accepted from the URL", () => {
  test("checkDashboardAuth refuses the correct secret when it arrives as ?key=", () => {
    const env = { DASHBOARD_SECRET: SECRET };
    assert.equal(
      checkDashboardAuth({ headers: {}, query: { key: SECRET } }, env),
      false,
      "the master secret was accepted from the query string, so it travels in " +
      "browser history, bookmarks, shared links and Referer headers"
    );
  });

  test("no query alias sneaks the secret in either", () => {
    const env = { DASHBOARD_SECRET: SECRET };
    for (const q of [
      { key: SECRET },
      { KEY: SECRET },
      { dashboard_key: SECRET },
      { "x-dashboard-key": SECRET },
      { token: SECRET },
      { secret: SECRET }
    ]) {
      assert.equal(
        checkDashboardAuth({ headers: {}, query: q }, env), false,
        `the secret was accepted from the query string as ?${Object.keys(q)[0]}=`
      );
    }
  });

  test("a bad header is not rescued by a good query string", () => {
    const env = { DASHBOARD_SECRET: SECRET };
    assert.equal(
      checkDashboardAuth(
        { headers: { "x-dashboard-key": "wrong" }, query: { key: SECRET } },
        env
      ),
      false
    );
  });

  test("the header carrier still works — this fix removes a door, it does not lock the building", () => {
    const env = { DASHBOARD_SECRET: SECRET };
    assert.equal(checkDashboardAuth({ headers: { "x-dashboard-key": SECRET }, query: {} }, env), true);
    // Header casing varies by adapter; whatever shape already worked keeps working.
    assert.equal(checkDashboardAuth({ headers: { "x-dashboard-key": SECRET } }, env), true);
  });

  test("a request object with no query bag at all does not throw", () => {
    const env = { DASHBOARD_SECRET: SECRET };
    assert.equal(checkDashboardAuth({ headers: {} }, env), false);
    assert.equal(checkDashboardAuth({}, env), false);
    assert.equal(checkDashboardAuth(undefined, env), false);
  });
});

/* End to end through the real handler and the real gate, so this asserts what
   the endpoint DOES rather than what its source text says. db.query is swapped
   for a stub (same technique as dashboard-role-gate.test.mjs) and restored
   after, so nothing else in the process sees it. */
describe("M2: GET /api/dashboard/clients with the secret in the URL", () => {
  let realQuery;
  let realSecret;
  let hadSecret;

  const PII_ROW = {
    id: "11111111-2222-3333-4444-555555555555",
    first_name: "Dana", last_name: "Reyes", email: "dana.reyes@example.com",
    outcome_tier: "A", funded: true, funded_amount: "50000",
    crs_paid: true, deposit_paid: true, sale_closed: true,
    total_funding_estimate: "75000",
    created_at: new Date("2026-01-01T00:00:00Z"),
    tx_count: "0", tx_latest_product: null, tx_latest_amount: null,
    tx_latest_status: null, crs_count: "0", task_count: "0",
    last_msg_channel: null, last_msg_direction: null, last_msg_at: null
  };

  before(() => {
    realQuery = db.query;
    // No session anywhere: the session lookup finds nothing, so the shared
    // secret is the only thing that could let this caller in.
    db.query = async (sql) => {
      if (/FROM live JOIN staff/.test(String(sql))) return { rows: [] };
      return { rows: [PII_ROW] };
    };
    hadSecret = "DASHBOARD_SECRET" in process.env;
    realSecret = process.env.DASHBOARD_SECRET;
    process.env.DASHBOARD_SECRET = SECRET;
  });

  after(() => {
    db.query = realQuery;
    if (hadSecret) process.env.DASHBOARD_SECRET = realSecret;
    else delete process.env.DASHBOARD_SECRET;
  });

  test("is refused with 401 and returns no client rows", async () => {
    const r = res();
    await clientsHandler({ method: "GET", headers: {}, query: { key: SECRET } }, r);
    assert.equal(r.code, 401,
      "the whole client book was served to a URL carrying the master secret. Body was: " +
      JSON.stringify(r.body));
    assert.ok(!("clients" in (r.body || {})), "the refusal still carried client rows");
    assert.ok(!JSON.stringify(r.body).includes(PII_ROW.email), "PII leaked in the refusal body");
  });

  test("the same secret in the header authenticates but cannot read the client book", async () => {
    // DASHBOARD_SECRET proves operator access, not which company. Org-scoped
    // reads require a real staff session. Serving the full book to a shared
    // secret was the multi-tenant leak class this suite exists to prevent.
    const r = res();
    await clientsHandler(
      { method: "GET", headers: { "x-dashboard-key": SECRET }, query: {} },
      r
    );
    assert.equal(r.code, 403, "secret-only caller must be refused. Body was: " + JSON.stringify(r.body));
    assert.equal(r.body.error, "no_org_on_session");
    assert.ok(!("clients" in (r.body || {})), "refusal must not carry client rows");
    assert.ok(!JSON.stringify(r.body).includes(PII_ROW.email), "PII leaked in the refusal body");
  });

  test("requireDashboardAccess itself answers 401, not 503, for a URL-borne secret", async () => {
    const r = res();
    const who = await requireDashboardAccess(
      { method: "GET", headers: {}, query: { key: SECRET } }, r, { db }
    );
    assert.equal(who, null);
    assert.equal(r.code, 401);
  });
});

/* The page is the other half of the finding: as long as dashboard.html tells
   people to put the secret in the address bar, the secret keeps ending up in
   history, bookmarks and Referer headers even after the server stops honouring
   it. Source-level assertions, because the key pickup runs before any fetch. */
describe("M2: public/dashboard.html does not carry the secret in the URL", () => {
  const SRC = fs.readFileSync(DASHBOARD_HTML, "utf8");

  test("the key is not read out of the query string", () => {
    assert.ok(
      !/URLSearchParams\s*\(\s*location\.search\s*\)[\s\S]{0,80}?\.get\(\s*['"]key['"]\s*\)/.test(SRC),
      "dashboard.html still lifts the master secret out of location.search"
    );
    assert.ok(
      !/location\.search[\s\S]{0,120}?['"]key['"]/.test(SRC),
      "dashboard.html still reads the master secret from the URL query string"
    );
  });

  test("the page no longer instructs people to paste the secret into the address bar", () => {
    assert.ok(
      !/\?key=/.test(SRC),
      "dashboard.html still tells the user to add ?key=… to the URL"
    );
  });

  test("the key is still sent as the x-dashboard-key header", () => {
    assert.ok(/x-dashboard-key/.test(SRC),
      "dashboard.html no longer sends the key as a header, so the dashboard cannot authenticate at all");
  });

  test("the key is held in sessionStorage, which is not written to history or Referer", () => {
    assert.ok(/sessionStorage/.test(SRC),
      "dashboard.html has no replacement carrier for the key");
  });
});
