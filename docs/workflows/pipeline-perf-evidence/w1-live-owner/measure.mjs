#!/usr/bin/env node
// W1 — pipeline board stopwatch. READ-ONLY measurement against the LIVE site.
//
// What it measures, per load of /app/pipeline.html as a given role:
//   * domContentLoaded, load, First Contentful Paint, Largest Contentful Paint
//   * time until the FIRST pipeline card exists in the DOM
//   * time until the card count stops changing for 1500ms ("all cards in")
//   * time until the loading note / spinner disappears
//   * cards rendered in total and per column, plus each column's header count
//   * every network request (url with secret query values redacted, method,
//     start offset, duration, transfer size, type, status)
//   * the /api/** waterfall, and the longest SEQUENTIAL chain through it
//     (each link started only after the previous one finished) = critical path
//   * main-thread long tasks over 50ms and blocking time
//   * /api/** response byte sizes, record counts, bytes per record
//   * any 4xx/5xx or repeated request
//
// Everything is relative to navigation start (performance.timeOrigin), in ms.
//
// Usage:
//   node docs/workflows/pipeline-perf-evidence/w1-live-owner/measure.mjs \
//     [--email owner@fundhub.ai] [--runs 3] [--out <dir>] [--label before]
//     [--base https://fundhub.ai] [--screen /app/pipeline.html] [--no-shots]
//
// Notes for whoever re-runs this (W4, "after" numbers):
//   * LIVE ONLY. localhost:8888 answers 503 {"db":"down"} under this screen's
//     read burst and bounces to /login.html — any localhost number is garbage.
//   * Logs in ONCE and caches the session (live rate-limits login bursts, 429
//     at the edge). Cache dir: $UI_AUDIT_STATE_DIR or --state-dir, else os tmp.
//   * Password comes from $STAFF_E2E_PASSWORD or the gitignored .env. It is
//     never printed, never written to any output file.
//   * Runs are sequential on purpose. Parallel runs distort each other.
//   * Nothing is stubbed, intercepted, routed or throttled — request routing
//     adds per-request latency and would corrupt the numbers. This script only
//     loads the screen and never clicks, so the page issues reads only; any
//     non-GET /api request it did make is recorded under `writesObserved`.
//   * Writes summary.json + summary.md into --out, and prints compact JSON.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

// ---------------------------------------------------------------- args ----
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const has = (n) => argv.includes(n);

const ROOT = process.cwd();
const BASE = flag("--base", process.env.BASE_URL || "https://fundhub.ai");
const EMAIL = flag("--email", "owner@fundhub.ai");
const SCREEN = flag("--screen", "/app/pipeline.html");
const RUNS = Number(flag("--runs", "3"));
const LABEL = flag("--label", "before");
const OUT_DIR = path.resolve(flag("--out", path.join(ROOT, "docs/workflows/pipeline-perf-evidence/w1-live-owner")));
const SHOTS = !has("--no-shots");
const QUIET_MS = Number(flag("--quiet-ms", "1500"));   // "stopped changing" window
const MAX_WAIT_MS = Number(flag("--max-wait", "90000"));
const GAP_MS = Number(flag("--gap-ms", "5000"));       // pause between runs
const STATE_DIR = flag("--state-dir", process.env.UI_AUDIT_STATE_DIR || path.join(os.tmpdir(), "fundhub-ui-audit-state"));

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(STATE_DIR, { recursive: true });
const STATE_FILE = path.join(STATE_DIR, EMAIL.replace(/[^a-z0-9@.-]/gi, "_") + "@" + BASE.replace(/[^a-z0-9.]/gi, "_") + ".json");

// --------------------------------------------------------- credentials ----
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

