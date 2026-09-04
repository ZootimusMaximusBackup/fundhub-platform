// What the simulated credit file carries — and, just as important, what it does
// NOT carry on the three profiles that were not meant to move.
//
// package.json's test glob covers "scripts/**", so this file really runs
// (CLAUDE.md §12 — a test under api/ would not).
//
// The personal-information floor (src/metro2/diy/personal-info-floor.mjs) can
// only be exercised by a walkthrough if the sim file actually has a name
// variant, a second address and an inquiry with no account behind it. Before
// 2026-09-03 every bureau file the sim built had `aliases: [], ssns: [],
// addresses: []`, so it had none of those. These tests pin that the two
// repair-path profiles now do, that the other three are byte-for-byte what they
// were, and that nothing here can be a real person's social security number.

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { PROFILES, buildPayload, simAliases } from "./push-credit.mjs";
import { personalInfoFloorByBureau } from "../../src/metro2/diy/personal-info-floor.mjs";

const AT = "2026-09-03T00:00:00.000Z";
const payloadFor = (key, name) =>
  buildPayload(key, { email: `${key}@example.com`, name, pulledAt: AT });

const REPAIR_PROFILES = ["repair", "trial"];
const UNTOUCHED_PROFILES = ["funding", "blueprint", "academy"];

describe("the three non-repair profiles did not move", () => {
  test("none of them carries personal information", () => {
    for (const key of UNTOUCHED_PROFILES) {
      assert.equal(PROFILES[key].identity, undefined, `${key} must carry no identity block`);
      const p = payloadFor(key, "Sim Person");
      for (const code of ["TU", "EX", "EQ"]) {
        const file = p.bureaus[code].creditFiles[0];
        assert.deepEqual(file.aliases, [], `${key}/${code} aliases must stay empty`);
        assert.deepEqual(file.addresses, [], `${key}/${code} addresses must stay empty`);
        assert.deepEqual(file.ssns, [], `${key}/${code} ssns must stay empty`);
        assert.deepEqual(file.employments, []);
      }
    }
  });

  test("their scores, accounts and inquiries are exactly what they were", () => {
    /* Pinned by value, taken from the profiles as they stood on origin/main at
       91077f77. A change to any of these is a change to a walkthrough path that
       this work was not sent to touch. */
    const expected = {
      funding: { scores: { EX: 718, EQ: 724, TU: 731 }, lines: 4, inquiries: 7, businessAgeMonths: 30 },
      blueprint: { scores: { EX: 655, EQ: 668, TU: 661 }, lines: 2, inquiries: 2, businessAgeMonths: 9 },
      academy: { scores: { EX: 762, EQ: 770, TU: 758 }, lines: 4, inquiries: 0, businessAgeMonths: 72 }
    };
    for (const [key, want] of Object.entries(expected)) {
      const p = PROFILES[key];
      assert.deepEqual(p.scores, want.scores, key);
      assert.equal(p.lines.length, want.lines, key);
      assert.equal(p.inquiries.length, want.inquiries, key);
      assert.equal(p.businessAgeMonths, want.businessAgeMonths, key);
    }
  });

  test("the personal-information floor finds nothing to consolidate on them", () => {
    for (const key of UNTOUCHED_PROFILES) {
      const floor = personalInfoFloorByBureau(payloadFor(key, "Sim Person"), {
        legalName: "Sim Person"
      });
      for (const claims of Object.values(floor)) {
        const rules = claims.map((c) => c.ruleId);
        assert.ok(!rules.includes("PI-NAME-CONSOLIDATE"), `${key} has no name variant to dispute`);
        assert.ok(!rules.includes("PI-ADDRESS-CONSOLIDATE"), `${key} has no second address`);
      }
    }
  });
});

