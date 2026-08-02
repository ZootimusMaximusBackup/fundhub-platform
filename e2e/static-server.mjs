// A static file server for the browser tests. Serves public/ and nothing else.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY THE SPECS DO NOT JUST OPEN THE FILE.
//
// The first version of these tests loaded the screen over file://, which looks
// simpler and does not work. Three things break at once and each fails in a way
// that reads like a broken page rather than a broken harness:
//
//   * localStorage is unavailable or origin-opaque on file://, and
//     public/app/shell.js reads a session token from it on load. No token means
//     it redirects to the login page, so the test waits forever for a
//     conversation list on a screen that is not the one it asked for.
//   * fetch("/api/read/inbox") resolves to file:///api/read/inbox, which Chrome
//     refuses outright — so page.route() never sees a request to intercept.
//   * Relative <script src> and stylesheet loads are subject to file:// origin
//     rules that do not match how the page is really served.
//
// An http origin removes all three, and it costs about forty lines.
//
// THIS IS NOT scripts/dev-server.mjs. That one proxies /api/* through the real
// Netlify handler, which needs a database and a session. These tests answer
// /api/** themselves with page.route(), so a server that knows about the API
// would be a second source of truth fighting the first. This serves files.
//
// PORT 0 MEANS "PICK ONE". A hardcoded port is a test that fails on the machine
// where something else already holds it, and a CI runner is exactly where that
// happens. The chosen port is printed on stdout, which is what the config's
// webServer block waits for.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../public");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2"
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith("/")) rel += "index.html";

  /* Path traversal is refused rather than served. This binds to localhost and
     runs for the length of a test run, so the exposure is small — but a static
     server that will hand out ../../.env when asked is not a thing to leave in
     a repository, however short its life. */
  const abs = path.resolve(ROOT, "." + rel);
  if (!abs.startsWith(ROOT)) {
    res.writeHead(403).end("forbidden");
    return;
  }

  fs.readFile(abs, (err, body) => {
    if (err) {
      res.writeHead(404, { "content-type": "text/plain" }).end("not found");
      return;
    }
    res.writeHead(200, { "content-type": TYPES[path.extname(abs)] || "application/octet-stream" });
    res.end(body);
  });
});

/* PORT is set by the Playwright config, which needs to know it in advance to
   build baseURL. Port 0 is still supported for a manual run. */
const requested = Number(process.env.E2E_PORT || 0);
server.listen(requested, "127.0.0.1", () => {
  // The line the webServer block waits for. Keep the shape — it is matched.
  console.log(`e2e static server listening on http://127.0.0.1:${server.address().port}/`);
});
