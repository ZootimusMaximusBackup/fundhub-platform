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
    assert.equal(row.length, 9);
    assert.equal(typeof row[3], "number");
    assert.equal(typeof row[4], "number");
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

/* F43. A tri-merge pull carries the same account once per bureau. Printing that
   list as it arrives gave the client nine card rows for three cards, a credit
   line three times the real one, and a paydown target to match. The percentage
   was right — both halves were tripled — so nothing looked obviously wrong. */
test("one row per account, not one per bureau copy — and the dollars are not tripled", () => {
  const card = (source, extra = {}) => ({
    source,
    accountIdentifier: "SIM-CHASE-8814",
    creditorName: "CHASE CARD SERVICES",
    accountType: "revolving",
    status: "open",
    currentBalance: 1200,
    effectiveLimit: 20000,
    isDerogatory: false,
    ...extra
  });
  const loan = (source) => ({
    source,
    accountIdentifier: "SIM-TOYO-4490",
    creditorName: "TOYOTA MOTOR CREDIT",
    accountType: "installment",
    status: "open",
    currentBalance: 11200,
    isDerogatory: false
  });
  const engine = {
    consumerSignals: {
      scores: { median: 771, perBureau: { ex: 771, eq: 775, tu: 768 } },
      // What the engine derives from the un-merged list: three times the truth.
      utilization: { totalBalance: 3600, totalLimit: 60000, pct: 6 }
    },
    normalized: {
      tradelines: [
        card("experian"), card("equifax"), card("transunion"),
        loan("experian"), loan("equifax"), loan("transunion")
      ],
      inquiries: [],
      identity: {}
    }
  };
  const client = buildBlackReportClient({ crsResult: engine, personal: FIXTURE_PERSONAL });

  assert.equal(client.revolving.length, 1, "one card, one row");
  assert.equal(client.installments.length, 1, "one car loan, one row");
  assert.equal(client.revolving[0][1], "All 3 bureaus", "the merged row still says who reports it");
  assert.equal(client.util_total_balance, 1200);
  assert.equal(client.util_total_limit, 20000);
  assert.equal(client.util_target_balance, 2000);
  assert.equal(client.util_pct, "6%", "the percentage was always right and must not move");
});

/* Only accounts that carry an account number can be merged. Two rows with no
   identifier might be two different cards, and deleting a real second account is
   worse than printing a duplicate. */
test("rows with no account number are never merged together", () => {
  const engine = {
    consumerSignals: { scores: { median: 700, perBureau: { ex: 700, eq: 700, tu: 700 } } },
    normalized: {
      tradelines: [
        { source: "experian", creditorName: "SOME BANK", accountType: "revolving", status: "open", currentBalance: 100, effectiveLimit: 1000 },
        { source: "equifax", creditorName: "SOME BANK", accountType: "revolving", status: "open", currentBalance: 100, effectiveLimit: 1000 }
      ],
      inquiries: [],
      identity: {}
    }
  };
  const client = buildBlackReportClient({ crsResult: engine, personal: FIXTURE_PERSONAL });
  assert.equal(client.revolving.length, 2);
});

/* A stored credit file keeps open-or-closed in accountStatusType and puts the
   PAYMENT status in `status`. Reading only `status` found no open cards at all,
   which silently sent the totals back to the engine's tripled figures. */
test("a stored file's open cards are found through accountStatusType", () => {
  const stored = {
    scores: { ex: 771, eq: 775, tu: 768 },
    tradelines: [
      {
        bureau: "EX",
        accountIdentifier: "SIM-AMEX-2007",
        creditorName: "AMEX",
        accountType: "Revolving",
        accountStatusType: "Open",
        paymentStatus: "Pays as agreed",
        currentBalanceAmount: "850",
        creditLimitAmount: "15000"
      }
    ]
  };
  const client = buildBlackReportClient({ crsResult: stored, personal: FIXTURE_PERSONAL });
  assert.equal(client.util_total_balance, 850);
  assert.equal(client.util_total_limit, 15000);
  assert.equal(client.util_pct, "6%");
});
