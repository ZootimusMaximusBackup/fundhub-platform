/* Typed-URL proof: owner still lands on a killed screen. */
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(HERE, "../../../../public");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
  const file = path.join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end("not found"); return;
  }
  res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => {
  localStorage.setItem("fh_role", "owner");
  localStorage.setItem("fh_token", "nav-kill-url");
});
await ctx.route("**/api/**", (route) => {
  if (route.request().url().includes("/api/auth/session")) {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, staff: { id: "1", name: "DEMO Owner", email: "owner@demo.fundhub.local", role: "owner" } })
    });
  }
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, db: "up" }) });
});

const pages = ["finance-os.html", "journeys.html", "automations.html", "consent-capture.html"];
const out = [];
const page = await ctx.newPage();
for (const file of pages) {
  await page.goto(`${BASE}/app/${file}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForFunction(() => !document.getElementById("fh-gate-style"), { timeout: 15000 });
  const landed = page.url().split("/").pop().split("?")[0];
  out.push({ typed: file, landed, stayed: landed === file });
}
await browser.close();
server.close();
fs.writeFileSync(path.join(HERE, "url-still-works.json"), JSON.stringify({ at: new Date().toISOString(), out }, null, 2));
if (out.some((r) => !r.stayed)) {
  console.error(out);
  process.exit(1);
}
console.log(JSON.stringify(out));
