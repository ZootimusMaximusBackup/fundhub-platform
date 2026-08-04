// Playwright coverage for Lenders (incl. AI bureau tab) and inquiry case queue.

import { test, expect } from "@playwright/test";
import { openScreen, OWNER, CLOSER } from "./harness.mjs";

test("lenders.html loads with list, mismatch, and AI bureau tabs", async ({ page }) => {
  await openScreen(page, "/app/lenders.html", OWNER);
  await expect(page.locator("body")).toBeVisible();
  await expect(page.getByRole("button", { name: /Lender list/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Bureau mismatch queue/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /AI bureau config/i })).toBeVisible();
  await expect(page.locator("#emptyBanner")).toContainText(/empty on purpose/i);

  await page.getByRole("button", { name: /AI bureau config/i }).click();
  await expect(page.locator("#tab-bureau")).toBeVisible();
  await expect(page.locator("#bureauEmpty")).toContainText(/No bureau config/i);
});

test("inquiry-remover.html shows case queue section", async ({ page }) => {
  await openScreen(page, "/app/inquiry-remover.html", OWNER);
  await expect(page.locator("#caseQueueSection")).toBeVisible();
  await expect(page.locator("#caseQueueTable")).toBeVisible();
  await expect(page.getByText(/Inquiry removal cases/i)).toBeVisible();
});

test("closer-dashboard shows lender matches tile", async ({ page }) => {
  await openScreen(page, "/app/closer-dashboard.html", CLOSER);
  await expect(page.locator("#oLenderMatches")).toBeVisible();
  await expect(page.getByText(/Lender matches/i)).toBeVisible();
});
