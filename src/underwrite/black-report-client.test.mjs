import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildBlackReportClient,
  emptyBlackReportClient,
  hasBlackReportSource,
  mergeStoredUnderwrite
} from "./black-report-client.mjs";

const FIXTURE_PERSONAL = {
  name: "Fixture Client",
  address: "100 Test Ave\nDenton, TX 76205",
  state: "TX"
};

const FIXTURE_ENGINE = {
  outcome: "FUNDING_PLUS_REPAIR",
  consumerSignals: {
    scores: { median: 610, perBureau: { ex: 600, eq: 610, tu: 620 } },
    utilization: { totalBalance: 800, totalLimit: 2000, pct: 40 },
    bureauNegatives: {
      experian: {
        pulled: true,
        clean: false,
        count: 1,
        items: [{ creditorName: "TEST CARD BANK", source: "experian", currentRatingType: "ChargeOff", balance: 400 }]
      },
      equifax: { pulled: true, clean: true, count: 0, items: [] },
      transunion: { pulled: true, clean: true, count: 0, items: [] }
    }
  },
  preapprovals: { totalCombined: 5000 },
  projectedPreapproval: { totalCombined: 9000 },
  businessSignals: { available: false },
  normalized: {
    tradelines: [
      {
        source: "experian",
        creditorName: "TEST CARD BANK",
        accountType: "revolving",
        status: "open",
        isDerogatory: true,
        isAU: false,
        currentBalance: 800,
        effectiveLimit: 2000,
        currentRatingType: "ChargeOff"
      },
      {
        source: "transunion",
        creditorName: "TEST AUTO LENDER",
        accountType: "installment",
        status: "open",
        isDerogatory: false,
        isAU: false,
        currentBalance: 12000
      }
    ],
    inquiries: [
      { source: "experian", creditorName: "TEST PULL A", date: "2024-04-01" },
      { source: "experian", creditorName: "TEST PULL A", date: "2024-04-02" },
      { source: "equifax", creditorName: "TEST PULL B", date: "2024-05-28" }
    ],
    identity: {
      names: [
        { first: "FIXTURE", last: "CLIENT", source: "experian" },
        { first: "F", last: "CLIENT", source: "equifax" }
      ],
      addresses: [
        { line1: "100 TEST AVE", city: "DENTON", state: "TX", zip: "76205", source: "experian" }
      ],
      employers: [{ name: "TEST CO", source: "experian" }],
      ssns: [],
      dobs: [{ value: "1990-01-01", source: "equifax" }]
    },
    publicRecords: []
  }
};

test("empty client has no Jordan Sample leftovers", () => {
  const raw = JSON.stringify(emptyBlackReportClient());
  assert.doesNotMatch(raw, /Jordan Sample|SYNCB\/LEVITZ|SIGNET BANK|5815 Knoll/);
});

test("missing engine leaves facts empty — does not invent numbers", () => {
  const client = buildBlackReportClient({ personal: FIXTURE_PERSONAL });
  assert.equal(client.applicant, "Fixture Client");
  assert.equal(client.address, "100 Test Ave, Denton, TX 76205");
  assert.equal(client.state, "TX");
  assert.deepEqual(client.scores, {});
  assert.equal(client.preapproval_now, null);
  assert.equal(client.preapproval_after, null);
  assert.equal(client.negatives.length, 0);
  assert.equal(client.revolving.length, 0);
  assert.equal(client.lenders.length, 0);
  assert.equal(client.llc_fee, null);
  assert.deepEqual(client.score_targets, { experian: "", equifax: "", transunion: "", median: "" });
  assert.doesNotMatch(JSON.stringify(client.score_targets), /690|670|725/);
  assert.doesNotMatch(JSON.stringify(client), /Jordan Sample|7936|19841/);
});

