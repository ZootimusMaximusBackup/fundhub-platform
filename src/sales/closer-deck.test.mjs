import { test } from "node:test";
import assert from "node:assert/strict";
import { OFFERS } from "../config/offers.mjs";
import {
  buildCloserDeck,
  selectedOfferKey,
  generateDeckLetters,
  CloserDeckError
} from "./closer-deck.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const CID = "22222222-2222-4222-8222-222222222222";

function fakeDb({ client = null, crs = null } = {}) {
  return {
    async query(sql) {
      const s = String(sql);
      if (/FROM clients c/i.test(s)) {
        return { rows: client ? [client] : [] };
      }
      if (/FROM crs_results/i.test(s)) {
        return { rows: crs ? [crs] : [] };
      }
      if (/FROM payment_links/i.test(s)) return { rows: [] };
      if (/FROM soft_pull_requests/i.test(s)) return { rows: [] };
      if (/FROM client_consents/i.test(s)) return { rows: [] };
      throw new Error("unexpected sql: " + s.slice(0, 80));
    }
  };
}

const CLIENT = {
  id: CID,
  first_name: "Marcus",
  last_name: "Webb",
  email: "m@example.com",
  phone: "555",
  outcome_tier: "REPAIR_ONLY",
  custom_fields: {
    cf_svy_funding_target_amount: "$100k - $200k",
    cf_svy_planned_use: "Equipment or buildout",
    cf_svy_has_business: "Yes, 2-5 years",
    cf_svy_business_revenue: "$250k - $499k",
    cf_svy_annual_income_range: "$100k-$199k",
    cf_svy_available_capital: "$5k - $25k",
    cf_svy_money_change_now: "Grow faster (more customers / more reach)"
  },
  business_name: "Webb Contracting LLC"
};

test("missing client is null, not invented people", async () => {
  const out = await buildCloserDeck(fakeDb(), { orgId: ORG, clientId: CID });
  assert.equal(out, null);
});

test("no CRS row is a labeled unavailable engine, survey still fills", async () => {
  const out = await buildCloserDeck(fakeDb({ client: CLIENT }), { orgId: ORG, clientId: CID });
  assert.equal(out.survey.name, "Marcus Webb");
  assert.equal(out.survey.entity, "Webb Contracting LLC");
  assert.equal(out.survey.target, "$100k - $200k");
  assert.equal(out.engine.available, false);
  assert.equal(out.engine.reason, "engine data unavailable");
  assert.equal(out.engine.fico.ex, null);
  assert.equal(out.engine.total, null);
  assert.deepEqual(out.income_estimates, { experian: null, equifax: null, asOf: null });
  assert.equal(out.offers.length, Object.keys(OFFERS).length);
});

test("stored closer payload maps FICO, total, reasons — no invented numbers", async () => {
  const crs = {
    outcome_tier: "FUNDING_PLUS_REPAIR",
    created_at: "2026-08-16T00:00:00Z",
    result: {
      environment: "production",
      outcome: "FUNDING_PLUS_REPAIR",
      reasonCodes: [
        ["M2-013 · TU", "TransUnion tradeline reports paid, zero balance, while showing a balance owed"]
      ],
      preapprovals: { totalCombined: 127500 },
      projectedPreapproval: { totalCombined: 214000 },
      scores: { perBureau: { ex: 712, tu: 648, eq: 641 } },
      bureauNegatives: { tu: { count: 3 }, eq: { count: 2 }, ex: { count: 0 } },
      bureaus: {
        EX: { scores: [
          { modelName: "Experian/Fair Isaac Risk Model V9", scoreValue: "712" },
          { modelName: "Income Insight", scoreValue: "97" }
        ]},
        EQ: { scores: [
          { modelName: "Consumer IncomeView+ Model", scoreValue: "81", scoreMaximumValue: "300" },
          { modelName: "FICO Score 9", scoreValue: "641" }
        ]}
      }
    }
  };
  const out = await buildCloserDeck(fakeDb({ client: { ...CLIENT, outcome_tier: "FUNDING_PLUS_REPAIR" }, crs }), {
    orgId: ORG, clientId: CID
  });
  assert.equal(out.engine.available, true);
  assert.equal(out.engine.tier, "FUNDING_PLUS_REPAIR");
  assert.equal(out.engine.fico.ex, 712);
  assert.equal(out.engine.fico.tu, 648);
  assert.equal(out.engine.total, 127500);
  assert.equal(out.engine.afterFix, 214000);
  assert.equal(out.engine.negItems, 5);
  assert.equal(out.engine.reasons[0][0], "M2-013 · TU");
  assert.equal(out.income_estimates.experian.annual, 97000);
  assert.equal(out.income_estimates.equifax.annual, 81000);
});

test("empty CRS object is unavailable, not zeros", async () => {
  const out = await buildCloserDeck(fakeDb({ client: CLIENT, crs: { result: {}, outcome_tier: null } }), {
    orgId: ORG, clientId: CID
  });
  assert.equal(out.engine.available, false);
  assert.equal(out.engine.fico.ex, null);
  assert.equal(out.engine.total, null);
});

test("selectedOfferKey: funding vs descent vs education", () => {
  assert.equal(selectedOfferKey({ edu: false, forceRepair: false, tier: "FULL_FUNDING", rung: 0 }), "FUNDING_DFY");
  assert.equal(selectedOfferKey({ edu: false, forceRepair: true, tier: "FULL_FUNDING", rung: 0 }), "REPAIR_DFY");
  assert.equal(selectedOfferKey({ edu: false, forceRepair: true, tier: "FULL_FUNDING", rung: 1 }), "REPAIR_TRIAL");
  assert.equal(selectedOfferKey({ edu: true, forceRepair: false, tier: "REPAIR_ONLY", rung: 0 }), "FUNDING_MASTERY");
  assert.equal(selectedOfferKey({ edu: true, forceRepair: false, tier: "REPAIR_ONLY", rung: 1 }), "UWIQ_DELIVERABLES");
});

test("generateDeckLetters refuses the qualified funding offer", async () => {
  await assert.rejects(
    () => generateDeckLetters(fakeDb({ client: CLIENT }), {
      orgId: ORG, clientId: CID, staffId: "s1", offerKey: "FUNDING_DFY", tier: "FULL_FUNDING"
    }),
    (e) => e instanceof CloserDeckError && e.code === "letters_blocked_funding_route" && e.status === 409
  );
});
