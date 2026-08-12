import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CF_SURVEY_QUESTIONS,
  PERSONAL_FUNDING_OPTION,
  homepageSurveyQuestions,
  visibleQuestions,
  answersByPayloadKey,
} from "./cf-question-map.mjs";

test("CF order has contact first; homepage has contact last", () => {
  assert.equal(CF_SURVEY_QUESTIONS[0].id, "contact");
  const home = homepageSurveyQuestions();
  assert.equal(home[home.length - 1].id, "contact");
  assert.notEqual(home[0].id, "contact");
});

test("business path shows revenue steps, not personal income", () => {
  const steps = visibleQuestions({ has_business: "Yes, 1-2 years" });
  const ids = steps.map((s) => s.id);
  assert.ok(ids.includes("annual_business_revenue"));
  assert.ok(ids.includes("verify_revenue"));
  assert.ok(!ids.includes("annual_personal_income"));
  assert.ok(!ids.includes("verify_income"));
});

test("personal path shows income steps, not business revenue", () => {
  const steps = visibleQuestions({ has_business: PERSONAL_FUNDING_OPTION });
  const ids = steps.map((s) => s.id);
  assert.ok(ids.includes("annual_personal_income"));
  assert.ok(ids.includes("verify_income"));
  assert.ok(!ids.includes("annual_business_revenue"));
});

test("payload keys default to question titles (CF attribute None assumption)", () => {
  const q = CF_SURVEY_QUESTIONS.find((x) => x.id === "funding_target_amount");
  assert.equal(q.payloadKey, "Set Your Target Amount");
  const keyed = answersByPayloadKey({
    funding_target_amount: "Less than $50k",
    current_score: "750+",
  });
  assert.equal(keyed["Set Your Target Amount"], "Less than $50k");
  assert.equal(keyed["Your Current Score"], "750+");
});
