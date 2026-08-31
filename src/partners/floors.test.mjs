// The production floor, without a database.
//
// Everything here is either pure arithmetic or the evaluator driven against a
// scripted `{ query }` stub. floors.pg.test.mjs proves the SQL against real
// Postgres; this file proves the DECISIONS, which is where a partner's commercial
// terms are actually made or unmade.
//
// The three boundaries the brief calls out — a client at the window edge, a
// refunded deposit, a client who paid twice — are all properties of
// SQL_COUNT_FUNDING_CLIENTS and are asserted against real Postgres in
// floors.pg.test.mjs. What is asserted HERE is the shape of that query, so a
// well-meaning edit that drops the half-open comparison or the refund exclusion
// fails immediately rather than at the next monthly run.

import { test, describe } from "node:test";
import assert from "node:assert";
import {
  FLOOR_CLIENTS_PER_MONTH, WINDOW_DAYS, GRACE_DAYS, FIRST_EVAL_DAYS,
  DOWNGRADED_SHARE_PCT, CURE_DAYS, OUTCOMES, FUNDING_DEPOSIT_PRODUCT_CODE,
  SQL_COUNT_FUNDING_CLIENTS,
  windowFloor, windowFor, isDue, nextLadderState,
  evaluatePartner, evaluateAllPartners, standingFor
} from "./floors.mjs";
import { OFFERS } from "../config/offers.mjs";

const DAY = 86_400_000;
const iso = (d) => new Date(d).toISOString();

/* ─────────────────────────── the owner's numbers ─────────────────────────── */

describe("the numbers are the owner's, not this file's", () => {
  test("the floor is ten funding clients a month (W0-decisions.md)", () => {
    assert.equal(FLOOR_CLIENTS_PER_MONTH, 10);
  });

  test("W1 §6 timings: 90-day window, 90-day grace, first score at day 180", () => {
    assert.equal(WINDOW_DAYS, 90);
    assert.equal(GRACE_DAYS, 90);
    assert.equal(FIRST_EVAL_DAYS, 180);
    assert.equal(FIRST_EVAL_DAYS, GRACE_DAYS + WINDOW_DAYS);
  });

  test("the downgrade is to 20, and the cure is 30 days", () => {
    assert.equal(DOWNGRADED_SHARE_PCT, 20);
    assert.equal(CURE_DAYS, 30);
  });

  test("the counted product is FUNDING_DFY's, read from the offer catalogue", () => {
    assert.equal(FUNDING_DEPOSIT_PRODUCT_CODE, "card-stacking-dfy");
    assert.equal(FUNDING_DEPOSIT_PRODUCT_CODE, OFFERS.FUNDING_DFY.productCode);
    // Not the soft pull, not repair. If any of these ever matched, the floor
    // would count people who never bought funding.
    for (const key of ["SOFT_PULL", "REPAIR_DFY", "REPAIR_TRIAL"]) {
      assert.notEqual(OFFERS[key].productCode, FUNDING_DEPOSIT_PRODUCT_CODE);
    }
  });
});

/* ───────────────────────────── windowFloor ───────────────────────────── */

describe("windowFloor — a monthly bar over a 90-day window", () => {
  test("ten a month over ninety days is thirty", () => {
    assert.equal(windowFloor(), 30);
    assert.equal(windowFloor({ floorPerMonth: 10, windowDays: 90 }), 30);
  });

  test("a partial month rounds UP, so nobody can sit just under the bar", () => {
    assert.equal(windowFloor({ floorPerMonth: 10, windowDays: 45 }), 15);
    assert.equal(windowFloor({ floorPerMonth: 10, windowDays: 31 }), 11);
    assert.equal(windowFloor({ floorPerMonth: 1, windowDays: 45 }), 2);
  });

  test("a floor of zero is a real answer, not a crash", () => {
    assert.equal(windowFloor({ floorPerMonth: 0 }), 0);
  });

  test("nonsense is refused rather than defaulted", () => {
    assert.throws(() => windowFloor({ floorPerMonth: -1 }), RangeError);
    assert.throws(() => windowFloor({ windowDays: 0 }), RangeError);
    assert.throws(() => windowFloor({ floorPerMonth: NaN }), RangeError);
  });
});

