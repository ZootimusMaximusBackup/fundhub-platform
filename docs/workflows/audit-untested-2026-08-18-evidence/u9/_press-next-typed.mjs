/**
 * U9: type reserved 555 example phone like a person, then Next.
 * Not a real person’s number. Stops on SSN. Does not book or pay.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-untested-2026-08-18-evidence/u9");
const APPLY = "https://apply.fundhub.ai";
const email = `e2e+aff-u9c-${Date.now()}@fundhub.ai`;

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
    const fields = [...document.querySelectorAll("input,select,textarea")].filter((el) => el.type !== "hidden").map((el) => ({
      tag: el.tagName.toLowerCase(),
      type: el.type || "",
      name: el.name || el.id || "",
      placeholder: el.placeholder || "",
      aria: el.getAttribute("aria-label") || "",
      vis: visible(el),
      valueLen: String(el.value || "").length
    }));
    const hidden = [...document.querySelectorAll("input[type=hidden]")].map((el) => ({
      name: el.name || el.id || "",
      valueLen: String(el.value || "").length,
      valueLooksPhone: /^\+?\d/.test(String(el.value || ""))
    }));
    return {
      href: location.href,
      stepCopy: (text.match(/STEP\s+\d+\s+OF\s+\d+/i) || [null])[0],
      text: text.slice(0, 2200),
      fields,
      hidden,
      hasSsn: /ssn|social security/i.test(text),
      phoneError: /invalid country code|phone number/i.test(text)
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
    if (!/clickfunnels|fundhub\.ai\/(api|apply)|survey|webhook|workflow|contacts/i.test(url)) return;
    if (/\.(png|jpg|jpeg|gif|svg|woff2?|css|mp4|js)(\?|$)/i.test(url)) return;
    net.push({ status: res.status(), method: res.request().method(), url: url.slice(0, 260) });
  });

  await page.goto(APPLY + "/apply", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(3500);

  await page.locator('input[placeholder*="First Name" i]').first().click();
  await page.keyboard.type("E2e", { delay: 40 });
  await page.locator('input[placeholder*="Last Name" i]').first().click();
  await page.keyboard.type("AffU9c", { delay: 40 });
  await page.locator('input[type="email"]').first().click();
  await page.keyboard.type(email, { delay: 20 });

  const tel = page.locator('input[type="tel"]').first();
  await tel.click();
  await tel.press("Meta+A");
  await tel.press("Backspace");
  await page.keyboard.type("2015550123", { delay: 50 });
  await page.waitForTimeout(500);

  const filled = await facts(page);
  await shot(page, "u9-step1-typed-phone");

  await page.locator("a.elButton").filter({ hasText: /^Next$/ }).first().click();
  await page.waitForTimeout(4000);

  const after = await facts(page);
  await shot(page, "u9-after-next-typed");

  let stoppedForSsn = !!after.hasSsn;
  let finishReason = stoppedForSsn ? "ssn_stop" : after.stepCopy || "unknown";
  if (stoppedForSsn) await shot(page, "u9-step2-ssn-fields");
  else if (/STEP\s+2/i.test(after.stepCopy || after.text || "")) {
    finishReason = "step2_visible";
    await shot(page, "u9-step2-all-fields");
  } else if (/funding-book-call/i.test(page.url())) {
    finishReason = "landed_book_did_not_book";
    await shot(page, "u9-landed-book-no-book");
  } else if (/invalid country code/i.test(after.text || "")) {
    finishReason = "phone_invalid_country_code";
  }

  const out = {
    at: new Date().toISOString(),
    email,
    phoneTyped: "2015550123",
    phoneNote: "NANP example / field placeholder, not a real person",
    stoppedForSsn,
    finishReason,
    booked: false,
    paid: false,
    finalUrl: page.url(),
    filled,
    after,
    net: net.slice(0, 40)
  };
  fs.writeFileSync(path.join(OUT, "press-next-typed.json"), JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(OUT, "email-c.txt"), email + "\n");
  await browser.close();
  console.log(JSON.stringify({
    email,
    stoppedForSsn,
    finishReason,
    finalUrl: out.finalUrl,
    stepCopy: after.stepCopy,
    hasSsn: after.hasSsn,
    phoneError: after.phoneError
  }));
})().catch((e) => {
  console.error(String((e && e.stack) || e).slice(0, 900));
  process.exit(1);
});
