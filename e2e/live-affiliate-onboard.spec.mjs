// Live affiliate path — against https://fundhub.ai only (not the local harness).
// Board: docs/workflows/affiliate-wl-onboarding-2026-08-16.md
// Scoreboard: docs/workflows/live-playwright-100.md
//
// These tests describe CURRENT live behavior. Gaps (apply does not mint a
// login, /start?ref= is 404, no funnel/site builder) are on the board for
// Workflow 4.
//
// One signed-in test on purpose. Affiliate emails are not on the staff table,
// so each login records a staff miss before the account login succeeds. Five
// of those in 15 minutes lock the address. Do not add more live logins here.

import { test, expect } from "@playwright/test";
import { BASE, staffPassword } from "./live-auth.mjs";

const AFF_EMAIL = "affiliate@fundhub.ai";

/** @param {import("@playwright/test").Page} page */
async function waitBootGone(page) {
  await page.locator("#boot").waitFor({ state: "hidden", timeout: 5_000 }).catch(() => {});
}

/** @param {import("@playwright/test").Page} page */
async function liveAffiliateLogin(page) {
  const deadline = Date.now() + 16 * 60 * 1000;
  for (;;) {
    await page.goto(`${BASE}/login.html?next=/app/affiliate.html`, {
      waitUntil: "domcontentloaded"
    });
    await waitBootGone(page);
    await page.locator('input[type="email"], #email, input[name="email"]').first().fill(AFF_EMAIL);
    await page.locator('input[type="password"], #password, input[name="password"]').first().fill(staffPassword());
    await page.locator('button[type="submit"], button:has-text("Sign"), button:has-text("Log")').first().click();
    try {
      await expect(page).not.toHaveURL(/login\.html/, { timeout: 8_000 });
      return;
    } catch {
      const text = await page.locator("body").innerText();
      if (!/Too many attempts/i.test(text)) throw new Error("affiliate sign-in did not leave login.html");
      if (Date.now() > deadline) throw new Error("affiliate sign-in still rate-limited after 16 minutes");
      await page.waitForTimeout(60_000);
    }
  }
}

test.describe("live affiliate onboard", () => {
  test("aff:website_entry homepage to affiliates", async ({ page }) => {
    test.info().annotations.push({ type: "req", description: "aff:website_entry" });
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await waitBootGone(page);
    const link = page.locator('header a[href="/affiliates/"]');
    await expect(link).toBeVisible();
    await link.click();
    await waitBootGone(page);
    await expect(page).toHaveURL(/\/affiliates\/?/);
    await expect(page.locator("body")).toContainText(/affiliate/i);
    await expect(page.locator("#pform")).toBeVisible();
  });

  test("aff:apply_form fake identity shows received", async ({ page }) => {
    test.info().annotations.push({ type: "req", description: "aff:apply_form" });
    page.on("dialog", (d) => d.accept());
    await page.goto(`${BASE}/affiliates/`, { waitUntil: "domcontentloaded" });
    await waitBootGone(page);
    await expect(page.locator("#p-name")).toBeVisible();
    await page.locator("#p-name").fill("E2E Aff Onboard");
    await page.locator("#p-email").fill("e2e+aff-onboard@fundhub.ai");
    await page.locator("#p-phone").fill("5550100199");
    await page.locator("#p-co").fill("E2E Aff Test Co");
    await page.locator("#p-track").selectOption("affiliate");
    await page.locator("#p-aud").fill("Fake list for live Playwright only");
    await page.locator("#p-sms").check();
    await page.locator("#pform button[type=submit]").click();
    await expect(page.locator("#success")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("#success")).toContainText(/login/i);
  });

  test("aff:own_login dashboard and session", async ({ page, request }) => {
    test.info().annotations.push({ type: "req", description: "aff:own_login" });
    test.info().annotations.push({ type: "req", description: "aff:dashboard" });
    test.info().annotations.push({ type: "req", description: "aff:session_affiliate" });
    test.setTimeout(18 * 60 * 1000);

    await liveAffiliateLogin(page);
    if (!/affiliate\.html/.test(page.url())) {
      await page.goto(`${BASE}/app/affiliate.html`, { waitUntil: "domcontentloaded" });
    }
    await expect(page).toHaveURL(/affiliate\.html/);
    await expect(page.locator("h1")).toContainText(/Affiliate/i);
    await expect(page.locator("body")).toContainText(/YOUR REFERRAL LINK/i);
    await expect(page.locator("#reflink")).toBeVisible();
    await expect(page.locator("#copyLink")).toBeVisible();
    await expect(page.locator("#funnel")).toBeVisible();
    await expect(page.locator("#funnel")).toContainText(/clicks|sign-ups|funded/i);

    const token = await page.evaluate(() => {
      try { return localStorage.getItem("fh_token") || ""; } catch { return ""; }
    });
    expect(token).toBeTruthy();
    const sess = await request.get(`${BASE}/api/auth/session`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(sess.status()).toBe(200);
    const who = await sess.json();
    expect(who.ok).toBeTruthy();
    expect(who.principal === "affiliate" || who.staff?.role === "affiliate").toBeTruthy();
  });
});
