// Client portal — go-live UX gates (funding suppress, pay honesty, state toggle, included tile).
import { test, expect } from "@playwright/test";
import { CLIENT_ID, json } from "./harness.mjs";

const CLIENT_SESSION = {
  ok: true,
  staff: {
    id: CLIENT_ID,
    name: "Dana Whitfield",
    email: "dana@example.com",
    role: "client",
    org_id: "org-1",
    status: "active"
  }
};

const OWNER_SESSION = {
  ok: true,
  staff: {
    id: "staff-1",
    name: "Jordan Blake",
    email: "jordan@fundhub.ai",
    role: "owner",
    org_id: "org-1",
    status: "active"
  }
};

async function openPortal(page, session, entitlements) {
  await page.addInitScript((s) => {
    localStorage.setItem("fh_token", "e2e-token");
    localStorage.setItem("fh_role", (s.staff && s.staff.role) || "owner");
    localStorage.removeItem("fh_demo");
  }, session);

  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/api/auth/session") || /\/api\/session\b/.test(url)) {
      return json(route, session);
    }
    if (url.includes("entitlement")) {
      return json(route, { ok: true, items: entitlements });
    }
    return json(route, { ok: true, items: [] });
  });

  await page.goto(`/app/client-portal.html?id=${CLIENT_ID}`);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(600);
}

test.describe("client portal go-live UX", () => {
  test("letter-only client does not see funding approval or Card Stacking DFY", async ({ page }) => {
    await openPortal(page, CLIENT_SESSION, [
      { entitlement_code: "metro2-letter-pack", active: true }
    ]);

    await expect(page.locator("body")).toHaveClass(/no-funding/);
    await expect(page.locator(".prog-card")).toBeHidden();
    await expect(page.locator(".video-card")).toBeHidden();
    await expect(page.locator("#greeting-sub")).toBeHidden();
    await expect(page.locator(".promo")).toBeHidden();
    await expect(page.locator(".statesw")).toBeHidden();
    // Amount stays in the DOM (hidden) for the funding sample; it must not be visible.
    await expect(page.locator(".prog-card .sb-main")).toBeHidden();
  });

  test("funding client still sees funding progress", async ({ page }) => {
    await openPortal(page, CLIENT_SESSION, [
      { entitlement_code: "funding-snapshot", active: true }
    ]);

    await expect(page.locator("body")).not.toHaveClass(/no-funding/);
    await expect(page.locator(".prog-card")).toBeVisible();
    await expect(page.locator(".video-card")).toBeVisible();
  });

  test("staff can see the designer STATE toggle", async ({ page }) => {
    await openPortal(page, OWNER_SESSION, [
      { entitlement_code: "funding-snapshot", active: true }
    ]);
    await expect(page.locator("body")).toHaveClass(/portal-staff/);
    await expect(page.locator(".statesw")).toBeVisible();
  });

  test("included letter pack shows View status, not Unlock", async ({ page }) => {
    await openPortal(page, CLIENT_SESSION, [
      { entitlement_code: "metro2-letter-pack", active: true }
    ]);

    const tile = page.locator('[data-tile="metro2"]');
    await expect(tile.locator(".lockrow")).toHaveText(/Included/i);
    await expect(tile.locator("[data-status='metro2']")).toHaveText(/View status/i);
    await expect(tile.locator("[data-unlock]")).toHaveCount(0);

    await tile.locator("[data-status='metro2']").click();
    await expect(page.locator("#unlock-modal")).toHaveClass(/on/);
    await expect(page.locator("#um-price")).toHaveText(/Included/i);
    await expect(page.locator("#um-go")).toHaveText(/Close/i);
  });

  test("pay modal never hangs on a fake checkout spinner", async ({ page }) => {
    await openPortal(page, CLIENT_SESSION, []);

    await page.locator('[data-tile="consulting"] [data-unlock="consulting"]').click();
    await expect(page.locator("#unlock-modal")).toHaveClass(/on/);
    await page.locator("#um-go").click();
    await expect(page.locator("#um-go")).toHaveText(/Checkout not available/i);
    await expect(page.locator("#um-pay-msg")).toContainText(/not available yet/i);
    await expect(page.locator("#um-talk")).toBeVisible();
  });
});
