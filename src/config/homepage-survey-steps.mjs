// Homepage survey steps — re-export CF ground truth map.
// Source of truth: docs/clickfunnels/cf-survey-ground-truth.md
// Contact is LAST on the homepage (CF has contact first).

import {
  CF_SURVEY_QUESTIONS,
  homepageSurveyQuestions,
  visibleQuestions,
  PERSONAL_FUNDING_OPTION,
} from "../survey/cf-question-map.mjs";

export {
  CF_SURVEY_QUESTIONS,
  homepageSurveyQuestions,
  visibleQuestions,
  PERSONAL_FUNDING_OPTION,
};

/** @deprecated use homepageSurveyQuestions / visibleQuestions — kept for older imports */
export const HOMEPAGE_SURVEY_STEPS = homepageSurveyQuestions();

export const SURVEY_REDIRECTS = Object.freeze({
  PASS: "https://apply.fundhub.ai/funding-book-call",
  DOWNSELL: "https://apply.fundhub.ai/thank-you",
  MANUAL_REVIEW: "https://apply.fundhub.ai/thank-you",
});

/** Visible homepage steps (contact last) given answers keyed by question id. */
export function visibleSurveySteps(answersById = {}) {
  return visibleQuestions(answersById, { contactLast: true });
}
