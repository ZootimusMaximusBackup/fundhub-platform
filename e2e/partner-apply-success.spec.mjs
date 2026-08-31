// Playwright — what the public apply page shows after a white-label application.
//
// COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7): customer-facing copy.
//
// src/http/partner-apply-success-screen.test.mjs runs the page's submit handler
// against a stub document, which proves the branch decides correctly. This
// proves the screen a person actually sees: the real page, in a real browser,
// with the credentials list gone and the review-call list in its place.
//
// NO BACKEND. /api/public/partner-apply is answered here with the exact body
// api/public/partner-apply.mjs returns for an invite-only white-label
// application — every credential field null, because none of them exist until
// somebody calls POST /api/partners/approve.

import { test, expect } from "@playwright/test";

const WHITE_LABEL_RESPONSE = {
  ok: true,
  kind: "partner",
  status: "pending_review",
  email: "dana@example.test",
  password: null,
  login_url: null,
  referral_url: null,
  tracking_id: null,
  site_url: null,
  site_path: null,
  partner_id: "9f2c1d3e-0000-4000-8000-000000000001",
  affiliate_id: null
};

const AFFILIATE_RESPONSE = {
  ok: true,
  kind: "affiliate",
  status: "active",
  email: "dana@example.test",
  password: "s3cret-first-password",
  login_url: "https://fundhub.ai/login.html",
  referral_url: "https://fundhub.ai/start?ref=TRK123",
  tracking_id: "TRK123",
  site_url: null,
  site_path: null,
  partner_id: null,
  affiliate_id: "9f2c1d3e-0000-4000-8000-000000000002"
};

async function apply(page, { track, response }) {
  let submitted = null;
  await page.route("**/api/public/partner-apply", async (route) => {
    submitted = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(response)
    });
  });

  await page.goto("/affiliates/", { waitUntil: "domcontentloaded" });
  await page.locator("#p-name").fill("Dana Owner");
  await page.locator("#p-email").fill("dana@example.test");
  await page.locator("#p-phone").fill("6615550100");
  await page.locator("#p-co").fill("Dana Funding LLC");
  await page.locator("#p-track").selectOption(track);
  await page.locator("#p-aud").fill("I speak to small business owners.");
  await page.locator("#p-sms").check();
  await page.locator('#pform button[type="submit"]').click();
  await expect(page.locator("#success")).toBeVisible();
  return () => submitted;
}

test.describe("white-label application success screen", () => {
  test("says an application was received, not that a login is ready", async ({ page }) => {
    await apply(page, { track: "white_label", response: WHITE_LABEL_RESPONSE });

    await expect(page.locator("#success-chk")).toHaveText(/APPLICATION RECEIVED/);
    await expect(page.locator("#success-title")).toHaveText(/application is in/i);
    await expect(page.locator("#success")).not.toContainText(/login is ready/i);
    await expect(page.locator("#success")).toContainText(/review call/i);
  });

  test("shows no password box and no link to a login that does not exist", async ({ page }) => {
    await apply(page, { track: "white_label", response: WHITE_LABEL_RESPONSE });

    await expect(page.locator("#success-cred")).toBeHidden();
    await expect(page.locator("#success-login")).toBeHidden();
    await expect(page.locator("#success")).not.toContainText(/first password/i);
    await expect(page.locator("#success")).not.toContainText(/log in now/i);
  });

  test("shows the review-call steps, addressed to the email they typed", async ({ page }) => {
    await apply(page, { track: "white_label", response: WHITE_LABEL_RESPONSE });

    await expect(page.locator("#success-next")).toBeVisible();
    await expect(page.locator("#success-next-email")).toHaveText("dana@example.test");
    await expect(page.locator("#success-next")).toContainText(/partner agreement/i);
  });

  test("makes no claim about money, and names no date", async ({ page }) => {
    await apply(page, { track: "white_label", response: WHITE_LABEL_RESPONSE });

    const copy = await page.locator("#success").innerText();
    expect(copy).not.toMatch(/\$|\bearn\b|\bcommission\b|\brevenue\b/i);
    expect(copy).not.toMatch(/\b(24|48|72)\s*hours?\b|\bwithin \d|\bsame day\b/i);
  });

  test("sends the applicant's own consent tick to the endpoint", async ({ page }) => {
    const submitted = await apply(page, {
      track: "white_label",
      response: WHITE_LABEL_RESPONSE
    });
    expect(submitted()).toMatchObject({
      email: "dana@example.test",
      phone: "6615550100",
      track: "white_label",
      sms_consent: true
    });
  });
});

test.describe("affiliate success screen is unchanged", () => {
  test("still hands over the first password and the referral link", async ({ page }) => {
    await apply(page, { track: "affiliate", response: AFFILIATE_RESPONSE });

    await expect(page.locator("#success-cred")).toBeVisible();
    await expect(page.locator("#success-pass")).toHaveText("s3cret-first-password");
    await expect(page.locator("#success-link"))
      .toHaveAttribute("href", "https://fundhub.ai/start?ref=TRK123");
    await expect(page.locator("#success-next")).toBeHidden();
  });

  test("an affiliate who already had a login sees a sentence, not an empty box", async ({ page }) => {
    await apply(page, {
      track: "affiliate",
      response: { ...AFFILIATE_RESPONSE, password: null }
    });
    await expect(page.locator("#success-pass")).toContainText(/already use/i);
  });
});
