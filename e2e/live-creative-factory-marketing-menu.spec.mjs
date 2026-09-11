// Live proof that the Marketing menu is reachable and Creative Factory loads clean.
//
// Runs against the DEPLOYED site (npm run test:e2e:live), never localhost — a local
// `netlify dev` needs a migrated database and this branch's schema change
// (`copy_text` on `creative_assets`) has not been applied anywhere in production yet.
//
// SCOPE, ON PURPOSE. This proves two things only:
//   1. The Marketing section (Campaigns / Social Studio / Creative Factory / Content)
//      is not hidden from an owner/admin login, and Creative Factory is in it.
//   2. Clicking into Creative Factory renders the screen with no thrown JS error.
//
// It does NOT touch the Generate form's offer-type dropdown or assert on real
// copy_text words in the library. Both of those depend on this branch's migration,
// which has not run in production (this branch has not merged) — a live click-through
// of either would fail for a reason that is not a bug. Do not extend this test to
// cover those until the migration has run in production.

import { test, expect } from "@playwright/test";
import { BASE, liveStaffLogin } from "./live-auth.mjs";

const OWNER = "owner@fundhub.ai";

// Same convention as messaging-inbox.spec.mjs: a blocked font/CDN fetch under the
// build container's egress policy is not a page bug and must not fail this check.
const EXTERNAL_RESOURCE = /Failed to load resource/i;

test.describe("Creative Factory reachable from the Marketing menu (live)", () => {
  test("owner sees Marketing > Creative Factory, and the screen loads with no JS error", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + String(e)));
    page.on("console", (m) => {
      if (m.type() === "error" && !EXTERNAL_RESOURCE.test(m.text())) errors.push(m.text());
    });

    await liveStaffLogin(page, OWNER);
    // The post-login redirect can still be in flight when this explicit goto
    // fires, which Chromium reports as ERR_ABORTED on our own navigation —
    // not a page bug, just two navigations racing. One retry clears it.
    try {
      await page.goto(`${BASE}/app/pipeline.html`, { waitUntil: "domcontentloaded" });
    } catch (e) {
      if (!/ERR_ABORTED/.test(String(e))) throw e;
      await page.goto(`${BASE}/app/pipeline.html`, { waitUntil: "domcontentloaded" });
    }

    // --- 1. the Marketing section exists and holds a Creative Factory row -----
    const marketingGroup = page.locator('.navgroup[data-fh-section="marketing"]');
    await expect(marketingGroup, "Marketing section should be in the sidebar").toBeVisible();
    await expect(marketingGroup.locator(".navhead"), "section heading should read Marketing")
      .toContainText("Marketing");

    const cfLink = marketingGroup.locator('a.navitem[href="creative-factory.html"]');
    await expect(cfLink, "Creative Factory row should exist under Marketing").toHaveCount(1);
    await expect(cfLink).toContainText("Creative Factory");

    // Nav groups other than the active one ship closed (shell.js setGroupDefault) —
    // .navgroup.closed .navlist{display:none} — so the row exists but is not yet
    // visible until the Marketing heading is clicked open, same as a real user would.
    if (!(await cfLink.isVisible())) {
      await marketingGroup.locator(".navhead").click();
    }
    await expect(cfLink, "Creative Factory row should be visible once Marketing is open").toBeVisible();

    // --- 2. clicking in loads the real screen with no console/page error -------
    await cfLink.click();
    await page.waitForURL(/creative-factory\.html/, { timeout: 30_000 });
    await expect(page.locator("h1"), "Creative Factory heading should render").toHaveText("Creative Factory");

    expect(errors, "Creative Factory must load with no thrown JS error").toEqual([]);
  });
});
