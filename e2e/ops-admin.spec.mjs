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
    await expect(page.locator("#ar-table")).toContainText(/No unpaid invoices/i);
    await expect(page.locator("#ar-table")).not.toContainText("Devon Marsh");
  });

  test("affiliate summary line shows em dash counts", async ({ page }) => {
    await expect(page.locator(".af-n")).toContainText("— referrals");
    await expect(page.locator(".af-n")).toContainText("— paid out");
  });

  test("staff comp This Week column shows em dash", async ({ page }) => {
    await page.locator('.zonetab[data-zone="people"]').click();
    const weekCells = page.locator("#staff-comp-body tr td.mono");
    await expect(weekCells.first()).toHaveText("—", { timeout: 10_000 });
    const n = await weekCells.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) {
      await expect(weekCells.nth(i)).toHaveText("—");
    }
    await expect(page.locator("#zone-people")).not.toContainText("Nina Castellano");
    await expect(page.locator("#zone-people")).not.toContainText("Marcus Webb");
  });

  test("today briefs start loading then stay honest", async ({ page }) => {
    await expect(page.locator("#ops-pulse")).toBeVisible();
    await expect(page.locator("#ops-pulse")).not.toContainText("under 20 deposits");
    await expect(page.locator("#ops-pulse")).not.toContainText("suspend");
    await expect(page.locator("#ops-pulse-act")).toBeHidden();
  });

  test("today briefs paint gaps spend and no fire rule", async ({ page }) => {
    await page.unroute("**/api/**");
    await wireApi(page, {
      session: OWNER,
      handlers: {
        "/api/read/ops-pulse": {
          ok: true,
          briefs: {
            ceo: "What needs doing today?\nCloser deposits this month 4 are under the starting bar of 20.\nFire: no fire rule yet.\nRaise: no raise rule yet.\nBonus: no bonus rule yet.",
            owner: "What will be done.\nNo fire rule yet, so no fire task will be created.\nNo raise rule yet. No bonus rule yet."
          },
          hire: {
            recommend: true,
            existing_task_id: null,
            linkedin: { status: "not_configured" },
            profile: { seat: "closer", lines: ["Seat: closer.", "Do not hire a setter."] }
          },
          pulse: {
            calendar: { packed: true, source: "MODEL" },
            gaps: { has_short: true, notes: ["Closer deposits this month 4 are under the starting bar of 20."] },
            ads: { status: "not_configured", spend_cents: null }
          }
        }
      }
    });
    await page.reload();
    await expect(page.locator("#ops-pulse-ceo")).toContainText("starting bar of 20");
    await expect(page.locator("#ops-pulse-hire")).toContainText("LinkedIn: not_configured");
    await expect(page.locator("#ops-pulse-ads")).toContainText("not_configured");
    await expect(page.locator("#ops-pulse-fire")).toContainText("no fire rule yet");
    await expect(page.locator("#ops-pulse-fire")).toContainText("no raise rule yet");
    await expect(page.locator("#ops-pulse")).not.toContainText("under 20 deposits");
    await expect(page.locator("#ops-pulse")).not.toContainText("suspend");
    await expect(page.locator("#ops-pulse-act")).toBeVisible();
  });

  test("People zone tab switches", async ({ page }) => {
    await page.locator('.zonetab[data-zone="people"]').click();
    await expect(page.locator("#zone-people")).toBeVisible();
    await expect(page.locator("#zone-people")).not.toHaveAttribute("hidden", "");
  });
});
