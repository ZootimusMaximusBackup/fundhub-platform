// POST /api/social/posts — who may release a post the copy check held, and what
// happens to the two tables when they do.
//
// THIS FILE LIVES UNDER src/http/, NOT NEXT TO THE HANDLER. package.json's test
// glob is "src/**" and "scripts/**"; a test placed under api/ is never collected
// and passes forever by never running. The handler is imported from here.
//
// WHAT IT IS FOR. 240 gave a held post somewhere to sit and nothing could move it
// out again. The two actions added to this endpoint are the way out, and the two
// things that can go wrong with them are (a) the wrong person releasing a post
// and (b) the two tables disagreeing afterwards — social_posts is what actually
// sends, marketing_content_queue is what the screen shows. Every assertion below
// is made against the ROWS as well as the JSON: a gate that answers 403 and
// writes anyway is exactly what this file exists to catch, and only the tables
// can see it.
//
// THE GATE TRIGGER IS REAL HERE. 240's social_post_screen_gate() is a BEFORE
// UPDATE OF status trigger that refuses to let a held post into 'queued' unless
// approved_at is set in the same statement. That is why the approve test asserts
// on the row: if the handler ever split the signature from the status change,
// this test fails at the database, not in an assertion.
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

// Sentinels. Everything this file creates carries one, and the purge runs in
// before() as well as after(): a crashed previous run must not collide with the
// unique indexes on staff email or partner slug.
const MARK = "socialapprove-pgtest";
const MARK_LIKE = `${MARK}%`;

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; return r; };
  r.getHeader = (k) => r.headers[String(k).toLowerCase()];
  return r;
};

