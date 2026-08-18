import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-gaps-2026-08-18-evidence/g4");
const CRM = "https://fundhub.ai";
const APPLY = "https://apply.fundhub.ai";
const TEST_CLIENT = "8556bedc-46e1-4d85-b0cd-a24adfee1521";
const FORBIDDEN = "9af65808-a619-4e65-ae91-239766a006b7";

function loadDotEnv() {
  const p = path.join(ROOT, ".env");
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (k && process.env[k] == null) process.env[k] = v;
  }
}
loadDotEnv();

const PASSWORD = process.env.STAFF_E2E_PASSWORD || "";
if (!PASSWORD) throw new Error("STAFF_E2E_PASSWORD missing");

fs.mkdirSync(OUT, { recursive: true });

function chromeExe() {
  const home = process.env.HOME || "";
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    path.join(home, "Library/Caches/ms-playwright")
  ];
  if (fs.existsSync(candidates[0])) return candidates[0];
  const root = candidates[1];
  if (!fs.existsSync(root)) return undefined;
  const dirs = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const d of dirs) {
    const exe = path.join(root, d, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
    if (fs.existsSync(exe)) return exe;
  }
  return undefined;
}

const shots = [];
const pages = [];

function rec(id, row) {
  pages.push({ id, at: new Date().toISOString(), ...row });
  console.log(JSON.stringify({ id, status: row.status, finalUrl: row.finalUrl, human: (row.human || "").slice(0, 180) }));
}

async function shot(page, slug, full = true) {
  const file = path.join(OUT, `${slug}.png`);
  await page.screenshot({ path: file, fullPage: full }).catch((e) => {
    console.log("shot fail", slug, String(e.message || e).slice(0, 120));
  });
  const rel = path.relative(ROOT, file);
  shots.push(rel);
  return rel;
}

function botSignals(text) {
  const t = String(text || "");
  const hits = [];
  if (/are you a robot|unusual traffic|access denied|cf-browser-verification|just a moment|checking your browser|blocked|bot detected|verify you are human|hcaptcha|recaptcha/i.test(t)) hits.push("challenge_or_bot_copy");
  if (/clickfunnels/i.test(t) && /error|unavailable|not found/i.test(t)) hits.push("cf_error_copy");
  return hits;
}

