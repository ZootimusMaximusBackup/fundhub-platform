// The recruit bonus arithmetic and its refusals. No database.
//
// The band table below is W1-money-model.md §5 copied verbatim from the spec's
// D5 remittance bands. It is the whole point of the unit: the bonus is a FLAT
// $2,000 against the $10,000 STICKER at every band, so FundHub's net moves with
// the lender and the promise does not. The 30% row is the worst case on record
// and it still nets $1,000 — positive, thin, and deliberate.

import { test, describe } from "node:test";
import assert from "node:assert";
import {
  computeEntryEconomics, checkRecruitPair, isEntryFeeProduct, cashLanded,
  ENTRY_FEE_PRODUCT_CODES
} from "./recruit.mjs";
import { ENTRY_FEE_CENTS, RECRUIT_BONUS_PCT, computeRecruitBonus } from "./revenue.mjs";

/** W1-money-model.md §5, the D5 band table. Cents, always. */
const BANDS = [
  { name: "Prime 680+",      pct: 85, remitCents: 850_000, netCents: 650_000 },
  { name: "Lender B tier 1", pct: 77, remitCents: 770_000, netCents: 570_000 },
  { name: "Near prime 600+", pct: 75, remitCents: 750_000, netCents: 550_000 },
  { name: "Lender B tier 2", pct: 72, remitCents: 720_000, netCents: 520_000 },
  { name: "Lender B tier 3", pct: 62, remitCents: 620_000, netCents: 420_000 },
  { name: "Lender B tier 4", pct: 50, remitCents: 500_000, netCents: 300_000 },
  { name: "Sub Prime A",     pct: 42, remitCents: 420_000, netCents: 220_000 },
  { name: "Lender B tier 5", pct: 30, remitCents: 300_000, netCents: 100_000 }
];

describe("the locked numbers", () => {
  test("entry fee is $10,000 in cents and the bonus rule is 20%", () => {
    assert.equal(ENTRY_FEE_CENTS, 1_000_000);
    assert.equal(RECRUIT_BONUS_PCT, 20);
  });

  test("the bonus is $2,000 flat", () => {
    assert.equal(computeRecruitBonus().shareCents, 200_000);
  });

  test("cash paid in full: FundHub nets $8,000", () => {
    const e = computeEntryEconomics({ remittedCents: 1_000_000 });
    assert.equal(e.bonusCents, 200_000);
    assert.equal(e.fundhubNetCents, 800_000);
    assert.equal(e.negative, false);
  });
});

describe("every lender band pays the same flat $2,000", () => {
  for (const band of BANDS) {
    test(`${band.name} (${band.pct}%): $${band.remitCents / 100} in, $2,000 out, $${band.netCents / 100} kept`, () => {
      // The band's own arithmetic, so a typo in the fixture fails too.
      assert.equal(band.remitCents, (ENTRY_FEE_CENTS * band.pct) / 100);

      const e = computeEntryEconomics({ remittedCents: band.remitCents });
      assert.equal(e.entryFeeCents, ENTRY_FEE_CENTS, "the sticker never moves");
      assert.equal(e.bonusCents, 200_000, "the bonus never moves");
      assert.equal(e.fundhubNetCents, band.netCents);
      assert.equal(e.negative, false, "no band is negative");
    });
  }

  test("the worst band on record still leaves FundHub $1,000", () => {
    const worst = BANDS[BANDS.length - 1];
    assert.equal(worst.pct, 30);
    assert.equal(computeEntryEconomics({ remittedCents: worst.remitCents }).fundhubNetCents, 100_000);
  });

  test("a band below 20% would go negative — the arithmetic says so, it is not hidden", () => {
    const e = computeEntryEconomics({ remittedCents: 150_000 });
    assert.equal(e.fundhubNetCents, -50_000);
    assert.equal(e.negative, true);
  });
});

describe("NULL is unknown and survives", () => {
  test("no remittance figure yields a null net, never 0", () => {
    const e = computeEntryEconomics({});
    assert.equal(e.remittedCents, null);
    assert.equal(e.fundhubNetCents, null);
    assert.equal(e.bonusCents, 200_000, "the promise is known even when the cash is not");
  });

  test("a non-numeric remittance throws rather than guessing", () => {
    assert.throws(() => computeEntryEconomics({ remittedCents: "lots" }), RangeError);
  });
});

