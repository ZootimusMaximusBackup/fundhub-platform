#!/usr/bin/env node
// Campaigns BEFORE capture — READ-ONLY.
//
// The shared UI-audit harness cannot do the one thing this capture needs: the
// Campaigns screen shows nothing until a partner is chosen in #partnerSel, and
// choosing one navigates to ?partner_id=<id>. This script picks the first real
// partner, waits for every panel, and writes the shots + the page's own words.
//
// Read-only guarantee: every non-GET /api/** request is answered with a
// synthetic 599 and never leaves the browser. The one exception is
// POST /api/auth/login, which is how we sign in. The session is cached in
// $UI_AUDIT_STATE_DIR (same file the harness uses) so we log in once — live
// rate-limits login bursts with a 429.
//
// Usage: node docs/workflows/campaigns-readable-2026-08-17-evidence/_tools/campaigns-before.mjs
// Output: docs/workflows/campaigns-readable-2026-08-17-evidence/before/ by default.
//         Set OUT_DIR=<full path> for the AFTER shots, or the BEFORE ones are overwritten.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const BASE = process.env.BASE_URL || "https://fundhub.ai";
const EMAIL = "owner@fundhub.ai";
const SCREEN = "/app/campaign-manager.html";
const OUT_DIR = process.env.OUT_DIR || path.join(ROOT, "docs/workflows/campaigns-readable-2026-08-17-evidence/before");
const STATE_DIR = process.env.UI_AUDIT_STATE_DIR || path.join(os.tmpdir(), "fundhub-ui-audit-state");
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(STATE_DIR, { recursive: true });
const STATE_FILE = path.join(STATE_DIR, EMAIL.replace(/[^a-z0-9@.-]/gi, "_") + "@" + BASE.replace(/[^a-z0-9.]/gi, "_") + ".json");

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
if (!password) { console.error("STAFF_E2E_PASSWORD missing — cannot sign in"); process.exit(2); }

const out = { base: BASE, screen: SCREEN, email: EMAIL, ranAt: new Date().toISOString(), login: {}, partnerPicker: {}, load: {}, panels: {}, mobile: {} };

const browser = await chromium.launch();

const guard = async (context) => {
  await context.route("**/api/**", async (route) => {
    const req = route.request();
    if (req.method() === "GET" || req.method() === "HEAD") return route.continue();
    if (/\/api\/auth\/login(\?|$)/.test(req.url())) return route.continue();
    return route.fulfill({ status: 599, contentType: "application/json", body: JSON.stringify({ ok: false, error: "capture_intercepted" }) });
  });
};

// reuse a cached session if it is still good
let storageState;
if (fs.existsSync(STATE_FILE) && (Date.now() - fs.statSync(STATE_FILE).mtimeMs) < 6 * 3600e3) {
  try {
    const st = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    const origin = (st.origins || []).find((o) => o.origin === BASE);
    const tok = origin && (origin.localStorage || []).find((kv) => kv.name === "fh_token");
    if (tok && tok.value) {
      const probeCtx = await browser.newContext();
      const probe = await probeCtx.request.get(BASE + "/api/auth/session", { headers: { authorization: "Bearer " + tok.value }, timeout: 20_000 }).catch(() => null);
      if (probe && probe.ok()) storageState = st;
      await probeCtx.close();
    }
  } catch { storageState = undefined; }
}

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...(storageState ? { storageState } : {}) });
await guard(ctx);
const page = await ctx.newPage();

let apiCalls = [];
let consoleErrors = [];
page.on("response", (res) => { const u = res.url(); if (u.includes("/api/")) apiCalls.push({ method: res.request().method(), url: u.replace(BASE, ""), status: res.status() }); });
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(String(m.text()).slice(0, 200)); });
page.on("pageerror", (e) => consoleErrors.push("pageerror: " + String(e?.message || e).slice(0, 200)));
page.on("dialog", async (d) => { await d.dismiss().catch(() => {}); });

