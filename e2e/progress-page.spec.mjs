// The client progress page (/progress.html) and the portal link that reaches it.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY THIS FILE EXISTS IN THIS SHAPE.
//
// An earlier version of this spec asserted toBeVisible() on the portal link and
// grepped the markup for href="/progress.html". Both passed. The link was dead:
// public/app/shell.js called preventDefault() on every click, so the browser
// never went anywhere. A visibility assertion cannot see that, and a string
// grep cannot either.
//
// So the first test here CLICKS the link and reads the address bar afterwards.
// Nothing weaker counts as proof that a link works.
//
// The rest of the file drives the states that are easy to get wrong and
// impossible to eyeball: a timeline row whose text ALREADY carries a date, a
// round 4 on a cancelled file, a round 4 on a file that is on hold, a read that
// fails, and a checkout URL that is not a URL we will follow.
// ═══════════════════════════════════════════════════════════════════════════

import { test, expect } from "@playwright/test";
import { CLIENT_ID, json } from "./harness.mjs";

const CLIENT_SESSION = {
  ok: true,
  staff: {
    id: CLIENT_ID, name: "Dana Whitfield", email: "dana@example.com",
    role: "client", org_id: "org-1", status: "active"
  }
};

/* THE TIMELINE TEXT IS THE REAL SHAPE, NOT A FIXTURE SOMEBODY INVENTED.
   src/repair/lens.mjs:206 timelineLine() returns `${when} · ${words}` with
   `when` formatted in America/Los_Angeles, and src/progress/timeline.mjs
   progressLine() calls it with the approved words. An event stored at
   2026-03-04T00:00:00Z therefore arrives as at="2026-03-04T00:00:00.000Z" and
   text="Mar 3 · letters mailed to all three bureaus" — the endpoint lane
   recorded watching exactly that pair in its own live payload
   (contract-deviations.md, "KNOWN DRIFT IN AN EXISTING SHARED FUNCTION").
   The one-day disagreement is the point of the test. */
const TIMELINE_AT = "2026-03-04T00:00:00.000Z";
const TIMELINE_TEXT = "Mar 3 · letters mailed to all three bureaus";

function payload(over = {}) {
  return {
    ok: true,
    stage: {
      key: "in_transit", roundCurrent: 2, roundCap: 6,
      enteredAt: "2026-03-03T00:00:00Z",
      expectedResponseBy: "2026-04-02T00:00:00Z",
      waitingOn: "bureaus"
    },
    scores: {
      personal: [
        { bureau: "experian", score: 651, pulledAt: "2026-03-01T00:00:00Z", reportDocumentId: null },
        { bureau: "equifax", score: 648, pulledAt: "2026-03-01T00:00:00Z", reportDocumentId: null },
        { bureau: "transunion", score: null, pulledAt: null, reportDocumentId: null }
      ],
      business: []
    },
    movement: {
      middleScoreNow: null, middleScoreBaseline: null, baselineAt: null,
      itemsRemoved: 2, itemsDisputed: 7, series: []
    },
    waypoints: [],
    nextStep: null,
    timeline: [{ at: TIMELINE_AT, text: TIMELINE_TEXT }],
    deliverables: [],
    paidServices: [],
    referral: { enrolled: false, shareUrl: null, code: null },
    ...over
  };
}

/* The four lists — payments, documents, activity, messages — live in a closed
   <details> drawer ("Account & history"), and the Activity tab inside it is not
   the open one. Both have to be opened before the pane has any rendered text:
   innerText() on a hidden element returns "". This is what a client does too. */
async function openActivityTab(page) {
  await page.locator("#acct").evaluate((el) => { el.open = true; });
  await page.locator('button.tab[data-tab="act"]').click();
  await page.waitForTimeout(200);
}

/** Open /progress.html with a client token and one canned progress reply. */
async function openProgress(page, body, { status = 200, extra } = {}) {
  await page.addInitScript(() => {
    localStorage.setItem("fh_token", "e2e-client-token");
  });
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    if (extra) {
      const handled = await extra(route, url);
      if (handled) return;
    }
    if (url.includes("/api/read/client-progress")) return json(route, body, status);
    return json(route, { ok: true });
  });
  await page.goto("/progress.html");
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(400);
}

