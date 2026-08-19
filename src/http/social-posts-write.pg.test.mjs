/* A partner with NO connected social account can still work their post queue.
 * (T10-06, unit D)
 *
 * WHAT WENT WRONG LIVE, 2026-08-18/19. On Social Studio a partner wrote a post,
 * pressed "Queue post", and got "Pick an account to post to first." There was no
 * account to pick and there never can be one: connecting Facebook, Instagram or
 * LinkedIn is staff-only (api/social/oauth.mjs), and by
 * docs/journeys/white-label-intended.md that is correct — "Facebook / Instagram /
 * LinkedIn connect is for staff once those apps exist. The partner does not see a
 * Connect button that will refuse them."
 *
 * The same journey says, in the same breath, what the partner CAN do: "The
 * partner can write posts into a queue, set a time, or throw one away." All three
 * of those have to work with zero connected accounts, and the endpoint that does
 * them — POST /api/social/posts — already did. Nothing in the browser called it.
 *
 * WHAT THIS FILE IS, AND WHAT IT IS NOT. These are SERVER-CONTRACT tests. They
 * pin the promises POST /api/social/posts makes, so a later change cannot quietly
 * re-introduce a channel requirement or leak one partner's queue into another's.
 *
 * They are NOT proof of the fix in unit D, and must never be quoted as such. The
 * fix was entirely in the browser — api/social/posts.mjs was not touched by this
 * unit, so every test here passes identically against the code as it was before.
 * The tests that FAIL on the old code, and therefore prove the fix, are in
 * src/http/social-studio-screen.test.mjs, which reads the screen itself.
 *
 * THE FIXTURE HAS NO CONNECTED ACCOUNT ON PURPOSE, and one test asserts that
 * directly. Inventing a connected Facebook / Instagram / LinkedIn row to make
 * these pass would test the opposite of the thing that broke — and the app keys
 * those rows stand for do not exist.
 *
 * A pg test, not a unit test, because what is under test is the ROW: the status
 * a post lands on and the send time saved against it are column values, and only
 * a real database, with the partner row-level security policy switched on, can
 * say whether one partner reached another partner's queue.
 */
import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { createAccount, createAccountSession } from "../auth/account-session.mjs";
import postsApi from "../../api/social/posts.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const MARK = "t10dsocial";

