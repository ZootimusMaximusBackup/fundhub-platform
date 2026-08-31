// The day-1 consumer disclosure.
//
// THE RULE: a consumer who lands on a trial funnel is told, from day one, that
// FundHub performs the funding and credit services offered under that brand.
// A disclosure an AI can rewrite, or a partner can delete from their own page
// editor, is not a disclosure — so these tests assert that it is LOCKED, that a
// PATCH cannot overwrite it, and that a page missing it cannot publish.

import { test, describe } from "node:test";
import assert from "node:assert";

import { legalBlocks, defaultBody, mergeBodyJson, isLockedSection, FULFILMENT_DISCLOSURE_ID }
  from "../brand/templates.mjs";
import {
  fulfilmentDisclosureBlock, fulfilmentDisclosureText, hasFulfilmentDisclosure,
  assertFulfilmentDisclosure, withFulfilmentDisclosure, DISCLOSURE_PLACEMENTS
} from "./disclosure.mjs";
import { trialPageBody, TRIAL_FUNNEL_KEY } from "./provision.mjs";

const ENTITY = "Redline Capital";

describe("the locked block", () => {
  test("legalBlocks carries it, locked, on every funnel", () => {
    const block = legalBlocks(ENTITY).find((s) => s.id === FULFILMENT_DISCLOSURE_ID);
    assert.ok(block, "the fulfilment disclosure is missing from legalBlocks()");
    assert.equal(isLockedSection(block), true);
  });

  test("it names FundHub as the provider and the brand as a marketing partner", () => {
    const text = fulfilmentDisclosureText(ENTITY);
    assert.match(text, /provided and performed by FundHub/);
    assert.match(text, new RegExp(ENTITY));
    assert.match(text, /independent marketing partner/);
    assert.match(text, /is not the provider of these services/);
  });

  test("every default funnel body includes it", () => {
    for (const key of ["apply", "diag", "edu", "aff", "book"]) {
      const body = defaultBody(key, { entity_name: ENTITY });
      assert.ok(hasFulfilmentDisclosure(body), `funnel ${key} publishes without the disclosure`);
    }
  });
});

describe("it cannot be edited away", () => {
  /* mergeBodyJson is what a PATCH from the partner's own page editor runs
     through. A partner who deletes the section, or sends a softened version of
     it, gets the original back. */
  test("a PATCH that omits it gets it back", () => {
    const current = defaultBody(TRIAL_FUNNEL_KEY, { entity_name: ENTITY });
    const incoming = { sections: [{ id: "hero", type: "hero", locked: false, headline: "New" }] };
    const merged = mergeBodyJson(current, incoming);
    assert.ok(hasFulfilmentDisclosure(merged));
  });

  test("a PATCH that rewrites the text gets the original text back", () => {
    const current = defaultBody(TRIAL_FUNNEL_KEY, { entity_name: ENTITY });
    const incoming = {
      sections: [
        { id: FULFILMENT_DISCLOSURE_ID, type: "legal", locked: true, headline: "Who performs these services",
          text: "We do everything in house." }
      ]
    };
    const merged = mergeBodyJson(current, incoming);
    const block = merged.sections.find((s) => s.id === FULFILMENT_DISCLOSURE_ID);
    assert.match(block.text, /provided and performed by FundHub/);
  });

  test("an unlocked copy of the block is replaced by the locked one", () => {
    const tampered = {
      sections: [
        { id: FULFILMENT_DISCLOSURE_ID, type: "legal", locked: false, text: "Nothing to see here." }
      ]
    };
    const repaired = withFulfilmentDisclosure(tampered, ENTITY);
    const block = repaired.sections.find((s) => s.id === FULFILMENT_DISCLOSURE_ID);
    assert.equal(isLockedSection(block), true);
    assert.match(block.text, /provided and performed by FundHub/);
  });
});

describe("hasFulfilmentDisclosure", () => {
  test("false for a body with no sections at all", () => {
    assert.equal(hasFulfilmentDisclosure(null), false);
    assert.equal(hasFulfilmentDisclosure({}), false);
    assert.equal(hasFulfilmentDisclosure({ sections: [] }), false);
  });

  /* THE ID SURVIVING IS NOT ENOUGH. A section that kept the id but lost the
     lock is an editable disclosure, which is the exact failure mode. */
  test("false when the block is present but unlocked", () => {
    assert.equal(hasFulfilmentDisclosure({
      sections: [{ id: FULFILMENT_DISCLOSURE_ID, type: "legal", text: "words" }]
    }), false);
  });

  test("false when the block is locked but empty", () => {
    assert.equal(hasFulfilmentDisclosure({
      sections: [{ id: FULFILMENT_DISCLOSURE_ID, type: "legal", locked: true, text: "   " }]
    }), false);
  });
});

describe("assertFulfilmentDisclosure", () => {
  test("throws DISCLOSURE_MISSING on a page that would publish without it", () => {
    assert.throws(
      () => assertFulfilmentDisclosure({ sections: [{ id: "hero", type: "hero" }] }, { entityName: ENTITY }),
      (err) => err.code === "DISCLOSURE_MISSING"
    );
  });

  test("returns the body untouched when it is present", () => {
    const body = defaultBody(TRIAL_FUNNEL_KEY, { entity_name: ENTITY });
    assert.equal(assertFulfilmentDisclosure(body, { entityName: ENTITY }), body);
  });
});

describe("the trial's own page body", () => {
  test("carries the disclosure after the affiliate tag is stamped on the links", () => {
    const body = trialPageBody({ entityName: ENTITY, trackingId: "AFF-000123" });
    assert.ok(hasFulfilmentDisclosure(body));
  });

  test("uses the shared Brand Studio template, not a trial-only one", () => {
    const body = trialPageBody({ entityName: ENTITY, trackingId: "AFF-000123" });
    assert.equal(body.template, TRIAL_FUNNEL_KEY);
    const shared = defaultBody(TRIAL_FUNNEL_KEY, { entity_name: ENTITY });
    assert.deepEqual(
      body.sections.map((s) => s.id).sort(),
      shared.sections.map((s) => s.id).sort()
    );
  });
});

describe("placements", () => {
  test("three, and they are named rather than left to a caller to invent", () => {
    assert.deepEqual([...DISCLOSURE_PLACEMENTS],
      ["landing_page_footer", "booking_confirmation", "first_outbound_message"]);
  });

  test("the block and the plain-text form are the same string", () => {
    assert.equal(fulfilmentDisclosureText(ENTITY), fulfilmentDisclosureBlock(ENTITY).text);
  });
});
