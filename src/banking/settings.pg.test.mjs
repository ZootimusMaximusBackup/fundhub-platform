// Real-Postgres integration test for the cash-flow threshold reader.
//
// SKIPS unless DATABASE_URL is set, like every other .pg.test.mjs here.
//
// WHAT THIS PROVES THAT A STUB CANNOT. The load-bearing claim is about what
// node-postgres hands back, not about JavaScript: `min_buffer_cents` is a
// bigint and arrives as the STRING "0", `confidence_floor` is numeric(4,3) and
// arrives as "0.800". A stub returning numbers would pass while the real reader
// handed a string to a model that refuses strings. That is AUDIT-FINDINGS.md's
// first lesson — "a fake that models the schema you wish you had cannot fail
// when the schema moves" — and it is why the driver has to be in the loop.
//
// The other claim is the one the whole design rests on: *** A NULL COLUMN
// PRODUCES AN ABSENT KEY, NEVER A ZERO. *** A NULL settlement lead arriving at
// the model as 0 would assert that payments post same-day, which is a claim
// about payment rails that is often false and whose cost is a missed payment.
// Both directions are asserted.

import { test, before, after } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { loadThresholds, configGaps, SettingsError } from "./settings.mjs";
import { project, paymentWindow } from "./cashflow.mjs";
// W7's side of the scale, imported rather than restated so that moving a band
// there fails a test here instead of silently drifting apart.
import { MAX_CONFIDENCE } from "./recurring.mjs";
import { PRESENTABLE_CONFIDENCE_FLOOR } from "./cashflow-seam.mjs";

const HAS_DB = !!process.env.DATABASE_URL;

let orgId = null;
let scratchOrgId = null;

before(async () => {
  if (!HAS_DB) return;
  orgId = (await db.query(`SELECT id FROM orgs WHERE is_default LIMIT 1`)).rows[0]?.id;
  assert.ok(orgId, "the default org must exist — run the migrations");

  // A scratch org whose settings this test is free to mangle. The default org's
  // row is what 088 seeded and other assertions read it, so it is not touched.
  scratchOrgId = (
    await db.query(
      `INSERT INTO orgs (slug, name) VALUES ('w8-settings-scratch', 'W8 Settings Scratch')
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`
    )
  ).rows[0].id;
});

after(async () => {
  if (!HAS_DB) return;
  await db.query(`DELETE FROM cashflow_settings WHERE org_id = $1`, [scratchOrgId]);
  await db.query(`DELETE FROM orgs WHERE slug = 'w8-settings-scratch'`);
  await close();
});

// ═══════════════════════════════════════════════════════════════════════════
// What 088 actually seeded.
// ═══════════════════════════════════════════════════════════════════════════

test("088 + 089 seeded the default org with all three thresholds", { skip: !HAS_DB }, async () => {
  const t = await loadThresholds(db, { orgId });
  assert.equal(t.minBufferCents, 0, "the task's specified zero floor");
  assert.equal(t.confidenceFloor, 0.75, "089 superseded 088's 0.800 placeholder");
  assert.equal(t.settlementLeadDays, 3);
});

test("the confidence floor is REACHABLE — above the detector's ceiling it confirms nothing", { skip: !HAS_DB }, async () => {
  // The trap this guards. recurring.mjs caps its score at MAX_CONFIDENCE (95)
  // because "nothing inferred from a transaction history is certain". A floor
  // set above that ceiling is not merely strict — NO bill could ever clear it,
  // so the committed track would be permanently empty and the projection would
  // silently show every bill as unconfirmed forever. That failure is invisible:
  // no error, no throw, just a projection that is quietly always pessimistic.
  const { confidenceFloor } = await loadThresholds(db, { orgId });
  assert.ok(
    confidenceFloor <= MAX_CONFIDENCE / 100,
    `confidence_floor ${confidenceFloor} is above the detector's ceiling of ${MAX_CONFIDENCE / 100} — no bill could ever be confirmed`
  );
  // And the other side: a floor at or below zero would confirm everything,
  // including the bills the detector itself calls 'none'.
  assert.ok(confidenceFloor > 0, "a floor of zero would confirm every bill the detector emits");
});

