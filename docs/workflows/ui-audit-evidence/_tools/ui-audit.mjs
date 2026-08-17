#!/usr/bin/env node
// UI Auditor evidence tool — READ-ONLY. One screen, one role.
//
// What it does (nothing else):
//  1. Signs in as the given role on /login.html (password from gitignored .env,
//     never printed).
//  2. Opens ONE screen at 1440x900, waits for the network to settle, and takes
//     two screenshots (viewport = "above the fold", and full page).
//  3. Reads the DOM for the things docs/UI-STANDARDS.md cares about: font-size
//     count, nav item count + active state, content width, page height vs the
//     900px fold, control inventory with hit sizes, generic button labels,
//     ALL-CAPS runs, sample/demo/loading wording, spacing values off the 8px
//     scale, tables + alignment, primary-looking buttons.
//  4. Repeats the screenshot at 390x844 and records horizontal overflow.
//  5. Click sweep: clicks every visible control that is not a sidebar nav row,
//     not "sign out", not an external link, and not disabled. Every non-GET
//     request to /api/** is INTERCEPTED and answered with a synthetic 599 so
//     nothing is written anywhere — the sweep records what the control tried
//     to call. GETs pass through and their status is recorded. Dialogs are
//     dismissed (Cancel) and recorded. After each click the DOM/URL delta is
//     compared: no delta + no request + no dialog = NOOP (suspect dead).
//     A control that produced a 401/403 GET is FORBIDDEN.
//
// Usage:
//   node docs/workflows/ui-audit-evidence/_tools/ui-audit.mjs <screen[.html][?query]> <role-email> [--slug name] [--base URL] [--no-clicks] [--max-clicks N]
//   e.g. node docs/workflows/ui-audit-evidence/_tools/ui-audit.mjs pipeline.html closer@fundhub.ai
//        node docs/workflows/ui-audit-evidence/_tools/ui-audit.mjs "closer-call.html?client_id=<uuid>" closer@fundhub.ai --slug closer-call
//   BASE_URL defaults to https://fundhub.ai (the local netlify dev server answers
//   503 "db down" under the concurrent reads a screen fires — measured 2026-08-17,
//   16 parallel /api/auth/session → 14×503 — which bounces the shell to login and
//   would poison every finding). Live app files were hash-identical to the
//   working tree at 2b1eed0 when this was written.
//   Session state is cached per role under $UI_AUDIT_STATE_DIR (default os tmp)
//   so each role logs in once, not once per screen — live rate-limits bursts.
// Output: docs/workflows/ui-audit-evidence/<slug>/{audit.json,audit.md,1440-fold.png,1440-full.png,390-full.png,clicks/*.png}

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
  console.error("usage: ui-audit.mjs <screen[.html][?query]> <role-email> [--slug name] [--base URL] [--no-clicks] [--max-clicks N]");
  process.exit(2);
}
const ROOT = process.cwd();
const BASE = flag("--base", process.env.BASE_URL || "https://fundhub.ai");
const STATE_DIR = flag("--state-dir", process.env.UI_AUDIT_STATE_DIR || path.join(os.tmpdir(), "fundhub-ui-audit-state"));
fs.mkdirSync(STATE_DIR, { recursive: true });
const STATE_FILE = path.join(STATE_DIR, email.replace(/[^a-z0-9@.-]/gi, "_") + "@" + BASE.replace(/[^a-z0-9.]/gi, "_") + ".json");
const screenPath = screenArg.startsWith("/") ? screenArg : "/app/" + screenArg;
const screenFile = screenPath.split("/").pop().split("?")[0];
const SLUG = flag("--slug", screenFile.replace(/\.html$/, "").replace(/[^a-z0-9-]/gi, "_"));
const OUT_DIR = path.join(ROOT, "docs/workflows/ui-audit-evidence", SLUG);
const CLICK_DIR = path.join(OUT_DIR, "clicks");
fs.mkdirSync(CLICK_DIR, { recursive: true });
const DO_CLICKS = !has("--no-clicks");
const MAX_CLICKS = Number(flag("--max-clicks", "80"));
const rel = (p) => path.relative(ROOT, p);
// Explicit controls, plus things that behave like controls in this codebase
// (kanban cards, table rows with data ids, data-action hooks). Outermost
// cursor:pointer elements are added at inventory time as "viaCursor".
const CTRL_SEL = "button, a[href], input, select, textarea, summary, [role=button], [role=tab], [role=link], [role=menuitem], [role=option], [role=switch], [role=checkbox], [onclick], [draggable=true], [data-action], [data-href], [data-id][tabindex], tr[data-id], li[data-id]";

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
if (!password) { console.error("STAFF_E2E_PASSWORD missing from env/.env — cannot log in"); process.exit(2); }

const out = {
  screen: screenPath, slug: SLUG, email, base: BASE, ranAt: new Date().toISOString(),
  login: {}, load: {}, dom: null, mobile: null, clicks: [], clickSummary: null
};

