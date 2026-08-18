/* INVERTED GUARD — was "Demo Mode ON shows a banner", now "no banner, ever".
 *
 * The Demo Mode UI was removed on 2026-08-17 (owner decision): the screen
 * public/app/sample-data.html, its nav row, the ops-admin toggle panel, and
 * shell.js mountDemoBanner all went. The endpoint GET/POST/DELETE
 * /api/demo/mode deliberately STAYED — public/app/hiring.html,
 * public/app/demo-client-bootstrap.js and the server-side is_demo filters all
 * still depend on it.
 *
 * These tests were not deleted. They were flipped, the same way the
 * sales_manager guards were flipped for db/migrations/112 (see
 * docs/journeys/CHANGELOG.md, 2026-08-01). The old version failed if the banner
 * was missing; this one fails if the banner comes back. Either way a silent
 * regression is caught.
 *
 * If a future change re-introduces a Demo Mode banner on purpose, flip these
 * back — do not delete them.
 */
import { test, expect } from "@playwright/test";
import { openScreen, OWNER, PIPELINE_STAGES } from "./harness.mjs";

const DEMO_ON = { ok: true, demo_mode_enabled: true, counts: { clients: 12, lenders: 7, call_outcomes: 40, sales: 6 }, domain: "demo.fundhub.local" };
const DEMO_OFF = { ok: true, demo_mode_enabled: false, counts: { clients: 0, lenders: 0, call_outcomes: 0, sales: 0 }, domain: "demo.fundhub.local" };

/* sample-data.html is gone — the seven surviving screens from the original list. */
const SCREENS = [
  "/app/command-center.html",
  "/app/pipeline.html",
  "/app/closer-dashboard.html",
  "/app/sales-floor.html",
  "/app/my-numbers.html",
  "/app/lenders.html",
  "/app/contracts.html"
];

test.describe("Demo Mode banner is gone", () => {
  for (const pathName of SCREENS) {
    test(`${pathName} shows no demo banner even when the toggle reads ON`, async ({ page }) => {
      await openScreen(page, pathName, OWNER, { "/api/demo/mode": DEMO_ON });
      await expect(page.locator("[data-fh-demo-banner]")).toHaveCount(0);
      await expect(page.locator("#fh-demo-banner")).toHaveCount(0);
    });
  }
});

test("Demo Mode OFF also shows no banner", async ({ page }) => {
  await openScreen(page, "/app/pipeline.html", OWNER, {
    "/api/demo/mode": DEMO_OFF,
    "/api/dashboard/pipeline": { ok: true, pipeline: "sales", total: 0, stages: PIPELINE_STAGES.map((s) => ({ ...s, cards: [], count: 0, amount: 0 })) }
  });
  await expect(page.locator("[data-fh-demo-banner]")).toHaveCount(0);
});

test("the Demo Mode nav row is gone from the rail", async ({ page }) => {
  await openScreen(page, "/app/command-center.html", OWNER);
  await expect(page.locator('a.navitem[href="sample-data.html"]')).toHaveCount(0);
});
