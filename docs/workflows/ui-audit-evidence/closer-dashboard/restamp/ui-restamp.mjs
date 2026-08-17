#!/usr/bin/env node
// Live HIGH-row restamp helper. READ-ONLY against production.
// Writes ONLY under docs/workflows/ui-audit-evidence/<slug>/restamp/
// Intercepts every non-GET /api/** except login. Never overwrites original audit files.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith("--"));
const flag = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : dflt; };
const has = (name) => argv.includes(name);
const [screenArg, email] = positional;
if (!screenArg || !email) {
  console.error("usage: ui-restamp.mjs <screen.html[?query]> <email> --slug <slug> [--click LABEL] [--width 1440]");
  process.exit(2);
}

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const BASE = flag("--base", "https://fundhub.ai");
const STATE_DIR = process.env.UI_AUDIT_STATE_DIR || path.join(os.tmpdir(), "fundhub-ui-restamp-state");
fs.mkdirSync(STATE_DIR, { recursive: true });
const STATE_FILE = path.join(STATE_DIR, email.replace(/[^a-z0-9@.-]/gi, "_") + ".json");
const screenPath = screenArg.startsWith("/") ? screenArg : "/app/" + screenArg;
const screenFile = screenPath.split("/").pop().split("?")[0];
const SLUG = flag("--slug", screenFile.replace(/\.html$/, ""));
const OUT = path.join(ROOT, "docs/workflows/ui-audit-evidence", SLUG, "restamp");
fs.mkdirSync(OUT, { recursive: true });
const WIDTH = Number(flag("--width", "1440"));
const CLICK = flag("--click", "");

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
const password = loadEnvPassword();
if (!password) { console.error("STAFF_E2E_PASSWORD missing"); process.exit(2); }

const out = {
  screen: screenPath, slug: SLUG, email, base: BASE, ranAt: new Date().toISOString(),
  login: {}, load: {}, probe: {}, click: null,
};

const browser = await chromium.launch();
let storageState;
if (fs.existsSync(STATE_FILE) && (Date.now() - fs.statSync(STATE_FILE).mtimeMs) < 6 * 3600e3) {
  try {
    const st = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    const origin = (st.origins || []).find((o) => o.origin === BASE);
    const tok = origin && (origin.localStorage || []).find((kv) => kv.name === "fh_token");
    if (tok && tok.value) {
      const probe = await (await browser.newContext()).request.get(BASE + "/api/auth/session", { headers: { authorization: "Bearer " + tok.value }, timeout: 20_000 }).catch(() => null);
      if (probe && probe.ok()) storageState = st;
    }
  } catch { storageState = undefined; }
}

const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 900 }, ...(storageState ? { storageState } : {}) });
const page = await ctx.newPage();
let apiCalls = [];
let consoleErrors = [];
let dialogs = [];
let intercepted = [];
page.on("response", (res) => {
  const u = res.url();
  if (u.includes("/api/")) apiCalls.push({ method: res.request().method(), url: u.replace(BASE, ""), status: res.status() });
});
page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(String(msg.text()).slice(0, 220)); });
page.on("pageerror", (err) => consoleErrors.push("pageerror: " + String(err?.message || err).slice(0, 220)));
page.on("dialog", async (d) => { dialogs.push({ type: d.type(), message: d.message().slice(0, 240) }); await d.dismiss().catch(() => {}); });

await ctx.route("**/api/**", async (route) => {
  const req = route.request();
  if (req.method() === "GET" || req.method() === "HEAD") return route.continue();
  if (/\/api\/auth\/login(\?|$)/.test(req.url())) return route.continue();
  intercepted.push({ method: req.method(), url: req.url().replace(BASE, "") });
  return route.fulfill({ status: 599, contentType: "application/json", body: JSON.stringify({ ok: false, error: "audit_intercepted" }) });
});

