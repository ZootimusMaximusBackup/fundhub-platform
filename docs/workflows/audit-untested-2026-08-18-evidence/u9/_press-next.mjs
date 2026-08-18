/**
 * U9 follow-up: scroll to Next and press it. Evidence only.
 * Stops if step 2 asks for SSN. Does not book or pay.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-untested-2026-08-18-evidence/u9");
const APPLY = "https://apply.fundhub.ai";
const email = `e2e+aff-u9b-${Date.now()}@fundhub.ai`;

function chromeExe() {
  const p = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  return fs.existsSync(p) ? p : undefined;
}

async function facts(page) {
  return page.evaluate(() => {
    const text = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && st.display !== "none" && st.visibility !== "hidden";
    };
    const fields = [...document.querySelectorAll("input,select,textarea")].filter(visible).map((el) => ({
      tag: el.tagName.toLowerCase(),
      type: el.type || "",
      name: el.name || el.id || "",
      placeholder: el.placeholder || "",
      aria: el.getAttribute("aria-label") || "",
      required: !!el.required
    }));
    const nextEls = [...document.querySelectorAll("a,button,div,span,[role=button]")]
      .filter((el) => /^next$/i.test((el.innerText || "").trim()) && visible(el))
      .map((el) => ({
        tag: el.tagName,
        className: String(el.className || "").slice(0, 120),
        href: el.getAttribute("href") || "",
        y: Math.round(el.getBoundingClientRect().top)
      }));
    return {
      href: location.href,
      title: document.title,
      stepCopy: (text.match(/STEP\s+\d+\s+OF\s+\d+/i) || [null])[0],
      text: text.slice(0, 2000),
      fields,
      nextEls,
      hasSsn: /ssn|social security/i.test(text) || fields.some((f) => /ssn|social/i.test(`${f.name} ${f.placeholder} ${f.aria}`))
    };
  });
}

async function shot(page, slug) {
  const file = path.join(OUT, `${slug}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return path.relative(ROOT, file);
}

const net = [];
const log = [];

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
  page.on("response", (res) => {
    const url = res.url();
    if (!/clickfunnels|fundhub\.ai|survey|webhook|contacts|forms|submissions|workflow/i.test(url)) return;
    if (/\.(png|jpg|jpeg|gif|svg|woff2?|css|mp4|js)(\?|$)/i.test(url)) return;
    net.push({ status: res.status(), method: res.request().method(), url: url.slice(0, 260) });
  });

  await page.goto(APPLY + "/apply", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(3500);
  await page.locator('input[placeholder*="First Name" i]').first().fill("E2e");
  await page.locator('input[placeholder*="Last Name" i]').first().fill("AffU9b");
  await page.locator('input[type="email"]').first().fill(email);
  await page.locator('input[type="tel"]').first().fill("5550100199");
  await page.waitForTimeout(400);
  log.push({ id: "filled", ...(await facts(page)), email });

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(400);
  const before = await facts(page);
  log.push({ id: "before-next", nextEls: before.nextEls, stepCopy: before.stepCopy });
  await shot(page, "u9-step1-scrolled");

  const next = page.locator("text=Next").last();
  await next.scrollIntoViewIfNeeded().catch(() => {});
  const vis = await next.isVisible().catch(() => false);
  log.push({ id: "next-locator", visible: vis, count: await page.locator("text=Next").count() });

  if (vis) {
    await next.click();
  } else {
    const clicked = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll("a,button,div,span,[role=button]")];
      const el = nodes.find((n) => /^next$/i.test((n.innerText || "").trim()));
      if (!el) return false;
      el.scrollIntoView({ block: "center" });
      el.click();
      return true;
    });
    log.push({ id: "next-evaluate-click", clicked });
  }
  await page.waitForTimeout(3500);

  const after = await facts(page);
  await shot(page, "u9-after-next-scrolled");
  log.push({ id: "after-next", ...after });

  let stoppedForSsn = !!after.hasSsn;
  let finishedStep2 = false;
  let finishReason = stoppedForSsn ? "ssn_stop" : "unknown";

  if (stoppedForSsn) {
    await shot(page, "u9-step2-ssn-fields");
  } else if (/funding-book-call|thank-you/i.test(page.url())) {
    finishReason = "left_apply_after_next";
    await shot(page, "u9-left-apply-after-next");
  } else if (/STEP\s+2/i.test(after.stepCopy || after.text || "")) {
    finishReason = "step2_visible";
    await shot(page, "u9-step2-visible");
    const optionRe = /\$|k\b|Less than|Growth|Equipment|Debt|Payroll|Not sure|Peace|Grow faster|Pay off|Stability|Fresh start|500-|580-|650-|700-|750\+|months|years|personal funding|Under \$|bank statements|tax returns|pay stubs|Not right now|Available|\$1k|\$5k|\$25k|\$100k/i;
    const texts = await page.evaluate(() =>
      [...document.querySelectorAll("button, [role=button], label, a, div, span")]
        .map((el) => (el.innerText || "").replace(/\s+/g, " ").trim())
        .filter((t) => t && t.length < 70)
    );
    log.push({ id: "step2-clickables", texts: texts.slice(0, 60) });
    const pick = texts.find((t) => optionRe.test(t));
    if (pick && !stoppedForSsn) {
      await page.getByText(pick, { exact: true }).first().click().catch(() => {});
      await page.waitForTimeout(2000);
      await shot(page, "u9-step2-after-first-choice");
      log.push({ id: "step2-clicked", pick, href: page.url(), ...(await facts(page)) });
    }
    const now = await facts(page);
    stoppedForSsn = !!now.hasSsn;
    if (stoppedForSsn) finishReason = "ssn_stop";
    else if (/funding-book-call/i.test(page.url())) {
      finishedStep2 = true;
      finishReason = "landed_book_did_not_book";
    } else finishReason = "step2_visible_not_completed";
  } else {
    finishReason = "still_step1_or_unknown";
    await shot(page, "u9-still-unknown");
  }

  const out = {
    at: new Date().toISOString(),
    email,
    stoppedForSsn,
    finishedStep2,
    finishReason,
    booked: false,
    paid: false,
    finalUrl: page.url(),
    final: await facts(page),
    log,
    net: net.slice(0, 60)
  };
  fs.writeFileSync(path.join(OUT, "press-next.json"), JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(OUT, "email-b.txt"), email + "\n");
  await browser.close();
  console.log(JSON.stringify({
    email,
    stoppedForSsn,
    finishedStep2,
    finishReason,
    finalUrl: out.finalUrl,
    stepCopy: out.final.stepCopy,
    hasSsn: out.final.hasSsn,
    nextEls: out.final.nextEls
  }));
})().catch((e) => {
  console.error(String((e && e.stack) || e).slice(0, 900));
  process.exit(1);
});
