// The Specialist desk (public/app/inquiry-remover.html), in a real browser.
//
// Three bugs, all of them things a person sees and none of them things markup
// assertions could have caught, because all three are about what happens AFTER
// a click:
//
//   1. Marking an inquiry confirmed wrote the result into the wrong two
//      columns — the attempt count landed under Expected and the status pill
//      under Call State, while the real Attempts and Status columns never
//      moved. The row said "Removed" in the wrong place and still read open in
//      the right one, which is the exact thing the screen's own header calls
//      the worst outcome available.
//   2. The repair tile filters died after the first Send, because the reload
//      re-bound a second listener on every tile and the two handlers cancelled
//      each other out.
//   3. A refused soft pull closed its box and said nothing at all.
//
// No backend: page.route() answers every /api/** call, same as the rest of e2e/.

import { test, expect } from "@playwright/test";
import { openScreen, json, CLIENT_ID, OWNER } from "./harness.mjs";

/* The role this desk belongs to. Not in harness.mjs because no other spec
   needs it. */
const SPECIALIST = {
  ok: true,
  staff: {
    id: "staff-3", name: "Robin Ellis", email: "robin@fundhub.ai",
    role: "inquiry_specialist", org_id: "org-1", status: "active"
  }
};

const INQUIRY_ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const CLIENT_B = "bbbbbbbb-2222-4222-8222-222222222222";

/* One inquiry, part-worked: two attempts logged, still open, with an expected
   name and a live call state so we can prove those two cells DO NOT move. */
const INQUIRY_ROW = {
  id: INQUIRY_ID,
  client_id: CLIENT_ID,
  client_name: "Dana Whitfield",
  bureau: "Experian",
  inquiry_name: "CAPITAL ONE BANK USA",
  expected_name: "Capital One",
  call_state: "holding",
  call_attempts: 2,
  status: "Filed",
  outcome: null
};

const INQUIRY_LIST = {
  ok: true, count: 1, limit: 200, offset: 0, hasMore: false, items: [INQUIRY_ROW]
};

/* Two repair files that land in different tiles: one ready to send (sets
   "need ready"), one waiting on the bureau (sets "wait"). */
const FILE_READY = {
  client_id: CLIENT_ID, name: "Dana Whitfield", program: "trial",
  round: "R1", rounds_cap: 3, stage_key: "ready_to_send", stage_label: "Ready to send",
  letters_ready: 1, letters_sent: 0, can_send: true,
  authorization_ok: true, response_due_at: null
};
const FILE_WAITING = {
  client_id: CLIENT_B, name: "Sam Rivera", program: "trial",
  round: "R2", rounds_cap: 3, stage_key: "awaiting_response", stage_label: "Awaiting response",
  letters_ready: 0, letters_sent: 2, can_send: false,
  authorization_ok: true, response_due_at: null
};

const REPAIR_LIST = {
  ok: true, need_me: 1, ready: 1, waiting: 1, stalled: 0, trial_ending: 0,
  files: [FILE_READY, FILE_WAITING]
};

const REPAIR_FILE = {
  ok: true,
  file: { client_id: CLIENT_ID, name: "Dana Whitfield" },
  letters: [{
    id: "11111111-1111-4111-8111-111111111111",
    bureau: "EX", round: "R1", status: "ready", target: "bureau",
    can_send: true, html: "<p>Round 1 letter</p>", rule_ids: ["r-1"]
  }],
  items: [], timeline: [], rounds: []
};

/* repairHandlers — the list read and the single-file read share a path, so one
   function answers both and branches on the query string. */
function repairHandlers(extra = {}) {
  return {
    "/api/read/repair-cases": (route, { url }) =>
      url.includes("client_id=") ? REPAIR_FILE : REPAIR_LIST,
    "/api/pii": { ok: true, identity: null },
    "/api/repair/exceptions": { ok: true, stalled: [], lowConfidenceParses: [] },
    ...extra
  };
}

/** Open the Repair tab and wait for its rows to paint. */
async function openRepairTab(page) {
  await page.locator('.desk-tab[data-pane="repair"]').click();
  await expect(page.locator("#repairBody tr.repair-row")).toHaveCount(2);
}

/** Expand the first repair row and wait for its action buttons. */
async function expandFirstRepairRow(page) {
  await page.locator(`[data-repair-row="${CLIENT_ID}"]`).click();
  await expect(page.locator("tr.repair-expand [data-act=repair-send]")).toBeVisible();
}

/* ── BUG 1 ─────────────────────────────────────────────────────────────────── */

