// api/dashboard/pipeline.mjs is one generic handler for every pipeline key —
// it looks up whatever `key` the caller asks for against the `pipelines`
// table and was never special-cased to "sales". The frontend (pipeline.html)
// used to call it only for Sales and hardcode "no board yet" for the other
// rails without ever asking the backend, which made the endpoint look
// pipeline-specific when it never was. This proves the non-Sales keys answer
// with real stages and cards through the exact same code path Sales already
// used — same auth, same org scoping, same shape.
//
// affiliates_hiring (R-07) is retired; affiliates_white_label and hiring are
// the replacement rails (migrations 115 and 051).
//
// SKIPS unless DATABASE_URL is set. It does NOT pass quietly.

import { test, before, after } from "node:test";
import assert from "node:assert";

import { db, close } from "../db.mjs";
import pipeline from "../../api/dashboard/pipeline.mjs";
import { createSession } from "../auth/session.mjs";

const HAS_DB = !!process.env.DATABASE_URL;

function makeRes() {
  return {
    statusCode: null, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
    json(o) { this.body = o; return this; }
  };
}

const asStaff = (token, query) => ({
  method: "GET",
  headers: { authorization: "Bearer " + token },
  query: query || {}
});

// One card per pipeline, dropped into its second stage (index 1) so a bug
// that only checks "the first stage has something" can't pass by accident.
const PIPELINES = [
  { key: "sales",                 name: "Sales Test",                 stages: ["new_lead", "survey_complete", "booked"] },
  { key: "funding_card_stacking", name: "Card Stacking Test",         stages: ["apply_now", "round_submitted", "approved"] },
  { key: "funding_altfin",        name: "Alt-Fin Test",               stages: ["app_created", "docs_stips", "underwriting"] },
  { key: "optimization",          name: "Optimization Test",          stages: ["round_sent", "bureau_processing", "portal_updated"] },
  { key: "inquiry_removal",       name: "Inquiry Removal Test",       stages: ["requested", "specialist_assigned", "calls_in_progress"] },
  { key: "ar_collections",        name: "AR Collections Test",        stages: ["invoice_sent", "reminder", "escalation"] },
  { key: "affiliates_white_label", name: "Affiliates White Label Test", stages: ["recruiting", "invited", "agreement_signed"] },
  { key: "hiring",                name: "Hiring Test",                stages: ["applied", "screening", "group_interview"] }
];

let orgId = null;
let token = null;
let clientId = null;
const pipelineIds = {};
const cardIds = [];

