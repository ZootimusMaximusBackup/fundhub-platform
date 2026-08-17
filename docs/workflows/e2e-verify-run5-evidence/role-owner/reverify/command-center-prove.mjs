#!/usr/bin/env node
// Auditor A re-verify (READ-ONLY, live site). One real Chromium session:
//   1. /login.html → sign in as owner@fundhub.ai through the real form (only form ever submitted)
//   2. land on /app/command-center.html (owner HOME) → wait network idle + 2s → record every /api call,
//      count leftover metric dashes, Meta text, Holds panel text + chip count, KPI values, stage chip count
//   3. same session → /app/hiring.html → wait network idle + 2s → record pageerrors, GET /api/hiring/candidates
//      status, candidate cards rendered, footer/status text, "loading hiring" still visible?
// Writes ONLY: command-center-shot.png, command-center-network.json, command-center-summary.json,
//              hiring-shot.png, hiring-network.json, hiring-summary.json (all in this dir).
// Password from gitignored .env, never printed. No production writes.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const OUT = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(OUT, "../../../../..");
const BASE = "https://fundhub.ai";
const EMAIL = "owner@fundhub.ai";
const REL = "docs/workflows/e2e-verify-run5-evidence/role-owner/reverify/";

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
if (!password) { console.error("STAFF_E2E_PASSWORD missing from .env"); process.exit(2); }

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });

// ---- per-screen recorders ----------------------------------------------------
let screen = "login";
const apiCalls = { login: [], "command-center": [], hiring: [] };
const pageErrors = { login: [], "command-center": [], hiring: [] };
const consoleErrors = { login: [], "command-center": [], hiring: [] };
const bodies = {}; // small parsed bodies for a few known routes (counts only)

page.on("response", async (res) => {
  const u = res.url();
  if (!u.includes("/api/")) return;
  const rec = {
    method: res.request().method(),
    // strip anything that looks like a credential from the query string; `key=` on /api/dashboard/pipeline
    // is the pipeline name (sales, card-stacking, …), not a secret, so it is kept.
    url: u.replace(BASE, "").replace(/([?&])(token|access_token|authorization|api_key|apikey)=[^&]*/gi, "$1$2=<redacted>"),
    status: res.status()
  };
  const short = rec.url.split("?")[0];
  if (/\/api\/dashboard\/pipeline|\/api\/hiring\/candidates|\/api\/dashboard\/kpis|\/api\/auth\/login/.test(short)) {
    try {
      const j = await res.json();
      if (short.endsWith("/pipeline")) {
        rec.body = { ok: !!j.ok, stages: Array.isArray(j.stages) ? j.stages.length : null, total: j.total ?? null, error: j.error || "" };
      } else if (short.endsWith("/candidates")) {
        // raw API body is { ok, items, ... } (src/http/read-api.mjs page()); the page's apiGet wraps it as data.items
        const items = j && Array.isArray(j.items) ? j.items : (j && j.data && Array.isArray(j.data.items) ? j.data.items : []);
        rec.body = { ok: !!j.ok, itemCount: items.length, flagsNullCount: items.filter((it) => it && it.flags == null).length, error: j.error || "" };
      } else if (short.endsWith("/kpis")) {
        rec.body = { ok: !!j.ok, keys: j.kpis ? Object.keys(j.kpis).length : null };
      } else if (short.endsWith("/login")) {
        rec.body = { ok: !!j.ok, role: j.staff && j.staff.role, tokenPresent: !!j.token };
      }
    } catch { rec.body = { parse: "failed" }; }
  }
  (apiCalls[screen] || (apiCalls[screen] = [])).push(rec);
});
page.on("pageerror", (err) => (pageErrors[screen] || (pageErrors[screen] = [])).push(String(err?.message || err).slice(0, 200)));
page.on("console", (msg) => { if (msg.type() === "error") (consoleErrors[screen] || (consoleErrors[screen] = [])).push(String(msg.text()).slice(0, 200)); });

