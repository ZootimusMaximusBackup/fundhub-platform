// POST /api/brand/review — who may move a partner brand, and to where.
//
// THIS FILE LIVES UNDER src/http/, NOT NEXT TO THE HANDLER. package.json's test
// glob is "src/**" and "scripts/**"; a test placed under api/ is never collected
// and passes forever by never running. The handler is imported from here.
//
// WHAT THESE ASSERT AGAINST. Every refusal is checked against partner_brand
// itself, not only against the JSON the handler returned. A 403 body is the
// endpoint's account of what it did; the row is what it did. A gate that answers
// 403 and writes anyway is the exact failure this file exists to catch, and only
// the table can see it.
//
// THE FOUR RULES, one test each:
//   a partner submits their OWN brand                       → draft becomes review
//   a partner CANNOT submit another partner's               → the other row is untouched
//   a partner CANNOT approve, their own or anyone's         → 403, row untouched
//   owner/admin staff CAN approve a submitted brand         → review becomes approved
// plus the transitions that must be refused rather than applied.
//
// Skipped without DATABASE_URL like every other *.pg.test.mjs. The handler is
// imported inside before() so the skip is a real skip.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { createSession } from "../auth/session.mjs";
import { createAccount, createAccountSession } from "../auth/account-session.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;

// Sentinels. Everything this file creates carries one of these, and the purge
// runs before() as well as after(): a crashed previous run must not collide with
// the unique indexes on staff email or partner slug.
const MARK = "brandreview-pgtest";
const MARK_LIKE = `${MARK}%`;

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; return r; };
  r.getHeader = (k) => r.headers[String(k).toLowerCase()];
  return r;
};

