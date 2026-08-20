// Live white-label path — against https://fundhub.ai only (not the local harness).
// Fake identity: e2e+wl-*@. Seeded partner login: partner@fundhub.ai (invite-only
// today; the website form does not create an account). Credentials from env.

import { test, expect } from "@playwright/test";
import { BASE, staffPassword } from "./live-auth.mjs";

function req(testInfo, id) {
  testInfo.annotations.push({ type: "req", description: id });
}

async function openPartnerSuite(page, request) {
  const res = await request.post(`${BASE}/api/auth/login`, {
    data: { email: "partner@fundhub.ai", password: staffPassword() }
  });
  expect(res.status(), "partner login must not be locked").toBe(200);
  const body = await res.json();
  expect(body.ok).toBeTruthy();
  expect(body.principal).toBe("partner");
  expect(body.token).toBeTruthy();
  const partnerId = body.account && (body.account.partnerId || body.account.partner_id);
  expect(partnerId).toMatch(/^[0-9a-f-]{36}$/i);
  await page.goto(`${BASE}/login.html`, { waitUntil: "domcontentloaded" });
  await assertSiteUp(page);
  await page.evaluate(({ token }) => {
    localStorage.setItem("fh_token", token);
    localStorage.setItem("fh_role", "partner");
  }, { token: body.token });
  await page.goto(`${BASE}/app/partner-galaxy.html`, { waitUntil: "domcontentloaded" });
  await assertSiteUp(page);
  return partnerId;
}

async function assertSiteUp(page) {
  const text = await page.locator("body").innerText();
  expect(text, "live site must not be paused").not.toMatch(/Site not available|usage limits/i);
}

test.describe("live white-label website entry", () => {
  test("wl:website_entry affiliates door has white-label", async ({ page }) => {
    req(test.info(), "wl:website_entry");
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await assertSiteUp(page);
    const home = await page.locator("body").innerText();
    expect(home).toMatch(/Affiliates/i);
    const affLink = page.locator('a[href="/affiliates/"], a[href*="affiliates"]').first();
    await expect(affLink).toBeVisible();
    await affLink.click();
    await expect(page).toHaveURL(/\/affiliates\/?/, { timeout: 20_000 });
    const body = await page.locator("body").innerText();
    expect(body).toMatch(/white-?label/i);
    await expect(page.locator("#p-track")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('#p-track option[value="white_label"]')).toHaveCount(1);
  });

  test("wl:white_label_apply submits the live form without a production write", async ({ page, request }) => {
    req(test.info(), "wl:white_label_apply");
    const email = "e2e+wl-onboard@fundhub.ai";
    const methodGate = await request.get(`${BASE}/api/public/partner-apply`);
    expect(methodGate.status()).toBe(405);
    expect(methodGate.headers().allow).toBe("POST");

    let submitted = null;
    await page.route("**/api/public/partner-apply", async (route) => {
      submitted = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          email,
          kind: "partner",
          site_url: `${BASE}/sites/read-only`
        })
      });
    });
    await page.goto(`${BASE}/affiliates/`, { waitUntil: "domcontentloaded" });
    await assertSiteUp(page);
    await expect(page.locator("#pform")).toBeVisible({ timeout: 20_000 });
    await page.locator("#p-name").fill("E2E White Label");
    await page.locator("#p-email").fill(email);
    await page.locator("#p-phone").fill("5550100199");
    await page.locator("#p-co").fill("E2E WL Book LLC");
    await page.locator("#p-track").selectOption("white_label");
    await page.locator("#p-aud").fill("e2e fake book of clients");
    await page.locator("#p-sms").check();
    await page.locator('#pform button[type="submit"]').click();
    await expect(page.locator("#success")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("#success")).toContainText(/login/i);
    expect(submitted).toEqual({
      name: "E2E White Label",
      email,
      phone: "5550100199",
      company: "E2E WL Book LLC",
      track: "white_label",
      audience: "e2e fake book of clients",
      sms_consent: true
    });
  });
});

test.describe("live white-label own access and studio", () => {
  // One sign-in only. Each partner login first fails as staff, then succeeds
  // as an account — five of those in 15 minutes lock the email (429).
  test("wl:partner login, galaxy, own URL, funnel studio", async ({ page, request }) => {
    test.setTimeout(90_000);
    req(test.info(), "wl:partner_login");
    req(test.info(), "wl:partner_galaxy");
    req(test.info(), "wl:own_url");
    req(test.info(), "wl:funnel_studio");

    const partnerId = await openPartnerSuite(page, request);
    await expect(page).toHaveURL(/partner-galaxy/, { timeout: 20_000 });

    const galaxy = await page.locator("body").innerText();
    expect(galaxy).toMatch(/Your Galaxy|your book only/i);
    await expect(page.locator('aside a[href*="brand-studio.html"]')).toHaveCount(1);

    await page.goto(`${BASE}/app/brand-studio.html?partner_id=${encodeURIComponent(partnerId)}`, {
      waitUntil: "domcontentloaded"
    });
    await assertSiteUp(page);
    const studio = await page.locator("body").innerText();
    expect(studio).toMatch(/fundhub-partners\.com|\/sites\//i);
    await expect(page.locator("#createPagesBtn")).toBeVisible({ timeout: 15_000 });
    expect(studio).toMatch(/Application funnel|Create pages from selected funnels/i);
    expect(studio).toMatch(/Your domain/i);
  });
});

test.describe("live white-label public page", () => {
  test("wl:public_partner_page unpublished is not live", async ({ request }) => {
    req(test.info(), "wl:public_partner_page");
    const missing = await request.get(`${BASE}/api/public/partner-page`);
    expect(missing.status()).toBe(400);
    const missBody = await missing.json();
    expect(missBody.ok).toBeFalsy();
    expect(missBody.error).toBe("partner_id_and_slug_or_domain_required");

    const unknown = "00000000-0000-4000-8000-000000000000";
    const pub = await request.get(
      `${BASE}/api/public/partner-page?partner_id=${unknown}&slug=apply`
    );
    expect(pub.status()).toBe(404);
    const pubBody = await pub.json();
    expect(pubBody.ok).toBeFalsy();
    expect(pubBody.error).toBe("not_found");
  });
});
