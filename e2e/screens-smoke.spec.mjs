// Every CRM screen under public/app loads without throwing.
//
// NO BACKEND. Follows e2e/messaging-inbox.spec.mjs via harness.mjs.

import { test, expect } from "@playwright/test";
import { openScreen, OWNER, CLOSER, CLIENT_ID } from "./harness.mjs";

const SCREENS = [
  "/app/index.html",
  "/app/pipeline.html",
  "/app/calendar.html",
  "/app/messaging.html",
  "/app/documents.html",
  "/app/contracts.html",
  "/app/client-control-panel.html",
  "/app/closer-dashboard.html",
  "/app/sales-floor.html",
  "/app/my-numbers.html",
  "/app/closer-call.html",
  "/app/inquiry-remover.html",
  "/app/lenders.html",
  "/app/finance-os.html",
  "/app/products-commissions.html",
  "/app/staff-teams.html",
  "/app/ops-admin.html",
  "/app/agent-editor.html",
  "/app/template-editor.html",
  "/app/automations.html",
  "/app/journeys.html",
  "/app/campaign-manager.html",
  "/app/creative-factory.html",
  "/app/social-studio.html",
  "/app/hiring.html",
  "/app/brand-studio.html",
  "/app/galaxy.html",
  "/app/partner-galaxy.html",
  "/app/affiliate.html",
  "/app/consent-capture.html",
  "/app/client-portal.html"
];

for (const path of SCREENS) {
  test(`${path} loads without a JavaScript error`, async ({ page }) => {
    const session = path.includes("partner") ? {
      ok: true,
      staff: {
        id: "staff-p", name: "Pat Partner", email: "pat@partner.test",
        role: "partner", org_id: "org-1", status: "active", partner_id: "pppppppp-1111-4111-8111-111111111111"
      }
    } : OWNER;
    await openScreen(page, path.includes("client-control")
      ? `${path}?id=${CLIENT_ID}`
      : path.includes("finance-os")
        ? `${path}?client_id=${CLIENT_ID}`
        : path,
    session);
    await expect(page.locator("body")).toBeVisible();
  });
}

test("ops admin shows honest empty KPIs, not sample dollars", async ({ page }) => {
  await openScreen(page, "/app/ops-admin.html", OWNER);
  const kpis = page.locator(".kpi-value");
  const n = await kpis.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const text = (await kpis.nth(i).textContent()) || "";
    expect(text).not.toMatch(/\$198/);
    expect(text).not.toMatch(/\$29,224/);
  }
});

test("ops admin money KPIs are dashes, not invented cash", async ({ page }) => {
  await openScreen(page, "/app/ops-admin.html", OWNER);
  const cash = page.locator('[data-kpi="cash"]');
  if (await cash.count()) {
    await expect(cash.first()).toHaveText("—");
  }
  await expect(page.locator("body")).not.toContainText("$198,400");
});

test("closer can open the pipeline board", async ({ page }) => {
  await openScreen(page, "/app/pipeline.html", CLOSER);
  await expect(page.locator(".board, #board, .board-wrap").first()).toBeVisible();
});
