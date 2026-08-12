// /api/public/survey-submit — validation + classify path (no live Postgres).

import { test } from "node:test";
import assert from "node:assert/strict";
import handler, {
  parseSurveySubmitBody,
  runSurveySubmit,
} from "../../api/public/survey-submit.mjs";
import { PASS, DOWNSELL, MANUAL_REVIEW } from "../config/survey-qualification.mjs";

function mockRes() {
  const out = { statusCode: 200, headers: {}, body: null };
  return {
    out,
    setHeader(k, v) {
      out.headers[k] = v;
    },
    status(code) {
      out.statusCode = code;
      return this;
    },
    json(body) {
      out.body = body;
      return this;
    },
  };
}

test("parseSurveySubmitBody requires name email phone", () => {
  assert.equal(parseSurveySubmitBody({}).ok, false);
  assert.equal(parseSurveySubmitBody({ name: "A", email: "bad", phone: "1" }).error, "name_email_phone_required");
  const ok = parseSurveySubmitBody({
    name: "Ada Lovelace",
    email: "Ada@Example.COM",
    phone: "555-0100",
    business: "Analytical Engines",
    answers: {
      cf_svy_self_reported_fico: "750+",
      cf_svy_has_negatives: "No",
      ignore_me: "x",
    },
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.email, "ada@example.com");
  assert.deepEqual(ok.answers, {
    cf_svy_self_reported_fico: "750+",
    cf_svy_has_negatives: "No",
  });
});

test("runSurveySubmit emits entry + survey and returns PASS redirect", async () => {
  const names = [];
  const fakeEmit = async (_db, name, payload) => {
    names.push({ name, payload });
    return { id: "evt", deduped: false };
  };
  const result = await runSurveySubmit(
    {
      name: "Ada",
      email: "ada@example.com",
      phone: "555",
      business: "AE",
      source: "website:home",
      sms_consent: true,
      answers: {
        cf_svy_self_reported_fico: "750+",
        cf_svy_has_negatives: "No",
      },
    },
    { emit: fakeEmit, ensureRegistered: () => {}, db: {} }
  );
  assert.equal(result.ok, true);
  assert.equal(result.qualification, PASS);
  assert.match(result.redirect, /funding-book-call/);
  assert.deepEqual(
    names.map((n) => n.name),
    ["entry.captured", "survey.submitted"]
  );
  assert.equal(names[1].payload.answers.cf_svy_has_negatives, "No");
});

test("runSurveySubmit DOWNSELL when negatives Yes", async () => {
  const result = await runSurveySubmit(
    {
      name: "Bob",
      email: "bob@example.com",
      phone: "555",
      business: "",
      source: "website:home",
      sms_consent: false,
      answers: {
        cf_svy_self_reported_fico: "750+",
        cf_svy_has_negatives: "Yes",
      },
    },
    { emit: async () => ({ id: "x", deduped: false }), ensureRegistered: () => {}, db: {} }
  );
  assert.equal(result.qualification, DOWNSELL);
  assert.match(result.redirect, /thank-you/);
});

test("runSurveySubmit MANUAL_REVIEW when gate answers missing", async () => {
  const result = await runSurveySubmit(
    {
      name: "C",
      email: "c@example.com",
      phone: "555",
      business: "",
      source: "website:home",
      sms_consent: false,
      answers: { cf_svy_funding_target_amount: "$50k - $100k" },
    },
    { emit: async () => ({ id: "x", deduped: false }), ensureRegistered: () => {}, db: {} }
  );
  assert.equal(result.qualification, MANUAL_REVIEW);
});

test("handler rejects GET", async () => {
  const res = mockRes();
  await handler({ method: "GET" }, res);
  assert.equal(res.out.statusCode, 405);
});

test("handler rejects incomplete body", async () => {
  const res = mockRes();
  await handler({ method: "POST", body: { name: "Only" } }, res);
  assert.equal(res.out.statusCode, 400);
  assert.equal(res.out.body.error, "name_email_phone_required");
});
