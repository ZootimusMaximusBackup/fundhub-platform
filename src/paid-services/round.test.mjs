// Unit tests for the paid round — the parts that need no database.
//
// The price is owner-set and is the number a client is charged, so every one of
// these assertions is written in cents against the owner's own words:
//
//   $100 flat per round covering all three bureaus
//   +$10 when a creditor letter is required
//   +$20 when CFPB and state AG are required
//
// If a future edit changes a price, these fail by NAME and the failure says
// which of the three moved.

import { test, describe } from "node:test";
import assert from "node:assert";

import {
  quoteRound,
  roundPriceList,
  derivedIdempotencyKey,
  OPEN_STATUSES,
  SERVICE_KIND,
  SERVICE_KEY
} from "./round.mjs";
import {
  REFUSAL,
  REFUSAL_CODES,
  refuse,
  refusalMessage,
  refusalStatus,
  violatesClientCopyRules
} from "./refusals.mjs";
import { checkoutTitleFor } from "./checkout.mjs";
import { commasCopyViolation } from "../payments/commas-safe-copy.mjs";
import {
  requestIdFromEvent,
  paidCentsFromEvent
} from "../handlers/paid-service-payment.mjs";

describe("the price, in cents", () => {
  test("a plain round is 10000 cents and one line", () => {
    const q = quoteRound();
    assert.equal(q.totalCents, 10_000);
    assert.equal(q.components.length, 1);
    assert.equal(q.components[0].code, "round_base");
    assert.equal(q.components[0].amount_cents, 10_000);
  });

  test("+ a creditor letter is 11000 cents", () => {
    const q = quoteRound({ creditorLetter: true });
    assert.equal(q.totalCents, 11_000);
    assert.deepEqual(q.components.map((c) => c.code), ["round_base", "creditor_letter"]);
  });

  test("+ the CFPB and state AG filings is 12000 cents", () => {
    const q = quoteRound({ escalationFilings: true });
    assert.equal(q.totalCents, 12_000);
    assert.deepEqual(q.components.map((c) => c.code), ["round_base", "escalation_filings"]);
  });

  test("both add-ons is 13000 cents", () => {
    const q = quoteRound({ creditorLetter: true, escalationFilings: true });
    assert.equal(q.totalCents, 13_000);
    assert.equal(q.components.length, 3);
  });

  test("every line is a whole number of cents — no floats anywhere", () => {
    for (const opts of [{}, { creditorLetter: true }, { escalationFilings: true },
      { creditorLetter: true, escalationFilings: true }]) {
      const q = quoteRound(opts);
      assert.ok(Number.isInteger(q.totalCents), `total ${q.totalCents} is not an integer`);
      for (const c of q.components) {
        assert.ok(Number.isInteger(c.amount_cents), `${c.code} amount is not an integer`);
        assert.ok(Number.isInteger(c.unit_cents), `${c.code} unit is not an integer`);
      }
    }
  });

  test("the lines always sum to the total the database will check", () => {
    for (const opts of [{}, { creditorLetter: true }, { escalationFilings: true },
      { creditorLetter: true, escalationFilings: true }]) {
      const q = quoteRound(opts);
      const sum = q.components.reduce((a, c) => a + c.amount_cents, 0);
      assert.equal(sum, q.totalCents);
    }
  });
});

describe("the price list a screen renders", () => {
  test("three components, keyed exactly as the client-progress contract says", () => {
    assert.deepEqual(roundPriceList().map((c) => c.key), ["base", "creditor", "cfpb_and_ag"]);
  });

  test("the add-on prices are the DIFFERENCE, so the list cannot drift from the charge", () => {
    const list = roundPriceList();
    const by = Object.fromEntries(list.map((c) => [c.key, c.priceCents]));
    assert.equal(by.base, 10_000);
    assert.equal(by.creditor, 1_000);
    assert.equal(by.cfpb_and_ag, 2_000);
    assert.equal(by.base + by.creditor, quoteRound({ creditorLetter: true }).totalCents);
    assert.equal(by.base + by.cfpb_and_ag, quoteRound({ escalationFilings: true }).totalCents);
  });

  test("only the base is required", () => {
    const list = roundPriceList();
    assert.deepEqual(list.map((c) => c.required), [true, false, false]);
  });
});

describe("the owner-set branding guardrail", () => {
  test("no refusal a client reads contains the banned phrase", () => {
    for (const code of REFUSAL_CODES) {
      const msg = refusalMessage(code);
      assert.deepEqual(violatesClientCopyRules(msg), [],
        `refusal ${code} contains banned client-facing wording: ${msg}`);
    }
  });

  test("the generic fallback is clean too", () => {
    assert.deepEqual(violatesClientCopyRules(refusalMessage("no_such_code")), []);
  });

  test("the guard actually catches the phrase it is written to catch", () => {
    // A test that only asserts "nothing matched" passes when the matcher is
    // broken. This one proves the matcher works.
    assert.deepEqual(violatesClientCopyRules("we do CREDIT REPAIR here"), ["credit repair"]);
  });
});

