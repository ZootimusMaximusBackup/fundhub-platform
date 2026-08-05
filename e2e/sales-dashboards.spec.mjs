// Playwright: three sales dashboards + role gates.
import { test, expect } from "@playwright/test";
import { openScreen, OWNER, CLOSER, CLIENT_ID } from "./harness.mjs";

const SALES_MANAGER = {
  ok: true,
  staff: {
    id: "staff-sm", name: "Sarah Whitfield", email: "sarah@fundhub.ai",
    role: "sales_manager", org_id: "org-1", status: "active"
  }
};

const emptyMyNumbers = {
  ok: true,
  staff_id: "staff-2",
  shift: { on_shift: false, reason: "No open shift row" },
  pace: { cash_cents: 0, cash_display: "$0", target_cents: null, target_reason: "No monthly deposits target in staff_targets", rank: null, team_size: 0 },
  month: {
    deposits_closed: 0, close_rate: null, show_rate: null, downsells: 0,
    deposit_to_funded: null, deposit_to_funded_n: { deposits: 0, funded: 0, rate: null },
    avg_funded_cents: null, avg_funded_reason: "n/a",
    calls_held: 0, no_shows: 0, unlogged: 0, prior: { deposits: 0, close_rate: null }
  },
  money: { paid_cents: 0, pending_cents: 0, at_risk_cents: null, at_risk_reason: "n/a", paid_display: "$0", pending_display: "$0" },
  call_quality: { available: false, reason: "Call recording and transcription do not exist yet" },
  compliance: { available: false, reason: "schema ready" },
  team: [],
  owed: [],
  streak: { available: false, reason: "not stored yet" }
};

const emptyFloor = {
  ok: true,
  period: { start: "2026-08-01T00:00:00.000Z", end: "2026-09-01T00:00:00.000Z" },
  hero: {
    cash_cents: 0, cash_display: "$0", target_cents: null,
    target_reason: "No monthly sales_manager deposits target in staff_targets",
    deposit_to_funded: null, deposit_to_funded_n: { deposits: 0, funded: 0, rate: null }
  },
  funnel: { booked: 0, held: 0, deposits: 0, funded: 0, downsells: 0, downsell_cash_cents: 0 },
  closers: [],
  beliefs: { beliefs: [], sources: [], period: {}, prior: {} },
  compliance: { available: false, reason: "Call recording and transcription do not exist yet", items: [] },
  cold_deals: [],
  discipline: {
    unlogged_calls: 0, shifts_started_late: null,
    shifts_detail: { reason: "Needs scheduled shift times" },
    followups_overdue: null, followups_reason: "n/a",
    avg_log_lag_days: null, avg_log_lag_reason: "n/a"
  }
};

const emptyCockpit = {
  ok: true,
  staff: { id: "staff-2", name: "Casey Reed", shift: { on_shift: false, reason: "No open shift" } },
  kpis: {
    cash_today_cents: { cents: 0, display: "$0", deposits: 0 },
    cash_month_cents: 0, deposits: 0, calls_held: 0, no_shows: 0,
    close_rate: null, unlogged: 0, commission_mtd: null, commission_reason: "n/a"
  },
  client: {
    id: CLIENT_ID, name: "Dana Whitfield", business_name: null,
    age_months: null, tags: [], funded: false, pipeline: null
  },
  credit: { available: false, reason: "No crs_results row for this client yet" },
  underwrite: { matched_lenders: 0, lenders: [], applications: [], lenders_reason: "empty" },
  deal: { latest_payment: null, success_fee_percent: 0.1, success_fee_note: "10%" },
  precall: { conversation_count: 0, summary: "No conversation summary on file yet." },
  up_next: [],
  gone_quiet: { unlogged: [], quiet_deposits: [] },
  dispositions: {
    outcomes: ["deposit", "downsell", "callback", "no_show", "not_a_fit"],
    beliefs: ["pain", "doubt", "cost", "desire", "money", "support", "trust"]
  }
};

function salesHandlers({ floorStatus = 200 } = {}) {
  return {
    "/api/read/my-numbers": emptyMyNumbers,
    "/api/read/sales-floor": async (route) => {
      if (floorStatus !== 200) {
        await route.fulfill({
          status: floorStatus,
          contentType: "application/json",
          body: JSON.stringify({
            ok: false, error: "forbidden",
            message: "this endpoint is limited to owner, admin, sales_manager"
          })
        });
        return;
      }
      await route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify(emptyFloor)
      });
    },
    "/api/read/closer-call": emptyCockpit,
    "/api/read/underwrite": { ok: true, suggestions: [] },
    "/api/call-outcomes": { ok: true, created: true, outcome: { outcome: "deposit" } },
    "/api/marketing-flags": { ok: true, flag: { id: "flag-1" } }
  };
}

test("my-numbers loads for a closer and shows honest empty call quality", async ({ page }) => {
  await openScreen(page, "/app/my-numbers.html", CLOSER, salesHandlers());
  await expect(page.locator("body")).toBeVisible();
  await expect(page.locator("text=Call recording and transcription do not exist yet")).toBeVisible();
  await expect(page.locator("text=Deposit → funded")).toBeVisible();
});

test("sales-floor loads for sales_manager and shell bounces a closer home", async ({ page }) => {
  await openScreen(page, "/app/sales-floor.html", SALES_MANAGER, salesHandlers());
  await expect(page.locator("body")).toBeVisible();
  await expect(page.locator(".hero").first()).toBeVisible();

  // Closers are not on the sales-floor allow list — shell.js replaces them
  // to their home before the page (or its API 403 banner) can paint.
  const errors = await openScreen(page, "/app/sales-floor.html", CLOSER, salesHandlers({ floorStatus: 403 }));
  await expect(page).toHaveURL(/closer-dashboard\.html/);
  expect(errors).toEqual([]);
});

test("sales-floor loads for owner", async ({ page }) => {
  await openScreen(page, "/app/sales-floor.html", OWNER, salesHandlers());
  await expect(page.locator(".hero").first()).toBeVisible();
});

test("closer-call requires client_id and shows disposition hotkeys", async ({ page }) => {
  await openScreen(page, `/app/closer-call.html?client_id=${CLIENT_ID}`, CLOSER, salesHandlers());
  await expect(page.locator("body")).toBeVisible();
  await expect(page.locator("h1").first()).toBeVisible();
  await expect(page.locator('[data-outcome="deposit"]').first()).toBeVisible();
  await expect(page.locator('[data-belief="desire"]').first()).toBeVisible();
});

test("closer-call without client_id shows the honest gate", async ({ page }) => {
  await openScreen(page, "/app/closer-call.html", CLOSER, salesHandlers());
  await expect(page.locator("body")).toContainText(/client_id|pipeline|cockpit/i);
});
