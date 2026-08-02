// The two portal sign-in endpoints, exercised as HTTP handlers.
//
// IT LIVES HERE AND NOT UNDER api/ BECAUSE OF CLAUDE.md §12: npm test's glob is
// src/** and scripts/** only, so a test file placed next to the handler never
// runs and reports nothing while looking green. It imports the api/ handlers.
//
// WHAT THE SERVICE-LAYER TESTS CANNOT COVER, and therefore what this file is
// for: requestMagicLink() knows perfectly well whether an address matched an
// account, and it returns that on `outcome`. The guarantee customers actually
// depend on is that the HANDLER never lets that reach the wire. That is a
// property of api/auth/magic-link.mjs, not of the service, and the only way to
// prove it is to call the handler and read what came back.
//
// Skipped without DATABASE_URL — and per §12 that skip means this file asserted
// nothing, not that it passed.

import { test, before, beforeEach, after, describe } from "node:test";
import assert from "node:assert/strict";
import { db, close } from "../db.mjs";
import magicLinkHandler from "../../api/auth/magic-link.mjs";
import verifyHandler, { PORTAL_PATH } from "../../api/auth/magic-link-verify.mjs";
import { requestMagicLink, LINK_LIMITS, MAGIC_LINK_TEMPLATE_KEY } from "../auth/magic-link.mjs";
import { createAccount, verifyAccountSession } from "../auth/account-session.mjs";
import { ROUTES } from "../../netlify/functions/api.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const TAG = "magiclink-http";
const PW = "magic-link-endpoint-password";

/* The (req, res) shim the Netlify adapter builds, reduced to what these two
   handlers use: status(), json(), setHeader(). Same shape the other endpoint
   tests in this directory use. */
function mkRes() {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; return r; };
  return r;
}
const mkReq = (method, body, headers = {}) => ({
  method, body, headers: { "user-agent": "endpoint-test/1", ...headers },
  socket: { remoteAddress: "203.0.113.55" }
});

async function call(handler, req) {
  const res = mkRes();
  await handler(req, res);
  return res;
}

