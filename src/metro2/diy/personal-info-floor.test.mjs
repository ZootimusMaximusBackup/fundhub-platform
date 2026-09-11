// The personal-information floor — and above all, the fabrication guard.
//
// THE TEST THAT MATTERS MOST IN THIS FILE is "a file carrying ONE name is never
// told it carries two". An earlier attempt at this floor compared the bureau
// file against clients.first_name + clients.last_name, which never carries a
// middle name while a real bureau file routinely does, and so generated a
// dispute demanding a bureau delete the consumer's own correctly-reported name
// as a duplicate. That is a false statement of fact in a mailed dispute. The
// pins below are written so that failure cannot come back unnoticed.

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  nameLabel,
  normalizeLabel,
  addressLabel,
  creditorKey,
  inquiryHasAccount,
  accountKeysFromPull,
  personalInfoFloorByBureau,
  mergePersonalInfoClaims
} from "./personal-info-floor.mjs";

/** Every string a claim presents in quotation marks as being ON THE FILE. */
function quotedFacts(reason) {
  return [...String(reason).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

function fileWith({ aliases = [], addresses = [], inquiries = [], tradelines = [] } = {}) {
  return {
    bureausPulled: ["EX"],
    bureaus: {
      EX: {
        creditFiles: [{
          creditFileDetail: {
            creditFileInfileDate: "2026-09-03",
            creditFileResultStatusType: "FileReturned",
            sourceType: "Experian"
          },
          aliases,
          addresses,
          ssns: [],
          employments: []
        }],
        inquiries,
        tradelines
      }
    }
  };
}

const ACCOUNT = {
  creditorName: "EXAMPLE BANK NA",
  accountIdentifier: "5121080011112222",
  accountOpenedDate: "2019-06-12",
  accountReportedDate: "2026-09-01",
  accountOwnershipType: "Individual",
  accountStatusType: "Open",
  accountType: "Revolving",
  currentRatingType: "AsAgreed",
  currentBalanceAmount: "1842",
  sourceType: "Experian"
};

const HOME = {
  addressLine1: "412 Pecan St", city: "Austin", state: "TX",
  postalCode: "78701", borrowerResidencyType: "Current", dateReported: "2026-08-01"
};

const PRIOR_HOME = {
  addressLine1: "77 Old Mill Rd", city: "Round Rock", state: "TX",
  postalCode: "78664", borrowerResidencyType: "Prior", dateReported: "2021-04-02"
};

const rulesOf = (claims) => claims.map((c) => c.ruleId);

describe("the floor's own shape", () => {
  test("every claim carries a rule id and a severity, or it can never become an item", () => {
    const out = personalInfoFloorByBureau(fileWith({ aliases: [{ firstName: "Sim", lastName: "Repair" }] }), {
      legalName: "Sim Repair"
    });
    for (const claim of out.EX) {
      assert.ok(claim.ruleId, "a claim with no rule id is dropped by ruleBackedClaims");
      assert.ok(claim.severity);
      assert.equal(claim.metro2Ref, null, "the floor asserts no Metro 2 defect");
      assert.equal(claim.field, null);
      assert.ok(Array.isArray(claim.citations) && claim.citations.length > 0);
    }
  });
});

describe("NEVER INVENT A NAME VARIANT", () => {
  test("a file carrying ONE name is never told it carries two", () => {
    /* The exact case that failed before: the bureau file carries a middle
       initial, the client record does not. */
    const out = personalInfoFloorByBureau(
      fileWith({ aliases: [{ firstName: "Barbara", middleName: "M", lastName: "Doty" }] }),
      { legalName: "Barbara Doty", currentAddress: "412 Pecan St, Austin, TX, 78701" }
    );
    assert.deepEqual(rulesOf(out.EX), ["PI-NAME-CONFIRM", "PI-ADDRESS-CONFIRM"]);
    const name = out.EX[0];
    assert.doesNotMatch(name.reason, /more than one name/i);
    assert.deepEqual(quotedFacts(name.reason), ["Barbara M Doty"],
      "the only name it may quote as being on the file is the one that is on it");
    assert.deepEqual(name.observed.namesReportedOnFile, ["Barbara M Doty"]);
  });

  test("a suffix-only difference in the client record is still ONE name on the file", () => {
    const out = personalInfoFloorByBureau(
      fileWith({ aliases: [{ firstName: "Barbara", lastName: "Doty Jr" }] }),
      { legalName: "Barbara Doty" }
    );
    assert.equal(out.EX[0].ruleId, "PI-NAME-CONFIRM");
  });

  test("case and punctuation are not a second name", () => {
    const out = personalInfoFloorByBureau(
      fileWith({
        aliases: [
          { firstName: "Barbara", middleName: "M.", lastName: "Doty" },
          { firstName: "BARBARA", middleName: "M", lastName: "DOTY" }
        ]
      }),
      { legalName: "Barbara Doty" }
    );
    assert.equal(out.EX[0].ruleId, "PI-NAME-CONFIRM",
      "the same name printed twice is one name, not a consolidation case");
  });

  test("two genuinely different names ARE consolidated, and only file names are quoted", () => {
    const out = personalInfoFloorByBureau(
      fileWith({
        aliases: [
          { firstName: "Barbara", middleName: "M", lastName: "Doty" },
          { firstName: "Barbra", lastName: "Dotey" }
        ]
      }),
      { legalName: "Barbara Doty" }
    );
    const name = out.EX[0];
    assert.equal(name.ruleId, "PI-NAME-CONSOLIDATE");
    const onFile = ["Barbara M Doty", "Barbra Dotey"];
    for (const quoted of quotedFacts(name.reason)) {
      assert.ok(onFile.includes(quoted),
        `the letter quoted "${quoted}" as being on the file and it is not`);
    }
    assert.match(name.reason, /Barbara Doty/, "it still names what to consolidate to");
    assert.equal(name.subject, "Barbara Doty");
  });

  test("when the legal name IS one of the file's names, the other one is the one removed", () => {
    const out = personalInfoFloorByBureau(
      fileWith({
        aliases: [
          { firstName: "Barbara", lastName: "Doty" },
          { firstName: "Barbra", lastName: "Dotey" }
        ]
      }),
      { legalName: "Barbara Doty" }
    );
    const name = out.EX[0];
    assert.equal(name.ruleId, "PI-NAME-CONSOLIDATE");
    assert.match(name.reason, /delete "Barbra Dotey"/);
    assert.doesNotMatch(name.reason, /delete[^.]*"Barbara Doty"/,
      "it must never demand deletion of the consumer's own correctly reported name");
  });

  test("a file that shows no name at all asserts nothing about what the file holds", () => {
    const out = personalInfoFloorByBureau(fileWith({}), { legalName: "Barbara Doty" });
    const name = out.EX[0];
    assert.equal(name.ruleId, "PI-NAME-CONFIRM");
    assert.deepEqual(quotedFacts(name.reason), [],
      "with no name visible it may quote nothing as being on the file");
    assert.doesNotMatch(name.reason, /this file reports/i);
  });
});

describe("addresses", () => {
  test("a current and a prior address is a real consolidation", () => {
    const out = personalInfoFloorByBureau(
      fileWith({ addresses: [HOME, PRIOR_HOME] }),
      { legalName: "Sim Repair", currentAddress: "412 Pecan St, Austin, TX, 78701" }
    );
    const addr = out.EX[1];
    assert.equal(addr.ruleId, "PI-ADDRESS-CONSOLIDATE");
    assert.match(addr.reason, /77 Old Mill Rd/);
    const onFile = [
      "412 Pecan St, Austin, TX, 78701",
      "77 Old Mill Rd, Round Rock, TX, 78664"
    ];
    for (const quoted of quotedFacts(addr.reason)) {
      assert.ok(onFile.includes(quoted), `quoted "${quoted}" is not on the file`);
    }
    assert.doesNotMatch(addr.reason, /delete[^.]*"412 Pecan St[^"]*"/,
      "it must never demand deletion of the consumer's own current address");
  });

  test("one address is confirmed, never disputed as a duplicate", () => {
    const out = personalInfoFloorByBureau(
      fileWith({ addresses: [HOME] }),
      { legalName: "Sim Repair", currentAddress: "412 Pecan St, Austin, TX, 78701" }
    );
    assert.equal(out.EX[1].ruleId, "PI-ADDRESS-CONFIRM");
    assert.doesNotMatch(out.EX[1].reason, /more than one address/i);
  });

  test("a ZIP+4 is the same address as its five-digit form", () => {
    const out = personalInfoFloorByBureau(
      fileWith({ addresses: [HOME, { ...HOME, postalCode: "78701-1234" }] }),
      { legalName: "Sim Repair", currentAddress: "412 Pecan St, Austin, TX, 78701" }
    );
    assert.equal(out.EX[1].ruleId, "PI-ADDRESS-CONFIRM");
  });
});

describe("NO PERSONAL ADDRESS ON RECORD MEANS NO ADDRESS CLAIM", () => {
  /* The floor used to be handed whatever address the letter's return-address
     loader had found, which for a client with no personal address on record is
     their BUSINESS street address. The letter then said "My address is <the
     company's address>" and asked the bureau to delete the consumer's real
     current residential address. Unknown is unknown. */
  test("a file with two addresses and no client address makes no address claim", () => {
    const out = personalInfoFloorByBureau(
      fileWith({ addresses: [HOME, PRIOR_HOME] }),
      { legalName: "Sim Repair", currentAddress: null }
    );
    assert.deepEqual(rulesOf(out.EX), ["PI-NAME-CONFIRM"]);
    for (const claim of out.EX) {
      assert.doesNotMatch(claim.reason, /My address is/i);
      assert.doesNotMatch(claim.reason, /412 Pecan St|77 Old Mill Rd/);
    }
  });

  test("an empty string is not an address either", () => {
    const out = personalInfoFloorByBureau(
      fileWith({ addresses: [HOME] }),
      { legalName: "Sim Repair", currentAddress: "   " }
    );
    assert.deepEqual(rulesOf(out.EX), ["PI-NAME-CONFIRM"]);
  });

  test("the consumer's own address never lands in the delete list over a ZIP+4 or a spelled-out street", () => {
    for (const stated of [
      "412 Pecan St, Austin, TX, 78701-1234",
      "412 Pecan Street, Austin, TX, 78701",
      "412 PECAN ST, AUSTIN, TX, 78701"
    ]) {
      const out = personalInfoFloorByBureau(
        fileWith({ addresses: [HOME, PRIOR_HOME] }),
        { legalName: "Sim Repair", currentAddress: stated }
      );
      const addr = out.EX[1];
      assert.equal(addr.ruleId, "PI-ADDRESS-CONSOLIDATE");
      assert.doesNotMatch(addr.reason, /delete[^.]*"412 Pecan St[^"]*"/,
        `stated as "${stated}", the letter asked to delete the consumer's own address`);
      assert.match(addr.reason, /delete "77 Old Mill Rd, Round Rock, TX, 78664"/);
    }
  });
});

