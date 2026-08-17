// Four-state screenshots for the Specialist desk (inquiry-remover.html).
// Serves nothing itself — expects public/ on http://127.0.0.1:8766

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.EVIDENCE_BASE || "http://127.0.0.1:8766";
const CLIENT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PARSE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const LETTER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

function json(route, status, body) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body)
  });
}

function sessionOk() {
  return {
    ok: true,
    staff: {
      id: "s1",
      name: "DEMO Specialist",
      email: "inquiry@demo.fundhub.local",
      role: "inquiry_specialist",
      org_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    }
  };
}

function fullList() {
  return {
    ok: true,
    files: [{
      card_id: "card-1",
      client_id: CLIENT,
      name: "Pat Lee",
      email: "pat@example.test",
      stage_key: "ready_to_send",
      stage_label: "Ready to send",
      round: "R1",
      bureaus: ["EX"],
      letters_ready: 1,
      letters_sent: 0,
      need_me: true,
      can_send: true
    }],
    need_me: 1,
    ready: 1,
    waiting: 0,
    stalled: 0
  };
}

function fullDetail() {
  return {
    ok: true,
    file: fullList().files[0],
    letters: [{
      id: LETTER,
      bureau: "EX",
      round: "R1",
      status: "ready",
      html: "<p>Round 1 letter body</p>",
      can_send: true
    }],
    items: [{
      id: "item-1",
      rule_id: "M2-005",
      creditor: "BANK",
      status: "open"
    }],
    can_send: true
  };
}

function exceptionsFull() {
  return {
    ok: true,
    stalled: [{ card_id: "card-stuck", client_id: CLIENT, email: "stuck@example.test", stage_key: "stalled" }],
    lowConfidenceParses: [{ id: PARSE, case_id: "case-1", client_id: CLIENT, confidence: 0.4, confirmed: false }]
  };
}

async function applyState(page, state) {
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (url.includes("/api/auth/session")) return json(route, 200, sessionOk());
    if (url.includes("/api/inquiry-cases") || url.includes("/api/read/inquiry-cases") || url.includes("/api/inquiries")) {
      return json(route, 200, { ok: true, items: [], cases: [], inquiries: [] });
    }
    if (state === "error" && (url.includes("/api/read/repair-cases") || url.includes("/api/repair/exceptions"))) {
      return json(route, 500, { ok: false, error: "server", message: "Could not load this just now." });
    }
    if (url.includes("/api/repair/send") && method === "POST") {
      return json(route, 200, { ok: true, sent: 1 });
    }
    if (url.includes("/api/repair/exceptions") && method === "POST") {
      return json(route, 200, { ok: true });
    }
    if (url.includes("/api/repair/exceptions")) {
      if (state === "empty" || state === "loading") return json(route, 200, { ok: true, stalled: [], lowConfidenceParses: [] });
      if (state === "full") return json(route, 200, exceptionsFull());
    }
    if (url.includes("/api/read/repair-cases")) {
      if (state === "loading") {
        await new Promise((r) => setTimeout(r, 2500));
        return json(route, 200, { ok: true, files: [], need_me: 0, ready: 0, waiting: 0, stalled: 0 });
      }
      if (state === "empty") {
        return json(route, 200, { ok: true, files: [], need_me: 0, ready: 0, waiting: 0, stalled: 0 });
      }
      if (url.includes("client_id=")) return json(route, 200, fullDetail());
      return json(route, 200, fullList());
    }
    if (method === "POST") return json(route, 200, { ok: true });
    return json(route, 200, { ok: true, items: [] });
  });
}

