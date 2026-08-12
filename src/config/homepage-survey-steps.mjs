// Homepage multi-step survey — owner-set attribute keys from RUN5.
// Option copy for funding target + FICO is verified from CF harness / survey-qualification.
// Other option lists are owner-set stand-ins until CF attribute mapping is confirmed live.

import { FICO_BANDS } from "./survey-qualification.mjs";

/** @typedef {{ key: string, title: string, subtitle?: string, type: 'single'|'multi'|'contact', options?: string[], showIf?: { key: string, equals: string } }} SurveyStep */

/** @type {SurveyStep[]} */
export const HOMEPAGE_SURVEY_STEPS = [
  {
    key: "cf_svy_funding_target_amount",
    title: "Set Your Target Amount",
    subtitle: "Required to continue.",
    type: "single",
    options: [
      "Less than $50k",
      "$50k - $100k",
      "$100k - $200k",
      "$200k - $400k",
      "$400k+",
    ],
  },
  {
    key: "cf_svy_planned_use",
    title: "What will you use the funding for?",
    type: "single",
    options: [
      "Working capital / payroll",
      "Inventory or supplies",
      "Equipment",
      "Marketing / growth",
      "Refinance existing debt",
      "Other",
    ],
  },
  {
    key: "cf_svy_money_change_now",
    title: "What needs to change with money right now?",
    subtitle: "Select all that apply.",
    type: "multi",
    options: [
      "Cash flow is tight",
      "Need to grow faster",
      "Catch up on obligations",
      "Invest in the business",
      "Not sure yet",
    ],
  },
  {
    key: "cf_svy_self_reported_fico",
    title: "What is your current credit score?",
    type: "single",
    options: [...FICO_BANDS],
  },
  {
    key: "cf_svy_annual_income_range",
    title: "What is your annual personal income range?",
    type: "single",
    options: [
      "Under $50k",
      "$50k - $100k",
      "$100k - $150k",
      "$150k - $250k",
      "$250k+",
    ],
  },
  {
    key: "cf_svy_income_verifiable",
    title: "Can that income be verified (paystubs, tax returns, or bank deposits)?",
    type: "single",
    options: ["Yes", "No", "Not sure"],
  },
  {
    key: "cf_svy_has_business",
    title: "Do you currently own a business?",
    type: "single",
    options: ["Yes", "No"],
  },
  {
    key: "cf_svy_business_revenue",
    title: "What is your approximate annual business revenue?",
    type: "single",
    showIf: { key: "cf_svy_has_business", equals: "Yes" },
    options: [
      "Pre-revenue / just starting",
      "Under $100k",
      "$100k - $250k",
      "$250k - $500k",
      "$500k - $1M",
      "$1M+",
    ],
  },
  {
    key: "cf_svy_revenue_verifiable",
    title: "Can business revenue be verified (bank statements or tax returns)?",
    type: "single",
    showIf: { key: "cf_svy_has_business", equals: "Yes" },
    options: ["Yes", "No", "Not sure"],
  },
  {
    key: "cf_svy_available_capital",
    title: "How much capital do you have available right now?",
    type: "single",
    options: [
      "Under $5k",
      "$5k - $15k",
      "$15k - $50k",
      "$50k+",
      "Prefer not to say",
    ],
  },
  {
    key: "cf_svy_has_negatives",
    title: "Any negatives on your credit report? (collections, charge-offs, late payments)",
    type: "single",
    options: ["Yes", "No"],
  },
  {
    key: "__contact__",
    title: "Begin your application",
    subtitle: "Tell us how to reach you. Soft inquiry. No obligation.",
    type: "contact",
  },
];

export const SURVEY_REDIRECTS = Object.freeze({
  PASS: "https://apply.fundhub.ai/funding-book-call",
  DOWNSELL: "https://apply.fundhub.ai/thank-you",
  MANUAL_REVIEW: "https://apply.fundhub.ai/thank-you",
});

/** Visible steps given current answers (applies has-business branch). */
export function visibleSurveySteps(answers = {}) {
  return HOMEPAGE_SURVEY_STEPS.filter((s) => {
    if (!s.showIf) return true;
    return String(answers[s.showIf.key] || "") === s.showIf.equals;
  });
}
