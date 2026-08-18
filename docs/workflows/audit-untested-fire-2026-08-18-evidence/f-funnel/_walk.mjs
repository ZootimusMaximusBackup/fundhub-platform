/**
 * F-FUNNEL evidence walk. Read-only vs app. Writes only this evidence folder.
 * Fake e2e only. No SSN typed. No pay. One Confirm press.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-untested-fire-2026-08-18-evidence/f-funnel");
const APPLY = "https://apply.fundhub.ai";
const stamp = Date.now();
const email = `e2e+aff-fire-${stamp}@fundhub.ai`;
const first = "E2e";
const last = "Fire";
const phoneDigits = "2015550123";

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "email.txt"), email + "\n");

function chromeExe() {
  const p = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  return fs.existsSync(p) ? p : undefined;
}

function clip(s, n = 220) {
  return String(s || "").replace(/\s+/g, " ").trim().slice(0, n);
}

async function facts(page) {
  return page.evaluate(() => {
    const text = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
    const titles = [...document.querySelectorAll("h1,h2,h3,h4,.elHeadline")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        const st = getComputedStyle(el);
        return r.width > 0 && r.height > 8 && st.visibility !== "hidden" && st.display !== "none";
      })
      .map((el) => (el.innerText || "").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 10);
    const fields = [...document.querySelectorAll("input,select,textarea")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && el.type !== "hidden";
      })
      .map((el) => ({
        type: el.type || el.tagName.toLowerCase(),
        name: el.name || "",
        placeholder: el.placeholder || "",
        aria: el.getAttribute("aria-label") || "",
        checked: !!el.checked
      }));
    const options = [...document.querySelectorAll("label, [class*='Choice'], [class*='choice'], [role=radio], [class*='option']")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        const st = getComputedStyle(el);
        return r.width > 40 && r.height > 12 && st.visibility !== "hidden" && st.display !== "none";
      })
      .map((el) => (el.innerText || "").replace(/\s+/g, " ").trim())
      .filter((t) => t && t.length < 90)
      .slice(0, 20);
    return {
      href: location.href,
      title: document.title,
      headerStep: (text.match(/STEP\s+\d+\s+OF\s+\d+/i) || [null])[0],
      titles,
      options: [...new Set(options)],
      fields,
      hasSsn: /ssn|social security/i.test(text) || fields.some((f) => /ssn|social/i.test(`${f.name} ${f.placeholder} ${f.aria}`)),
      text: text.slice(0, 1800)
    };
  });
}

async function shot(page, slug) {
  const file = path.join(OUT, `${slug}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return path.relative(ROOT, file);
}

async function clickVisibleText(page, label) {
  const loc = page.getByText(label, { exact: true }).first();
  if (await loc.isVisible().catch(() => false)) {
    await loc.click({ timeout: 2500 }).catch(() => {});
    return label;
  }
  return null;
}

async function pickSurveyOption(page, preferred) {
  const viaText = await clickVisibleText(page, preferred);
  if (viaText) return { how: "text", option: viaText };

  const viaEval = await page.evaluate((want) => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && st.display !== "none" && st.visibility !== "hidden";
    };
    const nodes = [...document.querySelectorAll("label, div, span, p, li, button")].filter(
      (el) => vis(el) && (el.innerText || "").replace(/\s+/g, " ").trim() === want
    );
    const el = nodes.sort((a, b) => a.innerText.length - b.innerText.length)[0];
    if (!el) return null;
    const target = el.closest("label, [class*='Choice'], [class*='choice'], [role=radio], [class*='option']") || el;
    const input = target.querySelector("input") || el.querySelector("input");
    if (input) input.click();
    target.click();
    return want;
  }, preferred);
  if (viaEval) return { how: "eval", option: viaEval };

  const firstChoice = await page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      return r.width > 40 && r.height > 16 && st.display !== "none" && st.visibility !== "hidden";
    };
    const nodes = [...document.querySelectorAll("[class*='Choice'], [class*='choice'], label, [role=radio]")]
      .filter((el) => vis(el) && (el.innerText || "").trim().length > 0 && (el.innerText || "").trim().length < 90);
    const el = nodes[0];
    if (!el) return null;
    const input = el.querySelector("input");
    if (input) input.click();
    el.click();
    return (el.innerText || "").replace(/\s+/g, " ").trim();
  });
  if (firstChoice) return { how: "first-visible", option: firstChoice };
  return { how: "none", option: null };
}

async function pressNext(page) {
  const next = page.locator("a.elButton, button").filter({ hasText: /^Next$/ }).first();
  if (await next.isVisible().catch(() => false)) {
    await next.click({ timeout: 3000 }).catch(() => {});
    return true;
  }
  return false;
}

const PICK_BY_TITLE = [
  { match: /target amount/i, pick: "Less than $50k" },
  { match: /planned use/i, pick: "Not sure yet" },
  { match: /money change/i, pick: "Peace of mind (stop stressing about cash)" },
  { match: /current score/i, pick: "Not sure" },
  { match: /have a business/i, pick: "No, personal funding only" },
  { match: /personal income/i, pick: "Less than $50k" },
  { match: /verify income/i, pick: "Not right now" },
  { match: /business revenue/i, pick: "Under $100k" },
  { match: /verify revenue/i, pick: "Not right now" },
  { match: /available capital/i, pick: "Less than $1k" }
];

function pickFor(titles) {
  const blob = titles.join(" | ");
  for (const row of PICK_BY_TITLE) {
    if (row.match.test(blob)) return row.pick;
  }
  return "Less than $50k";
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: chromeExe(),
    args: ["--disable-blink-features=AutomationControlled"]
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
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
    if (!/clickfunnels|fundhub\.ai|survey|webhook|workflow|contacts|appoint|book|calendar|cf_survey|user_pages\/api/i.test(url)) return;
    if (/\.(png|jpg|jpeg|gif|svg|woff2?|css|mp4|js)(\?|$)/i.test(url)) return;
    net.push({
      at: new Date().toISOString(),
      status: res.status(),
      method: res.request().method(),
      url: url.slice(0, 320)
    });
  });

  const log = {
    at: new Date().toISOString(),
    email,
    first,
    last,
    phone: "201-555-0123",
    watch: null,
    apply: null,
    extras: [],
    book: null,
    confirm: null,
    confirmPressed: false,
    booked: false,
    paid: false,
    ssnSkipped: false,
    finishReason: "walking"
  };

  // 1. /watch
  const watchResp = await page.goto(APPLY + "/watch", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(2800);
  log.watch = {
    status: watchResp ? watchResp.status() : null,
    ...(await facts(page)),
    shot: await shot(page, "01-watch")
  };

  // 2. /apply step 1
  const applyResp = await page.goto(APPLY + "/apply", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(3500);
  await shot(page, "02-apply-step1");
  await page.locator('input[placeholder*="First Name" i]').first().click();
  await page.keyboard.type(first, { delay: 28 });
  await page.locator('input[placeholder*="Last Name" i]').first().click();
  await page.keyboard.type(last, { delay: 28 });
  await page.locator('input[type="email"]').first().click();
  await page.keyboard.type(email, { delay: 12 });
  const tel = page.locator('input[type="tel"]').first();
  await tel.click();
  await tel.press("Meta+A");
  await tel.press("Backspace");
  await page.keyboard.type(phoneDigits, { delay: 35 });
  await page.waitForTimeout(400);
  log.apply = {
    status: applyResp ? applyResp.status() : null,
    filled: await facts(page),
    shot: await shot(page, "03-apply-step1-filled")
  };
  await pressNext(page);
  await page.waitForTimeout(2800);
  await shot(page, "04-after-contact-next");

  // 3. extra cards
  for (let i = 0; i < 14; i++) {
    const before = await facts(page);
    const slug = `05-extra-${String(i + 1).padStart(2, "0")}`;
    const shotPath = await shot(page, slug);
    const step = { i, before: { href: before.href, titles: before.titles, options: before.options, hasSsn: before.hasSsn, headerStep: before.headerStep }, shot: shotPath };
    log.extras.push(step);

    if (before.hasSsn) {
      log.ssnSkipped = true;
      await shot(page, "05-ssn-skipped");
      const ssnFields = page.locator('input[name*="ssn" i], input[placeholder*="ssn" i], input[aria-label*="ssn" i], input[placeholder*="social" i]');
      const n = await ssnFields.count().catch(() => 0);
      step.ssnFieldCount = n;
      const nextAnyway = await pressNext(page);
      step.skippedSsnPressedNext = nextAnyway;
      await page.waitForTimeout(2200);
      continue;
    }
    if (/funding-book-call/i.test(page.url())) {
      log.finishReason = "landed_book";
      await shot(page, "06-landed-book");
      break;
    }
    if (/thank-you|checkout|pay/i.test(page.url())) {
      log.finishReason = "left_apply_" + page.url();
      await shot(page, "06-left-apply");
      break;
    }

    const want = pickFor(before.titles);
    const click = await pickSurveyOption(page, want);
    await page.waitForTimeout(500);
    const next = await pressNext(page);
    await page.waitForTimeout(2200);
    const after = await facts(page);
    step.click = click;
    step.next = next;
    step.after = { href: after.href, titles: after.titles, hasSsn: after.hasSsn };

    if (/funding-book-call/i.test(page.url())) {
      log.finishReason = "landed_book";
      await shot(page, "06-landed-book");
      break;
    }
    if (JSON.stringify(before.titles) === JSON.stringify(after.titles) && i > 0) {
      log.finishReason = "did_not_advance";
      await shot(page, "06-extras-stuck");
      break;
    }
  }
  if (log.finishReason === "walking") log.finishReason = "extras_loop_ended";

  // 4. book page
  if (!/funding-book-call/i.test(page.url())) {
    const bookResp = await page.goto(APPLY + "/funding-book-call", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(4500);
    log.book = { status: bookResp ? bookResp.status() : null, openedDirect: true, ...(await facts(page)), shot: await shot(page, "07-funding-book-call") };
  } else {
    await page.waitForTimeout(2500);
    log.book = { openedDirect: false, ...(await facts(page)), shot: await shot(page, "07-funding-book-call") };
  }

  // pick a live slot — prefer later afternoon/evening
  const slotBtns = page.locator("button, a, [role=button]").filter({ hasText: /\d{1,2}:\d{2}\s*(AM|PM).*(AM|PM)|Select time/i });
  const slotCount = await slotBtns.count().catch(() => 0);
  let slotLabel = null;
  if (slotCount > 0) {
    const idx = Math.max(0, slotCount - 2);
    const slot = slotBtns.nth(idx);
    slotLabel = clip(await slot.innerText().catch(() => ""), 80);
    await slot.click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(1800);
    await shot(page, "08-slot-opened");
  } else {
    await shot(page, "08-no-slot");
  }
  log.book = { ...(log.book || {}), slotCount, slotLabel, afterSlot: await facts(page) };

  // fill name/email if a form appeared
  const nameBox = page.locator('input[placeholder*="First Name" i], input[name*="first" i]').first();
  if (await nameBox.isVisible().catch(() => false)) {
    await nameBox.click();
    await page.keyboard.type(first, { delay: 25 });
    const lastBox = page.locator('input[placeholder*="Last Name" i], input[name*="last" i]').first();
    if (await lastBox.isVisible().catch(() => false)) {
      await lastBox.click();
      await page.keyboard.type(last, { delay: 25 });
    }
    const em = page.locator('input[type="email"]').first();
    if (await em.isVisible().catch(() => false)) {
      await em.click();
      await page.keyboard.type(email, { delay: 12 });
    }
    await shot(page, "08b-book-form-filled");
    log.book.formFilled = true;
  }

  const confirm = page.locator("button, a, [role=button]").filter({ hasText: /^Confirm( time)?$/i }).first();
  const confirmVisible = await confirm.isVisible().catch(() => false);
  log.confirm = { visible: confirmVisible, before: await facts(page) };
  if (confirmVisible) {
    await shot(page, "09-confirm-ready");
    await confirm.click({ timeout: 4000 }).catch((e) => {
      log.confirm.clickError = String(e.message || e).slice(0, 180);
    });
    log.confirmPressed = true;
    await page.waitForTimeout(4500);
    // if a contact form appears after first confirm, fill and press the remaining confirm once only if we have not yet booked — Chris said one confirm press.
    await shot(page, "10-after-confirm");
    log.confirm.after = await facts(page);
    const errText = (log.confirm.after.text || "");
    log.confirm.errorOnScreen = /error|failed|could not|try again|unable/i.test(errText);
    log.booked = /confirmed|you.?re booked|booking confirmed|see you|calendar invite|google meet/i.test(errText)
      && !log.confirm.errorOnScreen;
    log.confirm.finalUrl = page.url();
  } else {
    await shot(page, "09-confirm-missing");
  }

  log.finalUrl = page.url();
  log.final = await facts(page);
  log.net = net.slice(0, 120);
  fs.writeFileSync(path.join(OUT, "walk.json"), JSON.stringify(log, null, 2));
  await browser.close();
  console.log(JSON.stringify({
    email,
    watchStatus: log.watch && log.watch.status,
    applyStatus: log.apply && log.apply.status,
    extras: log.extras.map((s) => ({ i: s.i, titles: s.before.titles, click: s.click, after: s.after && s.after.titles })),
    finishReason: log.finishReason,
    slotLabel,
    confirmPressed: log.confirmPressed,
    booked: log.booked,
    confirmError: log.confirm && log.confirm.errorOnScreen,
    finalUrl: log.finalUrl
  }, null, 2));
})().catch((e) => {
  console.error(String((e && e.stack) || e).slice(0, 1200));
  process.exit(1);
});