/* ───────────────────────────── windowFor ───────────────────────────── */

describe("windowFor — pinned to the month so a re-run scores the same window", () => {
  test("the window ends at the start of the UTC month containing asOf", () => {
    const w = windowFor("2026-09-01T14:00:00.000Z");
    assert.equal(iso(w.end), "2026-09-01T00:00:00.000Z");
    assert.equal(iso(w.start), "2026-06-03T00:00:00.000Z"); // 90 days back
  });

  test("a run on the 1st, a retry at noon and a manual run on the 9th agree", () => {
    const a = windowFor("2026-09-01T14:00:00.000Z");
    const b = windowFor("2026-09-01T14:03:11.902Z");
    const c = windowFor("2026-09-09T23:59:59.999Z");
    assert.equal(iso(a.end), iso(b.end));
    assert.equal(iso(a.end), iso(c.end));
    assert.equal(iso(a.start), iso(c.start));
  });

  test("the interval is half-open: end - start is exactly the window length", () => {
    const w = windowFor("2026-09-01T00:00:00.000Z");
    assert.equal((w.end.getTime() - w.start.getTime()) / DAY, WINDOW_DAYS);
  });

  test("January rolls back into the previous year", () => {
    const w = windowFor("2027-01-01T14:00:00.000Z");
    assert.equal(iso(w.end), "2027-01-01T00:00:00.000Z");
    assert.equal(iso(w.start), "2026-10-03T00:00:00.000Z");
  });
});

/* ───────────────────────────── isDue ───────────────────────────── */

describe("isDue — grace, and the refusal to guess an activation date", () => {
  const window = windowFor("2026-09-01T14:00:00.000Z"); // [2026-06-03, 2026-09-01)
  const at = (d) => ({
    activatedAt: d, status: "active",
    windowStart: window.start, windowEnd: window.end
  });

  test("a partner with no activation date is not judged, and says why", () => {
    const r = isDue(at(null));
    assert.equal(r.due, false);
    assert.equal(r.reason, "no_activation_date");
  });

  test("an empty string is unknown too, not the epoch", () => {
    assert.equal(isDue(at("")).reason, "no_activation_date");
    assert.equal(isDue(at("not a date")).reason, "no_activation_date");
  });

  test("inside the 90-day grace, the window reaches into the ramp — not due", () => {
    // Activated 2026-05-01: grace ends 2026-07-30, which is inside the window.
    const r = isDue(at("2026-05-01T00:00:00.000Z"));
    assert.equal(r.due, false);
    assert.equal(r.reason, "in_grace");
  });

  test("exactly at day 180 the first full window is complete — due", () => {
    // window.start must be >= activated + 90d. activated = start - 90d exactly.
    const activated = new Date(window.start.getTime() - 90 * DAY);
    const r = isDue(at(activated));
    assert.equal(r.due, true, `activated ${iso(activated)} window ${iso(window.start)}`);
    assert.equal((window.end.getTime() - activated.getTime()) / DAY, FIRST_EVAL_DAYS);
  });

  test("one day short of day 180 is still in grace", () => {
    const activated = new Date(window.start.getTime() - 90 * DAY + DAY);
    assert.equal(isDue(at(activated)).reason, "in_grace");
  });

  test("only an active partner is scored", () => {
    const old = "2020-01-01T00:00:00.000Z";
    assert.equal(isDue({ ...at(old), status: "invited" }).reason, "not_active");
    assert.equal(isDue({ ...at(old), status: "paused" }).reason, "not_active");
    assert.equal(isDue({ ...at(old), status: "active" }).due, true);
  });

  test("no window means no judgement", () => {
    assert.equal(isDue({ activatedAt: "2020-01-01", status: "active" }).reason, "no_window");
  });
});

/* ───────────────────────────── the ladder ───────────────────────────── */

