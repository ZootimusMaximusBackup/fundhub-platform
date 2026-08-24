// Time primary CRM click-paths for the conveyor KPI worksheet.
// Load + one primary click. Writes JSON evidence. Does NOT assert time
// thresholds (those flake). If a control is missing or disabled, record
// not_clickable — never invent a number.
//
// NO BACKEND. Same harness as the other CRM specs.

import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  wireApi,
  withSession,
  json,
  CLIENT_ID,
  CLOSER,
  OWNER,
  TASK_WITH_CALL
} from "./harness.mjs";

const EVIDENCE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "docs/workflows/fundhub-conveyor-kpis-2026-08-23-evidence"
);
const EVIDENCE_FILE = path.join(EVIDENCE_DIR, "ui-times.json");

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
  pace: { cash_cents: 0, cash_display: "$0", target_cents: null, target_reason: "No monthly deposits target", rank: null, team_size: 0 },
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
    target_reason: "No monthly sales_manager deposits target",
    deposit_to_funded: null, deposit_to_funded_n: { deposits: 0, funded: 0, rate: null }
  },
  funnel: { booked: 0, held: 0, deposits: 0, funded: 0, downsells: 0, downsell_cash_cents: 0 },
  today: { date: "2026-08-17", booked: 0, held: 0, deposits: 0, target_cents: null, target_reason: "No daily sales_manager target" },
  closers: [],
  beliefs: { beliefs: [], sources: [], period: {}, prior: {} },
  compliance: { available: false, reason: "Call recording and transcription do not exist yet", items: [] },
  cold_deals: [],
  recordings: { drive_ready: false, missing: ["GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON"], items: [], reason: "Google Drive is not connected yet." },
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

function salesHandlers() {
  return {
    "/api/read/my-numbers": emptyMyNumbers,
    "/api/read/sales-floor": emptyFloor,
    "/api/read/closer-call": emptyCockpit,
    "/api/read/closer-now": { ok: true, current: null, next: null },
    "/api/read/underwrite": { ok: true, suggestions: [] },
    "/api/call-outcomes": { ok: true, created: true, outcome: { outcome: "deposit" } }
  };
}

const PIPELINE = {
  ok: true,
  pipeline: "sales",
  total: 1,
  stages: [
    {
      key: "new_lead", name: "New Lead", sort_order: 0, count: 1, amount: 0,
      cards: [{
        id: "card-1", client_id: CLIENT_ID, name: "Dana Whitfield",
        owner: "Jordan Blake", entered_at: "2026-08-01T10:00:00Z",
        outcome_tier: null, funded: false, amount: 3000
      }]
    },
    {
      key: "booked", name: "Booked", sort_order: 2, count: 0, amount: 0, cards: []
    }
  ]
};

const rows = [];

function record(row) {
  rows.push({
    ...row,
    recorded_at: new Date().toISOString()
  });
}

async function setup(page, session, handlers = {}) {
  await withSession(page, session);
  await wireApi(page, session, handlers);
}

async function timeLoad(page, url, readySelector) {
  const t0 = Date.now();
  await page.goto(url);
  await page.waitForLoadState("domcontentloaded");
  const loc = page.locator(readySelector).first();
  let ready = false;
  try {
    await loc.waitFor({ state: "visible", timeout: 10_000 });
    ready = true;
  } catch {
    ready = false;
  }
  return { load_ms: Date.now() - t0, ready };
}

async function timeClick(page, selector, { popup = false, afterVisible = null } = {}) {
  const loc = page.locator(selector).first();
  const visible = await loc.isVisible().catch(() => false);
  if (!visible) return { click_ms: null, status: "not_clickable", reason: "not_visible" };
  const enabled = await loc.isEnabled().catch(() => false);
  if (!enabled) return { click_ms: null, status: "not_clickable", reason: "disabled" };

  const t0 = Date.now();
  if (popup) {
    const popupPromise = page.waitForEvent("popup", { timeout: 5_000 }).catch(() => null);
    await loc.click();
    const win = await popupPromise;
    const click_ms = Date.now() - t0;
    if (win) {
      await win.close().catch(() => {});
      return { click_ms, status: "clicked", note: "popup_opened" };
    }
    return { click_ms, status: "clicked", note: "clicked_no_popup" };
  }

  await loc.click();
  if (afterVisible) {
    await page.locator(afterVisible).first().waitFor({ state: "visible", timeout: 5_000 }).catch(() => {});
  }
  return { click_ms: Date.now() - t0, status: "clicked" };
}

test.afterAll(() => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const payload = {
    generated_at: new Date().toISOString(),
    note: "CRM UI milliseconds only. Not cycle clocks, not call length, not Hubstaff hours. No time thresholds asserted.",
    rows
  };
  fs.writeFileSync(EVIDENCE_FILE, JSON.stringify(payload, null, 2) + "\n");
});

test("calendar — load and Join Call enable", async ({ page }) => {
  await setup(page, CLOSER, {
    "/api/tasks": () => ({ ok: true, tasks: [TASK_WITH_CALL] })
  });
  const load = await timeLoad(page, "/app/calendar.html", "#unJoin");
  await expect(page.locator("body")).toBeVisible();
  const join = page.locator("#unJoin");
  let enabled = false;
  try {
    await expect(join).toBeEnabled({ timeout: 10_000 });
    enabled = true;
  } catch {
    enabled = false;
  }
  const click = enabled
    ? await timeClick(page, "#unJoin", { popup: true })
    : { click_ms: null, status: "not_clickable", reason: "disabled" };
  record({
    id: "calendar_join_call",
    screen: "calendar.html",
    action: "Load calendar, then Join Call",
    ...load,
    join_enabled: enabled,
    ...click
  });
});

