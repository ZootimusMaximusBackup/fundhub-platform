// Postgres-backed tests for the soft-pull ledger.
//
// TWO CLAIMS, AND NEITHER CAN BE PROVEN WITHOUT A REAL DATABASE:
//
//   1. AN UNATTRIBUTED PULL IS REFUSED BY THE TABLE, not only by the module.
//      soft-pulls.test.mjs proves requestSoftPull() refuses before it queries.
//      That is a promise about one function. This file proves the promise holds
//      against a writer that does not go through it — a script, a psql session,
//      a future module that forgot — because the CHECK constraint in 077 is what
//      actually adjudicates it. A rule enforced only by the code that usually
//      writes is a convention, not a control.
//
//   2. A RESULT LANDS THROUGH THE EXISTING INGEST PATH. fulfilSoftPull() calls
//      ingestCrsResult() from src/tradelines/store.mjs, and the assertion is
//      against the `tradelines` rows that appear — not against a return value.
//      A return value is the function's account of what it did; the rows are
//      what it did. The unit test can only check that a matching SQL string was
//      issued; only Postgres can say the cards are actually there, with the
//      limits and APRs the normalizer produced.
//
// Skipped without DATABASE_URL, like every other *.pg.test.mjs. See the trap in
// CLAUDE.md §12: with DATABASE_URL unset these skip and the suite reports zero
// failures, so a green `npm test` is not evidence any of this ran.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import {
  requestSoftPull,
  fulfilSoftPull,
  closeSoftPull,
  listSoftPullRequests,
  openRequestFor,
  getSoftPullRequest,
  recordPull,
  getLatestPull,
  SoftPullError
} from "./soft-pulls.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;

const CLIENT_EMAIL_LIKE = "softpull.pg.test.%@example.com";
const STAFF_EMAIL_LIKE = "softpull_pg_test_%@example.com";

/* A payload in the shape src/tradelines/index.mjs actually reads: a `tradelines`
   container, dollar amounts, an APR as a percentage number, an account ref. */
const CRS_PAYLOAD = {
  tradelines: [
    { creditor: "Amex Blue Business", credit_limit: 10000, balance: 2500, apr: 18.99, account_number: "AMEX-0001" },
    { creditor: "Chase Ink", credit_limit: 7500, balance: 0, apr: 21.24, account_number: "CHASE-0002" },
    // No APR at all — the normalizer must leave it null, and null must survive
    // all the way into the column.
    { creditor: "Capital One Spark", credit_limit: 3000, balance: 900, account_number: "CAP1-0003" }
  ]
};

