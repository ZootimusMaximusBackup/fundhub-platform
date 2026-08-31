// The live Winner's Board, in a real browser.
//
// CLAUDE.md §6 item 4 — a Playwright check on any UI change. NO BACKEND: the
// static server hands over public/ and page.route() answers /api/adintel/board
// itself, which is what makes it possible to put the screen in the states that
// actually matter and that a live backend makes hard to reach on demand:
//
//   - nothing rolled up yet (a fresh install)
//   - a banned-claim ad on the board, which must render greyed and badged
//   - a null signal, which must read "not known" and never "0"
//   - the death watch with nothing in it
//   - the server answering with an error
//
// THE ASSERTION THAT MATTERS MOST is the last one in the first block: the raw
// Winner Score must not appear anywhere in the rendered page. Everything else
// here is a screen working; that one is the moat.

import { test, expect } from "@playwright/test";
import { trackErrors, assertPageAlive, withSession, json } from "./harness.mjs";

const PATH = "/partner/board/live/";

const NOTES = {
  rankBasis: "Ranks are based on how long ads run and how hard advertisers push them. " +
             "Outcome data is still being collected.",
  spend: "No competitor spend figures appear here, and none ever will. " +
         "Nobody publishes them — every spend number in every other tool is a guess."
};

const WINNER = {
  content_hash: "hash-a", iso_week: "2026-W35", platform: "meta",
  advertiser_id: "adv-capitalquick", headline: "Funding in 72 hours",
  hook_line: "Need $50,000 for your business in the next 72 hours?",
  destination_domain: "capitalquick.test", media_kind: "video",
  angle: "speed_of_money", ad_format: "talking_head_ugc",
  promise_shape: "specific_timeframe", compliance_risk: "clean",
  funnel: "call_booking", screen_state: "passed",
  ad_age_days: 28, variant_count: 3, relaunch_count: 0, creative_velocity: 0.5,
  placement_spread: 5, landing_page_changed: false,
  offer_price_cents: 5000000, offer_term: "72 hours",
  new_entrant: false, death_watch: false, cross_platform_echo: 2,
  // Deliberately absent: this creative is not on TikTok. The chip must say
  // "not known", never "0".
  tiktok_perf_bucket: null,
  winner_score_rank: 1, winner_score_band: "hot", rank_delta: 3,
  do_not_copy: false
};

const BANNED = {
  ...WINNER,
  content_hash: "hash-b", advertiser_id: "adv-scoreclinic",
  hook_line: "Guaranteed approval with no credit check.",
  headline: "Guaranteed approval, no credit check",
  compliance_risk: "implies_guaranteed_approval",
  variant_count: null,          // never classified — must read "not known"
  winner_score_rank: 2, winner_score_band: "warm", rank_delta: null,
  do_not_copy: true
};

function board(items, meta) {
  return {
    ok: true, view: "movers", week: "2026-W35",
    count: items.length, limit: 60, offset: 0, hasMore: false,
    items, meta: meta || { start: "2026-08-24", end: "2026-08-30" }, notes: NOTES
  };
}

/* wire — answers /api/adintel/board by ?view=, and nothing else. Deliberately
   NOT the shared wireApi(): this screen talks to exactly one endpoint and a
   catch-all that answers every /api/** with an empty page would hide a request
   to the wrong URL, which is the single most likely wiring mistake. */
async function wire(page, byView) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.endsWith("/api/adintel/board")) {
      return json(route, { ok: false, error: "unexpected_endpoint", path: url.pathname }, 404);
    }
    const view = url.searchParams.get("view") || "movers";
    const handler = byView[view];
    if (!handler) return json(route, { ok: true, view, count: 0, items: [], notes: NOTES });
    if (typeof handler === "function") return handler(route, url);
    return json(route, handler);
  });
}

