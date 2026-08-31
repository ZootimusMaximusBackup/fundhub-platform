// The white-label partner add-on menu — docs/specs/W6-pricing-menu.md.
//
// Two things these tests exist to stop, both of which cost real money:
//
//   1. AN ADD-ON LEAKING ONTO THE CLIENT DECK. `OFFERS` is the closer-deck
//      catalogue. src/sales/closer-deck.mjs pushes every entry of it to the
//      client present page and will mint a client pay link for any key in it,
//      and api/pipeline-clients.mjs accepts any productCode in it as a product
//      to put a CLIENT on a board. A partner add-on in there is a $2,497/month
//      marketing retainer offered to a credit-repair client.
//
//   2. AN ADD-ON PAYING A PARTNER. These three are FundHub revenue. The 50%
//      partner share runs off an ALLOW-LIST of service product codes
//      (docs/specs/W1-money-model.md §2 and §7) so that anything new defaults
//      to excluded. These codes must never be on it and must never produce a
//      partner_revenue row.
//
// Prices are owner-set 2026-08-31 and pinned here as exact integers on purpose:
// a price is not a thing that should be able to drift by one edit.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PARTNER_ADD_ONS,
  PARTNER_ADD_ON_KEYS,
  getPartnerAddOn,
  partnerAddOnPriceLabel,
  partnerAddOnsForMenu,
  commasProductTitleFor,
  formatCents,
  OFFERS,
  getOffer,
  offersForClient
} from "./offers.mjs";
import { isCommasSafeCopy } from "../payments/commas-safe-copy.mjs";
import { FUNDING_PRODUCT_CODES, REPAIR_PRODUCT_CODES } from "../affiliates/economics.mjs";

const ADDON_CODES = ["creative-intelligence", "dfy-marketing", "lead-flow"];

test("the three owner-set prices, to the cent", () => {
  assert.equal(PARTNER_ADD_ONS.CREATIVE_INTELLIGENCE.priceCents, 29700);
  assert.equal(PARTNER_ADD_ONS.DFY_MARKETING.priceCents, 249700);
  assert.equal(PARTNER_ADD_ONS.LEAD_FLOW.priceCents, 9900);
  assert.equal(PARTNER_ADD_ON_KEYS.length, 3);
});

test("every add-on is integer cents, keyed by its own name, and frozen", () => {
  for (const key of PARTNER_ADD_ON_KEYS) {
    const a = PARTNER_ADD_ONS[key];
    assert.equal(a.key, key);
    assert.ok(a.name, key);
    assert.equal(Number.isInteger(a.priceCents) && a.priceCents > 0, true, key);
    assert.equal(Object.isFrozen(a), true, key);
    assert.equal(a.audience, "partner", key);
  }
  assert.equal(Object.isFrozen(PARTNER_ADD_ONS), true);
});

test("billing says how often, and per-unit says what one unit is", () => {
  // The Offer shape has no way to express either — every existing offer is a
  // single charge on a pay link. This is the one field that was added.
  assert.equal(PARTNER_ADD_ONS.CREATIVE_INTELLIGENCE.billing, "monthly");
  assert.equal(PARTNER_ADD_ONS.DFY_MARKETING.billing, "monthly");
  assert.equal(PARTNER_ADD_ONS.LEAD_FLOW.billing, "per_unit");

  assert.equal(PARTNER_ADD_ONS.LEAD_FLOW.unitLabel, "booked call");
  assert.equal(PARTNER_ADD_ONS.CREATIVE_INTELLIGENCE.unitLabel, null);
  assert.equal(PARTNER_ADD_ONS.DFY_MARKETING.unitLabel, null);

  for (const key of PARTNER_ADD_ON_KEYS) {
    const a = PARTNER_ADD_ONS[key];
    assert.ok(["monthly", "per_unit"].includes(a.billing), key);
    if (a.billing === "per_unit") assert.ok(a.unitLabel, `${key} must say what a unit is`);
  }
});

