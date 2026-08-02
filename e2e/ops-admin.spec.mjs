// Ops & Admin — money KPIs and tables show empty states, not sample dollars.

import { test, expect } from "@playwright/test";
import { OWNER, wireApi, gotoScreen } from "./harness.mjs";

test.describe("Ops & Admin honest empty states", () => {

  test.beforeEach(async ({ page }) => {
    await wireApi(page, { session: OWNER });
    await gotoScreen(page, "ops-admin.html");
  });

  test("money KPI tiles start at em dash", async ({ page }) => {
    await expect(page.locator("#kpi-grid [data-kpi=\"cash\"]").first()).toHaveText("—");
    await expect(page.locator("#kpi-grid")).not.toContainText("$198");
  });

  test("period picker keeps em dash values across periods", async ({ page }) => {
    await page.locator("#period-btn").click();
    await page.locator('.period-opt[data-id="30d"]').click();
    for (const k of ["cash", "funded", "close"]) {
      await expect(page.locator(`#kpi-grid [data-kpi="${k}"]`).first()).toHaveText("—");
    }
  });

  test("AR table shows empty note, not fake invoices", async ({ page }) => {
    await expect(page.locator("#zone-money .empty-note").first()).toContainText(/AR read endpoint/i);
  });

  test("affiliate summary line shows em dash counts", async ({ page }) => {
    await expect(page.locator(".af-n")).toContainText("— referrals");
    await expect(page.locator(".af-n")).toContainText("— paid out");
  });

  test("staff comp This Week column shows em dash", async ({ page }) => {
    const weekCells = page.locator("#zone-people table tbody tr td.mono");
    const n = await weekCells.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) {
      await expect(weekCells.nth(i)).toHaveText("—");
    }
  });

  test("People zone tab switches", async ({ page }) => {
    await page.locator('.zonetab[data-zone="people"]').click();
    await expect(page.locator("#zone-people")).toBeVisible();
    await expect(page.locator("#zone-people")).not.toHaveAttribute("hidden", "");
  });
});
