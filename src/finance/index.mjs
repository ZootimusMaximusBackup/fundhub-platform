// Finance OS — the deciding half, in one import.
//
// The four entry points the build plan names, plus the store that persists what
// they decide. Nothing here is a second implementation of anything; this file is
// re-exports only, so there is no path by which importing from the barrel and
// importing from the module can disagree.

export {
  evaluateUtilization,
  evaluateScore,
  suggestCardUpgrade,
  evaluate,
  firedAlerts,
  blanksOf,
  positionOf,
  UPSELL_RULES
} from "./upsell.mjs";

export {
  monthlyReport,
  buildMonthlyOptimizationReport,
  DOCUMENT_KIND,
  ENTITLEMENT_CODE,
  CADENCE
} from "./optimization-report.mjs";

export {
  raiseAlert,
  raiseAlerts,
  acknowledgeAlert,
  listAlerts,
  loadUpsellRules,
  unconfiguredUpsellRules,
  SEVERITIES
} from "./alerts.mjs";
