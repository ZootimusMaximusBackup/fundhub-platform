#!/usr/bin/env node
// UI Auditor evidence tool — READ-ONLY on product. Live walk of 3 marketing screens.
// Password from gitignored .env. Never printed.

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = process.cwd();
const BASE = process.env.BASE_URL || "https://fundhub.ai";
const EMAIL = "owner@fundhub.ai";
const PID = "9defaf28-47c5-43a0-8f5e-f41ef90f360a";
const OUT = path.join(ROOT, "docs/workflows/build-evidence/wl-marketing/live-audit");
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
const password = loadEnvPassword();
if (!password) {
  console.error("STAFF_E2E_PASSWORD missing from env/.env — cannot log in");
  process.exit(2);
}

const rel = (p) => path.relative(ROOT, p);
const out = {
  when: new Date().toISOString(),
  site: BASE,
  role: "owner",
  email: EMAIL,
  partner_id: PID,
  login: {},
  screens: {}
};

function collectApi(page, bucket) {
  page.on("response", (res) => {
    const u = res.url();
    if (!u.includes("/api/")) return;
    bucket.push({
      method: res.request().method(),
      url: u.replace(BASE, "").replace(/^https?:\/\/[^/]+/, ""),
      status: res.status()
    });
  });
}

const DOM_SCRIPT = () => {
  const isVisible = (el) => {
    if (!(el instanceof Element)) return false;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const txt = (el) => (el.textContent || "").replace(/\s+/g, " ").trim();
  const inSidebar = (el) => !!el.closest("#side, #fh-side-nav, aside.side");
  const sizes = {};
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  let n;
  while ((n = walker.nextNode())) {
    const t = n.nodeValue.replace(/\s+/g, " ").trim();
    if (!t) continue;
    const el = n.parentElement;
    if (!el || seen.has(el) || !isVisible(el) || inSidebar(el)) continue;
    if (["SCRIPT", "STYLE", "NOSCRIPT"].includes(el.tagName)) continue;
    seen.add(el);
    const fs = getComputedStyle(el).fontSize;
    sizes[fs] = (sizes[fs] || 0) + 1;
  }
  const navItems = [...document.querySelectorAll("#fh-side-nav a.navitem")].filter(isVisible);
  const navActive = navItems.filter((a) => /(^|\s)on(\s|$)/.test(a.className)).map(txt);
  const navGroups = [...document.querySelectorAll(".navgroup")].filter(isVisible).map((g) => ({
    head: txt(g.querySelector(".navhead")),
    items: [...g.querySelectorAll("a.navitem")].filter(isVisible).map(txt)
  }));
  const h1 = [...document.querySelectorAll("h1")].filter(isVisible).map(txt);
  const main = document.querySelector(".content, .main, main");
  const contentWidth = main ? Math.round(main.getBoundingClientRect().width) : 0;
  const docH = Math.round(Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));
  const overflowX = document.documentElement.scrollWidth > innerWidth + 2;
  const primaries = [...document.querySelectorAll("button, .btn, a.btn")].filter(isVisible).filter((el) => {
    const c = el.className || "";
    return /\b(primary|dark)\b/.test(c) || getComputedStyle(el).backgroundColor === "rgb(10, 10, 10)";
  }).map((el) => ({ id: el.id, text: txt(el).slice(0, 60), disabled: !!el.disabled }));
  const smallHits = [...document.querySelectorAll("button, a.btn, .btn")].filter(isVisible).filter((el) => {
    const r = el.getBoundingClientRect();
    return r.height < 40 || r.width < 40;
  }).map((el) => ({ id: el.id, text: txt(el).slice(0, 40), h: Math.round(el.getBoundingClientRect().height), w: Math.round(el.getBoundingClientRect().width) }));
  const codes = [...document.body.querySelectorAll(".eyebrow, .src, .cap, .hint, .note")].filter(isVisible)
    .map(txt).filter((t) => /\b(BS-|SS-|CF-|sql:|SELECT |WHERE )/i.test(t)).slice(0, 12);
  return {
    title: document.title,
    h1,
    fontSizeCount: Object.keys(sizes).length,
    fontSizes: sizes,
    navVisible: navItems.length,
    navActive,
    navGroups,
    contentWidth,
    docH,
    overflowX,
    viewport: { w: innerWidth, h: innerHeight },
    primaries,
    smallHits: smallHits.slice(0, 20),
    codes,
    betaBanner: !!document.querySelector("[data-fh-beta], #fh-beta-banner, .fh-beta")
  };
};

