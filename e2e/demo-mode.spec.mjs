import { test, expect } from "@playwright/test";
import { openScreen, OWNER, PIPELINE_STAGES } from "./harness.mjs";
const DEMO_ON = { ok: true, demo_mode_enabled: true, counts: { clients: 12, lenders: 7, call_outcomes: 40, sales: 6 }, domain: "demo.fundhub.local" };
const DEMO_OFF = { ok: true, demo_mode_enabled: false, counts: { clients: 0, lenders: 0, call_outcomes: 0, sales: 0 }, domain: "demo.fundhub.local" };
const SCREENS = ["/app/command-center.html","/app/pipeline.html","/app/closer-dashboard.html","/app/sales-floor.html","/app/my-numbers.html","/app/lenders.html","/app/contracts.html","/app/sample-data.html"];
test.describe("Demo Mode ON", () => {
  for (const pathName of SCREENS) {
    test(`${pathName} shows banner`, async ({ page }) => {
      await openScreen(page, pathName, OWNER, { "/api/demo/mode": DEMO_ON });
      await expect(page.locator("[data-fh-demo-banner]")).toBeVisible({ timeout: 5000 });
    });
  }
});
test("Demo Mode OFF hides banner", async ({ page }) => {
  await openScreen(page, "/app/pipeline.html", OWNER, {
    "/api/demo/mode": DEMO_OFF,
    "/api/dashboard/pipeline": { ok: true, pipeline: "sales", total: 0, stages: PIPELINE_STAGES.map((s) => ({ ...s, cards: [], count: 0, amount: 0 })) }
  });
  await expect(page.locator("[data-fh-demo-banner]")).toHaveCount(0);
});