test("maps UnderwriteIQ scores, util, negatives, and inquiries from a fixture", () => {
  const client = buildBlackReportClient({ crsResult: FIXTURE_ENGINE, personal: FIXTURE_PERSONAL });
  assert.deepEqual(client.scores, { experian: 600, equifax: 610, transunion: 620 });
  assert.equal(client.outcome, "FUNDING_PLUS_REPAIR");
  assert.equal(client.preapproval_now, 5000);
  assert.equal(client.preapproval_after, 9000);
  assert.equal(client.util_total_balance, 800);
  assert.equal(client.util_total_limit, 2000);
  assert.equal(client.util_pct, "40%");
  assert.equal(client.util_target_balance, 200);
  assert.equal(client.bureaus.length, 3);
  assert.equal(client.bureaus[0][0], "Experian");
  assert.equal(client.bureaus[0][1], "DIRTY");
  assert.equal(client.revolving.length, 1);
  assert.equal(client.revolving[0][0], "TEST CARD BANK");
  assert.equal(client.revolving[0][2], 800);
  assert.equal(client.revolving[0][3], 2000);
  assert.equal(client.negatives.length, 1);
  assert.equal(client.negatives[0].creditor, "TEST CARD BANK");
  assert.equal(client.negatives[0].why, "");
  assert.equal(client.negatives[0].detail, "");
  assert.equal(client.installments.length, 1);
  assert.equal(client.installments[0][0], "TEST AUTO LENDER");
  const exInq = client.inquiries.find((row) => row[0] === "Experian");
  assert.equal(exInq[1], 2);
  assert.match(exInq[3], /TEST PULL A \(2x\)/);
  assert.equal(client.personal_data[0][0], "Name Variations");
  assert.doesNotMatch(JSON.stringify(client), /Jordan Sample|SYNCB\/LEVITZ|SIGNET BANK/);
  assert.ok(client.lenders.length > 0, "lender matrix fills from engine signals");
  for (const row of client.lenders) {
    // Two columns were added 2026-09-04 for F45: the bucket this lender fell in
    // and what the matcher said is still needed. Nine columns before, eleven now.
    assert.equal(row.length, 11);
    assert.equal(typeof row[3], "number");
    assert.equal(typeof row[4], "number");
    assert.ok(row[9] === "now" || row[9] === "after", "every lender carries its bucket");
  }
});

test("hasBlackReportSource is true only when all three bureau scores exist", () => {
  assert.equal(hasBlackReportSource(FIXTURE_ENGINE), true);
  assert.equal(hasBlackReportSource(null), false);
  assert.equal(hasBlackReportSource({ normalized: { tradelines: [{}] } }), false);
  assert.equal(hasBlackReportSource({
    consumerSignals: { scores: { perBureau: { ex: 600, eq: 610, tu: null } } }
  }), false);
});

test("reads stored CRS scores and tradeline aliases (fundhub file shape)", () => {
  const stored = {
    outcome: "FULL_FUNDING",
    scores: { ex: 601, eq: 611, tu: 621 },
    consumerSignals: { scores: { perBureau: { ex: 601, eq: 611, tu: 621 } }, utilization: { pct: 22 } },
    preapprovals: { totalCombined: 4100 },
    tradelines: [
      {
        bureau: "EX",
        creditorName: "STORED CARD",
        accountType: "revolving",
        paymentStatus: "open",
        currentBalanceAmount: 220,
        creditLimitAmount: 1000
      }
    ],
    inquiries: [{ bureau: "EX", creditorName: "STORED PULL", inquiryDate: "2024-01-02" }]
  };
  const client = buildBlackReportClient({ crsResult: stored, personal: FIXTURE_PERSONAL });
  assert.deepEqual(client.scores, { experian: 601, equifax: 611, transunion: 621 });
  assert.equal(client.revolving.length, 1);
  assert.equal(client.revolving[0][0], "STORED CARD");
  assert.equal(client.revolving[0][2], 220);
  assert.equal(client.revolving[0][3], 1000);
  assert.equal(client.inquiries[0][0], "Experian");
  assert.equal(client.inquiries[0][1], 1);
  assert.equal(hasBlackReportSource(stored), true);
  assert.equal(client.bureaus.length, 3);
  assert.equal(client.bureaus[0][0], "Experian");
  assert.equal(client.bureaus[0][1], "CLEAN");
});

test("mergeStoredUnderwrite keeps stored scores when the re-run engine lost them", () => {
  const stored = { scores: { ex: 601, eq: 611, tu: 621 }, tradelines: [{ bureau: "EX", creditorName: "STORED CARD" }] };
  const engine = {
    outcome: "FULL_FUNDING",
    consumerSignals: { scores: { perBureau: { ex: null, eq: null, tu: null } } },
    normalized: { tradelines: [], inquiries: [], identity: {} }
  };
  const merged = mergeStoredUnderwrite(engine, stored);
  assert.equal(hasBlackReportSource(merged), true);
  const client = buildBlackReportClient({ crsResult: merged, personal: FIXTURE_PERSONAL });
  assert.deepEqual(client.scores, { experian: 601, equifax: 611, transunion: 621 });
});

test("does not invent a missing bureau score", () => {
  const partial = {
    ...FIXTURE_ENGINE,
    consumerSignals: {
      ...FIXTURE_ENGINE.consumerSignals,
      scores: { median: 600, perBureau: { ex: 600, eq: null, tu: 620 } }
    }
  };
  const client = buildBlackReportClient({ crsResult: partial, personal: FIXTURE_PERSONAL });
  assert.deepEqual(client.scores, { experian: 600, transunion: 620 });
  assert.equal(Object.prototype.hasOwnProperty.call(client.scores, "equifax"), false);
  assert.equal(hasBlackReportSource(partial), false);
});