const browser = await chromium.launch();
// Reuse a cached, still-valid session for this role if we have one.
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
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...(storageState ? { storageState } : {}) });
const page = await ctx.newPage();

// ---- collectors ------------------------------------------------------------
let apiCalls = [];      // {method,url,status}
let consoleErrors = [];
let dialogs = [];
let intercepted = [];   // non-GET /api/ requests we refused to send
page.on("response", (res) => {
  const u = res.url();
  if (u.includes("/api/")) apiCalls.push({ method: res.request().method(), url: u.replace(BASE, ""), status: res.status() });
});
page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(String(msg.text()).slice(0, 200)); });
page.on("pageerror", (err) => consoleErrors.push("pageerror: " + String(err?.message || err).slice(0, 200)));
page.on("dialog", async (d) => { dialogs.push({ type: d.type(), message: d.message().slice(0, 200) }); await d.dismiss().catch(() => {}); });

// Write guard: no non-GET /api call ever leaves this browser.
await ctx.route("**/api/**", async (route) => {
  const req = route.request();
  if (req.method() === "GET" || req.method() === "HEAD") return route.continue();
  // Login is the one POST we must allow, and only to /api/auth/login.
  if (/\/api\/auth\/login(\?|$)/.test(req.url())) return route.continue();
  let bodyKeys = [];
  try { const b = req.postDataJSON(); if (b && typeof b === "object") bodyKeys = Object.keys(b); } catch { /* not json */ }
  intercepted.push({ method: req.method(), url: req.url().replace(BASE, ""), bodyKeys });
  return route.fulfill({ status: 599, contentType: "application/json", body: JSON.stringify({ ok: false, error: "audit_intercepted", message: "UI audit harness refused to send this write" }) });
});

