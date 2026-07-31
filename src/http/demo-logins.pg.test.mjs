// The nine demo logins, against a real database.
//
// Skips without DATABASE_URL — and that skip is the trap recorded in CLAUDE.md
// §12: with the variable unset this file reports zero failures while asserting
// nothing. Run it with DATABASE_URL set, after `node db/migrate.mjs` has applied
// db/migrations/094_demo_logins.sql, or it has told you nothing.
//
// WHAT IT PINS
//   · with DEMO_LOGINS_ENABLED unset, not one of the nine authenticates
//   · with it set, all nine do — and the staff six get a `sessions` row while
//     the three principals get an `account_sessions` row, because they are two
//     different token spaces and conflating them is how a client ends up
//     holding a staff session
//   · a real account is unaffected in both directions
//   · every one of the nine carries the org and the role public/app/shell.js
//     needs, which is the difference between a portal and a blank screen
//
// IT WRITES NOTHING AND DELETES NOTHING. Every assertion is a read or a login
// attempt. Login attempts do append to auth_attempts (that is the rate limiter
// doing its job), so the successful pass runs LAST and each identity is tried at
// most a couple of times — LIMITS.maxPerEmail is 5.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { login } from "../auth/login.mjs";
import { loginAccount } from "../auth/account-session.mjs";
import { verifyAccountSession } from "../auth/account-session.mjs";
import { verifySession } from "../auth/session.mjs";
import { DEMO_STAFF, DEMO_ACCOUNTS, DEMO_PASSWORD } from "../auth/demo-roster.mjs";
import { DEMO_ENV_VAR } from "../auth/demo-logins.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;

// The two environments under test. Passed explicitly rather than mutated onto
// process.env: login() and loginAccount() both take `env`, and a test that
// mutates the real environment leaks into whatever runs next in the same worker.
const OFF = {};
const ON = { [DEMO_ENV_VAR]: "1" };