async function shot(page, name) {
  const p = path.join(OUT, name);
  await page.screenshot({ path: p });
  return rel(p);
}
async function shotFull(page, name) {
  const p = path.join(OUT, name);
  await page.screenshot({ path: p, fullPage: true });
  return rel(p);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const loginApi = [];
collectApi(page, loginApi);

await ctx.route("**/api/**", async (route) => {
  const req = route.request();
  const u = req.url();
  if (req.method() === "GET" || req.method() === "HEAD") return route.continue();
  if (/\/api\/auth\/login(\?|$)/.test(u)) return route.continue();
  // Allow the one write needed to verify the known wordmark failure.
  if (/\/api\/partner-marketing\/generate-logo(\?|$)/.test(u) && req.method() === "POST") return route.continue();
  return route.fulfill({
    status: 599,
    contentType: "application/json",
    body: JSON.stringify({ ok: false, error: "audit_intercepted", message: "UI audit harness refused to send this write" })
  });
});

await page.goto(`${BASE}/login.html`, { waitUntil: "domcontentloaded" });
await page.locator('#email, input[type="email"]').first().fill(EMAIL);
await page.locator('#pw, input[type="password"]').first().fill(password);
await page.locator('#go, button[type="submit"]').first().click();
try {
  await page.waitForURL((u) => !/login\.html/.test(u.toString()), { timeout: 30_000 });
  out.login.ok = true;
} catch {
  out.login.ok = false;
}
await page.waitForLoadState("networkidle").catch(() => {});
await page.waitForTimeout(800);
out.login.landedAt = page.url().replace(BASE, "");
out.login.role = await page.evaluate(() => localStorage.getItem("fh_role")).catch(() => null);
if (!out.login.ok) {
  console.error("login failed");
  fs.writeFileSync(path.join(OUT, "audit.json"), JSON.stringify(out, null, 2));
  await browser.close();
  process.exit(2);
}

async function openScreen(pathWithQuery) {
  const api = [];
  const onRes = (res) => {
    const u = res.url();
    if (u.includes("/api/")) api.push({ method: res.request().method(), url: u.replace(BASE, "").replace(/^https?:\/\/[^/]+/, ""), status: res.status() });
  };
  page.on("response", onRes);
  const resp = await page.goto(BASE + pathWithQuery, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForLoadState("networkidle", { timeout: 25_000 }).catch(() => {});
  await page.waitForTimeout(1200);
  page.off("response", onRes);
  return { status: resp ? resp.status() : null, url: page.url().replace(BASE, ""), api };
}

// ── Brand Studio ──────────────────────────────────────────────────────────
{
  const rec = { observations: {} };
  const opened = await openScreen(`/app/brand-studio.html?partner_id=${PID}`);
  rec.load = opened;
  rec.dom1440 = await page.evaluate(DOM_SCRIPT);
  rec.shots = {
    fold1440: await shot(page, "brand-studio-1440.png"),
    full1440: await shotFull(page, "brand-studio-1440-full.png")
  };

  rec.suite = await page.evaluate(() => {
    const box = (id) => {
      const el = document.getElementById(id);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        id,
        text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80),
        display: cs.display,
        disabled: !!el.disabled,
        x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height)
      };
    };
    const save = document.querySelector(".savebar");
    const saveR = save ? save.getBoundingClientRect() : null;
    const onBtn = document.getElementById("suiteOnBtn");
    const onR = onBtn ? onBtn.getBoundingClientRect() : null;
    let hit = null;
    if (onR) {
      const el = document.elementFromPoint(onR.left + onR.width / 2, onR.top + onR.height / 2);
      hit = el ? { tag: el.tagName, id: el.id, className: String(el.className).slice(0, 80), text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60) } : null;
    }
    const overlap = !!(saveR && onR && !(onR.bottom < saveR.top || onR.top > saveR.bottom || onR.right < saveR.left || onR.left > saveR.right));
    return {
      suiteTxt: (document.getElementById("suiteTxt") || {}).textContent || "",
      kTokens: (document.getElementById("kTokens") || {}).textContent || "",
      genMsg: (document.getElementById("genMsg") || {}).textContent || "",
      pvLegal: (document.getElementById("pvLegal") || {}).textContent || "",
      histPage: (document.getElementById("histPage") || {}).value || "",
      histOptions: [...document.querySelectorAll("#histPage option")].map((o) => o.textContent),
      ownerRowDisplay: document.getElementById("suiteOwnerRow") ? getComputedStyle(document.getElementById("suiteOwnerRow")).display : null,
      toolsDisplay: document.getElementById("suiteOnTools") ? getComputedStyle(document.getElementById("suiteOnTools")).display : null,
      suiteOn: box("suiteOnBtn"),
      suiteOff: box("suiteOffBtn"),
      genCopy: box("genCopyBtn"),
      genLogo: box("genLogoBtn"),
      saveBtn: box("saveBtn"),
      savebar: saveR ? { y: Math.round(saveR.y), h: Math.round(saveR.height), top: Math.round(saveR.top), bottom: Math.round(saveR.bottom) } : null,
      turnOnHit: hit,
      savebarOverlapsTurnOn: overlap
    };
  });

  rec.shots.legal1440 = await shot(page, "brand-studio-1440-legal.png");

  // Click Make a wordmark — real POST allowed — verify not_found / failure text.
  const logoApi = [];
  const onLogo = (res) => {
    const u = res.url();
    if (u.includes("generate-logo")) logoApi.push({ method: res.request().method(), url: u.replace(BASE, ""), status: res.status() });
  };
  page.on("response", onLogo);
  const logoBtn = page.locator("#genLogoBtn");
  if (await logoBtn.isVisible()) {
    await logoBtn.click();
    await page.waitForTimeout(2500);
  }
  page.off("response", onLogo);
  rec.wordmark = {
    api: logoApi,
    genMsg: await page.locator("#genMsg").textContent().catch(() => ""),
    shot: await shot(page, "brand-studio-1440-wordmark.png")
  };

  // 390
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  rec.dom390 = await page.evaluate(DOM_SCRIPT);
  rec.phone = await page.evaluate(() => ({
    overflowX: document.documentElement.scrollWidth > innerWidth + 2,
    scrollWidth: document.documentElement.scrollWidth,
    railOnPage: !!(document.querySelector("aside.side") && getComputedStyle(document.querySelector("aside.side")).display !== "none"),
    burger: !!(document.getElementById("burger") && getComputedStyle(document.getElementById("burger")).display !== "none"),
    nameChipInHeader: !!document.querySelector(".topbar .fh-who, .topbar #fh-who, .topbar .chip")
  }));
  rec.shots.fold390 = await shot(page, "brand-studio-390.png");
  rec.shots.full390 = await shotFull(page, "brand-studio-390-full.png");
  await page.setViewportSize({ width: 1440, height: 900 });
  out.screens.brandStudio = rec;
}