describe("portal magic-link endpoints", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org;

  before(async () => {
    org = (await db.query(`SELECT id FROM orgs WHERE is_default LIMIT 1`)).rows[0].id;
    // Same reason as magic-link.pg.test.mjs: the template seeder's own pg test
    // deletes every template row for this org before re-seeding, so this file
    // must not depend on having run before it.
    await db.query(
      `INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
       VALUES ($1, $2, 'email', 'Your Fundhub sign-in link',
               'Sign in: {{magic_link.url}} — expires in {{magic_link.expires_minutes}} minutes', true)
       ON CONFLICT (org_id, template_key) DO NOTHING`,
      [org, MAGIC_LINK_TEMPLATE_KEY]);
  });

  /* Wipe at the END too, for the reason spelled out in
     src/auth/magic-link.pg.test.mjs: the last test leaves a queued `messages`
     row, and dispatchDue() in the cutover acceptance suite claims by ORG rather
     than by client, so a leftover makes ITS send count wrong. */
  after(async () => {
    if (!HAVE_DB) return;
    await wipe();
    await close();
  });

  async function wipe() {
    await db.query(`DELETE FROM account_magic_links WHERE email LIKE $1`, [`${TAG}%`]);
    await db.query(`DELETE FROM account_sessions WHERE account_id IN
                     (SELECT id FROM accounts WHERE email LIKE $1)`, [`${TAG}%`]);
    await db.query(`DELETE FROM accounts WHERE email LIKE $1`, [`${TAG}%`]);
    await db.query(`DELETE FROM events WHERE client_id IN
                     (SELECT id FROM clients WHERE first_name = $1)`, [TAG]);
    await db.query(`DELETE FROM messages WHERE client_id IN
                     (SELECT id FROM clients WHERE first_name = $1)`, [TAG]);
    await db.query(`DELETE FROM clients WHERE first_name = $1`, [TAG]);
  }
  beforeEach(wipe);

  const mkClient = async (email) => (await db.query(
    `INSERT INTO clients (org_id, first_name, last_name, email) VALUES ($1,$2,'Http',$3) RETURNING id`,
    [org, TAG, email])).rows[0].id;

  /* ── ROUTING ──────────────────────────────────────────────────────────── */

  test("both paths are in the routing table", () => {
    // CLAUDE.md §12: a handler file that is not in ROUTES answers 404 locally
    // AND deployed. For a magic link that means the client gets the email,
    // clicks, and lands on nothing. src/http/routes.test.mjs enforces the
    // general rule; this pins these two specifically.
    assert.equal(ROUTES["auth/magic-link"], magicLinkHandler);
    assert.equal(ROUTES["auth/magic-link-verify"], verifyHandler);
  });

  /* ── NO ENUMERATION, AT THE WIRE ──────────────────────────────────────── */

  describe("the request endpoint tells nobody who is a client", () => {
    test("a known address and an unknown one get byte-identical replies", async () => {
      const known = `${TAG}-known@x.io`;
      await mkClient(known);

      const hit = await call(magicLinkHandler, mkReq("POST", { email: known }));
      const miss = await call(magicLinkHandler, mkReq("POST", { email: `${TAG}-nobody@x.io` }));

      assert.equal(hit.code, 200);
      assert.equal(miss.code, 200);
      // Not "equivalent" — IDENTICAL. Any difference at all is the oracle.
      assert.deepEqual(hit.body, miss.body);
      assert.deepEqual(Object.keys(hit.body).sort(), ["message", "ok"]);
    });

    test("the reply never carries the outcome, the token, or the link id", async () => {
      const email = `${TAG}-leak@x.io`;
      await mkClient(email);
      const res = await call(magicLinkHandler, mkReq("POST", { email }));

      const serialised = JSON.stringify(res.body);
      for (const forbidden of ["outcome", "issued", "no_account", "not_eligible",
                               "token", "linkId", "expiresAt", "sent"]) {
        assert.ok(!serialised.includes(forbidden),
          `the response leaked "${forbidden}": ${serialised}`);
      }

      // And the link really was minted — this is not passing because nothing
      // happened.
      const n = (await db.query(
        `SELECT count(*)::int AS n FROM account_magic_links
          WHERE email = $1 AND outcome = 'issued'`, [email])).rows[0].n;
      assert.equal(n, 1);
    });

    test("a suspended client's address answers exactly like a stranger's", async () => {
      const email = `${TAG}-susp@x.io`;
      const clientId = await mkClient(email);
      const acct = await createAccount(db, {
        orgId: org, kind: "client", email, password: PW, clientId });
      await db.query(`UPDATE accounts SET status='suspended' WHERE id=$1`, [acct.id]);

      const susp = await call(magicLinkHandler, mkReq("POST", { email }));
      const stranger = await call(magicLinkHandler, mkReq("POST", { email: `${TAG}-nobody2@x.io` }));
      assert.equal(susp.code, stranger.code);
      assert.deepEqual(susp.body, stranger.body);
    });

    test("a malformed address is the one refusal, and it reveals nothing", async () => {
      const res = await call(magicLinkHandler, mkReq("POST", { email: "not-an-address" }));
      assert.equal(res.code, 400);
      assert.equal(res.body.error, "email_required");
      assert.equal(res.body.ok, false);
    });

    test("a throttled caller gets 429 and a Retry-After, for any address", async () => {
      const email = `${TAG}-rl@x.io`;
      await mkClient(email);
      for (let i = 0; i < LINK_LIMITS.maxPerEmail; i++) {
        await requestMagicLink(db, { email, ip: `198.51.100.${150 + i}` });
      }
      const res = await call(magicLinkHandler, mkReq("POST", { email }));
      assert.equal(res.code, 429);
      assert.equal(res.body.error, "too_many_requests");
      assert.ok(Number(res.headers["retry-after"]) > 0);
    });

    test("GET is not a way to ask for a link", async () => {
      const res = await call(magicLinkHandler, mkReq("GET", null));
      assert.equal(res.code, 405);
    });
  });

  /* ── VERIFICATION ─────────────────────────────────────────────────────── */

  describe("the verify endpoint", () => {
    test("REFUSES GET — a mail scanner must not be able to spend the link", async () => {
      // The reason the emailed URL points at /portal-login.html instead of
      // here. If this ever answers GET, every corporate mail gateway that
      // follows links in a message burns the client's link before they click.
      const res = await call(verifyHandler, mkReq("GET", null));
      assert.equal(res.code, 405);
    });

    test("exchanges a link for a session, a cookie and a destination", async () => {
      const email = `${TAG}-v@x.io`;
      const clientId = await mkClient(email);
      const issued = await requestMagicLink(db, { email, ip: "203.0.113.55" });

      const res = await call(verifyHandler, mkReq("POST", { token: issued.token }));
      assert.equal(res.code, 200);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.principal, "client");
      assert.equal(res.body.account.clientId, clientId);
      assert.equal(res.body.next, PORTAL_PATH);

      // The token in the body is what the portal shell reads into localStorage.
      const seen = await verifyAccountSession(db, res.body.token, {});
      assert.ok(seen, "the session handed to the browser does not verify");

      /* The cookie is the other half — a cold reload has no localStorage in
         flight, and bearerToken() reads fundhub_session. Same two transports
         api/auth/login.mjs already sets, with the same flags: HttpOnly so a
         script cannot read it, Secure so it never crosses plain http. */
      const cookie = res.headers["set-cookie"];
      assert.ok(cookie.startsWith("fundhub_session="));
      assert.ok(cookie.includes("HttpOnly"), cookie);
      assert.ok(cookie.includes("Secure"), cookie);
      assert.ok(cookie.includes("SameSite=Lax"), cookie);
      assert.ok(/Max-Age=\d+/.test(cookie), cookie);
    });

    test("a spent link and a forged one are the same refusal", async () => {
      const email = `${TAG}-v2@x.io`;
      await mkClient(email);
      const issued = await requestMagicLink(db, { email, ip: "203.0.113.55" });
      await call(verifyHandler, mkReq("POST", { token: issued.token }));

      const spent = await call(verifyHandler, mkReq("POST", { token: issued.token }));
      const forged = await call(verifyHandler, mkReq("POST", { token: "nonsense" }));

      assert.equal(spent.code, 401);
      assert.deepEqual(spent.body, forged.body);
      assert.equal(spent.headers["set-cookie"], undefined, "a refusal set a session cookie");
    });

    test("a missing token is a 400, not a 401", async () => {
      const res = await call(verifyHandler, mkReq("POST", {}));
      assert.equal(res.code, 400);
      assert.equal(res.body.error, "token_required");
    });
  });

  /* ── THE WHOLE THING ──────────────────────────────────────────────────── */

  test("end to end: a client with no account asks, is mailed, clicks, and is signed in", async () => {
    // The definition of done for this unit, in one test, through the HTTP
    // handlers rather than the service layer.
    const email = `${TAG}-e2e@x.io`;
    const clientId = await mkClient(email);

    // 1. They ask. The reply says nothing about them.
    const asked = await call(magicLinkHandler, mkReq("POST", { email }));
    assert.equal(asked.code, 200);
    assert.deepEqual(Object.keys(asked.body).sort(), ["message", "ok"]);

    // 2. A real message row exists, written from a real template, addressed to
    //    them, with the link in the rendered copy.
    const msg = (await db.query(
      `SELECT * FROM messages WHERE to_address = $1 AND template_key = $2`,
      [email, MAGIC_LINK_TEMPLATE_KEY])).rows[0];
    assert.ok(msg, "no email was queued");
    assert.equal(msg.status, "queued");
    assert.ok(!msg.rendered_body.includes("{{"), "an unrendered merge tag shipped");

    // 3. The link out of that email is the one that works. Pulled from the
    //    rendered body, not from the return value — this is what the client
    //    would actually click.
    const url = /https?:\/\/\S*portal-login\.html\?t=(\S+)/.exec(msg.rendered_body);
    assert.ok(url, `no sign-in link in the email body: ${msg.rendered_body}`);
    const token = decodeURIComponent(url[1]);

    const verified = await call(verifyHandler, mkReq("POST", { token }));
    assert.equal(verified.code, 200);

    // 4. An account now exists for a client that had none, and the session it
    //    handed back resolves as a client principal — which is what
    //    /api/auth/session projects and what the portal shell gates on.
    const acct = (await db.query(
      `SELECT * FROM accounts WHERE client_id = $1`, [clientId])).rows[0];
    assert.ok(acct, "no account was provisioned");
    assert.equal(acct.status, "active");

    const session = await verifyAccountSession(db, verified.body.token, {});
    assert.equal(session.principal.kind, "client");
    assert.equal(session.principal.clientId, clientId);

    // 5. And the link is spent.
    const again = await call(verifyHandler, mkReq("POST", { token }));
    assert.equal(again.code, 401);
  });
});
