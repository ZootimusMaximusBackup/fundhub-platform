// Create the nine role test logins, and optionally reset chris@fundhub.ai's
// password in the same run — the two-part fix for a locked-out owner.
//
//   DATABASE_URL=postgres://... ROLE_TEST_PASSWORD='Fundhub2026!' \
//     node scripts/seed-role-accounts.mjs
//
//   … --reset-owner-password              also resets chris@fundhub.ai to the
//                                          same value (only chris — no other
//                                          founding staff is touched)
//   … --reset-passwords                   forces ALL NINE role accounts back
//                                          to ROLE_TEST_PASSWORD, including any
//                                          that already existed
//
// The password comes from the environment, never argv — see
// src/auth/seed-staff.mjs for why. Nothing here prints the password or the
// hash.

import { db, close } from "../src/db.mjs";
import { seedRoleAccounts, ROLE_TEST_STAFF, ROLE_TEST_PRINCIPALS } from "../src/auth/seed-role-accounts.mjs";
import { upsertStaff } from "../src/auth/seed-staff.mjs";
import { resolveDefaultOrg } from "../src/auth/org.mjs";

const PASSWORD_ENV = "ROLE_TEST_PASSWORD";
const password = process.env[PASSWORD_ENV];
const resetPasswords = process.argv.includes("--reset-passwords");
const resetOwner = process.argv.includes("--reset-owner-password");

if (!password) {
  const all = [...ROLE_TEST_STAFF, ...ROLE_TEST_PRINCIPALS];
  console.error(`${PASSWORD_ENV} is not set.

  DATABASE_URL=postgres://... ${PASSWORD_ENV}='<password, 12+ chars>' \\
    node scripts/seed-role-accounts.mjs [--reset-owner-password] [--reset-passwords]

Accounts that would be created (${all.length}):
${all.map((p) => `  ${p.email.padEnd(20)} ${p.role}`).join("\n")}

Set it in the shell that runs this, not on the command line.`);
  process.exit(1);
}

try {
  const results = await seedRoleAccounts(db, { password, resetPasswords });
  for (const r of results) console.log(`${r.action.padEnd(15)} ${r.email.padEnd(24)} ${r.role}`);

  if (resetOwner) {
    const orgId = await resolveDefaultOrg(db);
    const r = await upsertStaff(
      db, orgId,
      { email: "chris@fundhub.ai", role: "owner", name: "Chris Stanbridge" },
      { password, resetPasswords: true }
    );
    console.log(`${r.action.padEnd(15)} ${r.email.padEnd(24)} ${r.role}  (owner — explicitly reset)`);
  } else {
    console.log("\nchris@fundhub.ai was NOT touched. Add --reset-owner-password to reset it too.");
  }

  const created = results.filter((r) => r.action === "created").length;
  const reset = results.filter((r) => r.action === "password-reset").length + (resetOwner ? 1 : 0);
  console.log(`\n${results.length + (resetOwner ? 1 : 0)} account(s): ${created} created, ${reset} password-reset, ` +
              `${results.filter((r) => r.action === "unchanged").length} already correct.`);
} catch (e) {
  console.error("FAILED:", e.message);
  process.exitCode = 1;
} finally {
  await close();
}
