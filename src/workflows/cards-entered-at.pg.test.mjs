// cards.entered_at is the "in stage" clock the board prints and the "over 3d"
// filter reads. Before migration 271 it was stamped once at insert and never
// touched again, so it reported the card's AGE — a card moved into Funded five
// minutes ago read "20d in stage", identical to one nobody had touched in
// twenty days.
//
// These tests hold the trigger to the four things that have to be true:
//   1. a real stage change resets the clock
//   2. a no-op move (same stage written again) does NOT
//   3. a card created long ago and moved just now reads as newly moved
//   4. the "over 3d in stage" filter selects genuinely stalled cards, not old ones
//
// Both production writers are covered: moveCardToStage (src/workflows/cards.mjs)
// and the raw UPDATE that api/public/partner-apply.mjs runs. That is the whole
// argument for the trigger — neither writer sets entered_at itself.
//
// One card per client: cards_client_pipeline_idx (db/schema/007_cards_unique.sql)
// is UNIQUE on (client_id, pipeline_id), so every fixture card gets its own
// client rather than piling onto one.
//
// SKIPS unless DATABASE_URL is set. It does NOT pass quietly.

import { test, before, after } from "node:test";
import assert from "node:assert";

import { db, close } from "../db.mjs";
import { moveCardToStage } from "./cards.mjs";
import { computeKpis } from "../dashboard/kpis.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const SLUG = "cards-entered-at-test";

let orgId = null;
let pipelineId = null;
const stageIds = {};

const STAGES = ["new_lead", "survey_complete", "booked"];

/** entered_at for a card, as a Date. */
async function enteredAt(cardId) {
  const r = await db.query(`SELECT entered_at FROM cards WHERE id = $1`, [cardId]);
  return new Date(r.rows[0].entered_at);
}

/** Minutes the board would print for this card, computed the way pipeline.html does. */
async function minutesInStage(cardId) {
  const at = await enteredAt(cardId);
  return Math.max(0, Math.round((Date.now() - at.getTime()) / 60000));
}

/**
 * A fresh client with one card on the sales pipeline, created `createdDaysAgo`
 * ago. created_at and entered_at both start at that moment, which is exactly
 * the shape every row in production has today.
 */
async function makeCard({ stage = "new_lead", createdDaysAgo = 0 } = {}) {
  const clientId = (await db.query(
    `INSERT INTO clients (org_id, first_name, last_name)
     VALUES ($1, 'Entered', 'At') RETURNING id`, [orgId])).rows[0].id;

  const cardId = (await db.query(
    `INSERT INTO cards (org_id, client_id, pipeline_id, stage_id, entered_at, created_at)
     VALUES ($1, $2, $3, $4, now() - ($5::int || ' days')::interval,
                             now() - ($5::int || ' days')::interval)
     RETURNING id`,
    [orgId, clientId, pipelineId, stageIds[stage], createdDaysAgo])).rows[0].id;

  return { cardId, clientId };
}

