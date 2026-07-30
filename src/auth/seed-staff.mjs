// The six founding staff logins, and the idempotent upsert that creates them.
//
// The roster is data, not script, so it can be asserted in a test without
// running a seed. scripts/seed-staff.mjs is the CLI over this module.
//
// WHY THIS EXISTS ALONGSIDE scripts/create-staff.mjs: that script takes the
// password as argv, which puts a live credential in shell history and in the
// process table, where any other process on the box can read it with `ps`.
// This path reads it from the environment once and never accepts it positionally.
//
// IDEMPOTENCE — the important detail. Re-running must not reset a password
// somebody has already changed. An existing row has its role, name and status
// reconciled; its password_hash is left alone unless resetPasswords is set
// explicitly. So the safe operation (make sure these six can sign in) is
// re-runnable, and the destructive one (put them all back to the seed password)
// has to be asked for.

import { hashPassword, validatePassword } from "./hash.mjs";
import { resolveDefaultOrg } from "./org.mjs";

// Roles are the catalog keys from 020_auth.sql. Kept lowercase and trimmed
// because staff.role is free text and public/app/shell.js folds with
// lower(btrim()) to match the catalog — a stray case difference here would
// reach the browser as an unrecognised role.
export const FOUNDING_STAFF = [
  { email: "chris@fundhub.ai",  role: "owner",              name: "Chris Stanbridge" },
  { email: "sarah@fundhub.ai",  role: "admin",              name: "Sarah Whitfield" },
  { email: "jordan@fundhub.ai", role: "closer",             name: "Jordan Blake" },
  { email: "nina@fundhub.ai",   role: "closer",             name: "Nina Castellano" },
  { email: "marcus@fundhub.ai", role: "funding_advisor",    name: "Marcus Webb" },
  { email: "alvin@fundhub.ai",  role: "inquiry_specialist", name: "Alvin Torres" }
];

export const PASSWORD_ENV = "STAFF_INITIAL_PASSWORD";

// upsertStaff — one account. Returns { email, role, action } where action is
// "created" | "updated" | "unchanged" | "password-reset". Never returns or logs
// the password or the hash.
export async function upsertStaff(db, orgId, person, { password, resetPasswords = false } = {}) {
  const email = String(person.email || "").trim().toLowerCase();
  const role = String(person.role || "").trim().toLowerCase();
  if (!email) throw new Error("staff entry has no email");
  if (!role) throw new Error(`staff entry ${email} has no role`);

  const existing = await db.query(
    `SELECT id, role, name, status FROM staff WHERE org_id = $1 AND lower(email) = $2 LIMIT 1`,
    [orgId, email]
  );

  if (!existing.rows[0]) {
    const password_hash = await hashPassword(password);
    await db.query(
      `INSERT INTO staff (org_id, email, name, role, status, password_hash)
       VALUES ($1, $2, $3, $4, 'active', $5)`,
      [orgId, email, person.name || email, role, password_hash]
    );
    return { email, role, action: "created" };
  }

  const row = existing.rows[0];
  const drifted = row.role !== role || row.status !== "active" ||
                  (person.name && row.name !== person.name);

  if (resetPasswords) {
    const password_hash = await hashPassword(password);
    await db.query(
      `UPDATE staff SET role = $2, name = COALESCE($3, name), status = 'active',
                        password_hash = $4
        WHERE id = $1`,
      [row.id, role, person.name || null, password_hash]
    );
    return { email, role, action: "password-reset" };
  }

  if (!drifted) return { email, role, action: "unchanged" };

  await db.query(
    `UPDATE staff SET role = $2, name = COALESCE($3, name), status = 'active' WHERE id = $1`,
    [row.id, role, person.name || null]
  );
  return { email, role, action: "updated" };
}

// seedStaff — the whole roster. Validates the password once, up front, so a
// weak value fails before any row is written rather than half way through.
export async function seedStaff(db, {
  password,
  roster = FOUNDING_STAFF,
  resetPasswords = false
} = {}) {
  const bad = validatePassword(password);
  if (bad) throw new Error(`${PASSWORD_ENV}: ${bad}`);

  const orgId = await resolveDefaultOrg(db);
  const results = [];
  for (const person of roster) {
    results.push(await upsertStaff(db, orgId, person, { password, resetPasswords }));
  }
  return results;
}

export default seedStaff;