// ------------------------------------------------------------- helpers ----
const SECRET_PARAM = /^(token|access_token|refresh_token|secret|password|pw|sig|signature|api_key|apikey|jwt|auth|authorization|code)$/i;
function safeUrl(u) {
  try {
    const url = new URL(u, BASE);
    for (const k of [...url.searchParams.keys()]) if (SECRET_PARAM.test(k)) url.searchParams.set(k, "<redacted>");
    const s = url.toString();
    return s.startsWith(BASE) ? s.slice(BASE.length) : s;
  } catch { return String(u).slice(0, 300); }
}
const round = (n) => (n == null || Number.isNaN(n) ? null : Math.round(n));
function median(list) {
  const v = list.filter((x) => typeof x === "number" && !Number.isNaN(x)).slice().sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2);
}
const sec = (ms) => (ms == null ? "not measured" : (ms / 1000).toFixed(2) + "s");
const kb = (b) => (b == null ? "?" : (b / 1024).toFixed(1) + " KB");

// ----------------------------------------------- in-page instrumentation ----
// Installed before any page script runs, re-installed on every navigation.
const INIT = () => {
  const P = {
    fcp: null, lcp: null, longtasks: [],
    cardSamples: [], spinnerSamples: [],
    firstCardAt: null, lastCardChangeAt: null, spinnerFirstSeenAt: null, spinnerGoneAt: null,
  };
  window.__fhperf = P;
  const obs = (type, fn, extra) => {
    try { new PerformanceObserver(fn).observe({ type, buffered: true, ...(extra || {}) }); } catch (e) { /* unsupported */ }
  };
  obs("paint", (l) => { for (const e of l.getEntries()) if (e.name === "first-contentful-paint") P.fcp = e.startTime; });
  obs("largest-contentful-paint", (l) => { const es = l.getEntries(); if (es.length) P.lcp = es[es.length - 1].startTime; });
  obs("longtask", (l) => { for (const e of l.getEntries()) if (e.duration >= 50) P.longtasks.push({ start: e.startTime, dur: e.duration, name: e.name }); });

  let lastCards = -1, lastCols = -1, lastSpin = null;
  function sample() {
    const t = performance.now();
    let cards = 0, cols = 0;
    try {
      cards = document.querySelectorAll("#board .card").length;
      cols = document.querySelectorAll("#board .col").length;
    } catch (e) { /* pre-body */ }
    if (cards !== lastCards || cols !== lastCols) {
      P.cardSamples.push({ t, cards, cols });
      if (cards > 0 && P.firstCardAt == null) P.firstCardAt = t;
      // The -1 -> 0 transition is just the sampler starting; not a real change.
      if (cards !== lastCards && !(lastCards === -1 && cards === 0)) P.lastCardChangeAt = t;
      lastCards = cards; lastCols = cols;
    }
    let spin = false;
    try {
      const note = document.getElementById("boardStatus");
      const noteLoading = !!note && !note.hidden && /loading/i.test(note.textContent || "");
      let other = false;
      document.querySelectorAll('.spinner,.skeleton,.loading,.is-loading,[aria-busy="true"],[data-loading="true"]').forEach((el) => {
        if (el.offsetParent !== null || (el.getClientRects && el.getClientRects().length)) other = true;
      });
      spin = noteLoading || other;
    } catch (e) { /* pre-body */ }
    if (spin !== lastSpin) {
      P.spinnerSamples.push({ t, spinner: spin });
      if (spin && P.spinnerFirstSeenAt == null) P.spinnerFirstSeenAt = t;
      if (lastSpin === true && spin === false) P.spinnerGoneAt = t;
      lastSpin = spin;
    }
    requestAnimationFrame(sample);
  }
  requestAnimationFrame(sample);
};