before(async () => {
  if (!HAS_DB) return;

  orgId = (await db.query(
    `INSERT INTO orgs (slug, name) VALUES ($1, 'Cards Entered At Test')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [SLUG])).rows[0].id;

  pipelineId = (await db.query(
    `INSERT INTO pipelines (org_id, key, name) VALUES ($1, 'sales', 'Entered At Sales')
     RETURNING id`, [orgId])).rows[0].id;

  for (let i = 0; i < STAGES.length; i++) {
    stageIds[STAGES[i]] = (await db.query(
      `INSERT INTO pipeline_stages (org_id, pipeline_id, key, name, sort_order)
       VALUES ($1, $2, $3, $3, $4) RETURNING id`,
      [orgId, pipelineId, STAGES[i], i])).rows[0].id;
  }
});

after(async () => {
  if (!HAS_DB) return;
  await db.query(`DELETE FROM cards WHERE org_id = $1`, [orgId]);
  await db.query(`DELETE FROM pipeline_stages WHERE pipeline_id = $1`, [pipelineId]);
  await db.query(`DELETE FROM pipelines WHERE id = $1`, [pipelineId]);
  await db.query(`DELETE FROM clients WHERE org_id = $1`, [orgId]);
  await db.query(`DELETE FROM orgs WHERE slug = $1`, [SLUG]);
  await close();
});

// ── 1. A real stage change resets the clock ────────────────────────────────

test("a stage change stamps entered_at with the moment of the move",
  { skip: !HAS_DB }, async () => {
    const { cardId } = await makeCard({ stage: "new_lead", createdDaysAgo: 12 });
    assert.ok(await minutesInStage(cardId) > 17000,
      "precondition: the card must start out reading as twelve days old");

    await db.query(`UPDATE cards SET stage_id = $2 WHERE id = $1`,
      [cardId, stageIds.survey_complete]);

    assert.ok(await minutesInStage(cardId) < 2,
      "after moving stages the card must read as just-arrived, not twelve days");
  });

test("moveCardToStage resets the clock — the writer that does not set it itself",
  { skip: !HAS_DB }, async () => {
    const { cardId, clientId } = await makeCard({ stage: "new_lead", createdDaysAgo: 9 });

    const out = await moveCardToStage(db, {
      orgId, clientId, pipelineKey: "sales", stageKey: "booked"
    });
    assert.equal(out.moved, true, `move must succeed: ${JSON.stringify(out)}`);

    const stage = await db.query(`SELECT stage_id FROM cards WHERE id = $1`, [cardId]);
    assert.equal(stage.rows[0].stage_id, stageIds.booked, "the card must actually be in Booked");
    assert.ok(await minutesInStage(cardId) < 2,
      "moveCardToStage sets no entered_at of its own; the trigger must do it");
  });

test("the partner-rail writer resets the clock too — the second production writer",
  { skip: !HAS_DB }, async () => {
    // api/public/partner-apply.mjs runs exactly this statement and, like
    // moveCardToStage, never mentions entered_at. Any fix living in one writer's
    // application code would have missed this path entirely.
    const { cardId } = await makeCard({ stage: "new_lead", createdDaysAgo: 30 });

    await db.query(`UPDATE cards SET stage_id = $2 WHERE id = $1`,
      [cardId, stageIds.booked]);

    assert.ok(await minutesInStage(cardId) < 2,
      "a bare UPDATE from any file must reset the clock");
  });

// ── 2. A no-op move does NOT ───────────────────────────────────────────────

test("writing the stage a card is already in leaves the clock alone",
  { skip: !HAS_DB }, async () => {
    const { cardId } = await makeCard({ stage: "survey_complete", createdDaysAgo: 6 });
    const before = await enteredAt(cardId);

    await db.query(`UPDATE cards SET stage_id = $2 WHERE id = $1`,
      [cardId, stageIds.survey_complete]);

    assert.deepEqual(await enteredAt(cardId), before,
      "a no-op move must not reset the clock — the card has not gone anywhere");
    assert.ok(await minutesInStage(cardId) > 8000,
      "the card must still read as six days in stage");
  });

test("moveCardToStage run twice does not restart the clock the second time",
  { skip: !HAS_DB }, async () => {
    // moveCardToStage is find-or-create and documented as safe to run twice.
    // Idempotent has to mean the clock too, or a retried webhook silently makes
    // a stalled card look fresh.
    const { cardId, clientId } = await makeCard({ stage: "new_lead", createdDaysAgo: 4 });

    await moveCardToStage(db, { orgId, clientId, pipelineKey: "sales", stageKey: "booked" });
    const afterFirst = await enteredAt(cardId);

    await new Promise((r) => setTimeout(r, 25));
    await moveCardToStage(db, { orgId, clientId, pipelineKey: "sales", stageKey: "booked" });
    const afterSecond = await enteredAt(cardId);

    assert.deepEqual(afterSecond, afterFirst,
      "the second identical move must leave entered_at exactly where the first put it");
  });

test("changing a card's owner does not touch the clock",
  { skip: !HAS_DB }, async () => {
    const { cardId } = await makeCard({ stage: "booked", createdDaysAgo: 5 });
    const before = await enteredAt(cardId);

    await db.query(`UPDATE cards SET owner = 'Someone Else' WHERE id = $1`, [cardId]);

    assert.deepEqual(await enteredAt(cardId), before,
      "reassigning a card is not moving it; the stall clock must keep running");
  });

// ── 3. An explicit entered_at still wins ───────────────────────────────────

test("a statement that sets entered_at itself keeps the value it named",
  { skip: !HAS_DB }, async () => {
    // Backdating on purpose is how fixtures build a genuinely stalled card
    // without waiting four days for one. The trigger fills in a clock nobody
    // set; it does not overrule a caller who set one.
    const { cardId } = await makeCard({ stage: "new_lead", createdDaysAgo: 1 });

    await db.query(
      `UPDATE cards SET stage_id = $2, entered_at = now() - interval '10 days' WHERE id = $1`,
      [cardId, stageIds.booked]);

    assert.ok(await minutesInStage(cardId) > 14000,
      "an explicitly named entered_at must survive the trigger");
  });

// ── 4. The board's numbers, end to end ─────────────────────────────────────

test("a card created long ago and moved just now reads as newly moved",
  { skip: !HAS_DB }, async () => {
    const { cardId } = await makeCard({ stage: "new_lead", createdDaysAgo: 20 });

    await db.query(`UPDATE cards SET stage_id = $2 WHERE id = $1`, [cardId, stageIds.booked]);

    const row = await db.query(
      `SELECT created_at, entered_at FROM cards WHERE id = $1`, [cardId]);
    const ageDays = (Date.now() - new Date(row.rows[0].created_at).getTime()) / 86400000;
    const stageDays = (Date.now() - new Date(row.rows[0].entered_at).getTime()) / 86400000;

    assert.ok(ageDays > 19, "the card is still twenty days old — created_at must not move");
    assert.ok(stageDays < 0.01,
      "but it entered this stage seconds ago; the board must print minutes, not '20d in stage'");
  });

test("the 'over 3d in stage' filter selects stalled cards and skips old-but-moved ones",
  { skip: !HAS_DB }, async () => {
    // pipeline.html's Age filter keeps a card when its printed minutes-in-stage
    // is >= the threshold. 4320 minutes is the "Over 3d in stage" option.
    const THREE_DAYS_MINS = 4320;

    // Genuinely stalled: created 30 days ago, last moved 5 days ago.
    const stalled = await makeCard({ stage: "new_lead", createdDaysAgo: 30 });
    await db.query(
      `UPDATE cards SET stage_id = $2, entered_at = now() - interval '5 days' WHERE id = $1`,
      [stalled.cardId, stageIds.booked]);

    // Old card, but it moved a moment ago. Before the fix this was
    // indistinguishable from the one above.
    const oldButMoving = await makeCard({ stage: "new_lead", createdDaysAgo: 30 });
    await db.query(`UPDATE cards SET stage_id = $2 WHERE id = $1`,
      [oldButMoving.cardId, stageIds.booked]);

    assert.ok(await minutesInStage(stalled.cardId) >= THREE_DAYS_MINS,
      "the card nobody has touched in five days must survive the 'over 3d' filter");
    assert.ok(await minutesInStage(oldButMoving.cardId) < THREE_DAYS_MINS,
      "the card that moved a moment ago must be filtered out, however old it is");
  });

test("pipeline movement counts cards that moved, not cards that were created",
  { skip: !HAS_DB }, async () => {
    // src/dashboard/kpis.mjs counts cards whose entered_at falls inside the
    // window. That query was always right about what it wanted; the column was
    // wrong. This proves the column now answers it.
    await db.query(`DELETE FROM cards WHERE org_id = $1`, [orgId]);

    // Created inside the window, never moved — counts, it entered its first stage.
    await makeCard({ stage: "new_lead", createdDaysAgo: 0 });
    // Created long ago, moved today — must count.
    const moved = await makeCard({ stage: "new_lead", createdDaysAgo: 40 });
    await db.query(`UPDATE cards SET stage_id = $2 WHERE id = $1`,
      [moved.cardId, stageIds.booked]);
    // Created long ago, has not moved — must NOT count.
    await makeCard({ stage: "booked", createdDaysAgo: 40 });

    const kpis = await computeKpis(db, { orgId, period: "today" });

    assert.equal(kpis.pipeline_movement, 2,
      "the fresh card and the just-moved old card count; the untouched old card does not");
  });