test("the price label is composed from the price, never a second copy of it", () => {
  assert.equal(partnerAddOnPriceLabel("CREATIVE_INTELLIGENCE"), "$297/month");
  assert.equal(partnerAddOnPriceLabel("DFY_MARKETING"), "$2,497/month");
  assert.equal(partnerAddOnPriceLabel("LEAD_FLOW"), "$99 per booked call");
  for (const key of PARTNER_ADD_ON_KEYS) {
    const a = PARTNER_ADD_ONS[key];
    assert.ok(partnerAddOnPriceLabel(a).includes(formatCents(a.priceCents)), key);
  }
});

test("a missing price is not a free one", () => {
  assert.equal(getPartnerAddOn("NOPE"), null);
  assert.equal(getPartnerAddOn(null), null);
  assert.equal(partnerAddOnPriceLabel("NOPE"), null);
  assert.equal(partnerAddOnPriceLabel({ priceCents: null, billing: "monthly" }), null);
});

test("Commas never sees a credit or finance word, and never sees the real name", () => {
  for (const key of PARTNER_ADD_ON_KEYS) {
    const a = PARTNER_ADD_ONS[key];
    assert.ok(a.commasProductTitle, key);
    assert.equal(isCommasSafeCopy(a.commasProductTitle), true, `${key}: ${a.commasProductTitle}`);
    assert.notEqual(a.commasProductTitle, a.name, key);
  }
});

test("the vendor title resolves from the add-on key and from the product code alone", () => {
  for (const key of PARTNER_ADD_ON_KEYS) {
    const a = PARTNER_ADD_ONS[key];
    assert.equal(commasProductTitleFor({ offerKey: key }), a.commasProductTitle, key);
    assert.equal(commasProductTitleFor({ productCode: a.productCode }), a.commasProductTitle, key);
  }
});

// ── the two things that must never happen ──

test("no add-on leaks into the client offer catalogue", () => {
  const offerKeys = new Set(Object.keys(OFFERS));
  const offerCodes = new Set(Object.values(OFFERS).map((o) => o.productCode));
  for (const key of PARTNER_ADD_ON_KEYS) {
    const a = PARTNER_ADD_ONS[key];
    assert.equal(offerKeys.has(key), false, `${key} is in OFFERS — the closer deck would sell it`);
    assert.equal(offerCodes.has(a.productCode), false,
      `${a.productCode} is an OFFERS productCode — api/pipeline-clients.mjs would accept it for a client`);
    // getOffer is the door the client-facing modules use. It must not open.
    assert.equal(getOffer(key), null, key);
  }
  const deck = new Set(offersForClient().map((o) => o.key));
  for (const key of PARTNER_ADD_ON_KEYS) {
    assert.equal(deck.has(key), false, `${key} would render on the client present page`);
  }
});

test("no add-on shares revenue with a partner", () => {
  for (const key of PARTNER_ADD_ON_KEYS) {
    assert.equal(PARTNER_ADD_ONS[key].partnerShare, false, key);
  }
  // The two service allow-lists that exist today. W1 §2 requires the partner
  // share to run off an allow-list of service codes so a new product defaults
  // to excluded; these three must never appear on one.
  for (const code of ADDON_CODES) {
    assert.equal(FUNDING_PRODUCT_CODES.includes(code), false, code);
    assert.equal(REPAIR_PRODUCT_CODES.includes(code), false, code);
  }
});

test("letters can never fire on an add-on", () => {
  for (const key of PARTNER_ADD_ON_KEYS) {
    assert.equal(PARTNER_ADD_ONS[key].letters, false, key);
  }
});

test("the menu JSON carries a price, a label and the product code — and no internals", () => {
  const menu = partnerAddOnsForMenu();
  assert.equal(menu.length, 3);
  assert.deepEqual(menu.map((m) => m.productCode), ADDON_CODES);
  for (const row of menu) {
    const a = getPartnerAddOn(row.key);
    assert.equal(row.priceCents, a.priceCents);
    assert.equal(row.priceDisplay, formatCents(a.priceCents));
    assert.equal(row.priceLabel, partnerAddOnPriceLabel(a));
    assert.ok(row.summary);
    assert.equal("partnerShare" in row, false, "internal flags do not belong on a screen payload");
    assert.equal("commasProductTitle" in row, false, "the vendor title is not a customer-facing name");
  }
});