// Pulled out of the page once a run has settled.
const HARVEST = () => {
  const P = window.__fhperf || {};
  const nav = performance.getEntriesByType("navigation")[0] || {};
  const board = document.getElementById("board");
  const columns = [...document.querySelectorAll("#board .col")].map((c) => ({
    stage: (c.querySelector(".col-name") || {}).textContent || null,
    stageKey: c.dataset ? c.dataset.stageKey || null : null,
    headerCount: (c.querySelector(".col-count") || {}).textContent || null,
    cardsRendered: c.querySelectorAll(".card").length,
  }));
  const note = document.getElementById("boardStatus");
  return {
    href: location.pathname + location.search,
    timeOrigin: performance.timeOrigin,
    now: performance.now(),
    nav: {
      domContentLoaded: nav.domContentLoadedEventEnd || null,
      load: nav.loadEventEnd || null,
      responseEnd: nav.responseEnd || null,
      ttfb: nav.responseStart || null,
      transferSize: nav.transferSize || null,
      encodedBodySize: nav.encodedBodySize || null,
      decodedBodySize: nav.decodedBodySize || null,
      type: nav.type || null,
    },
    fcp: P.fcp, lcp: P.lcp,
    firstCardAt: P.firstCardAt,
    lastCardChangeAt: P.lastCardChangeAt,
    spinnerFirstSeenAt: P.spinnerFirstSeenAt,
    spinnerGoneAt: P.spinnerGoneAt,
    cardSamples: P.cardSamples || [],
    spinnerSamples: P.spinnerSamples || [],
    longtasks: P.longtasks || [],
    cardsNow: document.querySelectorAll("#board .card").length,
    colsNow: columns.length,
    columns,
    boardHidden: board ? !!board.hidden : null,
    noteText: note && !note.hidden ? (note.textContent || "").slice(0, 200) : null,
    railCounts: [...document.querySelectorAll("[data-rail]")].map((r) => ({
      rail: r.dataset.rail, text: (r.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60),
    })),
    resources: performance.getEntriesByType("resource").map((e) => ({
      name: e.name,
      initiatorType: e.initiatorType,
      protocol: e.nextHopProtocol || null,
      start: e.startTime,
      end: e.responseEnd,
      dur: e.duration,
      ttfb: e.responseStart ? e.responseStart - e.startTime : null,
      transferSize: e.transferSize,
      encodedBodySize: e.encodedBodySize,
      decodedBodySize: e.decodedBodySize,
      fromCache: e.transferSize === 0 && e.decodedBodySize > 0,
    })),
  };
};

// ------------------------------------------------------- critical path ----
// Longest chain of requests where each started only after a previous finished.
// Weight = summed request durations; the chain's wall span is reported too, so
// the gaps (client-side think time between calls) are visible.
function criticalPath(items) {
  if (!items.length) return null;
  const list = items.slice().sort((a, b) => a.start - b.start);
  const best = new Array(list.length).fill(0);
  const prev = new Array(list.length).fill(-1);
  for (let i = 0; i < list.length; i++) {
    best[i] = list[i].dur;
    for (let j = 0; j < i; j++) {
      if (list[j].end <= list[i].start && best[j] + list[i].dur > best[i]) {
        best[i] = best[j] + list[i].dur;
        prev[i] = j;
      }
    }
  }
  let top = 0;
  for (let i = 1; i < list.length; i++) if (best[i] > best[top]) top = i;
  const chain = [];
  for (let i = top; i >= 0; i = prev[i]) { chain.unshift(list[i]); if (prev[i] < 0) break; }
  const span = chain[chain.length - 1].end - chain[0].start;
  return {
    links: chain.map((c) => ({ url: c.url, status: c.status ?? null, startMs: round(c.start), endMs: round(c.end), durMs: round(c.dur) })),
    sumDurationMs: round(best[top]),
    wallSpanMs: round(span),
    gapMs: round(span - best[top]),
    linkCount: chain.length,
  };
}

// ------------------------------------------------------------- browser ----
const browser = await chromium.launch();