describe("a CONFIRM claim never asks the bureau to hold the file to a name or address that is not the consumer's", () => {
  test("name: when the file's one name differs from the record, it confirms ONE name, mine", () => {
    const out = personalInfoFloorByBureau(
      fileWith({ aliases: [{ firstName: "Barbara", middleName: "M", lastName: "Doty" }] }),
      { legalName: "Barb Doty" }
    );
    const name = out.EX[0];
    assert.equal(name.ruleId, "PI-NAME-CONFIRM");
    assert.deepEqual(quotedFacts(name.reason), ["Barbara M Doty"]);
    assert.doesNotMatch(name.reason, /carries this one name/,
      "it must not ask the bureau to hold the file to a name the consumer has not claimed");
    assert.match(name.reason, /one name only, mine/);
  });

  test("name: when they match, it does confirm THAT name", () => {
    const out = personalInfoFloorByBureau(
      fileWith({ aliases: [{ firstName: "Barbara", middleName: "M", lastName: "Doty" }] }),
      { legalName: "Barbara M Doty" }
    );
    assert.match(out.EX[0].reason, /carries this one name and no other/);
  });

  test("address: when the file's one address differs from the record, it confirms ONE address, mine", () => {
    const out = personalInfoFloorByBureau(
      fileWith({ addresses: [HOME] }),
      { legalName: "Sim Repair", currentAddress: "9 New Rd, Dallas, TX, 75201" }
    );
    const addr = out.EX[1];
    assert.equal(addr.ruleId, "PI-ADDRESS-CONFIRM");
    assert.doesNotMatch(addr.reason, /carries this one address/);
    assert.match(addr.reason, /one address only, mine/);
  });
});

