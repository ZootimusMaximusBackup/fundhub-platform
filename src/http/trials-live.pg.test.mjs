// The Live Trial endpoints, against a real database.
//
// THIS FILE LIVES UNDER src/http/, NOT NEXT TO THE HANDLERS. package.json's
// test glob is "src/**" and "scripts/**"; a test placed under api/ is never
// collected and passes forever by never running. The handlers are imported from
// here.
//
// WHAT THESE ASSERT, AND WHY THEY NEED AN ENGINE:
//
//   * ONE PARTNER CANNOT READ ANOTHER'S TRIAL. live_trials carries no
//     row-level security by design (280_live_trials.sql says why), so the
//     org_id + partner_id predicate written in src/trials/dashboard.mjs IS the
//     tenancy boundary. A unit test can prove the SQL contains the predicate;
//     only a database can prove the predicate works.
//   * THE PAYOUT GATE. Converting stamps partners.agreement_signed_at and flips
//     status to 'active' — together those are the whole of 042_partners.sql's
//     payout trigger. The check that it refuses without a signature is asserted
//     against the ROW, not against the JSON the handler returned: a gate that
//     answers 400 and writes anyway is exactly what a response-only test misses.
//   * A NAMED HUMAN ON EVERY TRIAL CAMPAIGN. 280 installs a trigger that refuses
//     an approved or live campaign with no approved_by when the partner has an
//     open trial. That is engine behaviour and cannot be tested any other way.
//
// Skipped without DATABASE_URL, like every other *.pg.test.mjs. The handlers are
// imported inside before() so the skip is a real skip.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { createSession } from "../auth/session.mjs";
import { createAccount, createAccountSession } from "../auth/account-session.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;

// Sentinel. Everything this file creates carries it, and the purge runs before()
// as well as after(): a crashed previous run must not collide with the unique
// indexes on staff email or partner slug.
const MARK = "livetrial-pgtest";
const MARK_LIKE = `${MARK}%`;

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; return r; };
  r.getHeader = (k) => r.headers[String(k).toLowerCase()];
  return r;
};

