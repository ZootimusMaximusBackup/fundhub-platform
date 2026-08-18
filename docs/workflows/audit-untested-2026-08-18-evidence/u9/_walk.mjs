/**
 * U9 evidence walk. Live apply.fundhub.ai only. Does not edit the app.
 * Fake e2e only. Stops if step 2 asks for SSN. Does not book or pay.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-untested-2026-08-18-evidence/u9");
const APPLY = "https://apply.fundhub.ai";

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
  const dirs = fs
    .readdirSync(root)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const d of dirs) {
    const exe = path.join(root, d, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
    if (fs.existsSync(exe)) return exe;
  }
  return undefined;
}

function botSignals(text) {
  const t = String(text || "");
  const hits = [];
  if (/are you a robot|unusual traffic|access denied|cf-browser-verification|just a moment|checking your browser|blocked|bot detected|verify you are human|hcaptcha|recaptcha/i.test(t)) {
    hits.push("challenge_or_bot_copy");
  }
  return hits;
}

async function pageFacts(page) {
  return page.evaluate(() => {
    const text = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
    const visible = (el) => {
      const st = getComputedStyle(el);
      return st.display !== "none" && st.visibility !== "hidden" && el.offsetParent !== null;
    };
    const fields = [...document.querySelectorAll("input,select,textarea")].filter(visible).map((el) => ({
      tag: el.tagName.toLowerCase(),
      type: el.type || "",
      name: el.name || el.id || "",
      placeholder: el.placeholder || "",
      aria: el.getAttribute("aria-label") || "",
      required: !!el.required,
      valueLen: String(el.value || "").length
    }));
    const options = [...document.querySelectorAll("button, [role=button], label, .elButton, [class*='option'], [class*='choice']")]
      .filter(visible)
      .map((el) => (el.innerText || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim())
      .filter((t) => t && t.length < 80)
      .slice(0, 40);
    const cookies = document.cookie || "";
    const visitor = (cookies.match(/cfhoy_visitor=([^;]+)/) || [])[1] || null;
    return {
      href: location.href,
      title: document.title,
      text: text.slice(0, 1800),
      stepCopy: (text.match(/STEP\s+\d+\s+OF\s+\d+/i) || [null])[0],
      fields,
      options,
      visitor,
      visitorLooksBot: /^bot-/i.test(visitor || "")
    };
  });
}

function ssnAsked(facts) {
  const blob = `${facts.text || ""} ${JSON.stringify(facts.fields || [])}`;
  return /ssn|social security|social-security/i.test(blob);
}

async function shot(page, slug, full = true) {
  const file = path.join(OUT, `${slug}.png`);
  await page.screenshot({ path: file, fullPage: full }).catch((e) => {
    console.log("shot fail", slug, String(e.message || e).slice(0, 120));
  });
  return path.relative(ROOT, file);
}

async function launch(headless) {
  const exe = chromeExe();
  const browser = await chromium.launch({
    headless,
    executablePath: exe,
    args: ["--disable-blink-features=AutomationControlled"]
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 980 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    locale: "en-US"
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  return { browser, context, page };
}

(async () => {
  const email = `e2e+aff-u9-${Date.now()}@fundhub.ai`;
  const net = [];
  const log = [];
  const shots = [];
  let headless = true;

  let { browser, page } = await launch(headless);

  page.on("response", (res) => {
    const url = res.url();
    if (!/clickfunnels|fundhub\.ai|survey|webhook|contacts|forms|submissions|cal\.com/i.test(url)) return;
    if (/\.(png|jpg|jpeg|gif|svg|woff2?|css|mp4)(\?|$)/i.test(url)) return;
    net.push({
      at: new Date().toISOString(),
      status: res.status(),
      method: res.request().method(),
      url: url.slice(0, 240)
    });
  });

  async function goto(url, settle = 2800) {
    let status = null;
    let err = null;
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch((e) => {
      err = String(e.message || e).slice(0, 240);
      return null;
    });
    if (resp) status = resp.status();
    await page.waitForTimeout(settle);
    return { requested: url, status, navError: err, finalUrl: page.url() };
  }

  const watch = await goto(APPLY + "/watch", 3200);
  shots.push(await shot(page, "u9-watch"));
  const watchFacts = await pageFacts(page);
  log.push({ id: "watch", ...watch, facts: watchFacts, bot: botSignals(watchFacts.text) });

  const apply = await goto(APPLY + "/apply", 3500);
  shots.push(await shot(page, "u9-apply-step1"));
  let applyFacts = await pageFacts(page);

  if (/funding-book-call|thank-you/i.test(page.url()) || /You Are Qualified|Book Your Funding Call/i.test(applyFacts.text)) {
    await browser.close();
    headless = false;
    ({ browser, page } = await launch(false));
    page.on("response", (res) => {
      const url = res.url();
      if (!/clickfunnels|fundhub\.ai|survey|webhook|contacts|forms|submissions|cal\.com/i.test(url)) return;
      if (/\.(png|jpg|jpeg|gif|svg|woff2?|css|mp4)(\?|$)/i.test(url)) return;
      net.push({
        at: new Date().toISOString(),
        status: res.status(),
        method: res.request().method(),
        url: url.slice(0, 240),
        headedRetry: true
      });
    });
    const retry = await goto(APPLY + "/apply", 4000);
    shots.push(await shot(page, "u9-apply-step1-headed"));
    applyFacts = await pageFacts(page);
    log.push({ id: "apply-bot-skip-then-headed", firstUrl: apply.finalUrl, ...retry, facts: applyFacts });
  } else {
    log.push({ id: "apply-step1", ...apply, facts: applyFacts, bot: botSignals(applyFacts.text) });
  }

  async function fillFirst(selectors, value, label) {
    for (const sel of selectors) {
      const loc = page.locator(sel).first();
      if (!(await loc.count())) continue;
      if (!(await loc.isVisible().catch(() => false))) continue;
      await loc.fill(value).catch((e) => {
        log.push({ id: "fill-error", label, sel, error: String(e.message || e).slice(0, 120) });
      });
      log.push({ id: "fill", label, sel, ok: true, value: label === "email" ? value : "(set)" });
      return true;
    }
    log.push({ id: "fill", label, ok: false });
    return false;
  }

  await fillFirst(['input[name*="first" i]', 'input[placeholder*="First Name" i]', 'input[placeholder*="first" i]'], "E2e", "first");
  await fillFirst(['input[name*="last" i]', 'input[placeholder*="Last Name" i]', 'input[placeholder*="last" i]'], "AffU9", "last");
  await fillFirst(['input[type="email"]', 'input[placeholder*="Email" i]'], email, "email");
  await fillFirst(['input[type="tel"]', 'input[placeholder*="Phone" i]', 'input[name*="phone" i]'], "5550100199", "phone");
  await page.waitForTimeout(400);
  shots.push(await shot(page, "u9-apply-step1-filled"));
  const filledFacts = await pageFacts(page);
  log.push({ id: "apply-step1-filled", href: page.url(), facts: filledFacts, emailUsed: email });

  const nextBtn = page.getByRole("button", { name: /^next$/i }).or(page.locator("button:has-text('Next'), [role=button]:has-text('Next')")).first();
  const nextVisible = await nextBtn.isVisible().catch(() => false);
  log.push({ id: "next-button", visible: nextVisible });
  if (!nextVisible) {
    shots.push(await shot(page, "u9-no-next"));
  } else {
    await nextBtn.click();
    await page.waitForTimeout(2800);
  }

  shots.push(await shot(page, "u9-after-next"));
  let step2 = await pageFacts(page);
  log.push({ id: "after-next", href: page.url(), facts: step2, ssnAsked: ssnAsked(step2) });

  let stoppedForSsn = ssnAsked(step2);
  let finishedStep2 = false;
  let finishReason = stoppedForSsn ? "ssn_stop" : "not_finished";

  if (stoppedForSsn) {
    shots.push(await shot(page, "u9-step2-ssn-stop"));
  } else if (/funding-book-call|thank-you|checkout|pay/i.test(page.url())) {
    finishReason = "left_apply_after_next_no_step2_seen";
  } else {
    shots.push(await shot(page, "u9-step2-fields"));
    const seen = [];
    for (let i = 0; i < 12; i++) {
      const now = await pageFacts(page);
      if (ssnAsked(now)) {
        stoppedForSsn = true;
        finishReason = "ssn_stop";
        shots.push(await shot(page, `u9-step2-ssn-stop-${i}`));
        log.push({ id: "step2-ssn", i, facts: now });
        break;
      }
      if (/funding-book-call/i.test(page.url())) {
        finishReason = "landed_book_after_extra_fields";
        finishedStep2 = true;
        shots.push(await shot(page, "u9-landed-book-no-book"));
        log.push({ id: "landed-book", i, facts: now, booked: false });
        break;
      }
      if (/thank-you|checkout|pay/i.test(page.url())) {
        finishReason = "left_apply_to_" + page.url();
        shots.push(await shot(page, "u9-left-apply"));
        log.push({ id: "left-apply", i, href: page.url(), facts: now });
        break;
      }

      const optionTexts = (now.options || []).filter((t) =>
        /\$|k\b|yes|no|growth|equipment|payroll|debt|not sure|peace|grow|pay off|stability|fresh|500|580|650|700|750|months|years|personal|bank|tax|pay stub|verify|capital|less than|under /i.test(t)
      );
      let clicked = false;
      for (const t of optionTexts) {
        if (seen.includes(t)) continue;
        const loc = page.getByText(t, { exact: true }).first();
        if (await loc.isVisible().catch(() => false)) {
          await loc.click({ timeout: 2500 }).catch(() => {});
          seen.push(t);
          clicked = true;
          await page.waitForTimeout(1600);
          shots.push(await shot(page, `u9-step2-q${i}`));
          log.push({ id: "clicked-option", i, text: t, href: page.url() });
          break;
        }
      }
      if (!clicked) {
        const cont = page.getByRole("button", { name: /next|continue|submit/i }).first();
        if (await cont.isVisible().catch(() => false)) {
          await cont.click().catch(() => {});
          await page.waitForTimeout(1800);
          shots.push(await shot(page, `u9-step2-continue-${i}`));
          log.push({ id: "clicked-continue", i, href: page.url() });
          continue;
        }
        finishReason = "no_more_safe_controls";
        shots.push(await shot(page, "u9-step2-stuck"));
        log.push({ id: "stuck", i, facts: now });
        break;
      }
    }
  }

  const finalFacts = await pageFacts(page);
  shots.push(await shot(page, "u9-final"));

  const summary = {
    at: new Date().toISOString(),
    groundTruth: "MISSING intended funnel journey — scored against board claim",
    emailUsed: email,
    nameUsed: "E2e AffU9",
    phoneUsed: "5550100199",
    headlessFirst: true,
    headedRetry: !headless,
    stoppedForSsn,
    finishedStep2,
    finishReason,
    booked: false,
    paid: false,
    finalUrl: page.url(),
    finalFacts,
    log,
    shots,
    net: net.slice(0, 80)
  };
  fs.writeFileSync(path.join(OUT, "walk.json"), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(OUT, "email.txt"), email + "\n");
  await browser.close();
  console.log(JSON.stringify({
    email,
    stoppedForSsn,
    finishedStep2,
    finishReason,
    finalUrl: summary.finalUrl,
    shots: shots.length
  }));
})().catch((e) => {
  console.error(String((e && e.stack) || e).slice(0, 800));
  process.exit(1);
});
