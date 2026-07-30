/* Tests for public/app/data.js — the browser data layer.
 *
 * It is a plain IIFE that assigns window.FHData, so it loads here in a sandbox
 * with a stub fetch/localStorage. It is tested from src/ rather than from
 * public/ because package.json's test glob only walks src/ and scripts/.
 *
 * The rule under test is the one that broke a screen: an HTTP 404 means two
 * completely different things, and reporting the wrong one told the user the
 * backend was down when it was up and answering correctly.
 */
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA_JS = path.resolve(HERE, "../../public/app/data.js");
const SRC = fs.readFileSync(DATA_JS, "utf8");

/* load — evaluate data.js against a stubbed browser and hand back FHData.
   `respond` receives the requested path and returns { status, body } — body is
   serialised, or the literal string NOT_JSON to simulate an HTML error page. */
function load(respond, { demo = false, token = "t0ken" } = {}) {
  const store = { fh_token: token };
  if (demo) store.fh_demo = "1";

  const calls = [];
  const win = {};
  const sandbox = {
    window: win,
    document: { getElementById: () => null, querySelectorAll: () => [] },
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; }
    },
    location: { search: "" },
    fetch: (p) => {
      calls.push(p);
      let r;
      // A browser fetch REJECTS on a transport failure, it does not throw. The
      // stub must reproduce that, or it tests a shape the code never sees.
      try { r = respond(p); } catch (e) { return Promise.reject(e); }
      if (r === "THROW_SYNC") throw new Error("fetch is not a function");
      return Promise.resolve({
        status: r.status,
        json: () => (r.body === "NOT_JSON"
          ? Promise.reject(new Error("Unexpected token < in JSON"))
          : Promise.resolve(r.body))
      });
    }
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: DATA_JS });
  return { FH: win.FHData, calls };
}

const ok = (body) => () => ({ status: 200, body: { ok: true, ...body } });