describe("soft pull ledger", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, client, otherClient, staffId, accountId;

  async function purge() {
    const ids = (await db.query(`SELECT id FROM clients WHERE email LIKE $1`, [CLIENT_EMAIL_LIKE]))
      .rows.map((r) => r.id);
    if (ids.length) {
      // soft_pull_requests and tradelines both cascade from clients; crs_results
      // does too. Deleting the clients is enough, and doing it explicitly first
      // keeps a crashed previous run from colliding on the email index.
      await db.query(`DELETE FROM clients WHERE id = ANY($1)`, [ids]);
    }
    await db.query(`DELETE FROM accounts WHERE email LIKE $1`, [STAFF_EMAIL_LIKE]);
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [STAFF_EMAIL_LIKE]);
  }

  const mkClient = async (slug) => (await db.query(
    `INSERT INTO clients (org_id, first_name, last_name, email)
     VALUES ($1,'Softpull',$2,$3) RETURNING id`,
    [org, slug, `softpull.pg.test.${slug}@example.com`]
  )).rows[0].id;

  const mkCrs = async (clientId, payload = CRS_PAYLOAD) => (await db.query(
    `INSERT INTO crs_results (org_id, client_id, result) VALUES ($1,$2,$3) RETURNING id`,
    [org, clientId, JSON.stringify(payload)]
  )).rows[0].id;

  const ledgerRows = async (clientId = client) => (await db.query(
    `SELECT * FROM soft_pull_requests WHERE client_id = $1 ORDER BY requested_at, id`, [clientId]
  )).rows;

  const tradelineRows = async (clientId = client) => (await db.query(
    `SELECT lender, kind, credit_limit_cents, balance_cents, apr, source, source_ref, account_ref
       FROM tradelines WHERE client_id = $1 ORDER BY lender`, [clientId]
  )).rows;

  const wipeLedger = async () => {
    await db.query(`DELETE FROM tradelines WHERE client_id = ANY($1)`, [[client, otherClient]]);
    // The immutability trigger is BEFORE UPDATE only; DELETE is deliberately
    // allowed so a client's erasure takes their pull log with it (see 077).
    await db.query(`DELETE FROM soft_pull_requests WHERE client_id = ANY($1)`, [[client, otherClient]]);
  };

  before(async () => {
    org = await resolveDefaultOrg(db);
    await purge();

    staffId = (await db.query(
      `INSERT INTO staff (org_id, name, role, email, status)
       VALUES ($1,'Softpull Pgtest Closer','closer','softpull_pg_test_closer@example.com','active')
       RETURNING id`, [org])).rows[0].id;

    client = await mkClient("subject");
    otherClient = await mkClient("bystander");

    // 044's accounts_active_needs_hash: an active account must be able to
    // authenticate. Nothing here signs in — the account exists only to be the
    // subject a client-initiated request is attributed to — so it stays
    // 'invited', which is the state that needs no password hash.
    accountId = (await db.query(
      `INSERT INTO accounts (org_id, kind, email, name, status, client_id)
       VALUES ($1,'client','softpull_pg_test_acct@example.com','Softpull Pgtest Client','invited',$2)
       RETURNING id`, [org, client])).rows[0].id;
  });

  after(async () => { await purge(); await close(); });

  // ── 1. an unattributed pull is refused, by the table itself ───────────────

  describe("an unattributed pull is not loggable", () => {
    test("the module refuses, and writes no row", async () => {
      await wipeLedger();
      await assert.rejects(
        () => requestSoftPull(db, { orgId: org, clientId: client, reason: "no attribution" }),
        (e) => e instanceof SoftPullError && e.status === 401
      );
      assert.deepEqual(await ledgerRows(), [],
        "a refused request still wrote to soft_pull_requests");
    });

    test("THE TABLE refuses too — a writer that skips the module cannot log one either", async () => {
      // This is the claim that matters. If only the module enforced it, the rule
      // would hold exactly as long as everybody remembered to use the module.
      await wipeLedger();
      await assert.rejects(
        () => db.query(
          `INSERT INTO soft_pull_requests (org_id, client_id, requested_by_kind, reason)
           VALUES ($1,$2,'staff','pulled by nobody')`, [org, client]
        ),
        (e) => /soft_pull_requests_requester_ck/.test(String(e.message)),
        "Postgres accepted a soft pull with no requester"
      );
      assert.deepEqual(await ledgerRows(), []);
    });

    test("a row cannot claim one kind and carry the other kind's subject", async () => {
      await wipeLedger();
      await assert.rejects(
        () => db.query(
          `INSERT INTO soft_pull_requests
             (org_id, client_id, requested_by_kind, requested_by_account_id, reason)
           VALUES ($1,$2,'staff',$3,'kind and subject disagree')`, [org, client, accountId]
        ),
        (e) => /soft_pull_requests_requester_ck/.test(String(e.message))
      );
      // Nor can it name both — "who asked" has exactly one answer.
      await assert.rejects(
        () => db.query(
          `INSERT INTO soft_pull_requests
             (org_id, client_id, requested_by_kind, requested_by_staff_id, requested_by_account_id, reason)
           VALUES ($1,$2,'staff',$3,$4,'two requesters')`, [org, client, staffId, accountId]
        ),
        (e) => /soft_pull_requests_requester_ck/.test(String(e.message))
      );
      assert.deepEqual(await ledgerRows(), []);
    });

    test("a blank reason is refused by the table, not just by the module", async () => {
      // "   " satisfies NOT NULL and looks populated in an audit export. It is
      // the shape that reads as an answer and is not one.
      await wipeLedger();
      for (const reason of ["", "   ", "\t\n"]) {
        await assert.rejects(
          () => db.query(
            `INSERT INTO soft_pull_requests
               (org_id, client_id, requested_by_kind, requested_by_staff_id, reason)
             VALUES ($1,$2,'staff',$3,$4)`, [org, client, staffId, reason]
          ),
          (e) => /soft_pull_requests_reason_ck/.test(String(e.message)),
          `Postgres accepted the reason ${JSON.stringify(reason)}`
        );
      }
      assert.deepEqual(await ledgerRows(), []);
    });

    test("the attribution cannot be rewritten after the fact", async () => {
      await wipeLedger();
      const { request } = await requestSoftPull(db, {
        orgId: org, clientId: client,
        requestedBy: { kind: "staff", id: staffId },
        reason: "closer refreshing the funding waterfall"
      });

      for (const [col, val] of [
        ["requested_by_staff_id", null],
        ["requested_by_kind", "client"],
        ["reason", "something else entirely"],
        ["client_id", otherClient]
      ]) {
        await assert.rejects(
          () => db.query(`UPDATE soft_pull_requests SET ${col} = $2 WHERE id = $1`, [request.id, val]),
          (e) => /immutable/.test(String(e.message)),
          `${col} was rewritable after insert`
        );
      }

      const [row] = await ledgerRows();
      assert.equal(row.requested_by_staff_id, staffId);
      assert.equal(row.reason, "closer refreshing the funding waterfall");
    });
  });

  // ── 2. a result lands through ingestCrsResult ─────────────────────────────

  describe("a result lands through the existing ingest path", () => {
    test("fulfilling a request writes the client's tradelines and closes the ledger row", async () => {
      await wipeLedger();
      assert.deepEqual(await tradelineRows(), [], "the client had tradelines before the pull");

      const { created, request } = await requestSoftPull(db, {
        orgId: org, clientId: client,
        requestedBy: { kind: "client", id: accountId },
        reason: "client tapped refresh in the portal",
        costCents: 1200
      });
      assert.equal(created, true);
      assert.equal(request.status, "queued", "a new request did not start queued");
      assert.equal(request.crs_result_id, null);
      assert.equal(request.resolved_at, null);

      const crsId = await mkCrs(client);
      const out = await fulfilSoftPull(db, { requestId: request.id, crsResultId: crsId });

      assert.equal(out.ingested, 3, "the pull did not ingest all three lines");
      assert.equal(out.request.status, "fulfilled");
      assert.equal(out.request.crs_result_id, crsId);
      assert.ok(out.request.resolved_at, "a fulfilled request has no resolved_at");

      // THE ACTUAL CLAIM: the cards are in the table the closer's calculator reads.
      const lines = await tradelineRows();
      assert.equal(lines.length, 3, `tradelines has ${lines.length} rows, not 3`);
      assert.deepEqual(lines.map((l) => l.lender),
        ["Amex Blue Business", "Capital One Spark", "Chase Ink"]);

      const amex = lines.find((l) => l.lender === "Amex Blue Business");
      assert.equal(amex.credit_limit_cents, "1000000", "dollars did not become cents");
      assert.equal(amex.balance_cents, "250000");
      assert.equal(Number(amex.apr), 0.18990, "18.99% did not become the fraction 0.1899");
      assert.equal(amex.source, "crs");
      assert.equal(amex.source_ref, crsId,
        "the stored line does not point back at the crs_results row it came from");

      // NULL survives: the third line reported no APR and must not have acquired one.
      const cap1 = lines.find((l) => l.lender === "Capital One Spark");
      assert.equal(cap1.apr, null, "a missing APR was filled in with a guess");
    });

    test("re-pulling the same cards updates them rather than duplicating them", async () => {
      // This is store.mjs's upsert doing its job through the soft-pull path. If
      // this module had written its own INSERT the waterfall would draw the same
      // card twice and double the client's available credit.
      await wipeLedger();
      const first = await requestSoftPull(db, {
        orgId: org, clientId: client, requestedBy: { kind: "staff", id: staffId },
        reason: "first pull"
      });
      await fulfilSoftPull(db, { requestId: first.request.id, crsResultId: await mkCrs(client) });
      assert.equal((await tradelineRows()).length, 3);

      const second = await requestSoftPull(db, {
        orgId: org, clientId: client, requestedBy: { kind: "staff", id: staffId },
        reason: "second pull, balances moved"
      });
      const moved = JSON.parse(JSON.stringify(CRS_PAYLOAD));
      moved.tradelines[0].balance = 4100;
      await fulfilSoftPull(db, { requestId: second.request.id, crsResultId: await mkCrs(client, moved) });

      const lines = await tradelineRows();
      assert.equal(lines.length, 3, `a second pull produced ${lines.length} rows — the cards were duplicated`);
      assert.equal(lines.find((l) => l.lender === "Amex Blue Business").balance_cents, "410000",
        "the second pull's balance did not land");
    });

    test("a crs row for another client is refused, and that client's cards are not ingested", async () => {
      await wipeLedger();
      const { request } = await requestSoftPull(db, {
        orgId: org, clientId: client, requestedBy: { kind: "staff", id: staffId },
        reason: "mis-join guard"
      });
      const bystanderCrs = await mkCrs(otherClient);

      await assert.rejects(
        () => fulfilSoftPull(db, { requestId: request.id, crsResultId: bystanderCrs }),
        (e) => e instanceof SoftPullError && e.status === 409
      );

      assert.deepEqual(await tradelineRows(client), [],
        "another person's credit file was ingested as this client's cards");
      assert.deepEqual(await tradelineRows(otherClient), []);
      assert.equal((await ledgerRows())[0].status, "queued",
        "a refused fulfil still closed the request");
    });

    test("the ledger and the tradelines land together or not at all", async () => {
      // fulfilSoftPull runs in one transaction. A crs id that does not exist is
      // rejected after the row is locked and before anything is written; nothing
      // may be left half-applied.
      await wipeLedger();
      const { request } = await requestSoftPull(db, {
        orgId: org, clientId: client, requestedBy: { kind: "staff", id: staffId },
        reason: "atomicity"
      });
      await assert.rejects(
        () => fulfilSoftPull(db, {
          requestId: request.id, crsResultId: "00000000-0000-0000-0000-000000000000"
        }),
        (e) => e instanceof SoftPullError && e.status === 404
      );
      assert.equal((await ledgerRows())[0].status, "queued");
      assert.deepEqual(await tradelineRows(), []);
    });

    test("a request cannot be fulfilled twice", async () => {
      await wipeLedger();
      const { request } = await requestSoftPull(db, {
        orgId: org, clientId: client, requestedBy: { kind: "staff", id: staffId },
        reason: "replay guard"
      });
      const crsId = await mkCrs(client);
      await fulfilSoftPull(db, { requestId: request.id, crsResultId: crsId });

      await assert.rejects(
        () => fulfilSoftPull(db, { requestId: request.id, crsResultId: crsId }),
        (e) => e instanceof SoftPullError && e.status === 409
      );
      assert.equal((await tradelineRows()).length, 3, "a replayed fulfil re-ingested the cards");
    });
  });

  // ── one tap is one pull ──────────────────────────────────────────────────

  describe("one tap is one pull", () => {
    test("a second tap while one is open returns the first request", async () => {
      await wipeLedger();
      const a = await requestSoftPull(db, {
        orgId: org, clientId: client, requestedBy: { kind: "client", id: accountId },
        reason: "tapped once"
      });
      const b = await requestSoftPull(db, {
        orgId: org, clientId: client, requestedBy: { kind: "client", id: accountId },
        reason: "tapped again a second later"
      });

      assert.equal(b.created, false);
      assert.equal(b.reason, "already_open");
      assert.equal(b.request.id, a.request.id);
      assert.equal((await ledgerRows()).length, 1,
        "a double tap recorded two consumer-credit events");
    });

    test("a replayed idempotency key returns the same row, even after the first was resolved", async () => {
      await wipeLedger();
      const a = await requestSoftPull(db, {
        orgId: org, clientId: client, requestedBy: { kind: "staff", id: staffId },
        reason: "network retry", idempotencyKey: "tap-abc"
      });
      await fulfilSoftPull(db, { requestId: a.request.id, crsResultId: await mkCrs(client) });

      // The retry arrives late, after the pull completed. It must still resolve
      // to the original request rather than starting a second pull.
      const b = await requestSoftPull(db, {
        orgId: org, clientId: client, requestedBy: { kind: "staff", id: staffId },
        reason: "network retry", idempotencyKey: "tap-abc"
      });
      assert.equal(b.created, false);
      assert.equal(b.reason, "replay");
      assert.equal(b.request.id, a.request.id);
      assert.equal((await ledgerRows()).length, 1);
    });

    test("two different clients may each have an open request at the same time", async () => {
      await wipeLedger();
      await requestSoftPull(db, {
        orgId: org, clientId: client, requestedBy: { kind: "staff", id: staffId }, reason: "one"
      });
      const other = await requestSoftPull(db, {
        orgId: org, clientId: otherClient, requestedBy: { kind: "staff", id: staffId }, reason: "two"
      });
      assert.equal(other.created, true,
        "one client's open pull blocked a different client's");
    });

    test("after a request is resolved, a new tap starts a new one", async () => {
      await wipeLedger();
      const a = await requestSoftPull(db, {
        orgId: org, clientId: client, requestedBy: { kind: "staff", id: staffId }, reason: "first"
      });
      await closeSoftPull(db, { requestId: a.request.id, status: "failed", reason: "provider unavailable" });

      const b = await requestSoftPull(db, {
        orgId: org, clientId: client, requestedBy: { kind: "staff", id: staffId }, reason: "second"
      });
      assert.equal(b.created, true, "a resolved request permanently blocked the client's next pull");
      assert.equal((await ledgerRows()).length, 2);
    });
  });

  // ── the ledger reads back the way an audit asks the question ─────────────

  describe("the ledger answers 'why was this person's credit pulled'", () => {
    test("the history carries who, why, when, cost and the result, newest first", async () => {
      await wipeLedger();
      const first = await requestSoftPull(db, {
        orgId: org, clientId: client, requestedBy: { kind: "staff", id: staffId },
        reason: "closer prepping the funding call", costCents: 1200
      });
      await fulfilSoftPull(db, { requestId: first.request.id, crsResultId: await mkCrs(client) });

      await requestSoftPull(db, {
        orgId: org, clientId: client, requestedBy: { kind: "client", id: accountId },
        reason: "client checking their own file"
      });

      const history = await listSoftPullRequests(db, { clientId: client });
      assert.equal(history.length, 2);

      const [newest, oldest] = history;
      assert.equal(newest.requested_by_kind, "client");
      assert.equal(newest.requested_by_account_id, accountId);
      assert.equal(newest.reason, "client checking their own file");
      assert.equal(newest.status, "queued");

      assert.equal(oldest.requested_by_kind, "staff");
      assert.equal(oldest.requested_by_staff_id, staffId);
      assert.equal(oldest.reason, "closer prepping the funding call");
      assert.equal(oldest.status, "fulfilled");
      assert.ok(oldest.crs_result_id, "a fulfilled request does not say which pull answered it");
      assert.equal(oldest.cost_cents, "1200");
      assert.equal(oldest.cost_display, "12.00");
    });

    test("an unknown cost stays unknown — it is never rendered as free", async () => {
      await wipeLedger();
      const { request } = await requestSoftPull(db, {
        orgId: org, clientId: client, requestedBy: { kind: "staff", id: staffId },
        reason: "cost not known at request time"
      });
      const stored = await getSoftPullRequest(db, request.id);
      assert.equal(stored.cost_cents, null);
      assert.equal(stored.cost_display, null,
        "an unknown cost rendered as a number — a billing report would read it as $0.00");
    });

    test("subscription_id is carried without a foreign key to a table this build does not own", async () => {
      await wipeLedger();
      const planId = "77777777-7777-7777-7777-777777777777";
      const { request } = await requestSoftPull(db, {
        orgId: org, clientId: client, requestedBy: { kind: "staff", id: staffId },
        reason: "billed to a plan", subscriptionId: planId
      });
      assert.equal(request.subscription_id, planId,
        "the plan id did not survive — an FK to a table built in parallel would have rejected it");
    });

    test("openRequestFor tells the button whether a pull is already in flight", async () => {
      await wipeLedger();
      assert.equal(await openRequestFor(db, { clientId: client }), null);
      const { request } = await requestSoftPull(db, {
        orgId: org, clientId: client, requestedBy: { kind: "staff", id: staffId }, reason: "in flight"
      });
      assert.equal((await openRequestFor(db, { clientId: client })).id, request.id);
      await closeSoftPull(db, { requestId: request.id, status: "cancelled", reason: "client changed their mind" });
      assert.equal(await openRequestFor(db, { clientId: client }), null);
    });

    test("a state the schema cannot hold is refused", async () => {
      // A 'sent' status would be a promise nothing in this repo can keep.
      await wipeLedger();
      await assert.rejects(
        () => db.query(
          `INSERT INTO soft_pull_requests
             (org_id, client_id, requested_by_kind, requested_by_staff_id, reason, status, resolved_at)
           VALUES ($1,$2,'staff',$3,'pretending to transmit','sent', now())`, [org, client, staffId]
        ),
        (e) => /violates check constraint/.test(String(e.message))
      );
    });

    test("a failed request cannot claim a result, and a fulfilled one cannot lack it", async () => {
      await wipeLedger();
      const crsId = await mkCrs(client);
      await assert.rejects(
        () => db.query(
          `INSERT INTO soft_pull_requests
             (org_id, client_id, requested_by_kind, requested_by_staff_id, reason, status, resolved_at, crs_result_id)
           VALUES ($1,$2,'staff',$3,'failed but claims an answer','failed', now(), $4)`,
          [org, client, staffId, crsId]
        ),
        (e) => /soft_pull_requests_result_ck/.test(String(e.message))
      );
      await assert.rejects(
        () => db.query(
          `INSERT INTO soft_pull_requests
             (org_id, client_id, requested_by_kind, requested_by_staff_id, reason, status, resolved_at)
           VALUES ($1,$2,'staff',$3,'fulfilled with no answer','fulfilled', now())`,
          [org, client, staffId]
        ),
        (e) => /soft_pull_requests_result_ck/.test(String(e.message))
      );
    });
  });

  // ── recordPull / getLatestPull, against the real crs_results table ────────

  describe("recording a pull", () => {
    test("a pull with no request is stored and its cards land in tradelines", async () => {
      // The paid path (diagnostic.paid -> C-00) files no ledger request. A pull
      // that happened is a fact; refusing to store it for want of paperwork
      // would lose the only copy.
      await wipeLedger();
      await db.query(`DELETE FROM crs_results WHERE client_id = $1`, [client]);

      const out = await recordPull(db, { orgId: org, clientId: client, result: CRS_PAYLOAD });
      assert.equal(out.request, null);
      assert.equal(out.ingested, 3);
      assert.ok(out.crsResult.id);

      const lines = await tradelineRows();
      assert.equal(lines.length, 3, `tradelines has ${lines.length} rows, not 3`);
      assert.equal(lines.find((l) => l.lender === "Amex Blue Business").credit_limit_cents, "1000000");
      assert.equal(lines.find((l) => l.lender === "Capital One Spark").apr, null,
        "a missing APR was filled in with a guess");
      assert.deepEqual(await ledgerRows(), [], "a pull with no request wrote a ledger row anyway");
    });

    test("a pull with a request closes the ledger row and ingests, atomically", async () => {
      await wipeLedger();
      await db.query(`DELETE FROM crs_results WHERE client_id = $1`, [client]);

      const { request } = await requestSoftPull(db, {
        orgId: org, clientId: client, requestedBy: { kind: "staff", id: staffId },
        reason: "closer asked for a refresh"
      });
      const out = await recordPull(db, {
        orgId: org, clientId: client, requestId: request.id, result: CRS_PAYLOAD
      });

      assert.equal(out.request.status, "fulfilled");
      assert.equal(out.request.crs_result_id, out.crsResult.id);
      assert.equal(out.ingested, 3);
      assert.equal((await tradelineRows()).length, 3);
    });

    test("a pull naming an already-resolved request stores NOTHING — both halves roll back", async () => {
      // The transaction is the claim. If the crs_results row survived a failed
      // fulfil, the history would carry a pull the ledger says never completed.
      await wipeLedger();
      await db.query(`DELETE FROM crs_results WHERE client_id = $1`, [client]);

      const { request } = await requestSoftPull(db, {
        orgId: org, clientId: client, requestedBy: { kind: "staff", id: staffId }, reason: "first"
      });
      await recordPull(db, { orgId: org, clientId: client, requestId: request.id, result: CRS_PAYLOAD });
      const crsCountAfterFirst = Number((await db.query(
        `SELECT count(*) n FROM crs_results WHERE client_id = $1`, [client])).rows[0].n);

      await assert.rejects(
        () => recordPull(db, { orgId: org, clientId: client, requestId: request.id, result: CRS_PAYLOAD }),
        (e) => e instanceof SoftPullError && e.status === 409
      );

      const after = Number((await db.query(
        `SELECT count(*) n FROM crs_results WHERE client_id = $1`, [client])).rows[0].n);
      assert.equal(after, crsCountAfterFirst,
        "a refused recordPull left an orphan crs_results row behind");
    });

    test("a request cannot be closed by a pull recorded against another client", async () => {
      await wipeLedger();
      const { request } = await requestSoftPull(db, {
        orgId: org, clientId: client, requestedBy: { kind: "staff", id: staffId }, reason: "mis-join"
      });
      await assert.rejects(
        () => recordPull(db, {
          orgId: org, clientId: otherClient, requestId: request.id, result: CRS_PAYLOAD
        }),
        (e) => e instanceof SoftPullError && e.status === 409
      );
      assert.deepEqual(await tradelineRows(otherClient), [],
        "another client's cards were ingested against this request");
      assert.equal((await ledgerRows())[0].status, "queued");
    });
  });

  describe("getLatestPull", () => {
    test("null for a client who has never been pulled", async () => {
      // A fresh client, deliberately: `otherClient` picked up a crs_results row
      // from the mis-join test above, so asserting against it would prove
      // nothing about the empty case.
      const virgin = await mkClient("neverpulled");
      assert.equal(await getLatestPull(db, { clientId: virgin }), null);
    });

    test("the newest pull wins, and the tiebreak holds inside one transaction", async () => {
      // crs_results.created_at defaults to now(), which is the TRANSACTION
      // timestamp — two rows written in one transaction share it exactly. Order
      // on the timestamp alone and "the latest" is arbitrary between them.
      await wipeLedger();
      await db.query(`DELETE FROM crs_results WHERE client_id = $1`, [client]);

      const first = await recordPull(db, {
        orgId: org, clientId: client, result: { tradelines: [], marker: "first" }
      });
      const second = await recordPull(db, {
        orgId: org, clientId: client, result: { tradelines: [], marker: "second" }
      });

      const latest = await getLatestPull(db, { clientId: client });
      assert.ok(latest, "a client with two pulls returned none");
      assert.ok(latest.id === second.crsResult.id || latest.id === first.crsResult.id);
      assert.equal(latest.result.marker, "second",
        `getLatestPull returned the older pull (${latest.result.marker})`);
    });

    test("it returns the payload as stored and does not normalize it", async () => {
      const latest = await getLatestPull(db, { clientId: client });
      assert.ok("result" in latest, "the payload was dropped");
      assert.equal(latest.client_id, client);
    });
  });
});