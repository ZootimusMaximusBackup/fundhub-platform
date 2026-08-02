#!/usr/bin/env node
// The local dev server — static screens AND a working /api/*.
//
// WHY THIS EXISTS. HANDOFF's setup said `npx http-server public`, which serves
// the HTML and nothing else: every /api/* request 404s, so the seeded logins are
// rejected at the login screen and no screen can reach real data. Following the
// documented steps exactly produced an app that looked broken. Every ad-hoc
// verification harness in this project had to reimplement this, which is the
// clearest possible sign it belonged in the repo.
//
// It routes /api/* through the REAL Netlify function handler — the same module
// the deploy target runs — so what you see locally is what the deployed site
// does, rather than a second, subtly different local implementation.
//
//   DATABASE_URL=... node scripts/dev-server.mjs [--port 8899]
//   → http://127.0.0.1:8899/login.html

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");
const argv = process.argv;
const PORT = Number(argv[argv.indexOf("--port") + 1]) || Number(process.env.PORT) || 8899;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  /* .mjs matters as much as .js now that public/vendor/pdfjs holds ES modules.
     Served as application/octet-stream a browser REFUSES to execute them —
     "Failed to load module script: expected a JavaScript module script but the
     server responded with a MIME type of application/octet-stream" — so the
     contract field editor renders nothing at all locally while working fine on
     the deploy target, which is the most confusing shape a bug can take. */
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2"
};

if (!process.env.DATABASE_URL) {
  console.warn(
    "! DATABASE_URL is not set. The screens will serve, /api/health will report\n" +
    "  state:\"unconfigured\", and every screen will fall back to its sample markup.\n"
  );
}

// Imported lazily so the server still starts (and says why) if the handler
// module itself fails to load.
let apiHandler = null;
try {
  ({ default: apiHandler } = await import("../netlify/functions/api.mjs"));
} catch (err) {
  console.error("! /api/* is unavailable — the function module failed to load:");
  console.error("  " + (err && err.message));
}

const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, "http://localhost"); }
  catch { res.writeHead(400); res.end("bad request"); return; }

  if (url.pathname.startsWith("/api/")) {
    if (!apiHandler) {
      res.writeHead(503, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "api_unavailable" }));
      return;
    }
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const r = await apiHandler(new Request("http://localhost" + req.url, {
        method: req.method,
        headers: req.headers,
        body: chunks.length ? Buffer.concat(chunks) : undefined
      }), {});
      const headers = {};
      r.headers.forEach((v, k) => { headers[k] = v; });
      res.writeHead(r.status, headers);
      res.end(Buffer.from(await r.arrayBuffer()));
    } catch (err) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "dev_server_error", message: String(err && err.message) }));
    }
    return;
  }

  // Static. Resolve inside ROOT and refuse anything that escapes it.
  const rel = decodeURIComponent(url.pathname === "/" ? "/login.html" : url.pathname);
  const full = path.resolve(ROOT, "." + rel);
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) {
    res.writeHead(403); res.end("forbidden"); return;
  }
  let file = full;
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!fs.existsSync(file)) { res.writeHead(404); res.end("not found"); return; }

  res.writeHead(200, {
    "content-type": MIME[path.extname(file)] || "application/octet-stream",
    "cache-control": "no-store"          // always serve the file on disk
  });
  res.end(fs.readFileSync(file));
});

server.listen(PORT, () => {
  console.log(`fundhub dev server → http://127.0.0.1:${PORT}/login.html`);
  console.log(`  static: ${ROOT}`);
  console.log(`  api:    ${apiHandler ? "netlify/functions/api.mjs (the real handler)" : "UNAVAILABLE"}`);
  console.log(`  db:     ${process.env.DATABASE_URL ? "configured" : "NOT SET — screens will show sample data"}`);
});
