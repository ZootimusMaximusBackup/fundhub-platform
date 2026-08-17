#!/usr/bin/env node
// One-shot: click #d1 on live closer-call, intercept writes, screenshot restamp only.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const BASE = "https://fundhub.ai";
const CLIENT = "8556bedc-46e1-4d85-b0cd-a24adfee1521";
const OUT = path.join(ROOT, "docs/workflows/ui-audit-evidence/closer-call/restamp");
const STATE_DIR = process.env.UI_AUDIT_STATE_DIR || path.join(os.tmpdir(), "fundhub-ui-restamp-state");
const STATE_FILE = path.join(STATE_DIR, "closer@fundhub.ai.json");
fs.mkdirSync(OUT, { recursive: true });

function loadEnvPassword() {
  if (process.env.STAFF_E2E_PASSWORD) return process.env.STAFF_E2E_PASSWORD;
  const p = path.join(ROOT, ".env");
  if (!fs.existsSync(p)) return "";
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?STAFF_E2E_PASSWORD\s*=\s*(.*)\s*$/);
    if (m) return m[1].replace(/^["']|["']$/g, "");
  }
  return "";
}

const browser = await chromium.launch();
let storageState;
if (fs.existsSync(STATE_FILE)) {
  try { storageState = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch { storageState = undefined; }
}
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...(storageState ? { storageState } : {}) });
const page = await ctx.newPage();
const intercepted = [];
const dialogs = [];
page.on("dialog", async (d) => { dialogs.push({ type: d.type(), message: d.message().slice(0, 240) }); await d.dismiss().catch(() => {}); });
await ctx.route("**/api/**", async (route) => {
  const req = route.request();
  if (req.method() === "GET" || req.method() === "HEAD") return route.continue();
  if (/\/api\/auth\/login(\?|$)/.test(req.url())) return route.continue();
  intercepted.push({ method: req.method(), url: req.url().replace(BASE, ""), postData: String(req.postData() || "").slice(0, 400) });
  return route.fulfill({ status: 599, contentType: "application/json", body: JSON.stringify({ ok: false, error: "audit_intercepted" }) });
});

if (!storageState) {
  const password = loadEnvPassword();
  await page.goto(`${BASE}/login.html`, { waitUntil: "domcontentloaded" });
  await page.locator('#email, input[type="email"]').first().fill("closer@fundhub.ai");
  await page.locator('#pw, input[type="password"]').first().fill(password);
  await page.locator('#go, button[type="submit"]').first().click();
  await page.waitForURL((u) => !/login\.html/.test(u.toString()), { timeout: 30_000 });
}

await page.goto(`${BASE}/app/closer-call.html?client_id=${CLIENT}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
await page.waitForTimeout(2500);

const before = await page.evaluate(() => {
  const boxes = ["d1", "d2", "d3", "d4"].map((id) => {
    const el = document.getElementById(id);
    if (!el) return { id, present: false };
    const r = el.getBoundingClientRect();
    return { id, present: true, checked: !!el.checked, w: Math.round(r.width), h: Math.round(r.height), visible: r.width > 0 && r.height > 0 };
  });
  return { h1: document.querySelector("h1")?.textContent?.trim() || "", boxes, url: location.href };
});

const d1 = page.locator("#d1");
const visible = await d1.isVisible().catch(() => false);
let click = { visible };
if (visible) {
  await d1.click({ timeout: 4000 }).catch((err) => { click.error = String(err.message || err).slice(0, 200); });
  await page.waitForTimeout(800);
  click.after = await page.evaluate(() => {
    const el = document.getElementById("d1");
    return { checked: !!(el && el.checked), localStorageKeys: Object.keys(localStorage).filter((k) => /d1|close|check|complain/i.test(k)).slice(0, 20) };
  });
}

const shot = path.join(OUT, "1440-after-d1.png");
await page.screenshot({ path: shot });
const out = { ranAt: new Date().toISOString(), before, click, intercepted, dialogs, shot: path.relative(ROOT, shot) };
fs.writeFileSync(path.join(OUT, "d1-click.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify({ h1: before.h1, boxes: before.boxes, click, intercepted, dialogs, shot: out.shot }, null, 2));
await browser.close();
