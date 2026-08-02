// api/journeys.mjs — the Journeys editor's persisted automation steps.
//
// Covers the PUT brace-tag gate (src/journeys/copy-tags.mjs): a step body or
// subject saved with a single-brace tag like {first_name} would, once it left
// the editor, be text render-template.mjs cannot see — it only ever matches
// {{double braces}} — so the save is refused rather than stored broken.
//
// SKIPS unless DATABASE_URL is set. It does NOT pass quietly.

import { test, before, after } from "node:test";
import assert from "node:assert";

import { db, close } from "../db.mjs";
import journeys from "../../api/journeys.mjs";
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

const asStaff = (token, method, body) => ({
  method,
  headers: { authorization: "Bearer " + token },
  body: body || {}
});

const cleanNodes = [
  { id: "n1", type: "sms", title: "Text them", cfg: { body: "Hi {{first_name}} — {{survey_link}}", delay: "instant" }, touches: [] }
];

let orgId = null;
let token = null;

before(async () => {
  if (!HAS_DB) return;

  orgId = (await db.query(
    `INSERT INTO orgs (slug, name) VALUES ('journeys-endpoint-test', 'Journeys Endpoint Test')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`)).rows[0].id;

  const staffId = (await db.query(
    `INSERT INTO staff (org_id, email, name, role, status)
     VALUES ($1, 'journeys-endpoint-test@example.test', 'Test Owner', 'owner', 'active')
     RETURNING id`, [orgId])).rows[0].id;
  token = (await createSession(db, { staffId, orgId })).token;
});

after(async () => {
  if (!HAS_DB) return;
  await db.query(`DELETE FROM journeys WHERE org_id = $1`, [orgId]);
  await db.query(`DELETE FROM staff WHERE email = 'journeys-endpoint-test@example.test'`);
  await db.query(`DELETE FROM orgs WHERE slug = 'journeys-endpoint-test'`);
  await close();
});

test("PUT refuses a body with a single-brace tag", { skip: !HAS_DB }, async () => {
  const res = makeRes();
  await journeys(asStaff(token, "PUT", {
    key: "client", name: "Client", start: "Someone applies", end: "Diagnostic done",
    nodes: [{ id: "n1", type: "sms", title: "Text them", cfg: { body: "Hi {first_name} — {{survey_link}}" }, touches: [] }]
  }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "single_brace_tags");
  assert.equal(res.body.violations.length, 1);
  assert.deepEqual(res.body.violations[0].tags, ["first_name"]);
});

test("PUT refuses a single-brace tag on an email subject, inside a condition branch", { skip: !HAS_DB }, async () => {
  const res = makeRes();
  await journeys(asStaff(token, "PUT", {
    key: "client", name: "Client", start: "Someone applies", end: "Diagnostic done",
    nodes: [{
      id: "n1", type: "condition", title: "Did they reply", cfg: { field: "x", op: "is true" }, touches: [],
      branches: [{ label: "Yes", nodes: [
        { id: "n2", type: "email", title: "Recap", cfg: { subject: "Hi {name}", body: "All good {{first_name}}" }, touches: [] }
      ] }]
    }]
  }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "single_brace_tags");
  assert.equal(res.body.violations[0].field, "subject");
});

test("PUT accepts a clean, double-braced body and it round-trips through GET", { skip: !HAS_DB }, async () => {
  const putRes = makeRes();
  await journeys(asStaff(token, "PUT", {
    key: "client", name: "Client", start: "Someone applies", end: "Diagnostic done", nodes: cleanNodes
  }), putRes);
  assert.equal(putRes.statusCode, 200, JSON.stringify(putRes.body));
  assert.equal(putRes.body.ok, true);

  const getRes = makeRes();
  await journeys({ method: "GET", headers: { authorization: "Bearer " + token } }, getRes);
  assert.equal(getRes.statusCode, 200);
  assert.equal(getRes.body.journeys.client.nodes[0].cfg.body, "Hi {{first_name}} — {{survey_link}}");
});

test("no credential at all is refused", { skip: !HAS_DB }, async () => {
  const res = makeRes();
  await journeys({ method: "PUT", headers: {}, body: { key: "client", name: "x", start: "a", end: "b", nodes: [] } }, res);
  assert.equal(res.statusCode, 401);
});
