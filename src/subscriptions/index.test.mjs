// Unit tests for the pure half of subscriptions. No database.
//
// The tests that matter most here are the REFUSALS. Every one of them checks
// that a wrong value throws rather than being quietly repaired, because a quiet
// repair is what lets a card number, a float price or a zero-for-unknown reach
// storage while the caller reads a success.

import { test } from "node:test";
import assert from "node:assert";
import {
  looksLikeCardNumber, assertNoCardData, normalizeCardMeta,
  priceToCents, formatPrice, assertPriceCents, isLiveAt, planChange
} from "./index.mjs";

// ---------------------------------------------------------------------------
// card data that must never arrive
// ---------------------------------------------------------------------------

test("looksLikeCardNumber recognises a card number however it is punctuated", () => {
  assert.equal(looksLikeCardNumber("4242424242424242"), true);
  assert.equal(looksLikeCardNumber("4242 4242 4242 4242"), true);
  assert.equal(looksLikeCardNumber("4242-4242-4242-4242"), true);
  assert.equal(looksLikeCardNumber("378282246310005"), true, "15-digit Amex");
  assert.equal(looksLikeCardNumber("123456789012"), true, "12 digits is the short end of the range");
});

test("looksLikeCardNumber does not fire on a processor token or a short number", () => {
  assert.equal(looksLikeCardNumber("tok_1PxYz2eZvKYlo2C0"), false);
  assert.equal(looksLikeCardNumber("pm_1234567890123456"), false);
  assert.equal(looksLikeCardNumber("4242"), false, "a last4 is not a PAN");
  assert.equal(looksLikeCardNumber("12345678901"), false, "11 digits is below the range");
  assert.equal(looksLikeCardNumber("12345678901234567890"), false, "20 digits is above it");
  assert.equal(looksLikeCardNumber(null), false);
  assert.equal(looksLikeCardNumber(undefined), false);
});

test("assertNoCardData throws on every field that could carry a number or a code", () => {
  for (const field of ["pan", "card_number", "cardNumber", "number", "cvv", "cvc", "security_code"]) {
    assert.throws(
      () => assertNoCardData({ [field]: "4242424242424242" }),
      (e) => e instanceof TypeError && e.message.includes(field),
      `${field} must be refused by name`
    );
  }
});

test("assertNoCardData throws even when the forbidden field is empty", () => {
  // A caller sending card_number:"" is still a caller holding card data. The
  // point of failure is the shape of the request, not whether this one was full.
  assert.throws(() => assertNoCardData({ cvv: "" }), /never be sent/);
});

test("assertNoCardData passes a clean token payload", () => {
  assert.doesNotThrow(() => assertNoCardData({ provider_token: "tok_abc", brand: "visa", last4: "4242" }));
});

test("normalizeCardMeta returns exactly the columns client_cards accepts", () => {
  const out = normalizeCardMeta({
    provider: "commas", provider_token: "tok_abc123",
    brand: "Visa", last4: "4242", exp_month: 4, exp_year: 2029
  });
  assert.deepEqual(out, {
    provider: "commas", provider_token: "tok_abc123",
    brand: "Visa", last4: "4242", exp_month: 4, exp_year: 2029
  });
  assert.deepEqual(Object.keys(out).sort(),
    ["brand", "exp_month", "exp_year", "last4", "provider", "provider_token"],
    "no extra key may reach the write — an extra key is how a PAN gets in");
});

test("normalizeCardMeta accepts camelCase too, because both shapes arrive here", () => {
  const out = normalizeCardMeta({ providerToken: "tok_x", lastFour: "1111", expMonth: 12, expYear: 2030 });
  assert.equal(out.provider_token, "tok_x");
  assert.equal(out.last4, "1111");
  assert.equal(out.exp_month, 12);
  assert.equal(out.exp_year, 2030);
});

test("normalizeCardMeta refuses a card number in the token field", () => {
  assert.throws(
    () => normalizeCardMeta({ provider_token: "4242424242424242" }),
    /shaped like a card number/
  );
  assert.throws(
    () => normalizeCardMeta({ provider_token: "4242 4242 4242 4242" }),
    /shaped like a card number/
  );
});

