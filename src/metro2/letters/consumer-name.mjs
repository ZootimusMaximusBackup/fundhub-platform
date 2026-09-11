// ESM face of ./consumer-name.cjs. It adds nothing — the list and the rule live
// in the .cjs so the CommonJS vendor letter writer
// (vendor/underwriteiq-full/api/lite/letter-generator.js) and every .mjs
// renderer in src/ run the SAME predicate. Import from here in ESM; do not
// re-implement the check anywhere.
import mod from "./consumer-name.cjs";

export const NO_CONSUMER_NAME = mod.NO_CONSUMER_NAME;
export const NOT_A_NAME = mod.NOT_A_NAME;
export const isPlaceholderName = mod.isPlaceholderName;
export const realConsumerName = mod.realConsumerName;
export const requireConsumerName = mod.requireConsumerName;
