// Approving a partner does NOT open the money door — proved against a real
// Postgres, on the database's own trigger rather than on a comment.
//
// COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7): payout timing.
//
// WHY THIS FILE. POST /api/partners/approve (api/partners/approve.mjs) turns an
// application into a live partner: it flips `partners.status` to 'active',
// mints a login, publishes a page. It deliberately does NOT stamp
// `agreement_signed_at`, and the whole safety of that split rests on a claim
// three files repeat in prose and nothing checked end to end:
//
//     "042_partners.sql refuses every payout until agreement_signed_at is set
//      AND status is 'active'. Approval only supplies the second half."
//
// src/http/partner-signup.pg.test.mjs asserts the column is still NULL after
// approval. That is the input to the gate, not the gate. If somebody dropped
// trg_partner_payout_agreement_gate, or relaxed it to check status alone, that
// assertion would still pass and an unsigned partner could be paid.
//
// So this walks the actual sequence a real approval creates:
//
//   invited   → cannot be paid (not active, and not signed)
//   approved  → active, and STILL cannot be paid, because nobody has signed
//   signed    → releases
//
// and then re-approves the signed partner, because approval is idempotent and a
// second click must not un-sign anybody.
//
// A HELD PAYOUT IS NOT BLOCKED, and that is on purpose: 042_partners.sql says
// "revenue keeps accruing; it just does not release." An accrual an unsigned
// partner is owed must still be recordable, or the debt disappears.
//
// SKIPS unless DATABASE_URL is set — every test carries the same skip, so an
// unset database reads as skipped, never as green.

import { test, before, after } from "node:test";
import assert from "node:assert";

import { db, close } from "../db.mjs";
import { ROUTES } from "../../netlify/functions/api.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { createSession } from "../auth/session.mjs";
import partnerApply from "../../api/public/partner-apply.mjs";

const HAS_DB = !!process.env.DATABASE_URL;

const STAMP = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const PERSON = `Wlgate Personname ${STAMP}`;
const COMPANY = `Wlgate Company ${STAMP}`;
const EMAIL = `wl-gate-${STAMP}@example.test`;

function makeRes() {
  return {
    statusCode: null, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
    json(o) { this.body = o; return this; }
  };
}

const call = async (handler, req) => {
  const res = makeRes();
  await handler(req, res);
  return res;
};

let orgId = null;
let ownerToken = null;
let ownerId = null;
let partnerId = null;
const payoutIds = [];

/* One payout row per attempt, at whatever status the caller is testing. The
   trigger is BEFORE INSERT OR UPDATE OF status, so an INSERT straight at
   'processing' is the same door a settlement run walks through. */
async function insertPayout(status, extra = {}) {
  const row = (await db.query(
    `INSERT INTO partner_payouts
       (org_id, partner_id, period_start, period_end, amount, status, hold_reason, paid_at)
     VALUES ($1, $2, now() - interval '30 days', now(), 1000.00, $3, $4, $5)
     RETURNING id`,
    [orgId, partnerId, status, extra.holdReason || null, extra.paidAt || null]
  )).rows[0];
  payoutIds.push(row.id);
  return row.id;
}

/* Returns the error message the database raised, or null when it let the write
   through. Asserting on null vs a message is what makes a broken gate loud. */
async function refusal(fn) {
  try {
    await fn();
    return null;
  } catch (err) {
    return String((err && err.message) || err);
  }
}

before(async () => {
  if (!HAS_DB) return;
  orgId = await resolveDefaultOrg(db);

  const owner = (await db.query(
    `INSERT INTO staff (org_id, name, email, role, status)
     VALUES ($1, $2, $3, 'owner', 'active') RETURNING id`,
    [orgId, "WL Gate Owner", `wl-gate-owner-${STAMP}@example.test`]
  )).rows[0];
  ownerId = owner.id;
  ownerToken = (await createSession(db, { staffId: owner.id, orgId })).token;

  const applied = await call(partnerApply, {
    method: "POST",
    headers: {},
    body: {
      name: PERSON,
      email: EMAIL,
      phone: "6615550142",
      company: COMPANY,
      audience: "I speak to small business owners every week.",
      track: "white_label",
      sms_consent: false
    }
  });
  assert.equal(applied.statusCode, 200, JSON.stringify(applied.body));
  partnerId = applied.body.partner_id;
});

after(async () => {
  if (!HAS_DB) return;
  try {
    if (payoutIds.length) {
      await db.query(`DELETE FROM partner_payouts WHERE id = ANY($1::uuid[])`, [payoutIds]);
    }
    if (partnerId) {
      await db.query(
        `DELETE FROM messages WHERE org_id = $1 AND provider_ref = ANY($2::text[])`,
        [orgId, [`partner:${partnerId}:welcome:email`, `partner:${partnerId}:welcome:sms`]]
      );
      await db.query(`DELETE FROM events WHERE org_id = $1 AND idempotency_key = $2`,
        [orgId, `partner.approved:${partnerId}`]);
      await db.query(`DELETE FROM cards WHERE partner_id = $1`, [partnerId]);
      await db.query(`DELETE FROM partner_pages WHERE partner_id = $1`, [partnerId]);
      await db.query(`DELETE FROM partner_brand WHERE partner_id = $1`, [partnerId]);
      await db.query(`DELETE FROM account_sessions WHERE account_id IN
        (SELECT id FROM accounts WHERE partner_id = $1)`, [partnerId]);
      await db.query(`DELETE FROM accounts WHERE partner_id = $1`, [partnerId]);
      await db.query(`DELETE FROM partners WHERE id = $1`, [partnerId]);
    }
    if (ownerId) {
      await db.query(`DELETE FROM sessions WHERE staff_id = $1`, [ownerId]);
      await db.query(`DELETE FROM staff WHERE id = $1`, [ownerId]);
    }
  } catch { /* a leftover sim row must not red the suite */ }
  await close();
});