describe("nextLadderState — the ladder, one rung at a time", () => {
  const END = new Date("2026-09-01T00:00:00.000Z");
  const base = { currentSharePct: 50, windowEnd: END };

  test("met, never missed — nothing happens and nothing moves", () => {
    const r = nextLadderState({ ...base, met: true, priorMisses: 0 });
    assert.equal(r.outcome, OUTCOMES.GOOD);
    assert.equal(r.consecutiveMisses, 0);
    assert.equal(r.sharePctBefore, null);
    assert.equal(r.sharePctAfter, null);
  });

  test("one window below the floor is a warning, not a cut", () => {
    const r = nextLadderState({ ...base, met: false, priorMisses: 0 });
    assert.equal(r.outcome, OUTCOMES.WARNING);
    assert.equal(r.consecutiveMisses, 1);
    assert.equal(r.sharePctAfter, null);
    assert.equal(r.cureDueAt, null);
  });

  test("two consecutive is a final notice with a 30-day cure from the WINDOW end", () => {
    const r = nextLadderState({ ...base, met: false, priorMisses: 1 });
    assert.equal(r.outcome, OUTCOMES.FINAL_NOTICE);
    assert.equal(r.consecutiveMisses, 2);
    assert.equal(iso(r.cureDueAt), "2026-10-01T00:00:00.000Z");
    // The cure runs from the window that failed, so a job that ran late does not
    // quietly shorten the partner's thirty days.
    assert.equal((r.cureDueAt.getTime() - END.getTime()) / DAY, CURE_DAYS);
    assert.equal(r.sharePctAfter, null);
  });

  test("three consecutive drops 50 to 20", () => {
    const r = nextLadderState({ ...base, met: false, priorMisses: 2 });
    assert.equal(r.outcome, OUTCOMES.DOWNGRADE);
    assert.equal(r.consecutiveMisses, 3);
    assert.equal(r.sharePctBefore, 50);
    assert.equal(r.sharePctAfter, 20);
  });

  test("a fourth miss records the standing and cuts nothing twice", () => {
    const r = nextLadderState({ met: false, priorMisses: 3, currentSharePct: 20, windowEnd: END });
    assert.equal(r.outcome, OUTCOMES.DOWNGRADE);
    assert.equal(r.consecutiveMisses, 4);
    assert.equal(r.sharePctBefore, 20);
    assert.equal(r.sharePctAfter, 20, "no second reduction");
  });

  test("one good window after a downgrade restores the rate that was taken", () => {
    const r = nextLadderState({
      met: true, priorMisses: 3, currentSharePct: 20, priorDowngradeFrom: 50, windowEnd: END
    });
    assert.equal(r.outcome, OUTCOMES.RESTORED);
    assert.equal(r.consecutiveMisses, 0);
    assert.equal(r.sharePctBefore, 20);
    assert.equal(r.sharePctAfter, 50);
  });

  test("a negotiated 60% partner is restored to 60, never to a constant 50", () => {
    const r = nextLadderState({
      met: true, priorMisses: 3, currentSharePct: 20, priorDowngradeFrom: 60, windowEnd: END
    });
    assert.equal(r.sharePctAfter, 60);
  });

  test("a partner CONTRACTED at 20 is never promoted by a good window", () => {
    // No prior downgrade row, so nothing was taken and nothing may be given.
    const r = nextLadderState({ met: true, priorMisses: 0, currentSharePct: 20, windowEnd: END });
    assert.equal(r.outcome, OUTCOMES.GOOD);
    assert.equal(r.sharePctAfter, null);
  });

  test("a partner already back at 50 is not 'restored' a second time", () => {
    const r = nextLadderState({
      met: true, priorMisses: 0, currentSharePct: 50, priorDowngradeFrom: 50, windowEnd: END
    });
    assert.equal(r.outcome, OUTCOMES.GOOD);
    assert.equal(r.sharePctAfter, null);
  });

  test("a missed window resets to zero after one good one", () => {
    const good = nextLadderState({ ...base, met: true, priorMisses: 2 });
    assert.equal(good.consecutiveMisses, 0);
    // ...so the next miss starts the ladder again at a warning.
    const next = nextLadderState({ ...base, met: false, priorMisses: good.consecutiveMisses });
    assert.equal(next.outcome, OUTCOMES.WARNING);
  });

  test("an unknown share is refused, never read as zero", () => {
    assert.throws(() => nextLadderState({ met: false, priorMisses: 2, currentSharePct: null }), RangeError);
    assert.throws(() => nextLadderState({ met: true, currentSharePct: undefined }), RangeError);
    assert.throws(() => nextLadderState({ met: true, currentSharePct: "" }), RangeError);
  });
});

