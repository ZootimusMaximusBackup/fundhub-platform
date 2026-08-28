// The whole safety story of test-identity.mjs is "a real customer's address can
// never match". These tests are that claim, written down.

import { test } from "node:test";
import assert from "node:assert";
import { isTestEmail, testEmailTag, demoFlagForEmail } from "./test-identity.mjs";

const env = (v) => (v === null ? {} : { TEST_EMAIL_TAG: v });

test("the default tag is fhtest", () => {
  assert.equal(testEmailTag({}), "fhtest");
  assert.equal(testEmailTag({ TEST_EMAIL_TAG: "  QaRun " }), "qarun");
});

test("a plus-tagged address is a test address", () => {
  for (const e of [
    "chris+fhtest@gmail.com",
    "chris+fhtest2@gmail.com",
    "chris+fhtest-run4@gmail.com",
    "Chris+FHTEST@Gmail.com",
    "a+b+fhtest@x.io",
  ]) assert.equal(isTestEmail(e, { env: env(null) }), true, e);
});

test("an ordinary address is never a test address", () => {
  for (const e of [
    "chris@gmail.com",
    "chris+newsletter@gmail.com",
    "chris+fh@gmail.com",          // shorter than the tag
    "chris+test@gmail.com",        // a different word
    "fhtest@gmail.com",            // tag as the whole local part, no plus
    "someone@fhtest.com",          // tag in the DOMAIN, not the local part
    "notfhtest+other@a.com",
    "@fhtest.com",
    "no-at-sign",
    "",
  ]) assert.equal(isTestEmail(e, { env: env(null) }), false, e);
});

test("a non-string is never a test address", () => {
  for (const v of [null, undefined, 0, {}, [], true])
    assert.equal(isTestEmail(v, { env: env(null) }), false, String(v));
});

test("an empty TEST_EMAIL_TAG switches the whole mechanism off", () => {
  assert.equal(testEmailTag(env("")), "");
  assert.equal(isTestEmail("chris+fhtest@gmail.com", { env: env("") }), false);
  assert.equal(isTestEmail("chris+@gmail.com", { env: env("") }), false);
});

test("the tag is configurable", () => {
  assert.equal(isTestEmail("chris+qarun@gmail.com", { env: env("qarun") }), true);
  assert.equal(isTestEmail("chris+fhtest@gmail.com", { env: env("qarun") }), false);
});

test("demoFlagForEmail is the same answer, named for the column", () => {
  assert.equal(demoFlagForEmail("chris+fhtest@gmail.com", { env: env(null) }), true);
  assert.equal(demoFlagForEmail("chris@gmail.com", { env: env(null) }), false);
});