test("marking an inquiry confirmed writes the status into Status and the count into Attempts", async ({ page }) => {
  await openScreen(page, "/app/inquiry-remover.html", SPECIALIST, {
    "/api/read/inquiries": INQUIRY_LIST,
    "/api/pii": { ok: true, identity: null },
    "/api/inquiries": (route, { method }) => {
      if (method !== "POST") return INQUIRY_LIST;
      return json(route, {
        ok: true,
        inquiry: {
          id: INQUIRY_ID, status: "Removed", outcome: null,
          call_attempts: 3, confirmed_at: "2026-08-30T12:00:00Z"
        }
      });
    }
  });

  const row = page.locator("#workQueueTable tr[data-row]").first();
  await expect(row).toBeVisible();

  // The header is Client | Bureau | Actual | Expected | Call State | Hold |
  // Attempts | Status, so nth-child is 1-based over those eight.
  const expected = row.locator("td:nth-child(4)");
  const callState = row.locator("td:nth-child(5)");
  const attempts = row.locator("td:nth-child(7)");
  const status = row.locator("td:nth-child(8)");

  await expect(expected).toHaveText("Capital One");
  await expect(callState).toContainText("holding");
  await expect(attempts).toHaveText("2");
  await expect(status).toContainText("Filed");

  await row.click();
  await page.getByRole("button", { name: "Mark confirmed" }).click();

  // THE FIX. The server said Removed with three attempts; both belong in the
  // last two columns and nowhere else.
  await expect(status).toContainText("Removed");
  await expect(attempts).toHaveText("3");

  // And the two columns the bug used to scribble on are untouched.
  await expect(expected).toHaveText("Capital One");
  await expect(callState).toContainText("holding");
  await expect(expected).not.toContainText("3");
  await expect(callState).not.toContainText("Removed");
});

/* ── BUG 2 ─────────────────────────────────────────────────────────────────── */

test("the repair tile filters still work after a Send", async ({ page }) => {
  await openScreen(page, "/app/inquiry-remover.html", OWNER, repairHandlers({
    "/api/repair/send": { ok: true, sent: 1 }
  }));

  await openRepairTab(page);

  const waitTile = page.locator('#repair-stats .stat-tile[data-filter="wait"]');
  const readyRow = page.locator(`[data-repair-row="${CLIENT_ID}"]`);
  const waitingRow = page.locator(`[data-repair-row="${CLIENT_B}"]`);

  // Works before any write.
  await waitTile.click();
  await expect(waitTile).toHaveAttribute("aria-pressed", "true");
  await expect(readyRow).toHaveClass(/filtered-out/);
  await expect(waitingRow).not.toHaveClass(/filtered-out/);

  // And toggles back off — one click, one state change.
  await waitTile.click();
  await expect(waitTile).toHaveAttribute("aria-pressed", "false");
  await expect(readyRow).not.toHaveClass(/filtered-out/);

  // Now send, which reloads the desk. This is the moment the filters used to
  // die: the reload bound a SECOND click handler on every tile, so the next
  // click ran the toggle twice and landed back where it started.
  await expandFirstRepairRow(page);
  await page.locator("tr.repair-expand [data-act=repair-send]").click();
  await expect(page.locator("#repairBody tr.repair-row")).toHaveCount(2);

  // One click, still one state change.
  await waitTile.click();
  await expect(waitTile).toHaveAttribute("aria-pressed", "true");
  await expect(readyRow).toHaveClass(/filtered-out/);
  await expect(waitingRow).not.toHaveClass(/filtered-out/);
});

/* ── BUG 3 ─────────────────────────────────────────────────────────────────── */

test("a refused soft pull says so instead of closing in silence", async ({ page }) => {
  let pulls = 0;
  await openScreen(page, "/app/inquiry-remover.html", OWNER, repairHandlers({
    "/api/finance/crs-pull": (route) => {
      pulls++;
      return json(route, { ok: false, error: "forbidden" }, 403);
    }
  }));

  await openRepairTab(page);
  await expandFirstRepairRow(page);

  await page.locator("tr.repair-expand [data-act=repair-pull]").click();
  await expect(page.locator("#repairPullModal")).toHaveAttribute("aria-hidden", "false");

  await page.locator("#repairPullInput").fill("PULL");
  await page.locator("#repairPullGo").click();

  // It says so, in FHData's house wording for a refusal, in two places: the
  // desk's own error line and the app's error strip.
  const said = page.locator("#repairErr");
  await expect(said).toBeVisible();
  await expect(said).toContainText(/may not be allowed/i);
  await expect(page.locator("#fh-data-banner")).toContainText(/may not be allowed/i);

  // The box closes, the button is usable again, and it stopped at the first
  // refusal rather than asking two more bureaus the same question.
  await expect(page.locator("#repairPullModal")).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator("#repairPullGo")).toHaveText("Pull");
  expect(pulls).toBe(1);
});

test("the Specialist is not shown a Soft pull or Clean personal info button", async ({ page }) => {
  await openScreen(page, "/app/inquiry-remover.html", SPECIALIST, repairHandlers());

  await openRepairTab(page);
  await expandFirstRepairRow(page);

  const actions = page.locator("tr.repair-expand .case-actions");
  // Neither endpoint accepts this role, so neither button renders —
  // docs/UI-STANDARDS.md §5, no control that the role cannot use.
  await expect(actions.locator("[data-act=repair-pull]")).toHaveCount(0);
  await expect(actions.locator("[data-act=repair-clean]")).toHaveCount(0);
  // The three they can actually use are all still there.
  await expect(actions.locator("[data-act=repair-send]")).toHaveCount(1);
  await expect(actions.locator("[data-act=repair-stage]")).toHaveCount(1);
  await expect(actions.locator("[data-act=repair-enroll]")).toHaveCount(1);
});

test("the owner still gets both buttons on the same screen", async ({ page }) => {
  await openScreen(page, "/app/inquiry-remover.html", OWNER, repairHandlers());

  await openRepairTab(page);
  await expandFirstRepairRow(page);

  const actions = page.locator("tr.repair-expand .case-actions");
  await expect(actions.locator("[data-act=repair-pull]")).toHaveCount(1);
  await expect(actions.locator("[data-act=repair-clean]")).toHaveCount(1);
});
