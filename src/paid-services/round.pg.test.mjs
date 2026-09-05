// Postgres-backed tests for the self-serve paid round — the real path, driven.
//
// WHAT THESE ASSERT AGAINST. Rows, not return values. A function's return value
// is its account of what it did; the row is what it did. "One press, one
// charge" is only true if `paid_service_requests` holds one row and the mint
// function was called once, so both are counted.
//
// THE MINT FUNCTION IS FAKED, AND ONLY THE MINT FUNCTION. Everything else runs
// for real: the eligibility reads, the INSERT and its CHECK constraints, the
// unique indexes, the soft-pull ledger and its consent gate. The processor is
// faked because a test must not open a checkout session at a payment company,
// and because the number of times it is called IS the number of charges a
// client could be exposed to — which is the thing being measured.
//
// Skipped without DATABASE_URL like every other *.pg.test.mjs. A skipped
// .pg.test.mjs is not green.

import { test, before, after, beforeEach, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { captureConsent, revokeConsent } from "../consent/index.mjs";
import {
  requestRound,
  recordPayment,
  stageRound,
  assessRoundEligibility,
  anythingToDispute,
  openRoundFor,
  paidServiceOffer,
  quoteRound
} from "./round.mjs";
import { REFUSAL } from "./refusals.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const CLIENT_EMAIL_LIKE = "paidround.pg.%@example.com";
const STAFF_EMAIL_LIKE = "paidround_pg_%@example.com";

/* A report with one charged-off account on it. negativeKeysFromResult() reads
   `remarks`/`status` off a tradeline, so this is the smallest payload that is
   honestly "there is something to dispute". */
const DIRTY_REPORT = {
  tradelines: [
    { creditorName: "Midtown Bank", accountNumber: "PR-1", status: "Charge-off", balance: 4200 },
    { creditorName: "Clean Card", accountNumber: "PR-2", status: "Pays as agreed", balance: 100 }
  ],
  publicRecords: []
};
const CLEAN_REPORT = {
  tradelines: [
    { creditorName: "Clean Card", accountNumber: "PR-2", status: "Pays as agreed", balance: 100 }
  ],
  publicRecords: []
};

describe("the self-serve paid round", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, client, staffId;

  /* A stand-in for the processor. Counts its calls, because the call count is
     the charge count: every call is one checkout page a client could pay on. */
  function mintCounter({ fail = false, failReason = "checkout_unreachable: simulated outage" } = {}) {
    const calls = [];
    const fn = async (args) => {
      calls.push(args);
      if (fail) return { ok: false, reason: failReason };
      return { ok: true, checkoutUrl: `https://pay.example.test/${args.requestId}`, sessionId: "sess_1" };
    };
    fn.calls = calls;
    return fn;
  }

  async function purge() {
    const ids = (await db.query(`SELECT id FROM clients WHERE email LIKE $1`, [CLIENT_EMAIL_LIKE]))
      .rows.map((r) => r.id);
    if (ids.length) {
      await db.query(`DELETE FROM paid_service_requests WHERE client_id = ANY($1)`, [ids]);
      await db.query(`DELETE FROM soft_pull_requests WHERE client_id = ANY($1)`, [ids]);
      await db.query(`DELETE FROM crs_results WHERE client_id = ANY($1)`, [ids]);
      await db.query(`DELETE FROM repair_programs WHERE client_id = ANY($1)`, [ids]);
      await db.query(`DELETE FROM clients WHERE id = ANY($1)`, [ids]);
    }
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [STAFF_EMAIL_LIKE]);
  }

  /** A fresh client on the repair offer path, with a dirty report and consent. */
  async function makeClient({ report = DIRTY_REPORT, tier = "REPAIR_ONLY", consent = true } = {}) {
    const id = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email, outcome_tier)
       VALUES ($1,'Paid','Round',$2,$3) RETURNING id`,
      [org, `paidround.pg.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`, tier]
    )).rows[0].id;
    if (report) {
      await db.query(
        `INSERT INTO crs_results (org_id, client_id, result) VALUES ($1,$2,$3::jsonb)`,
        [org, id, JSON.stringify(report)]
      );
    }
    if (consent) {
      await captureConsent(db, {
        orgId: org, clientId: id, kind: "soft_pull_consent",
        consentText: "I authorize Fundhub to obtain my consumer credit report through a soft inquiry.",
        consentVersion: "soft-pull-v1",
        grantedBy: { kind: "staff", id: staffId },
        captureMethod: "checkbox"
      });
    }
    return id;
  }

  const rowsFor = async (id) => (await db.query(
    `SELECT * FROM paid_service_requests WHERE client_id = $1::uuid ORDER BY requested_at, id`, [id]
  )).rows;

  before(async () => {
    org = await resolveDefaultOrg(db);
    await purge();
    staffId = (await db.query(
      `INSERT INTO staff (org_id, name, role, email, status)
       VALUES ($1,'Paid Round Pgtest','owner',$2,'active') RETURNING id`,
      [org, "paidround_pg_owner@example.com"]
    )).rows[0].id;
  });

  beforeEach(async () => { client = await makeClient(); });
  after(async () => { await purge(); await close(); });

  const ask = (over = {}) => requestRound(db, {
    orgId: org,
    clientId: client,
    requestedByKind: "staff",
    requestedByStaffId: staffId,
    mintFn: mintCounter(),
    ...over
  });

  // ── 1. THE PRICE, ON THE ROW ──────────────────────────────────────────────

  describe("what it costs, read back off the row the client is billed from", () => {
    test("a plain round stores 10000 cents and one line", async () => {
      const out = await ask();
      assert.equal(out.ok, true, JSON.stringify(out));
      const [row] = await rowsFor(client);
      assert.equal(Number(row.price_total_cents), 10_000);
      assert.deepEqual(row.price_components.map((c) => c.code), ["round_base"]);
    });

    test("+ a creditor letter stores 11000 cents", async () => {
      await ask({ creditorLetter: true });
      const [row] = await rowsFor(client);
      assert.equal(Number(row.price_total_cents), 11_000);
      assert.deepEqual(row.price_components.map((c) => c.code), ["round_base", "creditor_letter"]);
    });

    test("+ the CFPB and state AG filings stores 12000 cents", async () => {
      await ask({ escalationFilings: true });
      const [row] = await rowsFor(client);
      assert.equal(Number(row.price_total_cents), 12_000);
    });

    test("both add-ons stores 13000 cents and three lines", async () => {
      await ask({ creditorLetter: true, escalationFilings: true });
      const [row] = await rowsFor(client);
      assert.equal(Number(row.price_total_cents), 13_000);
      assert.equal(row.price_components.length, 3);
    });

    test("the amount sent to the processor is the same number as the row's total", async () => {
      // The failure this catches: a receipt that says one thing and a checkout
      // page that charges another.
      const mint = mintCounter();
      await ask({ creditorLetter: true, escalationFilings: true, mintFn: mint });
      const [row] = await rowsFor(client);
      assert.equal(mint.calls.length, 1);
      assert.equal(mint.calls[0].amountCents, Number(row.price_total_cents));
      assert.equal(mint.calls[0].amountCents, 13_000);
    });

    test("the row lands at awaiting_payment with a link and NOTHING paid", async () => {
      const out = await ask();
      const [row] = await rowsFor(client);
      assert.equal(row.status, "awaiting_payment");
      assert.ok(row.checkout_url, "no hosted checkout link was stored");
      assert.equal(row.paid_at, null, "a row that has never been paid carries a paid_at");
      assert.equal(row.amount_paid_cents, null,
        "amount_paid_cents is not NULL before payment — unknown has been written as a number");
      assert.equal(out.checkoutUrl, row.checkout_url);
    });
  });

  // ── 2. A DOUBLE PRESS ─────────────────────────────────────────────────────

  describe("a double press", () => {
    test("two SIMULTANEOUS presses make one row and mint one link", async () => {
      const mint = mintCounter();
      const [a, b] = await Promise.all([ask({ mintFn: mint }), ask({ mintFn: mint })]);

      const rows = await rowsFor(client);
      assert.equal(rows.length, 1,
        `two simultaneous presses wrote ${rows.length} rows — the client would be billed twice`);
      assert.equal(mint.calls.length, 1,
        `${mint.calls.length} checkout links were minted for one press — that is ${mint.calls.length} pages a client could pay on`);

      /* EXACTLY ONE PRESS CREATED IT, AND THE OTHER WAS STILL ANSWERED.
         The loser's answer depends on which microsecond it lost in, and BOTH
         answers are correct:
           * ok:true, created:false — it lost inside the INSERT and was handed
             the winner's row;
           * ok:false, already_in_flight — its eligibility read landed after the
             winner's INSERT, so it was refused before it ever got there.
         What must be true in both, and is asserted above, is one row and one
         checkout link. What must never happen is a loser that reports having
         created something, or a loser pointed at a different row. */
      const created = [a, b].filter((r) => r.created === true);
      assert.equal(created.length, 1, "both presses claimed to have created the row");
      const loser = [a, b].find((r) => r.created !== true);
      assert.ok(
        loser.ok === true || loser.reason === REFUSAL.ALREADY_IN_FLIGHT,
        `the losing press was answered with neither the winner's row nor a refusal: ${JSON.stringify(loser)}`
      );
      assert.equal(a.request.id, b.request.id, "the two presses were answered with different rows");
    });

    test("three simultaneous presses still make one row and one link", async () => {
      const mint = mintCounter();
      const out = await Promise.all([
        ask({ mintFn: mint }), ask({ mintFn: mint }), ask({ mintFn: mint })
      ]);
      assert.equal((await rowsFor(client)).length, 1);
      assert.equal(mint.calls.length, 1);
      assert.equal(new Set(out.map((r) => r.request.id)).size, 1);
      assert.equal(out.filter((r) => r.created === true).length, 1);
    });

    test("ten presses at once are still one row and one link", async () => {
      // The two-press case is the one that broke. Ten is the one that proves
      // the guard is the database's and not a lucky interleaving.
      const mint = mintCounter();
      const out = await Promise.all(
        Array.from({ length: 10 }, () => ask({ mintFn: mint }))
      );
      assert.equal((await rowsFor(client)).length, 1,
        "ten simultaneous presses wrote more than one row");
      assert.equal(mint.calls.length, 1,
        `${mint.calls.length} checkout links for ten presses of one button`);
      assert.equal(out.filter((r) => r.created === true).length, 1);
      assert.equal(new Set(out.map((r) => r.request?.id)).size, 1,
        "the ten presses were not all pointed at the same row");
    });

    test("a press SECONDS later is refused as already in flight, not charged again", async () => {
      const mint = mintCounter();
      await ask({ mintFn: mint });
      const second = await ask({ mintFn: mint });

      assert.equal(second.ok, false);
      assert.equal(second.reason, REFUSAL.ALREADY_IN_FLIGHT);
      assert.equal(second.status, 409);
      assert.ok(second.request, "the refusal does not hand back the round they already have");
      assert.equal((await rowsFor(client)).length, 1);
      assert.equal(mint.calls.length, 1, "a second link was minted for a refused press");
    });

    test("an explicit idempotency key replays to the same row", async () => {
      const mint = mintCounter();
      const key = `test-key-${Date.now()}`;
      const first = await ask({ idempotencyKey: key, mintFn: mint });
      // Clear the in-flight guard so the key itself is what is under test.
      await db.query(
        `UPDATE paid_service_requests SET status='cancelled', resolved_at=now() WHERE id=$1`,
        [first.request.id]
      );
      const replay = await ask({ idempotencyKey: key, mintFn: mint });
      assert.equal(replay.ok, true);
      assert.equal(replay.created, false);
      assert.equal(replay.request.id, first.request.id);
      assert.equal((await rowsFor(client)).length, 1);
      assert.equal(mint.calls.length, 1);
    });
  });

  // ── 3. THE MONEY LANDS, THE ROUND IS STAGED, NOTHING IS MAILED ────────────

  describe("payment stages the round and does not mail it", () => {
    test("paid → staged, with a fresh report ordered and mailed:false on the row", async () => {
      const out = await ask();
      const id = out.request.id;

      const paid = await recordPayment(db, {
        requestId: id, paymentRef: "txn_abc", amountCents: 10_000
      });
      assert.equal(paid.applied, true);
      assert.equal(paid.request.status, "paid");
      assert.equal(Number(paid.request.amount_paid_cents), 10_000);
      assert.ok(paid.request.paid_at);

      const staged = await stageRound(db, { requestId: id });
      assert.equal(staged.ok, true, JSON.stringify(staged));
      assert.equal(staged.staged, true);
      assert.equal(staged.request.status, "staged");
      assert.equal(staged.request.state_reason, "awaiting_fresh_report");
      assert.equal(staged.request.produced.mailed, false);

      // THE RE-PULL IS REAL: a soft_pull_requests row exists and is queued.
      const pulls = (await db.query(
        `SELECT * FROM soft_pull_requests WHERE client_id = $1`, [client]
      )).rows;
      assert.equal(pulls.length, 1, "no fresh report was ordered for a paid round");
      assert.equal(pulls[0].status, "queued");
      assert.equal(staged.softPullRequestId, pulls[0].id);
      assert.equal(staged.request.produced.soft_pull_request_id, pulls[0].id);
    });

    test("NOTHING WAS MAILED — no letter row exists and none moved to sent", async () => {
      // The invariant, checked against the table a mailing would have to touch.
      const out = await ask();
      await recordPayment(db, { requestId: out.request.id, amountCents: 10_000 });
      await stageRound(db, { requestId: out.request.id });

      const letters = (await db.query(
        `SELECT id, status FROM dispute_letters WHERE client_id = $1`, [client]
      )).rows;
      assert.deepEqual(letters, [],
        "paying for a round produced dispute letters — payment is staging the mail, not preparing it");

      const req = (await rowsFor(client))[0];
      assert.equal(req.status, "staged");
      assert.notEqual(req.status, "fulfilled",
        "a paid round reported itself finished before a human had sent anything");
      assert.equal(req.produced.mailed, false);
    });

    test("a replayed payment webhook changes nothing", async () => {
      const out = await ask();
      const id = out.request.id;
      const first = await recordPayment(db, { requestId: id, amountCents: 10_000, paymentRef: "txn_1" });
      const second = await recordPayment(db, { requestId: id, amountCents: 10_000, paymentRef: "txn_2" });

      assert.equal(first.applied, true);
      assert.equal(second.applied, false);
      assert.equal(second.reason, "already_paid");
      const row = (await rowsFor(client))[0];
      assert.equal(row.payment_ref, "txn_1", "a replayed webhook overwrote the payment reference");
      assert.equal(Number(row.amount_paid_cents), 10_000);
    });

    test("staging twice orders one report, not two", async () => {
      const out = await ask();
      await recordPayment(db, { requestId: out.request.id, amountCents: 10_000 });
      await stageRound(db, { requestId: out.request.id });
      const again = await stageRound(db, { requestId: out.request.id });
      assert.equal(again.ok, true);
      assert.equal(again.staged, false, "a second stage re-ran the work");
      const pulls = (await db.query(
        `SELECT id FROM soft_pull_requests WHERE client_id = $1`, [client]
      )).rows;
      assert.equal(pulls.length, 1);
    });

    test("a webhook with no amount falls back to the quote and SAYS it did", async () => {
      const out = await ask({ creditorLetter: true });
      const paid = await recordPayment(db, { requestId: out.request.id, amountCents: null });
      assert.equal(paid.applied, true);
      assert.equal(Number(paid.request.amount_paid_cents), 11_000);
      assert.equal(paid.request.produced.payment_amount_source, "quote",
        "the quoted figure was recorded as if the processor had confirmed it");
    });

    /* ── THE SHORT-PAYMENT GUARD ───────────────────────────────────────────
       Measured defect, 2026-09-05: `amountCents: 0` returned applied:true and
       the row read 'paid', and one cent against an $110 round reached 'staged'
       with a real soft pull ordered. Nothing compared the reported figure to
       the billed figure. These four cases fix the boundary in place. */

    test("a ZERO-amount payment event is refused and the round is not paid", async () => {
      const out = await ask();
      const paid = await recordPayment(db, {
        requestId: out.request.id, paymentRef: "txn_zero", amountCents: 0
      });

      assert.equal(paid.applied, false, "a zero-cent payment was recorded as a payment");
      assert.equal(paid.reason, REFUSAL.PAYMENT_SHORT);
      assert.equal(paid.shortfallCents, 10_000);

      const row = (await rowsFor(client))[0];
      assert.equal(row.status, "failed");
      assert.notEqual(row.status, "paid");
      // The zero IS kept on the row — refusing must not lose the fact that a
      // webhook arrived claiming nothing was paid.
      assert.equal(Number(row.amount_paid_cents), 0);
      assert.equal(row.produced.payment_shortfall_cents, 10_000);
      assert.match(row.state_reason, /payment_short: received 0 of 10000 cents/);
    });

    test("ONE CENT against a full-price round stages nothing and orders no report", async () => {
      const out = await ask({ creditorLetter: true });   // 11_000 cents
      const paid = await recordPayment(db, {
        requestId: out.request.id, paymentRef: "txn_penny", amountCents: 1
      });
      assert.equal(paid.applied, false);
      assert.equal(paid.reason, REFUSAL.PAYMENT_SHORT);
      assert.equal(paid.pricedCents, 11_000);
      assert.equal(paid.shortfallCents, 10_999);

      // stageRound must refuse it too — the guard is not the only thing
      // standing between one cent and a staged round.
      const staged = await stageRound(db, { requestId: out.request.id });
      assert.equal(staged.ok, false);
      assert.equal(staged.reason, "status_failed");

      const pulls = (await db.query(
        `SELECT id FROM soft_pull_requests WHERE client_id = $1`, [client]
      )).rows;
      assert.deepEqual(pulls, [], "a one-cent payment ordered a fresh credit report");

      const row = (await rowsFor(client))[0];
      assert.notEqual(row.status, "staged");
      assert.equal(row.produced.mailed, false);
    });

    test("a short payment closes the request, so the client is not locked out of buying again", async () => {
      const out = await ask();
      await recordPayment(db, { requestId: out.request.id, amountCents: 500 });

      // 'failed' is a finished state and holds no slot in the one-open index,
      // so a fresh request must be creatable rather than refused in_flight.
      assert.equal(await openRoundFor(db, { orgId: org, clientId: client }), null);
      const retry = await ask();
      assert.equal(retry.ok, true);
      assert.equal(retry.created, true);
      assert.equal(retry.request.round_no, 2);
    });

    test("an OVERpayment is accepted — the client is not short, so the work runs", async () => {
      const out = await ask();
      const paid = await recordPayment(db, {
        requestId: out.request.id, amountCents: 12_500   // quote is 10_000
      });
      assert.equal(paid.applied, true, "a client who paid too much was refused their round");
      assert.equal(paid.request.status, "paid");
      assert.equal(Number(paid.request.amount_paid_cents), 12_500);
      assert.equal(paid.request.produced.payment_amount_source, "processor");

      const staged = await stageRound(db, { requestId: out.request.id });
      assert.equal(staged.ok, true);
      assert.equal(staged.request.status, "staged");
    });

    test("an EXACT payment is still accepted — the guard is > and not >=", async () => {
      // Guards written with the wrong comparator refuse the ordinary case, and
      // every other test here pays exactly, so this states it on purpose.
      const out = await ask({ creditorLetter: true, escalationFilings: true });
      const paid = await recordPayment(db, { requestId: out.request.id, amountCents: 13_000 });
      assert.equal(paid.applied, true);
      assert.equal(paid.request.status, "paid");
    });

    test("a paid round does NOT consume the program's round cap", async () => {
      await db.query(
        `INSERT INTO repair_programs (org_id, client_id, program, rounds_cap, price_total)
         VALUES ($1,$2,'full',6,1500.00)`,
        [org, client]
      );
      const out = await ask();
      await recordPayment(db, { requestId: out.request.id, amountCents: 10_000 });
      await stageRound(db, { requestId: out.request.id });

      const prog = (await db.query(
        `SELECT rounds_cap FROM repair_programs WHERE client_id = $1`, [client]
      )).rows[0];
      assert.equal(prog.rounds_cap, 6, "buying a round decremented the program's cap");
      const row = (await rowsFor(client))[0];
      assert.equal(row.round_no, 1, "the self-serve counter did not start at 1");
    });

    test("the self-serve counter climbs on its own", async () => {
      const first = await ask();
      await db.query(
        `UPDATE paid_service_requests SET status='cancelled', resolved_at=now() WHERE id=$1`,
        [first.request.id]
      );
      const second = await ask();
      assert.equal(second.request.round_no, 2,
        "a cancelled round did not burn its slot, so the sequence is a COUNT(*) and not a sequence");
    });
  });

  // ── 4. EVERY REFUSAL ──────────────────────────────────────────────────────

  describe("refusals", () => {
    test("payment failed — the processor is down, nothing is charged, the row is closed", async () => {
      const mint = mintCounter({ fail: true });
      const out = await ask({ mintFn: mint });

      assert.equal(out.ok, false);
      assert.equal(out.reason, REFUSAL.PAYMENT_FAILED);
      assert.equal(out.status, 502);
      assert.match(out.message, /nothing has been charged/i);

      const [row] = await rowsFor(client);
      assert.equal(row.status, "failed");
      assert.ok(row.resolved_at, "a failed row was left open and would block every retry");
      assert.match(row.state_reason, /checkout_unavailable/);
      assert.equal(row.paid_at, null);
      assert.equal(row.checkout_url, null);
    });

    test("the processor's own words never reach the client, only a code", async () => {
      /* The processor's reason has been observed carrying an API key fragment,
         an internal hostname and a request id. api/paid-services.mjs returns
         state_reason verbatim to a client principal, so that column must hold a
         code and nothing else. */
      const hostile =
        "Invalid API Key provided: sk_live_51Hx9****abc at " +
        "https://api.commas.internal/v2/checkout (request_id req_9f2c)";
      const out = await ask({ mintFn: mintCounter({ fail: true, failReason: hostile }) });
      assert.equal(out.ok, false);

      const [row] = await rowsFor(client);
      assert.equal(row.state_reason, "checkout_unavailable",
        "state_reason must be a bare code — it is handed to the client verbatim");
      for (const secret of ["sk_live", "commas.internal", "req_9f2c", "Invalid API Key"]) {
        assert.ok(!String(row.state_reason).includes(secret),
          `state_reason leaked ${secret} to the client`);
      }
    });

    test("...and the client can try again afterwards", async () => {
      await ask({ mintFn: mintCounter({ fail: true }) });
      const retry = await ask();
      assert.equal(retry.ok, true, `a client locked out after a processor outage: ${JSON.stringify(retry)}`);
      assert.equal(retry.created, true);
      assert.equal(retry.request.round_no, 2);
    });

    test("already in flight — a request is open for this client", async () => {
      await ask();
      const out = await ask();
      assert.equal(out.reason, REFUSAL.ALREADY_IN_FLIGHT);
      assert.equal(out.request.status, "awaiting_payment");
    });

    test("the credit pull failed — consent was revoked between paying and staging", async () => {
      const out = await ask();
      await recordPayment(db, { requestId: out.request.id, amountCents: 10_000 });
      /* Revoked through the product's own path, not by raw SQL: a revocation
         this test could write but the product could not would make the suite
         agree with itself and with nothing else. (099's revocation CHECK
         refuses a half-written one anyway.) */
      const consentId = (await db.query(
        `SELECT id FROM client_consents
          WHERE client_id = $1 AND kind = 'soft_pull_consent' AND revoked_at IS NULL`,
        [client]
      )).rows[0].id;
      await revokeConsent(db, {
        orgId: org, consentId,
        reason: "client changed their mind between paying and staging",
        revokedBy: { kind: "staff", id: staffId }
      });

      const staged = await stageRound(db, { requestId: out.request.id });
      assert.equal(staged.ok, false);
      assert.equal(staged.reason, REFUSAL.PULL_FAILED);
      assert.match(staged.message, /payment went through/i);

      const [row] = await rowsFor(client);
      assert.equal(row.status, "failed", "a round whose report could not be ordered still reads as healthy");
      assert.match(row.state_reason, /pull_refused/);
      assert.ok(row.paid_at, "the payment record was thrown away with the failure");
      assert.equal(Number(row.amount_paid_cents), 10_000);
      assert.deepEqual(
        (await db.query(`SELECT id FROM soft_pull_requests WHERE client_id = $1`, [client])).rows,
        [], "a report was ordered without consent");
    });

    test("nothing to dispute — the newest report is clean", async () => {
      client = await makeClient({ report: CLEAN_REPORT });
      assert.equal(await anythingToDispute(db, { orgId: org, clientId: client }), false);
      const out = await ask();
      assert.equal(out.ok, false);
      assert.equal(out.reason, REFUSAL.NOTHING_TO_DISPUTE);
      assert.deepEqual(await rowsFor(client), [], "a refused request still wrote a row");
    });

    test("not on an offer path that permits it — a course buyer cannot buy a round", async () => {
      client = await makeClient({ tier: "ACADEMY" });
      const out = await ask();
      assert.equal(out.ok, false);
      assert.equal(out.reason, REFUSAL.NOT_ON_OFFER_PATH);
      assert.equal(out.status, 403);
      assert.deepEqual(await rowsFor(client), []);
    });
  });

  // ── 5. UNKNOWN SURVIVES ───────────────────────────────────────────────────

  describe("unknown is not a denial", () => {
    test("a client we have never pulled is UNKNOWN, and may still buy", async () => {
      client = await makeClient({ report: null });
      assert.equal(await anythingToDispute(db, { orgId: org, clientId: client }), null,
        "a client with no report on file was answered with a boolean");
      const out = await ask();
      assert.equal(out.ok, true, "never having been pulled was treated as having nothing to dispute");
    });

    test("a report whose body retention has tombstoned is UNKNOWN, not clean", async () => {
      client = await makeClient({ report: null });
      await db.query(
        `INSERT INTO crs_results (org_id, client_id, result) VALUES ($1,$2,'{}'::jsonb)`,
        [org, client]
      );
      assert.equal(await anythingToDispute(db, { orgId: org, clientId: client }), null);
      assert.equal((await ask()).ok, true);
    });

    test("a demo report never decides anything for a real client", async () => {
      client = await makeClient({ report: null });
      await db.query(
        `INSERT INTO crs_results (org_id, client_id, result, is_demo)
         VALUES ($1,$2,$3::jsonb,true)`,
        [org, client, JSON.stringify(CLEAN_REPORT)]
      );
      assert.equal(await anythingToDispute(db, { orgId: org, clientId: client }), null);
    });
  });

  // ── 6. THE READ A SCREEN USES ─────────────────────────────────────────────

  describe("the offer a screen reads", () => {
    test("available, with the three priced components and inFlight false", async () => {
      const offer = await paidServiceOffer(db, { orgId: org, clientId: client });
      assert.equal(offer.serviceKey, "paid_round");
      assert.equal(offer.available, true);
      assert.equal(offer.inFlight, false);
      assert.deepEqual(offer.components.map((c) => c.key), ["base", "creditor", "cfpb_and_ag"]);
      assert.deepEqual(offer.components.map((c) => c.priceCents), [10_000, 1_000, 2_000]);
    });

    test("inFlight goes true the moment a request is open, so a screen can refuse the press itself", async () => {
      await ask();
      const offer = await paidServiceOffer(db, { orgId: org, clientId: client });
      assert.equal(offer.inFlight, true);
      assert.equal(offer.available, false);
      assert.equal(offer.unavailableReason, REFUSAL.ALREADY_IN_FLIGHT);
      assert.ok(offer.inFlightRequestId);
      assert.equal(offer.inFlightStatus, "awaiting_payment");
    });

    test("the price list is still returned when the client may not buy — a price is not a permission", async () => {
      client = await makeClient({ tier: "ACADEMY" });
      const offer = await paidServiceOffer(db, { orgId: org, clientId: client });
      assert.equal(offer.available, false);
      assert.equal(offer.unavailableReason, REFUSAL.NOT_ON_OFFER_PATH);
      assert.equal(offer.components.length, 3);
    });
  });

  // ── 7. CROSS-TENANT ───────────────────────────────────────────────────────

  test("an eligibility read for the wrong org finds nothing and refuses", async () => {
    const other = (await db.query(
      `SELECT id FROM orgs WHERE id <> $1 LIMIT 1`, [org]
    )).rows[0];
    if (!other) return;  // single-org database, nothing to prove here
    const out = await assessRoundEligibility(db, { orgId: other.id, clientId: client });
    assert.equal(out.ok, false);
    assert.equal(out.reason, REFUSAL.NOT_ON_OFFER_PATH);
    assert.equal(await openRoundFor(db, { orgId: other.id, clientId: client }), null);
  });

  test("the quote helper and the stored row agree", async () => {
    const out = await ask({ creditorLetter: true });
    assert.equal(Number(out.request.price_total_cents),
      quoteRound({ creditorLetter: true }).totalCents);
  });
});