/* ═══════════════════════════════════════════════════════════════════════════
   1. THE LINK. Clicked, not looked at.
   ═════════════════════════════════════════════════════════════════════════ */

test("the portal link actually navigates to the progress page", async ({ page }) => {
  await page.addInitScript((s) => {
    localStorage.setItem("fh_token", "e2e-token");
    localStorage.setItem("fh_role", s.staff.role);
    localStorage.removeItem("fh_demo");
  }, CLIENT_SESSION);

  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/api/auth/session")) return json(route, CLIENT_SESSION);
    if (url.includes("/api/read/client-progress")) return json(route, payload());
    return json(route, { ok: true });
  });

  await page.goto(`/app/client-portal.html?id=${CLIENT_ID}`);
  await page.waitForLoadState("domcontentloaded");
  // shell.js gates links twice — once on the cached role hint, once on the real
  // session. Wait for the second pass before clicking, because the second pass
  // is the one that used to hide the card.
  await page.waitForTimeout(1200);

  const link = page.locator('#prog-link a[href="/progress.html"]');
  await expect(link).toBeVisible();

  const before = page.url();
  await link.click();
  await page.waitForURL("**/progress.html", { timeout: 5000 });
  const after = page.url();

  // eslint-disable-next-line no-console
  console.log("URL BEFORE >>>", before, "\nURL AFTER  >>>", after);
  expect(after).toContain("/progress.html");
  expect(after).not.toBe(before);
});

test("the link is reachable by a client who has no funding entitlement", async ({ page }) => {
  /* body ships with class="no-funding" and only gains funding after the
     entitlements read says so. The link used to live inside a .funding-only
     card, so a repair-only client — the people this page is mostly for — never
     saw it. Nothing here grants funding; the default body classes stand. */
  await page.addInitScript((s) => {
    localStorage.setItem("fh_token", "e2e-token");
    localStorage.setItem("fh_role", s.staff.role);
  }, CLIENT_SESSION);
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/api/auth/session")) return json(route, CLIENT_SESSION);
    if (url.includes("entitlement")) return json(route, { ok: true, items: [] });
    return json(route, { ok: true });
  });
  await page.goto(`/app/client-portal.html?id=${CLIENT_ID}`);
  await page.waitForTimeout(1000);

  await expect(page.locator("body")).toHaveClass(/no-funding/);
  await expect(page.locator(".funding-only.prog-card")).toBeHidden();
  await expect(page.locator('#prog-link a[href="/progress.html"]')).toBeVisible();
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. ONE DATE PER TIMELINE ROW.
   ═════════════════════════════════════════════════════════════════════════ */

/* Counts things that look like a date in one rendered row. Both formats this
   pair of screens can produce are covered: "3 March 2026" / "3 Mar" from the
   renderers, and "Mar 3" from timelineLine()'s own prefix. */
const DATEISH = /\b(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2})/gi;

test("a timeline row on the progress page prints exactly one date", async ({ page }) => {
  await openProgress(page, payload());

  const row = page.locator("#cTimeline .ev").first();
  await expect(row).toBeVisible();
  const rendered = (await row.innerText()).replace(/\s+/g, " ").trim();

  // eslint-disable-next-line no-console
  console.log("SERVER TEXT     >>>", TIMELINE_TEXT);
  // eslint-disable-next-line no-console
  console.log("RENDERED ROW    >>>", rendered);

  const found = rendered.match(DATEISH) || [];
  // eslint-disable-next-line no-console
  console.log("DATES IN ROW    >>>", JSON.stringify(found));

  expect(found.length).toBe(1);
  // `at` owns it: 2026-03-04T00:00:00Z is 4 March in UTC.
  expect(rendered).toContain("4 March 2026");
  expect(rendered).toContain("letters mailed to all three bureaus");
  // The Los-Angeles prefix the server put on the words is gone.
  expect(rendered).not.toContain("Mar 3");
});

