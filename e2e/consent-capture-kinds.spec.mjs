// The consent screen has to be able to ASK for the two consents the CSM role
// exists to collect, and it has to keep failing closed on anything it does not
// recognise.
//
// Before 2026-09-05 the page's ALLOWED_KINDS map held two entries. A link
// carrying ?kind=call_recording did not error — it silently fell back to
// soft_pull_consent, so a staff member following a link to record permission
// for a call would have been shown a credit-pull authorization instead and
// filed the client's answer under the wrong permission. That is the failure
// this file exists to catch, and it is invisible on the screen: both look like
// a consent form.
//
// Watching the request is the honest check. Rendering proves the page drew
// something; the outbound `kind` proves it decided which permission it is
// collecting.
//
// No login and no database: the static server serves public/, and every /api/
// call is fulfilled here.

import { test, expect } from "@playwright/test";

const CLIENT = "ac1ac964-e02b-468b-9cbe-7030e03dd13b";

/* Every `kind` the page sends to the server while loading. */
async function kindsAsked(page, kindParam) {
  const asked = [];
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    const m = /[?&]kind=([^&]+)/.exec(url);
    if (m) asked.push(decodeURIComponent(m[1]));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, kind: m ? decodeURIComponent(m[1]) : null,
                             disclosure: null, status: null, history: [] })
    });
  });
  const q = kindParam === null ? "" : `&kind=${encodeURIComponent(kindParam)}`;
  await page.goto(`/app/consent-capture.html?client_id=${CLIENT}${q}`);
  await page.waitForTimeout(1200);
  return asked;
}

for (const kind of ["call_recording", "marketing_use"]) {
  test(`the screen asks for ${kind}, instead of silently falling back`, async ({ page }) => {
    const asked = await kindsAsked(page, kind);
    expect(asked.length, `the page made no /api/ call carrying a kind`).toBeGreaterThan(0);
    expect(asked, `the page asked for ${JSON.stringify(asked)} — a fallback here files the client's answer under the wrong permission`)
      .toContain(kind);
    expect(asked).not.toContain("soft_pull_consent");
  });
}

test("the two are asked separately — one visit never carries both", async ({ page }) => {
  // Agreeing to be recorded is not agreeing to be advertised. If one visit
  // could carry both, a single tick would grant both and the second consent
  // becomes unaskable, which is the whole reason 291 added two kinds.
  const asked = await kindsAsked(page, "call_recording");
  expect(asked).not.toContain("marketing_use");
});

test("an unrecognised kind still falls back to the credit-pull form", async ({ page }) => {
  // The fallback is correct behaviour and must survive: a typo in a link must
  // land on a real consent form, never on a blank or broken screen.
  const asked = await kindsAsked(page, "vibes");
  expect(asked).toContain("soft_pull_consent");
  expect(asked).not.toContain("vibes");
});

test("no kind in the address is still the credit-pull form", async ({ page }) => {
  const asked = await kindsAsked(page, null);
  expect(asked).toContain("soft_pull_consent");
});
