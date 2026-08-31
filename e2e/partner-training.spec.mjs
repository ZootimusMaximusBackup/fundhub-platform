// Playwright — the training screen a partner actually opens.
//
// COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7): this page prints whether a partner
// holds the two compliance certifications that stand between them and selling
// under FundHub's brand.
//
// src/http/partner-training-read.test.mjs proves the payload and the gate.
// src/training/training.pg.test.mjs proves the record against real Postgres.
// Neither of them clicks anything, and a screen can pass both and still be a
// blank page: one element id that does not match and nothing renders.
//
// NO BACKEND. /api/read/partner-training is answered here with the exact shapes
// the handler returns — the 200 for an entitled partner and the 403 for one whose
// agreement is unsigned. The refusal case is the one worth having in a browser:
// it is the only path where a partner who paid $10,000 is told "no", and telling
// them the wrong thing ("you are not signed in") is the failure.

import { test, expect } from "@playwright/test";

const GATES = [
  { code: "G1", position: 1, title: "Capital and Plan Gate", week_due: 1,
    blocks: "The partner's brand is not issued until this gate passes.",
    outcome: "passed", decided_at: "2026-08-10T00:00:00.000Z", decided_by_staff_id: null,
    notes: null, passed: true },
  { code: "G2", position: 2, title: "Compliance Certification", week_due: 3,
    blocks: "No public asset goes live until this gate passes.",
    outcome: null, decided_at: null, decided_by_staff_id: null, notes: null, passed: false },
  { code: "G3", position: 3, title: "Call Certification", week_due: 4,
    blocks: "No live buyer call until this gate passes.",
    outcome: "failed", decided_at: "2026-08-24T00:00:00.000Z", decided_by_staff_id: null,
    notes: null, passed: false },
  { code: "G4", position: 4, title: "Supervised Production Release", week_due: 5,
    blocks: "The partner is not released to sell unsupervised until three clients have paid.",
    outcome: null, decided_at: null, decided_by_staff_id: null, notes: null, passed: false }
];

const MODULES = [
  { code: "m1", position: 1, title: "Your Money Math", week_no: 1, gate_code: "G1",
    certified: false, status: "complete", attended_at: null,
    completed_at: "2026-08-09T00:00:00.000Z", recorded_by_staff_id: null, notes: null },
  { code: "m2", position: 2, title: "The Belt: what FundHub does after the sale", week_no: 1,
    gate_code: "G1", certified: false, status: "complete", attended_at: null,
    completed_at: "2026-08-09T00:00:00.000Z", recorded_by_staff_id: null, notes: null },
  { code: "m7", position: 6, title: "Compliance I: what you may never say", week_no: 3,
    gate_code: "G2", certified: true, status: "attended", attended_at: "2026-08-20T00:00:00.000Z",
    completed_at: null, recorded_by_staff_id: null, notes: null },
  { code: "m12", position: 12, title: "Your Numbers and the Floor", week_no: null,
    gate_code: null, certified: false, status: null, attended_at: null, completed_at: null,
    recorded_by_staff_id: null, notes: null }
];

const ENTITLED = {
  ok: true,
  partner_id: "9f2c1d3e-0000-4000-8000-000000000001",
  modules: MODULES,
  gates: GATES,
  modules_total: 4,
  modules_complete: 2,
  next_module: MODULES[2],
  next_gate: GATES[1],
  may_sell_supervised: false,
  may_sell_unsupervised: false,
  gates_outstanding: ["G2", "G3", "G4"],
  curriculum_seeded: true,
  gate_codes: ["G1", "G2", "G3", "G4"],
  catalogue_codes: ["m1", "m2", "m7", "m12"],
  partner_status: "active",
  agreement_signed_at: "2026-08-01T00:00:00.000Z",
  entitled: true,
  entitlement_reason: null,
  entitlement_message: null
};

const REFUSED = {
  ok: false,
  error: "not_entitled",
  reason: "agreement_unsigned",
  message: "Your partner agreement has not been signed yet. The training opens once it is."
};

