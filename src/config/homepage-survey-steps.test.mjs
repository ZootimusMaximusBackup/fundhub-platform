import { test } from "node:test";
import assert from "node:assert/strict";
import {
  visibleSurveySteps,
  HOMEPAGE_SURVEY_STEPS,
  SURVEY_REDIRECTS,
  PERSONAL_FUNDING_OPTION,
} from "./homepage-survey-steps.mjs";

test("homepage contact is last", () => {
  const last = HOMEPAGE_SURVEY_STEPS[HOMEPAGE_SURVEY_STEPS.length - 1];
  assert.equal(last.id, "contact");
  assert.equal(HOMEPAGE_SURVEY_STEPS[0].id, "funding_target_amount");
});

test("visibleSurveySteps: personal path hides business revenue", () => {
  const steps = visibleSurveySteps({ has_business: PERSONAL_FUNDING_OPTION });
  const ids = steps.map((s) => s.id);
  assert.ok(ids.includes("annual_personal_income"));
  assert.ok(ids.includes("verify_income"));
  assert.ok(!ids.includes("annual_business_revenue"));
  assert.ok(ids.includes("available_capital"));
  assert.ok(ids.includes("contact"));
});

test("visibleSurveySteps: Yes tenure shows business revenue", () => {
  const steps = visibleSurveySteps({ has_business: "Yes, 2-5 years" });
  const ids = steps.map((s) => s.id);
  assert.ok(ids.includes("annual_business_revenue"));
  assert.ok(ids.includes("verify_revenue"));
  assert.ok(!ids.includes("annual_personal_income"));
});

test("PASS redirect still funding-book-call", () => {
  assert.equal(SURVEY_REDIRECTS.PASS.includes("funding-book-call"), true);
});
