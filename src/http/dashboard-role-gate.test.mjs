// The dashboard read endpoints must gate on ROLE_SETS.STAFF, not merely on
// "is there a session".
//
// THE DEFECT (audit M1). api/dashboard/clients.mjs and api/dashboard/client.mjs
// called requireDashboardAccess() and nothing else. That answers exactly one
// question — is this caller signed in — and every staff row is signed in,
// including role='partner', which is an EXTERNAL white-label operator. A partner
// session therefore read the whole client book (name, email, funded amount) from
// /clients, and from /client the full detail: phone, message bodies, consent and
// do-not-contact flags. ROLE_SETS.STAFF in src/http/read-api.mjs already excludes
// 'partner'; these two endpoints just never called it.
//
// WHY THIS FILE IS BEHAVIOURAL AND NOT A SOURCE REGEX (cf. auth-gate.test.mjs).
// The gate is reachable without Postgres: src/db.mjs exports `db` as a plain
// object whose `query` is a property, and every layer below the handler —
// attachStaff → authenticate → verifySession — takes that same object. Swapping
// `db.query` for a stub lets the real handler, the real session verifier and the
// real gate all run, so this asserts what the endpoint DOES rather than what its
// source text says. Restored in after() so nothing else in the process sees it.
//
// THIS FILE LIVES UNDER src/http/, NOT NEXT TO THE HANDLERS. package.json's test
// glob is "src/**" and "scripts/**"; a test under api/ is never collected.

import { test, describe, before, after } from "node:test";
import assert from "node:assert";
import { db } from "../db.mjs";
import clientsHandler from "../../api/dashboard/clients.mjs";
import clientHandler from "../../api/dashboard/client.mjs";

const TOKEN = "test-session-token";
const CLIENT_ID = "11111111-2222-3333-4444-555555555555";

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; return r; };
  return r;
};

const req = (query = {}) => ({
  method: "GET",
  headers: { authorization: `Bearer ${TOKEN}` },
  query
});

// One PII-bearing row per shape, so a failing assertion can say what leaked.
const LIST_ROW = {
  id: CLIENT_ID,
  first_name: "Dana", last_name: "Reyes", email: "dana.reyes@example.com",
  outcome_tier: "A", funded: true, funded_amount: "50000",
  crs_paid: true, deposit_paid: true, sale_closed: true,
  total_funding_estimate: "75000",
  created_at: new Date("2026-01-01T00:00:00Z"),
  tx_count: "1", tx_latest_product: "CRS", tx_latest_amount: "1997",
  tx_latest_status: "paid",
  crs_count: "1", task_count: "0",
  last_msg_channel: "sms", last_msg_direction: "out",
  last_msg_at: new Date("2026-01-02T00:00:00Z")
};

const DETAIL_ROW = {
  id: CLIENT_ID,
  first_name: "Dana", last_name: "Reyes", email: "dana.reyes@example.com",
  phone: "+15550001111",
  outcome_tier: "A", funded: true, funded_amount: "50000", days_to_fund: 30,
  channel_source: "paid", tags: [], pipeline_ids: [],
  dnd_sms: false, dnd_email: false, dnd_voice: false, consent_sms: true,
  custom_fields: {},
  created_at: new Date("2026-01-01T00:00:00Z"),
  updated_at: new Date("2026-01-03T00:00:00Z")
};

let realQuery;
let currentRole = "closer";

// The stub stands in for the whole database. The session lookup answers with a
// live session for `currentRole`; the endpoints' own reads answer with the rows
// above, so an ungated call visibly returns PII instead of failing on an empty
// fixture.
async function stubQuery(sql) {
  const text = String(sql);
  if (/FROM live JOIN staff/.test(text)) {
    return { rows: [{
      session_id: "session-1",
      expires_at: new Date(Date.now() + 3600_000),
      staff_id: "staff-1", org_id: "org-1",
      role: currentRole, email: "staff@example.com", name: "Test Staff",
      status: "active", active_flag: null
    }] };
  }
  if (/FROM clients c/.test(text)) return { rows: [LIST_ROW] };
  if (/FROM clients WHERE id/.test(text)) return { rows: [DETAIL_ROW] };
  return { rows: [] };
}

describe("dashboard reads: role gate", () => {
  before(() => { realQuery = db.query; db.query = stubQuery; });
  after(() => { db.query = realQuery; });

  test("GET /api/dashboard/clients refuses a partner session with 403", async () => {
    currentRole = "partner";
    const r = res();
    await clientsHandler(req(), r);
    assert.equal(r.code, 403,
      "a signed-in role='partner' (an external white-label operator) reached the " +
      "client book. Body was: " + JSON.stringify(r.body));
    assert.equal(r.body.ok, false);
    assert.equal(r.body.error, "forbidden");
    assert.ok(!("clients" in r.body), "the refusal still carried client rows");
  });

  test("GET /api/dashboard/client refuses a partner session with 403", async () => {
    currentRole = "partner";
    const r = res();
    await clientHandler(req({ id: CLIENT_ID }), r);
    assert.equal(r.code, 403,
      "a signed-in role='partner' reached one client's full detail — phone, " +
      "message bodies, consent flags. Body was: " + JSON.stringify(r.body));
    assert.equal(r.body.error, "forbidden");
    assert.ok(!("client" in r.body), "the refusal still carried the client row");
  });

  test("the gate is the STAFF set, so every internal role still gets in", async () => {
    for (const role of ["owner", "admin", "funding_advisor", "closer", "inquiry_specialist", "setter"]) {
      currentRole = role;

      const list = res();
      await clientsHandler(req(), list);
      assert.equal(list.code, 200, `${role} was locked out of the client list: ` + JSON.stringify(list.body));
      assert.equal(list.body.count, 1);

      const detail = res();
      await clientHandler(req({ id: CLIENT_ID }), detail);
      assert.equal(detail.code, 200, `${role} was locked out of client detail: ` + JSON.stringify(detail.body));
      assert.equal(detail.body.client.id, CLIENT_ID);
    }
  });

  test("a role nobody has heard of is refused, not admitted by default", async () => {
    currentRole = "intern";
    const list = res();
    await clientsHandler(req(), list);
    assert.equal(list.code, 403, "an unknown role defaulted to allowed: " + JSON.stringify(list.body));

    const detail = res();
    await clientHandler(req({ id: CLIENT_ID }), detail);
    assert.equal(detail.code, 403, "an unknown role defaulted to allowed: " + JSON.stringify(detail.body));
  });
});
