import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "path";
import { fileURLToPath } from "node:url";
import { homepageSurveyQuestions } from "../survey/cf-question-map.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const jsPath = path.join(HERE, "../../public/js/homepage-survey.js");

test("public homepage-survey.js keeps every ground-truth title and option", () => {
  const src = fs.readFileSync(jsPath, "utf8");
  for (const step of homepageSurveyQuestions()) {
    assert.ok(src.includes(step.title), `missing title: ${step.title}`);
    for (const opt of step.options || []) {
      assert.ok(src.includes(opt), `missing option: ${opt}`);
    }
  }
  assert.ok(src.includes("/api/public/survey-submit"));
  // contact last on homepage
  const contactIdx = src.lastIndexOf('id: "contact"');
  const capitalIdx = src.indexOf('id: "available_capital"');
  assert.ok(contactIdx > capitalIdx, "contact step should appear after available_capital in JS");
});

test("homepage survey asks any negatives and maps cf_svy_has_negatives", () => {
  const src = fs.readFileSync(jsPath, "utf8");
  const scoreIdx = src.indexOf('id: "current_score"');
  const negIdx = src.indexOf('id: "has_negatives"');
  const bizIdx = src.indexOf('id: "has_business"');
  assert.ok(negIdx > scoreIdx, "negatives should follow current score");
  assert.ok(negIdx < bizIdx, "negatives should come before has_business");
  assert.ok(src.includes("Any negatives on your credit report?"));
  assert.ok(src.includes('has_negatives: "cf_svy_has_negatives"'));
});
