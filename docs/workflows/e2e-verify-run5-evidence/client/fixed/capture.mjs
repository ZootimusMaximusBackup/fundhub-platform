#!/usr/bin/env node
// One-shot: same check as the board S4 client landing, using local patched
// login.html (storeSession writes fh_account) and live https://fundhub.ai APIs.
// Password from gitignored .env. Never printed. Token never written.

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const PUBLIC = path.join(ROOT, "public");
const OUT = path.dirname(fileURLToPath(import.meta.url));
const LIVE = "https://fundhub.ai";
const EMAIL = "client@fundhub.ai";

function loadPassword() {
  if (process.env.STAFF_E2E_PASSWORD) return process.env.STAFF_E2E_PASSWORD;
  const p = path.join(ROOT, ".env");
  if (!fs.existsSync(p)) return "";
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?STAFF_E2E_PASSWORD\s*=\s*(.*)\s*$/);
    if (m) return m[1].replace(/^["']|["']$/g, "");
  }
  return "";
}

const password = loadPassword();
if (!password) {
  console.error("STAFF_E2E_PASSWORD missing");
  process.exit(2);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon"
};

function safeFile(urlPath) {
  const rel = decodeURIComponent((urlPath.split("?")[0] || "/")).replace(/\\/g, "/");
  if (rel.includes("\0") || rel.includes("..")) return null;
  let file = path.join(PUBLIC, rel === "/" ? "index.html" : rel);
  if (rel.endsWith("/")) file = path.join(PUBLIC, rel, "index.html");
  const resolved = path.resolve(file);
  if (!resolved.startsWith(PUBLIC)) return null;
  return resolved;
}

const server = http.createServer(async (req, res) => {
  try {
    if ((req.url || "").startsWith("/api/")) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = Buffer.concat(chunks);
      const headers = { accept: req.headers.accept || "application/json" };
      if (req.headers.authorization) headers.authorization = req.headers.authorization;
      if (req.headers["content-type"]) headers["content-type"] = req.headers["content-type"];
      const init = { method: req.method, headers };
      if (req.method !== "GET" && req.method !== "HEAD") init.body = body;
      const r = await fetch(LIVE + req.url, init);
      const buf = Buffer.from(await r.arrayBuffer());
      res.writeHead(r.status, {
        "content-type": r.headers.get("content-type") || "application/json",
        "cache-control": "no-store"
      });
      res.end(buf);
      return;
    }
    const file = safeFile(req.url || "/");
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  } catch (err) {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end("proxy error");
  }
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const BASE = `http://127.0.0.1:${port}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 860 } });

const portalSummaryHits = [];
page.on("response", async (res) => {
  const u = res.url();
  if (!u.includes("/api/read/portal-summary")) return;
  let body = null;
  try { body = await res.json(); } catch { body = { _parse: "failed" }; }
  portalSummaryHits.push({
    url: u.replace(BASE, "").replace(LIVE, ""),
    status: res.status(),
    method: res.request().method(),
    body
  });
});

await page.goto(`${BASE}/login.html`, { waitUntil: "domcontentloaded" });
await page.locator("#email, input[type=email]").first().fill(EMAIL);
await page.locator("#pw, input[type=password]").first().fill(password);

const leftLogin = page.waitForURL((u) => !/login\.html/.test(u.toString()), { timeout: 30_000 });
await page.locator("#go, button[type=submit]").first().click();
let loginOk = false;
try {
  await leftLogin;
  loginOk = true;
} catch {
  loginOk = false;
}

await page.waitForLoadState("networkidle").catch(() => {});
const summaryWait = page.waitForResponse(
  (r) => r.url().includes("/api/read/portal-summary") && r.request().method() === "GET",
  { timeout: 15_000 }
).then(() => true).catch(() => false);
const sawSummary = await summaryWait;
await page.waitForTimeout(1500);

const storage = await page.evaluate(() => {
  let account = null;
  try { account = JSON.parse(localStorage.getItem("fh_account") || "null"); } catch (e) {}
  return {
    role: localStorage.getItem("fh_role"),
    hasToken: !!localStorage.getItem("fh_token"),
    account: account && {
      kind: account.kind || null,
      clientId: account.clientId || account.client_id || null,
      name: account.name || null
    }
  };
});

const landing = await page.evaluate(() => {
  const banner = document.querySelector("[data-fh-banner], #fh-data-banner, .fh-data-banner, footer .banner, #fh-banner");
  return {
    greeting: (document.getElementById("greeting") || {}).textContent || "",
    greetingSub: (document.getElementById("greeting-sub-pre") || {}).textContent || "",
    whoName: (document.getElementById("who-name") || {}).textContent || "",
    prequal: (document.getElementById("sb-prequal-amt") || {}).textContent || "",
    banner: banner ? (banner.textContent || "").trim().replace(/\s+/g, " ") : "",
    title: document.title
  };
});

const shot = path.join(OUT, "01-landing.png");
await page.screenshot({ path: shot, fullPage: false });

const lastSummary = portalSummaryHits[portalSummaryHits.length - 1] || null;
fs.writeFileSync(path.join(OUT, "portal-summary.json"), JSON.stringify(lastSummary, null, 2) + "\n");

const capture = {
  email: EMAIL,
  html: "local public/ (patched storeSession) ; API proxied to " + LIVE,
  base: BASE,
  ranAt: new Date().toISOString(),
  loginOk,
  leftLoginUrl: page.url().replace(BASE, ""),
  storage,
  landing,
  sawPortalSummaryRequest: sawSummary,
  portalSummaryHitCount: portalSummaryHits.length,
  shot: "docs/workflows/e2e-verify-run5-evidence/client/fixed/01-landing.png",
  portalSummaryFile: "docs/workflows/e2e-verify-run5-evidence/client/fixed/portal-summary.json"
};
fs.writeFileSync(path.join(OUT, "capture.json"), JSON.stringify(capture, null, 2) + "\n");

await browser.close();
server.close();
console.log("wrote", OUT);
console.log("loginOk", loginOk, "summaryHits", portalSummaryHits.length, "greeting", landing.greeting);
