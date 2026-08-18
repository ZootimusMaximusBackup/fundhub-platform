#!/usr/bin/env node
// W3 live proof — lenders role lock, https://fundhub.ai only.
//
// For each of four roles it captures the three things the board asks for:
//   a. <role>-sidebar.png       — is the "Lenders" row rendered in the rail?
//   b. <role>-direct-url.png    — type /app/lenders.html; where does the browser END UP?
//   c. <role>-api-read-lenders.json — GET /api/read/lenders with that role's REAL session.
// Plus, for the closer only:
//   closer-api-lender-matches.json — GET /api/read/lender-matches?client_id=...
//   which MUST still be 200. Board decision 2: that endpoint stays on ROLE_SETS.STAFF.
//
// Login is REUSED from e2e/live-auth.mjs (liveStaffLogin). Nothing new was written.
// The password is read from the gitignored .env and is NEVER printed or written out.
//
// Usage: node docs/workflows/lenders-role-lock-2026-08-17-evidence/_tools/prove-lenders-lock.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.dirname(HERE);
const ROOT = path.resolve(OUT, "../../..");

// .env is loaded by playwright.live.config.mjs when run under the runner; this
// script runs standalone, so load the one key it needs the same way ui-audit.mjs does.
function loadEnvPassword() {
  if (process.env.STAFF_E2E_PASSWORD) return;
  const p = path.join(ROOT, ".env");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?STAFF_E2E_PASSWORD\s*=\s*(.*)\s*$/);
    if (m) { process.env.STAFF_E2E_PASSWORD = m[1].replace(/^["']|["']$/g, ""); return; }
  }
}
loadEnvPassword();

const { BASE, liveStaffLogin } = await import(path.join(ROOT, "e2e/live-auth.mjs"));

const CLIENT_ID = "8556bedc-46e1-4d85-b0cd-a24adfee1521";
const ROLES = [
  { slug: "owner",           email: "owner@fundhub.ai",   expectRole: "owner",           expectRow: true,  expectApi: 200 },
  { slug: "sales_manager",   email: "sales@fundhub.ai",   expectRole: "sales_manager",   expectRow: false, expectApi: 403 },
  { slug: "closer",          email: "closer@fundhub.ai",  expectRole: "closer",          expectRow: false, expectApi: 403 },
  { slug: "funding_advisor", email: "advisor@fundhub.ai", expectRole: "funding_advisor", expectRow: true,  expectApi: 200 }
];

fs.mkdirSync(OUT, { recursive: true });

const summary = { base: BASE, ranAt: new Date().toISOString(), roles: [] };
const browser = await chromium.launch();

for (const r of ROLES) {
  const rec = { slug: r.slug, email: r.email, expect: { role: r.expectRole, lendersRow: r.expectRow, apiStatus: r.expectApi } };
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1500 } });
  const page = await ctx.newPage();
  try {
    await liveStaffLogin(page, r.email);
    rec.landedAfterLogin = page.url();

    // Wait for the shell to mount the rail AND for gateLinks() to have run
    // (it stamps data-fh-href on every anchor on its first pass).
    await page.waitForSelector("#side, aside.side", { timeout: 20_000 }).catch(() => {});
    await page.waitForFunction(() => !!document.querySelector("a.navitem[data-fh-href]"), null, { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(2500);

    // The real session token the shell itself uses.
    const token = await page.evaluate(() => { try { return localStorage.getItem("fh_token") || ""; } catch { return ""; } });
    rec.hasSessionToken = !!token;

    // Who does the server say this is?
    const sess = await ctx.request.get(`${BASE}/api/auth/session`, {
      headers: { authorization: `Bearer ${token}` }, timeout: 30_000
    });
    const sessBody = await sess.text();
    rec.session = { status: sess.status() };
    try {
      const j = JSON.parse(sessBody);
      rec.session.role = j?.user?.role ?? j?.role ?? j?.staff?.role ?? null;
      rec.session.email = j?.user?.email ?? j?.email ?? j?.staff?.email ?? null;
    } catch { rec.session.role = null; }

    // ---- (a) sidebar -------------------------------------------------------
    // Groups ship collapsed except the one you stand in (setGroupDefault).
    // Open them all so the shot shows the whole rail; the ROLE GATE is a
    // separate mechanism (display:none + data-fh-gated) and is NOT touched.
    await page.evaluate(() => {
      document.querySelectorAll(".navgroup").forEach((g) => g.classList.remove("closed"));
    });
    await page.waitForTimeout(600);

    rec.sidebar = await page.evaluate(() => {
      const a = Array.from(document.querySelectorAll('a.navitem')).find(
        (el) => ((el.getAttribute("data-fh-href") || el.getAttribute("href") || "").split("?")[0].replace(/^\.\//, "")) === "lenders.html"
      );
      const out = { screenUrl: location.href, lendersAnchorInDom: !!a };
      if (a) {
        const box = a.closest("li") || a.closest(".card") || a;
        const cs = getComputedStyle(box);
        const rect = a.getBoundingClientRect();
        out.gatedAttr = box.getAttribute("data-fh-gated");
        out.display = cs.display;
        out.rendered = cs.display !== "none" && cs.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      } else {
        out.rendered = false;
      }
      const group = Array.from(document.querySelectorAll(".navgroup")).find((g) => g.getAttribute("data-fh-section") === "funding");
      if (group) out.fundingGroupDisplay = getComputedStyle(group).display;
      out.visibleNavRows = Array.from(document.querySelectorAll("a.navitem"))
        .filter((el) => { const b = el.closest("li") || el.closest(".card") || el; return getComputedStyle(b).display !== "none"; })
        .map((el) => (el.getAttribute("data-fh-href") || el.getAttribute("href") || "").split("?")[0].replace(/^\.\//, ""));
      return out;
    });

    const side = page.locator("#side, aside.side").first();
    const sidePng = path.join(OUT, `${r.slug}-sidebar.png`);
    try {
      await side.screenshot({ path: sidePng });
    } catch {
      await page.screenshot({ path: sidePng, fullPage: false });
      rec.sidebarShotNote = "aside element shot failed; full viewport used";
    }
    rec.sidebarShot = path.basename(sidePng);

    // ---- (b) direct URL ----------------------------------------------------
    await page.setViewportSize({ width: 1440, height: 1000 });
    try {
      await page.goto(`${BASE}/app/lenders.html`, { waitUntil: "commit", timeout: 45_000 });
    } catch (e) {
      // location.replace() during load aborts the navigation — that IS the bounce.
      rec.directUrlNavNote = String(e?.message || e).split("\n")[0].slice(0, 160);
    }
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await page.waitForTimeout(6000); // let routeAway()/session pass settle
    rec.directUrl = {
      requested: `${BASE}/app/lenders.html`,
      endedAt: page.url(),
      endedOnLenders: /\/app\/lenders\.html/.test(page.url()),
      title: await page.title().catch(() => ""),
      h1: await page.evaluate(() => (document.querySelector("h1, .h1, .page-title")?.textContent || "").trim().slice(0, 120)).catch(() => "")
    };
    const dirPng = path.join(OUT, `${r.slug}-direct-url.png`);
    await page.screenshot({ path: dirPng, fullPage: false });
    rec.directUrlShot = path.basename(dirPng);

    // ---- (c) raw API -------------------------------------------------------
    const api = await ctx.request.get(`${BASE}/api/read/lenders`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" }, timeout: 30_000
    });
    const apiText = await api.text();
    let parsed = null;
    try { parsed = JSON.parse(apiText); } catch { /* keep raw */ }
    const apiRec = {
      role: r.slug, email: r.email, sessionRoleFromServer: rec.session.role,
      request: { method: "GET", url: `${BASE}/api/read/lenders`, auth: "Bearer <this role's live session token>" },
      httpStatus: api.status(),
      expectedHttpStatus: r.expectApi,
      match: api.status() === r.expectApi,
      rowCount: Array.isArray(parsed?.rows) ? parsed.rows.length : (Array.isArray(parsed?.lenders) ? parsed.lenders.length : null),
      body: parsed ?? apiText.slice(0, 4000),
      capturedAt: new Date().toISOString()
    };
    fs.writeFileSync(path.join(OUT, `${r.slug}-api-read-lenders.json`), JSON.stringify(apiRec, null, 2) + "\n");
    rec.apiReadLenders = { status: api.status(), match: apiRec.match, rowCount: apiRec.rowCount, bodyHead: apiText.slice(0, 200) };

    // ---- closer only: the match box must survive ---------------------------
    if (r.slug === "closer") {
      const m = await ctx.request.get(`${BASE}/api/read/lender-matches?client_id=${CLIENT_ID}`, {
        headers: { authorization: `Bearer ${token}`, accept: "application/json" }, timeout: 30_000
      });
      const mText = await m.text();
      let mParsed = null;
      try { mParsed = JSON.parse(mText); } catch { /* keep raw */ }
      const mRec = {
        role: "closer", email: r.email, sessionRoleFromServer: rec.session.role,
        why: "Board decision 2 — lender-matches stays on ROLE_SETS.STAFF so the closer's match box keeps working. MUST be 200.",
        request: { method: "GET", url: `${BASE}/api/read/lender-matches?client_id=${CLIENT_ID}`, auth: "Bearer <closer's live session token>" },
        httpStatus: m.status(),
        expectedHttpStatus: 200,
        match: m.status() === 200,
        rowCount: Array.isArray(mParsed?.rows) ? mParsed.rows.length : (Array.isArray(mParsed?.matches) ? mParsed.matches.length : null),
        body: mParsed ?? mText.slice(0, 4000),
        capturedAt: new Date().toISOString()
      };
      fs.writeFileSync(path.join(OUT, "closer-api-lender-matches.json"), JSON.stringify(mRec, null, 2) + "\n");
      rec.apiLenderMatches = { status: m.status(), match: mRec.match, rowCount: mRec.rowCount, bodyHead: mText.slice(0, 200) };
    }

    rec.ok = true;
  } catch (err) {
    rec.ok = false;
    rec.error = String(err?.message || err).split("\n").slice(0, 3).join(" | ").slice(0, 400);
  } finally {
    await ctx.close().catch(() => {});
  }
  summary.roles.push(rec);
  console.log(`${r.slug}: ok=${rec.ok} serverRole=${rec.session?.role ?? "?"} row=${rec.sidebar?.rendered ?? "?"} endedAt=${rec.directUrl?.endedAt ?? "?"} api=${rec.apiReadLenders?.status ?? "?"}${rec.apiLenderMatches ? " matches=" + rec.apiLenderMatches.status : ""}${rec.error ? " ERR=" + rec.error : ""}`);
  await new Promise((s) => setTimeout(s, 4000)); // live rate-limits login bursts
}

await browser.close();
fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log("\nwrote " + path.relative(ROOT, path.join(OUT, "summary.json")));
