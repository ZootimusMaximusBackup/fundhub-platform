import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HOMEPAGE_SURVEY_STEPS } from "./homepage-survey-steps.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const jsPath = path.join(HERE, "../../public/js/homepage-survey.js");

test("public homepage-survey.js keeps every cf_svy_* key from server config", () => {
  const src = fs.readFileSync(jsPath, "utf8");
  for (const step of HOMEPAGE_SURVEY_STEPS) {
    if (step.key === "__contact__") continue;
    assert.ok(src.includes(JSON.stringify(step.key)) || src.includes(`"${step.key}"`), `missing ${step.key}`);
  }
  assert.ok(src.includes("/api/public/survey-submit"));
});
