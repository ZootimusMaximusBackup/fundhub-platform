// Downloader behaviour, proven against a real HTTP server on loopback.
//
// This matters more than usual here: the actual federal hosts (data.sba.gov,
// data.transportation.gov) are unreachable from CI and from the build
// container, so without these tests the download path would be the one link in
// the pipeline that had never executed. A local server exercises the real
// code — sockets, gzip, Range resume, backoff — rather than a stub.

import { test } from "node:test";
import assert from "node:assert";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { openSource, downloadToDisk, RateLimiter } from "./fetch.mjs";

const BODY = "name,city\r\n" + Array.from({ length: 200 }, (_, i) => `Acme ${i} LLC,Reno`).join("\r\n") + "\r\n";

/** Spin up a server; returns {url, close, requests}. */
async function serve(handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ url: req.url, range: req.headers.range, ua: req.headers["user-agent"] });
    handler(req, res, requests.length);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((r) => server.close(r)),
  };
}

async function collect(iter) {
  const parts = [];
  for await (const c of iter) parts.push(Buffer.from(c));
  return Buffer.concat(parts).toString("utf8");
}

test("openSource: plain HTTP body, and we identify ourselves", async () => {
  const s = await serve((req, res) => {
    res.writeHead(200, { "content-type": "text/csv", "content-length": Buffer.byteLength(BODY) });
    res.end(BODY);
  });
  try {
    const got = await collect(openSource({ url: `${s.url}/f.csv`, rateLimiter: new RateLimiter(0) }));
    assert.equal(got, BODY);
    assert.match(s.requests[0].ua, /fundhub-marketing-warehouse/);
  } finally { await s.close(); }
});

test("openSource: .gz is transparently gunzipped", async () => {
  const gz = zlib.gzipSync(Buffer.from(BODY));
  const s = await serve((req, res) => {
    res.writeHead(200, { "content-type": "application/gzip", "content-length": gz.length });
    res.end(gz);
  });
  try {
    const got = await collect(openSource({ url: `${s.url}/f.csv.gz`, rateLimiter: new RateLimiter(0) }));
    assert.equal(got, BODY);
  } finally { await s.close(); }
});

test("openSource: retries a 503 with backoff, then succeeds", async () => {
  const s = await serve((req, res, n) => {
    if (n === 1) { res.writeHead(503, { "retry-after": "0" }); res.end("busy"); return; }
    res.writeHead(200, { "content-length": Buffer.byteLength(BODY) });
    res.end(BODY);
  });
  try {
    const got = await collect(openSource({ url: `${s.url}/f.csv`, rateLimiter: new RateLimiter(0) }));
    assert.equal(got, BODY);
    assert.equal(s.requests.length, 2);
  } finally { await s.close(); }
});

test("openSource: resumes mid-stream with a Range request after a dropped socket", async () => {
  const buf = Buffer.from(BODY);
  const CUT = 500;
  const s = await serve((req, res, n) => {
    if (n === 1) {
      // Advertise resumability, send a prefix, then kill the socket.
      res.writeHead(200, { "content-length": buf.length, "accept-ranges": "bytes" });
      res.write(buf.subarray(0, CUT));
      setImmediate(() => res.socket.destroy());
      return;
    }
    const m = /bytes=(\d+)-/.exec(req.headers.range || "");
    const start = m ? Number(m[1]) : 0;
    res.writeHead(206, {
      "content-range": `bytes ${start}-${buf.length - 1}/${buf.length}`,
      "content-length": buf.length - start,
      "accept-ranges": "bytes",
    });
    res.end(buf.subarray(start));
  });
  try {
    const got = await collect(openSource({ url: `${s.url}/f.csv`, rateLimiter: new RateLimiter(0) }));
    // The whole file, exactly once — no duplicated prefix.
    assert.equal(got, BODY);
    assert.equal(s.requests.length, 2);
    assert.equal(s.requests[1].range, `bytes=${CUT}-`);
  } finally { await s.close(); }
});

test("openSource: a server that ignores Range fails loudly instead of corrupting", async () => {
  const buf = Buffer.from(BODY);
  const s = await serve((req, res, n) => {
    if (n === 1) {
      res.writeHead(200, { "content-length": buf.length, "accept-ranges": "bytes" });
      res.write(buf.subarray(0, 400));
      setImmediate(() => res.socket.destroy());
      return;
    }
    // Ignores the Range header and restarts the file.
    res.writeHead(200, { "content-length": buf.length });
    res.end(buf);
  });
  try {
    await assert.rejects(
      () => collect(openSource({ url: `${s.url}/f.csv`, rateLimiter: new RateLimiter(0), maxRetries: 1 })),
      /resume failed|ignored Range/
    );
  } finally { await s.close(); }
});

test("openSource: consumer stopping early aborts the request", async () => {
  let aborted = false;
  const s = await serve((req, res) => {
    req.on("aborted", () => { aborted = true; });
    res.writeHead(200, { "content-type": "text/csv" });
    // Never-ending body: only an abort ends this.
    const timer = setInterval(() => res.write("x".repeat(1024)), 5);
    res.on("close", () => clearInterval(timer));
  });
  try {
    const iter = openSource({ url: `${s.url}/big.csv`, rateLimiter: new RateLimiter(0) });
    let seen = 0;
    for await (const chunk of iter) {
      seen += chunk.length;
      if (seen > 2048) break;      // walk away, as --limit does
    }
    assert.ok(seen > 0);
    await new Promise((r) => setTimeout(r, 100));
    assert.ok(aborted, "server should have observed the client abort");
  } finally { await s.close(); }
});

test("RateLimiter: enforces a floor between requests", async () => {
  const rl = new RateLimiter(120);
  const t0 = Date.now();
  await rl.wait(); await rl.wait(); await rl.wait();
  const elapsed = Date.now() - t0;
  assert.ok(elapsed >= 240, `expected >=240ms across 3 waits, got ${elapsed}ms`);
});

test("openSource: local files, including gzipped ones", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mkt-fetch-"));
  try {
    const plain = path.join(dir, "a.csv");
    const gz = path.join(dir, "b.csv.gz");
    fs.writeFileSync(plain, BODY);
    fs.writeFileSync(gz, zlib.gzipSync(Buffer.from(BODY)));

    assert.equal(await collect(openSource({ file: plain })), BODY);
    assert.equal(await collect(openSource({ file: gz })), BODY);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("downloadToDisk: resumes a partial download rather than re-pulling", async () => {
  const buf = Buffer.from(BODY);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mkt-dl-"));
  const dest = path.join(dir, "out.csv");
  const CUT = 300;

  // Pre-seed a .part file, as an interrupted run would leave behind.
  fs.writeFileSync(`${dest}.part`, buf.subarray(0, CUT));

  const s = await serve((req, res) => {
    const m = /bytes=(\d+)-/.exec(req.headers.range || "");
    const start = m ? Number(m[1]) : 0;
    res.writeHead(start ? 206 : 200, {
      "content-length": buf.length - start,
      "accept-ranges": "bytes",
      ...(start ? { "content-range": `bytes ${start}-${buf.length - 1}/${buf.length}` } : {}),
    });
    res.end(buf.subarray(start));
  });

  try {
    await downloadToDisk(`${s.url}/f.csv`, dest, { rateLimiter: new RateLimiter(0) });
    assert.equal(fs.readFileSync(dest, "utf8"), BODY);
    assert.equal(s.requests[0].range, `bytes=${CUT}-`, "should have asked only for the remainder");
  } finally {
    await s.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
