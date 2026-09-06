import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildBlackReportClient,
  classifyProseGate,
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
    { code: "INQUIRY_DUPLICATE", category: "inquiries", severity: "info", customerSafe: true,
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
  assert.equal(codes.includes("INQUIRY_DUPLICATE"), false, "inquiries are not costing anyone money");
  assert.equal(codes.includes("FUNDING_FIRST"), false, "advice is not a cost");
  assert.ok(client.not_a_factor.some((row) => row.code === "INQUIRY_DUPLICATE"));
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

/* ═══════════════════════════════════════════════════════════════════════════
   ROUND 2 REPAIR, 2026-09-04. Four defects a verifier found in the work above,
   each of which the fixtures above could not fire.
   ═══════════════════════════════════════════════════════════════════════════ */

/** The same file at 45% utilization, which is the band the engine reports with
    UTIL_OVERALL_HIGH rather than UTIL_MODERATE. One card, three bureau copies,
    $4,500 of a $10,000 limit. The engine's own totals are the tri-merge ones. */
const OVER_THIRTY = Object.freeze({
  ...TRIPLED,
  consumerSignals: {
    scores: { median: 700, perBureau: { ex: 700, eq: 705, tu: 695 } },
    utilization: { totalBalance: 13500, totalLimit: 30000, pct: 45 }
  },
  findings: [
    { code: "UTIL_OVERALL_HIGH", category: "utilization", severity: "high", customerSafe: true,
      plainEnglishProblem: "Across all your credit cards, you are using 45% of your available credit. That is $13,500 in balances against $30,000 in limits.",
      whyItMatters: "For the best scores and highest funding amounts, you want to be under 10% total.",
      whatToDoNext: "Get your total balances down to about $3,000. The lower your utilization, the higher your pre-approval amount and the better your approval odds.",
      targetState: "Overall utilization under 10%" }
  ],
  normalized: {
    ...TRIPLED.normalized,
    tradelines: ["transunion", "experian", "equifax"].map((source) => ({
      source, creditorName: "TEST CARD", accountIdentifier: "TEST-CARD-1234",
      accountType: "revolving", status: "open", isAU: false, isDerogatory: false,
      currentBalance: 4500, effectiveLimit: 10000, openedDate: null, currentRatingType: "AsAgreed"
    }))
  }
});

test("the code the engine really emits above 30% utilization is the one corrected", () => {
  const client = buildBlackReportClient({ crsResult: OVER_THIRTY, personal: FIXTURE_PERSONAL });
  assert.equal(client.util_total_balance, 4500);
  assert.equal(client.util_total_limit, 10000);
  assert.equal(client.util_target_balance, 1000);
  const overall = client.costing_you.find((row) => row.code === "UTIL_OVERALL_HIGH");
  assert.ok(overall, "UTIL_OVERALL_HIGH must reach the ranked list at all");
  // Each tri-merge figure is swapped for ITS OWN de-duplicated counterpart.
  assert.equal(
    overall.lines[0],
    "Across all your credit cards, you are using 45% of your available credit. That is $4,500 in balances against $10,000 in limits."
  );
  assert.match(overall.lines[2], /down to about \$1,000\./);
  // The percentage is the engine's and never moves.
  assert.equal(client.util_pct, "45%");
  // And no tri-merge dollar survives anywhere in the finding.
  const joined = overall.lines.join(" ");
  for (const stale of ["$13,500", "$30,000", "$3,000"]) {
    assert.equal(joined.includes(stale), false, `${stale} is a tri-merge figure and must be gone`);
  }
});

test("authorized-user findings sit in 'does not affect your funding', never in 'costing you money'", () => {
  const auFile = {
    ...OVER_THIRTY,
    findings: [
      { code: "AU_HIGH_UTIL", category: "utilization", severity: "medium", customerSafe: true,
        plainEnglishProblem: "You are listed as an authorized user on a MOM CARD card, and it is at 80% utilization. You are not responsible for this debt — it is someone else's account.",
        whyItMatters: "Even though this is not your debt, it still counts against your credit utilization.",
        whatToDoNext: "Ask the main cardholder to pay it down.", targetState: "Remove or reduce AU card utilization" },
      { code: "AU_NEGATIVE_MARKS", category: "tradeline_quality", severity: "high", customerSafe: true,
        plainEnglishProblem: "You are on a DAD CARD card as an authorized user, and it has late payments hurting your credit.",
        whyItMatters: "The negative history still counts against you.",
        whatToDoNext: "Ask to be removed as an authorized user.", targetState: "Remove bad AU account" },
      { code: "AU_GOOD_KEEP", category: "tradeline_quality", severity: "info", customerSafe: true,
        plainEnglishProblem: "Your SIS CARD authorized user account is helping your credit.",
        whyItMatters: "It adds age and positive history.", whatToDoNext: "Keep this one.",
        targetState: "Maintain good AU accounts" }
    ]
  };
  const client = buildBlackReportClient({ crsResult: auFile, personal: FIXTURE_PERSONAL });
  const costing = client.costing_you.map((row) => row.code);
  const notAFactor = client.not_a_factor.map((row) => row.code);
  for (const code of ["AU_HIGH_UTIL", "AU_NEGATIVE_MARKS", "AU_GOOD_KEEP"]) {
    assert.equal(costing.includes(code), false, `${code} must not be ranked as costing money`);
    assert.ok(notAFactor.includes(code), `${code} must appear under does-not-affect-funding`);
  }
});

test("a lender is only 'open to you today' when every gate it states is met", () => {
  const withBiz = buildBlackReportClient({
    crsResult: TRIPLED,
    personal: FIXTURE_PERSONAL,
    business: { hasEntity: true, ageMonths: 72, name: "Test Holdings LLC" }
  });
  assert.ok(withBiz.lenders_now.length > 0, "a company on file still opens business lenders");
  // Nothing in this product captures business revenue, so a revenue floor is
  // unknown, and unknown is not met.
  for (const row of withBiz.lenders_now) {
    assert.equal(/revenue/i.test(String(row[7] || "")), false,
      `${row[0]} states a revenue floor and cannot be called available today`);
  }
  const moved = withBiz.lenders_after.filter((row) => /revenue required \(not on file\)/i.test(String(row[10] || "")));
  assert.ok(moved.length > 0, "the revenue-gated lenders must still be listed, with the floor named");
  // They are moved, not dropped: every matched lender still reaches the client.
  assert.equal(withBiz.lenders.length, withBiz.lenders_now.length + withBiz.lenders_after.length);

  /* A GATE STATED IN PROSE IS STILL A GATE. Two lenders state one in their own
     whyFit text and the vendor matcher reads neither: Fundbox wants a business
     bank account, Navy Federal wants membership. This product records neither,
     so neither can be called available today. Before this, a client with a
     company 24 months old or older was told eleven lenders were open, two of
     them on a requirement nobody had checked. */
  const nowNames = withBiz.lenders_now.map((row) => row[0]);
  for (const name of ["Fundbox", "Navy Federal*"]) {
    assert.equal(nowNames.includes(name), false,
      `${name} states a requirement this system never checks and cannot be called available today`);
  }
  const byName = new Map(withBiz.lenders_after.map((row) => [row[0], row]));
  assert.match(String(byName.get("Fundbox")?.[10] || ""), /business bank account \(not on file\)/i);
  assert.match(String(byName.get("Navy Federal*")?.[10] || ""), /membership eligibility \(not on file\)/i);
  // And a lender whose prose says it wants LESS is not mistaken for a gate.
  assert.ok(nowNames.includes("Lending Club"),
    '"No business required" is not a requirement and must not hold a lender back');
});

test("PROSE_GATE_COMPLETENESS — every requirement the vendor states in words is classified", () => {
  /* classifyProseGate() is a list of phrases. A list of phrases rots the moment
     somebody edits the vendor file, and the way it rots is silent: a new
     requirement nobody classified gets printed as an availability.

     So this re-reads lender-matrix.js and fails if any lender's whyFit mentions
     a requirement in a form the classifier has not seen. The classifier's own
     fallback is conservative — an unrecognised requirement is treated as
     unverified — so the failure mode is a lender wrongly HELD BACK, never one
     wrongly promised. This test is what turns that into a visible decision. */
  const matrix = readFileSync(
    new URL("../../vendor/underwriteiq-full/api/lite/crs/lender-matrix.js", import.meta.url), "utf8"
  );
  const whyFits = [...matrix.matchAll(/whyFit:\s*"([^"]*)"/g)].map((m) => m[1]);
  assert.ok(whyFits.length >= 15, `expected the vendor's fifteen lenders, read ${whyFits.length}`);
  const stated = whyFits.filter((text) => /requir/i.test(text));
  assert.deepEqual(stated.sort(), [
    "Best rates if you are eligible. Requires membership.",
    "Clean bureaus plus business bank account required.",
    "Personal loan. No business required."
  ], "the vendor's requirement wording moved — reclassify it in PROSE_GATES before shipping");
  for (const text of stated) {
    const gate = classifyProseGate(text);
    assert.equal(gate.stated, true, `"${text}" states a requirement`);
    if (/no business required/i.test(text)) {
      assert.equal(gate.unverified, false, "a lender wanting less is not a gate");
      assert.equal(gate.needed, null);
    } else {
      assert.equal(gate.unverified, true, `"${text}" names something this system does not record`);
      assert.match(String(gate.needed), /not on file/i);
    }
  }
  // The safe default, spelled out: an unclassified requirement holds a lender back.
  const unseen = classifyProseGate("Requires a notarised llama.");
  assert.equal(unseen.stated, true);
  assert.equal(unseen.unverified, true);
});

test("a card with no credit limit has no paydown target, and no total pretends it does", () => {
  const npsl = {
    ...TRIPLED,
    normalized: {
      ...TRIPLED.normalized,
      tradelines: [
        { source: "experian", creditorName: "AMEX PLATINUM (NPSL)", accountIdentifier: "AMEX-1",
          accountType: "revolving", status: "open", currentBalance: 5200, effectiveLimit: null, openedDate: null },
        { source: "experian", creditorName: "TEST CARD", accountIdentifier: "TEST-CARD-1234",
          accountType: "revolving", status: "open", currentBalance: 2100, effectiveLimit: 12000, openedDate: null }
      ]
    }
  };
  const client = buildBlackReportClient({ crsResult: npsl, personal: FIXTURE_PERSONAL });
  const amex = client.revolving.find((row) => row[0] === "AMEX PLATINUM (NPSL)");
  assert.equal(amex[3], null, "an unknown limit stays unknown, never 0");
  assert.equal(amex[5], "", "and no 10% target is invented for it");
  // The card with no limit stays out of the totals entirely — its balance in a
  // numerator with nothing under it would overstate the paydown.
  assert.equal(client.util_total_balance, 2100);
  assert.equal(client.util_total_limit, 12000);
  assert.equal(client.util_target_balance, 1200);
});

test("the WeasyPrint printer can still unpack a lender row", () => {
  /* scripts/black-reports/fundhub_gen.py reads these rows POSITIONALLY, in three
     places. When lenderRow() grew from nine columns to eleven, every one of them
     raised ValueError, black-report-pdf.mjs caught the non-zero exit and quietly
     fell back to the Node printer, and no test or log ever said the designed
     printer had died. This is the guard that says it. */
  const script = readFileSync(
    new URL("../../scripts/black-reports/fundhub_gen.py", import.meta.url), "utf8"
  );
  /* The three loops used to read `c["lenders"]` directly. F45 split that list
     into the matcher's own two buckets, so they now read the `locked` / `after`
     names lender_buckets() hands back — the UNPACK is unchanged and is still
     what breaks, so this matches the unpack rather than the source list. */
  const sites = [...script.matchAll(/for\s+(nm,[^\n]+?)\s+in\s+\w+:/g)];
  assert.equal(sites.length, 3, "the three unpack sites must all still be found");
  const client = buildBlackReportClient({ crsResult: TRIPLED, personal: FIXTURE_PERSONAL });
  const width = client.lenders[0].length;
  for (const [line, names] of sites) {
    const parts = names.split(",").map((s) => s.trim());
    const starred = parts.some((p) => p.startsWith("*"));
    const fixed = parts.filter((p) => !p.startsWith("*")).length;
    assert.ok(
      starred ? width >= fixed : width === fixed,
      `a ${width}-column lender row cannot be unpacked by \`${line}\``
    );
  }
});

test("KNOWN LIMIT of the tri-merge merge: differing account identifiers stay separate", () => {
  /* Not a defect being fixed — a boundary being written down. accountKey merges
     on creditor + account identifier. Where the bureaus report DIFFERENT masked
     identifiers for the same physical card, both lines survive, exactly as
     ../finance/crs-map.mjs decided: matching them needs a creditor/open-date/limit
     heuristic, a wrong match either hides an account or invents available credit,
     and nobody has decided that rule. */
  const differing = {
    ...TRIPLED,
    normalized: {
      ...TRIPLED.normalized,
      tradelines: [
        { source: "experian", creditorName: "TEST CARD", accountIdentifier: "XXXX1234",
          accountType: "revolving", status: "open", currentBalance: 2100, effectiveLimit: 12000, openedDate: null },
        { source: "equifax", creditorName: "TEST CARD", accountIdentifier: "XXXXXX1234",
          accountType: "revolving", status: "open", currentBalance: 2105, effectiveLimit: 12000, openedDate: null }
      ]
    }
  };
  const client = buildBlackReportClient({ crsResult: differing, personal: FIXTURE_PERSONAL });
  assert.equal(client.revolving.length, 2,
    "documents this as the current behaviour so a change to it is a deliberate one");
});
