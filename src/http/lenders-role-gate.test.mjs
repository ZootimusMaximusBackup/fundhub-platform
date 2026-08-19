// The lender database is owner / admin / funding_advisor only.
//
// WHAT WAS WRONG. All four lender endpoints gated on ROLE_SETS.STAFF, which is
// seven roles. A closer could read the entire lender book — names, terms,
// insider notes — with one request and no screen. Hiding the nav item does not
// help: the endpoints answer whoever asks. Chris's call, 2026-08-17: this list
// is the funding advisor's commercial relationship data, so the gate is now
// ROLE_SETS.LENDERS.
//
// WHAT STAYS OPEN, ON PURPOSE. api/read/lender-matches.mjs is a DIFFERENT
// feature — the "which lenders fit this client" box on the closer dashboard —
// and it is deliberately still on ROLE_SETS.STAFF. It is asserted here so that a
// future agent cannot quietly widen the four above or narrow this one without a
// red test explaining which side of the line each endpoint is on.
//
// WHY IT LIVES HERE AND NOT NEXT TO THE HANDLERS. package.json's test glob walks
// src/ and scripts/ ONLY (CLAUDE.md, traps). A test placed under api/ is never
// collected and reports nothing, forever. Same convention as the rest of
// src/http/: the test sits here and imports the api/ handler.
//
// WHY IT NEEDS NO POSTGRES. Every lender handler takes `deps.db` and hands that
// same object to requireAuth, so one stub object drives the real session
// verifier, the real gate and the real handler. Same shape as
// src/http/repair-cases-read.test.mjs.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import readLenders from "../../api/read/lenders.mjs";
import writeLenders from "../../api/lenders.mjs";
import readLenderObservations from "../../api/read/lender-observations.mjs";
import writeLenderObservations from "../../api/lender-observations.mjs";
import readLenderMatches from "../../api/read/lender-matches.mjs";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const ALLOWED = ["owner", "admin", "funding_advisor"];
const BLOCKED = ["closer", "sales_manager", "inquiry_specialist", "setter"];

function makeRes() {
  const res = {
    statusCode: null, body: null, headers: {},
    status(code) { res.statusCode = code; return res; },
    json(payload) { res.body = payload; return res; },
    send(payload) { res.body = payload; return res; },
    setHeader(k, v) { res.headers[String(k).toLowerCase()] = v; return res; },
    end() { return res; }
  };
  return res;
}

// Answers the session lookup with a live session for `role`, and every other
// read with no rows. An ungated call therefore reaches the store and comes back
// 200/400, while a gated one stops at 403 — so the two are told apart by the
// status alone.
function makeDb(role) {
  return {
    async query(sql) {
      if (String(sql).includes("UPDATE sessions")) {
        return {
          rows: [{
            session_id: "sess", expires_at: "2099-01-01T00:00:00Z",
            staff_id: "staff-1", org_id: ORG, role,
            email: "staff@example.com", name: "Test Staff", status: "active",
            active_flag: "true"
          }]
        };
      }
      return { rows: [] };
    }
  };
}

const AUTH = { authorization: "Bearer test-token" };

/* The four endpoints Chris locked. `admitted` is the status an allowed role
   gets: the two GETs reach an empty store and answer 200; the two POSTs are
   sent an empty body on purpose, so passing the gate lands on the endpoint's
   own body validation. Either way it is not 403, and it proves the gate runs
   BEFORE the body is looked at. */
const LOCKED = [
  {
    name: "GET /api/read/lenders",
    handler: readLenders,
    req: () => ({ method: "GET", headers: AUTH, query: {} }),
    admitted: 200
  },
  {
    name: "POST /api/lenders",
    handler: writeLenders,
    req: () => ({ method: "POST", headers: AUTH, query: {}, body: {} }),
    admitted: 400
  },
  {
    name: "GET /api/read/lender-observations",
    handler: readLenderObservations,
    req: () => ({ method: "GET", headers: AUTH, query: {} }),
    admitted: 200
  },
  {
    name: "POST /api/lender-observations",
    handler: writeLenderObservations,
    req: () => ({ method: "POST", headers: AUTH, query: {}, body: {} }),
    admitted: 400
  }
];

describe("lender database: the role gate", () => {
  for (const endpoint of LOCKED) {
    test(`${endpoint.name} admits owner, admin and the funding advisor`, async () => {
      for (const role of ALLOWED) {
        const res = makeRes();
        await endpoint.handler(endpoint.req(), res, { db: makeDb(role) });
        assert.equal(res.statusCode, endpoint.admitted,
          `${role} was refused by ${endpoint.name}. Body was: ` +
          JSON.stringify(res.body));
      }
    });

    test(`${endpoint.name} refuses every other staff role with 403`, async () => {
      for (const role of BLOCKED) {
        const res = makeRes();
        await endpoint.handler(endpoint.req(), res, { db: makeDb(role) });
        assert.equal(res.statusCode, 403,
          `${role} reached the lender database through ${endpoint.name}. ` +
          "Body was: " + JSON.stringify(res.body));
        assert.equal(res.body.ok, false);
        assert.equal(res.body.error, "forbidden");
        assert.ok(!("lenders" in res.body), "the refusal still carried lender rows");
        assert.ok(!("observations" in res.body),
          "the refusal still carried observation rows");
      }
    });
  }

  /* OUT OF SCOPE ON PURPOSE — see the header. This is the closer's match box,
     not the Lenders list. If this test fails, somebody locked an endpoint Chris
     did not name and broke a closer's daily screen. Only Chris reverses this. */
  test("read/lender-matches is NOT locked: a closer still gets their match box", async () => {
    const res = makeRes();
    await readLenderMatches(
      { method: "GET", headers: AUTH, query: { client_id: CLIENT } },
      res,
      { db: makeDb("closer") }
    );
    assert.notEqual(res.statusCode, 403,
      "a closer was locked out of read/lender-matches. That endpoint is the " +
      "closer dashboard's match box and stays on ROLE_SETS.STAFF by an explicit " +
      "owner-scope decision (docs/workflows/lenders-role-lock-2026-08-17.md).");
  });
});

/* Blank Name box on Save. The screen posts every empty field as "", and
   lenders.name is NOT NULL with a non-empty check (db/migrations/138_lenders.sql:60),
   so a cleared Name box used to reach Postgres and surface as a raw 500. No
   database is needed to prove the refusal — it happens before any store call. */
describe("lender save refuses a blank name in words, not with a 500", () => {
  test("owner clearing the Name box gets 400 name_required", async () => {
    const res = makeRes();
    await writeLenders(
      {
        method: "POST",
        headers: AUTH,
        body: {
          action: "save",
          id: "11111111-1111-4111-8111-111111111111",
          patch: { name: "   " }
        }
      },
      res,
      { db: makeDb("owner") }
    );
    assert.equal(res.statusCode, 400,
      "a cleared Name box must be refused in words before it reaches the database");
    assert.equal(res.body.error, "name_required");
    assert.equal(res.body.message, "Name is required.");
  });
});
