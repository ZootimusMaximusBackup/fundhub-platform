import { test, describe } from "node:test";
import assert from "node:assert";
import {
  triMerge, utilisation, tierReasoning, openBlockers, clientDetailExtras,
  businessCredit, latestBooking, incomeEstimates
} from "./client-detail.mjs";

const crs = (result, created_at = "2026-01-02T00:00:00Z") => ({ result, created_at });

describe("client detail derivations", () => {

  test("tri-merge reads the analyzer's own key names", () => {
    const t = triMerge([crs({ scores: { ex: 712, eq: 698, tu: 705 } })]);
    assert.equal(t.experian, 712);
    assert.equal(t.equifax, 698);
    assert.equal(t.transunion, 705);
    assert.equal(t.spread, 14);
    assert.equal(t.source, "crs_results");
  });

  test("tri-merge also accepts the long spellings", () => {
    const t = triMerge([crs({ scores: { experian: 700, equifax: 690, transunion: 710 } })]);
    assert.deepEqual([t.experian, t.equifax, t.transunion], [700, 690, 710]);
    assert.equal(t.spread, 20);
  });

  test("NOTHING IS INVENTED: no scores means null, not a plausible number", () => {
    for (const input of [[], [crs({})], [crs({ scores: {} })], [crs(null)], undefined]) {
      const t = triMerge(input);
      assert.deepEqual([t.experian, t.equifax, t.transunion, t.spread, t.source],
        [null, null, null, null, null], JSON.stringify(input));
    }
  });

  test("the most recent result with scores wins, older ones are ignored", () => {
    const t = triMerge([
      crs({ scores: { ex: 600, eq: 600, tu: 600 } }, "2026-01-01T00:00:00Z"),
      crs({ scores: { ex: 720, eq: 715, tu: 718 } }, "2026-03-01T00:00:00Z"),
      crs({ notScores: true }, "2026-04-01T00:00:00Z")
    ]);
    assert.equal(t.experian, 720, "a newer result without scores must not blank the older one");
    assert.equal(t.asOf, "2026-03-01T00:00:00Z");
  });

  test("spread needs two scores; one alone yields null", () => {
    assert.equal(triMerge([crs({ scores: { ex: 700 } })]).spread, null);
    assert.equal(triMerge([crs({ scores: { ex: 700, eq: 680 } })]).spread, 20);
  });

  test("a jsonb string round-trip still parses", () => {
    const t = triMerge([crs(JSON.stringify({ scores: { ex: 690, eq: 700, tu: 695 } }))]);
    assert.equal(t.equifax, 700);
  });

  test("all-null newest scores fall back to the last real FICO", () => {
    const t = triMerge([
      crs({ scores: { ex: 630, eq: 698, tu: 725 } }, "2026-01-01T00:00:00Z"),
      crs({ scores: { ex: null, eq: null, tu: null } }, "2026-08-16T00:00:00Z")
    ]);
    assert.deepEqual([t.experian, t.equifax, t.transunion], [630, 698, 725]);
    assert.equal(t.asOf, "2026-01-01T00:00:00Z");
  });

  test("Equifax FICO 9 in the raw bureau beats a cached IncomeView score", () => {
    const t = triMerge([crs({
      environment: "production",
      scores: { ex: 464, eq: 81, tu: null },
      scoreModels: {
        ex: "Experian/Fair Isaac Risk Model V9",
        eq: "Consumer IncomeView+ Model"
      },
      bureaus: {
        EQ: {
          scores: [
            { modelName: "Consumer IncomeView+ Model", scoreValue: "81", scoreMaximumValue: "300" },
            { modelName: "FICO Score 9", scoreValue: "462", scoreMaximumValue: null }
          ]
        }
      }
    })]);
    assert.equal(t.experian, 464);
    assert.equal(t.equifax, 462, "the FICO 9 sitting on the bureau must paint, not IncomeView");
    assert.equal(t.transunion, null);
  });

  test("IncomeView 42 is not a FICO; real FICO 9 stays", () => {
    const t = triMerge([crs({
      scores: { ex: 630, eq: 42, tu: 725 },
      scoreModels: {
        ex: "Experian/Fair Isaac Risk Model V9",
        eq: "Consumer IncomeView+ Model",
        tu: "FICO® Score 9"
      }
    })]);
    assert.equal(t.experian, 630);
    assert.equal(t.equifax, null, "IncomeView is not a credit score");
    assert.equal(t.transunion, 725);
  });

  test("sandbox scores are never shown as a real person's FICO", () => {
    const t = triMerge([
      crs({
        environment: "sandbox",
        scores: { ex: 630, eq: 42, tu: 725 },
        scoreModels: { ex: "FICO 9", tu: "FICO 9" }
      }, "2026-01-01T00:00:00Z"),
      crs({ environment: "production", scores: { ex: null, eq: null, tu: null } }, "2026-08-16T00:00:00Z")
    ]);
    assert.deepEqual([t.experian, t.equifax, t.transunion, t.source],
      [null, null, null, null]);
  });

  test("a number outside 300–850 is dropped even without a model name", () => {
    const t = triMerge([crs({ scores: { ex: 630, eq: 42, tu: 725 } })]);
    assert.equal(t.experian, 630);
    assert.equal(t.equifax, null);
    assert.equal(t.transunion, 725);
  });

  test("utilisation bands are boundary-correct", () => {
    const band = (pct) => utilisation([crs({ utilization: pct })]).band;
    assert.equal(band(0), "excellent");
    assert.equal(band(10), "excellent");
    assert.equal(band(10.1), "good");
    assert.equal(band(30), "good");
    assert.equal(band(30.1), "high");
    assert.equal(band(50), "high");
    assert.equal(band(50.1), "severe");
    assert.equal(band(100), "severe");
  });

  test("a missing utilisation is null, not a band", () => {
    const u = utilisation([crs({ scores: { ex: 700 } })], {});
    assert.deepEqual([u.percent, u.band], [null, null]);
  });

  test("utilisation falls back to the client custom field", () => {
    const u = utilisation([], { custom_fields: { utilization: 45 } });
    assert.equal(u.percent, 45);
    assert.equal(u.band, "high");
  });

  test("tier reasoning EXPLAINS, it does not recompute the tier", () => {
    const r = tierReasoning(
      { outcome_tier: "FULL_FUNDING", custom_fields: { total_funding_estimate: 62000 } },
      [crs({ scores: { ex: 712, eq: 698, tu: 705 }, utilization: 37, reason: "thin file" })]
    );
    assert.equal(r.tier, "FULL_FUNDING", "the STORED tier is what the client was told");
    assert.equal(r.unexplained, false);
    const kinds = r.factors.map((f) => f.factor);
    assert.deepEqual(kinds, ["tri_merge", "utilisation", "funding_estimate", "analyzer_reason"]);
  });

  test("a tier with nothing behind it is flagged unexplained", () => {
    const r = tierReasoning({ outcome_tier: "PREMIUM_STACK" }, []);
    assert.equal(r.tier, "PREMIUM_STACK");
    assert.equal(r.unexplained, true, "a tier set with no CRS behind it is a real state");
    assert.deepEqual(r.factors, []);
  });

  test("no tier at all is not 'unexplained'", () => {
    assert.equal(tierReasoning({}, []).unexplained, false);
  });

  test("blockers: open tasks, funding holds, balances and gates", () => {
    const b = openBlockers({
      client: { custom_fields: { crs_paid: false, deposit_paid: false, sale_closed: true } },
      tasks: [{ id: "t1", title: "Collect docs", done: false, assignee_role: "funding_advisor" },
              { id: "t2", title: "Done thing", done: true }],
      fundingRounds: [{ id: "r1", round_number: 1, hold_reason: "awaiting statements" },
                      { id: "r2", round_number: 2, hold_reason: null }],
      invoices: [{ id: "i1", balance_due: "250.00", currency: "USD",
                   due_at: "2020-01-01T00:00:00Z" },
                 { id: "i2", balance_due: "0" }]
    });
    const kinds = b.map((x) => x.kind);
    assert.equal(kinds.filter((k) => k === "task").length, 1, "a done task is not a blocker");
    assert.ok(kinds.includes("funding_hold"));
    assert.ok(kinds.includes("balance_due"));
    assert.equal(kinds.filter((k) => k === "gate").length, 2);

    // High severity first, so a closer reads the real problem at the top.
    const sev = b.map((x) => x.severity);
    assert.deepEqual([...sev].sort((a, c) => (a === "high" ? -1 : 1) - (c === "high" ? -1 : 1)), sev);

    const overdue = b.find((x) => x.kind === "balance_due");
    assert.equal(overdue.severity, "high");
    assert.match(overdue.detail, /USD 250\.00/);
  });

  test("a zero balance and a paid gate produce no blocker", () => {
    const b = openBlockers({
      client: { custom_fields: { crs_paid: true, deposit_paid: true, sale_closed: true } },
      tasks: [], fundingRounds: [], invoices: [{ id: "i", balance_due: "0" }]
    });
    assert.deepEqual(b, []);
  });

  test("an unpaid deposit is only a blocker once the sale closed", () => {
    const notYet = openBlockers({
      client: { custom_fields: { crs_paid: true, deposit_paid: false, sale_closed: false } },
      tasks: [], fundingRounds: [], invoices: []
    });
    assert.deepEqual(notYet, [], "a deposit is not outstanding before the sale closes");
  });

  test("clientDetailExtras is safe on empty input", () => {
    const e = clientDetailExtras({});
    assert.deepEqual(e.open_blockers, []);
    assert.equal(e.tri_merge.experian, null);
    assert.equal(e.utilisation.band, null);
    assert.equal(e.tier_reasoning.tier, null);
    assert.deepEqual(e.business_credit, { name: null, intelliscore: null, fsr: null });
    assert.deepEqual(e.income_estimates, { experian: null, equifax: null, asOf: null });
    assert.deepEqual(e.latest_booking, { when: null, title: null, status: null });
  });

  test("latest booking reads the strategy-session task and a no-show flag", () => {
    const b = latestBooking({
      client: { custom_fields: { call_outcome: "no_show" } },
      tasks: [{
        title: "Strategy session booked",
        source_workflow: "calcom",
        due_at: "2026-08-13T18:00:00.000Z",
        done: false
      }]
    });
    assert.equal(b.title, "Strategy session booked");
    assert.equal(b.when, "2026-08-13T18:00:00.000Z");
    assert.equal(b.status, "no_show");
  });

  test("income estimates read Income Insight / IncomeView as yearly dollars", () => {
    const inc = incomeEstimates([crs({
      environment: "production",
      bureaus: {
        EX: { scores: [
          { modelName: "Experian/Fair Isaac Risk Model V9", scoreValue: "464" },
          { modelName: "Income Insight", scoreValue: "97" }
        ]},
        EQ: { scores: [
          { modelName: "Consumer IncomeView+ Model", scoreValue: "81", scoreMaximumValue: "300" },
          { modelName: "FICO Score 9", scoreValue: "462" }
        ]}
      }
    })]);
    assert.equal(inc.experian.annual, 97000);
    assert.equal(inc.equifax.annual, 81000);
    assert.equal(incomeEstimates([]).experian, null);
  });

  test("business credit reads stored Intelliscore and never invents one", () => {
    const hit = businessCredit({
      businesses: [{ name: "Acme LLC", entity_data: { scores: { intelliscore: 72, fsr: 40 } } }]
    });
    assert.equal(hit.name, "Acme LLC");
    assert.equal(hit.intelliscore, 72);
    assert.equal(hit.fsr, 40);
    const miss = businessCredit({});
    assert.deepEqual(miss, { name: null, intelliscore: null, fsr: null });
    const ficoAsBiz = businessCredit({
      businesses: [{ entity_data: { scores: { intelliscore: 720 } } }]
    });
    assert.equal(ficoAsBiz.intelliscore, null, "FICO is not Intelliscore");
  });
});