/* ──────────────────── the counting definition, as written ──────────────────── */

describe("SQL_COUNT_FUNDING_CLIENTS — the one definition of a funding client", () => {
  const sql = SQL_COUNT_FUNDING_CLIENTS;

  test("counts DEPOSITS on the funding product only", () => {
    assert.match(sql, /sp\.kind = 'deposit'/);
    assert.match(sql, /lower\(btrim\(p\.code\)\) = \$3/);
    assert.doesNotMatch(sql, /success_fee|installment/,
      "a back-end fee or an instalment is not a new funding client");
  });

  test("the window comparison is half-open", () => {
    assert.match(sql, /first_deposit_at >= \$4/);
    assert.match(sql, /first_deposit_at <\s+\$5/);
    assert.doesNotMatch(sql, /first_deposit_at <=/,
      "a closed upper bound counts a deposit in two windows");
  });

  test("a client is placed by their FIRST surviving deposit, so paying twice counts once", () => {
    assert.match(sql, /MIN\(sp\.paid_at\)/);
    assert.match(sql, /GROUP BY c\.id/);
    assert.match(sql, /count\(\*\)/);
  });

  test("a fully refunded deposit is excluded; a partial refund is not", () => {
    assert.match(sql, /NOT EXISTS/);
    assert.match(sql, /FILTER \(WHERE r\.kind = 'refund'\)/);
    assert.match(sql, />=\s*COALESCE\(SUM\(r\.amount\) FILTER \(WHERE r\.kind = 'deposit'\), 0\)/);
    assert.match(sql, /s\.status = 'active'/);
  });

  test("zero-value receipts and demo data cannot clear the bar", () => {
    assert.match(sql, /sp\.amount > 0/);
    assert.match(sql, /s\.is_demo = false/);
    assert.match(sql, /sp\.is_demo = false/);
  });

  test("every join carries org_id, so a count cannot cross a tenancy boundary", () => {
    assert.match(sql, /s\.org_id = c\.org_id/);
    assert.match(sql, /sp\.org_id = s\.org_id/);
    assert.match(sql, /c\.partner_id = \$2/);
  });
});

/* ─────────────────────── the evaluator, on a stub handle ─────────────────────── */

/* A scripted `{ query }`. Each entry matches on a fragment of the SQL, so the
   stub cannot silently answer a query it was not written for — an unmatched
   statement throws rather than returning an empty result that would read as
   "this partner has no clients". */
function stubDb(script) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      for (const [needle, reply] of script) {
        if (sql.includes(needle)) {
          return typeof reply === "function" ? reply(params, calls) : reply;
        }
      }
      throw new Error(`stubDb: no scripted reply for: ${sql.slice(0, 90)}`);
    }
  };
}

const ORG = "11111111-1111-4111-8111-111111111111";
const PARTNER = "22222222-2222-4222-8222-222222222222";
const AS_OF = "2026-09-01T14:00:00.000Z";
/** Activated far enough back that the September window is fully out of grace. */
const LONG_ACTIVE = "2025-01-01T00:00:00.000Z";

function partnerRow(over = {}) {
  return {
    rows: [{
      id: PARTNER, org_id: ORG, name: "Alpha", brand_name: "Alpha Capital",
      status: "active", revenue_share_pct: "50", activated_at: LONG_ACTIVE, ...over
    }]
  };
}

