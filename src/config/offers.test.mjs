import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OFFERS,
  getOffer,
  offerAllowsLetters,
  formatCents,
  offersForClient,
  resolveContractTemplateKey,
  defaultContractValues
} from "./offers.mjs";

test("every offer has a name, integer cents, and financing/letters flags", () => {
  for (const key of Object.keys(OFFERS)) {
    const o = OFFERS[key];
    assert.equal(o.key, key);
    assert.ok(o.name);
    assert.equal(Number.isInteger(o.priceCents) && o.priceCents > 0, true, key);
    assert.equal(typeof o.financing, "boolean", key);
    assert.equal(typeof o.letters, "boolean", key);
  }
});

test("soft pull and funding deposit do not offer financing", () => {
  assert.equal(OFFERS.SOFT_PULL.financing, false);
  assert.equal(OFFERS.FUNDING_DFY.financing, false);
  assert.equal(OFFERS.REPAIR_DFY.financing, true);
  assert.equal(OFFERS.REPAIR_TRIAL.financing, true);
  assert.equal(OFFERS.UWIQ_DELIVERABLES.financing, true);
  assert.equal(OFFERS.FUNDING_MASTERY.financing, true);
});

test("letters never fire on the qualified funding offer or the soft pull", () => {
  assert.equal(offerAllowsLetters("FUNDING_DFY"), false);
  assert.equal(offerAllowsLetters("SOFT_PULL"), false);
  assert.equal(offerAllowsLetters("REPAIR_DFY"), true);
  assert.equal(offerAllowsLetters("REPAIR_TRIAL"), true);
  assert.equal(offerAllowsLetters("UWIQ_DELIVERABLES"), true);
  assert.equal(offerAllowsLetters("FUNDING_MASTERY"), false);
  assert.equal(offerAllowsLetters("NOPE"), false);
});

test("changing priceCents in the catalog is what offersForClient returns", () => {
  const row = offersForClient().find((o) => o.key === "REPAIR_TRIAL");
  assert.equal(row.priceCents, OFFERS.REPAIR_TRIAL.priceCents);
  assert.equal(row.priceDisplay, formatCents(OFFERS.REPAIR_TRIAL.priceCents));
});

test("getOffer and formatCents do not invent values", () => {
  assert.equal(getOffer("missing"), null);
  assert.equal(formatCents(null), null);
  assert.equal(formatCents("nope"), null);
  assert.equal(formatCents(3200), "$32");
  assert.equal(formatCents(300000), "$3,000");
});

test("UWIQ deliverables contents are the six named items", () => {
  assert.deepEqual(OFFERS.UWIQ_DELIVERABLES.contents, [
    "Credit Analysis Report",
    "Dispute Letter Pack",
    "Credit Optimization Roadmap",
    "Funding Snapshot",
    "Bank & Lender Match List",
    "How To Use This mini course"
  ]);
});

test("repair and funding offers map to contract template keys", () => {
  assert.equal(OFFERS.REPAIR_TRIAL.contractTemplateKey, "REPAIR-TRIAL-AGREEMENT");
  assert.equal(OFFERS.REPAIR_DFY.contractTemplateKey, "CREDIT-REPAIR-AGREEMENT");
  assert.equal(OFFERS.FUNDING_DFY.contractTemplateKey, "FUNDING-AGREEMENT");
  assert.equal(OFFERS.SOFT_PULL.contractTemplateKey, "SOFT-PULL-CONSENT");
  assert.equal(resolveContractTemplateKey({ tier: "FUNDING_PLUS_REPAIR" }), "REPAIR-AND-FUNDING-AGREEMENT");
  assert.equal(resolveContractTemplateKey({ offerKey: "REPAIR_TRIAL" }), "REPAIR-TRIAL-AGREEMENT");
  assert.ok(defaultContractValues({ offerKey: "REPAIR_TRIAL" }).trial_fee);
});
