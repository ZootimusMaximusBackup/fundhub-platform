// COMPLIANCE REVIEW REQUIRED — fee timing. The owner-set price of a self-serve
// dispute round, pinned so a later edit cannot move it quietly.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  priceDisputeRound,
  sumComponents,
  ROUND_BASE_CENTS,
  CREDITOR_LETTER_CENTS,
  ESCALATION_FILINGS_CENTS
} from "./pricing.mjs";

test("the owner-set prices are $100, +$10 and +$20 in integer cents", () => {
  assert.equal(ROUND_BASE_CENTS, 10_000);
  assert.equal(CREDITOR_LETTER_CENTS, 1_000);
  assert.equal(ESCALATION_FILINGS_CENTS, 2_000);
});

test("a plain round is one line item of $100 covering all three bureaus", () => {
  const { components, totalCents } = priceDisputeRound();
  assert.equal(components.length, 1);
  assert.equal(components[0].code, "round_base");
  assert.match(components[0].label, /all three bureaus/);
  assert.equal(totalCents, 10_000);
});

test("a creditor letter adds $10 as its own line", () => {
  const { components, totalCents } = priceDisputeRound({ creditorLetter: true });
  assert.deepEqual(components.map((c) => c.code), ["round_base", "creditor_letter"]);
  assert.equal(totalCents, 11_000);
});

test("the escalation filings add $20 as their own line", () => {
  const { components, totalCents } = priceDisputeRound({ escalationFilings: true });
  assert.deepEqual(components.map((c) => c.code), ["round_base", "escalation_filings"]);
  assert.equal(totalCents, 12_000);
});

test("everything on one round is $130, and the lines add up to it", () => {
  const { components, totalCents } = priceDisputeRound({
    creditorLetter: true,
    escalationFilings: true
  });
  assert.equal(totalCents, 13_000);
  assert.equal(sumComponents(components), totalCents,
    "the receipt must add up to its own total — the database refuses it otherwise");
});

test("every line carries the fields a receipt needs", () => {
  const { components } = priceDisputeRound({ creditorLetter: true });
  for (const c of components) {
    assert.equal(typeof c.code, "string");
    assert.equal(typeof c.label, "string");
    assert.ok(Number.isInteger(c.unit_cents) && c.unit_cents > 0);
    assert.ok(Number.isInteger(c.quantity) && c.quantity > 0);
    assert.equal(c.amount_cents, c.unit_cents * c.quantity);
  }
});

test("a malformed line throws rather than quietly summing to less", () => {
  assert.throws(() => sumComponents([{ code: "x", amount_cents: 10.5 }]), /integer/);
  assert.throws(() => sumComponents([{ amount_cents: 100 }]), /code/);
  assert.throws(() => sumComponents("not an array"), /array/);
});