describe("evaluatePartner", () => {
  test("a partner below the floor is warned, and no share moves", async () => {
    const db = stubDb([
      ["FROM partners\n   WHERE id = $1", partnerRow()],
      ["WITH surviving", { rows: [{ funding_clients: 4 }] }],
      ["FROM partner_production_reviews\n   WHERE org_id = $1 AND partner_id = $2 AND window_end <", { rows: [] }],
      ["outcome IN ('downgrade', 'restored')", { rows: [] }],
      ["INSERT INTO partner_production_reviews", { rows: [{ id: "rev-1" }] }]
    ]);
    const r = await evaluatePartner(db, { orgId: ORG, partnerId: PARTNER, asOf: AS_OF });
    assert.equal(r.evaluated, true);
    assert.equal(r.outcome, OUTCOMES.WARNING);
    assert.equal(r.fundingClients, 4);
    assert.equal(r.floorClients, 30);
    assert.equal(r.met, false);
    assert.equal(r.shareMoved, false);
    assert.ok(!db.calls.some((c) => c.sql.includes("UPDATE partners")), "no share was touched");
  });

  test("exactly at the floor is MET — the bar is >=, not >", async () => {
    const db = stubDb([
      ["FROM partners\n   WHERE id = $1", partnerRow()],
      ["WITH surviving", { rows: [{ funding_clients: 30 }] }],
      ["window_end <", { rows: [{ consecutive_misses: 2, outcome: "final_notice", met: false }] }],
      ["outcome IN ('downgrade', 'restored')", { rows: [] }],
      ["INSERT INTO partner_production_reviews", { rows: [{ id: "rev-2" }] }]
    ]);
    const r = await evaluatePartner(db, { orgId: ORG, partnerId: PARTNER, asOf: AS_OF });
    assert.equal(r.met, true);
    assert.equal(r.outcome, OUTCOMES.GOOD);
    assert.equal(r.consecutiveMisses, 0, "one good window clears the ladder");
  });

  test("the third consecutive miss moves the share, guarded on the value it read", async () => {
    const db = stubDb([
      ["FROM partners\n   WHERE id = $1", partnerRow()],
      ["WITH surviving", { rows: [{ funding_clients: 0 }] }],
      ["window_end <", { rows: [{ consecutive_misses: 2, outcome: "final_notice", met: false }] }],
      ["outcome IN ('downgrade', 'restored')", { rows: [] }],
      ["INSERT INTO partner_production_reviews", { rows: [{ id: "rev-3" }] }],
      ["UPDATE partners", { rows: [{ revenue_share_pct: "20" }] }]
    ]);
    const r = await evaluatePartner(db, { orgId: ORG, partnerId: PARTNER, asOf: AS_OF });
    assert.equal(r.outcome, OUTCOMES.DOWNGRADE);
    assert.equal(r.sharePctBefore, 50);
    assert.equal(r.sharePctAfter, 20);
    assert.equal(r.shareMoved, true);

    const upd = db.calls.find((c) => c.sql.includes("UPDATE partners"));
    assert.deepEqual(upd.params, [PARTNER, ORG, 20, 50],
      "the UPDATE names the rate it expects to be moving off");
    assert.match(upd.sql, /revenue_share_pct = \$4/, "a concurrent edit wins over this job");
    assert.doesNotMatch(upd.sql, /SET[^]*status/, "partners.status is never touched");
  });

  test("a re-run in the same month writes nothing and moves nothing", async () => {
    const db = stubDb([
      ["FROM partners\n   WHERE id = $1", partnerRow()],
      ["WITH surviving", { rows: [{ funding_clients: 0 }] }],
      ["window_end <", { rows: [{ consecutive_misses: 2, outcome: "final_notice", met: false }] }],
      ["outcome IN ('downgrade', 'restored')", { rows: [] }],
      // ON CONFLICT DO NOTHING against ppr_partner_window_uniq.
      ["INSERT INTO partner_production_reviews", { rows: [] }]
    ]);
    const r = await evaluatePartner(db, { orgId: ORG, partnerId: PARTNER, asOf: AS_OF });
    assert.equal(r.evaluated, false);
    assert.equal(r.reason, "already_reviewed");
    assert.equal(r.outcome, OUTCOMES.DOWNGRADE, "the decision is still reported");
    assert.ok(!db.calls.some((c) => c.sql.includes("UPDATE partners")),
      "a second pass must not ratchet the partner down again");
  });

  test("a good window after a downgrade restores the recorded rate", async () => {
    const db = stubDb([
      ["FROM partners\n   WHERE id = $1", partnerRow({ revenue_share_pct: "20" })],
      ["WITH surviving", { rows: [{ funding_clients: 31 }] }],
      ["window_end <", { rows: [{ consecutive_misses: 3, outcome: "downgrade", met: false }] }],
      ["outcome IN ('downgrade', 'restored')",
        { rows: [{ outcome: "downgrade", share_pct_before: "50", share_pct_after: "20" }] }],
      ["INSERT INTO partner_production_reviews", { rows: [{ id: "rev-4" }] }],
      ["UPDATE partners", { rows: [{ revenue_share_pct: "50" }] }]
    ]);
    const r = await evaluatePartner(db, { orgId: ORG, partnerId: PARTNER, asOf: AS_OF });
    assert.equal(r.outcome, OUTCOMES.RESTORED);
    assert.equal(r.sharePctAfter, 50);
    assert.equal(r.shareMoved, true);
  });

  test("somebody changed the rate mid-run: the review stands, the rate is left alone", async () => {
    const db = stubDb([
      ["FROM partners\n   WHERE id = $1", partnerRow()],
      ["WITH surviving", { rows: [{ funding_clients: 1 }] }],
      ["window_end <", { rows: [{ consecutive_misses: 2, outcome: "final_notice", met: false }] }],
      ["outcome IN ('downgrade', 'restored')", { rows: [] }],
      ["INSERT INTO partner_production_reviews", { rows: [{ id: "rev-5" }] }],
      ["UPDATE partners", { rows: [] }]   // the guard matched nothing
    ]);
    const r = await evaluatePartner(db, { orgId: ORG, partnerId: PARTNER, asOf: AS_OF });
    assert.equal(r.evaluated, true);
    assert.equal(r.shareMoved, false);
  });

  test("no activation date: nothing is written and the reason is named", async () => {
    const db = stubDb([["FROM partners\n   WHERE id = $1", partnerRow({ activated_at: null })]]);
    const r = await evaluatePartner(db, { orgId: ORG, partnerId: PARTNER, asOf: AS_OF });
    assert.equal(r.evaluated, false);
    assert.equal(r.reason, "no_activation_date");
    assert.equal(db.calls.length, 1, "it did not even count");
  });

  test("inside grace: not judged", async () => {
    const db = stubDb([
      ["FROM partners\n   WHERE id = $1", partnerRow({ activated_at: "2026-07-01T00:00:00.000Z" })]
    ]);
    const r = await evaluatePartner(db, { orgId: ORG, partnerId: PARTNER, asOf: AS_OF });
    assert.equal(r.reason, "in_grace");
  });

  test("apply:false computes the whole decision and writes nothing", async () => {
    const db = stubDb([
      ["FROM partners\n   WHERE id = $1", partnerRow()],
      ["WITH surviving", { rows: [{ funding_clients: 2 }] }],
      ["window_end <", { rows: [{ consecutive_misses: 2, outcome: "final_notice", met: false }] }],
      ["outcome IN ('downgrade', 'restored')", { rows: [] }]
    ]);
    const r = await evaluatePartner(db, { orgId: ORG, partnerId: PARTNER, asOf: AS_OF, apply: false });
    assert.equal(r.evaluated, false);
    assert.equal(r.reason, "dry_run");
    assert.equal(r.outcome, OUTCOMES.DOWNGRADE);
    assert.ok(!db.calls.some((c) => c.sql.includes("INSERT") || c.sql.includes("UPDATE")));
  });

  test("a missing partner is not an exception", async () => {
    const db = stubDb([["FROM partners\n   WHERE id = $1", { rows: [] }]]);
    assert.equal((await evaluatePartner(db, { orgId: ORG, partnerId: PARTNER })).reason, "no_partner");
  });

  test("missing context refuses before it reads anything", async () => {
    const db = stubDb([]);
    assert.equal((await evaluatePartner(db, { orgId: ORG })).reason, "missing_context");
    assert.equal(db.calls.length, 0);
  });
});

