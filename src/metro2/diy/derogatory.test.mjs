import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DEROGATORY_CLAIMS,
  DEROGATORY_RULE_IDS,
  classifyDerogatory,
  derogatoryClaim,
  derogatoryClaimsByBureau,
  isDerogatoryRuleId,
  mergeDerogatoryClaims,
  reportedAsCollection
} from "./derogatory.mjs";
import { violationsByBureauFromMergedCrs } from "./from-crs.mjs";
import { buildLetterText } from "../letters/generate.mjs";
import { observed } from "../provenance.mjs";
import { RULE_IDS } from "../rules/citations.mjs";
import { IMPLEMENTED_RULE_IDS } from "../checks/index.mjs";

const IDENTITY = {
  fullName: "Sim Two-Repair",
  addressLine1: "1 Main St",
  city: "Austin",
  state: "TX",
  zip: "78701"
};

function record(over = {}) {
  return {
    creditorName: "EXAMPLE BANK NA",
    accountIdentifier: "SIM-EXAMPLE-4021",
    accountOpenedDate: "2021-03-02",
    accountReportedDate: "2026-08-28",
    accountOwnershipType: "Individual",
    accountStatusType: "Open",
    accountType: "Revolving",
    loanType: "CreditCard",
    businessType: "Banking",
    currentRatingType: "AsAgreed",
    currentBalanceAmount: "2870",
    pastDueAmount: "0",
    _30DayLates: "0",
    _60DayLates: "0",
    _90DayLates: "0",
    sourceType: "Experian",
    ...over
  };
}

function report(records) {
  return {
    creditFiles: [{
      creditFileDetail: {
        creditFileInfileDate: "2026-09-03",
        creditFileResultStatusType: "FileReturned",
        sourceType: "Experian"
      }
    }],
    inquiries: [],
    tradelines: records
  };
}

describe("the derogatory claim catalogue stays outside the Metro 2 closed world", () => {
  it("shares no rule id with the 38 Metro 2 checks", () => {
    for (const id of DEROGATORY_RULE_IDS) {
      assert.equal(RULE_IDS.includes(id), false, `${id} must not be a Metro 2 citation key`);
      assert.equal(IMPLEMENTED_RULE_IDS.includes(id), false, `${id} must not be a Metro 2 check`);
      assert.equal(isDerogatoryRuleId(id), true);
    }
    assert.equal(isDerogatoryRuleId("M2-019"), false);
  });

  it("every claim carries its own severity, plain name and citations", () => {
    for (const id of DEROGATORY_RULE_IDS) {
      const spec = DEROGATORY_CLAIMS[id];
      assert.ok(spec.severity, `${id} needs a severity`);
      assert.ok(spec.plainName, `${id} needs a plain name`);
      assert.ok(spec.citations.length >= 3, `${id} needs its authority`);
    }
  });

  it("claims no deletion tier — there is no defect evidence behind them", () => {
    for (const id of DEROGATORY_RULE_IDS) {
      assert.notEqual(DEROGATORY_CLAIMS[id].severity, "deletion");
    }
  });
});

describe("classifying one account", () => {
  it("calls a collection a collection only where the vendor said so", () => {
    const collection = record({
      businessType: "Collection",
      loanType: "CollectionAgencyAttorney",
      currentRatingType: "CollectionOrChargeOff"
    });
    assert.equal(reportedAsCollection(collection, {}), true);
    assert.equal(classifyDerogatory(collection, {}), "DEROG-COLLECTION");
  });

  it("an uncorroborated CollectionOrChargeOff falls to the charge-off claim", () => {
    const ambiguous = record({ currentRatingType: "CollectionOrChargeOff" });
    assert.equal(reportedAsCollection(ambiguous, {}), false);
    assert.equal(classifyDerogatory(ambiguous, {}), "DEROG-CHARGEOFF");
  });

  it("reads late payments from the vendor's own counters", () => {
    assert.equal(
      classifyDerogatory(record({ currentRatingType: "Late30Days", _30DayLates: "2" }), {}),
      "DEROG-LATE"
    );
  });

  it("a past-due amount alone is enough", () => {
    const tradeline = { field_22_amount_past_due: observed(18500) };
    assert.equal(classifyDerogatory(record(), tradeline), "DEROG-LATE");
  });

  it("a clean account produces nothing", () => {
    assert.equal(classifyDerogatory(record(), {}), null);
  });

  it("the letter quotes the bureau's own label rather than translating it", () => {
    const claim = derogatoryClaim("DEROG-CHARGEOFF", {
      record: record({ currentRatingType: "CollectionOrChargeOff" }),
      tradeline: {},
      bureau: "EX"
    });
    assert.match(claim.reason, /labels the account "CollectionOrChargeOff"/);
    assert.equal(claim.field, null, "no Metro 2 field is asserted");
    assert.equal(claim.metro2Ref, null);
  });
});

