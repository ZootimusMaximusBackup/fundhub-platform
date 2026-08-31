// Layers 1 and 2, end to end, against a real database.
//
// Skipped without DATABASE_URL.
//
// WHAT THIS PROVES THAT THE UNIT TESTS CANNOT. The unit tests check arithmetic
// against arrays somebody wrote down. This one runs the actual product path:
//
//   the fixture vendor  →  ad_library_records (append-only, idempotent)
//                       →  ad_creatives_seen (deduped)
//                       →  ad_creative_classification (fake model reply)
//                       →  ad_creative_signals (ten signals + Winner Score)
//                       →  the board queries, through the wall
//
// The fixture is a recorded five-week history, so the sequence signals — ad age,
// re-launch, death watch, new entrant, cross-platform echo — have real data to
// be computed from rather than a single snapshot.
//
// THE ISOLATION ASSERTIONS ARE THE POINT OF THE LAST BLOCK. These tables carry
// a different row-lock shape from every other table in the Creative Factory:
// shared read, staff-only write. Both halves are asserted, because a lock that
// is wrong in the permissive direction leaks the competitor pile's write path
// to partners, and a lock that is wrong in the restrictive direction makes the
// board render as an empty table with no error anywhere.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { asStaff as _asStaff, asPartner as _asPartner } from "../partners/rls.mjs";
import { rlsPool, rlsIsReal, closeRlsPool } from "../testing/rls-pool.mjs";
import { pullPlatform, pullAll, watchListFor, markDormant } from "./ingest.mjs";
import { pendingCreatives } from "./classify.mjs";
import { computeWeek, saturationForWeek } from "./weekly.mjs";
import { feedForWeek, deathWatchForWeek, newEntrantsForWeek, saturationForBoard, weeksAvailable }
  from "./board.mjs";
import { TAXONOMY_VERSION } from "./taxonomy.mjs";

const asStaff = (fn, deps) => _asStaff(fn, { pool: rlsPool, ...(deps || {}) });
const asPartner = (partnerId, fn, deps) => _asPartner(partnerId, fn, { pool: rlsPool, ...(deps || {}) });

const HAVE_DB = !!process.env.DATABASE_URL;
const SLUG = "adintel-test-";

/* Fixed weeks, so the arithmetic below is a statement about the code and not
   about the day the suite happens to run.

   W31-W35 are the weeks the recorded fixture actually contains observations
   for. W36 and W37 are rolled up as well and have NO new observations, which is
   the point: the death watch only fires two weeks after a leader stops, so a
   run that ends on the last week with data can never see the signal the board
   is sold on. Rolling forward past the data is what a real Monday morning does
   anyway — the world does not stop producing weeks when a competitor stops
   producing ads. */
const WEEKS = ["2026-W31", "2026-W32", "2026-W33", "2026-W34", "2026-W35",
               "2026-W36", "2026-W37"];
const LIVE_WEEK = "2026-W35";   // the last week with observations in it
const QUIET_WEEK = "2026-W37";  // two weeks after everything went dark

/* A deterministic stand-in for the model. Each creative gets an angle derived
   from its own text, so the classification is stable across runs and the
   saturation map has more than one cell in it. No network, no key, no cost. */
function fakeClassify(rows) {
  return rows.map((r) => {
    const body = `${r.headline || ""} ${r.body_text || ""}`.toLowerCase();
    const risk = /guaranteed approval|no credit check|remove late payments/.test(body)
      ? "implies_guaranteed_approval"
      : "clean";
    const angle = /72 hours|9 days|days/.test(body) ? "speed_of_money"
      : /credit/.test(body) ? "approval_without_credit"
      : /course|guru|just fund/.test(body) ? "anti_guru_contrarian"
      : "business_growth";
    return {
      content_hash: r.content_hash,
      angle,
      ad_format: r.media_kind === "image" ? "text_on_image" : "talking_head_ugc",
      promise_shape: /\$/.test(body) ? "specific_dollar" : "curiosity_no_promise",
      compliance_risk: risk,
      funnel: /book|call/.test(body) ? "call_booking" : "direct_application",
      hook_line: (r.body_text || "").split(/(?<=[.?!])\s/)[0] || null
    };
  });
}

