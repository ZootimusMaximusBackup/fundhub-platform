import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { splitLegalName, consumerContextFrom } from "./consumer-context.mjs";
import { violationsByBureauFromMergedCrs } from "./from-crs.mjs";
import { isObserved, valueOf } from "../provenance.mjs";

describe("splitLegalName", () => {
  test("two and three part names", () => {
    assert.deepEqual(splitLegalName("Sim Repair"), { first: "Sim", middle: null, last: "Repair" });
    assert.deepEqual(splitLegalName("Barbara M Doty"), { first: "Barbara", middle: "M", last: "Doty" });
    assert.deepEqual(splitLegalName("Ana Maria Cruz Diaz"),
      { first: "Ana", middle: "Maria Cruz", last: "Diaz" });
  });

  test("the case on the document is the case in the letter", () => {
    /* Not "SIM REPAIR". This value is printed verbatim into a letter that a
       credit bureau reads. */
    assert.equal(splitLegalName("Sim Repair").first, "Sim");
    assert.equal(splitLegalName("Sim Repair").last, "Repair");
  });

  test("surname-first, as a scanned document often prints it", () => {
    assert.deepEqual(splitLegalName("Repair, Sim M"), { first: "Sim", middle: "M", last: "Repair" });
  });

  test("a suffix is not the surname", () => {
    assert.deepEqual(splitLegalName("John Smith Jr"), { first: "John", middle: null, last: "Smith" });
    assert.deepEqual(splitLegalName("John Smith III"), { first: "John", middle: null, last: "Smith" });
  });

  test("structured parts pass straight through", () => {
    assert.deepEqual(splitLegalName({ first: "Sim", last: "Repair" }),
      { first: "Sim", middle: null, last: "Repair" });
    assert.deepEqual(splitLegalName({ firstName: "Sim", lastName: "Repair" }),
      { first: "Sim", middle: null, last: "Repair" });
  });

  test("HALF A NAME IS NOT A NAME — null, never a guess", () => {
    for (const bad of [null, undefined, "", "   ", "Madonna", "Jr", { first: "Sim" }, { last: "Repair" }]) {
      assert.equal(splitLegalName(bad), null, JSON.stringify(bad));
    }
  });
});

describe("consumerContextFrom", () => {
  test("no verified identity is an empty context, not a made-up one", () => {
    for (const nothing of [null, undefined, {}, "Sim Repair"]) {
      assert.deepEqual(consumerContextFrom(nothing), {}, JSON.stringify(nothing));
    }
  });

  test("only the fields the identity actually carries are set", () => {
    const ctx = consumerContextFrom({ legalName: "Sim Repair", dateOfBirth: null, employers: null });
    assert.deepEqual(Object.keys(ctx.consumer), ["legalName"]);
    assert.ok(isObserved(ctx.consumer.legalName));
    assert.deepEqual(valueOf(ctx.consumer.legalName), { first: "Sim", middle: null, last: "Repair" });
  });

  test("date of birth and employers ride along when they are there", () => {
    const ctx = consumerContextFrom({
      legalName: "Sim Repair",
      dateOfBirth: "1985-03-02",
      employers: ["Acme Co", { name: "Beta LLC" }]
    });
    assert.equal(valueOf(ctx.consumer.dateOfBirth), "1985-03-02");
    assert.deepEqual(valueOf(ctx.consumer.employers), [{ name: "Acme Co" }, { name: "Beta LLC" }]);
  });
});

/* THE POINT OF THE WHOLE FILE. On origin/main the name, date-of-birth and
   employment rules in ../checks/personal-info.mjs could not fire, because
   ./from-crs.mjs never supplied the consumer side of the context. Measured
   here: the same credit file, the same engine, zero findings without it and the
   wrong-name finding with it. */
describe("the personal-information rules can now fire at all", () => {
  const FILE = Object.freeze({
    bureausPulled: ["EX"],
    bureaus: {
      EX: {
        creditFiles: [{
          creditFileDetail: {
            creditFileInfileDate: "2026-09-03",
            creditFileResultStatusType: "FileReturned",
            sourceType: "Experian"
          },
          aliases: [
            { firstName: "Sim", lastName: "Repair" },
            { firstName: "Simon", lastName: "Repairs" }
          ],
          addresses: [{
            addressLine1: "412 Pecan St", city: "Austin", state: "TX",
            postalCode: "78701", borrowerResidencyType: "Current", dateReported: "2026-08-01"
          }],
          dobs: [{ dob: "1985-03-02" }],
          ssns: [],
          employments: []
        }],
        inquiries: [],
        tradelines: []
      }
    }
  });

  function ruleIds(consumerContext) {
    const out = violationsByBureauFromMergedCrs(FILE, consumerContext);
    return (out.EX || []).map((v) => v.ruleId).sort();
  }

  test("without a verified identity the engine finds nothing on this file", () => {
    assert.deepEqual(ruleIds(), []);
    assert.deepEqual(ruleIds(consumerContextFrom(null)), []);
  });

  test("with one, the name that is not the consumer's is disputed off", () => {
    const ids = ruleIds(consumerContextFrom({ legalName: "Sim Repair" }));
    assert.deepEqual(ids, ["M2-032"]);
  });

  test("the consumer's own name is never the one disputed", () => {
    const out = violationsByBureauFromMergedCrs(FILE, consumerContextFrom({ legalName: "Sim Repair" }));
    const subjects = (out.EX || []).map((v) => v.subject);
    assert.deepEqual(subjects, ["Simon Repairs"]);
    for (const v of out.EX) assert.match(v.reason, /legal name is "Sim Repair"/);
  });

  test("A DATE WRITTEN THE OTHER WAY ROUND IS THE SAME DATE", () => {
    /* The file says 1985-03-02. A government ID says 03/02/1985. Comparing
       those as raw strings would mail the bureau a claim that the consumer's
       own correct date of birth belongs to someone else. */
    const ids = ruleIds(consumerContextFrom({ legalName: "Sim Repair", dateOfBirth: "03/02/1985" }));
    assert.deepEqual(ids, ["M2-032"], "no date-of-birth claim on a matching date");
  });

  test("a genuinely different date of birth is still caught", () => {
    const ids = ruleIds(consumerContextFrom({ legalName: "Sim Repair", dateOfBirth: "1990-01-01" }));
    assert.deepEqual(ids, ["M2-032", "M2-033"]);
  });

  test("an unreadable date makes no claim either way", () => {
    const ids = ruleIds(consumerContextFrom({ legalName: "Sim Repair", dateOfBirth: "sometime in 1985" }));
    assert.deepEqual(ids, ["M2-032"]);
  });

  test("employment the consumer has left is caught once a source supplies it", () => {
    const withJob = structuredClone(FILE);
    withJob.bureaus.EX.creditFiles[0].employments = [
      { employerName: "Old Corp", employmentReportedDate: "2021-05-01" }
    ];
    const out = violationsByBureauFromMergedCrs(
      withJob,
      consumerContextFrom({ legalName: "Sim Repair", employers: ["New Corp"] })
    );
    assert.ok((out.EX || []).some((v) => v.ruleId === "M2-034"));
  });
});