// One login, cached, reused by every run.
let storageState;
let loginMode = "fresh-login";
if (fs.existsSync(STATE_FILE)) {
  try {
    const st = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    const origin = (st.origins || []).find((o) => o.origin === BASE);
    const tok = origin && (origin.localStorage || []).find((kv) => kv.name === "fh_token");
    if (tok && tok.value) {
      const probeCtx = await browser.newContext();
      const probe = await probeCtx.request.get(BASE + "/api/auth/session", { headers: { authorization: "Bearer " + tok.value }, timeout: 20_000 }).catch(() => null);
      if (probe && probe.ok()) { storageState = st; loginMode = "cached-session"; }
      await probeCtx.close();
    }
  } catch { storageState = undefined; }
}
if (!storageState) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  // Record why a login failed — a blocked run must leave evidence, not a bare exit.
  const loginApi = [];
  page.on("response", async (r) => {
    if (!/\/api\/auth\/login/.test(r.url())) return;
    let body = "";
    try { body = (await r.text()).slice(0, 300); } catch { /* no body */ }
    loginApi.push({ method: r.request().method(), status: r.status(), body });
  });
  await page.goto(`${BASE}/login.html`, { waitUntil: "domcontentloaded" });
  await page.locator('#email, input[type="email"]').first().fill(EMAIL);
  await page.locator('#pw, input[type="password"]').first().fill(password);
  await page.locator('#go, button[type="submit"]').first().click();
  let ok = true;
  try { await page.waitForURL((u) => !/login\.html/.test(u.toString()), { timeout: 45_000 }); } catch { ok = false; }
  await page.waitForLoadState("networkidle").catch(() => {});
  if (!ok) {
    const shown = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 400)).catch(() => "");
    const evidence = { blockedAt: new Date().toISOString(), base: BASE, role: EMAIL, loginApi, pageText: shown, stillAt: page.url().replace(BASE, "") };
    fs.writeFileSync(path.join(OUT_DIR, "login-blocked.json"), JSON.stringify(evidence, null, 2));
    console.error("login failed for " + EMAIL + " — see " + path.relative(ROOT, path.join(OUT_DIR, "login-blocked.json")));
    console.error(JSON.stringify(loginApi, null, 2));
    await browser.close();
    process.exit(3);
  }
  storageState = await ctx.storageState();
  fs.writeFileSync(STATE_FILE, JSON.stringify(storageState));
  await ctx.close();
}