async function pageFacts(page) {
  return page.evaluate(() => {
    const imgs = [...document.images].map((img) => ({
      src: img.currentSrc || img.src || "",
      alt: img.alt || "",
      w: img.naturalWidth,
      h: img.naturalHeight,
      complete: img.complete,
      broken: img.complete && img.naturalWidth === 0
    }));
    const videos = [...document.querySelectorAll("video")].map((v) => ({
      src: v.currentSrc || v.src || "",
      paused: v.paused,
      readyState: v.readyState,
      duration: Number.isFinite(v.duration) ? v.duration : null,
      error: v.error ? String(v.error.code) : null
    }));
    const iframes = [...document.querySelectorAll("iframe")].map((f) => ({
      src: f.src || "",
      title: f.title || ""
    }));
    const forms = [...document.querySelectorAll("form")].map((f) => ({
      action: f.action || "",
      method: f.method || "",
      fields: [...f.querySelectorAll("input,select,textarea")].map((el) => ({
        tag: el.tagName.toLowerCase(),
        type: el.type || "",
        name: el.name || el.id || "",
        placeholder: el.placeholder || "",
        required: !!el.required
      }))
    }));
    const looseFields = [...document.querySelectorAll("input,select,textarea")].map((el) => ({
      tag: el.tagName.toLowerCase(),
      type: el.type || "",
      name: el.name || el.id || "",
      placeholder: el.placeholder || el.getAttribute("aria-label") || "",
      required: !!el.required
    }));
    const buttons = [...document.querySelectorAll("button, a, [role=button]")]
      .filter((el) => {
        const st = getComputedStyle(el);
        return st.display !== "none" && st.visibility !== "hidden" && el.offsetParent;
      })
      .map((el) => (el.textContent || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 40);
    return {
      title: document.title,
      h1: (document.querySelector("h1")?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 200),
      body: (document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 1200),
      imgs,
      brokenImgs: imgs.filter((i) => i.broken).map((i) => i.src),
      videos,
      iframes,
      forms,
      looseFields,
      buttons,
      href: location.href
    };
  });
}

async function open(page, url, opts = {}) {
  const waitUntil = opts.waitUntil || "domcontentloaded";
  let status = null;
  let err = null;
  const resp = await page.goto(url, { waitUntil, timeout: 45000 }).catch((e) => {
    err = String(e.message || e).slice(0, 240);
    return null;
  });
  if (resp) status = resp.status();
  await page.waitForTimeout(opts.settle ?? 1800);
  const facts = await pageFacts(page).catch(() => ({}));
  return {
    requested: url,
    status,
    navError: err,
    finalUrl: page.url(),
    facts,
    bot: botSignals(facts.body || "")
  };
}

async function loginOwner(page) {
  const r = await open(page, CRM + "/login.html", { settle: 800 });
  await shot(page, "g4c-00-login", false);
  await page.locator('input[type="email"], #email, input[name="email"]').first().fill("chris@fundhub.ai");
  const pass = page.locator('input[type="password"], #password, input[name="password"]').first();
  if (!(await pass.count())) return { ok: false, reason: "no password field", ...r };
  await pass.fill(PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForFunction(() => !/login\.html|portal-login\.html/i.test(location.pathname), null, { timeout: 30000 });
  return { ok: true, path: await page.evaluate(() => location.pathname) };
}

async function walkFunnel(page) {
  const out = { watch: null, apply: null, applyFilled: null, bookCall: null, thankYou: null, book404: null };

  const watch = await open(page, APPLY + "/watch", { settle: 3500 });
  const watchShot = await shot(page, "g4a-watch");
  let videoPlay = { attempted: false };
  const playBtn = page.locator("video, button:has-text('Play'), [aria-label*='Play' i], .play, .wistia_click_to_play").first();
  if (await playBtn.count()) {
    videoPlay.attempted = true;
    await playBtn.click({ timeout: 4000 }).catch((e) => {
      videoPlay.clickError = String(e.message || e).slice(0, 160);
    });
    await page.waitForTimeout(2500);
    videoPlay.after = await page.evaluate(() => {
      const v = document.querySelector("video");
      return v
        ? { paused: v.paused, currentTime: v.currentTime, readyState: v.readyState, src: v.currentSrc || v.src || "" }
        : { noVideoEl: true, iframes: [...document.querySelectorAll("iframe")].map((f) => f.src) };
    });
  }
  const watchAfter = await pageFacts(page);
  out.watch = { ...watch, shot: watchShot, videoPlay, human: watchAfter.body, afterShot: await shot(page, "g4a-watch-after-play") };
  rec("g4a-watch", { status: watch.status, finalUrl: watch.finalUrl, human: watchAfter.body, bot: watch.bot, videoPlay, shot: watchShot });

  const apply = await open(page, APPLY + "/apply", { settle: 3500 });
  const applyShot = await shot(page, "g4a-apply");
  out.apply = { ...apply, shot: applyShot };
  rec("g4a-apply", { status: apply.status, finalUrl: apply.finalUrl, human: apply.facts.body, bot: apply.bot, fields: apply.facts.looseFields, shot: applyShot });

  const fields = apply.facts.looseFields || [];
  const identityAsk = fields.filter((f) => /ssn|social|dob|birth|address|street|zip|postal/i.test(`${f.name} ${f.placeholder} ${f.type}`));
  const fillLog = [];
  const email = `e2e+aff-g4-${Date.now()}@fundhub.ai`;
  async function fillFirst(selectors, value, label) {
    for (const sel of selectors) {
      const loc = page.locator(sel).first();
      if (await loc.count()) {
        const vis = await loc.isVisible().catch(() => false);
        if (!vis) continue;
        await loc.fill(value).catch((e) => {
          fillLog.push({ label, sel, error: String(e.message || e).slice(0, 120) });
          return;
        });
        fillLog.push({ label, sel, value: label === "email" ? value : "(set)", ok: true });
        return true;
      }
    }
    fillLog.push({ label, ok: false, reason: "no visible field" });
    return false;
  }
  await fillFirst(['input[type="email"]', 'input[name*="email" i]', 'input[placeholder*="email" i]', "#email"], email, "email");
  await fillFirst(['input[name*="first" i]', 'input[placeholder*="first" i]', "#first_name", "#firstName"], "E2e", "first");
  await fillFirst(['input[name*="last" i]', 'input[placeholder*="last" i]', "#last_name", "#lastName"], "AffG4", "last");
  await fillFirst(['input[type="tel"]', 'input[name*="phone" i]', 'input[placeholder*="phone" i]'], "5550100123", "phone");
  if (identityAsk.length) {
    const ssn = identityAsk.find((f) => /ssn|social/i.test(`${f.name} ${f.placeholder}`));
    const dob = identityAsk.find((f) => /dob|birth/i.test(`${f.name} ${f.placeholder}`));
    const zip = identityAsk.find((f) => /zip|postal/i.test(`${f.name} ${f.placeholder}`));
    if (ssn) await fillFirst([`input[name="${ssn.name}"]`, `input[placeholder="${ssn.placeholder}"]`], "000000000", "ssn_fake");
    if (dob) await fillFirst([`input[name="${dob.name}"]`, `input[placeholder="${dob.placeholder}"]`], "01/01/1990", "dob_fake");
    if (zip) await fillFirst([`input[name="${zip.name}"]`, `input[placeholder="${zip.placeholder}"]`], "00000", "zip_fake");
  }
  const filledShot = await shot(page, "g4a-apply-step1-filled");
  const afterFill = await pageFacts(page);
  out.applyFilled = { emailUsed: email, fillLog, identityAsk, shot: filledShot, human: afterFill.body, submitted: false };
  rec("g4a-apply-filled", { status: apply.status, finalUrl: page.url(), human: afterFill.body, fillLog, identityAsk, shot: filledShot });

  const bookCall = await open(page, APPLY + "/funding-book-call", { settle: 4000 });
  const bookShot = await shot(page, "g4a-funding-book-call");
  const calendarBits = await page.evaluate(() => {
    const text = (document.body?.innerText || "").replace(/\s+/g, " ");
    return {
      hasCal: /cal\.com|calendly|schedule|pick a time|book a call|choose a time/i.test(text),
      iframeSrcs: [...document.querySelectorAll("iframe")].map((f) => f.src),
      slotsHint: /am|pm|:00|:30/i.test(text) && /time|slot|available/i.test(text)
    };
  });
  out.bookCall = { ...bookCall, shot: bookShot, calendarBits, booked: false, reason: "did not book — would email staff" };
  rec("g4a-funding-book-call", { status: bookCall.status, finalUrl: bookCall.finalUrl, human: bookCall.facts.body, bot: bookCall.bot, calendarBits, shot: bookShot });

  const thanks = await open(page, APPLY + "/thank-you", { settle: 2500 });
  const thanksShot = await shot(page, "g4a-thank-you");
  out.thankYou = { ...thanks, shot: thanksShot };
  rec("g4a-thank-you", { status: thanks.status, finalUrl: thanks.finalUrl, human: thanks.facts.body, bot: thanks.bot, shot: thanksShot });

  const book404 = await open(page, APPLY + "/book", { settle: 1200 });
  const book404Shot = await shot(page, "g4a-book-404");
  out.book404 = { ...book404, shot: book404Shot, owner: "WONTFIX" };
  rec("g4a-book", { status: book404.status, finalUrl: book404.finalUrl, human: book404.facts.body, shot: book404Shot });

  return out;
}

async function walkAffiliate(page) {
  const hops = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) hops.push({ at: new Date().toISOString(), url: frame.url() });
  });
  const start = await open(page, CRM + "/start?ref=AFF-000001", { settle: 4000, waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  const shotPath = await shot(page, "g4b-start-ref");
  const facts = await pageFacts(page);
  const row = {
    ...start,
    hops,
    finalUrl: page.url(),
    landedApply: /apply\.fundhub\.ai/i.test(page.url()),
    wrongTheme: /myclickfunnels\.com/i.test(page.url()) && !/apply\.fundhub\.ai/i.test(page.url()),
    shot: shotPath,
    human: facts.body
  };
  rec("g4b-affiliate-ref", { status: start.status, finalUrl: page.url(), human: facts.body, hops, shot: shotPath, landedApply: row.landedApply });
  return row;
}

async function walkContentAdmin(page) {
  const login = await loginOwner(page);
  const loginShot = await shot(page, "g4c-01-after-login", false);
  rec("g4c-login", { status: login.ok ? 200 : null, finalUrl: page.url(), human: login.ok ? "signed in as owner" : login.reason, shot: loginShot });

  const admin = await open(page, CRM + "/app/content-admin.html", { settle: 2500 });
  const adminShot = await shot(page, "g4c-content-admin");
  const ui = await page.evaluate(() => {
    const notice = (document.getElementById("noticeTxt")?.innerText || "").trim();
    const noticeOn = document.getElementById("noBackendNotice")?.style.display !== "none";
    const uploadBox = document.getElementById("uploadBox");
    const vlist = (document.getElementById("vlist")?.innerText || "").replace(/\s+/g, " ").trim();
    return {
      notice,
      noticeOn,
      uploadHidden: uploadBox ? uploadBox.hidden : null,
      chooseBtn: !!document.getElementById("chooseBtn") && !document.getElementById("chooseBtn").closest("[hidden]"),
      doUploadDisabled: document.getElementById("doUpload")?.disabled ?? null,
      saveHidden: document.getElementById("saveBtn")?.hidden ?? null,
      saveTilesHidden: document.getElementById("saveTilesBtn")?.hidden ?? null,
      kVideos: document.getElementById("kVideos")?.innerText || "",
      kTiers: document.getElementById("kTiers")?.innerText || "",
      kTiles: document.getElementById("kTiles")?.innerText || "",
      kLast: document.getElementById("kLast")?.innerText || "",
      libCount: document.getElementById("libCount")?.innerText || "",
      vlist,
      tileWarn: (document.getElementById("tileWarnTxt")?.innerText || "").trim(),
      pvVidTitle: document.getElementById("pvVidTitle")?.innerText || "",
      liveTxt: document.getElementById("liveTxt")?.innerText || "",
      canWrite: !!(window.FHData && typeof window.FHData.write === "function" && typeof window.FHData.uploadFiles === "function"),
      body: (document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 1600)
    };
  });
  let tilesApi = null;
  try {
    tilesApi = await page.evaluate(async () => {
      const t = localStorage.getItem("fh_token") || "";
      const r = await fetch("/api/content/tiles", {
        headers: t ? { accept: "application/json", authorization: "Bearer " + t } : { accept: "application/json" }
      });
      const text = await r.text();
      let json = null;
      try { json = JSON.parse(text); } catch { json = { parseError: true, text: text.slice(0, 300) }; }
      return { status: r.status, ok: json && json.ok, message: json && (json.message || json.error), videos: json && json.videos ? json.videos.length : null, tiles: json && json.tiles ? json.tiles.length : null };
    });
  } catch (e) {
    tilesApi = { error: String(e.message || e).slice(0, 160) };
  }

  const clicks = [];
  async function clickIf(sel, label) {
    const loc = page.locator(sel).first();
    if (!(await loc.count()) || !(await loc.isVisible().catch(() => false))) {
      clicks.push({ label, visible: false });
      return;
    }
    await loc.click().catch((e) => clicks.push({ label, error: String(e.message || e).slice(0, 120) }));
    await page.waitForTimeout(400);
    clicks.push({ label, visible: true, clicked: true });
  }
  await clickIf("#chooseBtn", "Choose file");
  await shot(page, "g4c-content-admin-choose");
  const previewBtns = page.locator("#pvSwitch button, #pvSwitch [role=button], .pv-switch button");
  const n = await previewBtns.count();
  for (let i = 0; i < Math.min(n, 6); i++) {
    const label = (await previewBtns.nth(i).innerText().catch(() => `preview-${i}`)).replace(/\s+/g, " ").trim();
    await previewBtns.nth(i).click().catch(() => {});
    await page.waitForTimeout(300);
    clicks.push({ label: "preview " + label, clicked: true });
    await shot(page, `g4c-content-admin-preview-${i}`);
  }
  const toggles = page.locator("[data-toggle]");
  const tn = await toggles.count();
  clicks.push({ label: "tile toggles on screen", count: tn, clicked: false, reason: "read-only audit — did not flip live tiles" });

  rec("g4c-content-admin", { status: admin.status, finalUrl: admin.finalUrl, human: ui.body, ui, tilesApi, clicks, shot: adminShot });

  const portal = await open(page, `${CRM}/app/client-portal.html?id=${TEST_CLIENT}`, { settle: 2500 });
  if (page.url().includes(FORBIDDEN)) throw new Error("refused: opened forbidden client");
  const portalShot = await shot(page, "g4c-test-portal");
  const portalUi = await page.evaluate(() => {
    return {
      videoEmpty: (document.getElementById("video-empty")?.innerText || "").trim(),
      videoTitle: (document.getElementById("video-title")?.innerText || "").trim(),
      greeting: (document.getElementById("greeting")?.innerText || "").trim(),
      who: (document.getElementById("who-name")?.innerText || "").trim(),
      playBtn: !!document.getElementById("playbtn"),
      videos: [...document.querySelectorAll("video")].map((v) => v.currentSrc || v.src || ""),
      body: (document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 800)
    };
  });
  rec("g4c-test-portal", { status: portal.status, finalUrl: portal.finalUrl, human: portalUi.body, portalUi, shot: portalShot });
  return { login, admin, ui, tilesApi, clicks, portal, portalUi };
}

async function walkPublic(page) {
  const urls = [
    ["/education/", "g4d-education"],
    ["/education/enroll/", "g4d-education-enroll"],
    ["/education/terms/", "g4d-education-terms"],
    ["/education/privacy/", "g4d-education-privacy"],
    ["/education/refund/", "g4d-education-refund"],
    ["/terms/", "g4d-terms"],
    ["/privacy/", "g4d-privacy"],
    ["/affiliates/", "g4d-affiliates"]
  ];
  const rows = [];
  for (const [p, slug] of urls) {
    const hit = await open(page, CRM + p, { settle: 1600 });
    const shotPath = await shot(page, slug);
    const row = {
      path: p,
      status: hit.status,
      finalUrl: hit.finalUrl,
      title: hit.facts.title,
      h1: hit.facts.h1,
      human: hit.facts.body,
      brokenImgs: hit.facts.brokenImgs,
      forms: (hit.facts.forms || []).map((f) => ({ action: f.action, method: f.method, fields: f.fields.map((x) => x.name || x.type) })),
      submitted: false,
      shot: shotPath
    };
    rows.push(row);
    rec("g4d" + p, row);
  }
  return rows;
}

(async () => {
  const exe = chromeExe();
  const browser = await chromium.launch({
    headless: true,
    executablePath: exe,
    args: ["--disable-blink-features=AutomationControlled"]
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 980 },
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    locale: "en-US"
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);

  const funnel = await walkFunnel(page);
  const affiliate = await walkAffiliate(page);
  const publicPages = await walkPublic(page);
  const content = await walkContentAdmin(page);

  const summary = {
    at: new Date().toISOString(),
    groundTruth: {
      g4a: "MISSING intended funnel journey — scored against board walk",
      g4b: "MISSING as written step — scored against board",
      g4c: "MISSING — scored against board",
      g4d: "MISSING — scored against board"
    },
    pages,
    shots,
    funnelBrief: {
      watchStatus: funnel.watch?.status,
      applyStatus: funnel.apply?.status,
      bookCallStatus: funnel.bookCall?.status,
      thankYouStatus: funnel.thankYou?.status,
      bookStatus: funnel.book404?.status,
      bot: {
        watch: funnel.watch?.bot,
        apply: funnel.apply?.bot,
        bookCall: funnel.bookCall?.bot,
        thankYou: funnel.thankYou?.bot
      }
    },
    affiliateBrief: { finalUrl: affiliate.finalUrl, landedApply: affiliate.landedApply, hops: affiliate.hops },
    contentBrief: {
      notice: content.ui?.notice,
      uploadHidden: content.ui?.uploadHidden,
      videos: content.ui?.kVideos,
      portalEmpty: content.portalUi?.videoEmpty
    },
    publicBrief: publicPages.map((r) => ({ path: r.path, status: r.status, broken: r.brokenImgs }))
  };
  fs.writeFileSync(path.join(OUT, "walk.json"), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(OUT, "pages.json"), JSON.stringify(pages, null, 2));
  await browser.close();
  console.log("done", { shots: shots.length, pages: pages.length });
})().catch((e) => {
  console.error(String(e && e.stack || e).slice(0, 800));
  process.exit(1);
});