test("a timeline row with no usable date keeps the words the server sent", async ({ page }) => {
  await openProgress(page, payload({
    timeline: [{ at: null, text: "Mar 3 · letters mailed to all three bureaus" }]
  }));
  const rendered = (await page.locator("#cTimeline .ev").first().innerText())
    .replace(/\s+/g, " ").trim();
  // eslint-disable-next-line no-console
  console.log("NO-AT ROW       >>>", rendered);
  const found = rendered.match(DATEISH) || [];
  expect(found.length).toBe(1);
  expect(rendered).toContain("Mar 3");
});

test("a timeline row whose text carries no date still shows the date from `at`", async ({ page }) => {
  await openProgress(page, payload({
    timeline: [{ at: TIMELINE_AT, text: "letters mailed to all three bureaus" }]
  }));
  const rendered = (await page.locator("#cTimeline .ev").first().innerText())
    .replace(/\s+/g, " ").trim();
  // eslint-disable-next-line no-console
  console.log("NO-PREFIX ROW   >>>", rendered);
  expect((rendered.match(DATEISH) || []).length).toBe(1);
  expect(rendered).toContain("4 March 2026");
});

test("the portal Activity tab prints exactly one date per row too", async ({ page }) => {
  await page.addInitScript((s) => {
    localStorage.setItem("fh_token", "e2e-token");
    localStorage.setItem("fh_role", s.staff.role);
  }, CLIENT_SESSION);
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/api/auth/session")) return json(route, CLIENT_SESSION);
    if (url.includes("/api/read/client-progress")) return json(route, payload());
    return json(route, { ok: true });
  });
  await page.goto(`/app/client-portal.html?id=${CLIENT_ID}`);
  await page.waitForTimeout(1000);

  await openActivityTab(page);
  const row = page.locator("#tp-act .timeline-item").first();
  const rendered = (await row.innerText()).replace(/\s+/g, " ").trim();
  // eslint-disable-next-line no-console
  console.log("PORTAL ACT ROW  >>>", rendered);
  expect((rendered.match(DATEISH) || []).length).toBe(1);
  expect(rendered).toContain("4 Mar");
  expect(rendered).not.toContain("Mar 3");
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. ROUNDS 4 AND 5 NEVER READ AS FILED, AND NEVER IMPLY WORK THAT STOPPED.
   ═════════════════════════════════════════════════════════════════════════ */

/* The claims that may never be made. "accepted" and "on record" are NOT in
   this list as bare words, because the honest sentence itself contains them in
   a negation — "we do not report them as received or accepted by anyone". What
   is forbidden is the affirmative form, so the patterns are anchored on the
   verb that would make it a claim. */
const FORBIDDEN = [
  /\bfiled\b/i,
  /\blodged\b/i,
  /\b(?:has|have|was|were|is|are)\s+(?:been\s+)?accepted\b/i,
  /\bon record\b/i
];

async function stageText(page, key) {
  await openProgress(page, payload({
    stage: {
      key, roundCurrent: 4, roundCap: 6,
      enteredAt: "2026-03-03T00:00:00Z", expectedResponseBy: null, waitingOn: null
    }
  }));
  return (await page.locator("#cStage").innerText()).replace(/\s+/g, " ").trim();
}

test("round 4 on a cancelled file does not say work is being prepared", async ({ page }) => {
  const text = await stageText(page, "cancelled");
  // eslint-disable-next-line no-console
  console.log("ROUND 4 · CANCELLED >>>", text);
  expect(text).toContain("This programme was cancelled");
  expect(text).toContain("none are being prepared or sent right now");
  expect(text).not.toContain("We prepare them and send them for you");
  for (const bad of FORBIDDEN) expect(text).not.toMatch(bad);
});

test("round 4 on a file that is on hold does not say work is being prepared", async ({ page }) => {
  const text = await stageText(page, "on_hold");
  // eslint-disable-next-line no-console
  console.log("ROUND 4 · ON HOLD   >>>", text);
  expect(text).toContain("Your file is on hold");
  expect(text).toContain("none are being prepared or sent right now");
  expect(text).not.toContain("We prepare them and send them for you");
  for (const bad of FORBIDDEN) expect(text).not.toMatch(bad);
});

