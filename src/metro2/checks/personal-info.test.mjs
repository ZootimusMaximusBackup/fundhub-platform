// § 5.6 personal information — M2-031 … M2-034.
//
// The negative fixture that earns its keep here is the middle-initial one.
// "BARBARA M DOTY" and "BARBARA DOTY" are the same person, and a name check
// strict enough to call that a mixed file would fire on most files in the
// country — putting a paragraph in every letter that says nothing, which is
// exactly what makes a letter read as generated.

import test from "node:test";
import assert from "node:assert/strict";

import {
  checkStaleAddresses,
  checkNameVariants,
  checkDateOfBirthMismatch,
  checkOutdatedEmployment,
  sameName,
  addressLabel
} from "./personal-info.mjs";
import { cleanContext, blindContext, bareContext, observed, notVisible } from "./fixtures/tradelines.mjs";

function assertWellFormed(v, ruleId) {
  assert.equal(v.ruleId, ruleId);
  assert.equal(v.severity, "supporting");
  assert.equal(v.scope, "report");
  assert.ok(typeof v.reason === "string" && v.reason.length > 20);
  assert.ok(Array.isArray(v.citations) && v.citations.length > 0);
  assert.ok(typeof v.metro2Ref === "string" && v.metro2Ref.length > 0);
}

// ── M2-031 — stale former addresses ────────────────────────────────────────

test("M2-031 fires on a former address older than two reporting cycles", () => {
  const context = cleanContext({
    file: {
      ...cleanContext().file,
      addresses: observed([
        { line1: "1100 LYNHURST LN", city: "DENTON", state: "TX", postal: "76205", isCurrent: true, reportedOn: "2026-08-01" },
        { line1: "88 OLD MILL RD", city: "PLANO", state: "TX", postal: "75024", isCurrent: false, reportedOn: "2022-05-01" }
      ])
    }
  });
  const [v, ...rest] = checkStaleAddresses(context);
  assert.equal(rest.length, 0);
  assertWellFormed(v, "M2-031");
  assert.match(v.subject, /88 OLD MILL RD/);
  assert.equal(v.observed.monthsOld, 51);
});

test("M2-031 does not fire on the current address, however long it has been reported", () => {
  assert.deepEqual(checkStaleAddresses(cleanContext()), []);
});

test("M2-031 does not fire on a former address still inside the window", () => {
  const context = cleanContext({
    file: {
      ...cleanContext().file,
      addresses: observed([
        { line1: "88 OLD MILL RD", city: "PLANO", state: "TX", isCurrent: false, reportedOn: "2026-07-01" }
      ])
    }
  });
  assert.deepEqual(checkStaleAddresses(context), []);
});

test("M2-031 does not fire when the file's addresses are not visible", () => {
  assert.deepEqual(checkStaleAddresses(blindContext()), []);
  assert.deepEqual(checkStaleAddresses(bareContext()), []);
});

test("M2-031 respects a caller-supplied cycle count", () => {
  const context = cleanContext({
    options: { addressStaleCycles: 0 },
    file: {
      ...cleanContext().file,
      addresses: observed([
        { line1: "88 OLD MILL RD", city: "PLANO", state: "TX", isCurrent: false, reportedOn: "2026-06-01" }
      ])
    }
  });
  assert.equal(checkStaleAddresses(context).length, 1);
});

// ── M2-032 — name variants ─────────────────────────────────────────────────

test("M2-032 fires on a surname that is not the consumer's", () => {
  const context = cleanContext({
    file: { ...cleanContext().file, names: observed([{ first: "BARBARA", middle: "M", last: "DOTTY" }]) }
  });
  const [v] = checkNameVariants(context);
  assertWellFormed(v, "M2-032");
  assert.equal(v.observed, "BARBARA M DOTTY");
  assert.equal(v.expected, "BARBARA M DOTY");
});

test("M2-032 fires on a first name that is not the consumer's", () => {
  const context = cleanContext({
    file: { ...cleanContext().file, names: observed([{ first: "BARBRA", last: "DOTY" }]) }
  });
  assert.equal(checkNameVariants(context).length, 1);
});

