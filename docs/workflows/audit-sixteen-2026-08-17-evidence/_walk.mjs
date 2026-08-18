import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-sixteen-2026-08-17-evidence");
const BASE = "https://fundhub.ai";

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

const PASSWORD = process.env.STAFF_E2E_PASSWORD || process.env.STAFF_INITIAL_PASSWORD || "";
if (!PASSWORD) throw new Error("STAFF_E2E_PASSWORD missing");

const results = [];

function chromeExe() {
  const home = process.env.HOME || "";
  const root = path.join(home, "Library/Caches/ms-playwright");
  if (!fs.existsSync(root)) return undefined;
  const dirs = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const d of dirs) {
    const exe = path.join(root, d, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
    if (fs.existsSync(exe)) return exe;
  }
  return undefined;
}

async function login(page, email, loginPath = "/login.html") {
  await page.goto(BASE + loginPath, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.locator('input[type="email"], #email, input[name="email"]').first().fill(email);
  await page.locator('input[type="password"], #password, input[name="password"]').first().fill(PASSWORD);
  await page.locator('button[type="submit"], button:has-text("Sign"), button:has-text("Log")').first().click();
  await page.waitForFunction(() => !/login\.html|portal-login\.html/i.test(location.pathname), null, { timeout: 30000 });
}

async function observe(page, slug, extra = {}) {
  await page.waitForTimeout(800);
  const shot = path.join(OUT, `${slug}.png`);
  await page.screenshot({ path: shot, fullPage: false });
  const facts = await page.evaluate(() => {
    const nav = [...document.querySelectorAll("#fh-side-nav a, .navitem")].map((a) => (a.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean);
    const body = (document.body && document.body.innerText) || "";
    const betaBanner = !!document.getElementById("fh-beta-banner") || !!document.querySelector("[data-fh-beta-banner]");
    const betaBadges = [...document.querySelectorAll(".beta-badge")].map((el) => (el.closest("a")?.textContent || el.textContent || "").replace(/\s+/g, " ").trim());
    const videos = [...document.querySelectorAll("video, iframe[src*='vimeo'], iframe[src*='youtube'], iframe[src*='wistia']")].map((el) => ({
      tag: el.tagName,
      src: (el.currentSrc || el.src || el.getAttribute("src") || "").slice(0, 120)
    }));
    const staffPhrases = [];
    for (const phrase of ["Open this from a client file", "open this page with ?id=", "?id=<client id>", "?id=<client"]) {
      if (body.includes(phrase) || body.toLowerCase().includes(phrase.toLowerCase())) staffPhrases.push(phrase);
    }
    const dispute = /sign to authorize dispute|authorize dispute letters/i.test(body);
    const welcome = /welcome video|watch this|hero/i.test(body);
    const h1 = (document.querySelector("h1, .page-title, .hdr h1, .top h1")?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 160);
    const boardStatus = (document.getElementById("boardStatus")?.innerText || "").trim();
    const sumCount = (document.getElementById("sumCount")?.innerText || "").trim();
    const cardCount = document.querySelectorAll(".pcard, .card, [data-card]").length;
    const offerStack = /offer stack/i.test(body);
    const productWords = [...body.matchAll(/\b(funding|credit repair|inquiry|letter|subscription|coaching|membership)\b/gi)].map((m) => m[1].toLowerCase());
    const uniqueProducts = [...new Set(productWords)].slice(0, 20);
    const internalDocs = [];
    for (const phrase of ["database", "column", "file path", ".sql", "src/", "public/app/", "api/read/", "CROA", "16 C.F.R", "FTC"]) {
      if (body.includes(phrase)) internalDocs.push(phrase);
    }
    const waiting = /waiting|sent\b|outstanding/i.test(body) && /contract/i.test(body);
    const fundingGroupHasContracts = (() => {
      const groups = [...document.querySelectorAll(".navgroup")];
      for (const g of groups) {
        const head = (g.querySelector(".navhead")?.innerText || "").toLowerCase();
        if (!head.includes("funding")) continue;
        return [...g.querySelectorAll("a")].some((a) => /contracts/i.test(a.textContent || ""));
      }
      return false;
    })();
    const chatBox = !!document.querySelector("textarea, input[placeholder*='ask' i], .chat-input, #prompt, #msg");
    const chatWidth = (() => {
      const el = document.querySelector(".chat, #chat, .thread, main, .canvas");
      return el ? Math.round(el.getBoundingClientRect().width) : 0;
    })();
    const viewport = { w: window.innerWidth, h: window.innerHeight };
    const bodyFont = getComputedStyle(document.body).fontSize;
    const htmlFont = getComputedStyle(document.documentElement).fontSize;
    const seams = (() => {
      const main = document.querySelector("main, .canvas, .page, #app");
      if (!main) return null;
      const s = getComputedStyle(main);
      return { bg: s.backgroundColor, outline: s.outline, border: s.border };
    })();
    return {
      url: location.href,
      title: document.title,
      pathname: location.pathname,
      nav,
      betaBanner,
      betaBadges,
      betaTextHits: [...body.matchAll(/Beta[^\n]{0,90}/g)].map((m) => m[0]).slice(0, 6),
      videos,
      staffPhrases,
      dispute,
      welcome,
      h1,
      boardStatus,
      sumCount,
      cardCount,
      offerStack,
      uniqueProducts,
      internalDocs,
      waiting,
      fundingGroupHasContracts,
      chatBox,
      chatWidth,
      viewport,
      bodyFont,
      htmlFont,
      seams,
      bodySnippet: body.replace(/\s+/g, " ").slice(0, 400)
    };
  });
  const row = { slug, shot: path.relative(ROOT, shot), ...facts, ...extra };
  results.push(row);
  console.log(JSON.stringify({ slug, url: facts.url, betaBanner: facts.betaBanner, h1: facts.h1, status: extra.status || extra.loginOk || "ok" }));
  return row;
}

async function gotoStatus(page, url) {
  const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  return res ? res.status() : null;
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: chromeExe()
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // OWNER
  const tLogin0 = Date.now();
  await login(page, "chris@fundhub.ai");
  const loginMs = Date.now() - tLogin0;
  await observe(page, "00-owner-after-login", { role: "owner", loginMs });

  // 1 pipeline speed
  const t0 = Date.now();
  const pipeStatus = await gotoStatus(page, BASE + "/app/pipeline.html");
  await page.waitForSelector("#fh-side-nav, #board, #boardStatus", { timeout: 20000 }).catch(() => {});
  const shellMs = Date.now() - t0;
  await page.waitForFunction(() => {
    const s = document.getElementById("boardStatus");
    const b = document.getElementById("board");
    const txt = (s && s.innerText) || "";
    return (b && !b.hidden) || /empty|no |ready|card|error|fail/i.test(txt) || (txt && !/loading/i.test(txt));
  }, null, { timeout: 25000 }).catch(() => {});
  const usefulMs = Date.now() - t0;
  await observe(page, "01-pipeline-owner", { role: "owner", status: pipeStatus, shellMs, usefulMs });

  // 2 global polish — a few screens at 1440
  await page.goto(BASE + "/app/closer-dashboard.html", { waitUntil: "domcontentloaded" });
  await observe(page, "02-closer-dashboard-1440", { role: "owner", polish: "1440" });

  // 3 beta — owner on a likely beta marketing screen
  for (const [slug, href] of [
    ["03-campaigns-owner", "/app/campaign-manager.html"],
    ["03-social-owner", "/app/social-studio.html"],
    ["03-creative-owner", "/app/creative-factory.html"]
  ]) {
    const st = await gotoStatus(page, BASE + href);
    await observe(page, slug, { role: "owner", status: st });
  }

  // 4 subscriptions
  const subSt = await gotoStatus(page, BASE + "/app/subscriptions.html");
  await observe(page, "04-subscriptions-url", { role: "owner", status: subSt });

  // 5 demo mode
  const demoSt = await gotoStatus(page, BASE + "/app/demo-mode.html");
  await observe(page, "05-demo-mode-url", { role: "owner", status: demoSt });

  // 6 command center
  const ccSt = await gotoStatus(page, BASE + "/app/command-center.html");
  await observe(page, "06-command-center-url", { role: "owner", status: ccSt });

  // 7 contracts + documents
  await page.goto(BASE + "/app/contracts.html", { waitUntil: "domcontentloaded" });
  await observe(page, "07-contracts-owner", { role: "owner" });
  await page.goto(BASE + "/app/documents.html", { waitUntil: "domcontentloaded" });
  await observe(page, "07-documents-owner", { role: "owner" });

  // 8 lenders owner
  const lendSt = await gotoStatus(page, BASE + "/app/lenders.html");
  const lendApi = await page.evaluate(async () => {
    const r = await fetch("/api/read/lenders", { credentials: "include" });
    return { status: r.status, ok: r.ok };
  });
  await observe(page, "08-lenders-owner", { role: "owner", status: lendSt, lendersApi: lendApi });

  // 9 company brain
  await page.goto(BASE + "/app/company-brain.html", { waitUntil: "domcontentloaded" });
  await observe(page, "09-company-brain-owner", { role: "owner" });

  // 10-12 already captured as 03-*; recapture named
  await page.goto(BASE + "/app/campaign-manager.html", { waitUntil: "domcontentloaded" });
  await observe(page, "10-campaigns-owner", { role: "owner" });
  await page.goto(BASE + "/app/social-studio.html", { waitUntil: "domcontentloaded" });
  await observe(page, "11-social-studio-owner", { role: "owner" });
  await page.goto(BASE + "/app/creative-factory.html", { waitUntil: "domcontentloaded" });
  await observe(page, "12-creative-factory-owner", { role: "owner" });

  // 13 closer dashboard already 02; recapture
  await page.goto(BASE + "/app/closer-dashboard.html", { waitUntil: "domcontentloaded" });
  await observe(page, "13-closer-dashboard-owner", { role: "owner" });
  await page.goto(BASE + "/app/closer-call.html", { waitUntil: "domcontentloaded" });
  await observe(page, "13-closer-call-owner", { role: "owner" });

  // 14 my numbers + sales floor
  await page.goto(BASE + "/app/my-numbers.html", { waitUntil: "domcontentloaded" });
  await observe(page, "14-my-numbers-owner", { role: "owner" });
  await page.goto(BASE + "/app/sales-floor.html", { waitUntil: "domcontentloaded" });
  await observe(page, "14-sales-floor-owner", { role: "owner" });

  // 15 hiring
  await page.goto(BASE + "/app/hiring.html", { waitUntil: "domcontentloaded" });
  await observe(page, "15-hiring-owner", { role: "owner" });

  // 16 client portal as owner (staff view)
  await page.goto(BASE + "/app/client-portal.html", { waitUntil: "domcontentloaded" });
  await observe(page, "16-client-portal-owner-staff", { role: "owner" });

  // CLOSER
  await context.clearCookies();
  await page.goto("about:blank");
  try {
    await login(page, "closer@fundhub.ai");
    await page.goto(BASE + "/app/campaign-manager.html", { waitUntil: "domcontentloaded" });
    await observe(page, "03-campaigns-closer", { role: "closer" });
    await page.goto(BASE + "/app/lenders.html", { waitUntil: "domcontentloaded" });
    const closerLendApi = await page.evaluate(async () => {
      const r = await fetch("/api/read/lenders", { credentials: "include" });
      return { status: r.status };
    });
    await observe(page, "08-lenders-closer", { role: "closer", lendersApi: closerLendApi });
    await page.goto(BASE + "/app/closer-dashboard.html", { waitUntil: "domcontentloaded" });
    await observe(page, "13-closer-dashboard-closer", { role: "closer" });
  } catch (e) {
    results.push({ slug: "closer-login", error: String(e.message || e), role: "closer" });
    console.log(JSON.stringify({ slug: "closer-login", error: String(e.message || e) }));
  }

  // ADVISOR
  await context.clearCookies();
  try {
    await login(page, "advisor@fundhub.ai");
    await page.goto(BASE + "/app/campaign-manager.html", { waitUntil: "domcontentloaded" });
    await observe(page, "03-campaigns-advisor", { role: "advisor" });
    await page.goto(BASE + "/app/lenders.html", { waitUntil: "domcontentloaded" });
    const advApi = await page.evaluate(async () => {
      const r = await fetch("/api/read/lenders", { credentials: "include" });
      return { status: r.status };
    });
    await observe(page, "08-lenders-advisor", { role: "advisor", lendersApi: advApi });
  } catch (e) {
    results.push({ slug: "advisor-login", error: String(e.message || e), role: "advisor" });
    console.log(JSON.stringify({ slug: "advisor-login", error: String(e.message || e) }));
  }

  // SALES MANAGER
  await context.clearCookies();
  try {
    await login(page, "sales@fundhub.ai");
    await page.goto(BASE + "/app/lenders.html", { waitUntil: "domcontentloaded" });
    const smApi = await page.evaluate(async () => {
      const r = await fetch("/api/read/lenders", { credentials: "include" });
      return { status: r.status };
    });
    await observe(page, "08-lenders-sales-manager", { role: "sales_manager", lendersApi: smApi });
    await page.goto(BASE + "/app/campaign-manager.html", { waitUntil: "domcontentloaded" });
    await observe(page, "03-campaigns-sales-manager", { role: "sales_manager" });
  } catch (e) {
    results.push({ slug: "sales-login", error: String(e.message || e), role: "sales_manager" });
    console.log(JSON.stringify({ slug: "sales-login", error: String(e.message || e) }));
  }

  // AFFILIATE
  await context.clearCookies();
  try {
    await login(page, "affiliate@fundhub.ai");
    await observe(page, "03-affiliate-landing", { role: "affiliate" });
    const affNav = await page.evaluate(() => [...document.querySelectorAll("a")].map((a) => (a.textContent || "").replace(/\s+/g, " ").trim()));
    results[results.length - 1].allLinks = affNav.filter(Boolean).slice(0, 40);
  } catch (e) {
    results.push({ slug: "affiliate-login", error: String(e.message || e), role: "affiliate" });
    console.log(JSON.stringify({ slug: "affiliate-login", error: String(e.message || e) }));
  }

  // CLIENT portal
  await context.clearCookies();
  try {
    await login(page, "client@fundhub.ai", "/portal-login.html");
    await page.goto(BASE + "/app/client-portal.html", { waitUntil: "domcontentloaded" });
    await observe(page, "16-client-portal-client", { role: "client" });
  } catch (e) {
    results.push({ slug: "client-login", error: String(e.message || e), role: "client" });
    console.log(JSON.stringify({ slug: "client-login", error: String(e.message || e) }));
  }

  fs.writeFileSync(path.join(OUT, "observations.json"), JSON.stringify(results, null, 2));
  console.log("WROTE", results.length, "rows");
  await browser.close();
})().catch((err) => {
  console.error("WALK_FAIL", err && err.message ? err.message : err);
  process.exit(1);
});
