// Cole Gordon seven-belief model — the diagnosis behind an objection.
// Objections are symptoms; the belief that failed is what closers log.

export const BELIEFS = Object.freeze([
  "pain",
  "doubt",
  "cost",
  "desire",
  "money",
  "support",
  "trust"
]);

export const BELIEF_SET = new Set(BELIEFS);

export const BELIEF_LABELS = Object.freeze({
  pain: 'Pain · "this still hurts"',
  doubt: 'Doubt · "I could do this myself"',
  cost: 'Cost · "not right now"',
  desire: 'Desire · "less than I expected"',
  money: 'Money · "can\'t afford it"',
  support: 'Support · "need to ask my spouse"',
  trust: 'Trust · "how do I know"'
});

export const OUTCOMES = Object.freeze([
  "deposit",
  "downsell",
  "callback",
  "no_show",
  "not_a_fit"
]);

export const OUTCOME_SET = new Set(OUTCOMES);

export const OUTCOME_LABELS = Object.freeze({
  deposit: "Deposit",
  downsell: "Downsell",
  callback: "Callback",
  no_show: "No show",
  not_a_fit: "Not a fit"
});

export function normalizeBelief(raw) {
  if (raw == null || raw === "" || String(raw).toLowerCase() === "none") return null;
  const v = String(raw).trim().toLowerCase();
  return BELIEF_SET.has(v) ? v : undefined;
}

export function normalizeOutcome(raw) {
  const v = String(raw || "").trim().toLowerCase().replace(/\s+/g, "_");
  return OUTCOME_SET.has(v) ? v : undefined;
}