// ── Social Studio ─────────────────────────────────────────────────────────
{
  const rec = { observations: {} };
  const opened = await openScreen(`/app/social-studio.html?partner_id=${PID}`);
  rec.load = opened;
  rec.dom1440 = await page.evaluate(DOM_SCRIPT);
  rec.shots = {
    fold1440: await shot(page, "social-studio-1440.png"),
    full1440: await shotFull(page, "social-studio-1440-full.png")
  };

  rec.suite = await page.evaluate(() => {
    const vis = (el) => {
      if (!el) return null;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80),
        display: cs.display,
        disabled: !!el.disabled,
        title: el.getAttribute("title") || "",
        w: Math.round(r.width), h: Math.round(r.height)
      };
    };
    return {
      partnerSel: (document.getElementById("partnerSel") || {}).value || "",
      partnerLabel: (document.getElementById("partnerSel") && document.getElementById("partnerSel").selectedOptions[0])
        ? document.getElementById("partnerSel").selectedOptions[0].textContent : "",
      suiteTxt: (document.getElementById("ssSuiteTxt") || {}).textContent || "",
      genMsg: (document.getElementById("ssGenMsg") || {}).textContent || "",
      kQueued: (document.getElementById("kQueued") || {}).textContent || "",
      nQueued: (document.getElementById("nQueued") || {}).textContent || "",
      nBlocked: (document.getElementById("nBlocked") || {}).textContent || "",
      nFailed: (document.getElementById("nFailed") || {}).textContent || "",
      nPosted: (document.getElementById("nPosted") || {}).textContent || "",
      queueTiles: document.querySelectorAll("#qGrid .card, #queueGrid .card, [data-pane='queued'] .card, #queuedPane .card").length,
      workbenchCards: document.querySelectorAll("#workbench .card, #qList .row, #queuedList .row, .qrow, .post-tile").length,
      workbenchHtmlSlice: ((document.getElementById("workbench") || {}).innerText || "").replace(/\s+/g, " ").trim().slice(0, 400),
      oauthBox: ((document.getElementById("oauthConnectBox") || {}).innerText || "").replace(/\s+/g, " ").trim().slice(0, 400),
      oauthFb: vis(document.getElementById("oauthFb")),
      oauthIg: vis(document.getElementById("oauthIg")),
      oauthLi: vis(document.getElementById("oauthLi")),
      oauthMsg: (document.getElementById("oauthMsg") || {}).textContent || "",
      genBtn: vis(document.getElementById("ssGenBtn")),
      sampleNotice: ((document.getElementById("ssNoticeTxt") || {}).textContent || "")
    };
  });

  // Inspect live posts payload statuses (GET only).
  rec.postsApi = await page.evaluate(async (pid) => {
    const t = localStorage.getItem("fh_token") || "";
    const r = await fetch("/api/social/posts?partner_id=" + encodeURIComponent(pid), {
      headers: { accept: "application/json", authorization: "Bearer " + t }
    });
    const d = await r.json().catch(() => ({}));
    const items = d.items || (d.data && d.data.items) || [];
    return {
      status: r.status,
      ok: d.ok,
      count: items.length,
      statuses: items.reduce((a, it) => { a[it.status || "unset"] = (a[it.status || "unset"] || 0) + 1; return a; }, {}),
      captions: items.slice(0, 5).map((it) => ({ status: it.status, caption: String(it.caption || "").slice(0, 80) }))
    };
  }, PID);

  rec.shots.queue1440 = await shot(page, "social-studio-1440-queue.png");
  rec.shots.connect1440 = await shot(page, "social-studio-1440-connect.png");

  // Click Connect Facebook (GET start) — do not follow OAuth.
  const fbVisible = await page.locator("#oauthFb").isVisible().catch(() => false);
  if (fbVisible) {
    const oauthApi = [];
    const onO = (res) => {
      const u = res.url();
      if (u.includes("/api/social/oauth")) oauthApi.push({ method: res.request().method(), url: u.replace(BASE, ""), status: res.status() });
    };
    page.on("response", onO);
    await page.locator("#oauthFb").click();
    await page.waitForTimeout(1500);
    page.off("response", onO);
    rec.connectClick = {
      api: oauthApi,
      oauthMsg: await page.locator("#oauthMsg").textContent().catch(() => ""),
      url: page.url().replace(BASE, ""),
      shot: await shot(page, "social-studio-1440-connect-click.png")
    };
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  rec.dom390 = await page.evaluate(DOM_SCRIPT);
  rec.phone = await page.evaluate(() => ({
    overflowX: document.documentElement.scrollWidth > innerWidth + 2,
    scrollWidth: document.documentElement.scrollWidth,
    railOnPage: !!(document.querySelector("aside.side") && getComputedStyle(document.querySelector("aside.side")).display !== "none")
  }));
  rec.shots.fold390 = await shot(page, "social-studio-390.png");
  rec.shots.full390 = await shotFull(page, "social-studio-390-full.png");
  await page.setViewportSize({ width: 1440, height: 900 });
  out.screens.socialStudio = rec;
}