test("normalizeCardMeta REFUSES a long last4 rather than truncating it", () => {
  // Truncating would mean accepting the full number, holding it, and reporting
  // success — so nothing upstream ever learns it sent one.
  assert.throws(
    () => normalizeCardMeta({ provider_token: "tok_abc", last4: "4242424242424242" }),
    /never truncated/
  );
  assert.throws(() => normalizeCardMeta({ provider_token: "tok_abc", last4: "424" }), /exactly four digits/);
  assert.throws(() => normalizeCardMeta({ provider_token: "tok_abc", last4: "42a2" }), /exactly four digits/);
});

test("normalizeCardMeta requires a token — there is nothing else to charge with", () => {
  assert.throws(() => normalizeCardMeta({ brand: "Visa" }), /provider_token is required/);
  assert.throws(() => normalizeCardMeta({ provider_token: "   " }), /provider_token is required/);
  assert.throws(() => normalizeCardMeta(null), /an object is required/);
});

test("normalizeCardMeta leaves unknown metadata null and never invents a value", () => {
  const out = normalizeCardMeta({ provider_token: "tok_only" });
  assert.equal(out.brand, null);
  assert.equal(out.last4, null);
  assert.equal(out.exp_month, null);
  assert.equal(out.exp_year, null);
  assert.equal(out.provider, "commas", "the provider defaults to the one this repo uses");
  assert.equal(normalizeCardMeta({ provider_token: "tok_only", brand: "   " }).brand, null,
    "whitespace is not a brand");
});

test("normalizeCardMeta refuses an impossible expiry instead of nulling it out", () => {
  assert.throws(() => normalizeCardMeta({ provider_token: "t", exp_month: 0 }), /exp_month must be 1-12/);
  assert.throws(() => normalizeCardMeta({ provider_token: "t", exp_month: 13 }), /exp_month must be 1-12/);
  assert.throws(() => normalizeCardMeta({ provider_token: "t", exp_month: 4.5 }), /exp_month must be 1-12/);
});

test("normalizeCardMeta refuses a two-digit year rather than guessing the century", () => {
  assert.throws(() => normalizeCardMeta({ provider_token: "t", exp_year: 29 }), /four-digit year/);
  assert.throws(() => normalizeCardMeta({ provider_token: "t", exp_year: 1999 }), /four-digit year/);
  assert.equal(normalizeCardMeta({ provider_token: "t", exp_year: 2029 }).exp_year, 2029);
});

// ---------------------------------------------------------------------------
// money
// ---------------------------------------------------------------------------

test("priceToCents maps an unrecorded price to NULL, not to zero", () => {
  // money.toCents(null) is 0 and that is right for "no payments yet". It is
  // wrong here: a zero price is a free subscription somebody decided on.
  assert.equal(priceToCents(null), null);
  assert.equal(priceToCents(undefined), null);
  assert.equal(priceToCents(""), null);
});

test("priceToCents converts dollars to integer cents", () => {
  assert.equal(priceToCents(199), 19900);
  assert.equal(priceToCents(19.99), 1999);
  assert.equal(priceToCents("19.99"), 1999);
  assert.equal(priceToCents(0), 0, "an explicit zero is a real price and stays zero");
  assert.equal(Number.isInteger(priceToCents(19.99)), true);
});

test("formatPrice returns a fixed 2dp STRING, and null for an unknown price", () => {
  assert.equal(formatPrice(1999), "19.99");
  assert.equal(typeof formatPrice(1999), "string", "a float cannot hold 19.99 exactly");
  assert.equal(formatPrice(19900), "199.00");
  assert.equal(formatPrice(0), "0.00");
  assert.equal(formatPrice(null), null);
  assert.equal(formatPrice(undefined), null);
});

test("assertPriceCents refuses dollars-shaped money on a cents column", () => {
  assert.equal(assertPriceCents(1999), 1999);
  assert.equal(assertPriceCents(null), null);
  assert.equal(assertPriceCents(undefined), null);
  assert.throws(() => assertPriceCents(19.99), /integer cents/);
  assert.throws(() => assertPriceCents("1999"), /integer cents/);
  assert.throws(() => assertPriceCents(-1), /must not be negative/);
});

// ---------------------------------------------------------------------------
// effective dating
// ---------------------------------------------------------------------------

const WINDOW = {
  effective_from: "2026-01-01T00:00:00.000Z",
  effective_to: "2026-06-01T00:00:00.000Z"
};