describe("derogatoryClaimsByBureau", () => {
  it("finds one claim per derogatory account and none on a clean file", () => {
    const clean = { bureaus: { EX: report([record()]) } };
    assert.deepEqual(derogatoryClaimsByBureau(clean), {});

    const damaged = {
      bureaus: {
        EX: report([
          record({ currentRatingType: "Late30Days", _30DayLates: "2", pastDueAmount: "185" }),
          record({
            creditorName: "MIDLAND CREDIT MANAGEMENT",
            accountIdentifier: "SIM-MCM-6642",
            businessType: "Collection",
            loanType: "CollectionAgencyAttorney",
            currentRatingType: "CollectionOrChargeOff",
            currentBalanceAmount: "1840"
          })
        ])
      }
    };
    const out = derogatoryClaimsByBureau(damaged);
    assert.deepEqual(out.EX.map((c) => c.ruleId), ["DEROG-LATE", "DEROG-COLLECTION"]);
    assert.equal(out.EX[1].collection, true, "collectors.mjs reads this for validation letters");
    assert.equal(out.EX[1].account_last4, "6642");
    assert.equal(out.EQ, undefined);
  });

  it("never returns more than one claim for one account", () => {
    const both = {
      bureaus: {
        EX: report([record({
          businessType: "Collection",
          loanType: "CollectionAgencyAttorney",
          currentRatingType: "CollectionOrChargeOff",
          _90DayLates: "3",
          pastDueAmount: "400"
        })])
      }
    };
    assert.equal(derogatoryClaimsByBureau(both).EX.length, 1);
  });
});

describe("mergeDerogatoryClaims", () => {
  it("keeps the engine finding and drops the derogatory claim on the same account", () => {
    const engine = { EX: [{ ruleId: "M2-019", creditor: "MIDLAND", account_last4: "6642" }] };
    const claims = {
      EX: [
        { ruleId: "DEROG-COLLECTION", creditor: "MIDLAND", account_last4: "6642" },
        { ruleId: "DEROG-LATE", creditor: "CAP ONE", account_last4: "7729" }
      ]
    };
    const out = mergeDerogatoryClaims(engine, claims);
    assert.deepEqual(out.EX.map((v) => v.ruleId), ["M2-019", "DEROG-LATE"]);
  });

  it("carries a bureau that only the derogatory pass found", () => {
    const out = mergeDerogatoryClaims({}, { TU: [{ ruleId: "DEROG-LATE", creditor: "A" }] });
    assert.deepEqual(Object.keys(out), ["TU"]);
  });
});

describe("the letter these claims produce", () => {
  const damaged = {
    bureaus: {
      EX: report([
        record({ currentRatingType: "Late30Days", _30DayLates: "2", pastDueAmount: "185" }),
        record({
          creditorName: "MIDLAND CREDIT MANAGEMENT",
          accountIdentifier: "SIM-MCM-6642",
          businessType: "Collection",
          loanType: "CollectionAgencyAttorney",
          currentRatingType: "CollectionOrChargeOff",
          currentBalanceAmount: "1840"
        })
      ])
    }
  };

  it("builds, names the account, and shows the ending four digits", () => {
    const text = buildLetterText({
      violations: derogatoryClaimsByBureau(damaged).EX,
      bureau: "EX",
      round: "R1",
      identity: IDENTITY
    });
    assert.match(text, /ending 6642/);
    assert.match(text, /\$1,840\.00/);
    assert.match(text, /Collection account — reinvestigation demanded/);
  });

  it("never claims a Metro 2 defect it cannot show", () => {
    const text = buildLetterText({
      violations: derogatoryClaimsByBureau(damaged).EX,
      bureau: "EX",
      round: "R1",
      identity: IDENTITY
    });
    assert.doesNotMatch(text, /Metro 2/, "no Metro 2 wording in a letter with no Metro 2 claim");
    assert.match(text, /Round 1 FCRA dispute/);
  });

  it("keeps the Metro 2 wording when a Metro 2 finding really is in the letter", () => {
    const engine = violationsByBureauFromMergedCrs({
      bureaus: {
        EX: {
          ...report([record({ accountReportedDate: "2024-01-01" })]),
          inquiries: []
        }
      }
    });
    const mixed = mergeDerogatoryClaims(engine, derogatoryClaimsByBureau(damaged));
    assert.ok(mixed.EX.some((v) => /^M2-/.test(v.ruleId)), "fixture must carry a Metro 2 finding");
    const text = buildLetterText({
      violations: mixed.EX,
      bureau: "EX",
      round: "R1",
      identity: IDENTITY
    });
    assert.match(text, /Round 1 Metro 2 dispute/);
  });
});
