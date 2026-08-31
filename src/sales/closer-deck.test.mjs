import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OFFERS } from "../config/offers.mjs";
import { mergeBureauReports } from "../finance/crs-map.mjs";
import { makeFakeDb } from "../documents/fake-db.mjs";
import { createStore, memoryProvider } from "../documents/store.mjs";
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

/* Hole 16 — a multi-company file was priced off business ages nobody asked
   for. The deck payload now carries every company and its incorporation date,
   so Present can ask for the ones that are blank. */
test("deck payload carries every company and its incorporation date", async () => {
  const out = await buildCloserDeck(fakeDb({
    client: CLIENT,
    businesses: [
      { id: "b1", name: "Fund Horse Holdings", age_months: 48, incorporated_date: null },
      { id: "b2", name: "Fund Horse Logistics", age_months: 79, incorporated_date: "2020-01" },
      { id: "b3", name: "Fund Horse Retail", age_months: 24, incorporated_date: null }
    ]
  }), { orgId: ORG, clientId: CID });

  assert.equal(out.businesses.length, 3);
  assert.deepEqual(out.businesses.map((b) => b.name), [
    "Fund Horse Holdings", "Fund Horse Logistics", "Fund Horse Retail"
  ]);
  assert.deepEqual(out.businesses.map((b) => b.incorporated_date), [null, "2020-01", null]);
  assert.deepEqual(out.businesses.map((b) => b.age_months), [48, 79, 24]);
});

test("a missing incorporation date stays null — never defaulted to a guess", async () => {
  const out = await buildCloserDeck(fakeDb({
    client: CLIENT,
    businesses: [{ id: "b1", name: "Only Co", age_months: null, incorporated_date: "" }]
  }), { orgId: ORG, clientId: CID });

  assert.equal(out.businesses[0].incorporated_date, null);
  assert.equal(out.businesses[0].age_months, null);
});

test("a file with no company gets an empty list, not a fake row", async () => {
  const out = await buildCloserDeck(fakeDb({ client: CLIENT }), { orgId: ORG, clientId: CID });
  assert.deepEqual(out.businesses, []);
});

/* ═══════════════════════════════════════════════════════════════════════════
   THE LETTERS HAVE TO SURVIVE THE CALL.

   generateDeckLetters used to build the pack, count the files, email the client
   that their correction letters were ready, and then let every PDF fall out of
   memory. Nothing was saved anywhere. These run the real entry point against the
   real repair pack — the same sandbox pull ../underwrite/output-baseline.test.mjs
   pins — and prove the bytes land in the documents registry.
   ═══════════════════════════════════════════════════════════════════════════ */

/** A client who reached R4 on a confirmed bureau answer — this releases the complaints. */
const ESCALATED_R4 = Object.freeze([
  Object.freeze({ bureau: "EX", creditor: "EXAMPLE BANK NA", account_last4: "1234", round: "R4" })
]);

const SANDBOX = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../vendor/underwriteiq-full/api/lite/crs/sandbox"
);
const loadSandbox = (name) => JSON.parse(readFileSync(path.join(SANDBOX, name), "utf8"));
const sandboxPull = () => mergeBureauReports({
  reports: { TU: loadSandbox("tu.json"), EX: loadSandbox("exp.json"), EQ: loadSandbox("efx.json") },
  requestIds: { TU: "tu-1", EX: "ex-1", EQ: "eq-1" },
  environment: "sandbox"
});

/**
 * A db that answers what generateDeckLetters actually asks for, and hands every
 * documents-registry statement to the registry double. No message_templates row
 * exists on purpose: sendTemplated returns template_pending without touching a
 * provider, which keeps these tests about storage and nothing else.
 */
function letterPackDb(storedCrs, priorOutcomes = []) {
  const docs = makeFakeDb();
  const clientPatches = [];
  const tagWrites = [];
  return {
    _documents: docs._documents,
    _versions: docs._versions,
    clientPatches,
    tagWrites,
    async query(sql, params) {
      const s = String(sql);
      if (/FROM clients/i.test(s)) {
        return { rows: [{
          first_name: "Fixture",
          last_name: "Client",
          custom_fields: { address: "100 Test Ave", city: "Denton", state: "TX", zip: "76205" },
          outcome_tier: "REPAIR_ONLY"
        }] };
      }
      if (/FROM crs_results/i.test(s)) return { rows: storedCrs ? [{ result: storedCrs }] : [] };
      if (/FROM dispute_items/i.test(s)) return { rows: [...priorOutcomes] };
      if (/FROM message_templates/i.test(s)) return { rows: [] };
      if (/UPDATE clients SET tags/i.test(s)) {
        tagWrites.push(params?.[1]);
        return { rows: [], rowCount: 1 };
      }
      if (/UPDATE clients SET custom_fields/i.test(s)) {
        clientPatches.push(JSON.parse(params[1]));
        return { rows: [], rowCount: 1 };
      }
      return docs.query(sql, params);
    }
  };
}

test("generateDeckLetters SAVES the repair pack — the PDFs reach the documents registry", async () => {
  const db = letterPackDb(sandboxPull(), ESCALATED_R4);
  const store = createStore({ provider: memoryProvider() });

  const out = await generateDeckLetters(db, {
    orgId: ORG, clientId: CID, staffId: "s1", offerKey: "REPAIR_DFY", tier: "REPAIR_ONLY", store
  });

  assert.equal(out.delivered, true);
  assert.equal(out.persistSkipped, null, "the pack was stored, not skipped");
  assert.ok(out.documentsStored > 0,
    "the client is told their letters are ready — something has to have been saved");

  // Every stored row belongs to this org and this client. A document with the
  // wrong stamp is a cross-tenant leak, not a filing mistake.
  assert.ok(db._documents.length > 0);
  assert.ok(db._documents.every((d) => d.org_id === ORG && d.client_id === CID));
  assert.ok(db._documents.every((d) => d.kind === "deliverable"));

  const subtypes = db._documents.map((d) => d.subtype);
  assert.ok(subtypes.includes("metro2_dispute_letter_pack"), "no dispute letter was stored");
  assert.ok(subtypes.includes("cfpb_complaint"), "the CFPB complaint was not stored");
  // Classified off the file's own type. Its filename is
  // "State-Attorney-General-Complaint.pdf", which no filename rule would match.
  assert.ok(subtypes.includes("state_ag_complaint"), "the state AG complaint was not stored");

  // The complaint cover sheet is text. It must never be registered as a PDF.
  assert.ok(!db._documents.some((d) => /\.txt/i.test(d.title || "")),
    "a text cover sheet was stored as application/pdf");

  // The bytes are real and readable back out of the store.
  const first = db._documents[0];
  const got = await store.get(first.storage_key);
  assert.equal(got.body.subarray(0, 4).toString(), "%PDF", `${first.title} is not a PDF`);
});

test("generateDeckLetters records a storage failure instead of losing the call", async () => {
  const db = letterPackDb(sandboxPull());
  const brokenStore = {
    name: "broken",
    async put() { throw new Error("bucket unreachable"); },
    async get() { return null; },
    async del() {}
  };

  const out = await generateDeckLetters(db, {
    orgId: ORG, clientId: CID, staffId: "s1", offerKey: "REPAIR_DFY", tier: "REPAIR_ONLY",
    store: brokenStore
  });

  assert.equal(out.delivered, true, "the letters were still generated");
  assert.equal(out.documentsStored, 0);
  assert.match(out.persistSkipped, /bucket unreachable/,
    "a storage failure has to be reported, not swallowed");
});
