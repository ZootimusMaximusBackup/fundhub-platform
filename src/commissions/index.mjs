// Commission model — public surface.
//
// Schema:  db/migrations/010_products.sql .. 015_seed_products.sql
// Docs:    src/commissions/commission-model-open-questions.md
//          src/commissions/PROPOSED-EVENTS.md
//
// Everything exported here is pure. Rates, prices, splits and product names are
// database rows, passed in as arguments — never constants in this code.

export {
  FRONT_END,
  BACK_END,
  AMOUNT_BASES,
  resolveAmounts,
  computeRuleAmount,
  computeCommission,
  computeFrontEnd,
  computeBackEnd,
  reverseDraft,
  snapshotRule,
  idempotencyKey
} from "./calculate.mjs";

export {
  SCOPE_WEIGHT,
  ruleSpecificity,
  isEffective,
  matchesScope,
  candidateRules,
  compareRules,
  selectBaseRule,
  selectBonusRules,
  selectRules
} from "./rules.mjs";

export { sortTiers, tierFor, computeTiered } from "./tiers.mjs";

export {
  toCents,
  fromCents,
  percentOf,
  applySplit,
  wholeUnits,
  clampAmount,
  roundHalfUp
} from "./money.mjs";

export {
  SQL_RULES_IN_FORCE,
  SQL_ATTRIBUTIONS_FOR_SALE,
  SQL_SALE_CONTEXT,
  SQL_PAYMENTS_FOR_SALE,
  SQL_SALE_FOR_ROUND,
  SQL_RESOLVE_PRODUCT,
  SQL_LINK_ROUND_TO_SALE,
  SQL_INSERT_LEDGER,
  SQL_SUPERSEDE_RULE,
  SQL_PAYOUT_REPORT,
  LEDGER_INSERT_COLUMNS,
  ledgerInsertParams
} from "./sql.mjs";
