// Postgres-backed tests for /api/finance/soft-pull — the endpoint a one-tap
// button actually calls.
//
// THIS FILE LIVES UNDER src/http/, NOT NEXT TO THE HANDLER. package.json's test
// glob is "src/**/*.test.mjs" and "scripts/**/*.test.mjs"; a test placed in api/
// is never collected and passes forever by never running. The handler is
// imported from here instead — the same arrangement, and the same reason, as
// src/http/pii.pg.test.mjs.
//
// WHAT THIS FILE PINS THAT THE STORE-LEVEL TESTS CANNOT.
//
// src/finance/soft-pulls.pg.test.mjs proves the module and the table both refuse
// an unattributed pull. That leaves the question this file answers: can a CALLER
// get one recorded anyway — with no session, with the wrong kind of session, by
// naming somebody else in the body, or by pointing a client's session at another
// client's file? Every one of those is a way to end up with a credit pull whose
// stated requester is not the person who asked for it, which is the same failure
// as having no requester at all.
//
// SO THE ASSERTIONS ARE AGAINST soft_pull_requests, NOT AGAINST THE RESPONSE.
// A response is the endpoint's account of what it did; the row is what it did.
// "The pull was refused" is only true if no row exists, and "the right person is
// on the record" is only true of the column an auditor reads.
//
// Skipped without DATABASE_URL like every other *.pg.test.mjs.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { createSession } from "../auth/session.mjs";
import { createAccountSession } from "../auth/account-session.mjs";
import { fulfilSoftPull } from "../finance/soft-pulls.mjs";
import { captureConsent } from "../consent/index.mjs";
import handler from "../../api/finance/soft-pull.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;

const STAFF_EMAIL_LIKE = "spull_http_test_%@example.com";
const ACCT_EMAIL_LIKE = "spull_http_acct_%@example.com";
const CLIENT_EMAIL_LIKE = "spull.http.test.%@example.com";

const CRS_PAYLOAD = {
  tradelines: [
    { creditor: "Amex Blue Business", credit_limit: 10000, balance: 2500, apr: 18.99, account_number: "H-AMEX-1" },
    { creditor: "Chase Ink", credit_limit: 7500, balance: 400, apr: 21.24, account_number: "H-CHASE-2" }
  ]
};

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; return r; };
  return r;
};