before(async () => {
  if (!HAS_DB) return;

  orgId = (await db.query(
    `INSERT INTO orgs (slug, name) VALUES ('pipeline-endpoints-test', 'Pipeline Endpoints Test')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`)).rows[0].id;

  const staffId = (await db.query(
    `INSERT INTO staff (org_id, email, name, role, status)
     VALUES ($1, 'pipeline-endpoints-test@example.test', 'Test Staff', 'owner', 'active')
     RETURNING id`, [orgId])).rows[0].id;
  token = (await createSession(db, { staffId, orgId })).token;

  clientId = (await db.query(
    `INSERT INTO clients (org_id, first_name, last_name, funded_amount)
     VALUES ($1, 'Pipeline', 'Endpoints', 4200) RETURNING id`, [orgId])).rows[0].id;

  for (const p of PIPELINES) {
    const pipelineId = (await db.query(
      `INSERT INTO pipelines (org_id, key, name) VALUES ($1, $2, $3) RETURNING id`,
      [orgId, p.key, p.name])).rows[0].id;
    pipelineIds[p.key] = pipelineId;

    let secondStageId = null;
    for (let i = 0; i < p.stages.length; i++) {
      const stageId = (await db.query(
        `INSERT INTO pipeline_stages (org_id, pipeline_id, key, name, sort_order)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [orgId, pipelineId, p.stages[i], p.stages[i], i])).rows[0].id;
      if (i === 1) secondStageId = stageId;
    }

    const cardId = (await db.query(
      `INSERT INTO cards (org_id, client_id, pipeline_id, stage_id, owner)
       VALUES ($1, $2, $3, $4, 'Test Owner') RETURNING id`,
      [orgId, clientId, pipelineId, secondStageId])).rows[0].id;
    cardIds.push(cardId);
  }
});

after(async () => {
  if (!HAS_DB) return;
  if (clientId) {
    await db.query(`DELETE FROM messages WHERE client_id = $1`, [clientId]);
    await db.query(`DELETE FROM conversations WHERE client_id = $1`, [clientId]);
  }
  await db.query(`DELETE FROM cards WHERE id = ANY($1::uuid[])`, [cardIds]);
  await db.query(`DELETE FROM pipeline_stages WHERE pipeline_id = ANY($1::uuid[])`,
    [Object.values(pipelineIds)]);
  await db.query(`DELETE FROM pipelines WHERE id = ANY($1::uuid[])`, [Object.values(pipelineIds)]);
  if (clientId) await db.query(`DELETE FROM clients WHERE id = $1`, [clientId]);
  await db.query(`DELETE FROM staff WHERE email = 'pipeline-endpoints-test@example.test'`);
  await db.query(`DELETE FROM orgs WHERE slug = 'pipeline-endpoints-test'`);
  await close();
});

for (const p of PIPELINES) {
  test(`GET /api/dashboard/pipeline?key=${p.key} returns that pipeline's stages and cards`,
    { skip: !HAS_DB }, async () => {
      const res = makeRes();
      await pipeline(asStaff(token, { key: p.key }), res);

      assert.equal(res.statusCode, 200, `${p.key} must return 200, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.pipeline, p.key);
      assert.equal(res.body.stages.length, p.stages.length,
        `${p.key} must return one column per seeded stage`);

      const withCard = res.body.stages.find((s) => s.count === 1);
      assert.ok(withCard, `${p.key} must have exactly one stage carrying the seeded card`);
      assert.equal(withCard.key, p.stages[1], "the card must be in the stage it was seeded into, not the first one");
      assert.equal(withCard.cards[0].name, "Pipeline Endpoints");
      assert.equal(withCard.cards[0].amount, 4200);

      const empty = res.body.stages.filter((s) => s.count === 0);
      assert.equal(empty.length, p.stages.length - 1,
        "every other stage must still render as an empty column, not disappear");
    });
}

test("pipeline cards mark sms/email needs_reply when that person wrote last", { skip: !HAS_DB }, async () => {
  const sms = (await db.query(
    `INSERT INTO conversations (org_id, client_id, channel, last_pulse_at)
     VALUES ($1,$2,'sms', now()) RETURNING id`, [orgId, clientId])).rows[0].id;
  const email = (await db.query(
    `INSERT INTO conversations (org_id, client_id, channel, last_pulse_at)
     VALUES ($1,$2,'email', now()) RETURNING id`, [orgId, clientId])).rows[0].id;
  await db.query(
    `INSERT INTO messages (org_id, client_id, conversation_id, direction, channel, rendered_body, status)
     VALUES ($1,$2,$3,'inbound','sms','any update?','received'),
            ($1,$2,$4,'outbound','email','thanks','sent')`,
    [orgId, clientId, sms, email]);

  const res = makeRes();
  await pipeline(asStaff(token, { key: "sales" }), res);
  assert.equal(res.statusCode, 200);
  const card = res.body.stages.find((s) => s.count === 1).cards[0];
  assert.equal(card.sms_needs_reply, true);
  assert.equal(card.email_needs_reply, false);
});

test("an unknown pipeline key is a 404, not a silent empty board", { skip: !HAS_DB }, async () => {
  const res = makeRes();
  await pipeline(asStaff(token, { key: "not_a_real_pipeline" }), res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, "unknown_pipeline");
});

test("no credential at all is refused", { skip: !HAS_DB }, async () => {
  const res = makeRes();
  await pipeline({ method: "GET", headers: {}, query: { key: "sales" } }, res);
  assert.equal(res.statusCode, 401);
});

test("a non-GET method is refused before touching the database", { skip: !HAS_DB }, async () => {
  const res = makeRes();
  await pipeline({ method: "POST", headers: {}, query: { key: "sales" } }, res);
  assert.equal(res.statusCode, 405);
});
