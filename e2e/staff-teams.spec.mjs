// Staff & Teams — clock and consent stats show em dash when data is null.

import { test, expect } from "@playwright/test";
import { OWNER, STAFF_ROW, wireApi, gotoScreen } from "./harness.mjs";

test.describe("Staff & Teams empty stats", () => {

  test("ON SHIFT and CONSENT stats show em dash from live roster", async ({ page }) => {
    await wireApi(page, {
      session: OWNER,
      handlers: {
        "/api/read/staff": () => ({
          ok: true, count: 1, limit: 200, offset: 0, hasMore: false,
          items: [STAFF_ROW]
        })
      }
    });
    await gotoScreen(page, "staff-teams.html");
    await expect(page.locator("#kShift")).toHaveText("—", { timeout: 10_000 });
    await expect(page.locator("#kConsent")).toHaveText("—");
    await expect(page.locator("#onShiftTxt")).toContainText("— on shift");
  });

  test("roster table renders staff from API", async ({ page }) => {
    await wireApi(page, {
      session: OWNER,
      handlers: {
        "/api/read/staff": () => ({
          ok: true, count: 1, limit: 200, offset: 0, hasMore: false,
          items: [STAFF_ROW]
        })
      }
    });
    await gotoScreen(page, "staff-teams.html");
    await expect(page.locator("#rosterBody")).toContainText("Jordan Blake", { timeout: 10_000 });
  });

  test("consent and clock columns show em dash badges", async ({ page }) => {
    await wireApi(page, {
      session: OWNER,
      handlers: {
        "/api/read/staff": () => ({
          ok: true, count: 1, limit: 200, offset: 0, hasMore: false,
          items: [STAFF_ROW]
        })
      }
    });
    await gotoScreen(page, "staff-teams.html");
    await expect(page.locator("#rosterBody .badge.b-gray").first()).toHaveText("—");
  });

  test("permission matrix tab switches", async ({ page }) => {
    await wireApi(page, { session: OWNER });
    await gotoScreen(page, "staff-teams.html");
    await page.locator('.tab[data-tab="perms"]').click();
    await expect(page.locator("#tab-perms")).toBeVisible();
    await expect(page.locator("#permCount")).toBeVisible();
  });

  test("telemetry tab is present", async ({ page }) => {
    await wireApi(page, {
      session: OWNER,
      handlers: {
        "/api/read/staff": () => ({
          ok: true, count: 1, limit: 200, offset: 0, hasMore: false,
          items: [STAFF_ROW]
        })
      }
    });
    await gotoScreen(page, "staff-teams.html");
    await page.locator('.tab[data-tab="telemetry"]').click();
    await expect(page.locator("#tab-telemetry")).toBeVisible();
    await expect(page.locator("#teleEmpty")).toBeVisible();
  });
});
