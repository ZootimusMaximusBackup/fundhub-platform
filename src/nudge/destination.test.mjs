// The destination key: two spellings of one phone number have to collide, or
// the daily cap counts records instead of people.

import { test } from "node:test";
import assert from "node:assert";
import { destinationKey, sameDestination, MIN_PHONE_DIGITS } from "./destination.mjs";
import { contactFor } from "./exits.mjs";

test("the same phone written five ways is ONE destination", () => {
  // This is the whole point. On 2026-09-06 a scratch database showed two client
  // rows, '+15550004000' and '+1 (555) 000-4000', getting two texts in one day.
  const spellings = [
    "+15550004000",
    "+1 (555) 000-4000",
    "1-555-000-4000",
    "555.000.4000",
    "  5550004000  "
  ];
  const keys = spellings.map((s) => destinationKey("sms", s));
  assert.deepEqual([...new Set(keys)], ["5550004000"], JSON.stringify(keys));
  for (const s of spellings) assert.ok(sameDestination("sms", s, "+1 555 000 4000"), s);
});

test("two different phones are two destinations", () => {
  assert.equal(sameDestination("sms", "+15550004000", "+15550004001"), false);
});

test("an email is lowercased, and two cases of one address collide", () => {
  assert.equal(destinationKey("email", "  Chris@Example.COM "), "chris@example.com");
  assert.ok(sameDestination("email", "chris@example.com", "CHRIS@EXAMPLE.com"));
});

test("unknown is null, and two unknowns are NOT the same destination", () => {
  // NULL means unknown (CLAUDE.md §12). It is never '' and never a placeholder,
  // and 369's partial index skips it, so an unknown destination blocks nobody.
  for (const bad of [null, undefined, "", "   ", "12345", "not-an-email", "a@b"]) {
    const asSms = destinationKey("sms", bad);
    const asEmail = destinationKey("email", bad);
    assert.ok(asSms === null || /^\d{10,}$/.test(asSms), `sms ${JSON.stringify(bad)} -> ${asSms}`);
    assert.ok(asEmail === null || asEmail.includes("@"), `email ${JSON.stringify(bad)} -> ${asEmail}`);
  }
  assert.equal(destinationKey("sms", ""), null);
  assert.equal(destinationKey("sms", "12345"), null);
  assert.equal(destinationKey("email", "not-an-email"), null);
  assert.equal(sameDestination("sms", "", ""), false, "unknown is not equal to unknown");
  assert.equal(sameDestination("sms", null, null), false);
});

test("an unknown channel has no destination, and does not fall back to the raw string", () => {
  assert.equal(destinationKey("voice", "+15550004000"), null);
  assert.equal(destinationKey("carrier pigeon", "+15550004000"), null);
});

test("the NANP rule is applied, and its limit is real rather than claimed away", () => {
  // 11 digits starting with 1 loses the 1.
  assert.equal(destinationKey("sms", "+1 555 000 4000"), "5550004000");
  assert.equal(destinationKey("sms", "5550004000"), "5550004000");
  // A non-US number keeps every digit — there is no phone number parser here
  // and no dependency was added for one. The two UK spellings below do NOT
  // collide, which is the documented gap and fails toward one extra message
  // rather than toward a missed stop.
  assert.equal(destinationKey("sms", "+44 20 7946 0000"), "442079460000");
  assert.equal(destinationKey("sms", "020 7946 0000"), "02079460000");
  assert.equal(sameDestination("sms", "+44 20 7946 0000", "020 7946 0000"), false);
});

test("the digit floor agrees with the one contactFor uses to accept an SMS", () => {
  /* If these two ever disagree, a message can be queued against an address the
     daily cap cannot see — which is the defect 369 exists to close. run.mjs
     refuses that case outright, and this pins the two rules together so the
     refusal stays unreachable. */
  assert.equal(MIN_PHONE_DIGITS, 10);
  for (const phone of ["+15550004000", "5550004000", "+1 (555) 000-4000", "15550004000"]) {
    assert.ok(contactFor({ phone }, "sms"), `contactFor should accept ${phone}`);
    assert.ok(destinationKey("sms", phone), `destinationKey should key ${phone}`);
  }
  for (const phone of ["", "   ", "12345", "555000400"]) {
    assert.equal(contactFor({ phone }, "sms"), null, `contactFor should refuse ${phone}`);
    assert.equal(destinationKey("sms", phone), null, `destinationKey should refuse ${phone}`);
  }
  for (const email of ["a@b.com", "Chris@Example.COM"]) {
    assert.ok(contactFor({ email }, "email"), email);
    assert.ok(destinationKey("email", email), email);
  }
  for (const email of ["", "not-an-email", "a@b"]) {
    assert.equal(contactFor({ email }, "email"), null, email);
    assert.equal(destinationKey("email", email), null, email);
  }
});
