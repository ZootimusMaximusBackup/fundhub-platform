import { test } from "node:test";
import assert from "node:assert/strict";
import { isDraftTemplateCopy, isDraftTemplateRow } from "./draft-guard.mjs";

test("isDraftTemplateCopy detects [DRAFT] markers", () => {
  assert.equal(isDraftTemplateCopy("[DRAFT — NO SOURCE COPY IN fundhub-docs]\nHi"), true);
  assert.equal(isDraftTemplateCopy("[DRAFT] SMS-N01"), true);
  assert.equal(isDraftTemplateCopy("Hello {{contact.first_name}}, your file is ready."), false);
  assert.equal(isDraftTemplateCopy(null), false);
});

test("isDraftTemplateRow checks body and subject", () => {
  assert.equal(isDraftTemplateRow({ body: "ok", subject: "[DRAFT] subject" }), true);
  assert.equal(isDraftTemplateRow({ body: "ok", subject: "Real subject" }), false);
});