async function open(page, { status, body }) {
  /* shell.js gates from <head> and bounces to /login.html before the page paints
     unless it finds a cached role. Same setup every other screen spec uses. */
  await page.addInitScript(() => {
    localStorage.setItem("fh_token", "e2e-token");
    localStorage.setItem("fh_role", "partner");
    localStorage.removeItem("fh_demo");
  });

  await page.route("**/api/read/partner-training*", async (route) => {
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  });
  /* The shell asks for a session on every gated screen and bounces to
     /login.html on anything that is not { ok, staff }. Answer it as a partner,
     which is the role ROLE_TABS lets open this screen. */
  await page.route("**/api/auth/session", async (route) => {
    await route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        staff: { id: "e2e-partner", name: "E2E Partner", email: "e2e@example.test", role: "partner" }
      })
    });
  });
  // Nothing else on the page needs a backend; the chip asks for health.
  await page.route("**/api/health*", async (route) => {
    await route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ ok: true, db: "up", migrations: 284 })
    });
  });
  await page.goto("/app/partner-training.html", { waitUntil: "domcontentloaded" });
}

test("an entitled partner sees their gates, their modules and what is next", async ({ page }) => {
  await open(page, { status: 200, body: ENTITLED });

  await expect(page.locator("#trBody")).toBeVisible();
  await expect(page.locator("#trBlocked")).toBeHidden();

  // The four gates, each with a state — and the three states must read
  // differently. "Never assessed" is not "did not pass".
  const gates = page.locator("#trGates .gate");
  await expect(gates).toHaveCount(4);
  await expect(gates.nth(0)).toContainText("Passed");
  await expect(gates.nth(1)).toContainText("Not assessed");
  await expect(gates.nth(2)).toContainText("Not passed yet");

  // The sentence the whole gate ladder exists to be able to say.
  await expect(page.locator("#trSelling"))
    .toContainText("You may not sell under FundHub's brand yet");
  await expect(page.locator("#trSelling")).toContainText("G2, G3, G4");

  await expect(page.locator("#trNextModule")).toContainText("Compliance I");
  await expect(page.locator("#trNextGate")).toContainText("G2");

  const rows = page.locator("#trModules .mrow");
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText("Done");
  await expect(rows.nth(2)).toContainText("Sat, not finished");
  // A certified module is marked as one, because it ends in an exam rather than
  // in attendance.
  await expect(rows.nth(2)).toContainText("Certified");
  // m12 has no week in W7 and must print a dash, never "Week 0" or "Week 1".
  await expect(rows.nth(3)).toContainText("—");
  await expect(rows.nth(3)).not.toContainText("Week 0");

  await expect(page.locator("#trCount")).toContainText("2 of 4 modules done");
  await expect(page.locator("#trGateCount")).toContainText("1 of 4 gates passed");
});

test("a partner who is not entitled is told why, not told they are signed out", async ({ page }) => {
  await open(page, { status: 403, body: REFUSED });

  await expect(page.locator("#trBlocked")).toBeVisible();
  await expect(page.locator("#trBody")).toBeHidden();
  await expect(page.locator("#trBlocked .msg")).toContainText("agreement has not been signed");
  // The failure this case exists for: a 403 rendered as an auth problem sends a
  // partner to hunt for a password that is not the problem.
  await expect(page.locator("#trBlocked")).not.toContainText("not signed in");
  // And no curriculum leaks past the refusal.
  await expect(page.locator("#trGates .gate")).toHaveCount(0);
});

test("the screen offers no way to mark your own training", async ({ page }) => {
  await open(page, { status: 200, body: ENTITLED });
  await expect(page.locator("#trBody")).toBeVisible();
  // A partner who could tick their own compliance module would be a partner with
  // no compliance certification. There is nothing to click.
  await expect(page.locator("#trBody button")).toHaveCount(0);
  await expect(page.locator("#trBody input")).toHaveCount(0);
});
