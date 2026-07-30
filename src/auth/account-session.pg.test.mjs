// Accounts, principal sessions, and the isolation matrix Unit 12 requires.
// Skipped without DATABASE_URL.

import { test, before, beforeEach, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import {
  createAccount, loginAccount, createAccountSession, verifyAccountSession,
  revokeAccountSession, selfSignupAllowed, PRINCIPAL_KINDS
} from "./account-session.mjs";
import { requirePrincipal, resolvePrincipal } from "../http/middleware/requirePrincipal.mjs";
import { scopeFor, assertCanReadClient } from "../partners/scope.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const PW = "principal-password-for-tests";
const TAG = "acct-test";

const res = () => {
  const r = { code: null, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};
const withToken = (t) => ({ headers: { authorization: "Bearer " + t } });

describe("accounts and principals", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, staffId, clientA, clientB, partnerA, partnerB, affA, affB;

  before(async () => {
    org = (await db.query(`SELECT id FROM orgs WHERE is_default LIMIT 1`)).rows[0].id;
    staffId = (await db.query(
      `INSERT INTO staff (org_id,email,name,role,status)
       VALUES ($1,'acct-fixture@x.io','Fixture','admin','active') RETURNING id`, [org])).rows[0].id;
  });

  async function wipe() {
    await db.query(`DELETE FROM account_sessions WHERE account_id IN
                     (SELECT id FROM accounts WHERE email LIKE $1)`, [`${TAG}%`]);
    await db.query(`DELETE FROM accounts WHERE email LIKE $1`, [`${TAG}%`]);
    await db.query(`DELETE FROM clients WHERE first_name = $1`, [TAG]);
    await db.query(`DELETE FROM affiliates WHERE name LIKE $1`, [`${TAG}%`]);
    await db.query(`DELETE FROM partners WHERE slug LIKE $1`, [`${TAG}%`]);
  }

  beforeEach(async () => {
    await wipe();
    const mkClient = async (n) => (await db.query(
      `INSERT INTO clients (org_id,first_name,last_name) VALUES ($1,$2,$3) RETURNING id`,
      [org, TAG, n])).rows[0].id;
    const mkPartner = async (n) => (await db.query(
      `INSERT INTO partners (org_id,name,slug,status) VALUES ($1,$2,$3,'active') RETURNING id`,
      [org, `${TAG} ${n}`, `${TAG}-${n}`])).rows[0].id;
    const mkAff = async (n) => (await db.query(
      `INSERT INTO affiliates (org_id,name,status) VALUES ($1,$2,'active') RETURNING id`,
      [org, `${TAG}-${n}`])).rows[0].id;
    clientA = await mkClient("A"); clientB = await mkClient("B");
    partnerA = await mkPartner("pa"); partnerB = await mkPartner("pb");
    affA = await mkAff("aa"); affB = await mkAff("ab");
    // Each partner owns one client, so the cross-partner read has something real.
    await db.query(`UPDATE clients SET partner_id=$1 WHERE id=$2`, [partnerA, clientA]);
    await db.query(`UPDATE clients SET partner_id=$1 WHERE id=$2`, [partnerB, clientB]);
  });

  after(async () => {
    await wipe();
    await db.query(`DELETE FROM staff WHERE id=$1`, [staffId]);
    await close();
  });

  // ══════════ invite-only, enforced in code AND in the database ══════════

  test("the signup policy is data: client/affiliate self-serve, partner does not", async () => {
    assert.equal(await selfSignupAllowed(db, "client"), true);
    assert.equal(await selfSignupAllowed(db, "affiliate"), true);
    assert.equal(await selfSignupAllowed(db, "partner"), false);
    assert.equal(await selfSignupAllowed(db, "staff"), false, "staff is not an account kind");
  });

  test("a client and an affiliate can self-register", async () => {
    const c = await createAccount(db, { orgId: org, kind: "client", email: `${TAG}-c@x.io`,
      password: PW, clientId: clientA });
    assert.equal(c.status, "active");
    const a = await createAccount(db, { orgId: org, kind: "affiliate", email: `${TAG}-a@x.io`,
      password: PW, affiliateId: affA });
    assert.equal(a.kind, "affiliate");
  });

  test("ATTACK: a partner CANNOT self-register — refused in code", async () => {
    await assert.rejects(
      () => createAccount(db, { orgId: org, kind: "partner", email: `${TAG}-p@x.io`,
        password: PW, partnerId: partnerA }),
      /invite-only/);
  });

  test("ATTACK: and refused by the DATABASE when the helper is bypassed", async () => {
    await assert.rejects(
      () => db.query(
        `INSERT INTO accounts (org_id,kind,email,password_hash,status,partner_id)
         VALUES ($1,'partner',$2,'x','invited',$3)`, [org, `${TAG}-p2@x.io`, partnerA]),
      /invite-only/,
      "a direct insert created a self-registered partner");
  });

  test("an invited partner IS allowed", async () => {
    const p = await createAccount(db, { orgId: org, kind: "partner", email: `${TAG}-p@x.io`,
      password: PW, partnerId: partnerA, invitedBy: staffId });
    assert.equal(p.kind, "partner");
    assert.equal(p.status, "active");
  });

  // ══════════ shape guards ══════════

  test("the subject link must match the kind", async () => {
    await assert.rejects(
      () => db.query(`INSERT INTO accounts (org_id,kind,email,status,client_id,partner_id)
                      VALUES ($1,'client',$2,'invited',$3,$4)`,
        [org, `${TAG}-bad@x.io`, clientA, partnerA]),
      /accounts_subject_ck/, "a client account carrying a partner_id was accepted");
    await assert.rejects(
      () => db.query(`INSERT INTO accounts (org_id,kind,email,status)
                      VALUES ($1,'client',$2,'invited')`, [org, `${TAG}-bad2@x.io`]),
      /accounts_subject_ck/, "a client account with no client_id was accepted");
  });

  test("an active account must be able to authenticate", async () => {
    await assert.rejects(
      () => db.query(`INSERT INTO accounts (org_id,kind,email,status,client_id)
                      VALUES ($1,'client',$2,'active',$3)`, [org, `${TAG}-nh@x.io`, clientA]),
      /accounts_active_needs_hash/);
  });

  test("one login per email, and one account per subject", async () => {
    await createAccount(db, { orgId: org, kind: "client", email: `${TAG}-dup@x.io`,
      password: PW, clientId: clientA });
    await assert.rejects(
      () => createAccount(db, { orgId: org, kind: "affiliate", email: `${TAG}-dup@x.io`,
        password: PW, affiliateId: affA }),
      /accounts_email_uniq|duplicate key/);
    await assert.rejects(
      () => createAccount(db, { orgId: org, kind: "client", email: `${TAG}-other@x.io`,
        password: PW, clientId: clientA }),
      /accounts_client_uniq|duplicate key/);
  });

  test("a weak password is refused before a row is written", async () => {
    await assert.rejects(
      () => createAccount(db, { orgId: org, kind: "client", email: `${TAG}-weak@x.io`,
        password: "short", clientId: clientA }), /at least/);
    const { rows } = await db.query(`SELECT count(*)::int n FROM accounts WHERE email=$1`,
      [`${TAG}-weak@x.io`]);
    assert.equal(rows[0].n, 0);
  });

  // ══════════ sessions ══════════

  test("login returns a session carrying the SUBJECT id", async () => {
    await createAccount(db, { orgId: org, kind: "partner", email: `${TAG}-p@x.io`,
      password: PW, partnerId: partnerA, invitedBy: staffId });
    const out = await loginAccount(db, { email: `${TAG}-p@x.io`, password: PW });
    assert.equal(out.ok, true);
    assert.equal(out.principal.kind, "partner");
    assert.equal(out.principal.partnerId, partnerA,
      "a partner session with no partnerId can scope nothing");
    assert.ok(out.token && out.token.length > 20);
  });

  test("the raw token is never stored — only its sha256", async () => {
    await createAccount(db, { orgId: org, kind: "client", email: `${TAG}-c@x.io`,
      password: PW, clientId: clientA });
    const out = await loginAccount(db, { email: `${TAG}-c@x.io`, password: PW });
    const { rows } = await db.query(`SELECT token_hash FROM account_sessions`);
    assert.ok(rows.length);
    for (const r of rows) assert.notEqual(r.token_hash, out.token);
  });

  test("a wrong password and an unknown email are indistinguishable", async () => {
    await createAccount(db, { orgId: org, kind: "client", email: `${TAG}-c@x.io`,
      password: PW, clientId: clientA });
    const wrong = await loginAccount(db, { email: `${TAG}-c@x.io`, password: "not-it-at-all" });
    const missing = await loginAccount(db, { email: `${TAG}-nobody@x.io`, password: PW });
    assert.equal(wrong.status, 401);
    assert.equal(missing.status, 401);
    assert.equal(wrong.error, missing.error,
      "different errors turn the login form into a membership oracle");
  });

  test("a suspended account cannot sign in, and its sessions stop verifying", async () => {
    await createAccount(db, { orgId: org, kind: "client", email: `${TAG}-c@x.io`,
      password: PW, clientId: clientA });
    const out = await loginAccount(db, { email: `${TAG}-c@x.io`, password: PW });
    assert.ok(await verifyAccountSession(db, out.token));

    await db.query(`UPDATE accounts SET status='suspended' WHERE email=$1`, [`${TAG}-c@x.io`]);
    assert.equal(await verifyAccountSession(db, out.token), null,
      "a live session outlived the account's suspension");
    const again = await loginAccount(db, { email: `${TAG}-c@x.io`, password: PW });
    assert.equal(again.status, 403);
  });

  test("revoking a session stops it immediately", async () => {
    await createAccount(db, { orgId: org, kind: "client", email: `${TAG}-c@x.io`,
      password: PW, clientId: clientA });
    const out = await loginAccount(db, { email: `${TAG}-c@x.io`, password: PW });
    assert.equal(await revokeAccountSession(db, out.token), true);
    assert.equal(await verifyAccountSession(db, out.token), null);
  });

  test("an expired session does not verify", async () => {
    const acct = await createAccount(db, { orgId: org, kind: "client", email: `${TAG}-c@x.io`,
      password: PW, clientId: clientA });
    const s = await createAccountSession(db, { accountId: acct.id, orgId: org });
    await db.query(`UPDATE account_sessions SET expires_at = now() - interval '1 hour'`);
    assert.equal(await verifyAccountSession(db, s.token), null);
  });

  test("a garbage token verifies as nothing", async () => {
    assert.equal(await verifyAccountSession(db, "not-a-token"), null);
    assert.equal(await verifyAccountSession(db, ""), null);
    assert.equal(await verifyAccountSession(db, null), null);
  });

  // ══════════ THE ISOLATION MATRIX ══════════

  const tokenFor = async (kind, subject, email) => {
    await createAccount(db, {
      orgId: org, kind, email, password: PW,
      clientId: kind === "client" ? subject : null,
      affiliateId: kind === "affiliate" ? subject : null,
      partnerId: kind === "partner" ? subject : null,
      invitedBy: kind === "partner" ? staffId : null
    });
    return (await loginAccount(db, { email, password: PW })).token;
  };

  test("MATRIX: a client session gets 403 on /api/tasks", async () => {
    const t = await tokenFor("client", clientA, `${TAG}-c@x.io`);
    const r = res();
    const p = await requirePrincipal(withToken(t), r, ["staff"], { db });
    assert.equal(p, null);
    assert.equal(r.code, 403, "a client reached the internal work queue");
    assert.equal(r.body.error, "forbidden");
  });

  test("MATRIX: an affiliate and a partner are also refused staff endpoints", async () => {
    for (const [kind, subject, email] of [["affiliate", affA, `${TAG}-a@x.io`],
                                          ["partner", partnerA, `${TAG}-p@x.io`]]) {
      const t = await tokenFor(kind, subject, email);
      const r = res();
      assert.equal(await requirePrincipal(withToken(t), r, ["staff"], { db }), null);
      assert.equal(r.code, 403, `${kind} reached a staff endpoint`);
    }
  });

  test("MATRIX: an affiliate cannot read another affiliate's referrals", async () => {
    const t = await tokenFor("affiliate", affA, `${TAG}-a@x.io`);
    const principal = await resolvePrincipal(withToken(t), { db });
    assert.equal(principal.kind, "affiliate");
    assert.equal(principal.affiliateId, affA);

    // The scoped read every affiliate surface must use.
    const { rows } = await db.query(
      `SELECT id FROM affiliate_referrals WHERE affiliate_id = $1`, [principal.affiliateId]);
    assert.ok(rows.every((x) => x.affiliate_id !== affB));
    // And the principal carries no handle on the other affiliate at all.
    assert.notEqual(principal.affiliateId, affB);
    assert.equal(principal.partnerId, null);
    assert.equal(principal.clientId, null);
  });

  test("MATRIX: a partner cannot read a client belonging to a different partner", async () => {
    const t = await tokenFor("partner", partnerA, `${TAG}-p@x.io`);
    const principal = await resolvePrincipal(withToken(t), { db });
    assert.equal(principal.kind, "partner");
    assert.equal(principal.partnerId, partnerA);

    // Their own resolves…
    const own = await assertCanReadClient(db, principal, clientA);
    assert.equal(own.id, clientA);
    // …the other partner's does not, and is indistinguishable from absent.
    await assert.rejects(() => assertCanReadClient(db, principal, clientB),
      (e) => { assert.equal(e.code, "NOT_FOUND"); return true; });

    const s = scopeFor(principal);
    assert.deepEqual(s.params, [partnerA]);
    assert.equal(s.unrestricted, false);
  });

  test("MATRIX: a staff token still resolves as staff and reaches staff endpoints", async () => {
    const { createSession } = await import("./session.mjs");
    const s = await createSession(db, { staffId, orgId: org });
    const principal = await resolvePrincipal(withToken(s.token), { db });
    assert.equal(principal.kind, "staff");
    assert.equal(principal.staffId, staffId);
    const r = res();
    assert.ok(await requirePrincipal(withToken(s.token), r, ["staff"], { db }));
    assert.equal(r.code, null, "a valid staff request should not have been refused");
  });

  test("an endpoint that names no kinds admits nobody", async () => {
    const t = await tokenFor("client", clientA, `${TAG}-c@x.io`);
    const r = res();
    assert.equal(await requirePrincipal(withToken(t), r, [], { db }), null);
    assert.equal(r.code, 403);
  });

  test("no session at all is 401, not 403", async () => {
    const r = res();
    assert.equal(await requirePrincipal({ headers: {} }, r, ["staff", "client"], { db }), null);
    assert.equal(r.code, 401);
  });

  test("every principal kind is one scope.mjs recognises", () => {
    for (const k of PRINCIPAL_KINDS) {
      assert.doesNotThrow(() => {
        try { scopeFor({ kind: k, partnerId: "x" }); }
        catch (e) {
          // client/affiliate are legitimately not book readers; that is a
          // different refusal from "unknown kind", which is what matters here.
          if (!/does not read the client book/.test(e.message)) throw e;
        }
      }, k);
    }
  });
});