test("isLiveAt treats the window as half-open, so a change instant belongs to one version", () => {
  assert.equal(isLiveAt(WINDOW, "2026-03-01T00:00:00.000Z"), true);
  assert.equal(isLiveAt(WINDOW, "2026-01-01T00:00:00.000Z"), true, "the opening instant is inside");
  assert.equal(isLiveAt(WINDOW, "2026-06-01T00:00:00.000Z"), false, "the closing instant is not");
  assert.equal(isLiveAt(WINDOW, "2025-12-31T23:59:59.999Z"), false);
});

test("isLiveAt says an open-ended version is live, and an absent one is not", () => {
  assert.equal(isLiveAt({ effective_from: "2026-01-01T00:00:00.000Z", effective_to: null }, "2030-01-01T00:00:00.000Z"), true);
  assert.equal(isLiveAt(null, "2026-03-01T00:00:00.000Z"), false);
  assert.equal(isLiveAt({}, "2026-03-01T00:00:00.000Z"), false);
});

test("a cancelled version is still live until the date it actually ends", () => {
  // The client asked to stop in March; the paid period runs to June. Between
  // those dates the charge they already made is explained by this row.
  const cancelled = { ...WINDOW, status: "cancelled", cancelled_at: "2026-03-01T00:00:00.000Z" };
  assert.equal(isLiveAt(cancelled, "2026-04-01T00:00:00.000Z"), true);
  assert.equal(isLiveAt(cancelled, "2026-06-02T00:00:00.000Z"), false);
});

test("planChange returns the terms of the version it opens", () => {
  const current = { id: "s1", tier: "starter", price_cents: 9900, currency: "USD", effective_from: "2026-01-01T00:00:00.000Z", effective_to: null };
  const out = planChange(current, { tier: "pro", price_cents: 19900 }, "2026-03-01T00:00:00.000Z");
  assert.deepEqual(out, {
    tier: "pro", price_cents: 19900, currency: "USD",
    effective_from: "2026-03-01T00:00:00.000Z"
  });
});

test("planChange carries the price forward when only the tier moves, and only when asked", () => {
  const current = { tier: "starter", price_cents: 9900, currency: "USD", effective_from: "2026-01-01T00:00:00.000Z", effective_to: null };
  assert.equal(planChange(current, { tier: "pro" }, "2026-03-01T00:00:00.000Z").price_cents, 9900,
    "an omitted price inherits");
  assert.equal(planChange(current, { tier: "pro", price_cents: null }, "2026-03-01T00:00:00.000Z").price_cents, null,
    "an explicit null records that the new tier's price is not known — it is not zero");
});

test("planChange refuses a change that changes nothing", () => {
  const current = { tier: "starter", price_cents: 9900, currency: "USD", effective_from: "2026-01-01T00:00:00.000Z", effective_to: null };
  assert.throws(
    () => planChange(current, { tier: "starter", price_cents: 9900 }, "2026-03-01T00:00:00.000Z"),
    /unchanged/
  );
});

test("planChange refuses to fork a closed version or to change one that does not exist", () => {
  assert.throws(() => planChange(null, { tier: "pro" }, "2026-03-01T00:00:00.000Z"), /no live subscription/);
  assert.throws(
    () => planChange({ id: "s1", tier: "starter", price_cents: 1, effective_from: "2026-01-01T00:00:00.000Z", effective_to: "2026-02-01T00:00:00.000Z" },
      { tier: "pro" }, "2026-03-01T00:00:00.000Z"),
    /already closed/
  );
});

test("planChange refuses a change dated at or before the version it closes", () => {
  const current = { tier: "starter", price_cents: 9900, currency: "USD", effective_from: "2026-01-01T00:00:00.000Z", effective_to: null };
  assert.throws(() => planChange(current, { tier: "pro" }, "2026-01-01T00:00:00.000Z"), /must fall after/);
  assert.throws(() => planChange(current, { tier: "pro" }, "2025-12-01T00:00:00.000Z"), /must fall after/);
});

test("planChange refuses a float price on the way in", () => {
  const current = { tier: "starter", price_cents: 9900, currency: "USD", effective_from: "2026-01-01T00:00:00.000Z", effective_to: null };
  assert.throws(() => planChange(current, { tier: "pro", price_cents: 199.0001 }, "2026-03-01T00:00:00.000Z"), /integer cents/);
});