if (storageState) {
  out.login = { ok: true, cached: true };
  await page.goto(`${BASE}/app/`, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(400);
  out.login.landedAt = page.url().replace(BASE, "");
} else {
  await page.goto(`${BASE}/login.html`, { waitUntil: "domcontentloaded" });
  await page.locator('#email, input[type="email"]').first().fill(email);
  await page.locator('#pw, input[type="password"]').first().fill(password);
  await page.locator('#go, button[type="submit"]').first().click();
  try { await page.waitForURL((u) => !/login\.html/.test(u.toString()), { timeout: 30_000 }); out.login.ok = true; } catch { out.login.ok = false; }
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(600);
  out.login.landedAt = page.url().replace(BASE, "");
  if (out.login.ok) { try { fs.writeFileSync(STATE_FILE, JSON.stringify(await ctx.storageState())); } catch { /* ignore */ } }
  else { console.error("login failed for " + email); await browser.close(); process.exit(3); }
}

apiCalls = []; consoleErrors = []; dialogs = []; intercepted = [];
const resp = await page.goto(BASE + screenPath, { waitUntil: "domcontentloaded", timeout: 45_000 });
await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
await page.waitForTimeout(1800);
out.load.httpStatus = resp ? resp.status() : null;
out.load.finalUrl = page.url().replace(BASE, "");
out.load.bounced = !page.url().includes(screenFile);
out.load.title = await page.title().catch(() => "");
out.load.apiFails = apiCalls.filter((c) => c.status >= 400);
out.load.consoleErrors = consoleErrors.slice(0, 10);

const foldShot = path.join(OUT, `${WIDTH}-fold.png`);
await page.screenshot({ path: foldShot });
out.load.fold = path.relative(ROOT, foldShot);

out.probe = await page.evaluate(() => {
  const txt = (el) => (el && (el.textContent || "").replace(/\s+/g, " ").trim()) || "";
  const vis = (el) => {
    if (!el) return false;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const buttons = [...document.querySelectorAll("button, a[href], [role=button]")].filter(vis).map((el) => {
    const cs = getComputedStyle(el);
    const bg = cs.backgroundColor;
    const filled = /rgba?\(/.test(bg) && !/^rgba?\(0,\s*0,\s*0,\s*0\)$/.test(bg) && bg !== "transparent";
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || "",
      text: txt(el).slice(0, 80),
      disabled: !!el.disabled,
      hiddenAttr: el.hasAttribute("hidden"),
      filled,
      bg,
      w: Math.round(r.width),
      h: Math.round(r.height),
      x: Math.round(r.x),
      y: Math.round(r.y),
    };
  });
  const navItems = [...document.querySelectorAll("#fh-side-nav a.navitem, nav a.navitem, aside a.navitem")].filter(vis).map(txt);
  const navGroups = [...document.querySelectorAll(".navhead, .navgroup > .head, [data-nav-group]")].filter(vis).map(txt);
  const h1 = [...document.querySelectorAll("h1")].filter(vis).map(txt);
  const body = (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 8000);
  const chip = document.querySelector("#fh-session-chip, .fh-session-chip, [data-fh-session]");
  const search = [...document.querySelectorAll("button, input")].find((el) => /search/i.test(txt(el) + (el.placeholder || "") + (el.id || "")));
  const dismiss = [...document.querySelectorAll("button")].find((el) => /^dismiss$/i.test(txt(el)));
  const overlap = (a, b) => {
    if (!a || !b) return false;
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    return !(ra.right <= rb.left || ra.left >= rb.right || ra.bottom <= rb.top || ra.top >= rb.bottom);
  };
  return {
    h1,
    navVisibleCount: navItems.length,
    navItems: navItems.slice(0, 40),
    navGroups: navGroups.slice(0, 20),
    filledButtons: buttons.filter((b) => b.filled && !b.disabled).map((b) => b.text || b.id).filter(Boolean),
    buttons: buttons.slice(0, 80),
    chipText: chip ? txt(chip).slice(0, 120) : null,
    chipCoversSearch: !!(chip && search && overlap(chip, search)),
    chipCoversDismiss: !!(chip && dismiss && overlap(chip, dismiss)),
    bodySample: body,
  };
});

if (CLICK) {
  const beforeDialogs = dialogs.length;
  const handle = page.getByRole("button", { name: new RegExp(CLICK, "i") }).first();
  const visible = await handle.isVisible().catch(() => false);
  if (!visible) {
    out.click = { label: CLICK, result: "NOT-FOUND" };
  } else {
    await handle.click({ timeout: 4000, force: false }).catch(async (err) => {
      out.click = { label: CLICK, result: "CLICK-FAIL", error: String(err.message || err).slice(0, 200) };
    });
    await page.waitForTimeout(800);
    if (!out.click) {
      out.click = {
        label: CLICK,
        result: intercepted.length ? "WRITE-INTERCEPTED" : (dialogs.length > beforeDialogs ? "DIALOG" : "DOM-OR-NONE"),
        dialogs: dialogs.slice(beforeDialogs),
        intercepted: intercepted.slice(),
      };
    }
    const after = path.join(OUT, `${WIDTH}-after-click.png`);
    await page.screenshot({ path: after });
    out.click.shot = path.relative(ROOT, after);
  }
}

if (WIDTH === 1440) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  const mShot = path.join(OUT, "390-fold.png");
  await page.screenshot({ path: mShot });
  out.load.mobileFold = path.relative(ROOT, mShot);
}

const probePath = path.join(OUT, "probe.json");
fs.writeFileSync(probePath, JSON.stringify(out, null, 2));
console.log(JSON.stringify({
  slug: SLUG,
  bounced: out.load.bounced,
  fold: out.load.fold,
  probe: probePath,
  nav: out.probe.navVisibleCount,
  filled: out.probe.filledButtons,
  chipCoversSearch: out.probe.chipCoversSearch,
  chipCoversDismiss: out.probe.chipCoversDismiss,
  h1: out.probe.h1,
  click: out.click && out.click.result,
  apiFails: (out.load.apiFails || []).slice(0, 6),
}, null, 2));
await browser.close();