test("the floor is the detector's HIGH band, not its PRESENTABLE band — two different questions", { skip: !HAS_DB }, async () => {
  // There is a 0.55 constant in cashflow-seam.mjs and these two must not be
  // collapsed into one by a future reader who spots the disagreement:
  //
  //   PRESENTABLE_CONFIDENCE_FLOOR (0.55, = medium)  "safe to SHOW a person?"
  //   cashflow_settings.confidence_floor (0.75, = high)
  //                                     "certain enough to treat as money
  //                                      DEFINITELY leaving the account?"
  //
  // Banking on a bill is a higher bar than displaying it. Calling a 'medium'
  // bill certain would contradict the detector's own vocabulary.
  const { confidenceFloor } = await loadThresholds(db, { orgId });
  assert.ok(
    confidenceFloor > PRESENTABLE_CONFIDENCE_FLOOR,
    "the certainty floor must be stricter than the presentable floor, or the two questions have been conflated"
  );
});

test("the reader returns NUMBERS, not the strings the driver hands back", { skip: !HAS_DB }, async () => {
  // bigint -> "0" and numeric -> "0.800" come off node-postgres as strings.
  // cashflow.mjs refuses strings for money on purpose, so if this conversion
  // ever regresses the model throws rather than misreading by a factor of 100.
  const raw = await db.query(
    `SELECT min_buffer_cents, confidence_floor, settlement_lead_days
       FROM cashflow_settings WHERE org_id = $1`,
    [orgId]
  );
  assert.equal(typeof raw.rows[0].min_buffer_cents, "string", "the driver really does hand back a string");
  assert.equal(typeof raw.rows[0].confidence_floor, "string");

  const t = await loadThresholds(db, { orgId });
  assert.equal(typeof t.minBufferCents, "number");
  assert.equal(typeof t.confidenceFloor, "number");
  assert.equal(typeof t.settlementLeadDays, "number");
});

test("what the reader returns is accepted by the model without a throw", { skip: !HAS_DB }, async () => {
  // The seam works end to end, or it does not work at all.
  const thresholds = await loadThresholds(db, { orgId });
  const p = project({
    balances: [{ accountId: "a", balanceCents: 500_00 }],
    now: "2026-08-01",
    horizonDays: 30,
    thresholds
  });
  assert.equal(p.ok, true);
  const w = paymentWindow({
    projectedBalances: p,
    dueDate: "2026-08-20",
    minimumPaymentCents: 3_500,
    thresholds
  });
  assert.equal(w.ok, true);
  assert.equal(w.floorSource, "buffer-supplied");
  assert.equal(w.initiateByDate, "2026-08-17", "3 days before the 20th");
  assert.deepEqual(w.thresholdGaps, [], "with every threshold supplied there is no gap left to report");
});

// ═══════════════════════════════════════════════════════════════════════════
// NULL means unset. It never means zero.
// ═══════════════════════════════════════════════════════════════════════════

test("a NULL column produces an ABSENT key, not a zero", { skip: !HAS_DB }, async () => {
  await db.query(
    `INSERT INTO cashflow_settings (org_id, min_buffer_cents, confidence_floor, settlement_lead_days)
     VALUES ($1, NULL, NULL, NULL)
     ON CONFLICT (org_id) DO UPDATE
        SET min_buffer_cents = NULL, confidence_floor = NULL, settlement_lead_days = NULL`,
    [scratchOrgId]
  );
  const t = await loadThresholds(db, { orgId: scratchOrgId });
  assert.deepEqual(t, {}, "every key must be absent");
  assert.equal("settlementLeadDays" in t, false, "absent, not present-and-null");
  assert.equal("minBufferCents" in t, false);
});

test("an unset settlement lead makes the model REFUSE an initiate-by date", { skip: !HAS_DB }, async () => {
  // The consequence of the rule above, stated as behaviour. If the reader ever
  // starts turning NULL into 0, this test fails and the model would otherwise
  // have started quietly claiming payments post same-day.
  await db.query(
    `UPDATE cashflow_settings SET settlement_lead_days = NULL WHERE org_id = $1`,
    [scratchOrgId]
  );
  const thresholds = await loadThresholds(db, { orgId: scratchOrgId });
  const p = project({
    balances: [{ accountId: "a", balanceCents: 500_00 }],
    now: "2026-08-01",
    horizonDays: 30,
    thresholds
  });
  const w = paymentWindow({
    projectedBalances: p,
    dueDate: "2026-08-20",
    minimumPaymentCents: 3_500,
    thresholds
  });
  assert.equal(w.ok, true, "the window itself is still a real answer");
  assert.equal(w.initiateByDate, null);
  assert.equal(w.initiateByReason.code, "MISSING_SETTLEMENT_LEAD_TIME");
  assert.ok(w.thresholdGaps.some((g) => g.name === "settlementLeadDays"));
});

