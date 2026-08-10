// § 5.7 inquiries — M2-035 … M2-038.
//
// M2-035 and M2-037 rest on statements only the consumer can make: "I never
// applied to them" and "I do not recognise them". The negative fixtures prove
// the engine never makes those statements on the consumer's behalf — with the
// consumer silent, the rules are silent.

import test from "node:test";
import assert from "node:assert/strict";

import {
  checkInquiryWithoutPermissiblePurpose,
  checkDuplicateSameDayInquiries,
  checkUnrecognisedInquiry,
  checkInquiryTooOld,
  inquiryLabel
} from "./inquiries.mjs";
import { cleanContext, blindContext, bareContext, observed, notVisible } from "./fixtures/tradelines.mjs";

function assertWellFormed(v, ruleId) {
  assert.equal(v.ruleId, ruleId);
  assert.equal(v.severity, "supporting");
  assert.equal(v.scope, "report");
  assert.ok(typeof v.reason === "string" && v.reason.length > 20);
  assert.ok(Array.isArray(v.citations) && v.citations.length > 0);
  assert.ok(typeof v.metro2Ref === "string" && v.metro2Ref.length > 0);
}

function inquiry(overrides = {}) {
  return {
    creditor: "SHARON & CRESCENT UNIT",
    inquiryDate: "2026-04-10",
    bureau: "EX",
    hard: observed(true),
    consumerAuthorized: observed(true),
    consumerRecognizes: observed(true),
    ...overrides
  };
}

const withInquiries = (inquiries, overrides = {}) => cleanContext({ inquiries: observed(inquiries), ...overrides });

// ── M2-035 — no permissible purpose ────────────────────────────────────────

test("M2-035 fires when the consumer never applied and no account with that company exists", () => {
  const context = withInquiries([inquiry({ consumerAuthorized: observed(false) })]);
  const [v, ...rest] = checkInquiryWithoutPermissiblePurpose(context);
  assert.equal(rest.length, 0);
  assertWellFormed(v, "M2-035");
  assert.match(v.reason, /no permissible purpose/);
});

test("M2-035 does not fire when an account with that company is on the file", () => {
  // An account was opened, so the pull had a purpose — the § 5.7 trigger is the
  // conjunction of no account AND no application.
  const context = withInquiries([inquiry({ creditor: "CITIBANK SD NA", consumerAuthorized: observed(false) })]);
  assert.deepEqual(checkInquiryWithoutPermissiblePurpose(context), []);
});

test("M2-035 does not fire when the consumer did apply", () => {
  assert.deepEqual(checkInquiryWithoutPermissiblePurpose(withInquiries([inquiry()])), []);
});

test("M2-035 does not fire when the consumer has said nothing about authorising the pull", () => {
  const context = withInquiries([inquiry({ consumerAuthorized: notVisible() })]);
  assert.deepEqual(checkInquiryWithoutPermissiblePurpose(context), []);
});

test("M2-035 does not fire on a soft pull", () => {
  const context = withInquiries([inquiry({ hard: observed(false), consumerAuthorized: observed(false) })]);
  assert.deepEqual(checkInquiryWithoutPermissiblePurpose(context), []);
});

test("M2-035 does not fire without the list of creditors on the file", () => {
  assert.deepEqual(checkInquiryWithoutPermissiblePurpose(blindContext()), []);
  assert.deepEqual(checkInquiryWithoutPermissiblePurpose(bareContext()), []);
});

// ── M2-036 — same-day duplicates ───────────────────────────────────────────

test("M2-036 fires on the second and later pulls by one company on one day", () => {
  const context = withInquiries([inquiry(), inquiry(), inquiry()]);
  const found = checkDuplicateSameDayInquiries(context);
  assert.equal(found.length, 2);
  assertWellFormed(found[0], "M2-036");
  assert.deepEqual(found.map((v) => v.observed.occurrence), [2, 3]);
});

test("M2-036 does not fire on the same company pulling on different days", () => {
  const context = withInquiries([inquiry(), inquiry({ inquiryDate: "2026-04-11" })]);
  assert.deepEqual(checkDuplicateSameDayInquiries(context), []);
});

test("M2-036 does not fire on different companies pulling on the same day", () => {
  const context = withInquiries([inquiry(), inquiry({ creditor: "PEOPLES UNITED BANK" })]);
  assert.deepEqual(checkDuplicateSameDayInquiries(context), []);
});

test("M2-036 treats the same company at two bureaus on one day as separate", () => {
  const context = withInquiries([inquiry(), inquiry({ bureau: "TU" })]);
  assert.deepEqual(checkDuplicateSameDayInquiries(context), []);
});

test("M2-036 does not fire when the inquiry list is not visible", () => {
  assert.deepEqual(checkDuplicateSameDayInquiries(blindContext()), []);
});

// ── M2-037 — unrecognised entity ───────────────────────────────────────────

test("M2-037 fires when the consumer does not recognise the company", () => {
  const context = withInquiries([inquiry({ consumerRecognizes: observed(false) })]);
  const [v] = checkUnrecognisedInquiry(context);
  assertWellFormed(v, "M2-037");
  assert.match(v.reason, /does not recognise/);
});

test("M2-037 does not fire when the consumer recognises the company", () => {
  assert.deepEqual(checkUnrecognisedInquiry(withInquiries([inquiry()])), []);
});

test("M2-037 does not fire when the consumer has not been asked", () => {
  const context = withInquiries([inquiry({ consumerRecognizes: notVisible() })]);
  assert.deepEqual(checkUnrecognisedInquiry(context), []);
});

// ── M2-038 — inquiry past two years ────────────────────────────────────────

test("M2-038 fires on a hard inquiry more than two years old", () => {
  const context = withInquiries([inquiry({ inquiryDate: "2024-03-17" })]);
  const [v] = checkInquiryTooOld(context);
  assertWellFormed(v, "M2-038");
  assert.equal(v.observed.inquiryDate, "2024-03-17");
});

test("M2-038 does not fire inside the two-year window", () => {
  assert.deepEqual(checkInquiryTooOld(withInquiries([inquiry({ inquiryDate: "2025-08-24" })])), []);
});

test("M2-038 does not fire exactly on the two-year mark", () => {
  assert.deepEqual(checkInquiryTooOld(withInquiries([inquiry({ inquiryDate: "2024-08-07" })])), []);
});

test("M2-038 does not fire on a soft pull, however old", () => {
  const context = withInquiries([inquiry({ inquiryDate: "2019-01-01", hard: observed(false) })]);
  assert.deepEqual(checkInquiryTooOld(context), []);
});

test("M2-038 does not fire when the inquiry list is not visible", () => {
  assert.deepEqual(checkInquiryTooOld(blindContext()), []);
});

test("inquiryLabel identifies an inquiry even when parts are missing", () => {
  assert.equal(inquiryLabel({ creditor: "CITI", inquiryDate: "2026-01-01" }), "CITI (2026-01-01)");
  assert.equal(inquiryLabel({}), "unnamed company (unknown date)");
});