// ----------------------------------------------------------- one run ------
async function runOnce({ ctx, page, kind, index, shots }) {
  const netByUrl = new Map();   // safeUrl -> [{...}] (playwright side: status + sizes)
  const apiBodies = [];
  const errors = [];
  const requestLog = [];

  const writesObserved = [];
  const onRequest = (req) => {
    requestLog.push({ url: safeUrl(req.url()), method: req.method(), type: req.resourceType(), at: Date.now() });
    if (req.url().includes("/api/") && req.method() !== "GET" && req.method() !== "HEAD") {
      writesObserved.push({ url: safeUrl(req.url()), method: req.method() });
    }
  };
  const onResponse = async (res) => {
    const req = res.request();
    const u = safeUrl(res.url());
    const rec = { url: u, method: req.method(), status: res.status(), type: req.resourceType() };
    const arr = netByUrl.get(u) || [];
    arr.push(rec);
    netByUrl.set(u, arr);
    if (res.status() >= 400) errors.push({ url: u, status: res.status(), method: req.method() });
    if (!res.url().includes("/api/")) return;
    try {
      const body = await res.body();
      const entry = { url: u, status: res.status(), method: req.method(), bytes: body.length };
      try {
        const json = JSON.parse(body.toString("utf8"));
        const d = json && json.data ? json.data : json;
        if (d && Array.isArray(d.stages)) {
          entry.stages = d.stages.length;
          entry.cards = d.stages.reduce((n, s) => n + ((s.cards || []).length), 0);
          entry.headerCountTotal = d.stages.reduce((n, s) => n + (Number(s.count) || 0), 0);
        } else if (Array.isArray(d)) entry.records = d.length;
        else if (d && typeof d === "object") entry.keys = Object.keys(d).length;
      } catch { /* not json */ }
      apiBodies.push(entry);
    } catch { /* body unavailable (redirect / aborted) */ }
  };
  page.on("request", onRequest);
  page.on("response", onResponse);

  const url = BASE + SCREEN;
  const wallStart = Date.now();
  if (kind === "warm") await page.reload({ waitUntil: "commit" }).catch(() => {});
  else await page.goto(url, { waitUntil: "commit" }).catch(() => {});

  // Screenshot at first paint (only when asked; a screenshot perturbs timing,
  // so the shot pass is its own run and is excluded from the medians).
  if (shots) {
    await page.waitForFunction(() => (window.__fhperf || {}).fcp != null, null, { timeout: 30_000 }).catch(() => {});
    await page.screenshot({ path: path.join(OUT_DIR, "shot-first-paint.png") }).catch(() => {});
  }

  // Wait until the card count has been still for QUIET_MS.
  const t0 = Date.now();
  let settled = null;
  while (Date.now() - t0 < MAX_WAIT_MS) {
    const s = await page.evaluate(() => {
      const P = window.__fhperf || {};
      return {
        now: performance.now(),
        lastCardChangeAt: P.lastCardChangeAt ?? null,
        firstCardAt: P.firstCardAt ?? null,
        spinnerGoneAt: P.spinnerGoneAt ?? null,
        cards: document.querySelectorAll("#board .card").length,
        noteText: (document.getElementById("boardStatus") && !document.getElementById("boardStatus").hidden)
          ? (document.getElementById("boardStatus").textContent || "").slice(0, 120) : null,
      };
    }).catch(() => null);
    if (s) {
      if (s.lastCardChangeAt != null && s.now - s.lastCardChangeAt >= QUIET_MS) { settled = { reason: "cards-stable", ...s }; break; }
      // Board finished with zero cards: settle on the spinner going away.
      if (s.lastCardChangeAt == null && s.spinnerGoneAt != null && s.now - s.spinnerGoneAt >= QUIET_MS) { settled = { reason: "no-cards-spinner-gone", ...s }; break; }
      // Board failed / bounced: stop after 25s rather than burn the cap.
      if (s.lastCardChangeAt == null && Date.now() - t0 > 25_000) { settled = { reason: "timeout-no-cards", ...s }; break; }
    }
    await page.waitForTimeout(150);
  }

  if (shots) await page.screenshot({ path: path.join(OUT_DIR, "shot-all-cards-in.png"), fullPage: false }).catch(() => {});

  // Let late/idle work land, then harvest.
  await page.waitForTimeout(600);
  const h = await page.evaluate(HARVEST);
  page.off("request", onRequest);
  page.off("response", onResponse);

  // Merge resource timing with playwright statuses.
  const statusFor = (safe) => { const a = netByUrl.get(safe); return a && a.length ? a[a.length - 1].status : null; };
  const resources = h.resources.map((r) => {
    const s = safeUrl(r.name);
    return {
      url: s,
      type: r.initiatorType,
      protocol: r.protocol,
      status: statusFor(s),
      startMs: round(r.start),
      endMs: round(r.end),
      durMs: round(r.dur),
      ttfbMs: round(r.ttfb),
      transferBytes: r.transferSize,
      encodedBytes: r.encodedBodySize,
      decodedBytes: r.decodedBodySize,
      fromCache: r.fromCache,
    };
  });
  const api = resources.filter((r) => r.url.includes("/api/"));
  const apiItems = api.map((r) => ({ url: r.url, status: r.status, start: r.startMs, end: r.endMs, dur: r.durMs }));

  // Parallel vs sequential: how many API calls were in flight at each start.
  const overlaps = apiItems.map((a) => ({
    url: a.url,
    startMs: a.start, endMs: a.end, durMs: a.dur,
    concurrentWith: apiItems.filter((b) => b !== a && b.start < a.end && a.start < b.end).length,
  }));

  const allCardsIn = h.lastCardChangeAt;
  const lt = h.longtasks || [];
  const tbtAll = lt.reduce((n, t) => n + Math.max(0, t.dur - 50), 0);
  const tbtBefore = allCardsIn == null ? null : lt.filter((t) => t.start < allCardsIn).reduce((n, t) => n + Math.max(0, t.dur - 50), 0);
  const tbtAfter = allCardsIn == null ? null : lt.filter((t) => t.start >= allCardsIn).reduce((n, t) => n + Math.max(0, t.dur - 50), 0);

  const dupes = [...netByUrl.entries()].filter(([, a]) => a.length > 1).map(([u, a]) => ({ url: u, times: a.length, statuses: a.map((x) => x.status) }));

  return {
    kind, index,
    ranAt: new Date(wallStart).toISOString(),
    finalUrl: h.href,
    settledReason: settled ? settled.reason : "cap-reached",
    metrics: {
      domContentLoadedMs: round(h.nav.domContentLoaded),
      loadMs: round(h.nav.load),
      ttfbMs: round(h.nav.ttfb),
      fcpMs: round(h.fcp),
      lcpMs: round(h.lcp),
      firstCardMs: round(h.firstCardAt),
      allCardsInMs: round(allCardsIn),
      spinnerGoneMs: round(h.spinnerGoneAt),
      spinnerFirstSeenMs: round(h.spinnerFirstSeenAt),
      longTasksOver50: lt.length,
      longestTaskMs: lt.length ? round(Math.max(...lt.map((t) => t.dur))) : 0,
      totalBlockingMs: round(tbtAll),
      blockingBeforeCardsMs: round(tbtBefore),
      blockingAfterCardsMs: round(tbtAfter),
      apiCallCount: api.length,
      apiBytesTotal: apiBodies.reduce((n, b) => n + (b.bytes || 0), 0),
      apiTransferBytesTotal: api.reduce((n, r) => n + (r.transferBytes || 0), 0),
      cardsRendered: h.cardsNow,
      columns: h.colsNow,
    },
    board: {
      hidden: h.boardHidden,
      noteText: h.noteText,
      columns: h.columns,
      cardCountTimeline: h.cardSamples.map((s) => ({ atMs: round(s.t), cards: s.cards, cols: s.cols })),
      spinnerTimeline: h.spinnerSamples.map((s) => ({ atMs: round(s.t), spinner: s.spinner })),
    },
    longTasks: lt.map((t) => ({ startMs: round(t.start), durMs: round(t.dur) })).sort((a, b) => b.durMs - a.durMs),
    apiCriticalPath: criticalPath(apiItems),
    allResourceCriticalPath: criticalPath(resources.map((r) => ({ url: r.url, status: r.status, start: r.startMs, end: r.endMs, dur: r.durMs }))),
    apiOverlap: overlaps.sort((a, b) => a.startMs - b.startMs),
    apiBodies: apiBodies.sort((a, b) => (b.bytes || 0) - (a.bytes || 0)),
    resources: resources.sort((a, b) => a.startMs - b.startMs),
    errors,
    repeatedRequests: dupes,
    writesObserved,
    requestCount: requestLog.length,
  };
}