describe("the refusal table", () => {
  test("every code has a sentence and a status, and none is a 500", () => {
    for (const code of REFUSAL_CODES) {
      assert.ok(refusalMessage(code).length > 20, `${code} has no real sentence`);
      const s = refusalStatus(code);
      assert.ok(s >= 400 && s < 500 || s === 502, `${code} maps to ${s}`);
    }
  });

  test("an unknown code refuses rather than crashing or returning undefined", () => {
    const r = refuse("something_new");
    assert.equal(r.ok, false);
    assert.equal(r.status, 409);
    assert.ok(r.message);
  });

  test("the two post-payment refusals say money was taken, and the pre-payment ones say it was not", () => {
    // Wording matters here more than anywhere: a client who has paid and a
    // client who has not must not read the same sentence.
    assert.match(refusalMessage(REFUSAL.PAYMENT_FAILED), /nothing has been charged/i);
    assert.match(refusalMessage(REFUSAL.PULL_FAILED), /payment went through/i);
    assert.match(refusalMessage(REFUSAL.ALREADY_IN_FLIGHT), /charge you twice/i);
  });

  test("detail is truncated so a processor error body cannot be pasted at a client", () => {
    const r = refuse(REFUSAL.PAYMENT_FAILED, "x".repeat(5000));
    assert.equal(r.detail.length, 300);
  });
});

describe("the processor-facing product title", () => {
  test("it passes the owner-set Commas copy ban", () => {
    for (const n of [null, 1, 2, 7, 99]) {
      const title = checkoutTitleFor(n);
      assert.equal(commasCopyViolation(title), null,
        `"${title}" contains a term banned from outbound Commas copy`);
    }
  });

  test("it names the self-serve round number when there is one", () => {
    assert.equal(checkoutTitleFor(3), "Document round 3");
    assert.equal(checkoutTitleFor(null), "Document round");
    assert.equal(checkoutTitleFor(0), "Document round");
  });
});

describe("the replay guard", () => {
  test("the derived key is stable for one client and one round slot", () => {
    const a = derivedIdempotencyKey({ clientId: "c1", roundNo: 2 });
    const b = derivedIdempotencyKey({ clientId: "c1", roundNo: 2 });
    assert.equal(a, b);
  });

  test("a different round slot is a different key, so a later round is not blocked", () => {
    assert.notEqual(
      derivedIdempotencyKey({ clientId: "c1", roundNo: 1 }),
      derivedIdempotencyKey({ clientId: "c1", roundNo: 2 })
    );
  });

  test("two clients never share a key", () => {
    assert.notEqual(
      derivedIdempotencyKey({ clientId: "c1", roundNo: 1 }),
      derivedIdempotencyKey({ clientId: "c2", roundNo: 1 })
    );
  });
});

describe("what counts as open", () => {
  test("finished states do not block a new request", () => {
    for (const s of ["fulfilled", "failed", "cancelled", "refunded"]) {
      assert.ok(!OPEN_STATUSES.includes(s), `${s} is treated as open and would lock the client out`);
    }
  });
  test("every state before the end blocks one", () => {
    assert.deepEqual(OPEN_STATUSES, ["quoted", "awaiting_payment", "paid", "staged"]);
  });
  test("the service names match the table's CHECK and the contract", () => {
    assert.equal(SERVICE_KIND, "dispute_round");   // paid_service_requests_kind_ck
    assert.equal(SERVICE_KEY, "paid_round");       // the client-progress contract
  });
});

describe("reading the payment event", () => {
  test("the request id comes off our own metadata round trip", () => {
    const id = "11111111-2222-3333-4444-555555555555";
    assert.equal(requestIdFromEvent({ payload: { ref: id } }), id);
    assert.equal(requestIdFromEvent({ payload: { paidServiceRequestId: id } }), id);
  });

  test("a payment-link ref is NOT read as a paid service id", () => {
    // pl_… refs belong to payment_links. Treating one as a request id would
    // attach an unrelated payment to a round.
    assert.equal(requestIdFromEvent({ payload: { ref: "pl_2b7c9d1e" } }), null);
    assert.equal(requestIdFromEvent({ payload: {} }), null);
    assert.equal(requestIdFromEvent({}), null);
    assert.equal(requestIdFromEvent(null), null);
  });

  test("an unreadable amount is null, never zero", () => {
    assert.equal(paidCentsFromEvent({ payload: {} }), null);
    assert.equal(paidCentsFromEvent({ payload: { amount: "one hundred" } }), null);
    assert.equal(paidCentsFromEvent({ payload: { amountCents: 10000 } }), 10_000);
    assert.equal(paidCentsFromEvent({ payload: { amount: 100 } }), 10_000);
  });

  test("a genuine zero-dollar payment stays zero and is not confused with unknown", () => {
    assert.equal(paidCentsFromEvent({ payload: { amountCents: 0 } }), 0);
  });
});
