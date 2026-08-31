// The day-1 consumer disclosure, and the three places it has to appear.
//
// A consumer who lands on a trial funnel sees the buyer's logo, the buyer's
// colours and the buyer's company name. FundHub wrote the ad, screened it,
// pushed it, and will do the actual work. The consumer is entitled to know
// that on day one — not on day eight, not when they ask.
//
// THE WORDING IS FIXED AND IT LIVES IN ONE PLACE. src/brand/templates.mjs owns
// the text, inside legalBlocks(), as a LOCKED section. Locked means the AI
// copywriter cannot reach it and a PATCH from the partner's page editor cannot
// overwrite it. This module does not restate the words — it re-exports them, so
// there is exactly one string in the repository and no chance of a second copy
// drifting into something softer.
//
// THREE PLACEMENTS, ALL LIVE FROM DAY 1 (W4 §5.4):
//   1. the branded landing page, in the footer legal block, on every page
//   2. the booking confirmation screen and email, above the fold
//   3. the first outbound message, whatever the channel
//
// assertFulfilmentDisclosure() is the gate: a trial page that would publish
// without the block does not publish. A disclosure nothing verifies is a
// disclosure that goes missing the first time someone edits a template.

import {
  legalBlocks,
  isLockedSection,
  FULFILMENT_DISCLOSURE_ID,
  hasFulfilmentDisclosure
} from "../brand/templates.mjs";

export { FULFILMENT_DISCLOSURE_ID, hasFulfilmentDisclosure };

/** The three surfaces, named so a caller cannot invent a fourth by accident. */
export const DISCLOSURE_PLACEMENTS = Object.freeze([
  "landing_page_footer",
  "booking_confirmation",
  "first_outbound_message"
]);

/** fulfilmentDisclosureBlock(entityName) → the locked section, from the one
    definition in src/brand/templates.mjs. */
export function fulfilmentDisclosureBlock(entityName) {
  const block = legalBlocks(entityName).find((s) => s.id === FULFILMENT_DISCLOSURE_ID);
  if (!block) {
    // Not a soft failure. If the block has been removed from legalBlocks, every
    // trial page in the system is publishing without its disclosure and the
    // right outcome is a loud stop, here, at the first call.
    throw new Error(
      "fulfilmentDisclosureBlock: the locked fulfilment disclosure is missing from " +
      "legalBlocks() in src/brand/templates.mjs. Trial pages must not publish without it."
    );
  }
  return block;
}

/** fulfilmentDisclosureText(entityName) → the sentence, for a booking screen,
    an email, or the first outbound message. Same string as the page block. */
export function fulfilmentDisclosureText(entityName) {
  return fulfilmentDisclosureBlock(entityName).text;
}

/**
 * assertFulfilmentDisclosure(body, { entityName }) → body
 *
 * Throws unless the page body carries the locked disclosure. Call it on the way
 * to a publish, never after.
 */
export function assertFulfilmentDisclosure(body, { entityName = null } = {}) {
  if (hasFulfilmentDisclosure(body)) return body;
  throw Object.assign(
    new Error(
      "assertFulfilmentDisclosure: this page has no locked fulfilment disclosure. " +
      "A trial funnel must tell consumers on day 1 that FundHub performs the services" +
      (entityName ? ` offered under ${entityName}.` : ".")
    ),
    { code: "DISCLOSURE_MISSING" }
  );
}

/**
 * withFulfilmentDisclosure(body, entityName) → body with the block present.
 *
 * Repairs a body that lost the block — for instance one assembled by hand
 * rather than through defaultBody(). It appends; it never rewrites an existing
 * locked section, because an existing one is the authoritative copy.
 */
export function withFulfilmentDisclosure(body, entityName) {
  const base = body && typeof body === "object" ? body : { sections: [] };
  const sections = Array.isArray(base.sections) ? [...base.sections] : [];
  const at = sections.findIndex((s) => s && String(s.id || "") === FULFILMENT_DISCLOSURE_ID);
  const block = fulfilmentDisclosureBlock(entityName);
  if (at === -1) {
    sections.push(block);
  } else if (!isLockedSection(sections[at])) {
    // The id survived but the lock did not. Restore the authoritative block —
    // an unlocked disclosure is one PATCH away from being gone.
    sections[at] = block;
  }
  return { ...base, sections };
}

export default {
  DISCLOSURE_PLACEMENTS,
  FULFILMENT_DISCLOSURE_ID,
  fulfilmentDisclosureBlock,
  fulfilmentDisclosureText,
  hasFulfilmentDisclosure,
  assertFulfilmentDisclosure,
  withFulfilmentDisclosure
};