/* ═══════════════════════════════════════════════════════════════════════════
   THE 2026-09-04 DELIVERABLES REBUILD — F43, F44, F45, F50
   ═══════════════════════════════════════════════════════════════════════════ */

/** One card and one car loan, each reporting to all three bureaus, as a real
    tri-merge pull arrives. Three copies of two accounts. */
const TRIPLED = Object.freeze({
  outcome: "FULL_FUNDING",
  pulledAt: "2026-07-25T12:00:00.000Z",
  consumerSignals: {
    scores: { median: 700, perBureau: { ex: 700, eq: 705, tu: 695 } },
    utilization: { totalBalance: 6300, totalLimit: 36000, pct: 18 }
  },
  preapprovals: { totalCombined: 50000 },
  projectedPreapproval: { totalCombined: 60000 },
  businessSignals: { available: false },
  findings: [
    { code: "UTIL_CARD_OVER_10", category: "utilization", severity: "medium", customerSafe: true,
      plainEnglishProblem: "Your TEST CARD is at 18% utilization.", whyItMatters: "Lenders notice.",
      whatToDoNext: "Pay it to $1,200 or less.", targetState: "TEST CARD under 10%" },
    { code: "UTIL_CARD_OVER_10", category: "utilization", severity: "medium", customerSafe: true,
      plainEnglishProblem: "Your TEST CARD is at 18% utilization.", whyItMatters: "Lenders notice.",
      whatToDoNext: "Pay it to $1,200 or less.", targetState: "TEST CARD under 10%" },
    { code: "UTIL_MODERATE", category: "utilization", severity: "medium", customerSafe: true,
      plainEnglishProblem: "Your utilization is at 18%.", whyItMatters: "Under 10% is the target.",
      whatToDoNext: "Get total balances under $3,600.", targetState: "Overall utilization under 10%" },
    { code: "INQUIRY_CLEANUP", category: "inquiries", severity: "info", customerSafe: true,
      plainEnglishProblem: "You have 4 inquiries.", whyItMatters: "They do not affect funding here.",
      whatToDoNext: "We remove what we can.", targetState: "Inquiries cleaned up" },
    { code: "FUNDING_FIRST", category: "strategic", severity: "high", customerSafe: true,
      plainEnglishProblem: "You qualify for funding.", whyItMatters: "New accounts hurt.",
      whatToDoNext: "Get funded first.", targetState: "Secure funding before new accounts" },
    { code: "NO_BUSINESS_ENTITY", category: "business", severity: "low", customerSafe: true,
      plainEnglishProblem: "You do not have a registered business entity on file.",
      whyItMatters: "Business credit needs one.", whatToDoNext: "Form an LLC.",
      targetState: "LLC or corporation registered" }
  ],
  normalized: {
    tradelines: ["transunion", "experian", "equifax"].flatMap((source) => ([
      { source, creditorName: "TEST CARD", accountIdentifier: "TEST-CARD-1234", accountType: "revolving",
        status: "open", isAU: false, isDerogatory: false, currentBalance: 2100, effectiveLimit: 12000,
        openedDate: null, currentRatingType: "AsAgreed" },
      { source, creditorName: "TEST AUTO", accountIdentifier: "TEST-AUTO-5678", accountType: "installment",
        status: "open", isAU: false, isDerogatory: false, currentBalance: 14200, openedDate: null,
        currentRatingType: "AsAgreed" }
    ])),
    inquiries: [],
    identity: { names: [], addresses: [], employers: [], ssns: [], dobs: [] }
  }
});

test("F43 — one account reporting to three bureaus is ONE row, and the totals match", () => {
  const client = buildBlackReportClient({ crsResult: TRIPLED, personal: FIXTURE_PERSONAL });
  assert.equal(client.revolving.length, 1, "three copies of one card must print once");
  assert.equal(client.installments.length, 1, "three copies of one car loan must print once");
  assert.equal(client.revolving[0][1], "TransUnion, Experian, Equifax",
    "the row names every bureau the account was found on");
  // The engine's tri-merge totals are 6300 / 36000. The printed totals are the
  // real ones. The PERCENTAGE is the engine's and does not move.
  assert.equal(client.util_total_balance, 2100);
  assert.equal(client.util_total_limit, 12000);
  assert.equal(client.util_target_balance, 1200);
  assert.equal(client.util_pct, "18%", "the engine still owns the percentage");
});

test("F43 — two different accounts at the same creditor stay two rows", () => {
  const twoCards = {
    ...TRIPLED,
    normalized: {
      ...TRIPLED.normalized,
      tradelines: [
        { source: "experian", creditorName: "TEST CARD", accountIdentifier: "TEST-CARD-1111",
          accountType: "revolving", status: "open", currentBalance: 100, effectiveLimit: 1000, openedDate: null },
        { source: "experian", creditorName: "TEST CARD", accountIdentifier: "TEST-CARD-2222",
          accountType: "revolving", status: "open", currentBalance: 200, effectiveLimit: 2000, openedDate: null }
      ]
    }
  };
  const client = buildBlackReportClient({ crsResult: twoCards, personal: FIXTURE_PERSONAL });
  assert.equal(client.revolving.length, 2);
});

