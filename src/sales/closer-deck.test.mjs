import { test } from "node:test";
import assert from "node:assert/strict";
import { OFFERS } from "../config/offers.mjs";
import {
  buildCloserDeck,
  selectedOfferKey,
  generateDeckLetters,
  sendDeckPayLink,
  CloserDeckError
} from "./closer-deck.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const CID = "22222222-2222-4222-8222-222222222222";

function fakeDb({
  client = null,
  crs = null,
  businesses = [],
  tradelines = [],
  liabilities = []
} = {}) {
  return {
    async query(sql) {
      const s = String(sql);
      if (/FROM clients c/i.test(s)) {
        return { rows: client ? [client] : [] };
      }
      if (/FROM crs_results/i.test(s)) {
        return { rows: crs ? [crs] : [] };
      }
      if (/FROM businesses/i.test(s)) {
        return { rows: businesses };
      }
      if (/FROM tradelines/i.test(s)) {
        return { rows: tradelines };
      }
      if (/FROM card_liabilities/i.test(s)) {
        return { rows: liabilities };
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
  assert.equal(out.engine.afterFix, 214000);
  /* Headline dollars come from the UnderwriteIQ stack, not the canned CRS 127500. */
  const { toBureaus } = await import("../underwrite/adapter.mjs");
  const { computeUnderwrite } = await import("../underwrite/engine.mjs");
  const { applyStackedBusinessFunding } = await import("../underwrite/business-funding.mjs");
  const adapter = toBureaus({
    tradelines: [],
    liabilities: [],
    crsResults: [crs],
    customFields: CLIENT.custom_fields,
    businesses: []
  });
  const stacked = applyStackedBusinessFunding(
    computeUnderwrite(adapter.bureaus, adapter.businessAgeMonths),
    adapter.businessAges
  );
  assert.equal(out.engine.total, stacked.totals.total_combined_funding);
  assert.equal(out.engine.negItems, 5);
  assert.equal(out.engine.reasons[0][0], "M2-013 · TU");
  assert.equal(out.income_estimates.experian.annual, 97000);
  assert.equal(out.income_estimates.equifax.annual, 81000);
});

test("the headline is not $0 when the accounts are in the pull but not the table", async () => {
  /* THE LIVE FAILURE THIS CLOSES. Present showed a client
     "PRE-APPROVED FOR APPROXIMATELY $0" directly under 718 / 731 / 724 and the
     words FULL FUNDING, because `tradelines` was empty — the pull-time ingest
     had not run — while the very same stored pull listed four open, seasoned
     accounts. Measured on live 2026-08-27, client 89f1a12f. */
  const crs = {
    id: "33333333-3333-4333-8333-333333333333",
    outcome_tier: "FULL_FUNDING",
    created_at: "2026-08-27T00:00:00Z",
    result: {
      outcome: "FULL_FUNDING",
      preapprovals: { totalCombined: 125000 },
      scores: { ex: 718, eq: 724, tu: 731 },
      tradelines: [{
        creditorName: "American Express Blue Business Cash",
        accountType: "revolving",
        accountIdentifier: "SIM-AMEX-001",
        creditLimitAmount: "25000",
        currentBalance: "4800",
        accountOpenedDate: "2020-08-01",
        apr: "18.49"
      }]
    }
  };
  const out = await buildCloserDeck(
    fakeDb({ client: { ...CLIENT, outcome_tier: "FULL_FUNDING" }, crs, tradelines: [] }),
    { orgId: ORG, clientId: CID }
  );
  assert.equal(out.engine.available, true);
  assert.ok(out.engine.total > 0,
    "a file with an open seasoned card must never be read out to a client as $0");
});

test("stored rows still win — the pull is never read on top of them", async () => {
  const crs = {
    id: "33333333-3333-4333-8333-333333333333",
    outcome_tier: "FULL_FUNDING",
    created_at: "2026-08-27T00:00:00Z",
    result: {
      outcome: "FULL_FUNDING",
      scores: { ex: 718, eq: 724, tu: 731 },
      tradelines: [{
        creditorName: "American Express", accountType: "revolving",
        creditLimitAmount: "25000", currentBalance: "4800",
        accountOpenedDate: "2020-08-01"
      }]
    }
  };
  const stored = {
    id: "44444444-4444-4444-8444-444444444444",
    lender: "Chase", kind: "revolving",
    credit_limit_cents: 1_000_000, balance_cents: 100_000,
    opened_on: "2018-01-01", closed_at: null
  };
  const out = await buildCloserDeck(
    fakeDb({ client: { ...CLIENT, outcome_tier: "FULL_FUNDING" }, crs, tradelines: [stored] }),
    { orgId: ORG, clientId: CID }
  );
  // $10,000 stored limit, not the $25,000 in the pull, and not the two summed.
  assert.equal(out.engine.total, 10_000 * 5.5 * 3);
});

test("two saved companies raise Present's UnderwriteIQ stack vs one, all else equal", async () => {
  const crs = {
    outcome_tier: "FULL_FUNDING",
    created_at: "2026-08-16T00:00:00Z",
    result: {
      environment: "production",
      outcome: "FULL_FUNDING",
      preapprovals: { totalPersonal: 100000, totalBusiness: 50000, totalCombined: 150000 },
      scores: { perBureau: { ex: 720, tu: 710, eq: 705 }, ex: 720, tu: 710, eq: 705 }
    }
  };
  const client = {
    ...CLIENT,
    outcome_tier: "FULL_FUNDING",
    custom_fields: {
      ...CLIENT.custom_fields,
      crs_inquiries_ex: 0,
      crs_inquiries_eq: 0,
      crs_inquiries_tu: 0,
      crs_negative_items_count: 0,
      crs_late_payments_count: 0
    }
  };
  const tradelines = [{
    id: "tl1",
    lender: "Chase",
    kind: "revolving",
    credit_limit_cents: 2_000_000,
    balance_cents: 400_000,
    apr: "0.1899",
    closed_at: null,
    opened_on: "2018-01-01"
  }];
  const one = await buildCloserDeck(fakeDb({
    client,
    crs,
    tradelines,
    businesses: [{ age_months: 30 }]
  }), { orgId: ORG, clientId: CID });
  const two = await buildCloserDeck(fakeDb({
    client,
    crs,
    tradelines,
    businesses: [{ age_months: 30 }, { age_months: 30 }]
  }), { orgId: ORG, clientId: CID });
  assert.ok(Number.isFinite(one.engine.total) && one.engine.total > 0);
  assert.ok(two.engine.total > one.engine.total);
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

test("first-sale offers skip the upsell gate; deliverables still require it", async () => {
  const db = fakeDb({ client: CLIENT });
  const args = {
    orgId: ORG,
    clientId: CID,
    staffId: "s1",
    checkoutBaseUrl: "https://pay.example/checkout",
    env: {}
  };
  for (const offerKey of ["FUNDING_DFY", "REPAIR_DFY", "REPAIR_TRIAL", "FUNDING_MASTERY"]) {
    await assert.rejects(
      () => sendDeckPayLink(db, { ...args, offerKey }),
      (e) => e instanceof CloserDeckError && e.code !== "sale_motion_required",
      offerKey + " must mint as a first sale"
    );
  }
  await assert.rejects(
    () => sendDeckPayLink(db, { ...args, offerKey: "UWIQ_DELIVERABLES" }),
    (e) => e instanceof CloserDeckError && e.code === "sale_motion_required" && e.status === 400
  );
  await assert.rejects(
    () => sendDeckPayLink(db, { ...args, offerKey: "UWIQ_DELIVERABLES", saleMotion: "upsell" }),
    (e) => e instanceof CloserDeckError && e.code !== "sale_motion_required"
  );
});

test("generateDeckLetters refuses the qualified funding offer", async () => {
  await assert.rejects(
    () => generateDeckLetters(fakeDb({ client: CLIENT }), {
      orgId: ORG, clientId: CID, staffId: "s1", offerKey: "FUNDING_DFY", tier: "FULL_FUNDING"
    }),
    (e) => e instanceof CloserDeckError && e.code === "letters_blocked_funding_route" && e.status === 409
  );
});
