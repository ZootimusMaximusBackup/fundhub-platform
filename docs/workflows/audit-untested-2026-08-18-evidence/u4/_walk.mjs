/**
 * U4 — live pay rail, no card charge. Evidence only.
 * Never prints passwords, tokens, inbox, phone, or checkout URLs.
 * Never opens the live credit file. Never types a card number.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-untested-2026-08-18-evidence/u4");
const BASE = "https://fundhub.ai";
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
  const root = path.join(home, "Library/Caches/ms-playwright");
  if (!fs.existsSync(root)) return undefined;
  const dirs = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const d of dirs) {
    const exe = path.join(root, d, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
    if (fs.existsSync(exe)) return exe;
  }
  return undefined;
}

const findings = [];
function rec(row) {
  findings.push(row);
  console.log(JSON.stringify({
    id: row.id,
    verdict: row.verdict || null,
    happened: String(row.happened || "").slice(0, 240)
  }));
}

async function shot(page, slug) {
  const file = path.join(OUT, `${slug}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return path.relative(ROOT, file);
}

async function apiFromPage(page, method, pathName, body) {
  return page.evaluate(async ({ method, pathName, body }) => {
    const tok = localStorage.getItem("fh_token") || "";
    const r = await fetch(pathName, {
      method,
      headers: {
        accept: "application/json",
        authorization: tok ? "Bearer " + tok : "",
        ...(body ? { "content-type": "application/json" } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    let data = null;
    try { data = await r.json(); } catch { data = { raw: true }; }
    const safe = JSON.parse(JSON.stringify(data, (k, v) => {
      if (/token|secret|password|authorization|cookie|checkout_url|payment_link|approve_url|url/i.test(k) && typeof v === "string" && v.length > 8) {
        return `[redacted len=${v.length} host=${(() => { try { return new URL(v).host; } catch { return "n/a"; } })()}]`;
      }
      return v;
    }));
    return { status: r.status, data: safe };
  }, { method, pathName, body });
}

async function waitQuiet(page, ms = 1400) {
  await page.waitForTimeout(ms);
}

async function login(page, email, shotName) {
  await page.goto(BASE + "/login.html", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.locator('input[type="email"], #email, input[name="email"]').first().fill(email);
  await page.locator('input[type="password"], #password, input[name="password"]').first().fill(PASSWORD);
  await page.locator('button[type="submit"], button:has-text("Sign"), button:has-text("Log")').first().click();
  await page.waitForFunction(() => !/login\.html|portal-login\.html/i.test(location.pathname), null, { timeout: 30000 });
  if (page.url().includes(FORBIDDEN)) throw new Error("opened forbidden client");
  const s = await shot(page, shotName);
  return { url: page.url().replace(/[?#].*$/, ""), shot: s };
}

const browser = await chromium.launch({ headless: true, executablePath: chromeExe() });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.on("dialog", async (d) => { await d.dismiss(); });

// ---------- Owner on TEST file ----------
const ownerLogin = await login(page, "chris@fundhub.ai", "00-owner-login");
rec({ id: "login-owner", claim: "owner signs in", happened: ownerLogin.url, shot: ownerLogin.shot, verdict: "WORKS" });

await page.goto(BASE + `/app/client-control-panel.html?id=${TEST_CLIENT}`, { waitUntil: "domcontentloaded", timeout: 45000 });
await waitQuiet(page, 2500);
if (page.url().includes(FORBIDDEN)) throw new Error("opened forbidden client");
const ccpShot = await shot(page, "01-ccp-test");
const ccpUi = await page.evaluate(() => {
  const text = (document.body?.innerText || "").replace(/\s+/g, " ");
  const payBtns = [...document.querySelectorAll("button, a")].map((b) => (b.innerText || "").replace(/\s+/g, " ").trim())
    .filter((t) => /pay|link|diagnostic|\$32|checkout|commas|fanbasis|invoice|stripe/i.test(t));
  return {
    path: location.pathname + location.search,
    forbidden: /9af65808/i.test(location.href),
    payish: payBtns.slice(0, 16),
    body: text.slice(0, 280)
  };
});
rec({
  id: "ccp-ui",
  claim: "Owner on TEST file — pay create control",
  happened: JSON.stringify({ path: ccpUi.path, payish: ccpUi.payish, forbidden: ccpUi.forbidden }),
  shot: ccpShot,
  verdict: ccpUi.forbidden ? "BROKEN" : (ccpUi.payish.length ? "OBSERVED" : "MISSING")
});

const payGet = await apiFromPage(page, "GET", `/api/payment-links?client_id=${TEST_CLIENT}`);
rec({
  id: "pay-list",
  claim: "GET payment links for TEST client",
  happened: `status=${payGet.status} ok=${payGet.data?.ok} n=${(payGet.data?.items || []).length} err=${payGet.data?.error || ""}`,
  http: { status: payGet.status, ok: payGet.data?.ok || false, n: (payGet.data?.items || []).length, error: payGet.data?.error || null },
  verdict: "OBSERVED"
});

const payCreate = await apiFromPage(page, "POST", "/api/payment-links", {
  action: "create",
  client_id: TEST_CLIENT,
  purpose: "diagnostic",
  description: "U4 audit diagnostic link — do not charge a real card",
  price: 32
});
const createErr = payCreate.data?.error || "";
const createMsg = payCreate.data?.message || "";
const link = payCreate.data?.link || null;
const hasUrl = !!(link && (link.has_url || link.checkout_url));
const checkoutHost = typeof link?.checkout_url === "string" && link.checkout_url.includes("host=")
  ? String(link.checkout_url)
  : null;
rec({
  id: "pay-create",
  claim: "Create $32 diagnostic payment link (live rail, no charge)",
  happened: `status=${payCreate.status} ok=${payCreate.data?.ok} error=${createErr} message=${String(createMsg).slice(0, 120)} has_url=${hasUrl} link_keys=${link ? Object.keys(link).join(",") : ""}`,
  http: {
    status: payCreate.status,
    ok: !!payCreate.data?.ok,
    error: createErr || null,
    message: createMsg || null,
    has_url: hasUrl,
    checkout_host: checkoutHost,
    amount_display: link?.amount_display || null,
    purpose: link?.purpose || null
  },
  verdict: payCreate.data?.ok ? "WORKS" : (/commas_not_configured/i.test(createErr) ? "BROKEN" : "BROKEN")
});
await shot(page, "02-after-create-api");

// If a hosted checkout URL was minted, open it and stop before card fields.
let checkoutOpened = false;
if (payCreate.data?.ok && hasUrl) {
  const liveUrl = await page.evaluate(async () => {
    const tok = localStorage.getItem("fh_token") || "";
    const r = await fetch("/api/payment-links?client_id=8556bedc-46e1-4d85-b0cd-a24adfee1521", {
      headers: { accept: "application/json", authorization: tok ? "Bearer " + tok : "" }
    });
    const data = await r.json();
    const items = data.items || [];
    const newest = items[0];
    return newest && newest.checkout_url ? newest.checkout_url : null;
  });
  if (liveUrl && /^https?:\/\//i.test(liveUrl) && !/9af65808/i.test(liveUrl)) {
    checkoutOpened = true;
    const checkoutPage = await context.newPage();
    await checkoutPage.goto(liveUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await waitQuiet(checkoutPage, 2000);
    const host = (() => { try { return new URL(checkoutPage.url()).host; } catch { return "unknown"; } })();
    const fields = await checkoutPage.evaluate(() => {
      const inputs = [...document.querySelectorAll("input, select, textarea")].map((el) => ({
        type: (el.getAttribute("type") || el.tagName).toLowerCase(),
        name: (el.getAttribute("name") || el.getAttribute("autocomplete") || "").toLowerCase(),
        placeholder: (el.getAttribute("placeholder") || "").toLowerCase()
      }));
      const cardish = inputs.filter((i) => /card|cc-|cvc|cvv|expir|pan|number/.test(`${i.type} ${i.name} ${i.placeholder}`));
      return {
        title: document.title,
        body: (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 220),
        input_n: inputs.length,
        card_field_n: cardish.length,
        card_types: cardish.map((c) => c.type).slice(0, 8)
      };
    });
    const cshot = await shot(checkoutPage, "03-checkout-stop-before-card");
    rec({
      id: "checkout-open",
      claim: "Open hosted checkout. Stop before any card field is filled.",
      happened: `host=${host} title=${fields.title} card_fields=${fields.card_field_n} inputs=${fields.input_n} body=${fields.body}`,
      shot: cshot,
      verdict: "OBSERVED",
      stop: "did_not_type_card"
    });
    await checkoutPage.close();
  }
}
if (!checkoutOpened) {
  rec({
    id: "checkout-open",
    claim: "Open hosted checkout. Stop before any card field is filled.",
    happened: "No checkout URL returned. Did not open a pay page.",
    verdict: "MISSING"
  });
}

// ---------- Other live pay doors ----------
const invoices = await apiFromPage(page, "GET", "/api/read/invoices?limit=20");
const invItems = invoices.data?.items || invoices.data?.invoices || [];
rec({
  id: "invoices-list",
  claim: "Invoice pay door — list only, do not email",
  happened: `status=${invoices.status} ok=${invoices.data?.ok} n=${invItems.length} err=${invoices.data?.error || ""} keys=${invoices.data ? Object.keys(invoices.data).join(",") : ""}`,
  http: { status: invoices.status, ok: !!invoices.data?.ok, n: invItems.length, error: invoices.data?.error || null },
  verdict: "OBSERVED"
});

await page.goto(BASE + "/app/finance-os.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await waitQuiet(page, 2000);
const fos = await page.evaluate(() => {
  const text = (document.body?.innerText || "").replace(/\s+/g, " ");
  const payBtns = [...document.querySelectorAll("button, a")].map((b) => (b.innerText || "").replace(/\s+/g, " ").trim())
    .filter((t) => /pay|checkout|stripe|invoice|card|commas/i.test(t));
  return { path: location.pathname, payish: payBtns.slice(0, 16), body: text.slice(0, 220) };
});
const fosShot = await shot(page, "04-finance-os");
rec({
  id: "finance-os",
  claim: "Finance OS — other pay door?",
  happened: JSON.stringify({ path: fos.path, payish: fos.payish, body: fos.body }),
  shot: fosShot,
  verdict: "OBSERVED"
});

await page.goto(BASE + "/app/client-portal.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await waitQuiet(page, 2000);
const portalPay = await page.evaluate(() => {
  const products = window.PRODUCTS || {};
  const keys = Object.keys(products);
  const withCheckout = keys.filter((k) => !!products[k]?.checkoutUrl);
  const payMsg = document.getElementById("um-pay-msg")?.innerText || "";
  return {
    path: location.pathname,
    product_n: keys.length,
    checkout_n: withCheckout.length,
    pay_msg: payMsg.slice(0, 180),
    body: (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 220)
  };
});
const portalShot = await shot(page, "05-portal-pay");
rec({
  id: "portal-pay",
  claim: "Portal pay door — checkoutUrl on products?",
  happened: JSON.stringify(portalPay),
  shot: portalShot,
  verdict: portalPay.checkout_n > 0 ? "OBSERVED" : "MISSING"
});

const envNames = {
  COMMAS_CHECKOUT_BASE_URL: !!String(process.env.COMMAS_CHECKOUT_BASE_URL || "").trim(),
  FANBASIS_CHECKOUT_API_KEY: !!String(process.env.FANBASIS_CHECKOUT_API_KEY || "").trim(),
  COMMAS_API_KEY: !!String(process.env.COMMAS_API_KEY || "").trim(),
  STRIPE_keys: Object.keys(process.env).filter((k) => /^STRIPE_/.test(k)).length
};
rec({
  id: "env-names",
  claim: "Local env pay-rail names only (not live Netlify)",
  happened: JSON.stringify(envNames),
  verdict: "OBSERVED"
});

// ---------- Closer: payment-links is finance-gated; do not fire closer-deck send ----------
await context.clearCookies();
await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
const closerLogin = await login(page, "closer@fundhub.ai", "06-closer-login");
rec({ id: "login-closer", claim: "closer signs in", happened: closerLogin.url, shot: closerLogin.shot, verdict: "WORKS" });

const closerCreate = await apiFromPage(page, "POST", "/api/payment-links", {
  action: "create",
  client_id: TEST_CLIENT,
  purpose: "diagnostic",
  description: "U4 closer create — do not charge",
  price: 32
});
rec({
  id: "closer-payment-links",
  claim: "Closer POST /api/payment-links create $32",
  happened: `status=${closerCreate.status} ok=${closerCreate.data?.ok} error=${closerCreate.data?.error || ""}`,
  http: { status: closerCreate.status, ok: !!closerCreate.data?.ok, error: closerCreate.data?.error || null },
  verdict: closerCreate.data?.ok ? "WORKS" : "OBSERVED"
});

await page.goto(BASE + `/app/present.html?id=${TEST_CLIENT}`, { waitUntil: "domcontentloaded", timeout: 45000 });
await waitQuiet(page, 2000);
if (page.url().includes(FORBIDDEN)) throw new Error("opened forbidden client");
const presentUi = await page.evaluate(() => {
  const text = (document.body?.innerText || "").replace(/\s+/g, " ");
  const payBtns = [...document.querySelectorAll("button, a")].map((b) => (b.innerText || "").replace(/\s+/g, " ").trim())
    .filter((t) => /pay|agreement|checkout|\$32|soft.pull/i.test(t));
  return { path: location.pathname, payish: payBtns.slice(0, 12), body: text.slice(0, 220) };
});
const presentShot = await shot(page, "07-closer-present");
rec({
  id: "closer-present",
  claim: "Closer presenter — pay button exists. Did not press Send (would email/SMS).",
  happened: JSON.stringify(presentUi),
  shot: presentShot,
  verdict: "OBSERVED",
  stop: "did_not_press_send_pay_link"
});

await context.close();
await browser.close();

fs.writeFileSync(path.join(OUT, "walk.json"), JSON.stringify({
  at: new Date().toISOString(),
  test_client: TEST_CLIENT,
  opened_forbidden: false,
  findings
}, null, 2));
console.log(JSON.stringify({ wrote: "u4/walk.json", n: findings.length }, null, 2));
