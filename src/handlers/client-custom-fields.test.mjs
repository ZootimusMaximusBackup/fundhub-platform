import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pickTypedSurveyAnswers,
  upsertSurveyCarbonCopy,
  CF_SVY_TYPED_COLUMNS,
} from "./client-custom-fields.mjs";

test("pickTypedSurveyAnswers keeps only known cf_svy_* keys", () => {
  const out = pickTypedSurveyAnswers({
    cf_svy_self_reported_fico: "750+",
    cf_svy_has_negatives: "No",
    cf_svy_has_business: "Yes",
    noise: "drop-me",
    cf_svy_money_change_now: ["payroll", "inventory"],
  });
  assert.deepEqual(out, {
    cf_svy_self_reported_fico: "750+",
    cf_svy_has_negatives: "No",
    cf_svy_has_business: "Yes",
    cf_svy_money_change_now: ["payroll", "inventory"],
  });
  assert.ok(CF_SVY_TYPED_COLUMNS.includes("cf_svy_available_capital"));
});

test("pickTypedSurveyAnswers wraps single money_change value as array", () => {
  const out = pickTypedSurveyAnswers({ cf_svy_money_change_now: "payroll" });
  assert.deepEqual(out.cf_svy_money_change_now, ["payroll"]);
});

test("upsertSurveyCarbonCopy no-ops without typed keys", async () => {
  let called = 0;
  const db = { query: async () => { called += 1; } };
  const r = await upsertSurveyCarbonCopy(db, {
    clientId: "c1",
    orgId: "o1",
    answers: { noise: true },
  });
  assert.equal(r.written, 0);
  assert.equal(called, 0);
});

test("upsertSurveyCarbonCopy builds INSERT ON CONFLICT for typed keys", async () => {
  let sql = "";
  let params = null;
  const db = {
    query: async (q, p) => {
      sql = q;
      params = p;
      return { rows: [] };
    },
  };
  const r = await upsertSurveyCarbonCopy(db, {
    clientId: "c1",
    orgId: "o1",
    answers: {
      cf_svy_self_reported_fico: "700-749",
      cf_svy_has_negatives: "No",
    },
  });
  assert.equal(r.written, 2);
  assert.match(sql, /INSERT INTO client_custom_fields/);
  assert.match(sql, /ON CONFLICT \(client_id\) DO UPDATE/);
  assert.match(sql, /cf_svy_self_reported_fico/);
  assert.match(sql, /cf_svy_has_negatives/);
  assert.deepEqual(params.slice(0, 2), ["c1", "o1"]);
  assert.ok(params.includes("700-749"));
  assert.ok(params.includes("No"));
});