// ---- 1. login (skipped when a cached session is still valid) ---------------
if (storageState) {
  out.login = { ok: true, cached: true };
  await page.goto(`${BASE}/app/`, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(500);
  out.login.landedAt = page.url().replace(BASE, "");
  out.login.role = await page.evaluate(() => localStorage.getItem("fh_role")).catch(() => null);
} else {
  await page.goto(`${BASE}/login.html`, { waitUntil: "domcontentloaded" });
  await page.locator('#email, input[type="email"]').first().fill(email);
  await page.locator('#pw, input[type="password"]').first().fill(password);
  apiCalls = []; consoleErrors = [];
  await page.locator('#go, button[type="submit"]').first().click();
  try { await page.waitForURL((u) => !/login\.html/.test(u.toString()), { timeout: 30_000 }); out.login.ok = true; } catch { out.login.ok = false; }
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(800);
  out.login.landedAt = page.url().replace(BASE, "");
  out.login.role = await page.evaluate(() => localStorage.getItem("fh_role")).catch(() => null);
  out.login.loginApiStatus = (apiCalls.find((c) => /\/api\/auth\/login/.test(c.url) && c.method === "POST") || {}).status ?? null;
  if (out.login.ok) { try { fs.writeFileSync(STATE_FILE, JSON.stringify(await ctx.storageState())); } catch { /* ignore */ } }
  else { console.error("login failed for " + email + " (login POST status " + out.login.loginApiStatus + ")"); }
}

// ---- 2. open the screen ----------------------------------------------------
// Local netlify dev intermittently answers 503 {"db":"down"} under a screen's
// normal burst of reads (measured 2026-08-17: 16 parallel session calls → 14×503),
// which bounces the shell to login. Retry the load a few times when that
// happens so a dev-server hiccup does not read as a screen finding. Every retry
// is recorded so the auditor can see how flaky the run was.
let loadRetries = 0;
async function openScreen() {
  let resp = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    apiCalls = []; consoleErrors = []; dialogs = []; intercepted = [];
    resp = await page.goto(BASE + screenPath, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const bouncedToLogin = /login\.html/.test(page.url());
    const dbDown = apiCalls.some((c) => c.status === 503);
    if (!bouncedToLogin && !dbDown) return resp;
    loadRetries++;
    await page.waitForTimeout(3000);
  }
  return resp;
}
const resp = await openScreen();
out.load.httpStatus = resp ? resp.status() : null;
out.load.retriesFor503OrBounce = loadRetries;
out.load.finalUrl = page.url().replace(BASE, "");
out.load.bounced = !page.url().includes(screenFile);
out.load.title = await page.title().catch(() => "");
out.load.apiCalls = apiCalls.slice();
out.load.apiFails = apiCalls.filter((c) => c.status >= 400);
out.load.consoleErrors = consoleErrors.slice(0, 12);
out.load.dialogs = dialogs.slice();
const foldShot = path.join(OUT_DIR, "1440-fold.png");
const fullShot = path.join(OUT_DIR, "1440-full.png");
await page.screenshot({ path: foldShot });
await page.screenshot({ path: fullShot, fullPage: true });
out.load.shots = { fold: rel(foldShot), full: rel(fullShot) };

// ---- 3. DOM inventory ------------------------------------------------------
const DOM_SCRIPT = (CTRL_SEL) => {
  const vw = innerWidth, vh = innerHeight;
  const isVisible = (el) => {
    if (!(el instanceof Element)) return false;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    if (r.right < 0 || r.bottom < 0 || r.left > document.documentElement.scrollWidth) return false;
    if (el.closest("[hidden], [aria-hidden=true]")) return false;
    return true;
  };
  const txt = (el) => (el.textContent || "").replace(/\s+/g, " ").trim();
  const inSidebar = (el) => !!el.closest("#side, #fh-side-nav, aside.side");
  const isBetaBanner = (el) => !!el.closest("[data-fh-beta], .fh-beta, .beta-banner, #fh-beta-banner");
  const onScale = (v) => { const n = Math.round(parseFloat(v)); return n === 0 || [8, 16, 24, 32, 48, 64, 4, 12, 40, 56].includes(n); };

  // font sizes — text-bearing visible elements outside the sidebar
  const sizes = {};
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n; const seenEl = new Set();
  while ((n = walker.nextNode())) {
    const t = n.nodeValue.replace(/\s+/g, " ").trim();
    if (!t) continue;
    const el = n.parentElement;
    if (!el || seenEl.has(el) || !isVisible(el) || inSidebar(el)) continue;
    if (["SCRIPT", "STYLE", "NOSCRIPT"].includes(el.tagName)) continue;
    seenEl.add(el);
    const fs = getComputedStyle(el).fontSize;
    sizes[fs] = sizes[fs] || { count: 0, examples: [] };
    sizes[fs].count++;
    if (sizes[fs].examples.length < 3) sizes[fs].examples.push(t.slice(0, 40));
  }

  // nav
  const navItems = [...document.querySelectorAll("#fh-side-nav a.navitem, nav a.navitem, aside a.navitem")];
  const navVisible = navItems.filter(isVisible);
  const navActive = navVisible.filter((a) => /(^|\s)(active|current|is-active|on)(\s|$)/.test(a.className) || a.getAttribute("aria-current")).map(txt);
  const navGroups = [...document.querySelectorAll(".navgroup")].filter(isVisible).map((g) => ({ head: txt(g.querySelector(".navhead")) , items: [...g.querySelectorAll("a.navitem")].filter(isVisible).map(txt) }));

  // headings + page title
  const h1 = [...document.querySelectorAll("h1")].filter(isVisible).map(txt);
  const h2 = [...document.querySelectorAll("h2")].filter(isVisible).map(txt).slice(0, 12);

  // content width: widest visible block that is not the sidebar and not body/html
  let contentWidth = 0, contentSel = "";
  const mainCands = [...document.querySelectorAll("main, .main, .content, .page, .wrap, .container, .app, .screen, .grid, body > div, body > section")].filter((el) => isVisible(el) && !inSidebar(el));
  for (const el of mainCands) { const r = el.getBoundingClientRect(); if (r.width > contentWidth) { contentWidth = Math.round(r.width); contentSel = el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : ""); } }
  const sideEl = document.querySelector("aside, #side, .side");
  const sideW = sideEl && isVisible(sideEl) ? Math.round(sideEl.getBoundingClientRect().width) : 0;

  // fold
  const docH = Math.round(Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));

  // controls
  const explicit = [...document.querySelectorAll(CTRL_SEL)].filter(isVisible);
  const explicitSet = new Set(explicit);
  const pointer = [...document.querySelectorAll("body *")].filter((el) => {
    if (explicitSet.has(el) || !isVisible(el)) return false;
    if (!/^(pointer|grab)$/.test(getComputedStyle(el).cursor)) return false;
    if (el.closest(CTRL_SEL)) return false;
    const p = el.parentElement; if (p && p !== document.body && /^(pointer|grab)$/.test(getComputedStyle(p).cursor)) return false;
    const r = el.getBoundingClientRect(); return r.width >= 16 && r.height >= 12;
  });
  const ctrlEls = explicit.concat(pointer);
  const keyCount = {};
  const controls = ctrlEls.map((el, i) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const bg = cs.backgroundColor;
    const isInputLike = ["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName);
    const href = el.getAttribute("href");
    const text = (el.tagName === "INPUT" ? (el.getAttribute("placeholder") || el.value || "") : txt(el)).slice(0, 60);
    const key = el.tagName.toLowerCase() + "|" + text + "|" + (el.id || "") + "|" + (href || "");
    const ord = keyCount[key] = (keyCount[key] || 0);
    keyCount[key]++;
    return {
      idx: i, key, ord, viaCursor: !explicitSet.has(el), tag: el.tagName.toLowerCase(), type: el.getAttribute("type") || null,
      text,
      id: el.id || null, cls: (typeof el.className === "string" ? el.className : "").trim().slice(0, 60) || null,
      href, disabled: !!(el.disabled || el.getAttribute("aria-disabled") === "true"),
      w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top + scrollY), left: Math.round(r.left + scrollX),
      aboveFold: r.top + scrollY < vh,
      sidebar: inSidebar(el), beta: isBetaBanner(el), inputLike: isInputLike,
      bg, color: cs.color, filled: !isInputLike && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent" && !/rgb\(2[45]\d, 2[45]\d, 2[45]\d\)/.test(bg) && !/rgba\(0, 0, 0, 0\)/.test(bg)
    };
  });
  const genericLabels = controls.filter((c) => !c.inputLike && /^(submit|ok|okay|go|yes|no|apply|save|done|continue|next|click here|more|edit|open)$/i.test(c.text)).map((c) => c.text);
  const smallTargets = controls.filter((c) => !c.sidebar && !c.inputLike && c.text && (c.h < 40 || c.w < 40)).map((c) => ({ text: c.text, w: c.w, h: c.h }));
  const primaryLooking = controls.filter((c) => c.tag === "button" && c.filled && !c.sidebar && !c.beta && c.text).map((c) => ({ text: c.text, bg: c.bg, w: c.w, h: c.h, aboveFold: c.aboveFold }));

  // caps + wording scans on visible text blocks (non-sidebar)
  const blocks = [...document.querySelectorAll("p, li, td, th, span, div, label, small, h1, h2, h3, h4, a, button, dt, dd, caption, figcaption")].filter((el) => isVisible(el) && !inSidebar(el) && el.children.length === 0 && txt(el));
  const capsRuns = blocks.filter((el) => { const t = txt(el); const cs = getComputedStyle(el); const upper = cs.textTransform === "uppercase" || (t.length > 20 && t === t.toUpperCase() && /[A-Z]{3}/.test(t)); return upper && t.length > 24 && parseFloat(cs.fontSize) >= 13; }).map((el) => txt(el).slice(0, 60)).slice(0, 8);
  const wording = (re) => [...new Set(blocks.filter((el) => re.test(txt(el))).map((el) => txt(el).slice(0, 120)))].slice(0, 12);
  const sampleWording = wording(/\b(sample|demo|not signed in|placeholder|lorem|coming soon|mock|fake|furniture|beta)\b/i);
  const loadingWording = wording(/\b(loading|fetching)\b|…$/i);
  const errorWording = wording(/\b(error|failed|rejected|forbidden|unauthori[sz]ed|403|401|500|not found|badrequest|bad request)\b/i);
  const emptyWording = wording(/\b(no [a-z]+ yet|nothing (here|yet)|none yet|empty|add your first|0 of 0)\b/i);
  const centeredParas = [...document.querySelectorAll("p")].filter((el) => isVisible(el) && !inSidebar(el) && getComputedStyle(el).textAlign === "center" && txt(el).length > 60).map(txt).map((t) => t.slice(0, 60)).slice(0, 5);

  // spacing on card-like things
  const cardEls = [...document.querySelectorAll("[class*=card], [class*=panel], [class*=tile], [class*=kpi], [class*=metric], [class*=stat], section, .grid, [class*=grid]")].filter((el) => isVisible(el) && !inSidebar(el)).slice(0, 80);
  const offScale = {};
  for (const el of cardEls) {
    const cs = getComputedStyle(el);
    for (const p of ["paddingTop", "paddingLeft", "marginTop", "marginBottom", "gap", "rowGap", "columnGap"]) {
      const v = cs[p]; if (!v || v === "normal" || v === "0px") continue;
      if (!onScale(v)) { offScale[v] = (offScale[v] || 0) + 1; }
    }
  }
  // card rows: group visible card-like siblings by top and report width sets
  const rows = {};
  for (const el of cardEls) {
    const r = el.getBoundingClientRect(); if (r.width < 120 || r.height < 60) continue;
    const key = Math.round((r.top + scrollY) / 8) * 8;
    rows[key] = rows[key] || []; rows[key].push(Math.round(r.width));
  }
  const unevenRows = Object.entries(rows).filter(([, ws]) => ws.length >= 2 && new Set(ws).size > 1).map(([top, ws]) => ({ top: Number(top), widths: ws })).slice(0, 8);

  // tables
  const tables = [...document.querySelectorAll("table")].filter(isVisible).slice(0, 6).map((t) => {
    const ths = [...t.querySelectorAll("th")].map(txt);
    const firstRow = t.querySelector("tbody tr, tr:nth-child(2)");
    const tds = firstRow ? [...firstRow.querySelectorAll("td")] : [];
    const cols = tds.map((td, i) => { const v = txt(td); return { header: ths[i] || "", sample: v.slice(0, 24), numeric: /^[-+$€£]?[\d.,]+%?$/.test(v) || /^\$/.test(v), align: getComputedStyle(td).textAlign, tabular: /tnum|tabular-nums/.test(getComputedStyle(td).fontVariantNumeric + " " + getComputedStyle(td).fontFeatureSettings) }; });
    const rowCount = t.querySelectorAll("tbody tr").length || t.querySelectorAll("tr").length - 1;
    return { headers: ths.slice(0, 12), rowCount, cols: cols.slice(0, 12) };
  });

  // metric tiles: big numbers and whether a comparison line sits with them
  const metricEls = [...document.querySelectorAll("[class*=kpi], [class*=metric], [class*=stat], [class*=big], [class*=num], [class*=value]")].filter((el) => isVisible(el) && !inSidebar(el));
  const metrics = metricEls.map((el) => { const cs = getComputedStyle(el); return { text: txt(el).slice(0, 80), fontSize: cs.fontSize, tabular: /tnum|tabular-nums/.test(cs.fontVariantNumeric + " " + cs.fontFeatureSettings), cls: (typeof el.className === "string" ? el.className : "").slice(0, 40) }; }).filter((m) => /\d|—|-/.test(m.text)).slice(0, 20);

  // top-left first visible thing (excluding sidebar): what's at (sideW+8..sideW+400, 0..160)?
  const tl = document.elementsFromPoint(Math.min(vw - 1, (sideEl ? sideEl.getBoundingClientRect().right : 0) + 40), 40).find((el) => el !== document.documentElement && el !== document.body && !inSidebar(el));
  const topLeft = tl ? { tag: tl.tagName.toLowerCase(), text: txt(tl).slice(0, 80) } : null;

  const bodyText = document.body.innerText.replace(/\s+/g, " ").slice(0, 600);
  return { vw, vh, docH, sizes, navVisibleCount: navVisible.length, navActive, navGroups, h1, h2, contentWidth, contentSel, sideW, controlsCount: controls.length, controls, genericLabels, smallTargets: smallTargets.slice(0, 15), primaryLooking, capsRuns, sampleWording, loadingWording, errorWording, emptyWording, centeredParas, offScale, unevenRows, tables, metrics, topLeft, bodyText };
};
out.dom = await page.evaluate(DOM_SCRIPT, CTRL_SEL).catch((e) => ({ error: String(e?.message || e) }));

