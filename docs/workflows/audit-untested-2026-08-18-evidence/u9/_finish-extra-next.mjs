/**
 * U9: pick one extra-field option, then press Next, repeat.
 * Stop on SSN. Do not book. Do not pay.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-untested-2026-08-18-evidence/u9");
const APPLY = "https://apply.fundhub.ai";
const email = `e2e+aff-u9e-${Date.now()}@fundhub.ai`;

const PICKS = [
  "Less than $50k",
  "Not sure yet",
  "Peace of mind (stop stressing about cash)",
  "Not sure",
  "No, personal funding only",
  "Less than $50k",
  "Not right now",
  "Less than $1k",
  "$50k - $100k",
  "Growth (marketing, inventory, hiring)"
];

function chromeExe() {
  const p = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  return fs.existsSync(p) ? p : undefined;
}

async function visibleHead(page) {
  return page.evaluate(() => {
    const text = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
    const titles = [...document.querySelectorAll("h1,h2,h3,h4,.elHeadline")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 10 && getComputedStyle(el).visibility !== "hidden";
      })
      .map((el) => (el.innerText || "").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 8);
    return {
      href: location.href,
      titles,
      hasSsn: /ssn|social security/i.test(text)
    };
  });
}

async function clickOptionThenNext(page, picks) {
  const clicked = await page.evaluate((list) => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && st.display !== "none" && st.visibility !== "hidden";
    };
    for (const label of list) {
      const nodes = [...document.querySelectorAll("label, div, span, p, li")].filter(
        (el) => vis(el) && (el.innerText || "").replace(/\s+/g, " ").trim() === label
      );
      const el = nodes.sort((a, b) => a.innerText.length - b.innerText.length)[0];
      if (!el) continue;
      const target = el.closest("label, [class*='ption'], [class*='choice'], [role=radio]") || el;
      target.click();
      return label;
    }
    return null;
  }, picks);
  await page.waitForTimeout(400);
  const next = page.locator("a.elButton").filter({ hasText: /^Next$/ }).first();
  if (await next.isVisible().catch(() => false)) {
    await next.click();
    return { option: clicked, next: true };
  }
  return { option: clicked, next: false };
}

async function shot(page, slug) {
  const file = path.join(OUT, `${slug}.png`);
  await page.screenshot({ path: file, fullPage: false });
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
    if (!/clickfunnels|fundhub\.ai\/(api|apply)|survey|webhook|workflow|contacts|cf_survey/i.test(url)) return;
    if (/\.(png|jpg|jpeg|gif|svg|woff2?|css|mp4|js)(\?|$)/i.test(url)) return;
    net.push({ at: new Date().toISOString(), status: res.status(), method: res.request().method(), url: url.slice(0, 280) });
  });

  await page.goto(APPLY + "/apply", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(3200);
  await page.locator('input[placeholder*="First Name" i]').first().click();
  await page.keyboard.type("E2e", { delay: 25 });
  await page.locator('input[placeholder*="Last Name" i]').first().click();
  await page.keyboard.type("AffU9e", { delay: 25 });
  await page.locator('input[type="email"]').first().click();
  await page.keyboard.type(email, { delay: 12 });
  const tel = page.locator('input[type="tel"]').first();
  await tel.click();
  await tel.press("Meta+A");
  await tel.press("Backspace");
  await page.keyboard.type("2015550123", { delay: 35 });
  await page.waitForTimeout(300);
  await page.locator("a.elButton").filter({ hasText: /^Next$/ }).first().click();
  await page.waitForTimeout(2500);

  const steps = [];
  let stoppedForSsn = false;
  let finishReason = "walking";

  for (let i = 0; i < 12; i++) {
    const before = await visibleHead(page);
    await shot(page, `u9-x2-${String(i + 1).padStart(2, "0")}`);
    if (before.hasSsn) {
      stoppedForSsn = true;
      finishReason = "ssn_stop";
      steps.push({ i, before, stoppedForSsn: true });
      break;
    }
    if (/funding-book-call/i.test(page.url())) {
      finishReason = "landed_book_did_not_book";
      steps.push({ i, before, booked: false });
      await shot(page, "u9-landed-book-no-book");
      break;
    }
    const click = await clickOptionThenNext(page, PICKS);
    await page.waitForTimeout(2000);
    const after = await visibleHead(page);
    steps.push({ i, before, click, after });
    if (after.hasSsn) {
      stoppedForSsn = true;
      finishReason = "ssn_stop";
      break;
    }
    if (/funding-book-call/i.test(page.url())) {
      finishReason = "landed_book_did_not_book";
      await shot(page, "u9-landed-book-no-book");
      break;
    }
    if (JSON.stringify(before.titles) === JSON.stringify(after.titles) && i > 0) {
      finishReason = "did_not_advance";
      break;
    }
  }
  if (finishReason === "walking") finishReason = "loop_ended";

  const out = {
    at: new Date().toISOString(),
    email,
    stoppedForSsn,
    finishReason,
    booked: false,
    paid: false,
    finalUrl: page.url(),
    final: await visibleHead(page),
    steps,
    net: net.slice(0, 80)
  };
  fs.writeFileSync(path.join(OUT, "finish-extra-next.json"), JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(OUT, "email-e.txt"), email + "\n");
  await browser.close();
  console.log(JSON.stringify({
    email,
    stoppedForSsn,
    finishReason,
    finalUrl: out.finalUrl,
    steps: steps.map((s) => ({
      i: s.i,
      titles: s.before?.titles || s.after?.titles,
      click: s.click,
      afterTitles: s.after?.titles
    }))
  }));
})().catch((e) => {
  console.error(String((e && e.stack) || e).slice(0, 900));
  process.exit(1);
});
