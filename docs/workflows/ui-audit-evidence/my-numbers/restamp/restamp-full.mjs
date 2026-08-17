#!/usr/bin/env node
// Full-page restamp shot only. No writes. Session from closer cache.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const BASE = "https://fundhub.ai";
const slug = process.argv[2];
const screen = process.argv[3];
const email = process.argv[4] || "closer@fundhub.ai";
if (!slug || !screen) {
  console.error("usage: restamp-full.mjs <slug> <screen.html[?q]> [email]");
  process.exit(2);
}
const OUT = path.join(ROOT, "docs/workflows/ui-audit-evidence", slug, "restamp");
fs.mkdirSync(OUT, { recursive: true });
const STATE_FILE = path.join(process.env.UI_AUDIT_STATE_DIR || path.join(os.tmpdir(), "fundhub-ui-restamp-state"), email.replace(/[^a-z0-9@.-]/gi, "_") + ".json");

const browser = await chromium.launch();
let storageState;
if (fs.existsSync(STATE_FILE)) storageState = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...(storageState ? { storageState } : {}) });
const page = await ctx.newPage();
await ctx.route("**/api/**", async (route) => {
  const req = route.request();
  if (req.method() === "GET" || req.method() === "HEAD" || /\/api\/auth\/login(\?|$)/.test(req.url())) return route.continue();
  return route.fulfill({ status: 599, contentType: "application/json", body: JSON.stringify({ ok: false, error: "audit_intercepted" }) });
});
const screenPath = screen.startsWith("/") ? screen : "/app/" + screen;
await page.goto(BASE + screenPath, { waitUntil: "domcontentloaded", timeout: 45_000 });
await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
await page.waitForTimeout(2000);
const full = path.join(OUT, "1440-full.png");
await page.screenshot({ path: full, fullPage: true });
const text = await page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " "));
const excerptPath = path.join(OUT, "full-text.txt");
fs.writeFileSync(excerptPath, text);
console.log(JSON.stringify({ full: path.relative(ROOT, full), chars: text.length, hasOwed: /Owed by you/i.test(text), hasNow: /\bNow\b/.test(text), hasGmt: /GMT\+0000/.test(text), has10of: /10 of /.test(text) }));
await browser.close();