test("round 4 on a live file says what we do, and never that anything was filed", async ({ page }) => {
  const text = await stageText(page, "in_transit");
  // eslint-disable-next-line no-console
  console.log("ROUND 4 · IN TRANSIT >>>", text);
  expect(text).toContain("We prepare them and send them for you");
  for (const bad of FORBIDDEN) expect(text).not.toMatch(bad);
});

test("no green tick, chip or badge claims a round 4 pack is prepared", async ({ page }) => {
  for (const key of ["cancelled", "on_hold", "stalled", "intake", "awaiting_documents"]) {
    const text = await stageText(page, key);
    expect(text.toLowerCase()).not.toContain("prepared —");
    expect(text).not.toMatch(/\bPREPARED\b/);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. A FAILED READ SAYS THE READ FAILED.
   ═════════════════════════════════════════════════════════════════════════ */

test("the progress page says it could not load rather than showing a blank file", async ({ page }) => {
  await openProgress(page, { ok: false, error: "server_error" }, { status: 500 });
  const fatal = page.locator("#fatal");
  await expect(fatal).toBeVisible();
  await expect(page.locator("#main")).toBeHidden();
  // eslint-disable-next-line no-console
  console.log("FAILED READ     >>>", (await fatal.innerText()).replace(/\s+/g, " ").trim());
  await expect(fatal).toContainText("could not load your file");
});

test("the endpoint not being routed yet reads as not-connected, not as an empty file", async ({ page }) => {
  await openProgress(page, { ok: false, error: "not_found" }, { status: 404 });
  const fatal = page.locator("#fatal");
  await expect(fatal).toBeVisible();
  await expect(fatal).toContainText("nearly ready");
  await expect(fatal).not.toContainText("Nothing has happened");
});

test("the portal Activity tab says the read failed instead of 'no activity yet'", async ({ page }) => {
  await page.addInitScript((s) => {
    localStorage.setItem("fh_token", "e2e-token");
    localStorage.setItem("fh_role", s.staff.role);
  }, CLIENT_SESSION);
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/api/auth/session")) return json(route, CLIENT_SESSION);
    if (url.includes("/api/read/client-progress")) {
      return json(route, { ok: false, error: "not_found" }, 404);
    }
    return json(route, { ok: true });
  });
  await page.goto(`/app/client-portal.html?id=${CLIENT_ID}`);
  await page.waitForTimeout(1000);

  /* The Activity pane is a tab that is not the open one, so innerText() reads
     "" on a hidden element. Open the tab first — which is also what a client
     does — then read what is really painted in it. */
  await openActivityTab(page);
  const pane = page.locator("#tp-act");
  const text = (await pane.innerText()).replace(/\s+/g, " ").trim();
  // eslint-disable-next-line no-console
  console.log("ACT TAB ON 404  >>>", text);
  expect(text).toContain("could not load your activity");
  expect(text).not.toContain("No activity recorded on this file yet");
});

test("an answered but empty timeline keeps the honest 'nothing yet' sentence", async ({ page }) => {
  await page.addInitScript((s) => {
    localStorage.setItem("fh_token", "e2e-token");
    localStorage.setItem("fh_role", s.staff.role);
  }, CLIENT_SESSION);
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/api/auth/session")) return json(route, CLIENT_SESSION);
    if (url.includes("/api/read/client-progress")) return json(route, payload({ timeline: [] }));
    return json(route, { ok: true });
  });
  await page.goto(`/app/client-portal.html?id=${CLIENT_ID}`);
  await page.waitForTimeout(1000);
  await openActivityTab(page);
  await expect(page.locator("#tp-act")).toContainText("No activity recorded on this file yet");
});

/* ═══════════════════════════════════════════════════════════════════════════
   5. A URL FROM THE API IS NOT FOLLOWED UNLESS IT IS http(s).
   ═════════════════════════════════════════════════════════════════════════ */