test("F45 — the two lender buckets stay apart", () => {
  const client = buildBlackReportClient({ crsResult: TRIPLED, personal: FIXTURE_PERSONAL });
  assert.ok(client.lenders_now.length > 0, "a 700-median FULL_FUNDING file has lenders available today");
  assert.ok(client.lenders_after.length > 0, "and lenders that are not open yet");
  assert.equal(client.lenders.length, client.lenders_now.length + client.lenders_after.length);
  for (const row of client.lenders_now) assert.equal(row[9], "now");
  for (const row of client.lenders_after) assert.equal(row[9], "after");
  assert.ok(client.lenders_after.some((row) => /business entity required/i.test(row[10])),
    "a client with no company must be told the entity is what is missing");
  assert.equal(client.lenders_now.some((row) => /business entity required/i.test(row[10])), false,
    "nothing in the available-now bucket may still be asking for an entity");
});

test("F44 — a company on file unlocks the lenders that want one, and stops the LLC advice", () => {
  const without = buildBlackReportClient({ crsResult: TRIPLED, personal: FIXTURE_PERSONAL });
  const withBiz = buildBlackReportClient({
    crsResult: TRIPLED,
    personal: FIXTURE_PERSONAL,
    business: { hasEntity: true, ageMonths: 72, name: "Test Holdings LLC" }
  });
  assert.ok(withBiz.lenders_now.length > without.lenders_now.length,
    "a six-year-old company must open lenders that a client with none cannot reach");
  assert.equal(withBiz.business.hasEntity, true);
  assert.equal(withBiz.business.ageMonths, 72);
  assert.ok(without.costing_you.some((row) => row.code === "NO_BUSINESS_ENTITY"),
    "a client with no company is still told to form one");
  assert.equal(withBiz.costing_you.some((row) => row.code === "NO_BUSINESS_ENTITY"), false,
    "a client with a company must never be told to go and form one");
  // THE MONEY DOES NOT MOVE. Business funding needs a business credit report,
  // not an age (vendor estimate-preapprovals.js, owner rule F15).
  assert.equal(withBiz.preapproval_now, without.preapproval_now);
  assert.equal(withBiz.preapproval_after, without.preapproval_after);
});

test("F50 — the cover date is the day the file was pulled, never blank", () => {
  const client = buildBlackReportClient({ crsResult: TRIPLED, personal: FIXTURE_PERSONAL });
  assert.equal(client.date, "July 25, 2026");
  assert.equal(buildBlackReportClient({}).date, "", "no pull, no date");
});

test("the booking link is a real address, never the template placeholder", () => {
  const client = buildBlackReportClient({ crsResult: TRIPLED, personal: FIXTURE_PERSONAL });
  assert.match(client.booking_url, /^https?:\/\//);
  assert.doesNotMatch(client.booking_url, /fundhubbookingurl\.template/);
  const own = buildBlackReportClient({
    crsResult: TRIPLED,
    personal: { ...FIXTURE_PERSONAL, bookingUrl: "https://apply.fundhub.ai/own-link" }
  });
  assert.equal(own.booking_url, "https://apply.fundhub.ai/own-link");
});

test("the ranked sections are the engine's own findings, de-duplicated and split", () => {
  const client = buildBlackReportClient({ crsResult: TRIPLED, personal: FIXTURE_PERSONAL });
  const codes = client.costing_you.map((row) => row.code);
  assert.equal(codes.filter((c) => c === "UTIL_CARD_OVER_10").length, 1,
    "the tri-merge repeat of one card's finding must collapse to one");
  assert.equal(codes.includes("INQUIRY_CLEANUP"), false, "inquiries are not costing anyone money");
  assert.equal(codes.includes("FUNDING_FIRST"), false, "advice is not a cost");
  assert.ok(client.not_a_factor.some((row) => row.code === "INQUIRY_CLEANUP"));
  assert.ok(client.strategy.some((row) => row.code === "FUNDING_FIRST"));
  // Every sentence printed comes from the engine, not from the printer.
  const util = client.costing_you.find((row) => row.code === "UTIL_CARD_OVER_10");
  assert.deepEqual(util.lines, [
    "Your TEST CARD is at 18% utilization.", "Lenders notice.", "Pay it to $1,200 or less."
  ]);
  // The one number corrected: the overall target was a tri-merge total.
  const overall = client.costing_you.find((row) => row.code === "UTIL_MODERATE");
  assert.match(overall.lines[2], /\$1,200/);
  assert.doesNotMatch(overall.lines[2], /\$3,600/);
});