describe("evaluateAllPartners", () => {
  test("one partner blowing up does not leave the rest unjudged", async () => {
    const A = "33333333-3333-4333-8333-333333333333";
    const B = "44444444-4444-4444-8444-444444444444";
    const db = stubDb([
      ["FROM partners\n   WHERE status = 'active'", { rows: [{ id: A, org_id: ORG }, { id: B, org_id: ORG }] }],
      ["FROM partners\n   WHERE id = $1", (params) => {
        if (params[0] === A) throw new Error("boom");
        return partnerRow({ id: B });
      }],
      ["WITH surviving", { rows: [{ funding_clients: 40 }] }],
      ["window_end <", { rows: [] }],
      ["outcome IN ('downgrade', 'restored')", { rows: [] }],
      ["INSERT INTO partner_production_reviews", { rows: [{ id: "rev-b" }] }]
    ]);
    const r = await evaluateAllPartners(db, { asOf: AS_OF });
    assert.equal(r.considered, 2);
    assert.equal(r.failed, 1);
    assert.equal(r.evaluated, 1);
    assert.equal(r.good_standing, 1);
  });

  test("only active partners with a known activation date are even considered", async () => {
    const db = stubDb([["FROM partners\n   WHERE status = 'active'", { rows: [] }]]);
    const r = await evaluateAllPartners(db, { asOf: AS_OF });
    assert.equal(r.considered, 0);
    const sql = db.calls[0].sql;
    assert.match(sql, /activated_at IS NOT NULL/);
    assert.match(sql, /status = 'active'/);
  });
});