test("a javascript: checkout link is refused instead of being opened", async ({ page }) => {
  const posts = [];
  await openProgress(page, payload({
    paidServices: [{
      serviceKey: "paid_round", available: true, inFlight: false,
      components: [
        { key: "round_base", label: "Three bureaus", priceCents: 10000, required: true }
      ]
    }]
  }), {
    extra: async (route, url) => {
      if (url.includes("/api/paid-services") && route.request().method() === "POST") {
        posts.push(url);
        await json(route, { ok: true, checkout_url: "javascript:window.__pwned=1" });
        return true;
      }
      return false;
    }
  });

  await page.locator("#paidGo").click();
  await page.getByRole("button", { name: "Yes, continue" }).click();
  await page.getByRole("button", { name: "Take me to payment" }).click();
  await page.waitForTimeout(400);

  const dlg = page.locator("#dlg");
  const text = (await dlg.innerText()).replace(/\s+/g, " ").trim();
  // eslint-disable-next-line no-console
  console.log("BAD CHECKOUT URL >>>", text);
  expect(posts.length).toBe(1);
  expect(text).toContain("not ready yet");
  expect(await page.locator("#dlgA a").count()).toBe(0);
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
});

test("a second paid round is refused after the first request is accepted", async ({ page }) => {
  const posts = [];
  await openProgress(page, payload({
    paidServices: [{
      serviceKey: "paid_round", available: true, inFlight: false,
      components: [
        { key: "round_base", label: "Three bureaus", priceCents: 10000, required: true }
      ]
    }]
  }), {
    extra: async (route, url) => {
      if (url.includes("/api/paid-services") && route.request().method() === "POST") {
        posts.push(url);
        await json(route, { ok: true });   // accepted, link not minted yet
        return true;
      }
      return false;
    }
  });

  const press = async () => {
    await page.locator("#paidGo").click();
    await page.getByRole("button", { name: "Yes, continue" }).click();
    await page.getByRole("button", { name: "Take me to payment" }).click();
    await page.waitForTimeout(300);
  };

  await press();
  expect(posts.length).toBe(1);
  await page.getByRole("button", { name: "Close" }).click();
  await page.waitForTimeout(200);

  await page.locator("#paidGo").click();
  await page.waitForTimeout(300);
  const text = (await page.locator("#dlg").innerText()).replace(/\s+/g, " ").trim();
  // eslint-disable-next-line no-console
  console.log("SECOND PRESS     >>>", text);
  expect(text).toContain("already have one in progress");
  expect(posts.length).toBe(1);
});

test("a round already in flight when the page loads renders no buy button", async ({ page }) => {
  await openProgress(page, payload({
    paidServices: [{
      serviceKey: "paid_round", available: true, inFlight: true,
      components: [
        { key: "round_base", label: "Three bureaus", priceCents: 10000, required: true }
      ]
    }]
  }));
  await expect(page.locator("#cPaid")).toContainText("You already have one in progress");
  expect(await page.locator("#paidGo").count()).toBe(0);
});

/* ═══════════════════════════════════════════════════════════════════════════
   6. THE OWNER'S BANNED WORDS DO NOT REACH A CLIENT'S EYES.
   ═════════════════════════════════════════════════════════════════════════ */

test("neither client screen renders the words 'credit repair'", async ({ page }) => {
  await openProgress(page, payload());
  const progressText = await page.locator("body").innerText();
  expect(progressText.toLowerCase()).not.toContain("credit repair");

  await page.addInitScript((s) => {
    localStorage.setItem("fh_token", "e2e-token");
    localStorage.setItem("fh_role", s.staff.role);
  }, CLIENT_SESSION);
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/api/auth/session")) return json(route, CLIENT_SESSION);
    return json(route, { ok: true });
  });
  await page.goto(`/app/client-portal.html?id=${CLIENT_ID}`);
  await page.waitForTimeout(900);
  const portalText = await page.locator("body").innerText();
  // eslint-disable-next-line no-console
  console.log("PORTAL BANNED-WORD SCAN >>>",
    portalText.toLowerCase().includes("credit repair") ? "FOUND" : "clean");
  expect(portalText.toLowerCase()).not.toContain("credit repair");
});