describe("inquiries with no account on the file", () => {
  test("an inquiry from a company with no account anywhere on the pull is disputed", () => {
    const out = personalInfoFloorByBureau(
      fileWith({
        tradelines: [ACCOUNT],
        inquiries: [{
          creditorName: "Sunbelt Auto Finance", inquiryDate: "2026-05-02",
          businessType: "Auto", sourceType: "Experian"
        }]
      }),
      { legalName: "Sim Repair" }
    );
    const inq = out.EX.filter((c) => c.ruleId === "PI-INQUIRY-UNMATCHED");
    assert.equal(inq.length, 1);
    assert.equal(inq[0].creditor, "Sunbelt Auto Finance");
    assert.match(inq[0].reason, /permissible purpose/i);
  });

  test("it never claims the consumer failed to authorise the inquiry", () => {
    const out = personalInfoFloorByBureau(
      fileWith({
        tradelines: [ACCOUNT],
        inquiries: [{ creditorName: "Sunbelt Auto Finance", inquiryDate: "2026-05-02", sourceType: "Experian" }]
      }),
      { legalName: "Sim Repair" }
    );
    const inq = out.EX.find((c) => c.ruleId === "PI-INQUIRY-UNMATCHED");
    /* Nothing in a credit report says whether the consumer authorised an
       inquiry — ../normalize.mjs marks consumerAuthorized not_visible for that
       reason — so the letter may not assert it either way. */
    assert.doesNotMatch(inq.reason, /did not authori|never authori|unauthori/i);
  });

  test("an inquiry the file DOES explain produces no claim", () => {
    const out = personalInfoFloorByBureau(
      fileWith({
        tradelines: [ACCOUNT],
        inquiries: [{ creditorName: "EXAMPLE BANK NA", inquiryDate: "2026-05-02", sourceType: "Experian" }],
        addresses: [HOME]
      }),
      { legalName: "Sim Repair", currentAddress: "412 Pecan St, Austin, TX, 78701" }
    );
    assert.deepEqual(rulesOf(out.EX), ["PI-NAME-CONFIRM", "PI-ADDRESS-CONFIRM"]);
  });

  test("a shorter trading name still matches its own account — no claim", () => {
    const out = personalInfoFloorByBureau(
      fileWith({
        tradelines: [{ ...ACCOUNT, creditorName: "Capital One Platinum" }],
        inquiries: [{ creditorName: "Capital One", inquiryDate: "2026-02-11", sourceType: "Experian" }]
      }),
      { legalName: "Sim Repair" }
    );
    assert.equal(out.EX.filter((c) => c.ruleId === "PI-INQUIRY-UNMATCHED").length, 0,
      "an uncertain match must count as a match — under-firing beats a false statement");
  });

  test("corporate boilerplate is not what distinguishes two companies", () => {
    assert.equal(creditorKey("Credit One Bank"), creditorKey("Credit One"));
    assert.equal(creditorKey("Chase Bank USA NA"), "CHASE");
    assert.notEqual(creditorKey("Credit One"), creditorKey("Capital One"));
    assert.ok(creditorKey("US Bank NA").length > 0,
      "a name made only of boilerplate must not collapse to a key that matches everything");
  });

  test("an unreadable creditor name is never disputed", () => {
    assert.equal(inquiryHasAccount("", ["CHASE"]), true);
    assert.equal(inquiryHasAccount("X", ["CHASE"]), true);
  });

  test("account keys are read from every bureau on the pull, not just one", () => {
    const merged = {
      bureaus: {
        EX: fileWith({ tradelines: [ACCOUNT] }).bureaus.EX,
        EQ: {
          creditFiles: [{ creditFileDetail: { sourceType: "Equifax", creditFileInfileDate: "2026-09-03" } }],
          inquiries: [],
          tradelines: [{ ...ACCOUNT, creditorName: "Sunbelt Auto Finance", sourceType: "Equifax" }]
        }
      }
    };
    assert.deepEqual(accountKeysFromPull(merged).sort(), ["EXAMPLE", "SUNBELTAUTO"]);
  });
});

