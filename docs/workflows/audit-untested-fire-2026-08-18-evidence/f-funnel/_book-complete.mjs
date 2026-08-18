/**
 * F-FUNNEL: finish the same-slot book form after Confirm.
 * One Book Appointment press. Fake e2e only. No second slot.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-untested-fire-2026-08-18-evidence/f-funnel");
const APPLY = "https://apply.fundhub.ai";
const email = fs.readFileSync(path.join(OUT, "email.txt"), "utf8").trim();
const firstLast = "E2e Fire";
const phoneDigits = "2015550123";

function chromeExe() {
  const p = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  return fs.existsSync(p) ? p : undefined;
}

async function facts(page) {
  return page.evaluate(() => {
    const text = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
    const fields = [...document.querySelectorAll("input,select,textarea")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && el.type !== "hidden";
      })
      .map((el) => ({
        type: el.type || el.tagName.toLowerCase(),
        name: el.name || "",
        placeholder: el.placeholder || "",
        valueLen: String(el.value || "").length
      }));
    return {
      href: location.href,
      title: document.title,
      fields,
      hasSsn: /ssn|social security/i.test(text),
      hasBookBtn: /book appointment/i.test(text),
      hasConfirm: /\bconfirm\b/i.test(text),
      text: text.slice(0, 2000)
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
    viewport: { width: 1440, height: 1100 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  const page = await context.newPage();
  const net = [];
  page.on("response", async (res) => {
    const url = res.url();
    if (!/appoint|book|calendar|user_pages\/api|clickfunnels|fundhub\.ai\/api/i.test(url)) return;
    if (/\.(png|jpg|jpeg|gif|svg|woff2?|css|mp4|js)(\?|$)/i.test(url)) return;
    let bodyPreview = "";
    try {
      const t = await res.text();
      bodyPreview = String(t || "").replace(/\s+/g, " ").slice(0, 240);
    } catch {
      bodyPreview = "";
    }
    net.push({
      at: new Date().toISOString(),
      status: res.status(),
      method: res.request().method(),
      url: url.slice(0, 320),
      bodyPreview
    });
  });

  const resp = await page.goto(APPLY + "/funding-book-call", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(4500);
  const open = { status: resp ? resp.status() : null, ...(await facts(page)), shot: await shot(page, "11-book-reopen") };

  const slot = page.locator("button, a, [role=button]").filter({ hasText: /8:00 PM - 8:30 PM/i }).first();
  const slotAlt = page.locator("button, a, [role=button]").filter({ hasText: /Select time/i }).last();
  const target = (await slot.isVisible().catch(() => false)) ? slot : slotAlt;
  const slotLabel = (await target.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
  await target.click({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(1600);
  await shot(page, "12-same-slot");

  const confirm = page.locator("button, a, [role=button]").filter({ hasText: /^Confirm( time)?$/i }).first();
  if (await confirm.isVisible().catch(() => false)) {
    await confirm.click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(2500);
  }
  await shot(page, "13-form-before-fill");
  const beforeFill = await facts(page);

  const nameBox = page.locator('input[name="name"], input[placeholder="Name"]').first();
  if (await nameBox.isVisible().catch(() => false)) {
    await nameBox.click();
    await nameBox.fill("");
    await page.keyboard.type(firstLast, { delay: 20 });
  }
  const em = page.locator('input[name="email"], input[placeholder="Email"], input[type="email"]').first();
  if (await em.isVisible().catch(() => false)) {
    await em.click();
    await em.fill("");
    await page.keyboard.type(email, { delay: 10 });
  }
  const tel = page.locator('input[name="phone_number"], input[type="tel"]').first();
  if (await tel.isVisible().catch(() => false)) {
    await tel.click();
    await tel.press("Meta+A");
    await tel.press("Backspace");
    await page.keyboard.type(phoneDigits, { delay: 30 });
  }
  await page.waitForTimeout(400);
  await shot(page, "14-form-filled");
  const filled = await facts(page);

  const bookBtn = page.locator("button, a, [role=button]").filter({ hasText: /book appointment/i }).first();
  const bookVisible = await bookBtn.isVisible().catch(() => false);
  let bookClick = { visible: bookVisible };
  if (bookVisible) {
    await bookBtn.click({ timeout: 4000 }).catch((e) => {
      bookClick.error = String(e.message || e).slice(0, 180);
    });
    bookClick.pressed = true;
    await page.waitForTimeout(5000);
  }
  await shot(page, "15-after-book-appointment");
  const after = await facts(page);

  const out = {
    at: new Date().toISOString(),
    email,
    open,
    slotLabel,
    beforeFill,
    filled,
    bookClick,
    after,
    errorOnScreen: /error|failed|could not|try again|unable|invalid/i.test(after.text || ""),
    confirmationOnScreen: /you.?re booked|booking confirmed|appointment (is )?booked|see you|invite sent|successfully booked/i.test(after.text || ""),
    stillOnForm: /book appointment/i.test(after.text || ""),
    finalUrl: page.url(),
    net
  };
  fs.writeFileSync(path.join(OUT, "book-complete.json"), JSON.stringify(out, null, 2));
  await browser.close();
  console.log(JSON.stringify({
    status: open.status,
    slotLabel,
    bookPressed: !!bookClick.pressed,
    errorOnScreen: out.errorOnScreen,
    confirmationOnScreen: out.confirmationOnScreen,
    stillOnForm: out.stillOnForm,
    afterText: (after.text || "").slice(0, 400),
    net: net.map((n) => ({ status: n.status, method: n.method, url: n.url.slice(0, 160) }))
  }, null, 2));
})().catch((e) => {
  console.error(String((e && e.stack) || e).slice(0, 1200));
  process.exit(1);
});