describe("social post queue, server contract — a partner with no connected account", {
  skip: !HAVE_DB ? "no DATABASE_URL" : false
}, () => {
  let org, mine, theirs, myToken, theirToken;

  /* Call the endpoint the way the browser does. */
  const api = async (token, { method = "POST", query = {}, body = {} } = {}) => {
    const r = { code: null, body: null, headers: {} };
    r.status = (c) => { r.code = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    r.setHeader = (k, v) => { r.headers[k] = v; return r; };
    await postsApi({ method, headers: { authorization: "Bearer " + token }, query, body }, r);
    return r;
  };

  const newPost = async (partnerId, caption) => (await db.query(
    `INSERT INTO marketing_content_queue (org_id, partner_id, caption, offer_type, status)
     VALUES ($1,$2,$3,'funding','draft') RETURNING id`,
    [org, partnerId, caption]
  )).rows[0].id;

  const readPost = async (id) => (await db.query(
    `SELECT status, scheduled_for FROM marketing_content_queue WHERE id = $1`, [id]
  )).rows[0];

  async function makePartner(name) {
    const partnerId = (await db.query(
      `INSERT INTO partners (org_id, name, slug, status)
       VALUES ($1,$2,$3,'active') RETURNING id`,
      [org, `${MARK} ${name}`, `${MARK}-${name}`]
    )).rows[0].id;
    // The owner has turned the marketing suite on, the same as the live partner
    // in the audit. assertSuiteEnabled() refuses every write below without it.
    await db.query(
      `INSERT INTO partner_module_settings (org_id, partner_id, marketing_suite_enabled)
       VALUES ($1,$2,true)
       ON CONFLICT (partner_id) DO UPDATE SET marketing_suite_enabled = true`,
      [org, partnerId]
    );
    const staff = (await db.query(
      `SELECT id FROM staff WHERE org_id = $1 AND role = 'owner' LIMIT 1`, [org]
    )).rows[0];
    const acct = await createAccount(db, {
      orgId: org, kind: "partner", email: `${MARK}-${name}@example.com`,
      password: "a-long-enough-password-1", invitedBy: staff.id, partnerId
    });
    const token = (await createAccountSession(db, { accountId: acct.id, orgId: org })).token;
    return { partnerId, token };
  }

  before(async () => {
    org = await resolveDefaultOrg(db);
    await purge();
    ({ partnerId: mine, token: myToken } = await makePartner("mine"));
    ({ partnerId: theirs, token: theirToken } = await makePartner("theirs"));
  });

  async function purge() {
    await db.query(`DELETE FROM account_sessions WHERE account_id IN
      (SELECT id FROM accounts WHERE email LIKE $1)`, [`${MARK}%`]);
    await db.query(`DELETE FROM accounts WHERE email LIKE $1`, [`${MARK}%`]);
    const pids = (await db.query(
      `SELECT id FROM partners WHERE slug LIKE $1`, [`${MARK}%`])).rows.map((r) => r.id);
    if (pids.length) {
      await db.query(`DELETE FROM marketing_content_queue WHERE partner_id = ANY($1)`, [pids]);
      await db.query(`DELETE FROM social_channels WHERE partner_id = ANY($1)`, [pids]);
      await db.query(`DELETE FROM partner_module_settings WHERE partner_id = ANY($1)`, [pids]);
      await db.query(`DELETE FROM partners WHERE id = ANY($1)`, [pids]);
    }
  }

  after(async () => { await purge(); await close(); });

  test("the fixture really has no connected account — the premise, asserted", async () => {
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM social_channels WHERE partner_id = ANY($1)`,
      [[mine, theirs]]
    );
    assert.strictEqual(rows[0].n, 0,
      "these tests only mean something while the partner has zero social accounts");
  });

  test("queueing a post and setting a time works with no account", async () => {
    const id = await newPost(mine, "Working capital for owners.");
    const when = "2026-09-01T09:15:00.000Z";
    const res = await api(myToken, { body: { id, scheduled_for: when } });

    assert.strictEqual(res.code, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.item.status, "queued");

    const row = await readPost(id);
    assert.strictEqual(row.status, "queued");
    assert.strictEqual(new Date(row.scheduled_for).toISOString(), when,
      "the send time typed on the screen has to be the send time stored");
  });

  test("queueing with no time leaves the send time unknown, not zero", async () => {
    const id = await newPost(mine, "A post with no time on it.");
    const res = await api(myToken, { body: { id } });

    assert.strictEqual(res.code, 200, JSON.stringify(res.body));
    const row = await readPost(id);
    assert.strictEqual(row.status, "queued");
    assert.strictEqual(row.scheduled_for, null,
      "no send time means UNKNOWN and must survive — it must never be filled in with a guess");
  });

  test("a second queue call can set a time on a post that had none", async () => {
    const id = await newPost(mine, "Time added later.");
    await api(myToken, { body: { id } });
    const when = "2026-10-02T18:00:00.000Z";
    const res = await api(myToken, { body: { id, scheduled_for: when } });

    assert.strictEqual(res.code, 200, JSON.stringify(res.body));
    const row = await readPost(id);
    assert.strictEqual(row.status, "queued");
    assert.strictEqual(new Date(row.scheduled_for).toISOString(), when);
  });

  test("an emptied time box cannot take away a send time that is already saved", async () => {
    /* The screen shows an editable time box, so a partner can empty it and press
       "Queue it". This is what the server does with that: the update is
           scheduled_for = COALESCE($2::timestamptz, scheduled_for)
       with $2 = body.scheduled_for || row.scheduled_for, so the OLD time stays
       and the post still goes out.

       This is pinned here because public/app/social-studio.html now tells the
       partner exactly that, in those words. If this behaviour ever changes, the
       sentence on the screen becomes a lie and has to change with it. */
    const id = await newPost(mine, "Time already set on it.");
    const when = "2026-11-03T14:30:00.000Z";
    await api(myToken, { body: { id, scheduled_for: when } });

    const res = await api(myToken, { body: { id, scheduled_for: null } });
    assert.strictEqual(res.code, 200, JSON.stringify(res.body));
    assert.strictEqual(new Date(res.body.item.scheduled_for).toISOString(), when,
      "the reply must carry the time that is really stored — the screen builds its message from it");

    const row = await readPost(id);
    assert.strictEqual(new Date(row.scheduled_for).toISOString(), when,
      "clearing the box cleared the stored send time — the screen's wording is now wrong");
  });

  test("throwing a post away works with no account", async () => {
    const id = await newPost(mine, "This one gets thrown away.");
    const res = await api(myToken, { body: { id, action: "discard" } });

    assert.strictEqual(res.code, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.item.status, "discarded");
    assert.strictEqual((await readPost(id)).status, "discarded");
  });

  test("a partner cannot queue another partner's post", async () => {
    const id = await newPost(theirs, "Not yours.");
    const res = await api(myToken, { body: { id, scheduled_for: "2026-09-01T09:15:00.000Z" } });

    assert.strictEqual(res.code, 404, JSON.stringify(res.body));
    assert.strictEqual((await readPost(id)).status, "draft",
      "the other partner's post must be untouched");
  });

  test("a partner cannot throw another partner's post away", async () => {
    const id = await newPost(theirs, "Also not yours.");
    const res = await api(myToken, { body: { id, action: "discard" } });

    assert.strictEqual(res.code, 404, JSON.stringify(res.body));
    assert.strictEqual((await readPost(id)).status, "draft",
      "the other partner's post must be untouched");
  });

  test("a partner's own partner_id in the body cannot be swapped for another's", async () => {
    // A partner principal's partner id comes from the session, never the body
    // (resolvePartnerId). Sending someone else's id must change nothing.
    const id = await newPost(theirs, "Swapped id attempt.");
    const res = await api(myToken, { body: { id, partner_id: theirs, action: "discard" } });

    assert.strictEqual(res.code, 404, JSON.stringify(res.body));
    assert.strictEqual((await readPost(id)).status, "draft");
  });

  test("the queue read is scoped to one partner", async () => {
    await newPost(theirs, "Their row.");
    const res = await api(myToken, { method: "GET" });

    assert.strictEqual(res.code, 200, JSON.stringify(res.body));
    assert.ok(Array.isArray(res.body.items));
    assert.ok(res.body.items.length > 0, "the fixture wrote posts for this partner");
    for (const it of res.body.items) {
      assert.ok(!String(it.caption).includes("Their row"),
        "one partner read another partner's queue");
    }
  });

  test("the other partner still sees their own rows", async () => {
    const res = await api(theirToken, { method: "GET" });
    assert.strictEqual(res.code, 200, JSON.stringify(res.body));
    assert.ok(res.body.items.some((i) => String(i.caption).includes("Their row")),
      "scoping must not hide a partner's own posts from them");
  });

  test("a post that does not exist is a 404, not a 500", async () => {
    const res = await api(myToken, {
      body: { id: "00000000-0000-4000-8000-0000000abcff", action: "discard" } });
    assert.strictEqual(res.code, 404, JSON.stringify(res.body));
  });

  test("a missing id is refused before anything is written", async () => {
    const res = await api(myToken, { body: {} });
    assert.strictEqual(res.code, 400, JSON.stringify(res.body));
    assert.strictEqual(res.body.error, "id_required");
  });
});