// --------------------------------------------------------------- drive ----
const runs = [];
const notes = [];

// COLD: a brand-new context each time = empty HTTP cache, same signed-in session.
for (let i = 1; i <= RUNS; i++) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState });
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  try {
    runs.push(await runOnce({ ctx, page, kind: "cold", index: i, shots: false }));
  } catch (e) {
    notes.push(`cold run ${i} failed: ${String(e && e.message || e).slice(0, 200)}`);
  }
  await ctx.close();
  if (i < RUNS) await new Promise((r) => setTimeout(r, GAP_MS));
}

// WARM: one context, primed by an untimed load, then RUNS reloads.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState });
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  await page.goto(BASE + SCREEN, { waitUntil: "load" }).catch(() => {});
  await page.waitForTimeout(4000);            // prime the HTTP cache
  for (let i = 1; i <= RUNS; i++) {
    try {
      runs.push(await runOnce({ ctx, page, kind: "warm", index: i, shots: false }));
    } catch (e) {
      notes.push(`warm run ${i} failed: ${String(e && e.message || e).slice(0, 200)}`);
    }
    if (i < RUNS) await new Promise((r) => setTimeout(r, GAP_MS));
  }
  await ctx.close();
}

// SHOT pass: its own cold context, excluded from every median.
let shotRun = null;
if (SHOTS) {
  await new Promise((r) => setTimeout(r, GAP_MS));
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState });
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  try { shotRun = await runOnce({ ctx, page, kind: "shots", index: 0, shots: true }); }
  catch (e) { notes.push("screenshot pass failed: " + String(e && e.message || e).slice(0, 200)); }
  await ctx.close();
}

