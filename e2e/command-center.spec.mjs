// Command Center — KPIs and rails show honest empty states, not invented numbers.

import { test, expect } from "@playwright/test";
import { AGENT_ROW, OWNER, wireApi, gotoScreen } from "./harness.mjs";

test.describe("Command Center empty states", () => {

  test.beforeEach(async ({ page }) => {
    await wireApi(page, { session: OWNER });
    await gotoScreen(page, "command-center.html");
  });

  test("KPI tiles show em dash, not fake dollar amounts", async ({ page }) => {
    const values = page.locator(".kpi-value");
    const count = await values.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      await expect(values.nth(i)).toHaveText("—");
    }
    await expect(page.locator(".kpi-grid")).not.toContainText("$198");
    await expect(page.locator(".kpi-grid")).not.toContainText("198k");
  });

  test("holds strip shows empty state message", async ({ page }) => {
    await expect(page.locator("#holdsEmpty")).toBeVisible();
    await expect(page.locator("#holdsEmpty")).toContainText(/hold/i);
    await expect(page.locator(".hold-card")).toHaveCount(0);
  });

  test("pipeline rail counts and dollars are em dash", async ({ page }) => {
    const counts = page.locator(".stage-count");
    const n = await counts.count();
    for (let i = 0; i < n; i++) {
      await expect(counts.nth(i)).toHaveText("—");
    }
    const dollars = page.locator(".stage-dollar");
    const d = await dollars.count();
    for (let i = 0; i < d; i++) {
      await expect(dollars.nth(i)).toHaveText("—");
    }
  });

  test("live feed shows empty state, not invented rows", async ({ page }) => {
    await expect(page.locator(".feed .feed-item")).toContainText("No live feed yet");
    await expect(page.locator(".feed")).not.toContainText("$198");
  });

  test("agent badges update from /api/read/agents", async ({ page }) => {
    await wireApi(page, {
      session: OWNER,
      handlers: {
        "/api/read/agents": () => ({
          ok: true, count: 1, limit: 200, offset: 0, hasMore: false,
          items: [{ code: "AG-04", name: "Setter Josh", status: "live",
            agent_class: "client_facing", channel: "voice",
            prompt_missing: true, guardrails_missing: true }]
        })
      }
    });
    await gotoScreen(page, "command-center.html");
    await page.waitForTimeout(600);
    const card = page.locator(".agent-code").filter({ hasText: "AG-04" }).locator("..").locator("..");
    await expect(card.locator(".status-badge")).toContainText("Active", { timeout: 10_000 });
  });
});