describe("public/app/data.js — result classification", () => {

  test("it loads and exposes the reader surface", () => {
    const { FH } = load(ok({}));
    assert.equal(typeof FH, "object");
    for (const fn of ["clients", "client", "pipeline", "wire", "explain", "banner"]) {
      assert.equal(typeof FH[fn], "function", `FHData.${fn} is missing`);
    }
  });

  // ── the defect this file exists for ────────────────────────────────────────

  test("a 404 from the ROUTER means /api/* is not deployed", async () => {
    // netlify/functions/api.mjs answers an unmatched path with exactly this.
    const { FH } = load(() => ({
      status: 404, body: { ok: false, error: "not_found", path: "dashboard/client" }
    }));
    const r = await FH.client("f3263bdb-45da-4056-8d6c-7c999d944fee");
    assert.equal(r.ok, false);
    assert.equal(r.source, "offline");
  });

  test("a 404 from an ENDPOINT means the record is missing, not the backend", async () => {
    // api/dashboard/client.mjs answers a real-but-absent id with this.
    const { FH } = load(() => ({
      status: 404, body: { ok: false, error: "client not found" }
    }));
    const r = await FH.client("f3263bdb-45da-4056-8d6c-7c999d944fee");
    assert.equal(r.ok, false);
    assert.equal(r.source, "notfound",
      "a stale id in the URL must not be reported as an outage");
  });

  test("the two 404s are distinguishable — the whole point", async () => {
    const router = load(() => ({ status: 404, body: { ok: false, error: "not_found", path: "x" } }));
    const record = load(() => ({ status: 404, body: { ok: false, error: "client not found" } }));
    const a = await router.FH.client("f3263bdb-45da-4056-8d6c-7c999d944fee");
    const b = await record.FH.client("f3263bdb-45da-4056-8d6c-7c999d944fee");
    assert.notEqual(a.source, b.source);
  });

  test("a 404 whose body is not JSON falls back to offline", async () => {
    // An edge/CDN 404 page is HTML. That genuinely is "not deployed".
    const { FH } = load(() => ({ status: 404, body: "NOT_JSON" }));
    const r = await FH.client("f3263bdb-45da-4056-8d6c-7c999d944fee");
    assert.equal(r.source, "offline");
  });

  test("error:'not_found' WITHOUT a path is a record miss, not the router", async () => {
    // readHandler({single:true}) answers a missing row with error:"not_found"
    // and no path. Matching on the string alone would misread it as an outage.
    const { FH } = load(() => ({ status: 404, body: { ok: false, error: "not_found" } }));
    const r = await FH.client("f3263bdb-45da-4056-8d6c-7c999d944fee");
    assert.equal(r.source, "notfound");
  });

  test("a 400 is the caller's fault and is reported as such", async () => {
    const { FH } = load(() => ({ status: 400, body: { ok: false, error: "invalid_id" } }));
    const r = await FH.client("zzz-not-a-uuid");
    assert.equal(r.source, "badrequest");
    assert.equal(r.error, "invalid_id");
  });

  // ── the classifications that already existed must not regress ──────────────

  test("401 and 403 are both 'unauthorized'", async () => {
    for (const status of [401, 403]) {
      const { FH } = load(() => ({ status, body: { ok: false } }));
      const r = await FH.clients();
      assert.equal(r.source, "unauthorized", `HTTP ${status}`);
    }
  });

  test("503 or db:'down' is 'nodb', which is NOT the same as offline", async () => {
    const a = load(() => ({ status: 503, body: { ok: false, error: "database unreachable" } }));
    const b = load(() => ({ status: 200, body: { ok: true, db: "down" } }));
    assert.equal((await a.FH.clients()).source, "nodb");
    assert.equal((await b.FH.clients()).source, "nodb");
  });

  test("a transport failure is 'offline'", async () => {
    const { FH } = load(() => { throw new Error("network error"); });
    const r = await FH.clients();
    assert.equal(r.source, "offline");
  });

  test("a demo session never touches the network", async () => {
    const { FH, calls } = load(ok({ clients: [] }), { demo: true });
    const r = await FH.clients();
    assert.equal(r.source, "demo");
    assert.equal(calls.length, 0, "demo mode issued a real request");
  });

  test("a 200 with rows is the only 'api' result", async () => {
    const { FH } = load(ok({ clients: [{ id: "1" }] }));
    const r = await FH.clients();
    assert.equal(r.ok, true);
    assert.equal(r.source, "api");
    assert.equal(r.data.clients.length, 1);
  });

  test("no reader ever rejects — a screen must not need a .catch", async () => {
    const { FH } = load(() => { throw new Error("boom"); });
    for (const fn of ["clients", "pipeline"]) {
      const r = await FH[fn]();  // would fail the test if it rejected
      assert.equal(r.ok, false);
    }
  });

  test("even a fetch that throws SYNCHRONOUSLY resolves — the contract is absolute", async () => {
    // Not a browser behaviour, but the contract says no reader rejects, and no
    // screen has a .catch to save it if one did.
    const { FH } = load(() => "THROW_SYNC");
    const r = await FH.clients();
    assert.equal(r.ok, false);
    assert.equal(r.source, "offline");
  });

  test("client(undefined) short-circuits to 'nodata' without a request", async () => {
    const { FH, calls } = load(ok({}));
    const r = await FH.client(undefined);
    assert.equal(r.source, "nodata");
    assert.equal(calls.length, 0);
  });

  test("the id is URL-encoded, so a crafted id cannot alter the path", async () => {
    const { FH, calls } = load(ok({}));
    await FH.client("../../admin?x=1");
    assert.equal(calls.length, 1);
    assert.ok(!calls[0].includes("../"), `path traversal survived: ${calls[0]}`);
  });
});

describe("public/app/data.js — explain() tone", () => {
  let FH;
  const painted = [];
  beforeEach(() => {
    painted.length = 0;
    FH = load(ok({})).FH;
    FH._parts = {};
    FH.banner = (tone, text, key) => { painted.push({ tone, text, key }); };
  });

  test("a missing record is 'sample' tone, never 'error'", () => {
    FH.explain({ ok: false, source: "notfound", error: "no such record" }, "documents");
    assert.equal(painted[0].tone, "sample",
      "a working backend reporting an absent row must not look like an outage");
  });

  test("a rejected parameter is 'sample' tone too", () => {
    FH.explain({ ok: false, source: "badrequest", error: "invalid_id" }, "documents");
    assert.equal(painted[0].tone, "sample");
  });

  test("a real outage IS 'error' tone — the sample path must not swallow it", () => {
    FH.explain({ ok: false, source: "offline", error: "network error" }, "documents");
    assert.equal(painted[0].tone, "error");
    FH.explain({ ok: false, source: "nodb", error: "database unreachable" }, "documents");
    assert.equal(painted[1].tone, "error");
  });

  test("being signed out is an error the user can act on", () => {
    FH.explain({ ok: false, source: "unauthorized", error: "not signed in" }, "documents");
    assert.equal(painted[0].tone, "error");
    assert.match(painted[0].text, /signed in/);
  });
});
