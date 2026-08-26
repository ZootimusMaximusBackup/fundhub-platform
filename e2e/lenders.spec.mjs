// Playwright — Lenders CRM screen (Funding group).
// NO BACKEND. Routes answered via harness; proves the screen paints and the
// maintenance controls exist.

import { test, expect } from "@playwright/test";
import { openScreen, OWNER } from "./harness.mjs";

const EMPTY_LENDERS = { ok: true, lenders: [], meta: { count: 0, empty: true } };
const EMPTY_OBS = { ok: true, observations: [], meta: { count: 0 } };

test("lenders.html loads and shows empty-state import guidance", async ({ page }) => {
  await openScreen(page, "/app/lenders.html", OWNER, {
    "/api/read/lenders": EMPTY_LENDERS,
    "/api/read/lender-observations": EMPTY_OBS
  });

  await expect(page.locator("body")).toBeVisible();
  await expect(page.locator("#emptyBanner")).toContainText("starts empty");
  await expect(page.locator("#btnImportToggle")).toBeVisible();
  await expect(page.locator("#btnExport")).toBeVisible();
  await expect(page.getByRole("button", { name: /Bureau mismatch queue/i })).toBeVisible();
});

test("lenders.html asks for 500 rows and paints the placeholder tile", async ({ page }) => {
  let seenLimit = "";
  await openScreen(page, "/app/lenders.html", OWNER, {
    "/api/read/lenders": function (_route, ctx) {
      seenLimit = new URL(ctx.url).searchParams.get("limit");
      return {
        ok: true,
        lenders: [{
          id: "aaaaaaaa-1111-4111-8111-111111111111",
          name: "Fixture Credit Union XYZ",
          lender_table: "OnlineBizCC",
          logo_path: null,
          bureaus_pulled: "EX",
          stated_requirements: "",
          priority_tier: 1,
          active: true,
          eligible_states: "",
          last_updated_by: "",
          last_updated_date: "",
          application_url: null
        }],
        meta: { count: 1, empty: false }
      };
    },
    "/api/read/lender-observations": EMPTY_OBS
  });

  const img = page.locator("img.lender-logo");
  await expect(img).toBeVisible();
  await expect(img).toHaveAttribute("src", "/assets/lenders/placeholder.svg");
  await expect(page.locator("#listMeta")).toContainText("1 lender");
  expect(seenLimit).toBe("500");
});

test("lenders.html can switch to mismatch review tab", async ({ page }) => {
  await openScreen(page, "/app/lenders.html", OWNER, {
    "/api/read/lenders": EMPTY_LENDERS,
    "/api/read/lender-observations": {
      ok: true,
      observations: [{
        id: "bbbbbbbb-1111-4111-8111-111111111111",
        lender_name: "(from import)",
        lender_table: "OnlineBizCC",
        expected_bureaus_raw: "EX",
        observed_bureau: "TU",
        observation_source: "manual",
        mismatch_flag: true,
        review_status: "pending",
        client_id: "aaaaaaaa-1111-4111-8111-111111111111",
        notes: null
      }],
      meta: { count: 1 }
    }
  });

  await page.getByRole("button", { name: /Bureau mismatch queue/i }).click();
  await expect(page.locator("#tab-review")).toBeVisible();
  await expect(page.locator("#reviewBody")).toContainText("TU");
});