test("closer dashboard — load with client_id, Present if visible", async ({ page }) => {
  await setup(page, CLOSER, salesHandlers());
  const load = await timeLoad(
    page,
    `/app/closer-dashboard.html?client_id=${CLIENT_ID}`,
    "h1"
  );
  await expect(page.locator("body")).toBeVisible();
  const present = page.locator("#fh-present");
  let presentVisible = false;
  try {
    await present.waitFor({ state: "visible", timeout: 5_000 });
    presentVisible = true;
  } catch {
    presentVisible = false;
  }
  const click = presentVisible
    ? await timeClick(page, "#fh-present", { popup: true })
    : { click_ms: null, status: "not_clickable", reason: "not_visible" };
  record({
    id: "closer_dashboard_present",
    screen: "closer-dashboard.html",
    action: "Load closer dashboard with client, then Present",
    ...load,
    present_visible: presentVisible,
    ...click
  });
});

test("my numbers — load", async ({ page }) => {
  await setup(page, CLOSER, salesHandlers());
  const load = await timeLoad(page, "/app/my-numbers.html", "#staffChip");
  await expect(page.locator("body")).toBeVisible();
  record({
    id: "my_numbers_load",
    screen: "my-numbers.html",
    action: "Load my numbers",
    ...load,
    click_ms: null,
    status: "load_only",
    reason: "No primary belt click on this screen"
  });
});

test("sales floor — load", async ({ page }) => {
  await setup(page, SALES_MANAGER, salesHandlers());
  const load = await timeLoad(page, "/app/sales-floor.html", ".hero");
  await expect(page.locator("body")).toBeVisible();
  record({
    id: "sales_floor_load",
    screen: "sales-floor.html",
    action: "Load sales floor",
    ...load,
    click_ms: null,
    status: "load_only",
    reason: "No primary belt click on this screen"
  });
});

test("pipeline — MOVE", async ({ page }) => {
  await setup(page, OWNER, {
    "/api/dashboard/pipeline": PIPELINE,
    "/api/pipeline-cards": async (route, { method }) => {
      if (method === "POST") return json(route, { ok: true, action: "move" });
      return json(route, { ok: true });
    }
  });
  const load = await timeLoad(page, "/app/pipeline.html", ".card[data-client-id]");
  await expect(page.locator("body")).toBeVisible();
  const moveBtn = page.locator(".card[data-client-id] .c-btn.route").first();
  const moveVisible = await moveBtn.isVisible().catch(() => false);
  if (!moveVisible) {
    record({
      id: "pipeline_move",
      screen: "pipeline.html",
      action: "Load pipeline, then MOVE",
      ...load,
      click_ms: null,
      status: "not_clickable",
      reason: "MOVE not visible"
    });
    return;
  }
  const t0 = Date.now();
  await moveBtn.click();
  const menu = page.locator("#routeMenu");
  let menuOpen = false;
  try {
    await expect.poll(async () =>
      menu.evaluate((el) => el && !el.hidden)
    ).toBe(true);
    menuOpen = true;
  } catch {
    menuOpen = false;
  }
  if (!menuOpen) {
    record({
      id: "pipeline_move",
      screen: "pipeline.html",
      action: "Load pipeline, then MOVE",
      ...load,
      click_ms: Date.now() - t0,
      status: "not_clickable",
      reason: "route menu did not open"
    });
    return;
  }
  const item = page.locator("#routeMenu .rm-item[data-pipeline-key]").first();
  const itemVisible = await item.isVisible().catch(() => false);
  if (!itemVisible) {
    record({
      id: "pipeline_move",
      screen: "pipeline.html",
      action: "Load pipeline, then MOVE",
      ...load,
      click_ms: Date.now() - t0,
      status: "not_clickable",
      reason: "no route item"
    });
    return;
  }
  await item.click();
  record({
    id: "pipeline_move",
    screen: "pipeline.html",
    action: "Load pipeline, then MOVE",
    ...load,
    click_ms: Date.now() - t0,
    status: "clicked"
  });
});

test("lenders — tab switch", async ({ page }) => {
  await setup(page, OWNER, {
    "/api/read/lenders": { ok: true, lenders: [], meta: { count: 0, empty: true } },
    "/api/read/lender-observations": { ok: true, observations: [], meta: { count: 0 } }
  });
  const load = await timeLoad(page, "/app/lenders.html", "button[data-tab='list']");
  await expect(page.locator("body")).toBeVisible();
  const click = await timeClick(page, "button[data-tab='review']", {
    afterVisible: "#tab-review"
  });
  record({
    id: "lenders_tab_switch",
    screen: "lenders.html",
    action: "Load lenders, switch to Bureau mismatch queue",
    ...load,
    ...click
  });
});

test("inquiry remover — Repair tab", async ({ page }) => {
  await setup(page, OWNER, {
    "/api/read/repair-cases": {
      ok: true, files: [], need_me: 0, ready: 0, waiting: 0, stalled: 0, trial_ending: 0
    },
    "/api/repair/exceptions": { ok: true, items: [] }
  });
  const load = await timeLoad(page, "/app/inquiry-remover.html", "#tab-repair");
  await expect(page.locator("body")).toBeVisible();
  const click = await timeClick(page, "#tab-repair", { afterVisible: "#pane-repair" });
  record({
    id: "inquiry_repair_tab",
    screen: "inquiry-remover.html",
    action: "Load specialist desk, switch to Repair",
    ...load,
    ...click
  });
});