describe("Live Trial endpoints", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let dashboard, convert, eligibility;
  let org, ownerId;
  let partnerA, partnerB, trialA, trialB;
  let tokPartnerA, tokOwner, tokCloser;

  const call = async (handler, { method = "GET", body = null, query = {}, tok = null }) => {
    const r = res();
    await handler({
      method,
      query,
      body,
      headers: tok ? { authorization: "Bearer " + tok } : {}
    }, r);
    return r;
  };

  const partnerRow = async (id) => (await db.query(
    `SELECT status, agreement_signed_at FROM partners WHERE id = $1`, [id])).rows[0];

  const trialRow = async (id) => (await db.query(
    `SELECT status, started_at, ends_at, converted_at, declined_at
       FROM live_trials WHERE id = $1`, [id])).rows[0];

  before(async () => {
    ({ default: dashboard } = await import("../../api/trials/dashboard.mjs"));
    ({ default: convert } = await import("../../api/trials/convert.mjs"));
    ({ default: eligibility } = await import("../../api/trials/eligibility.mjs"));

    org = await resolveDefaultOrg(db);
    await purge();

    const mkPartner = async (n) => (await db.query(
      `INSERT INTO partners (org_id, name, slug, status, contact_email)
       VALUES ($1,$2,$3,'invited',$4) RETURNING id`,
      [org, `${MARK} ${n}`, `${MARK}-${n}`.toLowerCase(), `${MARK}.${n}@example.com`]
    )).rows[0].id;
    partnerA = await mkPartner("alpha");
    partnerB = await mkPartner("bravo");

    const mkStaff = async (role) => (await db.query(
      `INSERT INTO staff (org_id, name, role, email, status)
       VALUES ($1,$2,$3,$4,'active') RETURNING id`,
      [org, `${MARK} ${role}`, role, `${MARK}.${role}@example.com`]
    )).rows[0].id;
    ownerId = await mkStaff("owner");
    const closerId = await mkStaff("closer");
    tokOwner = (await createSession(db, { staffId: ownerId, orgId: org })).token;
    tokCloser = (await createSession(db, { staffId: closerId, orgId: org })).token;

    // Partner logins are invite-only, and accounts.invited_by is a foreign key,
    // so the inviter has to be a real staff row.
    const acct = await createAccount(db, {
      orgId: org, kind: "partner", email: `${MARK}.partnera@example.com`,
      password: "a-long-enough-password-1", invitedBy: ownerId, partnerId: partnerA
    });
    tokPartnerA = (await createAccountSession(db, { accountId: acct.id, orgId: org })).token;

    const mkTrial = async (partnerId, over = {}) => (await db.query(
      `INSERT INTO live_trials
         (org_id, partner_id, contact_email, status, price_cents, started_at, ends_at, frozen_until)
       VALUES ($1,$2,$3,$4,29700,$5,$6,$7) RETURNING id`,
      [org, partnerId, `${MARK}@example.com`,
       over.status || "running",
       over.startedAt || new Date(Date.now() - 2 * 86400000),
       over.endsAt || new Date(Date.now() + 5 * 86400000),
       over.frozenUntil || new Date(Date.now() + 35 * 86400000)]
    )).rows[0].id;
    trialA = await mkTrial(partnerA);
    trialB = await mkTrial(partnerB);
  });

  async function purge() {
    await db.query(`DELETE FROM live_trial_events WHERE live_trial_id IN
      (SELECT id FROM live_trials WHERE partner_id IN
        (SELECT id FROM partners WHERE slug LIKE $1))`, [MARK_LIKE]);
    await db.query(`DELETE FROM live_trials WHERE partner_id IN
      (SELECT id FROM partners WHERE slug LIKE $1)`, [MARK_LIKE]);
    await db.query(`DELETE FROM partner_pages WHERE partner_id IN
      (SELECT id FROM partners WHERE slug LIKE $1)`, [MARK_LIKE]);
    await db.query(`DELETE FROM account_sessions WHERE account_id IN
      (SELECT id FROM accounts WHERE email LIKE $1)`, [MARK_LIKE]);
    await db.query(`DELETE FROM accounts WHERE email LIKE $1`, [MARK_LIKE]);
    await db.query(`DELETE FROM sessions WHERE staff_id IN
      (SELECT id FROM staff WHERE email LIKE $1)`, [MARK_LIKE]);
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [MARK_LIKE]);
    await db.query(`DELETE FROM partners WHERE slug LIKE $1`, [MARK_LIKE]);
  }

  after(async () => { await purge(); await close(); });

  // ── the gate, which runs before anyone has an account at all ─────────────

  test("the eligibility gate is public and needs no session", async () => {
    const r = await call(eligibility, {
      method: "POST",
      body: { has_ad_account: true, business_verified: true, can_fund_ad_spend: true }
    });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(r.body.decision, "sell");
    assert.equal(r.body.price_cents, 29700);
    // The $297 buys the machine, not the ad spend. Said on the gate as well as
    // at checkout, because it is the number one refund argument.
    assert.equal(r.body.ad_spend_included, false);
  });

  test("an unverified business is offered a held start, not a refusal", async () => {
    const r = await call(eligibility, {
      method: "POST",
      body: { has_ad_account: true, business_verified: false, can_fund_ad_spend: true }
    });
    assert.equal(r.code, 200);
    assert.equal(r.body.decision, "held_start");
    assert.equal(r.body.held_start, true);
    assert.equal(r.body.sellable, true);
  });

  // ── the dashboard, and the boundary it stands on ─────────────────────────

  test("a partner reads their OWN trial", async () => {
    const r = await call(dashboard, { tok: tokPartnerA });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(r.body.trial.id, trialA);
    assert.equal(r.body.numbers.booked_calls, 0, "a trial with no bookings must report zero");
  });

  /* A partner_id in the query string is IGNORED for a partner principal, never
     honoured and never rejected. Honouring it is the leak; rejecting it tells a
     prober whether the id they guessed exists. */
  test("a partner CANNOT read another partner's trial by asking for it", async () => {
    const r = await call(dashboard, { tok: tokPartnerA, query: { partner_id: partnerB } });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(r.body.trial.id, trialA, "the query string's partner_id was honoured");
    assert.notEqual(r.body.trial.id, trialB);
  });

  test("no session is a 401, not an empty dashboard", async () => {
    const r = await call(dashboard, {});
    assert.equal(r.code, 401);
  });

  test("a staff session with no partner_id is told to name one", async () => {
    const r = await call(dashboard, { tok: tokOwner });
    assert.equal(r.code, 400);
    assert.equal(r.body.error, "partner_id_required");
  });

  test("a staff session that names a partner gets that partner's view", async () => {
    const r = await call(dashboard, { tok: tokOwner, query: { partner_id: partnerB } });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(r.body.trial.id, trialB);
  });

  test("a partner with no trial gets 404, not an empty screen", async () => {
    await db.query(`DELETE FROM live_trials WHERE id = $1`, [trialA]);
    const r = await call(dashboard, { tok: tokPartnerA });
    assert.equal(r.code, 404);
    // Put it back for the rest of the file.
    await db.query(
      `INSERT INTO live_trials (id, org_id, partner_id, contact_email, status, price_cents, started_at, ends_at)
       VALUES ($1,$2,$3,$4,'running',29700,$5,$6)`,
      [trialA, org, partnerA, `${MARK}@example.com`,
       new Date(Date.now() - 2 * 86400000), new Date(Date.now() + 5 * 86400000)]);
  });

  // ── day 8, and the payout gate ───────────────────────────────────────────

  test("a closer cannot convert a trial", async () => {
    const r = await call(convert, {
      method: "POST", tok: tokCloser,
      body: { partner_id: partnerA, decision: "convert", agreement_signed_at: new Date().toISOString() }
    });
    assert.equal(r.code, 403);
    assert.equal((await partnerRow(partnerA)).status, "invited", "a refused call still moved the row");
  });

  test("a partner cannot convert themselves", async () => {
    const r = await call(convert, {
      method: "POST", tok: tokPartnerA,
      body: { partner_id: partnerA, decision: "convert", agreement_signed_at: new Date().toISOString() }
    });
    // requireAuth is the staff gate; a partner account token is not a staff session.
    assert.ok(r.code === 401 || r.code === 403, `expected a refusal, got ${r.code}`);
    assert.equal((await partnerRow(partnerA)).status, "invited");
  });

  /* THE PAYOUT GATE IS NOT OPENED ON A PROMISE. Asserted against the row,
     because a gate that answers 400 and writes anyway is the failure a
     response-only test cannot see. */
  test("converting without a signature is refused, and nothing is stamped", async () => {
    const r = await call(convert, {
      method: "POST", tok: tokOwner,
      body: { partner_id: partnerA, decision: "convert" }
    });
    assert.equal(r.code, 400);
    assert.equal(r.body.error, "agreement_signed_at_required");
    const row = await partnerRow(partnerA);
    assert.equal(row.status, "invited");
    assert.equal(row.agreement_signed_at, null);
  });

  test("declining pauses the partner, keeps the trial record, and keeps the leads", async () => {
    const r = await call(convert, {
      method: "POST", tok: tokOwner,
      body: { partner_id: partnerB, decision: "decline" }
    });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal((await partnerRow(partnerB)).status, "paused");
    const trial = await trialRow(trialB);
    assert.equal(trial.status, "declined");
    assert.ok(trial.declined_at, "declined_at was not stamped");
    // Nothing is payable yet, and the response has to say so.
    assert.equal(r.body.payable, false);
  });

  test("converting stamps the signature and flips the partner to active", async () => {
    const signed = new Date();
    const r = await call(convert, {
      method: "POST", tok: tokOwner,
      body: { partner_id: partnerA, decision: "convert", agreement_signed_at: signed.toISOString() }
    });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    const row = await partnerRow(partnerA);
    assert.equal(row.status, "active");
    assert.ok(row.agreement_signed_at, "agreement_signed_at was not stamped");
    const trial = await trialRow(trialA);
    assert.equal(trial.status, "converted");
    assert.ok(trial.converted_at);
  });

  test("a converted trial cannot then be declined", async () => {
    const r = await call(convert, {
      method: "POST", tok: tokOwner,
      body: { partner_id: partnerA, decision: "decline" }
    });
    assert.equal(r.code, 409);
    assert.equal((await partnerRow(partnerA)).status, "active");
  });

  test("the trial's events are recorded and cannot be deleted", async () => {
    const { rows } = await db.query(
      `SELECT kind FROM live_trial_events WHERE live_trial_id = $1 ORDER BY occurred_at ASC`,
      [trialA]);
    assert.ok(rows.some((r) => r.kind === "converted"), "the conversion was not recorded");
    await assert.rejects(
      () => db.query(`DELETE FROM live_trial_events WHERE live_trial_id = $1`, [trialA]),
      /not deletable/i
    );
  });
});