async function settle() {
  try { await page.waitForLoadState("networkidle", { timeout: 30_000 }); } catch { /* keep going */ }
  await page.waitForTimeout(2000);
}

// ---- 1. sign in through the real form ---------------------------------------
await page.goto(BASE + "/login.html", { waitUntil: "domcontentloaded" });
await page.locator("#email").fill(EMAIL);
await page.locator("#pw").fill(password);
const loginResp = page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/api/auth/login"), { timeout: 20_000 });
await page.locator("#go").click();
let loginStatus = 0;
try { loginStatus = (await loginResp).status(); } catch { loginStatus = 0; }
let landedUrl = "";
try {
  await page.waitForURL((u) => !/login\.html/.test(u.toString()), { timeout: 20_000 });
  landedUrl = page.url();
} catch { landedUrl = page.url(); }
const session = await page.evaluate(() => ({ hasToken: !!localStorage.getItem("fh_token"), role: localStorage.getItem("fh_role") }));

// ---- 2. Command Center (owner HOME) -------------------------------------------
screen = "command-center";
if (!/command-center\.html/.test(landedUrl)) {
  await page.goto(BASE + "/app/command-center.html", { waitUntil: "domcontentloaded" });
}
await settle();
// give the rails a little longer if they are still blank
await page.waitForFunction(() => {
  const totals = Array.from(document.querySelectorAll(".rail-total"));
  return totals.length > 0 && totals.every((el) => el.textContent.trim() !== "");
}, { timeout: 30_000 }).catch(() => {});
await page.waitForTimeout(500);

const cc = await page.evaluate(() => {
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
  const isDash = (t) => t === "—" || t === "-" || t === "–";
  const textOf = (sel) => Array.from(document.querySelectorAll(sel)).map((el) => ({ sel, text: norm(el.textContent) }));
  const metricSels = [".stage-count", ".stage-dollar", ".rail-total", ".kpi-value", ".hold-chip .count", "#cc-pipeline-meta", "#cc-active-clients", "#holdsEmpty"];
  const metricNodes = metricSels.flatMap((s) => textOf(s));
  const exactDashes = metricNodes.filter((n) => isDash(n.text));
  const dashInside = metricNodes.filter((n) => !isDash(n.text) && /(^| )[—–-]( |$)/.test(n.text));
  // whole-page sweep: any leaf element whose full text is exactly a dash (any tag), to catch furniture outside the metric selectors
  const leafDashes = [];
  for (const el of document.querySelectorAll("body *")) {
    if (el.children.length) continue;
    const t = norm(el.textContent);
    if (!isDash(t)) continue;
    const r = el.getBoundingClientRect();
    leafDashes.push({ tag: el.tagName.toLowerCase(), cls: el.className || "", id: el.id || "", visible: r.width > 0 && r.height > 0, parentCls: el.parentElement ? (el.parentElement.className || "") : "" });
  }
  const holdsPanel = document.getElementById("holdsEmpty");
  const holdsWrap = holdsPanel && holdsPanel.parentElement ? norm(holdsPanel.parentElement.textContent).slice(0, 300) : "";
  const railTitles = Array.from(document.querySelectorAll(".rail")).map((r) => norm((r.querySelector(".rail-title, .rail-name, h3, .rail-head") || {}).textContent).slice(0, 60));
  return {
    title: document.title,
    url: location.pathname,
    headerChip: norm((document.querySelector("#fh-role-chip, .role-chip, [data-role-chip]") || {}).textContent) || null,
    metaText: norm((document.getElementById("cc-pipeline-meta") || {}).textContent),
    footerActive: norm((document.getElementById("cc-active-clients") || {}).textContent),
    holdsEmptyText: norm(holdsPanel ? holdsPanel.textContent : ""),
    holdsEmptyShown: !!(holdsPanel && holdsPanel.classList.contains("on")),
    holdsPanelText: holdsWrap,
    holdChipCount: document.querySelectorAll(".hold-chip").length,
    holdChipTexts: textOf(".hold-chip").map((n) => n.text).slice(0, 12),
    stageChipCount: document.querySelectorAll(".stage-chip").length,
    stageCounts: textOf(".stage-count").map((n) => n.text),
    stageDollars: textOf(".stage-dollar").map((n) => n.text),
    railTotals: textOf(".rail-total").map((n) => n.text),
    railTitles,
    railBodyNotes: Array.from(document.querySelectorAll(".rail")).map((r) => norm(r.textContent).slice(0, 90)),
    kpiValues: textOf(".kpi-value").map((n) => n.text),
    kpiLabels: textOf(".kpi-label").map((n) => n.text),
    metricNodeCount: metricNodes.length,
    exactDashMetricNodes: exactDashes,
    dashInsideMetricText: dashInside,
    leafDashesAnywhere: leafDashes,
    noHoldsFeedYet: /no holds feed yet/i.test(document.body.innerText || "")
  };
});
await page.screenshot({ path: path.join(OUT, "command-center-shot.png"), fullPage: true });