describe("/api/finance/soft-pull", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, client, otherClient;
  const staff = {};                 // role → { id, token }
  const acct = {};                  // label → { id, token }

  /* The handler runs the real requirePrincipal against the real sessions and
     account_sessions tables, so every call carries a token minted for a real
     row. There is no injection seam, deliberately. */
  const call = async (body, token, method = "POST", query = {}) => {
    const r = res();
    await handler({
      method, query, body,
      headers: token ? { authorization: "Bearer " + token } : {}
    }, r);
    return r;
  };

  const ledgerRows = async (clientId = client) => (await db.query(
    `SELECT * FROM soft_pull_requests WHERE client_id = $1 ORDER BY requested_at, id`, [clientId]
  )).rows;

  const wipe = async () => {
    await db.query(`DELETE FROM tradelines WHERE client_id = ANY($1)`, [[client, otherClient]]);
    await db.query(`DELETE FROM soft_pull_requests WHERE client_id = ANY($1)`, [[client, otherClient]]);
  };

  async function purge() {
    const ids = (await db.query(`SELECT id FROM clients WHERE email LIKE $1`, [CLIENT_EMAIL_LIKE]))
      .rows.map((r) => r.id);
    if (ids.length) await db.query(`DELETE FROM clients WHERE id = ANY($1)`, [ids]);
    await db.query(`DELETE FROM accounts WHERE email LIKE $1`, [ACCT_EMAIL_LIKE]);
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [STAFF_EMAIL_LIKE]);
  }

  before(async () => {
    org = await resolveDefaultOrg(db);
    await purge();

    // Both sides of the gate need a witness: the four roles that may ask for a
    // pull, and two STAFF roles that may not. ROLE_SETS.STAFF would have let the
    // last two through, which is exactly why this endpoint does not use it.
    for (const role of ["owner", "admin", "closer", "funding_advisor", "setter", "inquiry_specialist"]) {
      const id = (await db.query(
        `INSERT INTO staff (org_id, name, role, email, status)
         VALUES ($1,$2,$3,$4,'active') RETURNING id`,
        [org, `Spull Httptest ${role}`, role, `spull_http_test_${role}@example.com`])).rows[0].id;
      staff[role] = { id, token: (await createSession(db, { staffId: id, orgId: org })).token };
    }

    client = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email)
       VALUES ($1,'Spull','Subject','spull.http.test.subject@example.com') RETURNING id`,
      [org])).rows[0].id;
    otherClient = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email)
       VALUES ($1,'Spull','Bystander','spull.http.test.bystander@example.com') RETURNING id`,
      [org])).rows[0].id;

    // 044's accounts_active_needs_hash needs a hash on an active account. These
    // sign in through createAccountSession directly, so the hash is a placeholder
    // that no test authenticates against.
    for (const [label, subject] of [["self", client], ["bystander", otherClient]]) {
      const id = (await db.query(
        `INSERT INTO accounts (org_id, kind, email, name, status, client_id, password_hash)
         VALUES ($1,'client',$2,$3,'active',$4,'scrypt$placeholder') RETURNING id`,
        [org, `spull_http_acct_${label}@example.com`, `Spull Acct ${label}`, subject])).rows[0].id;
      acct[label] = { id, token: (await createAccountSession(db, { accountId: id, orgId: org })).token };
    }

    /* THE CONSENT PRECONDITION (rule 0, db/migrations/099_client_consents.sql).
     *
     * /api/finance/soft-pull now refuses with 403 code=consent_required unless
     * the client has a live consent, so every scenario below that expects a
     * request to be recorded needs one on file. Both clients get one: the
     * bystander appears in the "a client may only ask for their own file"
     * scenarios, which must fail on ownership rather than on consent.
     *
     * Granted through the module rather than by raw SQL so this fixture goes
     * through the same validation the endpoint does — a consent this test could
     * create but the product could not would make the suite agree with itself
     * and with nothing else.
     *
     * The endpoint's OWN consent behaviour is covered in
     * src/consent/consent.pg.test.mjs and src/http/consent-capture.test.mjs. */
    for (const subject of [client, otherClient]) {
      await captureConsent(db, {
        orgId: org, clientId: subject, kind: "soft_pull_consent",
        consentText: "I authorize Fundhub to obtain my consumer credit report through a soft inquiry.",
        consentVersion: "soft-pull-v1",
        grantedBy: { kind: "staff", id: staff.owner.id },
        captureMethod: "checkbox"
      });
    }
  });

  after(async () => { await purge(); await close(); });

  // ── an unattributed pull cannot be requested through the endpoint ─────────

  describe("an unattributed pull is refused", () => {
    test("no session at all is a 401 and writes NO row", async () => {
      // The core claim. Everything else in this describe block is a way of
      // arriving at the same place by a longer route.
      await wipe();
      const r = await call({ client_id: client, reason: "no token at all" }, undefined);

      assert.equal(r.code, 401, `an unauthenticated pull returned ${r.code}: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.ok, false);
      assert.equal(r.body.request, undefined);
      assert.deepEqual(await ledgerRows(), [],
        "an unauthenticated request wrote a soft-pull row — the ledger recorded a pull nobody can be held to");
    });

    test("a garbage or expired-looking bearer token is a 401 and writes no row", async () => {
      await wipe();
      for (const token of ["", "not-a-token", "Bearer", "0".repeat(43)]) {
        const r = await call({ client_id: client, reason: "forged token" }, token);
        assert.equal(r.code, 401, `token ${JSON.stringify(token)} returned ${r.code}`);
        assert.equal((await ledgerRows()).length, 0, `token ${JSON.stringify(token)} wrote a row`);
      }
    });

    test("a caller cannot choose its own attribution with body fields", async () => {
      // The pii reveal has the identical test, and for the identical reason: an
      // attributable log entry that lets the caller pick the attribution is not
      // attributable.
      await wipe();
      const r = await call({
        client_id: client, reason: "attribution check",
        requested_by_staff_id: staff.setter.id,
        requested_by_kind: "client",
        requested_by_account_id: acct.bystander.id,
        staff_id: staff.setter.id,
        org_id: "00000000-0000-0000-0000-000000000000"
      }, staff.closer.token);

      assert.equal(r.code, 200, JSON.stringify(r.body));
      const rows = await ledgerRows();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].requested_by_kind, "staff");
      assert.equal(rows[0].requested_by_staff_id, staff.closer.id,
        "a body field redirected the credit-pull record onto another employee");
      assert.equal(rows[0].requested_by_account_id, null);
      assert.equal(rows[0].org_id, org, "a body field redirected the row to another org");
    });

    test("a pull with no stated reason is a 400 and writes no row", async () => {
      await wipe();
      for (const reason of [undefined, null, "", "   ", "\t", 42, {}, []]) {
        const r = await call({ client_id: client, reason }, staff.closer.token);
        assert.equal(r.code, 400, `reason ${JSON.stringify(reason)} returned ${r.code}`);
        assert.equal(r.body.ok, false);
        assert.match(r.body.error, /reason is required/);
        assert.equal((await ledgerRows()).length, 0,
          `reason ${JSON.stringify(reason)} recorded a credit pull with nothing readable in it`);
      }
    });

    test("a bad client_id is a 400, not a 500 carrying Postgres text", async () => {
      await wipe();
      for (const client_id of [undefined, null, "", "not-a-uuid", 7, {}, "00000000-0000-0000-0000-00000000000"]) {
        const r = await call({ client_id, reason: "bad id" }, staff.closer.token);
        assert.equal(r.code, 400, `client_id ${JSON.stringify(client_id)} returned ${r.code}`);
        assert.equal(r.body.ok, false);
      }
      assert.equal((await ledgerRows()).length, 0);
    });
  });

  // ── the role gate is narrower than STAFF ─────────────────────────────────

  describe("who may ask for a client's credit to be pulled", () => {
    test("every role in SOFT_PULL_ROLES may, and each one lands on the record", async () => {
      for (const role of ["owner", "admin", "closer", "funding_advisor"]) {
        await wipe();
        const r = await call({ client_id: client, reason: `${role} working the file` }, staff[role].token);
        assert.equal(r.code, 200, `${role} was refused: ${JSON.stringify(r.body)}`);
        assert.equal(r.body.created, true);

        const rows = await ledgerRows();
        assert.equal(rows.length, 1, `${role}'s request wrote ${rows.length} rows`);
        assert.equal(rows[0].requested_by_staff_id, staff[role].id);
        assert.equal(rows[0].reason, `${role} working the file`);
        assert.equal(rows[0].status, "queued", `${role}'s request did not start queued`);
      }
    });

    test("a setter is 403 and writes no row — STAFF is not the credit-pull gate", async () => {
      await wipe();
      const r = await call({ client_id: client, reason: "qualifying the lead" }, staff.setter.token);
      assert.equal(r.code, 403, `a setter got ${r.code}`);
      assert.equal(r.body.ok, false);
      assert.deepEqual(await ledgerRows(), [], "a forbidden request still wrote a row");
    });

    test("an inquiry specialist is 403 too", async () => {
      await wipe();
      const r = await call({ client_id: client, reason: "working a dispute" }, staff.inquiry_specialist.token);
      assert.equal(r.code, 403);
      assert.deepEqual(await ledgerRows(), []);
    });

    test("a role outside the set cannot read the pull history either", async () => {
      for (const role of ["setter", "inquiry_specialist"]) {
        const r = await call(undefined, staff[role].token, "GET", { client_id: client });
        assert.equal(r.code, 403, `${role} read the credit-pull history (${r.code})`);
        assert.equal(r.body.requests, undefined);
      }
    });
  });

  // ── the client's own tap ─────────────────────────────────────────────────

  describe("a client taps once, for their own file only", () => {
    test("a client principal's request is attributed to their account", async () => {
      await wipe();
      const r = await call({ client_id: client, reason: "checking my own credit picture" }, acct.self.token);
      assert.equal(r.code, 200, JSON.stringify(r.body));
      assert.equal(r.body.created, true);

      const rows = await ledgerRows();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].requested_by_kind, "client");
      assert.equal(rows[0].requested_by_account_id, acct.self.id);
      assert.equal(rows[0].requested_by_staff_id, null);
    });

    test("a client cannot request a pull on somebody else's file", async () => {
      // The harm is not a wrong status code. It is one consumer causing another
      // consumer's credit to be pulled.
      await wipe();
      const r = await call({ client_id: client, reason: "curious about my neighbour" }, acct.bystander.token);
      assert.equal(r.code, 403, `a client reached another client's file (${r.code})`);
      assert.deepEqual(await ledgerRows(), [],
        "one client's session caused a credit-pull row against another client");
    });

    test("a client cannot read somebody else's pull history", async () => {
      const r = await call(undefined, acct.bystander.token, "GET", { client_id: client });
      assert.equal(r.code, 403);
      assert.equal(r.body.requests, undefined);
    });

    test("a client can read their own history", async () => {
      await wipe();
      await call({ client_id: client, reason: "my own tap" }, acct.self.token);
      const r = await call(undefined, acct.self.token, "GET", { client_id: client });
      assert.equal(r.code, 200, JSON.stringify(r.body));
      assert.equal(r.body.requests.length, 1);
      assert.equal(r.body.requests[0].reason, "my own tap");
    });
  });

  // ── one tap is one pull ──────────────────────────────────────────────────

  describe("one tap is one pull", () => {
    test("tapping twice returns the same request and records one credit event", async () => {
      await wipe();
      const a = await call({ client_id: client, reason: "tapped" }, acct.self.token);
      const b = await call({ client_id: client, reason: "tapped again" }, acct.self.token);

      assert.equal(a.body.created, true);
      assert.equal(b.code, 200, "the second tap was an error rather than an acknowledgement");
      assert.equal(b.body.created, false);
      assert.equal(b.body.reason, "already_open");
      assert.equal(b.body.request.id, a.body.request.id);
      assert.equal((await ledgerRows()).length, 1,
        "a double tap recorded two consumer-credit events");
    });

    test("a replayed idempotency_key returns the first request", async () => {
      await wipe();
      const body = { client_id: client, reason: "network retried the POST", idempotency_key: "tap-http-1" };
      const a = await call(body, staff.closer.token);
      const b = await call(body, staff.closer.token);
      assert.equal(a.body.created, true);
      assert.equal(b.body.created, false);
      assert.equal(b.body.reason, "replay");
      assert.equal(b.body.request.id, a.body.request.id);
      assert.equal((await ledgerRows()).length, 1);
    });
  });

  // ── the result lands through ingestCrsResult ─────────────────────────────

  test("a request made through the endpoint is answered through the existing ingest path", async () => {
    // End to end, the thing the whole unit is for: tap → ledger row → a
    // crs_results row arrives → the client's cards are in `tradelines`, written
    // by src/tradelines/store.mjs and nothing else.
    await wipe();
    const posted = await call({
      client_id: client, reason: "closer refreshing the waterfall before the call", cost_cents: 1200
    }, staff.closer.token);
    assert.equal(posted.code, 200, JSON.stringify(posted.body));
    const requestId = posted.body.request.id;

    const crsId = (await db.query(
      `INSERT INTO crs_results (org_id, client_id, result) VALUES ($1,$2,$3) RETURNING id`,
      [org, client, JSON.stringify(CRS_PAYLOAD)])).rows[0].id;

    const out = await fulfilSoftPull(db, { requestId, crsResultId: crsId });
    assert.equal(out.ingested, 2);

    const lines = (await db.query(
      `SELECT lender, credit_limit_cents, balance_cents, apr, source, source_ref
         FROM tradelines WHERE client_id = $1 ORDER BY lender`, [client])).rows;
    assert.equal(lines.length, 2, `tradelines has ${lines.length} rows, not 2`);
    assert.equal(lines[0].lender, "Amex Blue Business");
    assert.equal(lines[0].credit_limit_cents, "1000000");
    assert.equal(lines[0].source, "crs");
    assert.equal(lines[0].source_ref, crsId,
      "the stored card does not point back at the pull that produced it");

    // And the ledger now answers "which pull answered this request".
    const r = await call(undefined, staff.closer.token, "GET", { client_id: client });
    assert.equal(r.code, 200);
    assert.equal(r.body.requests[0].status, "fulfilled");
    assert.equal(r.body.requests[0].crs_result_id, crsId);
    assert.equal(r.body.requests[0].cost_display, "12.00");
  });

  // ── money and unknowns ───────────────────────────────────────────────────

  describe("money crosses the wire as integer cents and unknown stays unknown", () => {
    test("an absent cost is stored as NULL and rendered as null, never as zero", async () => {
      await wipe();
      const r = await call({ client_id: client, reason: "cost not known yet" }, staff.closer.token);
      assert.equal(r.code, 200);
      assert.equal(r.body.request.cost_cents, null);
      assert.equal(r.body.request.cost_display, null,
        "an unknown cost was rendered as a number — a billing screen would read it as free");
      assert.equal((await ledgerRows())[0].cost_cents, null);
    });

    test("a dollars-shaped cost is a 400 and writes no row", async () => {
      // 12.5 from a caller means dollars. Accepting it as cents charges 12 cents
      // for a $12.50 pull, and no error ever surfaces.
      await wipe();
      for (const cost_cents of [12.5, "12.50", 0.99, -100]) {
        const r = await call({ client_id: client, reason: "bad cost", cost_cents }, staff.closer.token);
        assert.equal(r.code, 400, `cost_cents ${cost_cents} returned ${r.code}`);
        assert.equal((await ledgerRows()).length, 0);
      }
    });
  });

  // ── shape ────────────────────────────────────────────────────────────────

  describe("endpoint shape", () => {
    test("methods other than GET and POST are 405, and write nothing", async () => {
      await wipe();
      for (const method of ["PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"]) {
        const r = await call({ client_id: client, reason: "wrong verb" }, staff.closer.token, method);
        assert.equal(r.code, 405, `${method} returned ${r.code}`);
      }
      assert.deepEqual(await ledgerRows(), [],
        "a non-POST verb recorded a credit pull");
    });

    test("GET limit is clamped at both ends rather than reaching LIMIT", async () => {
      // ?limit=-1 reaching Postgres is a 500 carrying "LIMIT must not be
      // negative" — three routes in this repo already shipped exactly that.
      await wipe();
      await call({ client_id: client, reason: "one row to page over" }, staff.closer.token);
      for (const limit of ["-1", "0", "abc", "999999", "-99999999999999999999"]) {
        const r = await call(undefined, staff.closer.token, "GET", { client_id: client, limit });
        assert.equal(r.code, 200, `limit=${limit} returned ${r.code}: ${JSON.stringify(r.body)}`);
        assert.ok(Array.isArray(r.body.requests));
      }
    });

    test("an absent body is a 400, not a crash", async () => {
      await wipe();
      const r = await call(undefined, staff.closer.token);
      assert.equal(r.code, 400);
      assert.equal(r.body.ok, false);
    });
  });
});