describe("ad intelligence — Layers 1 and 2", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, partner, stranger;

  before(async () => {
    org = (await db.query(`SELECT id FROM orgs WHERE is_default LIMIT 1`)).rows[0].id;
    await cleanup();
    partner = await makePartner("owner");
    stranger = await makePartner("stranger");

    await asStaff(async (tx) => {
      // A watch-list that covers three of the fixture's advertisers and marks
      // one of them as FundHub's own, so the wall has something to exclude.
      for (const [id, group] of [
        ["adv-capitalquick", "direct"],
        ["adv-scoreclinic", "adjacent"],
        ["adv-fundhub-own", "own"]
      ]) {
        await tx.query(
          `INSERT INTO ad_watch_advertisers
             (org_id, platform, external_advertiser_id, display_name, watch_group)
           VALUES ($1,'meta',$2,$3,$4)
           ON CONFLICT (org_id, platform, external_advertiser_id) DO NOTHING`,
          [org, id, `${SLUG}${id}`, group]);
      }

      // Layer 1: replay the whole recorded history in one pass. Each fixture row
      // carries its own observed_on, so this produces the five-week sequence.
      await pullAll(tx, { orgId: org, vendorKey: "fixture" });

      // Layer 2, classification half — a deterministic stand-in for the model.
      const pending = await pendingCreatives(tx, org, { limit: 500 });
      for (const c of fakeClassify(pending)) {
        await tx.query(
          `INSERT INTO ad_creative_classification
             (org_id, content_hash, taxonomy_version, angle, ad_format, promise_shape,
              compliance_risk, funnel, hook_line, model, screen_state)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'test-fixture','passed')
           ON CONFLICT DO NOTHING`,
          [org, c.content_hash, TAXONOMY_VERSION, c.angle, c.ad_format, c.promise_shape,
           c.compliance_risk, c.funnel, c.hook_line]);
      }

      // Layer 2, roll-up half — every week in order, because the death watch of
      // one week reads the ranking of the one before it.
      for (const week of WEEKS) await computeWeek(tx, { orgId: org, week });
    });
  });

  after(async () => { await cleanup(); await closeRlsPool(); await close(); });

  // ── LAYER 1 ───────────────────────────────────────────────────────────────

  describe("Layer 1 — rented observations", () => {
    test("the fixture pull writes the observation log", async () => {
      const { rows } = await asStaff((tx) => tx.query(
        `SELECT count(*)::int AS n FROM ad_library_records WHERE org_id = $1`, [org]));
      assert.ok(rows[0].n >= 20, `expected the recorded history, got ${rows[0].n} rows`);
    });

    test("re-running the same pull inserts nothing — the unique index is the idempotency key", async () => {
      const before = await countRecords();
      const run = await asStaff((tx) => pullPlatform(tx, { orgId: org, platform: "meta" }));
      const after = await countRecords();
      assert.equal(after, before, "a re-run duplicated observations");
      assert.equal(run.inserted, 0);
      assert.ok(run.duplicates > 0, "the re-run should report what it skipped, not hide it");
    });

    test("observations collapse to far fewer distinct creatives", async () => {
      // This collapse is the ~90% saving on the classification bill.
      const records = await countRecords();
      const { rows } = await asStaff((tx) => tx.query(
        `SELECT count(*)::int AS n FROM ad_creatives_seen WHERE org_id = $1`, [org]));
      assert.ok(rows[0].n < records, "dedup did nothing");
    });

    test("the deduped creative widens rather than narrows", async () => {
      // cq-1001 ran on five placements in the fixture and was observed five
      // times; the union must hold all five and the count must be the total.
      const { rows } = await asStaff((tx) => tx.query(
        `SELECT observation_count, jsonb_array_length(placements) AS placements
           FROM ad_creatives_seen
          WHERE org_id = $1 AND body_text LIKE 'Need $50,000%'`, [org]));
      assert.equal(rows.length, 1);
      assert.equal(rows[0].placements, 5);
      assert.ok(rows[0].observation_count >= 5);
    });

    test("an observation cannot be deleted", async () => {
      // Six of the ten signals are questions about the sequence. A delete would
      // silently un-answer them.
      await assert.rejects(
        asStaff((tx) => tx.query(
          `DELETE FROM ad_library_records WHERE org_id = $1 AND external_ad_id = 'cq-1001'`, [org])),
        /not deletable/);
    });

    test("the watch-list drives the pull, and an empty list means 'everything'", async () => {
      const list = await asStaff((tx) => watchListFor(tx, org, "meta"));
      assert.ok(list.includes("adv-capitalquick"));
      const none = await asStaff((tx) => watchListFor(tx, org, "google"));
      assert.equal(none, null, "an empty watch-list must mean 'pull everything', not 'pull nothing'");
    });

    test("a silent advertiser is marked dormant, never deleted", async () => {
      const before = await asStaff((tx) => tx.query(
        `SELECT count(*)::int AS n FROM ad_watch_advertisers WHERE org_id = $1`, [org]));
      const r = await asStaff((tx) => markDormant(tx, org, { days: 21, asOf: "2026-09-30" }));
      const after = await asStaff((tx) => tx.query(
        `SELECT count(*)::int AS n FROM ad_watch_advertisers WHERE org_id = $1`, [org]));
      assert.equal(after.rows[0].n, before.rows[0].n, "a dormant advertiser was deleted");
      assert.ok(r.markedDormant >= 1, "the never-observed 'own' advertiser should go dormant");
    });
  });

  // ── LAYER 2 ───────────────────────────────────────────────────────────────

  describe("Layer 2 — the signals and the score", () => {
    test("every creative gets a signals row for every week it was live", async () => {
      const { rows } = await asStaff((tx) => tx.query(
        `SELECT iso_week, count(*)::int AS n FROM ad_creative_signals
          WHERE org_id = $1 GROUP BY iso_week ORDER BY iso_week`, [org]));
      assert.equal(rows.length, WEEKS.length);
      assert.ok(rows.every((r) => r.n > 0));
    });

    test("the long-running creative accumulates real age", async () => {
      const { rows } = await asStaff((tx) => tx.query(
        `SELECT s.ad_age_days
           FROM ad_creative_signals s
           JOIN ad_creatives_seen c ON c.org_id = s.org_id AND c.content_hash = s.content_hash
          WHERE s.org_id = $1 AND s.iso_week = $2 AND c.body_text LIKE 'Need $50,000%'`,
        [org, LIVE_WEEK]));
      assert.equal(rows.length, 1);
      assert.equal(rows[0].ad_age_days, 28, "five weekly sightings is a 28-day span");
    });

    test("the re-launched creative is recorded as re-launched", async () => {
      const { rows } = await asStaff((tx) => tx.query(
        `SELECT s.relaunch_count
           FROM ad_creative_signals s
           JOIN ad_creatives_seen c ON c.org_id = s.org_id AND c.content_hash = s.content_hash
          WHERE s.org_id = $1 AND s.iso_week = $2 AND c.advertiser_id = 'adv-fundrocket'
            AND c.body_text LIKE 'Your revenue%'`, [org, LIVE_WEEK]));
      assert.equal(rows.length, 1);
      assert.equal(rows[0].relaunch_count, 1);
    });

    test("the landing-page change is detected, and a stable one is not", async () => {
      const { rows } = await asStaff((tx) => tx.query(
        `SELECT c.body_text, s.landing_page_changed
           FROM ad_creative_signals s
           JOIN ad_creatives_seen c ON c.org_id = s.org_id AND c.content_hash = s.content_hash
          WHERE s.org_id = $1 AND s.iso_week = $2
            AND (c.body_text LIKE 'We pulled%' OR c.body_text LIKE 'Need $50,000%')`,
        [org, LIVE_WEEK]));
      const moved = rows.find((r) => r.body_text.startsWith("We pulled"));
      const stable = rows.find((r) => r.body_text.startsWith("Need $50,000"));
      assert.equal(moved.landing_page_changed, true);
      assert.equal(stable.landing_page_changed, false);
    });

    test("a price in the copy becomes integer cents; copy with no price stays NULL", async () => {
      const { rows } = await asStaff((tx) => tx.query(
        `SELECT c.body_text, s.offer_price_cents
           FROM ad_creative_signals s
           JOIN ad_creatives_seen c ON c.org_id = s.org_id AND c.content_hash = s.content_hash
          WHERE s.org_id = $1 AND s.iso_week = $2`, [org, LIVE_WEEK]));
      const priced = rows.find((r) => r.body_text.startsWith("Need $50,000"));
      assert.equal(Number(priced.offer_price_cents), 5_000_000);
      const unpriced = rows.find((r) => r.body_text.startsWith("The 3 lenders"));
      assert.equal(unpriced.offer_price_cents, null, "no price must stay NULL, never 0");
    });

    test("the new entrant is flagged in the week it appears and not before", async () => {
      const { rows } = await asStaff((tx) => tx.query(
        `SELECT s.iso_week, s.new_entrant
           FROM ad_creative_signals s
           JOIN ad_creatives_seen c ON c.org_id = s.org_id AND c.content_hash = s.content_hash
          WHERE s.org_id = $1 AND c.advertiser_id = 'adv-newcomer'
          ORDER BY s.iso_week`, [org]));
      assert.ok(rows.length > 0, "the newcomer should have signals rows");
      // True in the week the advertiser first appeared, and false in the weeks
      // before it. It is deliberately NOT sticky — "new this week" stops being
      // true next week, and a flag that never clears is a flag nobody reads.
      const flagged = rows.filter((r) => r.new_entrant === true).map((r) => r.iso_week);
      assert.deepEqual(flagged, [LIVE_WEEK]);
    });

    test("the death watch fires for a former leader that went dark", async () => {
      // The leader of W36 stopped being observed on 30 August. By the end of
      // W37 that is 14 days of silence, which is the whole signal.
      const { rows } = await asStaff((tx) => tx.query(
        `SELECT count(*)::int AS n FROM ad_creative_signals
          WHERE org_id = $1 AND iso_week = $2 AND death_watch IS TRUE`, [org, QUIET_WEEK]));
      assert.ok(rows[0].n >= 1,
        "nothing was ever reported dead — the differentiating signal is not firing");
    });

    test("cross-platform echo sees the hook on more than one platform", async () => {
      const { rows } = await asStaff((tx) => tx.query(
        `SELECT max(cross_platform_echo) AS m FROM ad_creative_signals
          WHERE org_id = $1 AND iso_week = $2`, [org, LIVE_WEEK]));
      assert.ok(Number(rows[0].m) >= 2,
        "no creative echoed across platforms — the one signal no single-platform tool can compute");
    });

    test("ranks are contiguous within a week and the band is one of three", async () => {
      const { rows } = await asStaff((tx) => tx.query(
        `SELECT winner_score_rank, winner_score_band FROM ad_creative_signals
          WHERE org_id = $1 AND iso_week = $2 AND winner_score_rank IS NOT NULL
          ORDER BY winner_score_rank`, [org, LIVE_WEEK]));
      assert.ok(rows.length > 0);
      rows.forEach((r, i) => assert.equal(r.winner_score_rank, i + 1));
      assert.ok(rows.every((r) => ["hot", "warm", "cold"].includes(r.winner_score_band)));
    });

    test("recomputing a week is idempotent — one row per creative per week", async () => {
      const before = await asStaff((tx) => tx.query(
        `SELECT count(*)::int AS n FROM ad_creative_signals WHERE org_id = $1 AND iso_week = $2`,
        [org, LIVE_WEEK]));
      await asStaff((tx) => computeWeek(tx, { orgId: org, week: LIVE_WEEK }));
      const after = await asStaff((tx) => tx.query(
        `SELECT count(*)::int AS n FROM ad_creative_signals WHERE org_id = $1 AND iso_week = $2`,
        [org, LIVE_WEEK]));
      assert.equal(after.rows[0].n, before.rows[0].n);
    });

    test("the saturation map counts advertisers and finds open angles", async () => {
      const map = await asStaff((tx) => saturationForWeek(tx, { orgId: org, week: LIVE_WEEK }));
      assert.ok(map.cells.length > 0, "the grid is empty");
      assert.ok(map.angles.length >= 10, "every taxonomy angle must appear, including empty ones");
      assert.equal(map.angles[0].advertisers, 0, "the least contested angle should be first");
      assert.ok(map.totals.advertisers > 0);
    });
  });

  // ── THE BOARD, AND THE WALL ───────────────────────────────────────────────

  describe("the board read model", () => {
    test("the movers feed returns ranked rows a partner can read", async () => {
      const rows = await asPartner(partner, (tx) =>
        feedForWeek(tx, { orgId: org, week: LIVE_WEEK, limit: 50 }));
      assert.ok(rows.length > 0, "the board is empty for the partner who bought it");
      assert.ok(rows.every((r) => r.winner_score_rank), "every row must carry a rank");
    });

    test("the raw Winner Score never appears in a board row", async () => {
      const rows = await asPartner(partner, (tx) =>
        feedForWeek(tx, { orgId: org, week: LIVE_WEEK, limit: 50 }));
      const body = JSON.stringify(rows);
      assert.ok(!body.includes("winner_score\":"), "the raw score reached a partner-facing row");
      for (const r of rows) {
        assert.equal(r.winner_score, undefined);
        assert.equal(r.weights_version, undefined);
        assert.equal(r.raw, undefined);
      }
    });

    test("a banned claim is carried with a do-not-copy badge, not hidden", async () => {
      // Hiding it would leave a partner free to find the same ad themselves and
      // copy it. Showing it labelled is the control.
      const rows = await asPartner(partner, (tx) =>
        feedForWeek(tx, { orgId: org, week: LIVE_WEEK, limit: 100 }));
      const risky = rows.find((r) => r.do_not_copy);
      assert.ok(risky, "the fixture's banned-claim ad should reach the board, badged");
      assert.equal(risky.compliance_risk, "implies_guaranteed_approval");
    });

    test("the death-watch view returns what stopped, with the date it was last seen", async () => {
      const rows = await asPartner(partner, (tx) =>
        deathWatchForWeek(tx, { orgId: org, week: QUIET_WEEK, limit: 50 }));
      assert.ok(rows.length >= 1, "the differentiating view is empty");
      assert.ok(rows[0].last_observed_on, "a death watch without a date is not actionable");
    });

    test("new entrants are grouped by advertiser, not repeated per creative", async () => {
      const r = await asPartner(partner, (tx) =>
        newEntrantsForWeek(tx, { orgId: org, week: LIVE_WEEK }));
      const ids = r.entrants.map((e) => e.advertiser_id);
      assert.equal(new Set(ids).size, ids.length, "an advertiser was listed twice");
    });

    test("the partner-facing saturation map excludes FundHub's own advertisers", async () => {
      const map = await asPartner(partner, (tx) =>
        saturationForBoard(tx, { orgId: org, week: LIVE_WEEK }));
      const body = JSON.stringify(map);
      assert.ok(!body.includes("adv-fundhub-own"), "FundHub's own account reached a partner");
    });

    test("weeksAvailable lists the rolled-up weeks newest first", async () => {
      const weeks = await asPartner(partner, (tx) => weeksAvailable(tx, { orgId: org }));
      assert.ok(weeks.length >= WEEKS.length);
      assert.equal(weeks[0].iso_week, QUIET_WEEK);
    });
  });

  // ── THE ROW LOCK ──────────────────────────────────────────────────────────

  describe("the row lock — shared read, staff-only write", () => {
    test("a second partner sees the SAME board — this pile is shared, not owned", async () => {
      // The opposite of every other Creative Factory table, and deliberately so:
      // 100 partners each holding their own copy of the same 31,000 competitor
      // rows would make the saturation map meaningless.
      const mine = await asPartner(partner, (tx) =>
        feedForWeek(tx, { orgId: org, week: LIVE_WEEK, limit: 50 }));
      const theirs = await asPartner(stranger, (tx) =>
        feedForWeek(tx, { orgId: org, week: LIVE_WEEK, limit: 50 }));
      assert.ok(mine.length > 0 && theirs.length > 0);
      assert.deepEqual(
        theirs.map((r) => r.content_hash),
        mine.map((r) => r.content_hash));
    });

    /* THE WRITE ASSERTIONS ONLY MEAN SOMETHING THROUGH AN UNPRIVILEGED ROLE.
       The suite connects as the table owner so the fixtures can be built, and
       an owner bypasses every policy — see src/testing/rls-pool.mjs. Without
       APP_DATABASE_URL these skip, loudly, rather than reporting a pass on no
       evidence. */
    const WRITE_SKIP = rlsIsReal()
      ? false
      : "no APP_DATABASE_URL — an owner connection bypasses RLS, so a pass here would prove nothing";

    test("a partner cannot write to the competitor pile", { skip: WRITE_SKIP }, async () => {
      // The write policy is staff-only. Under RLS an unqualified INSERT is
      // refused outright rather than silently writing nothing.
      await assert.rejects(
        asPartner(partner, (tx) => tx.query(
          `INSERT INTO ad_watch_advertisers
             (org_id, platform, external_advertiser_id, display_name, watch_group)
           VALUES ($1,'meta','adv-injected','injected','direct')`, [org])),
        /policy|permission|denied/i,
        "a partner session was able to add to the watch-list");
    });

    test("a partner cannot rewrite a Winner Score", { skip: WRITE_SKIP }, async () => {
      const r = await asPartner(partner, (tx) => tx.query(
        `UPDATE ad_creative_signals SET winner_score_band = 'hot'
          WHERE org_id = $1 AND iso_week = $2`, [org, LIVE_WEEK]));
      assert.equal(r.rowCount, 0, "a partner rewrote the board's ranking");
    });

    test("no table in this module is locked shut against the application", async () => {
      // RLS on with zero policies denies everything to fundhub_app and looks
      // exactly like an empty table. That has happened three times in this repo.
      const { rows } = await asStaff((tx) => tx.query(`
        SELECT c.relname
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relname = ANY($1)
           AND c.relrowsecurity
           AND NOT EXISTS (SELECT 1 FROM pg_policies p
                            WHERE p.schemaname='public' AND p.tablename = c.relname)`,
        [["ad_watch_advertisers", "ad_library_records", "ad_creatives_seen",
          "ad_creative_classification", "ad_creative_signals"]]));
      assert.deepEqual(rows.map((r) => r.relname), []);
    });
  });

  // ── helpers ───────────────────────────────────────────────────────────────

  async function countRecords() {
    const { rows } = await asStaff((tx) => tx.query(
      `SELECT count(*)::int AS n FROM ad_library_records WHERE org_id = $1`, [org]));
    return rows[0].n;
  }

  async function makePartner(name) {
    const { rows } = await db.query(
      `INSERT INTO partners (org_id, name, slug, status, agreement_signed_at)
       VALUES ($1,$2,$3,'active',now()) RETURNING id`,
      [org, `${SLUG}${name}`, `${SLUG}${name}`]);
    return rows[0].id;
  }

  async function cleanup() {
    // ad_library_records refuses DELETE by design, so the append-only guard is
    // dropped for the duration of the truncate and put straight back. TRUNCATE
    // would also work but would take the whole table, and another org's rows
    // have no business being collateral in a test teardown.
    await db.query(`ALTER TABLE ad_library_records DISABLE TRIGGER trg_ad_library_records_no_delete`);
    try {
      await db.query(`DELETE FROM ad_creative_signals WHERE org_id = $1`, [org]);
      await db.query(`DELETE FROM ad_creative_classification WHERE org_id = $1`, [org]);
      await db.query(`DELETE FROM ad_creatives_seen WHERE org_id = $1`, [org]);
      await db.query(`DELETE FROM ad_library_records WHERE org_id = $1`, [org]);
      await db.query(`DELETE FROM ad_watch_advertisers WHERE org_id = $1 AND display_name LIKE $2`,
        [org, `${SLUG}%`]);
      await db.query(`DELETE FROM partners WHERE slug LIKE $1`, [`${SLUG}%`]);
    } finally {
      await db.query(`ALTER TABLE ad_library_records ENABLE TRIGGER trg_ad_library_records_no_delete`);
    }
  }
});
