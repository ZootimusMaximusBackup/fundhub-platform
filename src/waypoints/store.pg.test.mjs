// Postgres-backed tests for client_waypoints and paid_service_requests
// (db/migrations/330, 331).
//
// WHY THESE CANNOT BE UNIT TESTS. Every claim below is a claim about what the
// DATABASE refuses, not about what the module refuses. A rule enforced only by
// the module that usually writes is a convention; a CHECK constraint and a
// unique index are controls. So each one is asserted twice: once through the
// store module, and once with a raw INSERT that does not go through it.
//
// Skipped without DATABASE_URL, like every other *.pg.test.mjs. See the trap in
// CLAUDE.md §12: with DATABASE_URL unset these skip and the suite still reports
// zero failures, so a green `npm test` is not evidence any of this ran.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import {
  listWaypoints,
  upsertWaypoint,
  completeWaypoint,
  requestPaidService,
  listPaidServiceRequests,
  nextSelfServeRoundNo,
  isOverdue
} from "./store.mjs";
import { priceDisputeRound } from "./pricing.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const CLIENT_EMAIL_LIKE = "waypoint.pg.test.%@example.com";
const ACCOUNT_EMAIL_LIKE = "waypoint_pg_test_%@example.com";

describe("client waypoints and paid service requests", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, client, accountId;

  async function purge() {
    const ids = (await db.query(`SELECT id FROM clients WHERE email LIKE $1`, [CLIENT_EMAIL_LIKE]))
      .rows.map((r) => r.id);
    if (ids.length) await db.query(`DELETE FROM clients WHERE id = ANY($1)`, [ids]);
    await db.query(`DELETE FROM accounts WHERE email LIKE $1`, [ACCOUNT_EMAIL_LIKE]);
  }

  before(async () => {
    org = await resolveDefaultOrg(db);
    await purge();
    client = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email)
       VALUES ($1,'Waypoint','Subject',$2) RETURNING id`,
      [org, "waypoint.pg.test.subject@example.com"]
    )).rows[0].id;
    // 'invited' needs no password hash (044's accounts_active_needs_hash) and
    // nothing here signs in — the account exists only to be the principal a
    // client-initiated request is attributed to.
    accountId = (await db.query(
      `INSERT INTO accounts (org_id, kind, email, name, status, client_id)
       VALUES ($1,'client',$2,'Waypoint Pgtest Client','invited',$3) RETURNING id`,
      [org, "waypoint_pg_test_acct@example.com", client]
    )).rows[0].id;
  });

  after(async () => {
    await purge();
    await close();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TABLE 1 — client_waypoints
  // ─────────────────────────────────────────────────────────────────────────

  test("a waypoint with no paid alternative stores NULL, and NULL survives the read", async () => {
    const row = await upsertWaypoint(db, {
      orgId: org, clientId: client,
      key: "upload_id", title: "Send us your photo ID", position: 1,
      ownerKind: "client"
    });
    assert.equal(row.paid_alternative_price_cents, null,
      "no paid alternative must be NULL, not 0 — 0 would read as free");
    assert.equal(row.paid_alternative_label, null);

    const back = await listWaypoints(db, { orgId: org, clientId: client });
    const found = back.find((w) => w.key === "upload_id");
    assert.equal(found.paid_alternative_price_cents, null, "NULL must survive the round trip");
  });

  test("a waypoint with a paid alternative stores the price in integer cents", async () => {
    const row = await upsertWaypoint(db, {
      orgId: org, clientId: client,
      key: "mail_round_1", title: "Send round one to the bureaus", position: 2,
      ownerKind: "client",
      paidAlternativePriceCents: 10_000,
      paidAlternativeLabel: "We will do it for you — $100",
      paidAlternativeKind: "dispute_round"
    });
    // pg returns bigint as a string; the value is what matters, not the type.
    assert.equal(String(row.paid_alternative_price_cents), "10000");
    assert.equal(row.paid_alternative_kind, "dispute_round");
  });

  test("the DATABASE refuses a zero price, not just the module", async () => {
    await assert.rejects(
      () => db.query(
        `INSERT INTO client_waypoints (org_id, client_id, key, title, owner_kind, paid_alternative_price_cents)
         VALUES ($1,$2,'free_thing','Free thing','client',0)`,
        [org, client]
      ),
      /client_waypoints_paid_price_ck/,
      "0 must be impossible to store — otherwise a reader cannot tell 'free' from 'no paid alternative'"
    );
  });

  test("the DATABASE refuses a paid label with no price", async () => {
    await assert.rejects(
      () => db.query(
        `INSERT INTO client_waypoints (org_id, client_id, key, title, owner_kind, paid_alternative_label)
         VALUES ($1,$2,'button_no_price','Button with no price','client','Do it for me')`,
        [org, client]
      ),
      /client_waypoints_paid_shape_ck/,
      "a 'do it for me' button with nothing to charge is a broken promise"
    );
  });

  test("the DATABASE refuses done without a completion time, and vice versa", async () => {
    await assert.rejects(
      () => db.query(
        `INSERT INTO client_waypoints (org_id, client_id, key, title, owner_kind, state)
         VALUES ($1,$2,'done_no_time','Done with no time','fundhub','done')`,
        [org, client]
      ),
      /client_waypoints_completed_ck/
    );
    await assert.rejects(
      () => db.query(
        `INSERT INTO client_waypoints (org_id, client_id, key, title, owner_kind, state, completed_at)
         VALUES ($1,$2,'open_with_time','Open with a time','fundhub','in_progress', now())`,
        [org, client]
      ),
      /client_waypoints_completed_ck/
    );
  });

  test("completing a waypoint sets the state and the time together", async () => {
    await upsertWaypoint(db, {
      orgId: org, clientId: client, key: "sign_agreement",
      title: "Sign the agreement", ownerKind: "client", position: 0
    });
    const done = await completeWaypoint(db, { orgId: org, clientId: client, key: "sign_agreement" });
    assert.equal(done.state, "done");
    assert.ok(done.completed_at, "completed_at must be stamped");
  });

  test("overdue is computed from a real date, and a missing due date is never overdue", async () => {
    const past = new Date(Date.now() - 86_400_000);
    await upsertWaypoint(db, {
      orgId: org, clientId: client, key: "overdue_step",
      title: "A step that is late", ownerKind: "client", position: 9, dueAt: past
    });
    const rows = await listWaypoints(db, { orgId: org, clientId: client });
    const late = rows.find((w) => w.key === "overdue_step");
    const noDate = rows.find((w) => w.key === "upload_id");
    assert.equal(late.overdue, true);
    assert.equal(noDate.due_at, null);
    assert.equal(noDate.overdue, false, "no due date means nobody set one — not that it is late");

    // A finished waypoint is never overdue, however old its due date.
    assert.equal(isOverdue({ due_at: past, state: "done" }), false);
    assert.equal(isOverdue({ due_at: past, state: "skipped" }), false);
  });

  test("one waypoint per key per client — re-running the builder does not double the list", async () => {
    const before = (await listWaypoints(db, { orgId: org, clientId: client })).length;
    await upsertWaypoint(db, {
      orgId: org, clientId: client, key: "upload_id",
      title: "Send us your photo ID (updated wording)", ownerKind: "client", position: 1
    });
    const after = await listWaypoints(db, { orgId: org, clientId: client });
    assert.equal(after.length, before, "an upsert on the same key must not add a row");
    assert.equal(
      after.find((w) => w.key === "upload_id").title,
      "Send us your photo ID (updated wording)"
    );
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TABLE 2 — paid_service_requests
  // ─────────────────────────────────────────────────────────────────────────

  test("the owner-set price is stored as itemised lines that sum to the total", async () => {
    const { components, totalCents } = priceDisputeRound({
      creditorLetter: true,
      escalationFilings: true
    });
    assert.equal(totalCents, 13_000, "$100 + $10 + $20");

    const { created, request } = await requestPaidService(db, {
      orgId: org, clientId: client,
      serviceKind: "dispute_round",
      requestedByKind: "client",
      requestedByAccountId: accountId,
      components,
      roundNo: 1,
      idempotencyKey: "waypoint-pg-test-round-1"
    });
    assert.equal(created, true);
    assert.equal(String(request.price_total_cents), "13000");
    assert.equal(request.price_components.length, 3);
    assert.deepEqual(
      request.price_components.map((c) => c.code),
      ["round_base", "creditor_letter", "escalation_filings"]
    );
  });

  test("the DATABASE refuses a total that disagrees with its own lines", async () => {
    await assert.rejects(
      () => db.query(
        `INSERT INTO paid_service_requests
           (org_id, client_id, service_kind, requested_by_kind, requested_by_account_id,
            price_components, price_total_cents)
         VALUES ($1,$2,'dispute_round','client',$3,
                 '[{"code":"round_base","amount_cents":10000}]'::jsonb, 13000)`,
        [org, client, accountId]
      ),
      /paid_service_requests_total_ck/,
      "a receipt whose lines do not add up to its total must never be storable"
    );
  });

  test("the DATABASE refuses a malformed line item", async () => {
    await assert.rejects(
      () => db.query(
        `INSERT INTO paid_service_requests
           (org_id, client_id, service_kind, requested_by_kind, requested_by_account_id,
            price_components, price_total_cents)
         VALUES ($1,$2,'dispute_round','client',$3,
                 '[{"label":"no code here","amount_cents":10000}]'::jsonb, 10000)`,
        [org, client, accountId]
      ),
      /paid_service_requests_total_ck/,
      "a line with no code makes the total function return NULL, which fails the check"
    );
  });

  test("a double press is one row", async () => {
    const { components } = priceDisputeRound({});
    const key = "waypoint-pg-test-double-press";
    const first = await requestPaidService(db, {
      orgId: org, clientId: client, serviceKind: "dispute_round",
      requestedByKind: "client", requestedByAccountId: accountId,
      components, roundNo: 2, idempotencyKey: key
    });
    const second = await requestPaidService(db, {
      orgId: org, clientId: client, serviceKind: "dispute_round",
      requestedByKind: "client", requestedByAccountId: accountId,
      components, roundNo: 3, idempotencyKey: key
    });
    assert.equal(first.created, true);
    assert.equal(second.created, false, "the second press must not create a row");
    assert.equal(second.request.id, first.request.id, "it is handed the row that won");

    const rows = (await db.query(
      `SELECT id FROM paid_service_requests WHERE org_id = $1 AND idempotency_key = $2`,
      [org, key]
    )).rows;
    assert.equal(rows.length, 1, "exactly one row in the table for one idempotency key");
  });

  test("an unpriced request stores NULL, which is not zero and not free", async () => {
    const { request } = await requestPaidService(db, {
      orgId: org, clientId: client, serviceKind: "credit_pull",
      requestedByKind: "client", requestedByAccountId: accountId,
      components: [], idempotencyKey: "waypoint-pg-test-unpriced"
    });
    assert.equal(request.price_total_cents, null);
    assert.deepEqual(request.price_components, []);
  });

  test("the DATABASE refuses an unattributed request", async () => {
    await assert.rejects(
      () => db.query(
        `INSERT INTO paid_service_requests (org_id, client_id, service_kind, requested_by_kind)
         VALUES ($1,$2,'dispute_round','client')`,
        [org, client]
      ),
      /paid_service_requests_requester_ck/
    );
  });

  test("the DATABASE refuses a fulfilled request that cannot say what it produced", async () => {
    await assert.rejects(
      () => db.query(
        `INSERT INTO paid_service_requests
           (org_id, client_id, service_kind, requested_by_kind, requested_by_account_id,
            status, paid_at, amount_paid_cents, resolved_at)
         VALUES ($1,$2,'dispute_round','client',$3,'fulfilled', now(), 10000, now())`,
        [org, client, accountId]
      ),
      /paid_service_requests_fulfilled_ck/
    );
  });

  test("a paid round does not consume a purchased round — two counters, no link", async () => {
    // The program's cap is its own number and nothing here touches it.
    await db.query(
      `INSERT INTO repair_programs (org_id, client_id, program, rounds_cap, price_total)
       VALUES ($1,$2,'trial',2,200)
       ON CONFLICT (org_id, client_id) DO UPDATE SET rounds_cap = 2`,
      [org, client]
    );
    const capBefore = (await db.query(
      `SELECT rounds_cap FROM repair_programs WHERE org_id=$1 AND client_id=$2`, [org, client]
    )).rows[0].rounds_cap;

    const next = await nextSelfServeRoundNo(db, { clientId: client });
    await requestPaidService(db, {
      orgId: org, clientId: client, serviceKind: "dispute_round",
      requestedByKind: "client", requestedByAccountId: accountId,
      components: priceDisputeRound({}).components,
      roundNo: next,
      idempotencyKey: `waypoint-pg-test-extra-round-${next}`
    });

    const capAfter = (await db.query(
      `SELECT rounds_cap FROM repair_programs WHERE org_id=$1 AND client_id=$2`, [org, client]
    )).rows[0].rounds_cap;
    assert.equal(capAfter, capBefore, "buying a round must not move repair_programs.rounds_cap");

    // And there is no column joining the two counters, so nothing can conflate
    // them later by accident.
    const cols = (await db.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='paid_service_requests'`
    )).rows.map((r) => r.column_name);
    assert.equal(
      cols.some((c) => /repair_program|rounds_cap/.test(c)), false,
      "paid_service_requests must not reference the program's round cap"
    );

    const history = await listPaidServiceRequests(db, { orgId: org, clientId: client });
    assert.ok(history.length >= 3, "the client's paid history reads back");
  });

  test("the self-serve round number is a real sequence, not a COUNT", async () => {
    const next = await nextSelfServeRoundNo(db, { clientId: client });
    const maxSoFar = (await db.query(
      `SELECT COALESCE(MAX(round_no),0) AS m FROM paid_service_requests WHERE client_id=$1`,
      [client]
    )).rows[0].m;
    assert.equal(next, Number(maxSoFar) + 1);

    // The same round number cannot be issued twice to one client.
    await assert.rejects(
      () => db.query(
        `INSERT INTO paid_service_requests
           (org_id, client_id, service_kind, requested_by_kind, requested_by_account_id, round_no)
         VALUES ($1,$2,'dispute_round','client',$3,1)`,
        [org, client, accountId]
      ),
      /uq_paid_service_requests_round_no/
    );
  });
});