// ---- 1. sign in ------------------------------------------------------------
if (storageState) {
  out.login = { ok: true, cached: true };
} else {
  await page.goto(BASE + "/login.html", { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.locator('#email, input[type="email"]').first().fill(EMAIL);
  await page.locator('#pw, input[type="password"]').first().fill(password);
  apiCalls = [];
  await page.locator('#go, button[type="submit"]').first().click();
  try { await page.waitForURL((u) => !/login\.html/.test(u.toString()), { timeout: 30_000 }); out.login.ok = true; } catch { out.login.ok = false; }
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(800);
  out.login.loginApiStatus = (apiCalls.find((c) => /\/api\/auth\/login/.test(c.url) && c.method === "POST") || {}).status ?? null;
  if (out.login.ok) { try { fs.writeFileSync(STATE_FILE, JSON.stringify(await ctx.storageState())); } catch { /* ignore */ } }
  else { console.error("login failed (status " + out.login.loginApiStatus + ")"); }
}
out.login.landedAt = page.url().replace(BASE, "");

// ---- 2. open the screen with no partner, read the picker -------------------
apiCalls = []; consoleErrors = [];
await page.goto(BASE + SCREEN, { waitUntil: "domcontentloaded", timeout: 45_000 });
await page.waitForLoadState("networkidle", { timeout: 25_000 }).catch(() => {});
await page.waitForTimeout(2500);
out.partnerPicker = await page.evaluate(() => {
  const sel = document.getElementById("partnerSel");
  if (!sel) return { present: false };
  return {
    present: true,
    disabled: !!sel.disabled,
    optionCount: sel.options.length,
    options: [...sel.options].map((o) => ({ value: o.value, label: (o.textContent || "").trim() })),
  };
});
await page.screenshot({ path: path.join(OUT_DIR, "1440-no-partner-fold.png") });
out.partnerPicker.apiFails = apiCalls.filter((c) => c.status >= 400);

const real = (out.partnerPicker.options || []).filter((o) => o.value);
if (!real.length) {
  fs.writeFileSync(path.join(OUT_DIR, "capture.json"), JSON.stringify(out, null, 2));
  console.error("no real partner options in #partnerSel — nothing to select. See capture.json");
  await browser.close();
  process.exit(1);
}
const partner = real[0];
out.partnerChosen = partner;

// ---- 3. load with the partner selected -------------------------------------
const URL_WITH_PARTNER = BASE + SCREEN + "?partner_id=" + encodeURIComponent(partner.value);
apiCalls = []; consoleErrors = [];
await page.goto(URL_WITH_PARTNER, { waitUntil: "domcontentloaded", timeout: 45_000 });
await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
// the footer says "nothing loaded yet" until the readers answer; wait for it to move
await page.waitForFunction(() => {
  const f = document.getElementById("footNote");
  return f && !/nothing loaded yet/i.test(f.textContent || "");
}, null, { timeout: 30_000 }).catch(() => {});
await page.waitForTimeout(3500);

out.load = {
  finalUrl: page.url().replace(BASE, ""),
  selectedInDropdown: await page.evaluate(() => { const s = document.getElementById("partnerSel"); return s ? { value: s.value, label: s.selectedOptions[0] ? s.selectedOptions[0].textContent.trim() : null } : null; }),
  apiCalls: apiCalls.slice(),
  apiFails: apiCalls.filter((c) => c.status >= 400),
  consoleErrors: consoleErrors.slice(0, 12),
};

// ---- 4. what each panel actually holds -------------------------------------
out.panels = await page.evaluate(() => {
  const txt = (el) => (el ? (el.textContent || "").replace(/\s+/g, " ").trim() : null);
  const body = (id, label) => {
    const tb = document.getElementById(id);
    if (!tb) return { panel: label, tbody: id, present: false };
    const trs = [...tb.querySelectorAll("tr")];
    // an empty/error state renders as one row with a single wide cell
    const single = trs.length === 1 && trs[0].querySelectorAll("td").length === 1;
    return {
      panel: label, tbody: id, present: true,
      rowCount: trs.length,
      looksLikeStateRow: single,
      firstRowText: txt(trs[0]) ? txt(trs[0]).slice(0, 220) : null,
      dataRows: single ? 0 : trs.length,
    };
  };
  const rail = (id) => { const r = document.getElementById(id); return r ? { count: r.children.length, text: txt(r).slice(0, 300) } : null; };
  return {
    statRow: { tiles: (document.getElementById("statRow") || { children: [] }).children.length, text: txt(document.getElementById("statRow")) },
    sources: (() => {
      const tb = document.getElementById("srcRows");
      if (!tb) return null;
      return [...tb.querySelectorAll("tr")].map((tr) => [...tr.querySelectorAll("td")].map((td) => txt(td)));
    })(),
    needsAttention: rail("attnRow"),
    spend: { ...body("spendRows", "Spend vs ceilings"), rail: rail("spendRail"), foot: txt(document.getElementById("spendFoot")) },
    campaigns: { ...body("campRows", "Campaign list"), rail: rail("campRail"), foot: txt(document.getElementById("campPager")) },
    fatigue: { ...body("fatRows", "Creative fatigue"), rail: rail("fatRail"), foot: txt(document.getElementById("fatFoot")) },
    connections: { ...body("connRows", "Connections"), rail: rail("connRail"), foot: txt(document.getElementById("connFoot")) },
    actionLog: { ...body("logRows", "Action log"), rail: rail("logRail"), foot: txt(document.getElementById("logFoot")) },
    footNote: txt(document.getElementById("footNote")),
    scope: { name: txt(document.getElementById("scopeName")), pid: txt(document.getElementById("scopePid")), badge: txt(document.getElementById("scopeBadge")), how: txt(document.getElementById("scopeHow")) },
    greyCapBlocks: [...document.querySelectorAll(".cap")].filter((el) => {
      const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
      return cs.display !== "none" && r.height > 0 && (el.textContent || "").trim();
    }).map((el) => ({ text: (el.textContent || "").replace(/\s+/g, " ").trim(), h: Math.round(el.getBoundingClientRect().height), top: Math.round(el.getBoundingClientRect().top + scrollY) })),
    docHeight: Math.round(document.documentElement.scrollHeight),
  };
});

// ---- 5. the shots + the page's own words -----------------------------------
await page.screenshot({ path: path.join(OUT_DIR, "1440-fold.png") });
await page.screenshot({ path: path.join(OUT_DIR, "1440-full.png"), fullPage: true });
const visibleText = await page.evaluate(() => {
  const main = document.querySelector(".main") || document.body;
  return { main: main.innerText, side: (document.querySelector("#side") || { innerText: "" }).innerText };
});
fs.writeFileSync(path.join(OUT_DIR, "1440-visible-text.txt"),
  "# Campaigns — rendered visible text, 1440 wide, partner selected\n" +
  "# " + URL_WITH_PARTNER + "\n# partner: " + partner.label + "\n# captured " + out.ranAt + "\n\n" +
  "===== SIDEBAR =====\n" + visibleText.side + "\n\n===== MAIN =====\n" + visibleText.main + "\n");

// ---- 6. mobile -------------------------------------------------------------
{
  const state = await ctx.storageState();
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: state, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await guard(mctx);
  const mp = await mctx.newPage();
  const mFails = [];
  mp.on("response", (r) => { if (r.url().includes("/api/") && r.status() >= 400) mFails.push({ method: r.request().method(), url: r.url().replace(BASE, ""), status: r.status() }); });
  try {
    await mp.goto(URL_WITH_PARTNER, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await mp.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
    await mp.waitForTimeout(3500);
    await mp.screenshot({ path: path.join(OUT_DIR, "390-fold.png") });
    await mp.screenshot({ path: path.join(OUT_DIR, "390-full.png"), fullPage: true });
    const mtext = await mp.evaluate(() => (document.querySelector(".main") || document.body).innerText);
    fs.writeFileSync(path.join(OUT_DIR, "390-visible-text.txt"),
      "# Campaigns — rendered visible text, 390 wide, partner selected\n# " + URL_WITH_PARTNER + "\n\n" + mtext + "\n");
    out.mobile = await mp.evaluate(() => ({
      scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      horizontalOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > innerWidth + 2,
      docHeight: Math.round(document.documentElement.scrollHeight),
    }));
    out.mobile.apiFails = mFails;
  } catch (e) { out.mobile = { error: String(e?.message || e).slice(0, 200) }; }
  await mctx.close();
}

fs.writeFileSync(path.join(OUT_DIR, "capture.json"), JSON.stringify(out, null, 2));
console.log("partner: " + partner.label + " (" + partner.value + ")");
console.log("picker options (real): " + real.length + " of " + out.partnerPicker.optionCount);
for (const k of ["spend", "campaigns", "fatigue", "connections", "actionLog"]) {
  const p = out.panels[k];
  console.log("  " + k.padEnd(12) + " rows=" + p.rowCount + " dataRows=" + p.dataRows + " | " + (p.firstRowText || "").slice(0, 90));
}
console.log("footNote: " + out.panels.footNote);
console.log("api fails: " + JSON.stringify(out.load.apiFails));
console.log("console errors: " + JSON.stringify(out.load.consoleErrors));
console.log("wrote " + OUT_DIR);
await browser.close();