// ── Creative Factory ──────────────────────────────────────────────────────
{
  const rec = { observations: {} };

  // First paint: go to screen and sample Enqueue before usage settles.
  const firstApi = [];
  const onFirst = (res) => {
    const u = res.url();
    if (u.includes("/api/")) firstApi.push({ method: res.request().method(), url: u.replace(BASE, ""), status: res.status() });
  };
  page.on("response", onFirst);
  await page.goto(`${BASE}/app/creative-factory.html?partner_id=${PID}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
  rec.firstPaint = await page.evaluate(() => {
    const btn = document.getElementById("genBtn");
    const badge = document.getElementById("cfUseBadge");
    const body = document.getElementById("cfUseBody");
    const sel = document.getElementById("partnerSel");
    const chip = document.getElementById("scopeChipTxt");
    return {
      genDisabled: btn ? !!btn.disabled : null,
      genMsg: (document.getElementById("genMsg") || {}).textContent || "",
      badge: badge ? badge.textContent : "",
      useBody: body ? (body.innerText || "").replace(/\s+/g, " ").trim().slice(0, 200) : "",
      pickerLabel: sel && sel.selectedOptions[0] ? sel.selectedOptions[0].textContent : "",
      pickerValue: sel ? sel.value : "",
      banner: chip ? chip.textContent : ""
    };
  });
  rec.shots = { firstPaint1440: await shot(page, "creative-factory-1440-first-paint.png") };
  await page.waitForLoadState("networkidle", { timeout: 25_000 }).catch(() => {});
  await page.waitForTimeout(1500);
  page.off("response", onFirst);
  rec.load = { url: page.url().replace(BASE, ""), api: firstApi };

  rec.settled = await page.evaluate(() => {
    const btn = document.getElementById("genBtn");
    const sel = document.getElementById("partnerSel");
    const chip = document.getElementById("scopeChipTxt");
    const pid = document.getElementById("scopePid");
    return {
      genDisabled: btn ? !!btn.disabled : null,
      genMsg: (document.getElementById("genMsg") || {}).textContent || "",
      badge: (document.getElementById("cfUseBadge") || {}).textContent || "",
      useBody: ((document.getElementById("cfUseBody") || {}).innerText || "").replace(/\s+/g, " ").trim().slice(0, 300),
      pickerLabel: sel && sel.selectedOptions[0] ? sel.selectedOptions[0].textContent : "",
      pickerOptions: sel ? [...sel.options].map((o) => o.textContent) : [],
      pickerValue: sel ? sel.value : "",
      banner: chip ? chip.textContent : "",
      scopePid: pid ? pid.textContent : "",
      pickerBannerAgree: !!(sel && chip && (chip.textContent || "").includes((sel.selectedOptions[0] || {}).textContent || "___nomatch___"))
    };
  });
  rec.dom1440 = await page.evaluate(DOM_SCRIPT);
  rec.shots.fold1440 = await shot(page, "creative-factory-1440.png");
  rec.shots.full1440 = await shotFull(page, "creative-factory-1440-full.png");

  // Change picker to another partner and sample immediately vs after settle.
  const otherIndex = await page.evaluate(() => {
    const sel = document.getElementById("partnerSel");
    if (!sel || sel.options.length < 2) return null;
    const cur = sel.value;
    for (const o of sel.options) if (o.value !== cur) return o.value;
    return null;
  });
  if (otherIndex != null) {
    await page.selectOption("#partnerSel", String(otherIndex));
    rec.pickerImmediate = await page.evaluate(() => {
      const sel = document.getElementById("partnerSel");
      const chip = document.getElementById("scopeChipTxt");
      const pid = document.getElementById("scopePid");
      const badge = document.getElementById("cfUseBadge");
      return {
        pickerLabel: sel && sel.selectedOptions[0] ? sel.selectedOptions[0].textContent : "",
        banner: chip ? chip.textContent : "",
        scopePid: pid ? pid.textContent : "",
        badge: badge ? badge.textContent : "",
        genDisabled: document.getElementById("genBtn") ? document.getElementById("genBtn").disabled : null,
        useBody: ((document.getElementById("cfUseBody") || {}).innerText || "").replace(/\s+/g, " ").trim().slice(0, 200)
      };
    });
    rec.shots.pickerDisagree = await shot(page, "creative-factory-1440-picker-disagree.png");
    await page.waitForTimeout(1800);
    rec.pickerSettled = await page.evaluate(() => {
      const sel = document.getElementById("partnerSel");
      const chip = document.getElementById("scopeChipTxt");
      return {
        pickerLabel: sel && sel.selectedOptions[0] ? sel.selectedOptions[0].textContent : "",
        banner: chip ? chip.textContent : "",
        scopePid: (document.getElementById("scopePid") || {}).textContent || "",
        badge: (document.getElementById("cfUseBadge") || {}).textContent || "",
        genDisabled: document.getElementById("genBtn") ? document.getElementById("genBtn").disabled : null
      };
    });
    // Restore the named partner.
    await page.goto(`${BASE}/app/creative-factory.html?partner_id=${PID}`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(800);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  rec.dom390 = await page.evaluate(DOM_SCRIPT);
  rec.phone = await page.evaluate(() => ({
    overflowX: document.documentElement.scrollWidth > innerWidth + 2,
    scrollWidth: document.documentElement.scrollWidth,
    railOnPage: !!(document.querySelector("aside.side") && getComputedStyle(document.querySelector("aside.side")).display !== "none")
  }));
  rec.shots.fold390 = await shot(page, "creative-factory-390.png");
  rec.shots.full390 = await shotFull(page, "creative-factory-390-full.png");
  out.screens.creativeFactory = rec;
}

fs.writeFileSync(path.join(OUT, "audit.json"), JSON.stringify(out, null, 2));
console.log("wrote " + rel(path.join(OUT, "audit.json")));
console.log("login " + (out.login.ok ? "ok" : "FAIL") + " role=" + out.login.role);
await browser.close();
