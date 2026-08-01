// One test login per role, at an obvious @fundhub.ai address, all sharing one
// password — for a human to actually get into every screen and check it.
//
// NOT THE DEMO SYSTEM. db/migrations/094_demo_logins.sql already seeds nine
// accounts, but they are is_demo=true and refuse to authenticate unless
// DEMO_LOGINS_ENABLED is set (src/auth/demo-logins.mjs) — and turning that flag
// on also makes GET /api/auth/login publish the whole roster and the shared
// password to anyone who asks, unauthenticated. These accounts are the
// opposite of that: ordinary, always-on rows, reachable only by the person who
// already holds the password. They are named "TEST — <Role>" so they read as
// obviously-not-a-customer in every staff/client/affiliate/partner list, the
// same discipline 094 applies with is_demo, without borrowing its gate.
//
// THE SALES-MANAGER ROLE IS DELIBERATELY ABSENT FROM THIS ROSTER.
// docs/journeys/role-sales-manager-actual.md records an owner decision
// (2026-07-31) that this role is planned, not yet built, and that no agent
// should create it on its own initiative. Confirmed with the owner before
// writing this file — skip it here too, do not invent it.
//
// IDEMPOTENT, LIKE src/auth/seed-staff.mjs. An existing row has its password
// left alone unless resetPasswords is asked for explicitly. Re-running this
// after somebody has changed one of these passwords does not put it back.

import { hashPassword, validatePassword } from "./hash.mjs";
import { resolveDefaultOrg } from "./org.mjs";
import { upsertStaff } from "./seed-staff.mjs";
import { createAccount } from "./account-session.mjs";

export const ROLE_TEST_STAFF = [
  { email: "owner@fundhub.ai",   role: "owner",              name: "TEST — Owner Role" },
  { email: "admin@fundhub.ai",   role: "admin",              name: "TEST — Admin Role" },
  { email: "closer@fundhub.ai",  role: "closer",             name: "TEST — Closer Role" },
  { email: "advisor@fundhub.ai", role: "funding_advisor",    name: "TEST — Funding Advisor Role" },
  { email: "inquiry@fundhub.ai", role: "inquiry_specialist", name: "TEST — Inquiry Specialist Role" },
  { email: "setter@fundhub.ai",  role: "setter",              name: "TEST — Setter Role" }
];

export const ROLE_TEST_PRINCIPALS = [
  { kind: "client",    email: "client@fundhub.ai",    name: "TEST — Client Role" },
  { kind: "affiliate", email: "affiliate@fundhub.ai", name: "TEST — Affiliate Role" },
  { kind: "partner",   email: "partner@fundhub.ai",   name: "TEST — White-Label Partner Role" }
];

// A fixed sentinel so re-running this file finds the same client row rather
// than creating a second one. clients.client_master_key is UNIQUE, so this is
// a real, enforced idempotence key, not a convention that hopes not to race.
const CLIENT_TEST_KEY = "FDH-TEST-CLIENT-ROLE-ACCOUNT";
const PARTNER_TEST_SLUG = "test-role-partner";

// upsertPrincipal — one client/affiliate/partner test login.
//
// Looked up by the ACCOUNTS row first: that is the thing with the unique
// (org_id, email) index, so it is the reliable idempotence check. Only when no
// account exists does this go looking for (or create) the subject row it needs
// to link to.
async function upsertPrincipal(db, orgId, invitedById, person, { password, resetPasswords }) {
  const email = person.email.trim().toLowerCase();

  const existing = (await db.query(
    `SELECT id, status FROM accounts WHERE org_id = $1 AND lower(email) = $2 LIMIT 1`,
    [orgId, email]
  )).rows[0];

  if (existing) {
    if (!resetPasswords) return { email, role: person.kind, action: "unchanged" };
    const password_hash = await hashPassword(password);
    await db.query(
      `UPDATE accounts SET password_hash = $2, status = 'active' WHERE id = $1`,
      [existing.id, password_hash]
    );
    return { email, role: person.kind, action: "password-reset" };
  }

  let subjectId;
  if (person.kind === "client") {
    const found = (await db.query(
      `SELECT id FROM clients WHERE org_id = $1 AND client_master_key = $2 LIMIT 1`,
      [orgId, CLIENT_TEST_KEY]
    )).rows[0];
    subjectId = found?.id ?? (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email, client_master_key)
       VALUES ($1, 'TEST', 'Client Role', $2, $3) RETURNING id`,
      [orgId, email, CLIENT_TEST_KEY]
    )).rows[0].id;
  } else if (person.kind === "affiliate") {
    const found = (await db.query(
      `SELECT id FROM affiliates WHERE org_id = $1 AND name = $2 LIMIT 1`,
      [orgId, person.name]
    )).rows[0];
    subjectId = found?.id ?? (await db.query(
      `INSERT INTO affiliates (org_id, name, status) VALUES ($1, $2, 'active') RETURNING id`,
      [orgId, person.name]
    )).rows[0].id;
  } else {
    const found = (await db.query(
      `SELECT id FROM partners WHERE org_id = $1 AND slug = $2 LIMIT 1`,
      [orgId, PARTNER_TEST_SLUG]
    )).rows[0];
    subjectId = found?.id ?? (await db.query(
      `INSERT INTO partners (org_id, name, brand_name, slug, status)
       VALUES ($1, $2, $2, $3, 'active') RETURNING id`,
      [orgId, person.name, PARTNER_TEST_SLUG]
    )).rows[0].id;
  }

  const account = await createAccount(db, {
    orgId, kind: person.kind, email, name: person.name, password,
    clientId: person.kind === "client" ? subjectId : null,
    affiliateId: person.kind === "affiliate" ? subjectId : null,
    partnerId: person.kind === "partner" ? subjectId : null,
    invitedBy: invitedById
  });
  return { email: account.email, role: person.kind, action: "created" };
}

// seedRoleAccounts — the six staff test logins plus the three principal test
// logins. Validates the password once, up front, exactly like seedStaff does.
export async function seedRoleAccounts(db, { password, resetPasswords = false } = {}) {
  const bad = validatePassword(password);
  if (bad) throw new Error(bad);

  const orgId = await resolveDefaultOrg(db);
  const results = [];

  for (const person of ROLE_TEST_STAFF) {
    results.push(await upsertStaff(db, orgId, person, { password, resetPasswords }));
  }

  // The inviter of record for the three principal accounts. 044's trigger
  // requires one for kind='partner'; using a real staff id keeps the audit
  // trail meaningful for the other two as well. Missing chris is not fatal —
  // client and affiliate both allow self-signup, so invitedBy=null still works
  // for them, and only a partner row would need a human to run seed-staff.mjs
  // first.
  const inviter = (await db.query(
    `SELECT id FROM staff WHERE org_id = $1 AND lower(email) = 'chris@fundhub.ai' LIMIT 1`,
    [orgId]
  )).rows[0];

  for (const person of ROLE_TEST_PRINCIPALS) {
    results.push(await upsertPrincipal(db, orgId, inviter?.id ?? null, person, { password, resetPasswords }));
  }

  return results;
}

export default seedRoleAccounts;