describe("the two repair-path profiles now carry real personal information", () => {
  test("three reported names: as recorded, a middle initial, and a misspelling", () => {
    for (const key of REPAIR_PROFILES) {
      const p = payloadFor(key, "Sim Repair");
      const aliases = p.bureaus.EX.creditFiles[0].aliases;
      assert.equal(aliases.length, 3, key);
      assert.deepEqual(aliases[0], { firstName: "Sim", middleName: null, lastName: "Repair" });
      assert.deepEqual(aliases[1], { firstName: "Sim", middleName: "J", lastName: "Repair" });
      assert.deepEqual(aliases[2], { firstName: "Sim", middleName: null, lastName: "Repari" });
    }
  });

  test("the names are built from the client's own name, not from a stranger's", () => {
    assert.deepEqual(simAliases("Barbara Doty").map((a) => a.lastName), ["Doty", "Doty", "Doyt"]);
    assert.deepEqual(simAliases(""), [], "no name on the record means no alias is invented");
    assert.deepEqual(simAliases("Cher"), []);
  });

  test("a current address and a prior one", () => {
    for (const key of REPAIR_PROFILES) {
      const addresses = payloadFor(key, "Sim Repair").bureaus.TU.creditFiles[0].addresses;
      assert.equal(addresses.length, 2, key);
      assert.equal(addresses.filter((a) => a.borrowerResidencyType === "Current").length, 1, key);
      assert.equal(addresses.filter((a) => a.borrowerResidencyType === "Prior").length, 1, key);
      for (const a of addresses) {
        assert.ok(a.addressLine1 && a.city && a.state && a.postalCode, key);
      }
    }
  });

  test("every social on the file begins 000 — an area number never issued", () => {
    for (const key of REPAIR_PROFILES) {
      const p = payloadFor(key, "Sim Repair");
      for (const code of ["TU", "EX", "EQ"]) {
        const ssns = p.bureaus[code].creditFiles[0].ssns;
        assert.equal(ssns.length, 1, `${key}/${code}`);
        assert.match(ssns[0].ssn, /^000\d{6}$/,
          "a simulated social must be one the Social Security Administration cannot have issued");
      }
    }
  });

  /* The address the floor is told to keep is the CLIENT RECORD's, and there is
     no address claim at all without one — see the header of
     src/metro2/diy/personal-info-floor.mjs. These are the current addresses the
     two simulated files carry, so the walkthrough exercises the consolidation. */
  const SIM_CURRENT_ADDRESS = Object.freeze({
    repair: "1180 Ridgemont Dr, Cedar Park, TX, 78613",
    trial: "3402 Alameda Ct, Pflugerville, TX, 78660"
  });

  test("the floor now has a real consolidation to demand, not just a confirmation", () => {
    for (const key of REPAIR_PROFILES) {
      const floor = personalInfoFloorByBureau(payloadFor(key, "Sim Repair"), {
        legalName: "Sim Repair",
        currentAddress: SIM_CURRENT_ADDRESS[key]
      });
      for (const [code, claims] of Object.entries(floor)) {
        const rules = claims.map((c) => c.ruleId);
        assert.ok(rules.includes("PI-NAME-CONSOLIDATE"), `${key}/${code} name`);
        assert.ok(rules.includes("PI-ADDRESS-CONSOLIDATE"), `${key}/${code} address`);
      }
    }
  });

  test("with no address on the client record the sim file gets the name cleanup and no address claim", () => {
    for (const key of REPAIR_PROFILES) {
      const floor = personalInfoFloorByBureau(payloadFor(key, "Sim Repair"), {
        legalName: "Sim Repair",
        currentAddress: null
      });
      for (const [code, claims] of Object.entries(floor)) {
        const rules = claims.map((c) => c.ruleId);
        assert.ok(rules.includes("PI-NAME-CONSOLIDATE"), `${key}/${code} name`);
        assert.equal(rules.filter((r) => r.startsWith("PI-ADDRESS-")).length, 0,
          `${key}/${code} must claim nothing about an address nobody gave us`);
      }
    }
  });

  test("inquiries with no account behind them are disputed, and the rest are not", () => {
    const floor = personalInfoFloorByBureau(payloadFor("repair", "Sim Repair"), {
      legalName: "Sim Repair"
    });
    const disputed = Object.values(floor)
      .flat()
      .filter((c) => c.ruleId === "PI-INQUIRY-UNMATCHED")
      .map((c) => c.creditor)
      .sort();
    assert.deepEqual(disputed,
      ["Aventine Auto Finance", "Kestrel Card Services", "Northgate Lending Group"]);
    /* Capital One and Credit One each have an account on the file, so neither is
       disputed. Claiming otherwise would be a false statement in a mailed letter. */
    assert.ok(!disputed.includes("Capital One"));
    assert.ok(!disputed.includes("Credit One"));
  });
});