test("a zero settlement lead is a DECISION and is honoured — the other side of it", { skip: !HAS_DB }, async () => {
  await db.query(`UPDATE cashflow_settings SET settlement_lead_days = 0 WHERE org_id = $1`, [scratchOrgId]);
  const t = await loadThresholds(db, { orgId: scratchOrgId });
  assert.equal(t.settlementLeadDays, 0, "an explicit zero must survive as a zero");
  assert.equal("settlementLeadDays" in t, true);
});

test("an org with no settings row at all gets {} — and no row is created by reading", { skip: !HAS_DB }, async () => {
  await db.query(`DELETE FROM cashflow_settings WHERE org_id = $1`, [scratchOrgId]);
  assert.deepEqual(await loadThresholds(db, { orgId: scratchOrgId }), {});
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM cashflow_settings WHERE org_id = $1`,
    [scratchOrgId]
  );
  assert.equal(rows[0].n, 0, "a read must never write a default row");
});

test("loadThresholds is scoped to the org and demands one", { skip: !HAS_DB }, async () => {
  await assert.rejects(() => loadThresholds(db, {}), SettingsError);
  await assert.rejects(() => loadThresholds(db, { orgId: null }), SettingsError);
});

// ═══════════════════════════════════════════════════════════════════════════
// The database refuses a value that is not the kind of thing it claims to be.
// ═══════════════════════════════════════════════════════════════════════════

test("out-of-range thresholds are refused by CHECK constraints", { skip: !HAS_DB }, async () => {
  await db.query(`INSERT INTO cashflow_settings (org_id) VALUES ($1) ON CONFLICT DO NOTHING`, [scratchOrgId]);
  const bad = [
    [`UPDATE cashflow_settings SET min_buffer_cents = -1 WHERE org_id = $1`, "a negative buffer"],
    [`UPDATE cashflow_settings SET confidence_floor = 1.5 WHERE org_id = $1`, "a confidence above 1"],
    [`UPDATE cashflow_settings SET confidence_floor = -0.1 WHERE org_id = $1`, "a negative confidence"],
    [`UPDATE cashflow_settings SET settlement_lead_days = -1 WHERE org_id = $1`, "a negative lead time"],
    [`UPDATE cashflow_settings SET settlement_lead_days = 31 WHERE org_id = $1`, "a month-long lead time"]
  ];
  for (const [sql, what] of bad) {
    await assert.rejects(() => db.query(sql, [scratchOrgId]), (e) => e.code === "23514", what);
  }
});

test("confidence_floor is a FRACTION — 80 is refused, 0.8 is not", { skip: !HAS_DB }, async () => {
  // The percent-versus-fraction trap. money.mjs's percentOf takes percent units
  // and this column does not; the CHECK is what keeps them from being confused.
  await assert.rejects(
    () => db.query(`UPDATE cashflow_settings SET confidence_floor = 80 WHERE org_id = $1`, [scratchOrgId]),
    (e) => e.code === "23514" || e.code === "22003"
  );
  await db.query(`UPDATE cashflow_settings SET confidence_floor = 0.8 WHERE org_id = $1`, [scratchOrgId]);
  assert.equal((await loadThresholds(db, { orgId: scratchOrgId })).confidenceFloor, 0.8);
});

test("settings are removed with their org rather than left orphaned", { skip: !HAS_DB }, async () => {
  const doomed = (
    await db.query(`INSERT INTO orgs (slug, name) VALUES ('w8-settings-doomed','Doomed') RETURNING id`)
  ).rows[0].id;
  await db.query(`INSERT INTO cashflow_settings (org_id, settlement_lead_days) VALUES ($1, 2)`, [doomed]);
  await db.query(`DELETE FROM orgs WHERE id = $1`, [doomed]);
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM cashflow_settings WHERE org_id = $1`,
    [doomed]
  );
  assert.equal(rows[0].n, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// The gaps view. A default that stops being visible is one nobody re-examines.
// ═══════════════════════════════════════════════════════════════════════════

test("every seeded threshold is reported as awaiting sign-off", { skip: !HAS_DB }, async () => {
  const gaps = await configGaps(db, { orgId });
  const settings = gaps.map((g) => g.setting).sort();
  assert.deepEqual(settings, [
    "cashflow_settings.confidence_floor",
    "cashflow_settings.min_buffer_cents",
    "cashflow_settings.settlement_lead_days"
  ]);
  for (const g of gaps) {
    assert.match(g.status, /AWAITING SIGN-OFF/, `${g.setting} has a value and must still be reported`);
    assert.ok(g.consequence.trim().length > 0, "each gap says what being wrong costs");
  }
});

test("signing a value off stops it being reported — and only it", { skip: !HAS_DB }, async () => {
  await db.query(
    `INSERT INTO cashflow_settings (org_id, settlement_lead_days) VALUES ($1, 3)
     ON CONFLICT (org_id) DO UPDATE SET settlement_lead_days = 3`,
    [scratchOrgId]
  );
  const before = (await configGaps(db, { orgId: scratchOrgId })).map((g) => g.setting);
  assert.ok(before.includes("cashflow_settings.settlement_lead_days"));

  await db.query(
    `UPDATE cashflow_settings
        SET settlement_lead_signed_off_at = now(), settlement_lead_signed_off_by = 'test'
      WHERE org_id = $1`,
    [scratchOrgId]
  );
  const after = (await configGaps(db, { orgId: scratchOrgId })).map((g) => g.setting);
  assert.equal(after.includes("cashflow_settings.settlement_lead_days"), false, "signed off, so no longer a gap");
  assert.ok(after.includes("cashflow_settings.min_buffer_cents"), "the others are untouched");
});

test("an org with no settings row is itself reported as a gap", { skip: !HAS_DB }, async () => {
  // The branch the other three cannot see, because they all read FROM the table.
  await db.query(`DELETE FROM cashflow_settings WHERE org_id = $1`, [scratchOrgId]);
  const gaps = await configGaps(db, { orgId: scratchOrgId });
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].setting, "cashflow_settings");
  assert.match(gaps[0].status, /no cash-flow settings at all/);
});

