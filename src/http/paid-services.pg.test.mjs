// Postgres-backed tests for /api/paid-services — the door a client actually
// knocks on.
//
// THIS FILE LIVES UNDER src/http/, NOT NEXT TO THE HANDLER. package.json's test
// glob is "src/**" and "scripts/**"; a test placed in api/ is never collected
// and passes forever by never running (CLAUDE.md §12). Same arrangement, and
// the same reason, as src/http/finance-soft-pull.pg.test.mjs.
//
// WHAT THIS PINS THAT THE MODULE TESTS CANNOT.
// src/paid-services/round.pg.test.mjs proves the module refuses the right
// things. This file answers the different question: can a CALLER get a charge
// raised anyway — with no session, with the wrong kind of session, by naming
// somebody else in the body, or by pointing a client's session at another
// client's file? Each of those ends with a client billed for work on a file
// that is not theirs.
//
// SO THE ASSERTIONS ARE AGAINST paid_service_requests, NOT AGAINST THE
// RESPONSE. A response is the endpoint's account of what it did; the row is
// what it did.
//
// Skipped without DATABASE_URL like every other *.pg.test.mjs.

import { test, before, after, beforeEach, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { createSession } from "../auth/session.mjs";
import { createAccountSession } from "../auth/account-session.mjs";
import { captureConsent } from "../consent/index.mjs";
import handler from "../../api/paid-services.mjs";
import { REFUSAL } from "../paid-services/refusals.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const CLIENT_EMAIL_LIKE = "psvc.http.%@example.com";
const ACCT_EMAIL_LIKE = "psvc_http_acct_%@example.com";
const STAFF_EMAIL_LIKE = "psvc_http_%@example.com";
const FOREIGN_ORG_SLUG = "psvc-http-other-co";

const DIRTY_REPORT = {
  tradelines: [
    { creditorName: "Midtown Bank", accountNumber: "H-1", status: "Charge-off", balance: 900 }
  ],
  publicRecords: []
};

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; return r; };
  return r;
};