// ---- 4. mobile -------------------------------------------------------------
{
  const state = await ctx.storageState();
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: state, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await mctx.route("**/api/**", async (route) => {
    const req = route.request();
    if (req.method() === "GET" || req.method() === "HEAD") return route.continue();
    return route.fulfill({ status: 599, contentType: "application/json", body: JSON.stringify({ ok: false, error: "audit_intercepted" }) });
  });
  const mp = await mctx.newPage();
  const mFails = [];
  mp.on("response", (res) => { if (res.url().includes("/api/") && res.status() >= 400) mFails.push({ method: res.request().method(), url: res.url().replace(BASE, ""), status: res.status() }); });
  try {
    await mp.goto(BASE + screenPath, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await mp.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await mp.waitForTimeout(1500);
    const mshot = path.join(OUT_DIR, "390-full.png");
    await mp.screenshot({ path: mshot, fullPage: true });
    const mfold = path.join(OUT_DIR, "390-fold.png");
    await mp.screenshot({ path: mfold });
    const m = await mp.evaluate(() => {
      const sw = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
      const side = document.querySelector("aside, #side, .side");
      const sideVisible = side ? (getComputedStyle(side).display !== "none" && side.getBoundingClientRect().width > 0) : false;
      const sideW = side ? Math.round(side.getBoundingClientRect().width) : 0;
      const burger = document.querySelector("#burger, .burger, [aria-label*=menu i]");
      const overflowers = [...document.querySelectorAll("body *")].filter((el) => { const r = el.getBoundingClientRect(); return r.right > innerWidth + 2 && r.width > 40 && getComputedStyle(el).display !== "none"; }).slice(0, 6).map((el) => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\s+/)[0] : ""));
      const tiny = [...document.querySelectorAll("body *")].filter((el) => { if (!el.childNodes.length) return false; const t = (el.textContent || "").trim(); if (!t || el.children.length) return false; const fs = parseFloat(getComputedStyle(el).fontSize); const r = el.getBoundingClientRect(); return fs < 11 && r.width > 0 && r.height > 0; }).length;
      return { scrollWidth: sw, horizontalOverflow: sw > innerWidth + 2, sideVisible, sideW, burger: !!burger, overflowers, textUnder11px: tiny, docH: Math.round(document.documentElement.scrollHeight) };
    });
    out.mobile = { ...m, shots: { full: rel(mshot), fold: rel(mfold) }, finalUrl: mp.url().replace(BASE, ""), apiFails: mFails };
  } catch (e) { out.mobile = { error: String(e?.message || e).slice(0, 200) }; }
  await mctx.close();
}

