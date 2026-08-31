// The Creative Intelligence Spine — Layers 1 and 2.
//
// docs/specs/W2-creative-intelligence.md
//
//   Layer 1  RENTED   vendor observations of competitor ads. FundHub never
//                     scrapes; vendors scrape and FundHub buys rows.
//                     ingest.mjs + vendors/
//
//   Layer 2  BUILT    the classifier, the ten derived signals, the Winner Score
//                     and the saturation map. THIS IS THE PRODUCT.
//                     classify.mjs + signals.mjs + score.mjs + saturation.mjs
//                     + weekly.mjs
//
//   The wall          what a partner may see, enforced in the query.
//                     board.mjs
//
// Layer 3 (FundHub's own and partners' ad-account Insights joined to real
// closes) is NOT in this directory and is not built. It is the far side of the
// Meta App Review blocker for partner accounts, and its absence is why the
// Winner Score is presented as a rank and a band rather than a number.

export {
  TAXONOMY_VERSION, ANGLES, AD_FORMATS, PROMISE_SHAPES, COMPLIANCE_RISKS,
  FUNNELS, AXES, AXIS_KEYS, DO_NOT_COPY_RISKS, OBSERVED_PLATFORMS, WATCH_GROUPS,
  validateClassification, taxonomyPromptBlock
} from "./taxonomy.mjs";

export { contentHash, normaliseText, stripTracking, destinationDomain } from "./hash.mjs";

export { resolve as resolveVendor, VENDOR_CATALOG, VENDOR_KEYS, estimateMonthlyCostCents }
  from "./vendors/index.mjs";
export { toObservation } from "./vendors/observation.mjs";

export { pullPlatform, pullAll, watchListFor, markDormant } from "./ingest.mjs";

export {
  classifyPending, classifyBatch, pendingCreatives, parseReply, batchCostCents,
  CLASSIFIER_MODEL, BATCH_SIZE
} from "./classify.mjs";

export {
  buildIndex, signalsFor, adAgeDays, variantCount, relaunchCount, creativeVelocity,
  placementSpread, landingPageChanged, extractOffer, isNewEntrant, deathWatch,
  crossPlatformEcho
} from "./signals.mjs";

export { rankWeek, scoreOne, percentileTable, topDecile, bandFor, WEIGHTS, WEIGHTS_VERSION }
  from "./score.mjs";

export { buildSaturation, angleTotals, whitespace, crowdingLabel, CROWDING }
  from "./saturation.mjs";

export { computeWeek, saturationForWeek, isoWeek, weekBounds, previousWeek }
  from "./weekly.mjs";

export {
  feedForWeek, deathWatchForWeek, newEntrantsForWeek, saturationForBoard,
  weeksAvailable, toPartnerRow, PARTNER_COLUMNS, WITHHELD_COLUMNS,
  RANK_BASIS_NOTE, NO_SPEND_NOTE
} from "./board.mjs";