describe("the floor really is a floor", () => {
  test("every bureau on the pull gets cleanup, even with nothing else to say", () => {
    const merged = {
      bureaus: {
        EX: fileWith({}).bureaus.EX,
        TU: {
          creditFiles: [{ creditFileDetail: { sourceType: "TransUnion", creditFileInfileDate: "2026-09-03" } }],
          inquiries: [],
          tradelines: []
        }
      }
    };
    const out = personalInfoFloorByBureau(merged, {
      legalName: "Sim Repair",
      currentAddress: "412 Pecan St, Austin, TX, 78701"
    });
    assert.deepEqual(Object.keys(out).sort(), ["EX", "TU"]);
    for (const code of Object.keys(out)) {
      assert.ok(out[code].length >= 2, `${code} must get the name and address claims`);
    }
  });

  test("with NO address on the client record every bureau still gets the name claim", () => {
    const merged = {
      bureaus: {
        EX: fileWith({}).bureaus.EX,
        TU: {
          creditFiles: [{ creditFileDetail: { sourceType: "TransUnion", creditFileInfileDate: "2026-09-03" } }],
          inquiries: [],
          tradelines: []
        }
      }
    };
    const out = personalInfoFloorByBureau(merged, { legalName: "Sim Repair", currentAddress: null });
    assert.deepEqual(Object.keys(out).sort(), ["EX", "TU"]);
    for (const code of Object.keys(out)) {
      assert.deepEqual(rulesOf(out[code]), ["PI-NAME-CONFIRM"],
        `${code} keeps the name claim and makes no claim about an address nobody gave us`);
    }
  });

  test("a pull with no readable bureau file yields nothing to work from", () => {
    assert.deepEqual(personalInfoFloorByBureau({ bureausPulled: ["EQ"] }, { legalName: "Sim Repair" }), {});
    assert.deepEqual(personalInfoFloorByBureau(null, { legalName: "Sim Repair" }), {});
  });

  test("merging keeps what was already found and adds the floor under it", () => {
    const merged = mergePersonalInfoClaims(
      { EX: [{ ruleId: "M2-005" }], EQ: [{ ruleId: "DEROG-LATE" }] },
      { EX: [{ ruleId: "PI-NAME-CONFIRM" }], TU: [{ ruleId: "PI-NAME-CONFIRM" }] }
    );
    assert.deepEqual(rulesOf(merged.EX), ["M2-005", "PI-NAME-CONFIRM"]);
    assert.deepEqual(rulesOf(merged.EQ), ["DEROG-LATE"]);
    assert.deepEqual(rulesOf(merged.TU), ["PI-NAME-CONFIRM"]);
  });
});

describe("label helpers", () => {
  test("a name label drops the parts the bureau left empty", () => {
    assert.equal(nameLabel({ first: "Sim", middle: null, last: "Repair" }), "Sim Repair");
    assert.equal(nameLabel({ first: "Sim", middle: "M", last: "Repair" }), "Sim M Repair");
    assert.equal(nameLabel({}), "");
  });

  test("normalising folds case and punctuation only", () => {
    assert.equal(normalizeLabel("Barbara M. Doty"), "BARBARA M DOTY");
    assert.notEqual(normalizeLabel("Barbara Doty"), normalizeLabel("Barbara M Doty"));
  });

  test("an address label is what a letter prints", () => {
    assert.equal(
      addressLabel({ line1: "412 Pecan St", city: "Austin", state: "TX", postal: "78701" }),
      "412 Pecan St, Austin, TX, 78701"
    );
  });
});