describe("cashLanded", () => {
  test("dollars on the payload convert to cents", () => {
    assert.deepEqual(cashLanded({ amount: "4200.00" }), {
      landed: true, reason: null, amountCents: 420_000
    });
  });

  test("explicit cents win over dollars", () => {
    assert.equal(cashLanded({ amount: "1.00", amountCents: 300_000 }).amountCents, 300_000);
  });

  test("a missing amount is unknown, not zero", () => {
    assert.equal(cashLanded({}).reason, "unknown_amount");
    assert.equal(cashLanded({ amount: null }).reason, "unknown_amount");
    assert.equal(cashLanded({ amount: "" }).reason, "unknown_amount");
    assert.equal(cashLanded({}).amountCents, null);
  });

  test("zero and negative are cash that did not land", () => {
    assert.equal(cashLanded({ amount: "0" }).reason, "no_cash_landed");
    assert.equal(cashLanded({ amount: "0" }).landed, false);
    assert.equal(cashLanded({ amountCents: -1 }).landed, false);
  });

  test("garbage is unknown, not zero", () => {
    assert.equal(cashLanded({ amount: "abc" }).reason, "unknown_amount");
  });
});

describe("checkRecruitPair", () => {
  const A = "11111111-1111-4111-8111-111111111111";
  const B = "22222222-2222-4222-8222-222222222222";

  test("a partner cannot recruit themselves", () => {
    assert.deepEqual(checkRecruitPair({ partnerId: A, recruiterPartnerId: A }),
      { ok: false, reason: "self_recruit" });
  });

  test("two different partners are fine", () => {
    assert.deepEqual(checkRecruitPair({ partnerId: A, recruiterPartnerId: B }),
      { ok: true, reason: null });
  });

  test("missing either side is a reason, not a crash", () => {
    assert.equal(checkRecruitPair({ recruiterPartnerId: B }).reason, "no_partner");
    assert.equal(checkRecruitPair({ partnerId: A }).reason, "no_recruiter");
  });
});

describe("isEntryFeeProduct", () => {
  test("the entry fee code matches, cased and padded however it arrives", () => {
    assert.equal(isEntryFeeProduct("partner-entry"), true);
    assert.equal(isEntryFeeProduct("  PARTNER-ENTRY "), true);
    assert.equal(isEntryFeeProduct("partner_entry"), true);
  });

  test("an add-on is not the entry fee — no recruit bonus is owed on one", () => {
    for (const code of ["creative-intelligence", "dfy-marketing", "lead-flow",
                        "winners-board", "card-stacking-dfy", "repair-bundle",
                        "live-trial"]) {
      assert.equal(isEntryFeeProduct(code), false, code);
    }
  });

  test("nothing and empty are not the entry fee", () => {
    assert.equal(isEntryFeeProduct(null), false);
    assert.equal(isEntryFeeProduct(undefined), false);
    assert.equal(isEntryFeeProduct(""), false);
    assert.equal(isEntryFeeProduct("   "), false);
  });
});

/* THE SEAM. src/trials/constants.mjs is owned by the live-trial unit and declares
   the same products.code for the same $10,000 sale. Two numbers that disagree is
   the bug; two that must agree with a test holding them is a seam. If that module
   is not present in this checkout the assertion is skipped rather than faked —
   an absent file is not evidence of agreement. */
test("the entry-fee product code agrees with the live-trial unit", async (t) => {
  let constants;
  try {
    constants = await import("../trials/constants.mjs");
  } catch {
    t.skip("src/trials/constants.mjs is not in this checkout");
    return;
  }
  assert.equal(
    constants.PARTNER_ENTRY_PRODUCT_CODE,
    ENTRY_FEE_PRODUCT_CODES[0],
    "the partner entry products.code forked — one of these two is now wrong"
  );
  assert.equal(
    constants.PARTNER_ENTRY_PRICE_CENTS,
    ENTRY_FEE_CENTS,
    "the $10,000 entry fee forked"
  );
});