// ---- 5. click sweep --------------------------------------------------------
async function domSig() {
  return page.evaluate(() => {
    const t = document.body.innerText.replace(/\d+/g, "#").replace(/\s+/g, " ");
    const fixed = [...document.querySelectorAll("body *")].filter((el) => { const cs = getComputedStyle(el); return (cs.position === "fixed" || cs.position === "absolute") && cs.display !== "none" && cs.visibility !== "hidden" && el.getBoundingClientRect().width > 80 && el.getBoundingClientRect().height > 40; }).length;
    const open = document.querySelectorAll("dialog[open], [aria-modal=true], .modal.open, .modal.show, .drawer.open, [class*=modal]:not([hidden]), [class*=drawer]:not([hidden])").length;
    return { len: t.length, head: t.slice(0, 4000), fixed, open, active: document.activeElement ? document.activeElement.tagName : "" };
  });
}

if (DO_CLICKS && out.login.ok && !out.load.bounced) {
  const targets = (out.dom.controls || []).filter((c) => !c.sidebar && !c.inputLike && !c.disabled && c.tag !== "select" && !(c.tag === "a" && c.href && /^(https?:)?\/\//.test(c.href) && !c.href.startsWith(BASE)) && !(c.tag === "a" && c.href && /^(mailto:|tel:)/.test(c.href)) && !/sign ?out|log ?out/i.test(c.text) && (c.text || c.href || c.id));
  const list = targets.slice(0, MAX_CLICKS);
  out.clickSummary = { candidates: targets.length, attempted: list.length, skippedForCap: Math.max(0, targets.length - list.length) };
  let k = 0;
  for (const c of list) {
    k++;
    const rec = { n: k, tag: c.tag, text: c.text, id: c.id, cls: c.cls, href: c.href, w: c.w, h: c.h, aboveFold: c.aboveFold };
    try {
      // re-locate by (tag|text|id|href) key + ordinal, since the DOM may have shifted
      const handle = await page.evaluateHandle(({ sel, key, ord }) => {
        const isVisible = (el) => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return cs.display !== "none" && cs.visibility !== "hidden" && r.width > 0 && r.height > 0 && r.right >= 0 && r.bottom >= 0 && !el.closest("[hidden], [aria-hidden=true]"); };
        const txt = (el) => (el.textContent || "").replace(/\s+/g, " ").trim();
        const explicit = [...document.querySelectorAll(sel)].filter(isVisible);
        const eset = new Set(explicit);
        const pointer = [...document.querySelectorAll("body *")].filter((el) => { if (eset.has(el) || !isVisible(el)) return false; if (!/^(pointer|grab)$/.test(getComputedStyle(el).cursor)) return false; if (el.closest(sel)) return false; const p = el.parentElement; if (p && p !== document.body && /^(pointer|grab)$/.test(getComputedStyle(p).cursor)) return false; const r = el.getBoundingClientRect(); return r.width >= 16 && r.height >= 12; });
        const all = explicit.concat(pointer);
        const matches = all.filter((el) => { const text = (el.tagName === "INPUT" ? (el.getAttribute("placeholder") || el.value || "") : txt(el)).slice(0, 60); return el.tagName.toLowerCase() + "|" + text + "|" + (el.id || "") + "|" + (el.getAttribute("href") || "") === key; });
        return matches[ord] || matches[matches.length - 1] || null;
      }, { sel: CTRL_SEL, key: c.key, ord: c.ord });
      const el = handle.asElement();
      if (!el) {
        rec.result = "GONE";
        const diag = await page.evaluate((sel) => ({ url: location.pathname, visibleControls: [...document.querySelectorAll(sel)].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).length, bodyLen: document.body.innerText.length }), CTRL_SEL).catch(() => null);
        rec.note = "control not visible on re-locate (DOM changed after an earlier click)"; rec.diag = diag;
        out.clicks.push(rec); continue;
      }
      const before = await domSig();
      const urlBefore = page.url();
      apiCalls = []; consoleErrors = []; dialogs = []; intercepted = [];
      await el.scrollIntoViewIfNeeded().catch(() => {});
      await el.click({ timeout: 4000, noWaitAfter: true }).catch(async (e) => { rec.clickError = String(e?.message || e).slice(0, 120); await el.click({ timeout: 2000, force: true, noWaitAfter: true }).catch(() => {}); });
      await page.waitForTimeout(1300);
      await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
      const after = await domSig().catch(() => null);
      const urlAfter = page.url();
      rec.urlChanged = urlAfter !== urlBefore ? urlAfter.replace(BASE, "") : null;
      rec.api = apiCalls.slice(0, 10);
      rec.intercepted = intercepted.slice(0, 10);
      rec.dialogs = dialogs.slice();
      rec.consoleErrors = consoleErrors.slice(0, 4);
      const domChanged = after && (after.len !== before.len || after.head !== before.head || after.fixed !== before.fixed || after.open !== before.open);
      rec.domChanged = !!domChanged;
      const forbidden = rec.api.some((a) => a.status === 401 || a.status === 403);
      const failed = rec.api.some((a) => a.status >= 400 && a.status !== 401 && a.status !== 403);
      if (rec.urlChanged && /login\.html/.test(rec.urlChanged)) rec.result = "LOGGED-OUT";
      else if (forbidden) rec.result = "FORBIDDEN";
      else if (rec.intercepted.length) rec.result = "WRITE-INTERCEPTED";
      else if (rec.urlChanged) rec.result = "NAV";
      else if (rec.dialogs.length) rec.result = "DIALOG";
      else if (failed) rec.result = "API-FAIL";
      else if (domChanged || rec.api.length) rec.result = "OK";
      else rec.result = "NOOP";
      if (["NOOP", "FORBIDDEN", "API-FAIL", "WRITE-INTERCEPTED"].includes(rec.result)) {
        const shot = path.join(CLICK_DIR, `${String(k).padStart(2, "0")}-${rec.result}-${(c.text || c.id || c.tag).replace(/[^a-z0-9]+/gi, "_").slice(0, 30)}.png`);
        await page.screenshot({ path: shot }).catch(() => {});
        rec.shot = rel(shot);
      }
      // reset: close whatever opened, or come back if we navigated
      await page.keyboard.press("Escape").catch(() => {});
      if (rec.urlChanged) {
        await openScreen();
      } else if (after && (after.open > before.open || after.fixed > before.fixed)) {
        // try common close buttons, then reload as a last resort
        const closed = await page.evaluate(() => {
          const btn = [...document.querySelectorAll("button, [role=button], a")].find((b) => { const t = (b.textContent || "").trim(); const cs = getComputedStyle(b); return cs.display !== "none" && b.getBoundingClientRect().width > 0 && (/^(close|cancel|×|✕|x|dismiss|back|done)$/i.test(t) || /close|dismiss/i.test(b.getAttribute("aria-label") || "")); });
          if (btn) { btn.click(); return true; } return false;
        }).catch(() => false);
        await page.waitForTimeout(400);
        const now = await domSig().catch(() => null);
        if (!closed || (now && (now.open > before.open || now.fixed > before.fixed))) await openScreen();
      }
    } catch (e) {
      rec.result = "ERROR"; rec.error = String(e?.message || e).slice(0, 160);
      await openScreen().catch(() => {});
    }
    out.clicks.push(rec);
  }
  const tally = {};
  for (const r of out.clicks) tally[r.result] = (tally[r.result] || 0) + 1;
  out.clickSummary.tally = tally;
  out.clickSummary.loadRetriesTotal = loadRetries;
} else {
  out.clickSummary = { skipped: true, reason: !DO_CLICKS ? "--no-clicks" : !out.login.ok ? "login failed" : "screen bounced" };
}