describe("POST /api/social/posts — approve and refuse a held post", {
  skip: !HAVE_DB ? "no DATABASE_URL" : false
}, () => {
  let handler, org, partnerId, channelId;
  let ownerId, tokOwner, tokCloser, tokPartner;
  // A SECOND COMPANY. Everything about it is a copy of the first: its own org
  // row, its own partner, its own social account. Nothing signs in as it — the
  // point is what an owner of the FIRST company can reach.
  let orgB, partnerB, channelB;

  /* No injection seam, deliberately: the handler runs the real requirePrincipal
     against the real sessions/account_sessions tables, so every call carries a
     token minted for a real row. */
  const call = async (body, tok) => {
    const r = res();
    await handler({
      method: "POST",
      query: {},
      body,
      headers: tok ? { authorization: "Bearer " + tok } : {}
    }, r);
    return r;
  };

  const postRow = async (id) => (await db.query(
    `SELECT status, approved_at, approved_by, blocked_reasons
       FROM social_posts WHERE id = $1`, [id])).rows[0];

  const queueRow = async (id) => (await db.query(
    `SELECT status, social_post_id, blocked_reasons
       FROM marketing_content_queue WHERE id = $1`, [id])).rows[0];

  /* One held post, made the way the product makes one: a social_posts row in the
     holding pen, a screening row saying a person must sign it off (without which
     240's gate refuses every status change), and the queue row the screen reads.
     Fresh per test, because approving one is a one-way move. */
  async function seedHeld({ queueStatus = "awaiting_approval",
                           inOrg = null, forPartner = null, onChannel = null } = {}) {
    // The three overrides exist for one test: the same held post, made the same
    // way, but belonging to a DIFFERENT company. Left null everywhere else, so
    // every other test seeds exactly what it seeded before.
    const o = inOrg || org, pt = forPartner || partnerId, ch = onChannel || channelId;

    const postId = (await db.query(
      `INSERT INTO social_posts
         (org_id, partner_id, channel_id, caption, offer_type, status, scheduled_for)
       VALUES ($1,$2,$3,$4,'credit_repair','awaiting_approval', now() + interval '1 day')
       RETURNING id`,
      [o, pt, ch, `${MARK} held copy`])).rows[0].id;

    await db.query(
      `INSERT INTO compliance_screenings
         (org_id, partner_id, subject_type, subject_id, offer_type, state, reasons, screened_text)
       VALUES ($1,$2,'social_post',$3,'credit_repair','needs_approval',$4::jsonb,$5)`,
      [o, pt, postId,
       JSON.stringify([{ code: "human_approval_required_credit_repair", rule_set: "approval",
                         message: "Credit-repair copy always needs a person." }]),
       `${MARK} held copy`]);

    const queueId = (await db.query(
      `INSERT INTO marketing_content_queue
         (org_id, partner_id, caption, offer_type, status, social_post_id, scheduled_for)
       VALUES ($1,$2,$3,'credit_repair',$4,$5, now() + interval '1 day')
       RETURNING id`,
      [o, pt, `${MARK} held copy`, queueStatus, postId])).rows[0].id;

    return { postId, queueId };
  }

  before(async () => {
    ({ default: handler } = await import("../../api/social/posts.mjs"));
    org = await resolveDefaultOrg(db);
    await purge();

    partnerId = (await db.query(
      `INSERT INTO partners (org_id, name, slug, status)
       VALUES ($1,$2,$3,'active') RETURNING id`,
      [org, `${MARK} partner`, `${MARK}-partner`])).rows[0].id;

    // The endpoint refuses every write when the marketing suite is off, so the
    // fixture turns it on. That switch is not what this file is testing.
    await db.query(
      `INSERT INTO partner_module_settings (org_id, partner_id, marketing_suite_enabled)
       VALUES ($1,$2,true)`, [org, partnerId]);

    /* connection_state stays 'pending': 049 has a CHECK that an active channel
       must carry a token, and this file has no business minting ciphertext.
       Whether the account can post is not what approval decides — the post is
       held by the copy check, not by the account. */
    channelId = (await db.query(
      `INSERT INTO social_channels
         (org_id, partner_id, channel, external_account_id, handle, connection_state)
       VALUES ($1,$2,'facebook',$3,$4,'pending') RETURNING id`,
      [org, partnerId, `${MARK}-acct`, `${MARK}-handle`])).rows[0].id;

    const mkStaff = async (role) => (await db.query(
      `INSERT INTO staff (org_id, name, role, email, status)
       VALUES ($1,$2,$3,$4,'active') RETURNING id`,
      [org, `${MARK} ${role}`, role, `${MARK}.${role}@example.com`])).rows[0].id;
    ownerId = await mkStaff("owner");
    const closerId = await mkStaff("closer");
    tokOwner = (await createSession(db, { staffId: ownerId, orgId: org })).token;
    tokCloser = (await createSession(db, { staffId: closerId, orgId: org })).token;

    // Partner accounts are invite-only and accounts.invited_by is a foreign key,
    // so the inviter has to be a real staff row.
    const acct = await createAccount(db, {
      orgId: org, kind: "partner", email: `${MARK}.partner@example.com`,
      password: "a-long-enough-password-1", invitedBy: ownerId, partnerId
    });
    tokPartner = (await createAccountSession(db, { accountId: acct.id, orgId: org })).token;

    orgB = (await db.query(
      `INSERT INTO orgs (slug, name) VALUES ($1,$2)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [`${MARK}-org-b`, `${MARK} other company`])).rows[0].id;
    partnerB = (await db.query(
      `INSERT INTO partners (org_id, name, slug, status)
       VALUES ($1,$2,$3,'active') RETURNING id`,
      [orgB, `${MARK} partner b`, `${MARK}-partner-b`])).rows[0].id;
    // Turned on for the same reason the first partner's is: a suite that is off
    // refuses every write, and a refusal for the wrong reason proves nothing
    // about who may reach whose post.
    await db.query(
      `INSERT INTO partner_module_settings (org_id, partner_id, marketing_suite_enabled)
       VALUES ($1,$2,true)`, [orgB, partnerB]);
    channelB = (await db.query(
      `INSERT INTO social_channels
         (org_id, partner_id, channel, external_account_id, handle, connection_state)
       VALUES ($1,$2,'facebook',$3,$4,'pending') RETURNING id`,
      [orgB, partnerB, `${MARK}-acct-b`, `${MARK}-handle-b`])).rows[0].id;
  });

  async function purge() {
    await db.query(`DELETE FROM account_sessions WHERE account_id IN
      (SELECT id FROM accounts WHERE email LIKE $1)`, [MARK_LIKE]);
    await db.query(`DELETE FROM accounts WHERE email LIKE $1`, [MARK_LIKE]);
    await db.query(`DELETE FROM sessions WHERE staff_id IN
      (SELECT id FROM staff WHERE email LIKE $1)`, [MARK_LIKE]);
    // Queue rows first: they point at social_posts.
    await db.query(`DELETE FROM marketing_content_queue WHERE partner_id IN
      (SELECT id FROM partners WHERE slug LIKE $1)`, [MARK_LIKE]);
    /* Screening rows refuse to be deleted — a check result is kept for good and
       a trigger enforces it. The fixture's own rows still have to go, or the
       partner they point at can never be removed either, so the trigger is
       switched off for exactly this delete and switched straight back on. Copied
       from src/social/social.pg.test.mjs, which cleans up the same table the
       same way. */
    await db.query(`ALTER TABLE compliance_screenings DISABLE TRIGGER trg_compliance_screenings_no_delete`);
    try {
      await db.query(`DELETE FROM compliance_screenings WHERE partner_id IN
        (SELECT id FROM partners WHERE slug LIKE $1)`, [MARK_LIKE]);
    } finally {
      await db.query(`ALTER TABLE compliance_screenings ENABLE TRIGGER trg_compliance_screenings_no_delete`);
    }
    await db.query(`DELETE FROM social_posts WHERE partner_id IN
      (SELECT id FROM partners WHERE slug LIKE $1)`, [MARK_LIKE]);
    // Staff AFTER the posts: an approved post records who approved it, and
    // social_posts.approved_by is a foreign key onto this row.
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [MARK_LIKE]);
    await db.query(`DELETE FROM social_channels WHERE partner_id IN
      (SELECT id FROM partners WHERE slug LIKE $1)`, [MARK_LIKE]);
    await db.query(`DELETE FROM partner_module_settings WHERE partner_id IN
      (SELECT id FROM partners WHERE slug LIKE $1)`, [MARK_LIKE]);
    await db.query(`DELETE FROM partners WHERE slug LIKE $1`, [MARK_LIKE]);
    // Last: every row above carries an org_id pointing at it.
    await db.query(`DELETE FROM orgs WHERE slug LIKE $1`, [MARK_LIKE]);
  }

  after(async () => { await purge(); await close(); });

  // ── the way out of the holding pen ───────────────────────────────────────

  test("an owner approves a held post, and it is lined up with a signature", async () => {
    const { postId, queueId } = await seedHeld();
    const r = await call({ partner_id: partnerId, id: queueId, action: "approve" }, tokOwner);
    assert.equal(r.code, 200, JSON.stringify(r.body));

    const post = await postRow(postId);
    assert.equal(post.status, "queued", "the post did not leave the holding pen");
    // 240's gate reads NEW.approved_at in the same statement as the status
    // change, so a post that reached 'queued' without this could not have been
    // written at all — asserted anyway, because that is the record of who
    // released it and it must not be silently dropped.
    assert.ok(post.approved_at, "approved_at was not recorded");
    assert.equal(post.approved_by, ownerId, "the wrong person was recorded as approving it");

    const q = await queueRow(queueId);
    assert.equal(q.status, "scheduled",
      "the screen's row still disagrees with the post that will actually send");
  });

  test("an owner refuses a held post, and it stops for good", async () => {
    const { postId, queueId } = await seedHeld();
    const r = await call({ partner_id: partnerId, id: queueId, action: "reject" }, tokOwner);
    assert.equal(r.code, 200, JSON.stringify(r.body));

    const post = await postRow(postId);
    assert.equal(post.status, "blocked", "a refused post can still be picked up and sent");
    assert.equal(post.approved_at, null, "refusing a post signed it off");
    assert.equal(post.approved_by, null);

    const q = await queueRow(queueId);
    assert.equal(q.status, "blocked");

    /* 'blocked' is also what the automatic check writes, so the status alone
       cannot say which happened. The reason is the only thing that can, which is
       why it is asserted here rather than treated as decoration. */
    const codes = (post.blocked_reasons || []).map((x) => x.code);
    assert.ok(codes.includes("refused_by_a_person"),
      "nothing on the post says a person refused it rather than the copy check");
    assert.ok((q.blocked_reasons || []).map((x) => x.code).includes("refused_by_a_person"),
      "the screen's row does not say why it was refused");
  });

  // ── who may not ──────────────────────────────────────────────────────────

  test("a PARTNER cannot approve their own held post", async () => {
    const { postId, queueId } = await seedHeld();
    const r = await call({ partner_id: partnerId, id: queueId, action: "approve" }, tokPartner);
    assert.equal(r.code, 403, JSON.stringify(r.body));

    const post = await postRow(postId);
    assert.equal(post.status, "awaiting_approval", "a partner released their own held post");
    assert.equal(post.approved_at, null);
    assert.equal((await queueRow(queueId)).status, "awaiting_approval");
  });

  test("a PARTNER cannot refuse a held post either", async () => {
    const { postId, queueId } = await seedHeld();
    const r = await call({ partner_id: partnerId, id: queueId, action: "reject" }, tokPartner);
    assert.equal(r.code, 403, JSON.stringify(r.body));
    assert.equal((await postRow(postId)).status, "awaiting_approval");
    assert.equal((await queueRow(queueId)).status, "awaiting_approval");
  });

  test("an employee who is not an owner or an admin is refused", async () => {
    const { postId, queueId } = await seedHeld();
    const r = await call({ partner_id: partnerId, id: queueId, action: "approve" }, tokCloser);
    assert.equal(r.code, 403, JSON.stringify(r.body));

    const post = await postRow(postId);
    assert.equal(post.status, "awaiting_approval", "any signed-in employee could release a held post");
    assert.equal(post.approved_at, null);
  });

  test("no session at all is refused", async () => {
    const { postId, queueId } = await seedHeld();
    const r = await call({ partner_id: partnerId, id: queueId, action: "approve" }, null);
    assert.equal(r.code, 401, JSON.stringify(r.body));
    assert.equal((await postRow(postId)).status, "awaiting_approval");
  });

  // ── what must be refused rather than applied ─────────────────────────────

  test("approving a post that is not held is refused", async () => {
    // A queue row that was never held. Approving it would resurrect a post the
    // copy check never stopped, or one that has already gone out.
    const { postId, queueId } = await seedHeld({ queueStatus: "draft" });
    const r = await call({ partner_id: partnerId, id: queueId, action: "approve" }, tokOwner);
    assert.equal(r.code, 409, JSON.stringify(r.body));
    assert.match(String(r.body.message), /not waiting for a person/);

    const post = await postRow(postId);
    assert.equal(post.status, "awaiting_approval", "a post that was not held was moved anyway");
    assert.equal(post.approved_at, null);
    assert.equal((await queueRow(queueId)).status, "draft");
  });

  test("refusing a post that is not held is refused", async () => {
    const { postId, queueId } = await seedHeld({ queueStatus: "draft" });
    const r = await call({ partner_id: partnerId, id: queueId, action: "reject" }, tokOwner);
    assert.equal(r.code, 409, JSON.stringify(r.body));
    assert.equal((await postRow(postId)).status, "awaiting_approval");
    assert.equal((await queueRow(queueId)).status, "draft");
  });

  test("somebody else moving the post first changes nothing", async () => {
    const { postId, queueId } = await seedHeld();
    /* The queue row still says held; the post itself has already been refused by
       somebody else. A reason goes with it because 049 will not accept a blocked
       post without one — which is also why the handler's own refusal writes the
       reason in the same statement as the status. Both of the handler's updates
       are in one transaction, so the queue row must not move either. */
    await db.query(
      `UPDATE social_posts
          SET status = 'blocked', blocked_reasons = $2::jsonb WHERE id = $1`,
      [postId, JSON.stringify([{ code: "refused_by_a_person", rule_set: "approval",
                                 message: "Somebody else got there first." }])]);

    const r = await call({ partner_id: partnerId, id: queueId, action: "approve" }, tokOwner);
    assert.equal(r.code, 409, JSON.stringify(r.body));

    const post = await postRow(postId);
    assert.equal(post.status, "blocked", "a post somebody else had already stopped was released");
    assert.equal(post.approved_at, null);
    assert.equal((await queueRow(queueId)).status, "awaiting_approval",
      "the screen's row moved even though the post did not");
  });

  test("a queue row with no post behind it is refused, not guessed at", async () => {
    const queueId = (await db.query(
      `INSERT INTO marketing_content_queue
         (org_id, partner_id, caption, offer_type, status)
       VALUES ($1,$2,$3,'credit_repair','awaiting_approval') RETURNING id`,
      [org, partnerId, `${MARK} orphan copy`])).rows[0].id;

    const r = await call({ partner_id: partnerId, id: queueId, action: "approve" }, tokOwner);
    assert.equal(r.code, 409, JSON.stringify(r.body));
    assert.equal((await queueRow(queueId)).status, "awaiting_approval");
  });

  test("somebody else APPROVING the post first makes a refusal change nothing", async () => {
    const { postId, queueId } = await seedHeld();
    /* The mirror of the test above, and the one the refuse arm used to fail.
       The queue row still says held; the post has already been approved by
       somebody else and is lined up to send. 240's gate refuses a held post
       into 'queued' unless the signature is set in the same statement, so this
       is written exactly the way a real approve writes it.

       What went wrong before: the refusal did not look at how many rows it
       changed. It changed none — the post was no longer held — but it still
       marked the screen's row 'blocked' and answered 200. The owner was told
       the post was stopped while the post was still queued and would still
       have gone out. */
    await db.query(
      `UPDATE social_posts
          SET status = 'queued', approved_at = now(), approved_by = $2
        WHERE id = $1`, [postId, ownerId]);

    const r = await call({ partner_id: partnerId, id: queueId, action: "reject" }, tokOwner);
    assert.equal(r.code, 409, JSON.stringify(r.body));

    const post = await postRow(postId);
    assert.equal(post.status, "queued",
      "a refusal that answered success left the post free to go out");
    assert.ok(post.approved_at, "the other person's approval was wiped");
    assert.equal((post.blocked_reasons || []).length, 0,
      "a reason was written onto a post the refusal did not stop");

    const q = await queueRow(queueId);
    assert.equal(q.status, "awaiting_approval",
      "the screen's row said blocked while the post was still queued to send");
    assert.equal((q.blocked_reasons || []).length, 0);
  });

  // ── one company's owner may not touch another company's post ─────────────

  /* Row-level security scopes the transaction to the partner NAMED IN THE BODY,
     which says nothing about whether that partner belongs to the caller. These
     two tests are the only thing standing between an owner of one company and
     every other company's held posts. Both tables are read afterwards, because
     a 404 that wrote anyway is exactly the failure worth catching. */
  test("an owner of one company cannot approve another company's held post", async () => {
    const { postId, queueId } = await seedHeld({
      inOrg: orgB, forPartner: partnerB, onChannel: channelB });

    const r = await call({ partner_id: partnerB, id: queueId, action: "approve" }, tokOwner);
    assert.equal(r.code, 404, JSON.stringify(r.body));

    // Made-up id, same call. The two answers must be word for word the same, or
    // the endpoint confirms that another company's post is real.
    const missing = await call(
      { partner_id: partnerB, id: "00000000-0000-4000-8000-000000000000", action: "approve" },
      tokOwner);
    assert.equal(missing.code, r.code);
    assert.deepEqual(r.body, missing.body,
      "the answer for another company's post differs from the answer for no post at all");

    const post = await postRow(postId);
    assert.equal(post.status, "awaiting_approval", "another company's post was released");
    assert.equal(post.approved_at, null);
    assert.equal(post.approved_by, null);
    assert.equal((await queueRow(queueId)).status, "awaiting_approval");
  });

  test("an owner of one company cannot refuse another company's held post", async () => {
    const { postId, queueId } = await seedHeld({
      inOrg: orgB, forPartner: partnerB, onChannel: channelB });

    const r = await call({ partner_id: partnerB, id: queueId, action: "reject" }, tokOwner);
    assert.equal(r.code, 404, JSON.stringify(r.body));

    const post = await postRow(postId);
    assert.equal(post.status, "awaiting_approval", "another company's post was stopped for good");
    assert.equal((post.blocked_reasons || []).length, 0);

    const q = await queueRow(queueId);
    assert.equal(q.status, "awaiting_approval");
    assert.equal((q.blocked_reasons || []).length, 0);
  });
});
