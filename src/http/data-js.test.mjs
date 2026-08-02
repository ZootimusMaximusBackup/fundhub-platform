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
    // A bare machine code is not shown on screen — a sentence is.
    assert.match(r.error, /request was not accepted/i);
  });

  test("a 400 with a plain-English message shows that message, not the code", async () => {
    const { FH } = load(() => ({
      status: 400,
      body: {
        ok: false,
        error: "invalid_template_key",
        message: "A template's short name needs letters, numbers and hyphens."
      }
    }));
    const r = await FH.write("/api/contracts", { action: "create_template" });
    assert.equal(r.source, "badrequest");
    assert.match(r.error, /short name/i);
    assert.ok(!/invalid_template_key/.test(r.error));
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

  // ── audit m17: a crashed handler is not a database outage ──────────────────

  test("a 500 from a handler that THREW is 'server', not 'nodb'", async () => {
    // netlify/functions/api.mjs:334 — every error a handler throws is wrapped
    // into exactly this. It used to arrive as source "nodb", so the screen told
    // the user the database was unreachable for a fault in our own code.
    const { FH } = load(() => ({
      status: 500, body: { ok: false, error: "internal_error", message: "x is not a function" }
    }));
    const r = await FH.clients();
    assert.equal(r.ok, false);
    assert.equal(r.source, "server",
      "a crashed handler must not be reported as a database outage");
    // Prefer the server's sentence over "HTTP 500 internal_error".
    assert.equal(r.error, "x is not a function");
  });

  test("a 500 write_failed with a human message never shows the raw code", async () => {
    const { FH } = load(() => ({
      status: 500,
      body: { ok: false, error: "write_failed", message: "Something went wrong saving that. Try again in a moment." }
    }));
    const r = await FH.write("/api/contracts", { action: "create_template" });
    assert.equal(r.source, "server");
    assert.match(r.error, /went wrong saving/i);
    assert.ok(!/write_failed/.test(r.error));
  });

  test("a 500 from a handler that never answered is 'server' too", async () => {
    // netlify/functions/api.mjs:327 — returned without writing a response.
    const { FH } = load(() => ({ status: 500, body: { ok: false, error: "handler_no_response" } }));
    assert.equal((await FH.clients()).source, "server");
  });

  test("a 200 body that simply is not ok is 'server', not 'nodb'", async () => {
    const { FH } = load(() => ({ status: 200, body: { ok: false, error: "request failed" } }));
    assert.equal((await FH.clients()).source, "server");
  });

  test("the database outage and the server crash are distinguishable", async () => {
    // The whole point of the finding. If these two ever collapse back into one
    // source, the banner starts naming the wrong system again.
    const db = load(() => ({ status: 503, body: { ok: false, error: "database unreachable" } }));
    const crash = load(() => ({ status: 500, body: { ok: false, error: "internal_error" } }));
    const gone = load(() => { throw new Error("network error"); });
    const sources = [
      (await db.FH.clients()).source,
      (await crash.FH.clients()).source,
      (await gone.FH.clients()).source
    ];
    assert.deepEqual(sources, ["nodb", "server", "offline"],
      "three different faults with three different owners must not share a source");
  });

  test("db:'down' still wins over the status — the database gets to speak first", async () => {
    // A 500 whose body says db:"down" IS the database. The order of the two
    // checks in get() is what makes that true; this pins it.
    const { FH } = load(() => ({ status: 500, body: { ok: false, db: "down", error: "no connection" } }));
    assert.equal((await FH.clients()).source, "nodb");
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
    FH.explain({ ok: false, source: "server", error: "HTTP 500 internal_error" }, "documents");
    assert.equal(painted[2].tone, "error");
  });

  /* ── audit m17: the words a human reads have to name the right system ──────
     These assert wording, which normally is not worth pinning. It is here,
     because the wording IS the defect: the banner fired correctly and named the
     wrong system, and the cost was somebody spending an outage in the database
     while the fault sat in the function logs. */

  test("only a database outage is allowed to say 'database is not answering'", () => {
    FH.explain({ ok: false, source: "nodb", error: "database unreachable" }, "documents");
    assert.match(painted[0].text, /the database is not answering/);
  });

  test("a crashed handler blames our side, and does not name the database as the cause", () => {
    FH.explain({ ok: false, source: "server", error: "HTTP 500 internal_error" }, "documents");
    const text = painted[0].text;
    assert.match(text, /something went wrong on our side/,
      "the reader has to be sent to the server, not to the database");
    assert.doesNotMatch(text, /the database is not answering/,
      "a server crash must not be worded as a database outage");
    assert.match(text, /did not report a problem/,
      "it must say what is known — not report — rather than claiming the database is fine");
    assert.match(text, /HTTP 500 internal_error/, "the detail has to survive for whoever debugs it");
  });

  test("no failure message uses words a non-engineer has to look up", () => {
    // CLAUDE.md §10 — this screen text is read by the person deciding who to
    // call. "backend", "handler" and "5xx" all tell them nothing.
    const cases = [
      { ok: false, source: "nodb", error: "database unreachable" },
      { ok: false, source: "server", error: "HTTP 500 internal_error" },
      { ok: false, source: "offline", error: "network error" },
      { ok: false, source: "weird-new-thing", error: "no detail" }
    ];
    for (const res of cases) {
      painted.length = 0;
      FH._parts = {};
      FH.explain(res, "documents");
      for (const word of ["backend", "handler", "5xx", "endpoint", "null"]) {
        assert.doesNotMatch(painted[0].text, new RegExp(word, "i"),
          `source "${res.source}" says "${word}" to a reader who does not know what it means: ` +
          painted[0].text);
      }
    }
  });

  test("an unrecognised source admits it does not know, instead of guessing", () => {
    // The old fallback asserted "backend unavailable" for anything it had not
    // seen before. A confident wrong cause is worse than an honest vague one.
    FH.explain({ ok: false, source: "weird-new-thing", error: "no detail" }, "documents");
    assert.match(painted[0].text, /cannot tell why/);
    assert.match(painted[0].text, /weird-new-thing/, "the raw source still has to be printed");
  });

  test("nothing came back at all reads differently from an answer that was bad", () => {
    FH.explain({ ok: false, source: "offline", error: "network error" }, "documents");
    FH.explain({ ok: false, source: "server", error: "HTTP 500 internal_error" }, "d2");
    assert.match(painted[0].text, /could not reach the server/);
    assert.notEqual(painted[0].text, painted[1].text);
  });

  test("being signed out is an error the user can act on", () => {
    FH.explain({ ok: false, source: "unauthorized", error: "not signed in" }, "documents");
    assert.equal(painted[0].tone, "error");
    assert.match(painted[0].text, /signed in/);
  });
});