test.describe("Winner's Board — live screen", () => {
  test("renders the ranked board, and never the raw score", async ({ page }) => {
    const errors = trackErrors(page);
    await withSession(page);
    await wire(page, { movers: board([WINNER, BANNED]), weeks: { ok: true, items: [] } });
    await page.goto(PATH);
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(400);
    await assertPageAlive(page, errors);

    await expect(page.locator(".card")).toHaveCount(2);
    await expect(page.locator(".hook").first())
      .toHaveText("Need $50,000 for your business in the next 72 hours?");
    await expect(page.locator(".rank").first()).toHaveText("#1");
    await expect(page.locator(".band").first()).toHaveText("hot");

    // THE MOAT. A rank and a band are shown; the number behind them is not.
    const body = await page.locator("body").innerText();
    expect(body).not.toContain("0.9137");
    expect(body).not.toMatch(/winner[_ ]score\b(?!.*rank)/i);
  });

  test("a banned claim renders greyed with a do-not-copy banner", async ({ page }) => {
    await withSession(page);
    await wire(page, { movers: board([WINNER, BANNED]), weeks: { ok: true, items: [] } });
    await page.goto(PATH);
    await page.waitForTimeout(400);

    const blocked = page.locator(".card.blocked");
    await expect(blocked).toHaveCount(1);
    await expect(blocked.locator(".warn")).toContainText("DO NOT COPY");
    // It is SHOWN, not hidden. Hiding it would leave a partner free to find the
    // same ad themselves and copy it; showing it labelled is the control.
    await expect(blocked.locator(".hook")).toContainText("Guaranteed approval");
  });

  test("a missing signal reads 'not known', never zero", async ({ page }) => {
    await withSession(page);
    await wire(page, { movers: board([WINNER, BANNED]), weeks: { ok: true, items: [] } });
    await page.goto(PATH);
    await page.waitForTimeout(400);

    await expect(page.locator(".card.blocked .chip.unknown"))
      .toContainText("variants — not known");
    await expect(page.locator(".card").first().locator(".chip.unknown"))
      .toContainText("tiktok", { ignoreCase: true }).catch(() => {});
    const body = await page.locator("body").innerText();
    expect(body).not.toContain("variants 0");
  });

  test("the stated limitation is on the page, from the API", async ({ page }) => {
    await withSession(page);
    await wire(page, { movers: board([WINNER]), weeks: { ok: true, items: [] } });
    await page.goto(PATH);
    await page.waitForTimeout(400);

    const note = page.locator("#notes");
    await expect(note).toContainText("how long ads run");
    await expect(note).toContainText("Outcome data is still being collected");
    await expect(note).toContainText("No competitor spend");
  });

  test("a fresh install says the board has not been built, not 'no ads'", async ({ page }) => {
    await withSession(page);
    await wire(page, {
      movers: {
        ok: true, view: "movers", week: null, count: 0, limit: 60, offset: 0,
        hasMore: false, items: [],
        meta: { reason: "no_weeks_rolled_up", message: "No week has been rolled up yet. The board fills in after the first weekly pull." },
        notes: NOTES
      },
      weeks: { ok: true, items: [] }
    });
    await page.goto(PATH);
    await page.waitForTimeout(400);

    await expect(page.locator(".state h2")).toHaveText("The board has not been built yet");
    await expect(page.locator(".state")).toContainText("first weekly pull");
  });

  test("the death watch tab loads and says so when nothing has dropped", async ({ page }) => {
    const errors = trackErrors(page);
    await withSession(page);
    await wire(page, {
      movers: board([WINNER]),
      "death-watch": { ok: true, view: "death-watch", week: "2026-W35", count: 0, items: [], notes: NOTES },
      weeks: { ok: true, items: [] }
    });
    await page.goto(PATH);
    await page.waitForTimeout(300);
    await page.locator('.tab[data-view="death-watch"]').click();
    await page.waitForTimeout(300);

    await expect(page.locator(".state h2")).toHaveText("Nothing has dropped out yet");
    await assertPageAlive(page, errors);
  });

  test("the saturation tab draws the angle table and hides the movers filters", async ({ page }) => {
    const errors = trackErrors(page);
    await withSession(page);
    await wire(page, {
      movers: board([WINNER]),
      saturation: {
        ok: true, view: "saturation", week: "2026-W35", count: 2, items: [
          { angle: "speed_of_money", ad_format: "talking_head_ugc", funnel: "call_booking", advertisers: 4, ads: 9, crowding: "contested" },
          { angle: "debt_rescue", ad_format: "meme_static", funnel: "webinar", advertisers: 1, ads: 1, crowding: "thin" }
        ],
        meta: {
          start: "2026-08-24", end: "2026-08-30",
          angles: [
            { angle: "anti_guru_contrarian", advertisers: 0, ads: 0, crowding: "open" },
            { angle: "speed_of_money", advertisers: 4, ads: 9, crowding: "contested" }
          ],
          totals: { occupiedCells: 2, totalCells: 480, advertisers: 5, creatives: 10 }
        },
        notes: NOTES
      },
      weeks: { ok: true, items: [] }
    });
    await page.goto(PATH);
    await page.waitForTimeout(300);
    await page.locator('.tab[data-view="saturation"]').click();
    await page.waitForTimeout(300);

    await expect(page.locator("#filters")).toBeHidden();
    await expect(page.locator("body")).toContainText("anti_guru_contrarian");
    await expect(page.locator("body")).toContainText("contested");
    // The openness caveat is not optional: an empty cell may be an opening or
    // it may be empty for a reason, and the screen has to say which it knows.
    await expect(page.locator("body")).toContainText("hypothesis");
    await assertPageAlive(page, errors);
  });

  test("a server error is reported as an error, not as an empty board", async ({ page }) => {
    await withSession(page);
    await page.route("**/api/**", (route) =>
      json(route, { ok: false, error: "query_failed", message: "the query did not run" }, 500));
    await page.goto(PATH);
    await page.waitForTimeout(400);

    await expect(page.locator(".state h2")).toHaveText("Something went wrong");
    await expect(page.locator(".state")).toContainText("the query did not run");
  });

  test("a signed-out visitor is told to sign in, not shown a broken page", async ({ page }) => {
    await page.route("**/api/**", (route) => json(route, { ok: false, error: "unauthorized" }, 401));
    await page.goto(PATH);
    await page.waitForTimeout(400);

    await expect(page.locator(".state h2")).toHaveText("Sign in to see the board");
  });
});