describe("POST /api/brand/review", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let handler, org;
  let partnerA, partnerB;
  let tokPartnerA, tokOwner, tokCloser;

  /* No injection seam, deliberately: the handler runs the real requirePrincipal
     against the real sessions/account_sessions tables, so every call carries a
     token minted for a real row. */
  const call = async (body, tok, method = "POST") => {
    const r = res();
    await handler({
      method,
      query: {},
      body,
      headers: tok ? { authorization: "Bearer " + tok } : {}
    }, r);
    return r;
  };

  const statusOf = async (partnerId) => (await db.query(
    `SELECT approval_status, submitted_at, submitted_by, approved_at, approved_by, review_note
       FROM partner_brand WHERE partner_id = $1`, [partnerId])).rows[0];

  const setStatus = async (partnerId, status) => db.query(
    `UPDATE partner_brand
        SET approval_status = $2,
            approved_at = CASE WHEN $2 = 'approved' THEN now() ELSE NULL END,
            approved_by = NULL, submitted_at = NULL, submitted_by = NULL, review_note = NULL
      WHERE partner_id = $1`, [partnerId, status]);

  before(async () => {
    ({ default: handler } = await import("../../api/brand/review.mjs"));
    org = await resolveDefaultOrg(db);
    await purge();

    const mkPartner = async (n) => (await db.query(
      `INSERT INTO partners (org_id, name, slug, status)
       VALUES ($1,$2,$3,'active') RETURNING id`,
      [org, `${MARK} ${n}`, `${MARK}-${n}`.toLowerCase()])).rows[0].id;
    partnerA = await mkPartner("alpha");
    partnerB = await mkPartner("bravo");

    // Both partners have a saved brand, both starting as drafts.
    for (const p of [partnerA, partnerB]) {
      await db.query(
        `INSERT INTO partner_brand (org_id, partner_id, entity_name, approval_status)
         VALUES ($1,$2,$3,'draft')`, [org, p, `${MARK} Co`]);
    }

    const mkStaff = async (role) => (await db.query(
      `INSERT INTO staff (org_id, name, role, email, status)
       VALUES ($1,$2,$3,$4,'active') RETURNING id`,
      [org, `${MARK} ${role}`, role, `${MARK}.${role}@example.com`])).rows[0].id;
    const ownerId = await mkStaff("owner");
    const closerId = await mkStaff("closer");
    tokOwner = (await createSession(db, { staffId: ownerId, orgId: org })).token;
    tokCloser = (await createSession(db, { staffId: closerId, orgId: org })).token;

    // Partner accounts are invite-only, and accounts.invited_by is a foreign key,
    // so the inviter has to be a real staff row.
    const acct = await createAccount(db, {
      orgId: org, kind: "partner", email: `${MARK}.partnera@example.com`,
      password: "a-long-enough-password-1", invitedBy: ownerId, partnerId: partnerA
    });
    tokPartnerA = (await createAccountSession(db, { accountId: acct.id, orgId: org })).token;
  });

  async function purge() {
    await db.query(`DELETE FROM account_sessions WHERE account_id IN
      (SELECT id FROM accounts WHERE email LIKE $1)`, [MARK_LIKE]);
    await db.query(`DELETE FROM accounts WHERE email LIKE $1`, [MARK_LIKE]);
    await db.query(`DELETE FROM sessions WHERE staff_id IN
      (SELECT id FROM staff WHERE email LIKE $1)`, [MARK_LIKE]);
    await db.query(`DELETE FROM partner_brand WHERE partner_id IN
      (SELECT id FROM partners WHERE slug LIKE $1)`, [MARK_LIKE]);
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [MARK_LIKE]);
    await db.query(`DELETE FROM partners WHERE slug LIKE $1`, [MARK_LIKE]);
  }

  after(async () => { await purge(); await close(); });

  // ── the seam that was missing ────────────────────────────────────────────

  test("a partner sends their OWN brand for review", async () => {
    await setStatus(partnerA, "draft");
    const r = await call({ partner_id: partnerA, action: "submit" }, tokPartnerA);
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(r.body.approval_status, "review");

    const row = await statusOf(partnerA);
    assert.equal(row.approval_status, "review", "the row did not move");
    assert.ok(row.submitted_at, "submitted_at was not recorded");
    // A partner signs in through accounts, not staff, so there is no staff id to
    // record. NULL means unknown and must survive rather than be invented.
    assert.equal(row.submitted_by, null);
  });

  test("a partner CANNOT submit another partner's brand", async () => {
    await setStatus(partnerA, "draft");
    await setStatus(partnerB, "draft");

    // partnerA's token, partnerB's id in the body. The id in the request is
    // ignored, never honoured, so this submits A's brand and leaves B alone.
    const r = await call({ partner_id: partnerB, action: "submit" }, tokPartnerA);
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(r.body.partner_id, partnerA, "the request's partner_id was honoured");

    assert.equal((await statusOf(partnerB)).approval_status, "draft",
      "a partner moved another partner's brand");
  });

  test("a partner CANNOT approve — not even their own brand", async () => {
    await setStatus(partnerA, "review");
    const r = await call({ partner_id: partnerA, action: "approve" }, tokPartnerA);
    assert.equal(r.code, 403, JSON.stringify(r.body));

    const row = await statusOf(partnerA);
    assert.equal(row.approval_status, "review", "a partner approved their own brand");
    assert.equal(row.approved_at, null);
  });

  test("a partner CANNOT reject", async () => {
    await setStatus(partnerA, "review");
    const r = await call({ partner_id: partnerA, action: "reject", note: "no" }, tokPartnerA);
    assert.equal(r.code, 403, JSON.stringify(r.body));
    assert.equal((await statusOf(partnerA)).approval_status, "review");
  });

  test("the owner approves a submitted brand, and approved_at moves with it", async () => {
    await setStatus(partnerA, "review");
    const r = await call({ partner_id: partnerA, action: "approve" }, tokOwner);
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(r.body.approval_status, "approved");

    const row = await statusOf(partnerA);
    assert.equal(row.approval_status, "approved");
    // 043's CHECK couples these two; a row that reached 'approved' with a null
    // approved_at could not have been written at all.
    assert.ok(row.approved_at, "approved_at was not set");
    assert.ok(row.approved_by, "approved_by was not recorded");
  });

  test("the owner rejects with a reason, and the brand goes back to draft", async () => {
    await setStatus(partnerA, "review");
    const r = await call(
      { partner_id: partnerA, action: "reject", note: "Legal entity does not match the filing." },
      tokOwner);
    assert.equal(r.code, 200, JSON.stringify(r.body));

    const row = await statusOf(partnerA);
    assert.equal(row.approval_status, "draft");
    assert.equal(row.approved_at, null);
    assert.match(row.review_note, /does not match the filing/);
  });

  test("a rejection with no reason is refused", async () => {
    await setStatus(partnerA, "review");
    const r = await call({ partner_id: partnerA, action: "reject" }, tokOwner);
    assert.equal(r.code, 400, JSON.stringify(r.body));
    assert.equal((await statusOf(partnerA)).approval_status, "review");
  });

  test("submitting again clears the last reviewer's note", async () => {
    await setStatus(partnerA, "review");
    await call({ partner_id: partnerA, action: "reject", note: "Fix the address." }, tokOwner);
    assert.match((await statusOf(partnerA)).review_note, /Fix the address/);

    const r = await call({ partner_id: partnerA, action: "submit" }, tokPartnerA);
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal((await statusOf(partnerA)).review_note, null,
      "a stale rejection reason survived the next submission");
  });

  // ── transitions that must be refused, not applied ────────────────────────

  test("approving a DRAFT is refused", async () => {
    await setStatus(partnerA, "draft");
    const r = await call({ partner_id: partnerA, action: "approve" }, tokOwner);
    assert.equal(r.code, 409, JSON.stringify(r.body));
    assert.equal((await statusOf(partnerA)).approval_status, "draft");
    assert.equal((await statusOf(partnerA)).approved_at, null);
  });

  test("submitting a brand that is already in review is refused", async () => {
    await setStatus(partnerA, "review");
    const r = await call({ partner_id: partnerA, action: "submit" }, tokPartnerA);
    assert.equal(r.code, 409, JSON.stringify(r.body));
    assert.equal((await statusOf(partnerA)).approval_status, "review");
  });

  test("submitting an APPROVED brand is refused", async () => {
    await setStatus(partnerA, "approved");
    const r = await call({ partner_id: partnerA, action: "submit" }, tokPartnerA);
    assert.equal(r.code, 409, JSON.stringify(r.body));
    assert.equal((await statusOf(partnerA)).approval_status, "approved");
  });

  test("an unknown action is refused before anything is read", async () => {
    await setStatus(partnerA, "draft");
    const r = await call({ partner_id: partnerA, action: "publish" }, tokPartnerA);
    assert.equal(r.code, 400, JSON.stringify(r.body));
    assert.equal((await statusOf(partnerA)).approval_status, "draft");
  });

  // ── the other gates ──────────────────────────────────────────────────────

  test("a staff member who is not owner or admin is refused", async () => {
    await setStatus(partnerA, "review");
    const r = await call({ partner_id: partnerA, action: "approve" }, tokCloser);
    assert.equal(r.code, 403, JSON.stringify(r.body));
    assert.equal((await statusOf(partnerA)).approval_status, "review");
  });

  test("no session at all is refused", async () => {
    await setStatus(partnerA, "draft");
    const r = await call({ partner_id: partnerA, action: "submit" }, null);
    assert.equal(r.code, 401, JSON.stringify(r.body));
    assert.equal((await statusOf(partnerA)).approval_status, "draft");
  });

  test("a staff caller who names no partner is refused", async () => {
    const r = await call({ action: "approve" }, tokOwner);
    assert.equal(r.code, 400, JSON.stringify(r.body));
  });

  test("a partner with no saved brand is told to save first, not 500", async () => {
    const partnerC = (await db.query(
      `INSERT INTO partners (org_id, name, slug, status)
       VALUES ($1,$2,$3,'active') RETURNING id`,
      [org, `${MARK} charlie`, `${MARK}-charlie`])).rows[0].id;
    const r = await call({ partner_id: partnerC, action: "submit" }, tokOwner);
    assert.equal(r.code, 404, JSON.stringify(r.body));
    assert.match(String(r.body.message), /save the brand first/i);
  });

  test("GET is not allowed — this endpoint only writes", async () => {
    const r = await call({}, tokOwner, "GET");
    assert.equal(r.code, 405);
  });
});
