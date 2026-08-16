import { test } from "node:test";
import assert from "node:assert/strict";
import {
  InsightError,
  parseAnswers,
  parseInsightInput,
  presentInsight,
  saveInsight,
  listInsights
} from "./store.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const STAFF = "33333333-3333-4333-8333-333333333333";

function stubDb(handlers = []) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      for (const [re, fn] of handlers) {
        if (re.test(sql)) return fn(params, sql);
      }
      return { rows: [] };
    }
  };
}

test("parseInsightInput: requires client, stage, channel", () => {
  assert.throws(() => parseInsightInput({}), (e) => e instanceof InsightError);
  assert.throws(
    () => parseInsightInput({ client_id: CLIENT, stage: "post" }),
    (e) => /channel/.test(e.message)
  );
  assert.throws(
    () => parseInsightInput({ client_id: CLIENT, channel: "google_meet" }),
    (e) => /stage/.test(e.message)
  );
});

test("parseInsightInput: accepts mid/post and the three channels", () => {
  const p = parseInsightInput({
    client_id: CLIENT,
    stage: "POST",
    channel: "google_meet",
    answers: { life_before: "behind on payroll" },
    notes: "good call"
  });
  assert.equal(p.stage, "post");
  assert.equal(p.channel, "google_meet");
  assert.equal(p.answers.life_before, "behind on payroll");
  assert.equal(p.notes, "good call");
});

test("parseAnswers: drops blanks and truncates", () => {
  const out = parseAnswers({ a: "  yes  ", b: "", c: null });
  assert.deepEqual(out, { a: "yes" });
});

test("saveInsight: writes a row for a known client", async () => {
  const db = stubDb([
    [/FROM clients/, () => ({ rows: [{ id: CLIENT }] })],
    [/INSERT INTO customer_insights/, (params) => ({
      rows: [{
        id: "ins1",
        org_id: params[0],
        client_id: params[1],
        product_id: params[2],
        task_id: params[3],
        stage: params[4],
        channel: params[5],
        answers: JSON.parse(params[6]),
        notes: params[7],
        meeting_url: params[8],
        recording_url: params[9],
        recorded_by: params[10],
        occurred_at: "2026-08-15T00:00:00.000Z",
        created_at: "2026-08-15T00:00:00.000Z"
      }]
    })]
  ]);
  const row = await saveInsight(db, {
    orgId: ORG,
    staffId: STAFF,
    input: {
      client_id: CLIENT,
      stage: "post",
      channel: "google_meet",
      answers: { felt_funded: "relieved" },
      recording_url: null
    }
  });
  assert.equal(row.stage, "post");
  assert.equal(row.answers.felt_funded, "relieved");
  assert.equal(row.recorded_by, STAFF);
  assert.equal(row.recording_url, null);
});

test("saveInsight: 404 when the client is not in this org", async () => {
  const db = stubDb([[/FROM clients/, () => ({ rows: [] })]]);
  await assert.rejects(
    () => saveInsight(db, {
      orgId: ORG,
      staffId: STAFF,
      input: { client_id: CLIENT, stage: "mid", channel: "call" }
    }),
    (e) => e instanceof InsightError && e.status === 404
  );
});

test("listInsights: scopes to org and optional client", async () => {
  const db = stubDb([
    [/FROM customer_insights/, () => ({
      rows: [{
        id: "ins1", org_id: ORG, client_id: CLIENT, stage: "post",
        channel: "google_meet", answers: {}, recorded_by: STAFF,
        occurred_at: "2026-08-15T00:00:00.000Z", created_at: "2026-08-15T00:00:00.000Z"
      }]
    })]
  ]);
  const rows = await listInsights(db, { orgId: ORG, clientId: CLIENT, limit: 50, offset: 0 });
  assert.equal(rows.length, 1);
  assert.equal(presentInsight(rows[0]).client_id, CLIENT);
  const clientParam = db.calls[0].params[1];
  assert.equal(clientParam, CLIENT);
});
