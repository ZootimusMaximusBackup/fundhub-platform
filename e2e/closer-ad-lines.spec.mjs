// THE FOUR AD LINES ON THE CALL SCREEN, IN A REAL BROWSER.
//
// gate / entry / primary / secondary, under the client's name, filled from
// GET /api/read/ad-attribution. Three states that matter and cannot be proved
// by reading files:
//
//   * a DIRECT ad says "sell what they were promised" and lists no extra roads;
//   * a SORTING ad with a primary says "lead with it" and opens every road;
//   * a read that fails leaves the block HIDDEN — the closer never sees a guess.
//
// No backend. page.route() answers every /api/** call, as
// e2e/closer-call-rhythm.spec.mjs does.

import { test, expect } from "@playwright/test";
import { CLIENT_ID, CLOSER, openScreen, freezeClock } from "./harness.mjs";

const NOW = "2026-09-03T16:40:00.000Z";
const DUE = "2026-09-03T17:00:00.000Z";

function cockpit() {
  return {
    ok: true,
    staff: { id: "staff-2", name: "Casey Reed", shift: { on_shift: true, elapsed_ms: 3_600_000 } },
    kpis: {
      cash_today_cents: { cents: 0, display: "$0", deposits: 0 },
      cash_month_cents: 0, deposits: 0, calls_held: 0, no_shows: 0,
      close_rate: null, unlogged: 0, commission_mtd: null, commission_reason: "n/a"
    },
    client: {
      id: CLIENT_ID, name: "Dana Whitfield", business_name: "Whitfield Freight",
      age_months: 26, tags: [], funded: false,
      pipeline: { stage_key: "closing", stage_name: "Closing" }
    },
    credit: { available: false, reason: "No crs_results row for this client yet" },
    underwrite: {
      matched_lenders: 0, lenders: [], applications: [], lenders_reason: "empty",
      lite_banner_funding: null,
      totals: { total_personal_funding: 0, total_business_funding: 0, total_combined_funding: 0 }
    },
    deal: { latest_payment: null, success_fee_percent: 0.10, success_fee_source: "default", success_fee_note: "" },
    precall: { conversation_count: 0, summary: "No conversation summary on file yet." },
    current_call: { due_at: DUE, task_id: "task-1", title: "Closing call" },
    next_call: null,
    up_next: [{ task_id: "task-1", client_id: CLIENT_ID, due_at: DUE, title: "Closing call", name: "Dana Whitfield" }],
    offers: [],
    gone_quiet: { unlogged: [], quiet_deposits: [] }
  };
}

function attribution(resolved, over = {}) {
  return {
    ok: true,
    client_id: CLIENT_ID,
    attribution: { lane: "funding600", ad_id: "42", variant: "sun", utm_campaign: "funding600", utm_content: "42-ringlights" },
    registry: { known: true, id: "42" },
    resolved,
    ...over
  };
}

function handlers(over = {}) {
  return {
    "/api/read/closer-now": { ok: true, current: null, next: null },
    "/api/read/closer-call": cockpit(),
    "/api/read/tradelines": { ok: true, data: [], client_id: CLIENT_ID },
    "/api/read/lender-matches": { ok: true, matches: [] },
    "/api/read/deal-math": { ok: true },
    "/api/read/agent-context": { ok: true, context: {} },
    ...over
  };
}

const url = `/app/closer-dashboard.html?client_id=${CLIENT_ID}`;

test("a direct ad: gate, entry, primary and secondary read as four plain lines under the name", async ({ page }) => {
  await freezeClock(page, NOW);
  await openScreen(page, url, CLOSER, handlers({
    "/api/read/ad-attribution": attribution({
      gate: "600", entry: "direct", primary_offer: "funding_dfy", secondary_offers: [], title: "ringlights", variant: "sun"
    })
  }));

  await expect(page.locator("#ccp-who-name")).toHaveText("Dana Whitfield");
  const box = page.locator("#ccp-ad");
  await expect(box).toBeVisible();
  await expect(page.locator("#ccp-ad-gate")).toHaveText("600+");
  await expect(page.locator("#ccp-ad-entry")).toContainText("Direct");
  await expect(page.locator("#ccp-ad-entry")).toContainText("sell what they were promised");
  await expect(page.locator("#ccp-ad-primary")).toHaveText("Funding, done-for-you");
  await expect(page.locator("#ccp-ad-secondary")).toHaveText("None");

  // The block sits under the client's name, not somewhere else on the page.
  const nameBox = await page.locator("#ccp-who-name").boundingBox();
  const adBox = await box.boundingBox();
  expect(adBox.y).toBeGreaterThan(nameBox.y);

  // The label is a word, never a colour (UI-STANDARDS 12.6), and the size
  // actually painted is the caption size (12.7) — assert the computed style,
  // not the class.
  const size = await box.evaluate((el) => getComputedStyle(el).fontSize);
  const body = await page.locator("#ccp-who-meta").evaluate((el) => getComputedStyle(el).fontSize);
  expect(parseFloat(size)).toBeLessThan(parseFloat(body) + 0.01);
});

test("a sorting ad with a primary: lead with it, every road open", async ({ page }) => {
  await freezeClock(page, NOW);
  await openScreen(page, url, CLOSER, handlers({
    "/api/read/ad-attribution": attribution({
      gate: "none", entry: "sorting", primary_offer: "funding_dfy", secondary_offers: "all", title: null, variant: "sun"
    }, { attribution: { lane: "sorting", ad_id: "43", variant: "sun" }, registry: { known: true, id: "43" } })
  }));

  await expect(page.locator("#ccp-ad")).toBeVisible();
  await expect(page.locator("#ccp-ad-gate")).toHaveText("No FICO gate");
  await expect(page.locator("#ccp-ad-entry")).toContainText("Sorting");
  await expect(page.locator("#ccp-ad-entry")).toContainText("every road is open");
  await expect(page.locator("#ccp-ad-primary")).toContainText("Funding, done-for-you");
  await expect(page.locator("#ccp-ad-primary")).toContainText("lead with it");
  await expect(page.locator("#ccp-ad-secondary")).toHaveText("All");
});

test("an unknown ad says so in words, and a failed read leaves the block hidden", async ({ page }) => {
  await freezeClock(page, NOW);
  await openScreen(page, url, CLOSER, handlers({
    "/api/read/ad-attribution": attribution({
      gate: "none", entry: "sorting", primary_offer: "none", secondary_offers: "all", title: null, variant: null
    }, { attribution: { lane: "sorting", ad_id: "999", variant: null }, registry: { known: false, id: "999" } })
  }));
  await expect(page.locator("#ccp-ad")).toBeVisible();
  await expect(page.locator("#ccp-ad-entry")).toContainText("ad 999 not in the registry");
  await expect(page.locator("#ccp-ad-primary")).toHaveText("None");

  await openScreen(page, url, CLOSER, handlers({
    "/api/read/ad-attribution": { ok: false, error: "db_down" }
  }));
  await expect(page.locator("#ccp-who-name")).toHaveText("Dana Whitfield");
  await page.waitForTimeout(300);
  await expect(page.locator("#ccp-ad")).toBeHidden();
});