await browser.close();

// ---- write -----------------------------------------------------------------
fs.writeFileSync(path.join(OUT_DIR, "audit.json"), JSON.stringify(out, null, 2));
const d = out.dom || {};
const md = [];
md.push(`# UI audit evidence — ${SLUG} as ${email}`);
md.push(``);
md.push(`Ran ${out.ranAt} against ${BASE}. Login ${out.login.ok ? "ok" : "FAILED"} (role ${out.login.role ?? "—"}). Screen ${screenPath} → HTTP ${out.load.httpStatus}, final ${out.load.finalUrl}${out.load.bounced ? " **BOUNCED**" : ""}, title "${out.load.title}".`);
md.push(``);
md.push(`Shots: ${out.load.shots?.fold} · ${out.load.shots?.full} · ${out.mobile?.shots?.full ?? "(mobile failed)"}`);
md.push(``);
md.push(`## Load`);
md.push(`- API calls: ${out.load.apiCalls.length}; failing: ${out.load.apiFails.map((f) => `${f.method} ${f.url} → ${f.status}`).join("; ") || "none"}`);
md.push(`- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): ${out.load.retriesFor503OrBounce} at first open · ${out.clickSummary?.loadRetriesTotal ?? out.load.retriesFor503OrBounce} across the whole run`);
md.push(`- Console errors: ${out.load.consoleErrors.length ? out.load.consoleErrors.join(" | ") : "none"}`);
md.push(``);
md.push(`## DOM read (1440×900)`);
md.push(`- Page height ${d.docH}px (fold 900) · content width ${d.contentWidth}px (${d.contentSel}) · sidebar ${d.sideW}px`);
md.push(`- Top-left element: ${d.topLeft ? `${d.topLeft.tag} "${d.topLeft.text}"` : "—"}`);
md.push(`- H1: ${(d.h1 || []).join(" / ") || "—"} · H2s: ${(d.h2 || []).join(" / ") || "—"}`);
md.push(`- Nav: ${d.navVisibleCount} visible items · active: ${(d.navActive || []).join(", ") || "none marked"} · groups: ${(d.navGroups || []).map((g) => `${g.head}(${g.items.length})`).join(", ")}`);
md.push(`- Font sizes in use (${Object.keys(d.sizes || {}).length}): ${Object.entries(d.sizes || {}).sort((a, b) => parseFloat(b[0]) - parseFloat(a[0])).map(([s, v]) => `${s}×${v.count}`).join(", ")}`);
md.push(`- Primary-looking (filled) buttons: ${(d.primaryLooking || []).length} — ${(d.primaryLooking || []).map((b) => `"${b.text}"`).join(", ") || "none"}`);
md.push(`- Generic labels: ${(d.genericLabels || []).join(", ") || "none"} · targets under 40px: ${(d.smallTargets || []).length}`);
md.push(`- Off-8px-scale spacing values: ${Object.entries(d.offScale || {}).map(([k, v]) => `${k}×${v}`).join(", ") || "none"}`);
md.push(`- Uneven card rows: ${(d.unevenRows || []).map((r) => `top ${r.top}: [${r.widths.join(",")}]`).join("; ") || "none detected"}`);
md.push(`- ALL-CAPS runs: ${(d.capsRuns || []).length} · centered paragraphs: ${(d.centeredParas || []).length}`);
md.push(`- Sample/demo/beta wording: ${(d.sampleWording || []).join(" | ") || "none"}`);
md.push(`- Loading wording after settle: ${(d.loadingWording || []).join(" | ") || "none"}`);
md.push(`- Error wording: ${(d.errorWording || []).join(" | ") || "none"}`);
md.push(`- Empty-state wording: ${(d.emptyWording || []).join(" | ") || "none"}`);
md.push(`- Tables: ${(d.tables || []).map((t) => `[${t.headers.join(" | ")}] rows=${t.rowCount}; numeric cols align: ${t.cols.filter((c) => c.numeric).map((c) => `${c.header || "?"}=${c.align}${c.tabular ? "/tnum" : ""}`).join(", ") || "n/a"}`).join(" ‖ ") || "none"}`);
md.push(`- Metric-ish elements: ${(d.metrics || []).slice(0, 10).map((m) => `"${m.text.slice(0, 30)}"@${m.fontSize}${m.tabular ? "/tnum" : ""}`).join(", ") || "none"}`);
md.push(``);
md.push(`## Mobile (390×844)`);
if (out.mobile?.error) md.push(`- FAILED: ${out.mobile.error}`);
else md.push(`- Horizontal overflow: ${out.mobile.horizontalOverflow ? `YES (scrollWidth ${out.mobile.scrollWidth})` : "no"} · sidebar visible ${out.mobile.sideVisible} (${out.mobile.sideW}px) · burger ${out.mobile.burger} · elements past right edge: ${(out.mobile.overflowers || []).join(", ") || "none"} · text under 11px: ${out.mobile.textUnder11px} · api fails: ${(out.mobile.apiFails || []).length}`);
md.push(``);
md.push(`## Click sweep`);
if (out.clickSummary?.skipped) md.push(`- skipped: ${out.clickSummary.reason}`);
else {
  md.push(`- ${out.clickSummary.attempted} clicked of ${out.clickSummary.candidates} candidates (cap ${MAX_CLICKS}) · tally: ${Object.entries(out.clickSummary.tally || {}).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  md.push(``);
  md.push(`| # | Control | Size | Result | What happened | Shot |`);
  md.push(`|---|---|---|---|---|---|`);
  for (const r0 of out.clicks) {
    const r = { api: [], intercepted: [], dialogs: [], consoleErrors: [], ...r0 };
    const what = [
      r.urlChanged ? `→ ${r.urlChanged}` : "",
      r.api.length ? r.api.map((a) => `${a.method} ${a.url.split("?")[0]} ${a.status}`).join("; ") : "",
      r.intercepted.length ? "WRITE " + r.intercepted.map((a) => `${a.method} ${a.url.split("?")[0]} {${a.bodyKeys.join(",")}}`).join("; ") : "",
      r.dialogs.length ? "dialog: " + r.dialogs.map((x) => `${x.type} "${x.message}"`).join("; ") : "",
      r.consoleErrors?.length ? "console: " + r.consoleErrors.join(" | ") : "",
      r.note || r.error || ""
    ].filter(Boolean).join(" · ");
    md.push(`| ${r.n} | ${r.tag} "${(r.text || r.id || "").replace(/\|/g, "/")}" | ${r.w}×${r.h} | ${r.result} | ${what.replace(/\|/g, "/")} | ${r.shot || ""} |`);
  }
}
fs.writeFileSync(path.join(OUT_DIR, "audit.md"), md.join("\n") + "\n");

console.log(JSON.stringify({
  slug: SLUG, email, login: out.login, load: { http: out.load.httpStatus, finalUrl: out.load.finalUrl, bounced: out.load.bounced, apiFails: out.load.apiFails.length, consoleErrors: out.load.consoleErrors.length },
  dom: out.dom && !out.dom.error ? { fontSizes: Object.keys(out.dom.sizes).length, nav: out.dom.navVisibleCount, contentWidth: out.dom.contentWidth, docH: out.dom.docH, controls: out.dom.controlsCount, primary: out.dom.primaryLooking.length } : out.dom,
  mobile: out.mobile && !out.mobile.error ? { overflow: out.mobile.horizontalOverflow, sideVisible: out.mobile.sideVisible } : out.mobile,
  clicks: out.clickSummary,
  files: [rel(path.join(OUT_DIR, "audit.md")), rel(path.join(OUT_DIR, "audit.json"))]
}, null, 2));