// spot-check GETs for the 3 read routes the probe tool skips (no method column) — read only.
// Bucketed under screen "extra-gets" so they are NOT mixed into the Command Center screen's own calls.
screen = "extra-gets";
const extraGets = await page.evaluate(async () => {
  const token = localStorage.getItem("fh_token") || "";
  const out = [];
  for (const route of ["/api/read/agent-context", "/api/read/agent-shadow-log", "/api/read/tradelines"]) {
    try {
      const r = await fetch(route, { headers: { accept: "application/json", authorization: "Bearer " + token } });
      let err = ""; try { const j = await r.json(); err = String(j.error || j.message || "").slice(0, 80); } catch {}
      out.push({ route, method: "GET", status: r.status, error: err });
    } catch (e) { out.push({ route, method: "GET", status: 0, error: String(e).slice(0, 80) }); }
  }
  return out;
});

// ---- 3. Hiring (same session) -------------------------------------------------
screen = "hiring";
await page.goto(BASE + "/app/hiring.html", { waitUntil: "domcontentloaded" });
await settle();
await page.waitForFunction(() => {
  const b = document.getElementById("board");
  return b && b.querySelectorAll("[data-app]").length > 0;
}, { timeout: 20_000 }).catch(() => {});
await page.waitForTimeout(500);

const hiring = await page.evaluate(() => {
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
  const board = document.getElementById("board");
  const bannerEl = document.querySelector("[data-fh-banner], #fh-data-banner, .fh-data-banner, [data-fh-note], .fh-banner");
  const bodyText = document.body ? document.body.innerText : "";
  const loadingMatch = bodyText.match(/[^\n]*loading hiring[^\n]*/i);
  const apps = (typeof APPS !== "undefined" && Array.isArray(APPS)) ? APPS : [];
  return {
    title: document.title,
    url: location.pathname,
    footNote: norm((document.getElementById("footNote") || {}).textContent),
    banner: bannerEl ? norm(bannerEl.textContent).slice(0, 200) : "",
    loadingHiringVisible: /loading hiring/i.test(bodyText),
    loadingHiringLine: loadingMatch ? norm(loadingMatch[0]).slice(0, 200) : "",
    boardPresent: !!board,
    boardChildCount: board ? board.children.length : -1,
    boardCardCount: board ? board.querySelectorAll("[data-app]").length : -1,
    boardTextSample: board ? norm(board.textContent).slice(0, 160) : "",
    appsMapped: apps.length,
    appsFlagsArrays: apps.filter((a) => Array.isArray(a.flags)).length
  };
});
await page.screenshot({ path: path.join(OUT, "hiring-shot.png"), fullPage: false });
// second shot with the board scrolled into view so the rendered cards are visible
await page.locator("#board").scrollIntoViewIfNeeded().catch(() => {});
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(OUT, "hiring-board-shot.png"), fullPage: false });
await browser.close();