async function shot(page, name, width) {
  const dir = path.join(HERE, String(width));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.png`);
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  await page.screenshot({ path: file, fullPage: width !== 390 });
  return file;
}

async function openRepair(page) {
  await page.locator("#tab-repair").click();
}

const browser = await chromium.launch({ headless: true });
const clicks = [];
try {
  for (const state of ["loading", "empty", "error", "full"]) {
    const context = await browser.newContext();
    await context.addInitScript(() => {
      localStorage.setItem("fh_token", "evidence");
      localStorage.setItem("fh_role", "inquiry_specialist");
      localStorage.setItem("fh_demo", "0");
    });
    const page = await context.newPage();
    await applyState(page, state);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE}/app/inquiry-remover.html`, { waitUntil: "domcontentloaded", timeout: 15000 });
    await openRepair(page);
    if (state === "loading") await page.waitForTimeout(400);
    else await page.waitForTimeout(1200);
    if (state === "full") {
      const row = page.locator("[data-repair-row]").first();
      if (await row.count()) {
        await row.click();
        clicks.push({ state, sel: "[data-repair-row]", disabled: false });
        await page.waitForTimeout(600);
      }
    }
    await shot(page, `repair-${state}`, 1440);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: "domcontentloaded", timeout: 15000 });
    await openRepair(page);
    if (state === "loading") await page.waitForTimeout(400);
    else await page.waitForTimeout(1200);
    if (state === "full") {
      const row = page.locator("[data-repair-row]").first();
      if (await row.count()) {
        await row.click();
        await page.waitForTimeout(600);
      }
    }
    await shot(page, `repair-${state}`, 390);

    if (state === "empty") {
      const pipe = page.locator('a[href="pipeline.html"]');
      if (await pipe.count()) {
        await pipe.first().click({ force: true }).catch(() => {});
        clicks.push({ state, sel: 'a[href="pipeline.html"]', disabled: false });
      }
    }

    if (state === "full") {
      const send = page.locator("[data-act=repair-send]").first();
      if (await send.count()) {
        const disabled = await send.isDisabled().catch(() => null);
        await send.click({ force: true }).catch(() => {});
        clicks.push({ state, sel: "[data-act=repair-send]", disabled });
        await page.waitForTimeout(400);
      }
      const confirm = page.locator("[data-confirm-parse]").first();
      if (await confirm.count()) {
        const disabled = await confirm.isDisabled().catch(() => null);
        await confirm.click({ force: true }).catch(() => {});
        clicks.push({ state, sel: "[data-confirm-parse]", disabled });
      }
      await page.locator("#tab-inquiries").click().catch(() => {});
      clicks.push({ state, sel: "#tab-inquiries", disabled: false });
      const chip = page.locator(".bureau-chip").first();
      if (await chip.count()) {
        await chip.click({ force: true }).catch(() => {});
        clicks.push({ state, sel: ".bureau-chip", disabled: false });
      }
      await page.locator("#tab-repair").click().catch(() => {});
      clicks.push({ state, sel: "#tab-repair", disabled: false });
    }
    await context.close();
  }

  const lhContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true
  });
  await lhContext.addInitScript(() => {
    localStorage.setItem("fh_token", "evidence");
    localStorage.setItem("fh_role", "inquiry_specialist");
    localStorage.setItem("fh_demo", "0");
    window.__lcp = null;
    try {
      const po = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const last = entries[entries.length - 1];
        if (last) window.__lcp = last.startTime;
      });
      po.observe({ type: "largest-contentful-paint", buffered: true });
    } catch (e) { /* older engines */ }
  });
  const lhPage = await lhContext.newPage();
  const cdp = await lhContext.newCDPSession(lhPage);
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    downloadThroughput: Math.floor(1.600_000 / 8),
    uploadThroughput: Math.floor(750_000 / 8),
    latency: 150
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await applyState(lhPage, "full");
  await lhPage.goto(`${BASE}/app/inquiry-remover.html`, { waitUntil: "load", timeout: 30000 });
  await lhPage.locator("#tab-repair").click();
  await lhPage.waitForTimeout(1500);
  const lcp = await lhPage.evaluate(() => {
    if (window.__lcp != null) return window.__lcp;
    const entries = performance.getEntriesByType("largest-contentful-paint");
    const last = entries[entries.length - 1];
    return last ? last.startTime : null;
  });
  const nav = await lhPage.evaluate(() => {
    const n = performance.getEntriesByType("navigation")[0];
    return n ? { dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd } : null;
  });
  fs.writeFileSync(path.join(HERE, "lighthouse.json"), JSON.stringify({
    at: new Date().toISOString(),
    note: "Playwright LCP on mocked local HTML, mobile 390px, Slow 4G + 4x CPU. Not a live Lighthouse run against fundhub.ai.",
    budget_lcp_ms: 2500,
    lcp_ms: lcp,
    pass: lcp != null && lcp < 2500,
    nav
  }, null, 2));
  await lhContext.close();
} finally {
  await browser.close();
}

fs.writeFileSync(path.join(HERE, "clicks.json"), JSON.stringify({ at: new Date().toISOString(), clicks }, null, 2));
console.log("wrote evidence under", HERE);
