/**
 * U10 evidence: live /funding-book-call. Do not book unless email is only a test inbox.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-untested-2026-08-18-evidence/u10");
const APPLY = "https://apply.fundhub.ai";
fs.mkdirSync(OUT, { recursive: true });

function chromeExe() {
  const p = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  return fs.existsSync(p) ? p : undefined;
}

async function facts(page) {
  return page.evaluate(() => {
    const text = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
    const iframes = [...document.querySelectorAll("iframe")].map((f) => ({
      src: f.src || "",
      title: f.title || ""
    }));
    const times = [...document.querySelectorAll("button, a, [role=button], [class*='slot'], [class*='time']")]
      .map((el) => (el.innerText || "").replace(/\s+/g, " ").trim())
      .filter((t) => /\d{1,2}:\d{2}|\b(am|pm)\b/i.test(t) && t.length < 40)
      .slice(0, 40);
    const emails = [...(text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [])];
    return {
      href: location.href,
      title: document.title,
      text: text.slice(0, 2200),
      iframes,
      times,
      emails,
      mentionsCal: /cal\.com|calendly/i.test(text + iframes.map((i) => i.src).join(" ")),
      mentionsChris: /chris@fundhub\.ai|\bchris\b/i.test(text)
    };
  });
}

async function shot(page, slug) {
  const file = path.join(OUT, `${slug}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return path.relative(ROOT, file);
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: chromeExe(),
    args: ["--disable-blink-features=AutomationControlled"]
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1400 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  const page = await context.newPage();
  const net = [];
  page.on("response", (res) => {
    const url = res.url();
    if (!/cal\.com|calendly|clickfunnels|fundhub\.ai|book|schedule|appoint/i.test(url)) return;
    if (/\.(png|jpg|jpeg|gif|svg|woff2?|css|mp4)(\?|$)/i.test(url)) return;
    net.push({ status: res.status(), method: res.request().method(), url: url.slice(0, 280) });
  });

  let status = null;
  const resp = await page.goto(APPLY + "/funding-book-call", { waitUntil: "domcontentloaded", timeout: 45000 });
  if (resp) status = resp.status();
  await page.waitForTimeout(4500);
  const open = await facts(page);
  await shot(page, "u10-funding-book-call");

  let slotClick = null;
  const slot = page.getByRole("button", { name: /\d{1,2}:\d{2}|am|pm/i }).first();
  const slotAlt = page.locator("button, a, [role=button]").filter({ hasText: /\d{1,2}:\d{2}\s*(am|pm)/i }).first();
  const target = (await slot.isVisible().catch(() => false)) ? slot : slotAlt;
  if (await target.isVisible().catch(() => false)) {
    const label = (await target.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    await target.click().catch((e) => {
      slotClick = { error: String(e.message || e).slice(0, 160) };
    });
    await page.waitForTimeout(2500);
    await shot(page, "u10-slot-opened");
    slotClick = { ...(slotClick || {}), label, after: await facts(page) };
  } else {
    slotClick = { visible: false };
    await shot(page, "u10-no-slot-control");
  }

  const confirmText = ((slotClick && slotClick.after && slotClick.after.text) || open.text || "").toLowerCase();
  const wouldEmailReal =
    /chris@fundhub\.ai/.test(confirmText) ||
    (/\bcloser\b|\bstaff\b|\badvisor\b/.test(confirmText) && /email|we('ll| will) send|confirmation/i.test(confirmText));
  const onlyTestInbox = /e2e\+(aff|wl)-/.test(confirmText) && !/chris@fundhub\.ai/.test(confirmText);

  const out = {
    at: new Date().toISOString(),
    status,
    finalUrl: page.url(),
    open,
    slotClick,
    wouldEmailReal,
    onlyTestInbox,
    booked: false,
    reasonNotBooked: onlyTestInbox
      ? "safe_test_inbox_not_used_this_pass"
      : "booking would reach a real closer / Chris / a real calendar — did not book",
    net: net.slice(0, 80)
  };
  fs.writeFileSync(path.join(OUT, "walk.json"), JSON.stringify(out, null, 2));
  await browser.close();
  console.log(JSON.stringify({
    status,
    finalUrl: out.finalUrl,
    times: open.times,
    iframes: open.iframes,
    emails: open.emails,
    mentionsCal: open.mentionsCal,
    mentionsChris: open.mentionsChris,
    slot: slotClick && (slotClick.label || slotClick.visible),
    wouldEmailReal,
    onlyTestInbox,
    booked: false
  }));
})().catch((e) => {
  console.error(String((e && e.stack) || e).slice(0, 900));
  process.exit(1);
});