// ---- write evidence -------------------------------------------------------------
const ranAt = new Date().toISOString();
const ccApi = apiCalls["command-center"];
const cc5xx = ccApi.filter((c) => c.status >= 500);
const cc4xx = ccApi.filter((c) => c.status >= 400 && c.status < 500);
fs.writeFileSync(path.join(OUT, "command-center-network.json"), JSON.stringify({
  ranAt, base: BASE, email: EMAIL, screen: "/app/command-center.html",
  login: { status: loginStatus, landedUrl: landedUrl.replace(BASE, ""), session, loginApi: apiCalls.login },
  apiCalls: ccApi, counts: { total: ccApi.length, ok2xx: ccApi.filter((c) => c.status < 300).length, c4xx: cc4xx.length, c5xx: cc5xx.length },
  pageErrors: pageErrors["command-center"], consoleErrors: consoleErrors["command-center"]
}, null, 2) + "\n");

const ccVerdict = (cc.exactDashMetricNodes.length === 0 && cc.holdChipCount === 0 && !cc.noHoldsFeedYet && cc.stageChipCount > 0)
  ? "CONFIRMED-FIXED" : "REGRESSION";
fs.writeFileSync(path.join(OUT, "command-center-summary.json"), JSON.stringify({
  ranAt, base: BASE, email: EMAIL, ui: cc,
  apiCounts: { total: ccApi.length, c4xx: cc4xx.map((c) => `${c.method} ${c.url} ${c.status}`), c5xx: cc5xx.map((c) => `${c.method} ${c.url} ${c.status}`) },
  pipelineRails: ccApi.filter((c) => /dashboard\/pipeline/.test(c.url)).map((c) => ({ url: c.url, status: c.status, ...(c.body || {}) })),
  spotCheckExtraGets: extraGets,
  verdict: ccVerdict,
  shot: REL + "command-center-shot.png"
}, null, 2) + "\n");

const hApi = apiCalls.hiring;
const cand = hApi.filter((c) => /\/api\/hiring\/candidates/.test(c.url));
const lengthErr = pageErrors.hiring.filter((t) => /reading 'length'/.test(t));
const labelErr = pageErrors.hiring.filter((t) => /reading 'label'/.test(t));
fs.writeFileSync(path.join(OUT, "hiring-network.json"), JSON.stringify({
  ranAt, base: BASE, email: EMAIL, screen: "/app/hiring.html",
  apiCalls: hApi, counts: { total: hApi.length, c4xx: hApi.filter((c) => c.status >= 400 && c.status < 500).length, c5xx: hApi.filter((c) => c.status >= 500).length },
  pageErrors: pageErrors.hiring, consoleErrors: consoleErrors.hiring
}, null, 2) + "\n");
const hVerdict = (lengthErr.length === 0 && cand.some((c) => c.status === 200) && hiring.boardCardCount > 0) ? "CONFIRMED-FIXED" : "REGRESSION";
fs.writeFileSync(path.join(OUT, "hiring-summary.json"), JSON.stringify({
  ranAt, base: BASE, email: EMAIL, ui: hiring,
  candidatesCalls: cand, pageErrors: pageErrors.hiring, lengthPageerror: lengthErr, labelPageerror: labelErr,
  verdict: hVerdict, shot: REL + "hiring-shot.png"
}, null, 2) + "\n");

console.log(JSON.stringify({
  loginStatus, landedUrl: landedUrl.replace(BASE, ""), session,
  cc: { verdict: ccVerdict, api: ccApi.length, c4xx: cc4xx.length, c5xx: cc5xx.length, exactDashes: cc.exactDashMetricNodes.length, leafDashes: cc.leafDashesAnywhere.length, meta: cc.metaText, holds: cc.holdsEmptyText, holdChips: cc.holdChipCount, stageChips: cc.stageChipCount, kpi: cc.kpiValues, rails: cc.railTotals, pageErrors: pageErrors["command-center"].length },
  hiring: { verdict: hVerdict, cand: cand.map((c) => c.status), cards: hiring.boardCardCount, foot: hiring.footNote, loading: hiring.loadingHiringVisible, pageErrors: pageErrors.hiring },
  extraGets
}, null, 2));