test("M2-032 does not fire on a dropped or added middle initial", () => {
  const context = cleanContext({
    file: {
      ...cleanContext().file,
      names: observed([
        { first: "BARBARA", middle: "M", last: "DOTY" },
        { first: "BARBARA", last: "DOTY" },
        { first: "barbara", middle: "MARIE", last: "Doty" }
      ])
    }
  });
  assert.deepEqual(checkNameVariants(context), []);
});

test("M2-032 does not fire on case or hyphenation differences", () => {
  // Punctuation is folded to a space, so a hyphenated surname matches the same
  // surname written with a space. A comma or a period in a name must never be
  // the thing that puts a paragraph in a dispute letter.
  const context = cleanContext({
    file: { ...cleanContext().file, names: observed([{ first: "barbara", last: "Smith-Jones" }]) },
    consumer: { ...cleanContext().consumer, legalName: observed({ first: "BARBARA", last: "SMITH JONES" }) }
  });
  assert.deepEqual(checkNameVariants(context), []);
});

test("M2-032 does not fire without the consumer's legal name", () => {
  assert.deepEqual(checkNameVariants(blindContext()), []);
});

test("sameName compares first and last only, and refuses an empty side", () => {
  assert.equal(sameName({ first: "A", last: "B" }, { first: "A", middle: "Z", last: "B" }), true);
  assert.equal(sameName({ first: "A", last: "B" }, { first: "A", last: "C" }), false);
  assert.equal(sameName({ first: "", last: "B" }, { first: "", last: "B" }), false);
  assert.equal(sameName(null, { first: "A", last: "B" }), false);
});

// ── M2-033 — date of birth ─────────────────────────────────────────────────

test("M2-033 fires on a date of birth that is not the consumer's", () => {
  const context = cleanContext({ file: { ...cleanContext().file, dateOfBirth: observed("1966-04-01") } });
  const [v] = checkDateOfBirthMismatch(context);
  assertWellFormed(v, "M2-033");
  assert.equal(v.observed, "1966-04-01");
  assert.equal(v.expected, "1966-01-04");
});

test("M2-033 does not fire when the dates agree", () => {
  assert.deepEqual(checkDateOfBirthMismatch(cleanContext()), []);
});

test("M2-033 does not fire when either side is not visible", () => {
  assert.deepEqual(checkDateOfBirthMismatch(blindContext()), []);
  const halfBlind = cleanContext({ file: { ...cleanContext().file, dateOfBirth: notVisible() } });
  assert.deepEqual(checkDateOfBirthMismatch(halfBlind), []);
});

// ── M2-034 — outdated employment ───────────────────────────────────────────

test("M2-034 fires on an employer the consumer has left", () => {
  const context = cleanContext({
    file: {
      ...cleanContext().file,
      employments: observed([
        { name: "DATAWORKS", reportedOn: "2026-01-10" },
        { name: "ABC", reportedOn: "2019-06-01" }
      ])
    }
  });
  const [v, ...rest] = checkOutdatedEmployment(context);
  assert.equal(rest.length, 0);
  assertWellFormed(v, "M2-034");
  assert.equal(v.subject, "ABC");
  assert.equal(v.field, "N1");
});

test("M2-034 does not fire on the consumer's current employer", () => {
  assert.deepEqual(checkOutdatedEmployment(cleanContext()), []);
});

test("M2-034 does not fire without the consumer's employment statement", () => {
  assert.deepEqual(checkOutdatedEmployment(blindContext()), []);
});

test("addressLabel skips missing parts rather than printing gaps", () => {
  assert.equal(addressLabel({ line1: "1 A ST", city: "DENTON", state: "TX", postal: "76205" }), "1 A ST, DENTON, TX, 76205");
  assert.equal(addressLabel({ line1: "1 A ST", city: "", state: "TX" }), "1 A ST, TX");
  assert.equal(addressLabel(null), null);
});