describe("demo logins", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org;
  let migrated = true;

  before(async () => {
    org = await resolveDefaultOrg(db);
    const r = await db.query(
      `SELECT count(*)::int AS n FROM staff
        WHERE org_id = $1 AND email LIKE '%@demo.fundhub.local'`, [org]);
    // A database that predates 094 has nothing to assert about. Say so out loud
    // rather than failing nine tests that are really one missing migration.
    if (r.rows[0].n === 0) migrated = false;
  });

  after(async () => { await close(); });

  const needMigration = () => migrated ? false
    : "094_demo_logins.sql not applied — run: DATABASE_URL=… node db/migrate.mjs";

  /* --------------------------------------------------------------------- */
  test("all six demo staff rows exist, active, org-scoped, correctly roled",
    { skip: needMigration() }, async () => {
    for (const s of DEMO_STAFF) {
      const r = await db.query(
        `SELECT org_id, role, name, status, password_hash, is_demo
           FROM staff WHERE lower(email) = $1`, [s.email]);
      assert.equal(r.rows.length, 1, `${s.email} — expected exactly one staff row`);
      const row = r.rows[0];
      // Audit C1: a staff row with no org fails closed on every read endpoint.
      // It signs in and then shows empty screens everywhere, which is the most
      // confusing way this seed could break.
      assert.equal(row.org_id, org, `${s.email} is not scoped to the default org`);
      assert.equal(row.role, s.role, `${s.email} has the wrong role`);
      assert.equal(row.status, "active", `${s.email} cannot sign in — status is ${row.status}`);
      assert.equal(row.is_demo, true, `${s.email} is not flagged is_demo`);
      assert.ok(row.password_hash, `${s.email} has no credential`);
      assert.match(row.password_hash, /^\$scrypt\$/,
        `${s.email} is not stored as a scrypt verifier — a second auth path?`);
      assert.match(row.name, /^DEMO /, `${s.email} does not read as a demo account`);
    }
  });

  test("all three demo principals exist with their subject row attached",
    { skip: needMigration() }, async () => {
    for (const a of DEMO_ACCOUNTS) {
      const r = await db.query(
        `SELECT org_id, kind, name, status, password_hash, is_demo,
                client_id, affiliate_id, partner_id
           FROM accounts WHERE lower(email) = $1`, [a.email]);
      assert.equal(r.rows.length, 1, `${a.email} — expected exactly one account row`);
      const row = r.rows[0];
      assert.equal(row.org_id, org, `${a.email} is not scoped to the default org`);
      assert.equal(row.kind, a.kind);
      assert.equal(row.status, "active");
      assert.equal(row.is_demo, true, `${a.email} is not flagged is_demo`);
      assert.ok(row.password_hash, `${a.email} has no credential`);

      // The subject link is what makes the session mean anything.
      // src/partners/scope.mjs refuses to build a query for a partner principal
      // with no partnerId — a principal without its subject signs in and reads
      // nothing, which is the "empty portal" failure in a different costume.
      const subject = { client: row.client_id, affiliate: row.affiliate_id, partner: row.partner_id }[a.kind];
      assert.ok(subject, `${a.email} has no ${a.kind}_id — its portal would be empty`);
    }
  });

  test("the demo partner has a brand row, so brand-studio and the shell have something to show",
    { skip: needMigration() }, async () => {
    const r = await db.query(
      `SELECT b.ink, b.paper, jsonb_array_length(b.ramp) AS stops, b.approval_status
         FROM partner_brand b
         JOIN accounts a ON a.partner_id = b.partner_id
        WHERE lower(a.email) = 'partner@demo.fundhub.local'`);
    assert.equal(r.rows.length, 1, "the demo partner has no partner_brand row");
    assert.equal(Number(r.rows[0].stops), 6, "043 requires exactly six ramp stops, or none");
    assert.equal(r.rows[0].approval_status, "approved",
      "an unapproved brand leaves the partner on the fundhub default — the white-label story is invisible");
  });

  test("the demo client has entitlements, so the client portal read is not empty",
    { skip: needMigration() }, async () => {
    const r = await db.query(
      `SELECT count(*)::int AS n
         FROM entitlements e
         JOIN accounts a ON a.client_id = e.client_id
        WHERE lower(a.email) = 'client@demo.fundhub.local' AND e.revoked_at IS NULL`);
    assert.ok(r.rows[0].n >= 1,
      "the demo client holds no entitlements — /api/read/entitlements answers an empty list");
  });

  test("the demo partner owns at least one client, so partner scope has a book",
    { skip: needMigration() }, async () => {
    const r = await db.query(
      `SELECT count(*)::int AS n
         FROM clients c
         JOIN accounts a ON a.partner_id = c.partner_id
        WHERE lower(a.email) = 'partner@demo.fundhub.local'`);
    assert.ok(r.rows[0].n >= 1, "the demo partner has no clients — partner-galaxy would be empty");
  });

  /* --------------------------------------------------------------------- */
  test("WITH THE SWITCH OFF: not one of the nine can sign in",
    { skip: needMigration() }, async () => {
    for (const s of DEMO_STAFF) {
      const out = await login(db, { email: s.email, password: DEMO_PASSWORD, env: OFF });
      assert.equal(out.ok, false, `${s.email} signed in with ${DEMO_ENV_VAR} unset`);
      assert.equal(out.status, 403);
      assert.equal(out.error, "demo_logins_disabled");
    }
    for (const a of DEMO_ACCOUNTS) {
      const out = await loginAccount(db, { email: a.email, password: DEMO_PASSWORD, env: OFF });
      assert.equal(out.ok, false, `${a.email} signed in with ${DEMO_ENV_VAR} unset`);
      assert.equal(out.status, 403);
      assert.equal(out.error, "demo_logins_disabled");
      assert.equal(out.token, undefined, "a refused login must not carry a token");
    }
  });

  test("WITH THE SWITCH OFF: no session row was minted for any of them",
    { skip: needMigration() }, async () => {
    // The refusal has to happen before the session is created, not after.
    const staffSessions = await db.query(
      `SELECT count(*)::int AS n FROM sessions s JOIN staff t ON t.id = s.staff_id
        WHERE t.is_demo AND s.created_at > now() - interval '2 minutes'`);
    assert.equal(staffSessions.rows[0].n, 0,
      "a refused demo staff login still minted a session");
    const acctSessions = await db.query(
      `SELECT count(*)::int AS n FROM account_sessions s JOIN accounts a ON a.id = s.account_id
        WHERE a.is_demo AND s.created_at > now() - interval '2 minutes'`);
    assert.equal(acctSessions.rows[0].n, 0,
      "a refused demo principal login still minted a session");
  });

  test("a WRONG password on a demo account is still wrong when the switch is ON",
    { skip: needMigration() }, async () => {
    // The switch must not be a bypass. Turning demo logins on turns nothing off.
    const out = await login(db,
      { email: DEMO_STAFF[0].email, password: "not-the-demo-password", env: ON });
    assert.equal(out.ok, false);
    assert.equal(out.error, "invalid_credentials",
      "the demo switch appears to skip the password check");
  });

  /* --------------------------------------------------------------------- */
  test("WITH THE SWITCH ON: all nine sign in, into the right token space",
    { skip: needMigration() }, async () => {
    for (const s of DEMO_STAFF) {
      const out = await login(db, { email: s.email, password: DEMO_PASSWORD, env: ON });
      assert.equal(out.ok, true, `${s.email} could not sign in: ${out.error}`);
      assert.equal(out.staff.role, s.role, `${s.email} signed in with the wrong role`);
      assert.equal(out.staff.org_id, org);
      // A staff token resolves in `sessions` and nowhere else.
      const v = await verifySession(db, out.token);
      assert.ok(v && v.staff, `${s.email} minted a token that does not verify`);
      assert.equal(await verifyAccountSession(db, out.token), null,
        `${s.email} minted a token that also resolves as an account — the two spaces must not blur`);
    }

    for (const a of DEMO_ACCOUNTS) {
      const out = await loginAccount(db, { email: a.email, password: DEMO_PASSWORD, env: ON });
      assert.equal(out.ok, true, `${a.email} could not sign in: ${out.error}`);
      assert.equal(out.principal.kind, a.kind);
      assert.equal(out.principal.orgId, org);
      const v = await verifyAccountSession(db, out.token);
      assert.ok(v && v.principal, `${a.email} minted a token that does not verify`);
      // shell.js keys ROLE_TABS on this string. Wrong string, wrong portal.
      assert.equal(v.principal.kind, a.kind);
      assert.equal(await verifySession(db, out.token), null,
        `${a.email} minted a token that also resolves as staff`);
    }
  });

  /* --------------------------------------------------------------------- */
  test("a REAL account is unaffected by the switch, in both positions",
    { skip: needMigration() }, async () => {
    // The founding owner from src/auth/seed-staff.mjs. His password is not known
    // to this test and must not be, so the assertion is on the SHAPE of the
    // refusal: a real account is refused for being wrong, never for being demo.
    const real = "chris@fundhub.ai";
    const exists = await db.query(
      `SELECT 1 FROM staff WHERE org_id = $1 AND lower(email) = $2`, [org, real]);
    if (!exists.rows.length) return;   // roster not seeded here — nothing to check

    for (const env of [OFF, ON]) {
      const out = await login(db, { email: real, password: "deliberately-wrong-password", env });
      assert.equal(out.ok, false);
      assert.notEqual(out.error, "demo_logins_disabled",
        `${real} was treated as a demo account — the gate is catching real rows`);
      assert.equal(out.error, "invalid_credentials");
    }
  });

  test("no row outside the demo domain is flagged is_demo",
    { skip: needMigration() }, async () => {
    const s = await db.query(
      `SELECT email FROM staff WHERE is_demo AND email NOT LIKE '%@demo.fundhub.local'`);
    assert.deepEqual(s.rows, [], "a real-looking staff address is flagged is_demo");
    const a = await db.query(
      `SELECT email FROM accounts WHERE is_demo AND email NOT LIKE '%@demo.fundhub.local'`);
    assert.deepEqual(a.rows, [], "a real-looking account address is flagged is_demo");
  });
});
