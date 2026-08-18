/**
 * U9: finish extra survey fields with fake/non-PII choices only.
 * Stop on SSN. Do not book. Do not pay.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-untested-2026-08-18-evidence/u9");
const APPLY = "https://apply.fundhub.ai";
const email = `e2e+aff-u9d-${Date.now()}@fundhub.ai`;

const PICKS = [
  "Less than $50k",
  "Not sure yet",
  "Peace of mind (stop stressing about cash)",
  "Not sure",
  "No, personal funding only",
  "Less than $50k",
  "Not right now",
  "Less than $1k"
];

function chromeExe() {
  const p = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  return fs.existsSync(p) ? p : undefined;
}

async function visibleCard(page) {
  return page.evaluate(() => {
    const card = document.querySelector(".elSurveyQuestion, .elSurveySlide:not([style*='display: none']), [class*='Survey']") || document.body;
    const text = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
    const visibles = [...document.querySelectorAll("h1,h2,h3,h4,.elHeadline,p,label,button,a")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        const st = getComputedStyle(el);
        return r.width > 0 && r.height > 20 && st.visibility !== "hidden" && st.display !== "none";
      })
      .map((el) => (el.innerText || "").replace(/\s+/g, " ").trim())
      .filter((t) => t && t.length < 90);
    const fields = [...document.querySelectorAll("input,select,textarea")].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && el.type !== "hidden";
    }).map((el) => ({
      type: el.type || "",
      name: el.name || "",
      placeholder: el.placeholder || "",
      aria: el.getAttribute("aria-label") || ""
    }));
    return {
      href: location.href,
      headerStep: (text.match(/STEP\s+\d+\s+OF\s+\d+/i) || [null])[0],
      visibles: [...new Set(visibles)].slice(0, 40),
      fields,
      hasSsn: /ssn|social security/i.test(text) || fields.some((f) => /ssn|social/i.test(`${f.name} ${f.placeholder} ${f.aria}`)),
      cardTag: card && card.className ? String(card.className).slice(0, 80) : null
    };
  });
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
    net.push({ status: res.status(), method: res.request().method(), url: url.slice(0, 280) });
  });

  await page.goto(APPLY + "/apply", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(3200);
  await page.locator('input[placeholder*="First Name" i]').first().click();
  await page.keyboard.type("E2e", { delay: 30 });
  await page.locator('input[placeholder*="Last Name" i]').first().click();
  await page.keyboard.type("AffU9d", { delay: 30 });
  await page.locator('input[type="email"]').first().click();
  await page.keyboard.type(email, { delay: 15 });
  const tel = page.locator('input[type="tel"]').first();
  await tel.click();
  await tel.press("Meta+A");
  await tel.press("Backspace");
  await page.keyboard.type("2015550123", { delay: 40 });
  await page.waitForTimeout(300);
  await page.locator("a.elButton").filter({ hasText: /^Next$/ }).first().click();
  await page.waitForTimeout(2800);
  await shot(page, "u9-extra-00-after-contact");

  const steps = [];
  let stoppedForSsn = false;
  let finishReason = "walking";
  let booked = false;

  for (let i = 0; i < 14; i++) {
    const now = await visibleCard(page);
    await shot(page, `u9-extra-${String(i + 1).padStart(2, "0")}`);
    steps.push({ i, ...now });
    if (now.hasSsn) {
      stoppedForSsn = true;
      finishReason = "ssn_stop";
      await shot(page, "u9-step2-ssn-fields");
      break;
    }
    if (/funding-book-call/i.test(page.url())) {
      finishReason = "landed_book_did_not_book";
      booked = false;
      await shot(page, "u9-landed-book-no-book");
      break;
    }
    if (/thank-you|checkout|pay/i.test(page.url())) {
      finishReason = "left_apply_" + page.url();
      break;
    }

    let clicked = null;
    for (const pick of PICKS) {
      const loc = page.getByText(pick, { exact: true }).first();
      if (await loc.isVisible().catch(() => false)) {
        await loc.click({ timeout: 2500 }).catch(() => {});
        clicked = pick;
        break;
      }
    }
    if (!clicked) {
      const next = page.locator("a.elButton").filter({ hasText: /^Next$/ }).first();
      if (await next.isVisible().catch(() => false)) {
        await next.click().catch(() => {});
        clicked = "Next";
      }
    }
    steps[steps.length - 1].clicked = clicked;
    if (!clicked) {
      finishReason = "no_visible_safe_choice";
      break;
    }
    await page.waitForTimeout(2200);
  }

  if (finishReason === "walking") finishReason = "loop_ended";

  const out = {
    at: new Date().toISOString(),
    email,
    stoppedForSsn,
    finishReason,
    booked,
    paid: false,
    finalUrl: page.url(),
    final: await visibleCard(page),
    steps,
    net: net.slice(0, 80)
  };
  fs.writeFileSync(path.join(OUT, "finish-extra.json"), JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(OUT, "email-d.txt"), email + "\n");
  await browser.close();
  console.log(JSON.stringify({
    email,
    stoppedForSsn,
    finishReason,
    finalUrl: out.finalUrl,
    steps: steps.map((s) => ({ i: s.i, clicked: s.clicked, visibles: (s.visibles || []).slice(0, 8), hasSsn: s.hasSsn }))
  }));
})().catch((e) => {
  console.error(String((e && e.stack) || e).slice(0, 900));
  process.exit(1);
});
