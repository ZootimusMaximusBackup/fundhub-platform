// Postgres-backed tests for the payment.received handler that finishes a paid
// round.
//
// THE ONE CLAIM THIS FILE EXISTS FOR: paying stages the mail and does not send
// it. src/metro2/delivery/send.mjs:3 and api/repair/send.mjs:3 both forbid
// mailing from payment.received in those words, and the way that rule gets
// broken is not by somebody arguing with it — it is by a well-meaning edit to
// the handler that runs when the money lands. So this file drives the real
// event through the real handler and then looks at the tables a mailing would
// have to touch.
//
// Skipped without DATABASE_URL like every other *.pg.test.mjs.

import { test, before, after, beforeEach, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { captureConsent } from "../consent/index.mjs";
import { getHandlers } from "../events/registry.mjs";
import {
  onPaidServicePaymentReceived,
  register
} from "./paid-service-payment.mjs";
import { requestRound } from "../paid-services/round.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const CLIENT_EMAIL_LIKE = "psvcpay.pg.%@example.com";
const STAFF_EMAIL_LIKE = "psvcpay_pg_%@example.com";
const FOREIGN_ORG_SLUG = "psvcpay-pg-other-co";

const DIRTY_REPORT = {
  tradelines: [{ creditorName: "Midtown Bank", accountNumber: "P-1", status: "Collection", balance: 300 }],
  publicRecords: []
};

const okMint = async (args) => ({
  ok: true, checkoutUrl: `https://pay.example.test/${args.requestId}`, sessionId: "s1"
});

describe("payment.received → a paid round is staged, never mailed",
  { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, foreignOrg, client, staffId;

  async function purge() {
    const ids = (await db.query(`SELECT id FROM clients WHERE email LIKE $1`, [CLIENT_EMAIL_LIKE]))
      .rows.map((r) => r.id);
    if (ids.length) {
      await db.query(`DELETE FROM paid_service_requests WHERE client_id = ANY($1)`, [ids]);
      await db.query(`DELETE FROM soft_pull_requests WHERE client_id = ANY($1)`, [ids]);
      await db.query(`DELETE FROM clients WHERE id = ANY($1)`, [ids]);
    }
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [STAFF_EMAIL_LIKE]);
    await db.query(`DELETE FROM orgs WHERE slug = $1`, [FOREIGN_ORG_SLUG]);
  }

  before(async () => {
    org = await resolveDefaultOrg(db);
    await purge();
    staffId = (await db.query(
      `INSERT INTO staff (org_id, name, role, email, status)
       VALUES ($1,'Psvcpay Pgtest','owner',$2,'active') RETURNING id`,
      [org, "psvcpay_pg_owner@example.com"]
    )).rows[0].id;
    foreignOrg = (await db.query(
      `INSERT INTO orgs (slug, name) VALUES ($1,'Psvcpay Other Co') RETURNING id`,
      [FOREIGN_ORG_SLUG]
    )).rows[0].id;
  });

  beforeEach(async () => {
    client = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email, outcome_tier)
       VALUES ($1,'Psvc','Pay',$2,'REPAIR_ONLY') RETURNING id`,
      [org, `psvcpay.pg.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`]
    )).rows[0].id;
    await db.query(
      `INSERT INTO crs_results (org_id, client_id, result) VALUES ($1,$2,$3::jsonb)`,
      [org, client, JSON.stringify(DIRTY_REPORT)]
    );
    await captureConsent(db, {
      orgId: org, clientId: client, kind: "soft_pull_consent",
      consentText: "I authorize Fundhub to obtain my consumer credit report through a soft inquiry.",
      consentVersion: "soft-pull-v1",
      grantedBy: { kind: "staff", id: staffId },
      captureMethod: "checkbox"
    });
  });

  after(async () => { await purge(); await close(); });

  /** A request sitting at awaiting_payment, made the way the endpoint makes one. */
  const openRequest = async () => {
    const out = await requestRound(db, {
      orgId: org, clientId: client,
      requestedByKind: "staff", requestedByStaffId: staffId,
      mintFn: okMint
    });
    assert.equal(out.ok, true, JSON.stringify(out));
    return out.request;
  };

  const paymentEvent = (requestId, over = {}) => ({
    name: "payment.received",
    orgId: org,
    payload: { ref: requestId, amountCents: 10_000, paymentId: "txn_live_1", ...over }
  });

  const rowOf = async (id) => (await db.query(
    `SELECT * FROM paid_service_requests WHERE id = $1::uuid`, [id]
  )).rows[0];

  // ── the claim ─────────────────────────────────────────────────────────────

  test("the money lands: paid, then staged, with a fresh report on order", async () => {
    const req = await openRequest();
    const out = await onPaidServicePaymentReceived(paymentEvent(req.id), db);

    assert.equal(out.done, true, JSON.stringify(out));
    const row = await rowOf(req.id);
    assert.equal(row.status, "staged");
    assert.ok(row.paid_at, "a staged round has no payment recorded against it");
    assert.equal(Number(row.amount_paid_cents), 10_000);
    assert.equal(row.payment_ref, "txn_live_1");
    assert.equal(row.state_reason, "awaiting_fresh_report");

    const pulls = (await db.query(
      `SELECT * FROM soft_pull_requests WHERE client_id = $1`, [client]
    )).rows;
    assert.equal(pulls.length, 1, "payment did not order a fresh report");
    assert.equal(pulls[0].status, "queued");
    assert.equal(out.softPullRequestId, pulls[0].id);
  });

  test("NOTHING WAS MAILED, checked against the tables a mailing writes", async () => {
    const req = await openRequest();
    const before = (await db.query(
      `SELECT count(*)::int AS n FROM dispute_letters WHERE client_id = $1`, [client]
    )).rows[0].n;

    const out = await onPaidServicePaymentReceived(paymentEvent(req.id), db);

    assert.equal(out.mailed, false, "the handler reported a mailing");
    const after = (await db.query(
      `SELECT count(*)::int AS n, count(*) FILTER (WHERE status = 'sent')::int AS sent
         FROM dispute_letters WHERE client_id = $1`, [client]
    )).rows[0];
    assert.equal(after.n, before, "paying for a round produced dispute letters");
    assert.equal(after.sent, 0, "paying for a round marked a letter sent");

    const row = await rowOf(req.id);
    assert.notEqual(row.status, "fulfilled",
      "the round reported itself finished before any human had sent anything");
    assert.equal(row.produced.mailed, false);
  });

  test("a human still has something to press: the round sits on the open board", async () => {
    const req = await openRequest();
    await onPaidServicePaymentReceived(paymentEvent(req.id), db);
    const open = (await db.query(
      `SELECT id, status FROM paid_service_requests
        WHERE org_id = $1 AND status IN ('quoted','awaiting_payment','paid','staged')`,
      [org]
    )).rows;
    assert.ok(open.some((r) => r.id === req.id && r.status === "staged"));
  });

  // ── replay ────────────────────────────────────────────────────────────────

  test("the same webhook twice orders one report and records one payment", async () => {
    const req = await openRequest();
    const first = await onPaidServicePaymentReceived(paymentEvent(req.id), db);
    const second = await onPaidServicePaymentReceived(
      paymentEvent(req.id, { paymentId: "txn_live_2" }), db
    );

    assert.equal(first.done, true);
    // The replay is not an error; it simply changes nothing.
    const row = await rowOf(req.id);
    assert.equal(row.payment_ref, "txn_live_1", "a replayed webhook rewrote the payment reference");
    assert.equal(Number(row.amount_paid_cents), 10_000);
    assert.equal(row.status, "staged");
    assert.equal(second.done !== undefined, true);

    const pulls = (await db.query(
      `SELECT id FROM soft_pull_requests WHERE client_id = $1`, [client]
    )).rows;
    assert.equal(pulls.length, 1, "a replayed webhook ordered a second report");
  });

  test("a crash between recording the payment and staging is repaired by a retry", async () => {
    // The state a retry exists for: money recorded, work never started.
    const req = await openRequest();
    await db.query(
      `UPDATE paid_service_requests
          SET status='paid', paid_at=now(), amount_paid_cents=10000 WHERE id=$1`,
      [req.id]
    );
    const out = await onPaidServicePaymentReceived(paymentEvent(req.id), db);
    assert.equal(out.done, true, JSON.stringify(out));
    assert.equal((await rowOf(req.id)).status, "staged");
  });

  // ── payments that are not for a round ─────────────────────────────────────

  describe("a payment that is short of the price", () => {
    /* Measured defect, 2026-09-05: a webhook payload of one cent against a
       full-price round returned done:true with reason "round staged, not
       mailed" and a real soft_pull_requests row. The end-to-end shape of the
       fix is checked here, at the handler, not only at recordPayment. */

    test("one cent against a full-price round stages nothing and orders no report", async () => {
      const req = await openRequest();
      const out = await onPaidServicePaymentReceived(
        paymentEvent(req.id, { amountCents: 1 }), db
      );

      assert.equal(out.done, false, "a one-cent payment reported the round done");
      assert.equal(out.reason, "payment_short");
      assert.equal(out.shortfallCents, 9_999);
      assert.equal(out.mailed, false);

      const row = await rowOf(req.id);
      assert.equal(row.status, "failed");
      assert.notEqual(row.status, "staged");
      assert.equal(Number(row.amount_paid_cents), 1, "the cent that did arrive was lost off the row");
      assert.ok(row.resolved_at);
      assert.match(row.state_reason, /payment_short: received 1 of 10000 cents/);

      const pulls = (await db.query(
        `SELECT id FROM soft_pull_requests WHERE client_id = $1`, [client]
      )).rows;
      assert.deepEqual(pulls, [], "a one-cent payment ordered a fresh credit report");
    });

    test("a zero-amount webhook is refused, and NOTHING WAS MAILED either", async () => {
      const req = await openRequest();
      const lettersBefore = (await db.query(
        `SELECT count(*)::int AS n FROM dispute_letters WHERE client_id = $1`, [client]
      )).rows[0].n;

      const out = await onPaidServicePaymentReceived(
        paymentEvent(req.id, { amountCents: 0 }), db
      );
      assert.equal(out.done, false);
      assert.equal(out.reason, "payment_short");

      const lettersAfter = (await db.query(
        `SELECT count(*)::int AS n FROM dispute_letters WHERE client_id = $1`, [client]
      )).rows[0].n;
      assert.equal(lettersAfter, lettersBefore, "a zero-cent payment produced dispute letters");
      assert.equal((await rowOf(req.id)).status, "failed");
    });

    test("a webhook with NO amount is still honoured — unknown is not short", async () => {
      // NULL MEANS UNKNOWN (CLAUDE.md §12). The guard must not turn a webhook
      // that simply does not state a figure into an accusation of underpayment.
      const req = await openRequest();
      const out = await onPaidServicePaymentReceived(
        paymentEvent(req.id, { amountCents: null, amount: null }), db
      );
      assert.equal(out.done, true, JSON.stringify(out));
      const row = await rowOf(req.id);
      assert.equal(row.status, "staged");
      assert.equal(row.produced.payment_amount_source, "quote");
      assert.equal(Number(row.amount_paid_cents), 10_000);
    });
  });

  describe("payments this handler must ignore", () => {
    test("a payment with no reference at all", async () => {
      const out = await onPaidServicePaymentReceived(
        { name: "payment.received", orgId: org, payload: { amountCents: 500_000 } }, db
      );
      assert.equal(out.done, false);
      assert.equal(out.reason, "no_paid_service_ref");
    });

    test("a payment-link reference belonging to another system", async () => {
      const out = await onPaidServicePaymentReceived(
        { name: "payment.received", orgId: org, payload: { ref: "pl_9f8e7d6c5b4a" } }, db
      );
      assert.equal(out.done, false);
      assert.equal(out.reason, "no_paid_service_ref");
    });

    test("a reference naming ANOTHER COMPANY's request touches nothing", async () => {
      const req = await openRequest();
      const out = await onPaidServicePaymentReceived(
        { ...paymentEvent(req.id), orgId: foreignOrg }, db
      );
      assert.equal(out.done, false);
      assert.equal(out.reason, "paid_service_request_not_found");
      const row = await rowOf(req.id);
      assert.equal(row.status, "awaiting_payment",
        "another company's payment event moved this company's request");
      assert.equal(row.paid_at, null);
    });

    test("a reference naming nothing at all", async () => {
      const out = await onPaidServicePaymentReceived(
        paymentEvent("00000000-0000-0000-0000-000000000000"), db
      );
      assert.equal(out.done, false);
      assert.equal(out.reason, "paid_service_request_not_found");
    });
  });

  // ── the refusal that happens after the money is taken ─────────────────────

  test("the report cannot be ordered: the request FAILS loudly rather than looking healthy", async () => {
    const req = await openRequest();
    await db.query(
      `UPDATE client_consents
          SET revoked_at = now(), revoked_reason = 'test', revoked_by_kind = 'staff',
              revoked_by_staff_id = $2
        WHERE client_id = $1 AND kind = 'soft_pull_consent' AND revoked_at IS NULL`,
      [client, staffId]
    );
    const out = await onPaidServicePaymentReceived(paymentEvent(req.id), db);

    assert.equal(out.done, false);
    assert.equal(out.reason, "pull_failed");
    const row = await rowOf(req.id);
    assert.equal(row.status, "failed");
    assert.match(row.state_reason, /pull_refused/);
    assert.ok(row.paid_at, "the record that money was taken was thrown away with the failure");
    assert.equal(Number(row.amount_paid_cents), 10_000);
  });

  // ── registration ──────────────────────────────────────────────────────────

  test("register() puts this handler on payment.received", () => {
    register();
    assert.ok(getHandlers("payment.received").includes(onPaidServicePaymentReceived),
      "register() did not attach the handler to the bus");
  });
});