describe("standingFor — what the partner's own screen reads", () => {
  test("never evaluated reads as null, not as a pass", async () => {
    const db = stubDb([
      ["FROM partner_production_reviews\n   WHERE org_id = $1 AND partner_id = $2\n   ORDER BY", { rows: [] }],
      ["WITH surviving", { rows: [{ funding_clients: 7 }] }]
    ]);
    const s = await standingFor(db, { orgId: ORG, partnerId: PARTNER, asOf: AS_OF });
    assert.equal(s.latest, null);
    assert.deepEqual(s.history, []);
    assert.equal(s.floorClients, 30);
    assert.equal(s.current.fundingClients, 7);
    assert.equal(s.current.met, false);
    assert.equal(s.current.shortBy, 23);
  });

  test("the live window ends NOW, not at the last month boundary", async () => {
    const db = stubDb([
      ["ORDER BY window_end DESC\n   LIMIT $3", { rows: [] }],
      ["WITH surviving", { rows: [{ funding_clients: 30 }] }]
    ]);
    const s = await standingFor(db, { orgId: ORG, partnerId: PARTNER, asOf: AS_OF });
    assert.equal(iso(s.current.windowEnd), AS_OF);
    assert.equal((s.current.windowEnd.getTime() - s.current.windowStart.getTime()) / DAY, WINDOW_DAYS);
    assert.equal(s.current.met, true);
    assert.equal(s.current.shortBy, 0);
  });

  test("history is clamped so a screen cannot ask for the whole table", async () => {
    const db = stubDb([
      ["ORDER BY window_end DESC\n   LIMIT $3", { rows: [] }],
      ["WITH surviving", { rows: [{ funding_clients: 0 }] }]
    ]);
    await standingFor(db, { orgId: ORG, partnerId: PARTNER, asOf: AS_OF, history: 9999 });
    const call = db.calls.find((c) => c.sql.includes("LIMIT $3"));
    assert.equal(call.params[2], 24);
  });
});
