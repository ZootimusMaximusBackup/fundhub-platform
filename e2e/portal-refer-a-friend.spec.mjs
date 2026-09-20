// REFER A FRIEND, CLICKED IN A REAL BROWSER.
//
// The card is section 7b of public/app/client-portal.html, added 2026-09-20
// because the welcome video at the top of that page asks people to press a
// button that, until then, only existed on a different page
// (public/progress.html:213).
//
// WHY A BROWSER TEST AND NOT ONLY THE .pg TESTS. The endpoint and the two-tier
// chain behind it are proved against a real database in
// src/affiliates/two-tier-chain.pg.test.mjs. None of that says a single thing
// about whether the button is wired. A card can pass every server-side check
// and still be a section that never un-hides, a handler bound to an id that
// does not exist, or a link painted into an element nobody can see. That is
// the exact failure e2e/client-portal-ux.spec.mjs's own header was written
// about, and it is what this file is for.
//
// NO BACKEND AND NO NETWORK — every /api/ call is intercepted, same as the
// sibling spec. Chromium is already on the machine; `playwright install` must
// not be run.

import { test, expect } from "@playwright/test";
import { CLIENT_ID, json } from "./harness.mjs";

const SESSION = {
  ok: true,
  staff: {
    id: CLIENT_ID, name: "Dana Whitfield", email: "dana@example.com",
    role: "client", org_id: "org-1", status: "active"
  }
};

const SHARE_URL = "https://fundhub.ai/start?ref=FH1042";

const NOT_ENROLLED = {
  ok: true, enrolled: false, affiliate: null,
  rates: { direct: null, downline: null }, referrals: [], payouts: [], gates: null
};

const ENROLLED = {
  ok: true, enrolled: true,
  affiliate: { id: "aff-1", name: "Dana Whitfield", code: "FH1042", shareUrl: SHARE_URL,
               status: "active", tierLevel: "tier1", balanceDue: null },
  rates: { direct: { percent: 20 }, downline: { percent: 5 } },
  referrals: [
    { id: "r1", tier: "direct", status: "converted", name: "Sam" },
    { id: "r2", tier: "direct", status: "attributed", name: "Alex" },
    // A downline row. It belongs to somebody THEY recruited, so it must not be
    // counted under "People sent" — that would credit them with a person they
    // did not send.
    { id: "r3", tier: "downline", status: "converted", name: "Jo" },
    // A voided row is not a person they sent either.
    { id: "r4", tier: "direct", status: "void", name: "Void" }
  ],
  payouts: [], gates: null
};

/* portalState decides what /api/read/affiliate-portal answers, and refer
   records the presses so a test can assert the button actually posted. */
async function openPortal(page, { portal, referResponse, referStatus = 201 } = {}) {
  const calls = { refer: 0 };

  await page.addInitScript(() => {
    localStorage.setItem("fh_token", "e2e-token");
    localStorage.setItem("fh_role", "client");
    localStorage.removeItem("fh_demo");
  });

  let portalBody = portal;

  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/api/auth/session") || /\/api\/session\b/.test(url)) {
      return json(route, SESSION);
    }
    if (url.includes("/api/affiliates/refer")) {
      calls.refer += 1;
      // A real press enrols them, so the NEXT read must answer enrolled.
      portalBody = ENROLLED;
      return json(route, referResponse !== undefined ? referResponse : {
        ok: true, enrolled: true, created: true, code: "FH1042",
        shareUrl: SHARE_URL, recruitedBy: null
      }, referStatus);
    }
    if (url.includes("/api/read/affiliate-portal")) {
      return json(route, portalBody);
    }
    if (url.includes("/api/read/portal-summary")) {
      return json(route, {
        ok: true, prequal_amount: null, prequal_display: null, soft_pull_complete: false,
        scores: { experian: null, equifax: null, transunion: null, experian_business: null },
        documents: []
      });
    }
    return json(route, { ok: true, items: [] });
  });

  await page.goto(`/app/client-portal.html?id=${CLIENT_ID}`);
  await page.waitForLoadState("domcontentloaded");
  return calls;
}

test.describe("refer a friend, on the portal page", () => {
  test("a client who has never enrolled sees the button and no link", async ({ page }) => {
    await openPortal(page, { portal: NOT_ENROLLED });

    await expect(page.locator("#ref-card")).toBeVisible();
    await expect(page.locator("#ref-go")).toBeVisible();
    await expect(page.locator("#ref-have")).toBeHidden();
  });

  test("pressing it posts once and paints the link", async ({ page }) => {
    const calls = await openPortal(page, { portal: NOT_ENROLLED });

    await page.locator("#ref-go").click();
    await expect(page.locator("#ref-have")).toBeVisible();
    await expect(page.locator("#ref-url")).toHaveText(SHARE_URL);
    await expect(page.locator("#ref-join")).toBeHidden();
    expect(calls.refer).toBe(1);
  });

  test("a client who already has a link never sees the button", async ({ page }) => {
    const calls = await openPortal(page, { portal: ENROLLED });

    await expect(page.locator("#ref-url")).toHaveText(SHARE_URL);
    await expect(page.locator("#ref-join")).toBeHidden();
    // Nothing was pressed, so nothing may have been posted. A read that enrols
    // somebody as a side effect would be a write behind a GET.
    expect(calls.refer).toBe(0);
  });

  test("the counts show direct referrals only — not downline, not voided", async ({ page }) => {
    await openPortal(page, { portal: ENROLLED });

    await expect(page.locator("#ref-stats")).toBeVisible();
    // Sam + Alex. NOT Jo (downline, somebody else's work) and NOT the void row.
    await expect(page.locator("#ref-n-sent")).toHaveText("2");
    await expect(page.locator("#ref-n-conv")).toHaveText("1");
  });

  test("both rates are shown, and they are the owner-set 20 and 5", async ({ page }) => {
    await openPortal(page, { portal: ENROLLED });
    await expect(page.locator("#ref-rates")).toContainText("20%");
    await expect(page.locator("#ref-rates")).toContainText("5%");
  });

  test("a read that fails paints no link and no counts", async ({ page }) => {
    await openPortal(page, { portal: { ok: false, error: "boom" } });

    await expect(page.locator("#ref-err")).toBeVisible();
    await expect(page.locator("#ref-have")).toBeHidden();
    await expect(page.locator("#ref-join")).toBeHidden();
    // The one thing that must never happen: a number about somebody's money
    // that came from a read which did not answer.
    await expect(page.locator("#ref-stats")).toBeHidden();
  });

  test("a refused press leaves the button usable and says so", async ({ page }) => {
    await openPortal(page, {
      portal: NOT_ENROLLED,
      referResponse: { ok: false, error: "nope" },
      referStatus: 500
    });

    await page.locator("#ref-go").click();
    await expect(page.locator("#ref-err")).toBeVisible();
    await expect(page.locator("#ref-go")).toBeEnabled();
    await expect(page.locator("#ref-have")).toBeHidden();
  });

  test("enrolled but with no code is an error, not a blank link to copy", async ({ page }) => {
    await openPortal(page, {
      portal: { ...ENROLLED, affiliate: { ...ENROLLED.affiliate, shareUrl: null, code: null } }
    });

    await expect(page.locator("#ref-err")).toBeVisible();
    await expect(page.locator("#ref-have")).toBeHidden();
  });
});
