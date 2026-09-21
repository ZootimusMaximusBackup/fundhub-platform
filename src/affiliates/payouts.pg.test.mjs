// THE PAYOUT RUN, against a real database.
//
// What this is guarding is the difference between "an affiliate is owed money"
// and "there is a thing that can be paid to them". Until 2026-09-21 only the
// first existed: commission accrued onto affiliate_referrals.commission_due and
// every insert into affiliate_payouts in this repository was a test fixture or
// demo seed.
//
// THE TESTS THAT MATTER HERE ARE THE ONES ABOUT NOT PAYING TWICE, and about
// money that must not leave when a gate is open. A payout run that is merely
// approximately right is a payout run that eventually sends somebody else's
// money to somebody, so the adversarial cases below — running the same month
// twice, two runs racing the same referral, an unsigned license, an unknown
// basis — are the point of the file and not an afterthought.
//
// Under src/ and not api/ — CLAUDE.md §12: npm test's glob is src/** and
// scripts/** only.

import { test, before, beforeEach, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { buildPayoutRun, previousMonth, payoutKey, PAYOUT_DEFAULTS } from "./payouts.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;

describe("affiliate payout run", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org;
  const MARK = "payoutrun";

  // A closed period well in the past, so nothing another test writes today can
  // wander into it.
  const PERIOD_START = new Date("2026-01-01T00:00:00Z");
  const PERIOD_END = new Date("2026-02-01T00:00:00Z");
  const CONVERTED_AT = new Date("2026-01-15T12:00:00Z");

  const mkAffiliate = async (n, { license = true, tax = true } = {}) => (await db.query(
    `INSERT INTO affiliates (org_id, name, status, partner_license_signed_at, tax_form_received_at)
     VALUES ($1,$2,'active',$3,$4) RETURNING id, tracking_id`,
    [org, `${MARK} ${n}`,
     license ? new Date("2025-12-01T00:00:00Z") : null,
     tax ? new Date("2025-12-01T00:00:00Z") : null]
  )).rows[0];

  const mkClient = async (n) => (await db.query(
    `INSERT INTO clients (org_id, first_name, last_name, email)
     VALUES ($1,'Payout',$2,$3) RETURNING id`,
    [org, n, `${MARK}.${n}@example.com`.toLowerCase()]
  )).rows[0].id;

  /* A converted referral carrying a commission. Written directly rather than
     driven through convert(), because what is under test here is the BATCHING
     of an owed amount, and economics.pg.test.mjs already proves the amount. */
  const owe = async (affiliateId, clientId, commission, {
    tier = "direct", status = "converted", convertedAt = CONVERTED_AT
  } = {}) => (await db.query(
    `INSERT INTO affiliate_referrals
       (org_id, affiliate_id, client_id, tier, status, attributed_at, converted_at,
        commission_due, basis_amount)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [org, affiliateId, clientId, tier, status,
     new Date("2026-01-02T00:00:00Z"), convertedAt, commission,
     commission === null ? null : 1000]
  )).rows[0].id;

  const run = (opts = {}) => buildPayoutRun(db, {
    orgId: org, periodStart: PERIOD_START, periodEnd: PERIOD_END, ...opts
  });

  const payoutsFor = async (affiliateId) => (await db.query(
    `SELECT id, status, hold_reason, amount, idempotency_key
       FROM affiliate_payouts WHERE affiliate_id = $1 ORDER BY created_at`,
    [affiliateId]
  )).rows;

  const linesOf = async (payoutId) => (await db.query(
    `SELECT referral_id, kind, amount FROM affiliate_payout_lines WHERE payout_id = $1`,
    [payoutId]
  )).rows;

  before(async () => { org = await resolveDefaultOrg(db); await purge(); });

  /* PURGED BEFORE EVERY TEST, not just once. buildPayoutRun sweeps a whole
     COMPANY, which is the right shape for the job and the wrong shape for
     fixtures that accumulate: one test's leftover owed referral turns up in the
     next test's run and its payoutsCreated count. Asserting per-affiliate
     instead would hide that; purging makes each test mean what it says. */
  beforeEach(purge);

  async function purge() {
    const affs = (await db.query(
      `SELECT id FROM affiliates WHERE name LIKE $1`, [`${MARK}%`])).rows.map(r => r.id);
    if (affs.length) {
      await db.query(`DELETE FROM affiliate_payout_lines WHERE payout_id IN
        (SELECT id FROM affiliate_payouts WHERE affiliate_id = ANY($1))`, [affs]);
      await db.query(`DELETE FROM affiliate_payouts WHERE affiliate_id = ANY($1)`, [affs]);
      // An attribution row is voided, never deleted (trg_affiliate_referrals_no_delete).
      // Right for production, wrong for a scratch fixture.
      await db.query(`ALTER TABLE affiliate_referrals DISABLE TRIGGER trg_affiliate_referrals_no_delete`);
      try {
        await db.query(`DELETE FROM affiliate_referrals WHERE affiliate_id = ANY($1)`, [affs]);
      } finally {
        await db.query(`ALTER TABLE affiliate_referrals ENABLE TRIGGER trg_affiliate_referrals_no_delete`);
      }
      await db.query(`UPDATE affiliates SET recruited_by = NULL WHERE id = ANY($1)`, [affs]);
      await db.query(`DELETE FROM affiliates WHERE id = ANY($1)`, [affs]);
    }
    await db.query(`DELETE FROM clients WHERE email LIKE $1`, [`${MARK}%`]);
  }

  after(async () => { await purge(); await close(); });

  // ── it builds something payable ──────────────────────────────────────────

  test("owed commission becomes one payout carrying one line per referral", async () => {
    const a = await mkAffiliate("basic");
    const r1 = await owe(a.id, await mkClient("b1"), 400);
    const r2 = await owe(a.id, await mkClient("b2"), 250);

    const rep = await run();
    assert.equal(rep.payoutsCreated, 1);
    assert.equal(rep.linesCreated, 2);

    const [p] = await payoutsFor(a.id);
    assert.equal(p.status, "pending");
    // amount is a rollup the trigger maintains from the lines — never written
    // by the run itself.
    assert.equal(Number(p.amount), 650);
    const ids = (await linesOf(p.id)).map(l => l.referral_id).sort();
    assert.deepEqual(ids, [r1, r2].sort());
  });

  test("the period is a boundary, not a suggestion", async () => {
    const a = await mkAffiliate("period");
    // Converted AFTER the period closed. Next month's problem.
    await owe(a.id, await mkClient("late"), 900,
      { convertedAt: new Date("2026-02-02T00:00:00Z") });

    const rep = await run();
    assert.equal(rep.payoutsCreated, 0, "a referral from outside the period was swept in");
  });

  // ── it does not pay twice ────────────────────────────────────────────────

  test("running the same month twice builds nothing the second time", async () => {
    const a = await mkAffiliate("idem");
    await owe(a.id, await mkClient("i1"), 300);

    const first = await run();
    assert.equal(first.payoutsCreated, 1);

    const second = await run();
    assert.equal(second.payoutsCreated, 0, "a second run of the same month built a second payout");
    /* skippedAlreadyRun is EMPTY here and that is correct, not a miss. The
       referral is on a commission line now, so OWED_SQL does not return it at
       all and the run finishes before it ever gets as far as deriving a key to
       collide with. The idempotency index is the second line of defence, and
       the test below drives it directly. */
    assert.equal(second.skippedAlreadyRun.length, 0);

    assert.equal((await payoutsFor(a.id)).length, 1, "two payout rows exist for one period");
  });

  test("a payout that already exists for the period is never duplicated", async () => {
    /* The case the test above cannot reach: owed referrals still visible AND a
       run already on the books. Reproduced by removing the lines while leaving
       the payout, which is what a partially-applied or manually-edited run
       looks like. The idempotency index has to be what stops it. */
    const a = await mkAffiliate("collide");
    await owe(a.id, await mkClient("cl1"), 300);
    await run();
    const [p] = await payoutsFor(a.id);
    await db.query(`DELETE FROM affiliate_payout_lines WHERE payout_id = $1`, [p.id]);

    const again = await run();
    assert.equal(again.payoutsCreated, 0, "a second run for the same period was built");
    assert.equal(again.skippedAlreadyRun.length, 1, "the collision was not reported");
    assert.equal((await payoutsFor(a.id)).length, 1, "two payout rows exist for one period");
  });

  test("the idempotency key is derived from the affiliate and period only", async () => {
    // If the key ever picks up the clock or a counter, a re-run stops colliding
    // and starts paying twice. This pins the shape.
    const a = await mkAffiliate("key");
    await owe(a.id, await mkClient("k1"), 300);
    await run();
    const [p] = await payoutsFor(a.id);
    assert.equal(p.idempotency_key, payoutKey(a.id, PERIOD_START, PERIOD_END));
    assert.equal(p.idempotency_key, `affrun:${a.id}:2026-01-01:2026-02-01`);
  });

  test("a referral already settled on an earlier run is never re-lined", async () => {
    const a = await mkAffiliate("resettle");
    const r1 = await owe(a.id, await mkClient("s1"), 300);
    await run();

    // A later period that would otherwise re-read the same referral.
    const rep = await buildPayoutRun(db, {
      orgId: org,
      periodStart: new Date("2026-02-01T00:00:00Z"),
      periodEnd: new Date("2026-03-01T00:00:00Z")
    });
    assert.equal(rep.payoutsCreated, 0, "an already-settled referral was picked up again");

    const lines = (await db.query(
      `SELECT count(*)::int AS n FROM affiliate_payout_lines
        WHERE referral_id = $1 AND kind = 'commission'`, [r1])).rows[0].n;
    assert.equal(lines, 1, "the same referral is on two commission lines");
  });

  // ── the gates ────────────────────────────────────────────────────────────

  test("an unsigned partner license holds the run instead of skipping it", async () => {
    const a = await mkAffiliate("nolicense", { license: false });
    await owe(a.id, await mkClient("nl1"), 500);

    const rep = await run();
    assert.equal(rep.payoutsCreated, 1, "the money stopped being counted");
    const [p] = await payoutsFor(a.id);
    assert.equal(p.status, "held");
    assert.equal(p.hold_reason, PAYOUT_DEFAULTS.heldReasons.license);
    assert.equal(Number(p.amount), 500, "a held run must still carry the amount");
  });

  test("a held run cannot be released — the database refuses, not the code", async () => {
    const a = await mkAffiliate("norelease", { license: false });
    await owe(a.id, await mkClient("nr1"), 500);
    await run();
    const [p] = await payoutsFor(a.id);

    await assert.rejects(
      () => db.query(`UPDATE affiliate_payouts SET status = 'processing' WHERE id = $1`, [p.id]),
      /partner license/,
      "an unlicensed affiliate's payout could be moved toward payment"
    );
  });

  test("a missing tax form holds it too", async () => {
    const a = await mkAffiliate("notax", { tax: false });
    await owe(a.id, await mkClient("nt1"), 500);

    await run();
    const [p] = await payoutsFor(a.id);
    assert.equal(p.status, "held");
    assert.equal(p.hold_reason, PAYOUT_DEFAULTS.heldReasons.tax);
  });

  // ── the minimum ──────────────────────────────────────────────────────────

  test("under the minimum writes nothing at all, so the balance carries", async () => {
    const a = await mkAffiliate("small");
    await owe(a.id, await mkClient("sm1"), 12);

    const rep = await run();
    assert.equal(rep.payoutsCreated, 0);
    assert.equal(rep.belowMinimum.length, 1);
    assert.equal(rep.belowMinimum[0].cents, 1200);
    assert.equal((await payoutsFor(a.id)).length, 0,
      "an empty or held run was written for somebody under the minimum");
  });

  test("next month, the carried amount plus new commission clears the minimum", async () => {
    const a = await mkAffiliate("carry");
    await owe(a.id, await mkClient("c1"), 30);           // January: under $50 alone
    const first = await run();
    assert.equal(first.payoutsCreated, 0);

    await owe(a.id, await mkClient("c2"), 30,            // February: another $30
      { convertedAt: new Date("2026-02-10T00:00:00Z") });

    const second = await buildPayoutRun(db, {
      orgId: org,
      periodStart: new Date("2026-02-01T00:00:00Z"),
      periodEnd: new Date("2026-03-01T00:00:00Z")
    });
    assert.equal(second.payoutsCreated, 1, "the carried January commission was lost");
    const [p] = await payoutsFor(a.id);
    assert.equal(Number(p.amount), 60, "the run did not carry both months");
    assert.equal((await linesOf(p.id)).length, 2);
  });

  test("the minimum is overridable per run", async () => {
    const a = await mkAffiliate("override");
    await owe(a.id, await mkClient("o1"), 12);
    const rep = await run({ minimumUsd: 1 });
    assert.equal(rep.payoutsCreated, 1);
  });

  // ── what must never be paid ──────────────────────────────────────────────

  test("an unknown commission is never read as zero", async () => {
    // CLAUDE.md §12: NULL means unknown and must survive. A $0.00 line would
    // settle the referral for ever against the commission-once index, so an
    // unknown basis would silently become "paid nothing, permanently".
    const a = await mkAffiliate("unknown");
    await owe(a.id, await mkClient("u1"), null);

    const rep = await run();
    assert.equal(rep.payoutsCreated, 0, "a referral with an unknown commission was settled");
    assert.equal((await payoutsFor(a.id)).length, 0);
  });

  test("an attributed-but-not-converted referral is not paid", async () => {
    const a = await mkAffiliate("attributed");
    await owe(a.id, await mkClient("at1"), 500, { status: "attributed" });
    assert.equal((await run()).payoutsCreated, 0, "a sale that has not completed was paid on");
  });

  test("a voided referral is not paid", async () => {
    const a = await mkAffiliate("voided");
    const id = await owe(a.id, await mkClient("v1"), 500);
    await db.query(
      `UPDATE affiliate_referrals SET status = 'void', void_reason = 'test' WHERE id = $1`, [id]);
    assert.equal((await run()).payoutsCreated, 0, "a voided referral was paid");
  });

  // ── both tiers, one run ──────────────────────────────────────────────────

  test("a downline commission is paid to the recruiter on their own run", async () => {
    const mike = await mkAffiliate("upline");
    const sarah = await mkAffiliate("downline");
    await db.query(`UPDATE affiliates SET recruited_by = $1 WHERE id = $2`, [mike.id, sarah.id]);

    const client = await mkClient("shared");
    await owe(sarah.id, client, 400, { tier: "direct" });
    await owe(mike.id, client, 100, { tier: "downline" });

    const rep = await run();
    assert.equal(rep.payoutsCreated, 2, "the two tiers did not both produce a run");

    const [sp] = await payoutsFor(sarah.id);
    const [mp] = await payoutsFor(mike.id);
    assert.equal(Number(sp.amount), 400, "the direct referrer was paid the wrong amount");
    assert.equal(Number(mp.amount), 100, "the recruiter was not paid their 5% share");
  });

  // ── the period helper ────────────────────────────────────────────────────

  test("previousMonth is the previous WHOLE calendar month, in UTC", () => {
    const { periodStart, periodEnd } = previousMonth(new Date("2026-10-01T03:00:00Z"));
    assert.equal(periodStart.toISOString(), "2026-09-01T00:00:00.000Z");
    assert.equal(periodEnd.toISOString(), "2026-10-01T00:00:00.000Z");

    // And it rolls the year, which an off-by-one here would get wrong silently.
    const jan = previousMonth(new Date("2026-01-14T09:00:00Z"));
    assert.equal(jan.periodStart.toISOString(), "2025-12-01T00:00:00.000Z");
    assert.equal(jan.periodEnd.toISOString(), "2026-01-01T00:00:00.000Z");
  });
});
