#!/usr/bin/env node
// Ticket 1 prove: closer session must not GET /api/demo/mode (no 403).
// Local netlify already on BASE_URL. Password from gitignored .env. Never printed.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const OUT = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL || "http://localhost:8888";
const EMAIL = "closer@fundhub.ai";

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

fs.mkdirSync(OUT, { recursive: true });

const demoModeRequests = [];
function recordDemo(kind, req, extra) {
  const u = req.url();
  if (!u.includes("/api/demo/mode")) return;
  demoModeRequests.push({
    kind,
    method: req.method(),
    url: u.replace(BASE, ""),
    ...extra
  });
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 860 } });
page.on("request", (req) => recordDemo("request", req, {}));
page.on("response", (res) => {
  recordDemo("response", res.request(), { status: res.status() });
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
await page.waitForTimeout(1500);

const landingUrl = page.url().replace(BASE, "");
const landingTitle = await page.title();
await page.screenshot({ path: path.join(OUT, "shot.png"), fullPage: false });

// HOME /dashboard.html does not load shell.js. Prove the named gate on a
// shell screen from the original 26/27 (pipeline). Do not open
// closer-dashboard.html — that file also loads demo-client-bootstrap.js
// (out of ticket scope) which fetches /api/demo/mode on its own.
await page.goto(`${BASE}/app/pipeline.html`, { waitUntil: "domcontentloaded" });
await page.waitForLoadState("networkidle").catch(() => {});
await page.waitForTimeout(2500);
const shellUrl = page.url().replace(BASE, "");
const shellTitle = await page.title();
await page.screenshot({ path: path.join(OUT, "pipeline.png"), fullPage: false });

const storage = await page.evaluate(() => ({
  role: localStorage.getItem("fh_role"),
  hasToken: !!localStorage.getItem("fh_token")
}));

const network = {
  email: EMAIL,
  base: BASE,
  ranAt: new Date().toISOString(),
  loginOk,
  landingUrl,
  landingTitle,
  shellUrl,
  shellTitle,
  storage,
  demoModeRequests,
  note: demoModeRequests.length === 0
    ? "none — closer session never requested /api/demo/mode"
    : "see demoModeRequests"
};

fs.writeFileSync(path.join(OUT, "network.json"), JSON.stringify(network, null, 2) + "\n");

await browser.close();
console.log("loginOk", loginOk, "landing", landingUrl, "shell", shellUrl, "demoModeHits", demoModeRequests.length);