test("the reader does not blindly trust the database — a bad stored value raises", { skip: !HAS_DB }, async () => {
  // The CHECK constraint normally makes this unreachable, which is exactly why
  // it has to be reached deliberately: the guard in settings.mjs is what stands
  // between a hand-edited row (or a constraint somebody dropped) and a
  // nonsensical threshold reaching the model. Silently passing 80 through as a
  // "fraction" would make every scored bill unconfirmed forever.
  await db.query(
    `INSERT INTO cashflow_settings (org_id) VALUES ($1) ON CONFLICT DO NOTHING`,
    [scratchOrgId]
  );
  await db.query(`ALTER TABLE cashflow_settings DROP CONSTRAINT cashflow_settings_confidence_floor_check`);
  try {
    await db.query(`UPDATE cashflow_settings SET confidence_floor = 9.999 WHERE org_id = $1`, [scratchOrgId]);
    await assert.rejects(() => loadThresholds(db, { orgId: scratchOrgId }), SettingsError);

    await db.query(`UPDATE cashflow_settings SET confidence_floor = -1 WHERE org_id = $1`, [scratchOrgId]);
    await assert.rejects(() => loadThresholds(db, { orgId: scratchOrgId }), SettingsError);
  } finally {
    // Restore the row and the constraint whatever happened above, or every test
    // that runs after this one is measuring a different schema.
    await db.query(`UPDATE cashflow_settings SET confidence_floor = NULL WHERE org_id = $1`, [scratchOrgId]);
    await db.query(
      `ALTER TABLE cashflow_settings ADD CONSTRAINT cashflow_settings_confidence_floor_check
         CHECK (confidence_floor >= 0 AND confidence_floor <= 1)`
    );
  }
});

test("the confidence CHECK constraint is back on after the test above", { skip: !HAS_DB }, async () => {
  // A test that disables a constraint has to prove it put it back, or it
  // silently weakens the schema for everything that follows.
  const { rows } = await db.query(
    `SELECT conname FROM pg_constraint
      WHERE conrelid = 'public.cashflow_settings'::regclass
        AND conname = 'cashflow_settings_confidence_floor_check'`
  );
  assert.equal(rows.length, 1, "the constraint must have been restored");
});