/* ── Before approval ─────────────────────────────────────────────────────── */

test("an applicant who is still 'invited' cannot be paid",
  { skip: !HAS_DB }, async () => {
    const status = (await db.query(
      `SELECT status FROM partners WHERE id = $1`, [partnerId]
    )).rows[0].status;
    assert.equal(status, "invited", "the application must not have activated anybody");

    const msg = await refusal(() => insertPayout("processing"));
    assert.ok(msg, "a stranger who filled in a form must not be payable");
    assert.match(msg, /has not signed an agreement/i);
  });

/* ── After approval: the half approval supplies, and the half it does not ── */

test("approval makes the partner active and STILL refuses to pay them",
  { skip: !HAS_DB }, async () => {
    const res = await call(ROUTES["partners/approve"], {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}` },
      body: { partner_id: partnerId }
    });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.status, "active");
    assert.equal(res.body.agreement_signed, false,
      "the endpoint must say plainly that signing has not happened");

    const row = (await db.query(
      `SELECT status, agreement_signed_at FROM partners WHERE id = $1`, [partnerId]
    )).rows[0];
    assert.equal(row.status, "active");
    assert.equal(row.agreement_signed_at, null,
      "approval must not stamp the agreement on the partner's behalf");

    // The gate itself, not the column feeding it.
    const msg = await refusal(() => insertPayout("processing"));
    assert.ok(msg, "an active partner who has not signed must still not be paid");
    assert.match(msg, /has not signed an agreement/i);

    const paid = await refusal(() => insertPayout("paid", { paidAt: new Date() }));
    assert.ok(paid, "and cannot be jumped straight to 'paid' either");
    assert.match(paid, /has not signed an agreement/i);
  });

test("money owed to an unsigned partner is still recordable — it just does not release",
  { skip: !HAS_DB }, async () => {
    const pending = await refusal(() => insertPayout("pending"));
    assert.equal(pending, null, "an accrual an unsigned partner is owed must not vanish");

    const held = await refusal(() =>
      insertPayout("held", { holdReason: "agreement not signed" }));
    assert.equal(held, null, "holding it is the intended resting place");
  });

test("a pending payout cannot be promoted to paid while the agreement is unsigned",
  { skip: !HAS_DB }, async () => {
    const id = await insertPayout("pending");
    const msg = await refusal(() => db.query(
      `UPDATE partner_payouts SET status = 'paid', paid_at = now() WHERE id = $1`, [id]
    ));
    assert.ok(msg, "the release path is the UPDATE, and it must be shut too");
    assert.match(msg, /has not signed an agreement/i);

    const still = (await db.query(
      `SELECT status FROM partner_payouts WHERE id = $1`, [id]
    )).rows[0].status;
    assert.equal(still, "pending");
  });

/* ── Signing: the separate human act that actually opens the door ────────── */

test("once the agreement is signed the same payout releases",
  { skip: !HAS_DB }, async () => {
    await db.query(
      `UPDATE partners SET agreement_signed_at = now(), updated_at = now() WHERE id = $1`,
      [partnerId]
    );

    const msg = await refusal(() => insertPayout("paid", { paidAt: new Date() }));
    assert.equal(msg, null,
      "signed plus active is the whole gate — a partner who has done both gets paid");
  });

test("approving a second time does not un-sign a partner who has signed",
  { skip: !HAS_DB }, async () => {
    const res = await call(ROUTES["partners/approve"], {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}` },
      body: { partner_id: partnerId }
    });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));

    const row = (await db.query(
      `SELECT status, agreement_signed_at FROM partners WHERE id = $1`, [partnerId]
    )).rows[0];
    assert.equal(row.status, "active");
    assert.ok(row.agreement_signed_at,
      "a double click on Approve must not reopen a signed partner's payout hold");

    const msg = await refusal(() => insertPayout("paid", { paidAt: new Date() }));
    assert.equal(msg, null, "and must not start refusing payouts that were releasing");
  });

/* ── A paused partner ────────────────────────────────────────────────────── */

test("a signed partner who is later paused stops being payable",
  { skip: !HAS_DB }, async () => {
    await db.query(`UPDATE partners SET status = 'paused' WHERE id = $1`, [partnerId]);
    const msg = await refusal(() => insertPayout("paid", { paidAt: new Date() }));
    assert.ok(msg, "pausing a partner must stop the money, not only the login");
    assert.match(msg, /not active/i);

    // And approval refuses to quietly un-pause them back into payability.
    const res = await call(ROUTES["partners/approve"], {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}` },
      body: { partner_id: partnerId }
    });
    assert.equal(res.statusCode, 409, JSON.stringify(res.body));
    assert.equal(res.body.error, "partner_paused");

    const row = (await db.query(
      `SELECT status FROM partners WHERE id = $1`, [partnerId]
    )).rows[0];
    assert.equal(row.status, "paused", "a refused approval must change nothing");

    await db.query(`UPDATE partners SET status = 'active' WHERE id = $1`, [partnerId]);
  });