await browser.close();

// ------------------------------------------------------------ summarise ----
const cold = runs.filter((r) => r.kind === "cold");
const warm = runs.filter((r) => r.kind === "warm");
const METRICS = [
  "domContentLoadedMs", "loadMs", "ttfbMs", "fcpMs", "lcpMs",
  "firstCardMs", "allCardsInMs", "spinnerGoneMs",
  "longTasksOver50", "longestTaskMs", "totalBlockingMs", "blockingBeforeCardsMs", "blockingAfterCardsMs",
  "apiCallCount", "apiBytesTotal", "apiTransferBytesTotal", "cardsRendered", "columns",
];
function roll(list) {
  const o = {};
  for (const m of METRICS) o[m] = { median: median(list.map((r) => r.metrics[m])), all: list.map((r) => r.metrics[m]) };
  return o;
}

const repRun = cold.find((r) => r.apiCriticalPath) || cold[0] || runs[0] || null;
const summary = {
  tool: "docs/workflows/pipeline-perf-evidence/w1-live-owner/measure.mjs",
  label: LABEL,
  ranAt: new Date().toISOString(),
  base: BASE, screen: SCREEN, role: EMAIL,
  viewport: "1440x900", browser: "chromium (playwright, headless)",
  network: "no throttling — real network from the machine that ran this",
  loginMode,
  runs: { cold: cold.length, warm: warm.length, quietWindowMs: QUIET_MS },
  cold: roll(cold),
  warm: roll(warm),
  representativeColdRun: repRun ? {
    index: repRun.index,
    settledReason: repRun.settledReason,
    apiCriticalPath: repRun.apiCriticalPath,
    allResourceCriticalPath: repRun.allResourceCriticalPath,
    apiOverlap: repRun.apiOverlap,
    apiBodies: repRun.apiBodies,
    columns: repRun.board.columns,
    cardCountTimeline: repRun.board.cardCountTimeline,
    longTasks: repRun.longTasks.slice(0, 15),
    errors: repRun.errors,
    repeatedRequests: repRun.repeatedRequests,
  } : null,
  notes,
  allRuns: runs,
  shotRun: shotRun ? { metrics: shotRun.metrics, settledReason: shotRun.settledReason, files: ["shot-first-paint.png", "shot-all-cards-in.png"] } : null,
};

fs.writeFileSync(path.join(OUT_DIR, "summary.json"), JSON.stringify(summary, null, 2));

// Compact JSON to stdout — this is what a re-runner diffs.
const compact = {
  label: LABEL, role: EMAIL, ranAt: summary.ranAt,
  coldMedian: Object.fromEntries(METRICS.map((m) => [m, summary.cold[m].median])),
  warmMedian: Object.fromEntries(METRICS.map((m) => [m, summary.warm[m].median])),
  coldAll: { firstCardMs: summary.cold.firstCardMs.all, allCardsInMs: summary.cold.allCardsInMs.all },
  warmAll: { firstCardMs: summary.warm.firstCardMs.all, allCardsInMs: summary.warm.allCardsInMs.all },
  apiCriticalPath: repRun && repRun.apiCriticalPath ? repRun.apiCriticalPath.links.map((l) => `${l.url} ${l.durMs}ms`) : null,
  apiCriticalPathSumMs: repRun && repRun.apiCriticalPath ? repRun.apiCriticalPath.sumDurationMs : null,
  errors: repRun ? repRun.errors : null,
  notes,
};
console.log(JSON.stringify(compact, null, 2));
console.log("\nwrote " + path.relative(ROOT, path.join(OUT_DIR, "summary.json")));