describe("/api/paid-services", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, client, bystander, foreignOrg, foreignClient;
  const staff = {};
  const acct = {};

  /* Counts the calls, because the call count is the number of checkout pages a
     client could be charged on. Everything else in the path is real. */
  function mintCounter() {
    const calls = [];
    const fn = async (args) => {
      calls.push(args);
      return { ok: true, checkoutUrl: `https://pay.example.test/${args.requestId}`, sessionId: "s1" };
    };
    fn.calls = calls;
    return fn;
  }
  let mint;

  const call = async ({ method = "GET", body = undefined, token, query = {}, headers = {} } = {}) => {
    const r = res();
    await handler(
      {
        method, query, body,
        headers: { ...(token ? { authorization: "Bearer " + token } : {}), ...headers }
      },
      r,
      { mintFn: mint }
    );
    return r;
  };

  const rows = async (id = client) => (await db.query(
    `SELECT * FROM paid_service_requests WHERE client_id = $1::uuid ORDER BY requested_at`, [id]
  )).rows;

  async function purge() {
    const ids = (await db.query(`SELECT id FROM clients WHERE email LIKE $1`, [CLIENT_EMAIL_LIKE]))
      .rows.map((r) => r.id);
    if (ids.length) {
      await db.query(`DELETE FROM paid_service_requests WHERE client_id = ANY($1)`, [ids]);
      await db.query(`DELETE FROM soft_pull_requests WHERE client_id = ANY($1)`, [ids]);
      await db.query(`DELETE FROM clients WHERE id = ANY($1)`, [ids]);
    }
    await db.query(`DELETE FROM accounts WHERE email LIKE $1`, [ACCT_EMAIL_LIKE]);
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [STAFF_EMAIL_LIKE]);
    await db.query(`DELETE FROM orgs WHERE slug = $1`, [FOREIGN_ORG_SLUG]);
  }

  async function makeClient(orgId, label, { tier = "REPAIR_ONLY" } = {}) {
    const id = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email, outcome_tier)
       VALUES ($1,'Psvc',$2,$3,$4) RETURNING id`,
      [orgId, label, `psvc.http.${label}@example.com`, tier]
    )).rows[0].id;
    await db.query(
      `INSERT INTO crs_results (org_id, client_id, result) VALUES ($1,$2,$3::jsonb)`,
      [orgId, id, JSON.stringify(DIRTY_REPORT)]
    );
    return id;
  }

  before(async () => {
    org = await resolveDefaultOrg(db);
    await purge();

    for (const role of ["owner", "closer"]) {
      const id = (await db.query(
        `INSERT INTO staff (org_id, name, role, email, status)
         VALUES ($1,$2,$3,$4,'active') RETURNING id`,
        [org, `Psvc Http ${role}`, role, `psvc_http_${role}@example.com`]
      )).rows[0].id;
      staff[role] = { id, token: (await createSession(db, { staffId: id, orgId: org })).token };
    }

    client = await makeClient(org, "subject");
    bystander = await makeClient(org, "bystander");

    foreignOrg = (await db.query(
      `INSERT INTO orgs (slug, name) VALUES ($1,'Psvc Http Other Co') RETURNING id`,
      [FOREIGN_ORG_SLUG]
    )).rows[0].id;
    foreignClient = await makeClient(foreignOrg, "otherco");

    for (const [label, subject] of [["self", client], ["bystander", bystander]]) {
      const id = (await db.query(
        `INSERT INTO accounts (org_id, kind, email, name, status, client_id, password_hash)
         VALUES ($1,'client',$2,$3,'active',$4,'scrypt$placeholder') RETURNING id`,
        [org, `psvc_http_acct_${label}@example.com`, `Psvc Acct ${label}`, subject]
      )).rows[0].id;
      acct[label] = { id, token: (await createAccountSession(db, { accountId: id, orgId: org })).token };
    }

    for (const subject of [client, bystander, foreignClient]) {
      const subjectOrg = subject === foreignClient ? foreignOrg : org;
      await captureConsent(db, {
        orgId: subjectOrg, clientId: subject, kind: "soft_pull_consent",
        consentText: "I authorize Fundhub to obtain my consumer credit report through a soft inquiry.",
        consentVersion: "soft-pull-v1",
        grantedBy: { kind: "staff", id: staff.owner.id },
        captureMethod: "checkbox"
      });
    }
  });

  beforeEach(async () => {
    mint = mintCounter();
    await db.query(
      `DELETE FROM paid_service_requests WHERE client_id = ANY($1)`,
      [[client, bystander, foreignClient]]
    );
  });

  after(async () => { await purge(); await close(); });

  // ── nobody unauthenticated can raise a charge ─────────────────────────────

  describe("a charge cannot be raised without a session", () => {
    test("no token is a 401 and writes NO row and mints NO link", async () => {
      const r = await call({ method: "POST", body: { client_id: client } });
      assert.equal(r.code, 401);
      assert.deepEqual(await rows(), []);
      assert.equal(mint.calls.length, 0);
    });

    test("a forged token is a 401 and writes no row", async () => {
      for (const token of ["", "not-a-token", "0".repeat(43)]) {
        const r = await call({ method: "POST", body: { client_id: client }, token });
        assert.equal(r.code, 401, `token ${JSON.stringify(token)} returned ${r.code}`);
      }
      assert.deepEqual(await rows(), []);
      assert.equal(mint.calls.length, 0);
    });

    test("an unsupported method is refused before anything is read", async () => {
      const r = await call({ method: "DELETE", token: staff.owner.token, query: { client_id: client } });
      assert.equal(r.code, 405);
      assert.equal(r.headers.allow, "GET, POST");
    });
  });

  // ── a client is pinned to their own file ──────────────────────────────────

  describe("a client is pinned to their own file", () => {
    test("naming somebody else in the body is a 403 and bills nobody", async () => {
      const r = await call({
        method: "POST", token: acct.self.token, body: { client_id: bystander }
      });
      assert.equal(r.code, 403);
      assert.deepEqual(await rows(bystander), [],
        "one client's press wrote a paid request against another client's file");
      assert.equal(mint.calls.length, 0);
    });

    test("naming somebody else on a GET is a 403 too", async () => {
      const r = await call({ token: acct.self.token, query: { client_id: bystander } });
      assert.equal(r.code, 403);
    });

    test("a client's own press is attributed to their ACCOUNT, not to a staff member", async () => {
      const r = await call({ method: "POST", token: acct.self.token, body: {} });
      assert.equal(r.code, 201, JSON.stringify(r.body));
      const [row] = await rows();
      assert.equal(row.requested_by_kind, "client");
      assert.equal(row.requested_by_account_id, acct.self.id);
      assert.equal(row.requested_by_staff_id, null);
    });
  });

  // ── staff ─────────────────────────────────────────────────────────────────

  describe("staff", () => {
    test("must name a client", async () => {
      const r = await call({ method: "POST", token: staff.owner.token, body: {} });
      assert.equal(r.code, 400);
      assert.equal(r.body.error, "client_id_required");
    });

    test("a client id that is not a uuid is refused before any read", async () => {
      const r = await call({
        method: "POST", token: staff.owner.token, body: { client_id: "'; DROP TABLE clients; --" }
      });
      assert.equal(r.code, 400);
      assert.equal(r.body.error, "invalid_client_id");
    });

    test("another company's client is a 404 and bills nobody", async () => {
      const r = await call({
        method: "POST", token: staff.owner.token, body: { client_id: foreignClient }
      });
      assert.equal(r.code, 404);
      assert.deepEqual(await rows(foreignClient), []);
      assert.equal(mint.calls.length, 0);
    });

    test("a press is attributed to the STAFF member who made it", async () => {
      const r = await call({
        method: "POST", token: staff.closer.token, body: { client_id: client }
      });
      assert.equal(r.code, 201, JSON.stringify(r.body));
      const [row] = await rows();
      assert.equal(row.requested_by_kind, "staff");
      assert.equal(row.requested_by_staff_id, staff.closer.id);
      assert.equal(row.requested_by_account_id, null);
    });
  });

  // ── the read ──────────────────────────────────────────────────────────────

  describe("GET — the price list", () => {
    test("returns the three components in cents, and buys nothing", async () => {
      const r = await call({ token: acct.self.token });
      assert.equal(r.code, 200, JSON.stringify(r.body));
      const [svc] = r.body.services;
      assert.equal(svc.serviceKey, "paid_round");
      assert.equal(svc.available, true);
      assert.equal(svc.inFlight, false);
      assert.deepEqual(svc.components.map((c) => c.key), ["base", "creditor", "cfpb_and_ag"]);
      assert.deepEqual(svc.components.map((c) => c.priceCents), [10_000, 1_000, 2_000]);
      assert.deepEqual(await rows(), [], "a read wrote a row");
      assert.equal(mint.calls.length, 0, "a read minted a checkout link");
    });

    test("inFlight is true once a request is open", async () => {
      await call({ method: "POST", token: acct.self.token, body: {} });
      const r = await call({ token: acct.self.token });
      const [svc] = r.body.services;
      assert.equal(svc.inFlight, true);
      assert.equal(svc.available, false);
      assert.equal(svc.unavailableReason, REFUSAL.ALREADY_IN_FLIGHT);
    });
  });

  // ── the write ─────────────────────────────────────────────────────────────

  describe("POST — one press, one row, one link", () => {
    test("201 with a checkout link, and the row says nothing has been paid", async () => {
      const r = await call({ method: "POST", token: acct.self.token, body: {} });
      assert.equal(r.code, 201);
      assert.equal(r.body.created, true);
      assert.ok(r.body.checkout_url);
      assert.equal(r.body.request.status, "awaiting_payment");
      assert.equal(r.body.request.price_total_cents, "10000");
      assert.equal(r.body.request.amount_paid_cents, null,
        "the response reports money paid on a request nobody has paid");
      assert.equal(r.body.request.paid_at, null);
      assert.equal(mint.calls.length, 1);
    });

    test("the add-ons change the price the client is asked for", async () => {
      const r = await call({
        method: "POST", token: acct.self.token,
        body: { creditor_letter: true, escalation_filings: true }
      });
      assert.equal(r.body.request.price_total_cents, "13000");
      assert.equal(mint.calls[0].amountCents, 13_000);
    });

    test("the response never leaks the replay key or the processor's reference", async () => {
      const r = await call({ method: "POST", token: acct.self.token, body: {} });
      assert.equal(r.body.request.idempotency_key, undefined);
      assert.equal(r.body.request.payment_ref, undefined);
    });

    test("a second press over HTTP is a 409 and mints no second link", async () => {
      const first = await call({ method: "POST", token: acct.self.token, body: {} });
      const second = await call({ method: "POST", token: acct.self.token, body: {} });
      assert.equal(first.code, 201);
      assert.equal(second.code, 409);
      assert.equal(second.body.error, REFUSAL.ALREADY_IN_FLIGHT);
      assert.equal((await rows()).length, 1);
      assert.equal(mint.calls.length, 1,
        `${mint.calls.length} checkout pages exist for one client who pressed twice`);
    });

    test("ten simultaneous HTTP presses are one row and one link", async () => {
      const out = await Promise.all(
        Array.from({ length: 10 }, () => call({ method: "POST", token: acct.self.token, body: {} }))
      );
      assert.equal((await rows()).length, 1,
        "ten presses of one button wrote more than one billable row");
      assert.equal(mint.calls.length, 1);
      assert.equal(out.filter((r) => r.code === 201).length, 1,
        "more than one press was told it had created the request");
    });

    test("an unknown service is refused", async () => {
      const r = await call({
        method: "POST", token: acct.self.token, body: { service: "free_money" }
      });
      assert.equal(r.code, 400);
      assert.equal(r.body.error, "unknown_service");
      assert.deepEqual(await rows(), []);
    });

    test("a client not on an offer path that permits it gets a 403 and no charge", async () => {
      await db.query(`UPDATE clients SET outcome_tier = 'ACADEMY' WHERE id = $1`, [client]);
      try {
        const r = await call({ method: "POST", token: acct.self.token, body: {} });
        assert.equal(r.code, 403);
        assert.equal(r.body.error, REFUSAL.NOT_ON_OFFER_PATH);
        assert.deepEqual(await rows(), []);
        assert.equal(mint.calls.length, 0);
      } finally {
        await db.query(`UPDATE clients SET outcome_tier = 'REPAIR_ONLY' WHERE id = $1`, [client]);
      }
    });

    test("the processor being down is a 502 that says nothing was charged", async () => {
      mint = async () => ({ ok: false, reason: "checkout_unreachable: simulated" });
      const r = await call({ method: "POST", token: acct.self.token, body: {} });
      assert.equal(r.code, 502);
      assert.equal(r.body.error, REFUSAL.PAYMENT_FAILED);
      assert.match(r.body.message, /nothing has been charged/i);
      const [row] = await rows();
      assert.equal(row.status, "failed");
      assert.equal(row.paid_at, null);
    });
  });

  // ── the owner-set branding guardrail, at the edge a client reads ──────────

  test("no message this endpoint returns contains the banned phrase", async () => {
    const seen = [];
    seen.push((await call({ method: "POST", token: acct.self.token, body: { service: "nope" } })).body);
    seen.push((await call({ method: "POST", token: acct.self.token, body: {} })).body);
    seen.push((await call({ method: "POST", token: acct.self.token, body: {} })).body);
    seen.push((await call({ token: acct.self.token })).body);
    for (const body of seen) {
      const text = JSON.stringify(body).toLowerCase();
      assert.ok(!text.includes("credit repair"),
        `a client-facing response carried banned wording: ${JSON.stringify(body).slice(0, 300)}`);
    }
  });
});
