import { test } from "node:test";
import assert from "node:assert/strict";
import {
  visibleSurveySteps,
  HOMEPAGE_SURVEY_STEPS,
  SURVEY_REDIRECTS,
} from "./homepage-survey-steps.mjs";
import { classifySurvey, PASS, DOWNSELL } from "./survey-qualification.mjs";

test("visibleSurveySteps hides business branch when has_business is No", () => {
  const steps = visibleSurveySteps({ cf_svy_has_business: "No" });
  const keys = steps.map((s) => s.key);
  assert.ok(!keys.includes("cf_svy_business_revenue"));
  assert.ok(!keys.includes("cf_svy_revenue_verifiable"));
  assert.ok(keys.includes("cf_svy_has_negatives"));
  assert.ok(keys.includes("__contact__"));
});

test("visibleSurveySteps shows business branch when Yes", () => {
  const steps = visibleSurveySteps({ cf_svy_has_business: "Yes" });
  const keys = steps.map((s) => s.key);
  assert.ok(keys.includes("cf_svy_business_revenue"));
  assert.ok(keys.includes("cf_svy_revenue_verifiable"));
});

test("homepage steps include required routing keys", () => {
  const keys = HOMEPAGE_SURVEY_STEPS.map((s) => s.key);
  assert.ok(keys.includes("cf_svy_self_reported_fico"));
  assert.ok(keys.includes("cf_svy_has_negatives"));
  assert.equal(SURVEY_REDIRECTS.PASS.includes("funding-book-call"), true);
});

test("clean answers classify to PASS", () => {
  assert.equal(
    classifySurvey({
      cf_svy_self_reported_fico: "750+",
      cf_svy_has_negatives: "No",
    }),
    PASS
  );
});

test("negatives classify to DOWNSELL", () => {
  assert.equal(
    classifySurvey({
      cf_svy_self_reported_fico: "750+",
      cf_svy_has_negatives: "Yes",
    }),
    DOWNSELL
  );
});
