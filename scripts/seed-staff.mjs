// Create the six founding staff logins, idempotently.
//
//   DATABASE_URL=postgres://... STAFF_INITIAL_PASSWORD='…' node scripts/seed-staff.mjs
//   …                                                      node scripts/seed-staff.mjs --reset-passwords
//
// The password comes from the environment and is never accepted as an argument:
// argv lands in shell history and in the process table, where any other process
// on the box can read it with `ps`. (scripts/create-staff.mjs takes it
// positionally — prefer this script for anything real.)
//
// Re-running is safe. An account that already exists has its role, name and
// status reconciled and its password left alone, so this cannot silently undo a
// password somebody has changed. --reset-passwords opts into the destructive
// version and puts all six back to the seed value.
//
// Roster and upsert live in src/auth/seed-staff.mjs so they can be tested
// without running a seed. Nothing here prints the password or the hash.

import { db, close } from "../src/db.mjs";
import { seedStaff, FOUNDING_STAFF, PASSWORD_ENV } from "../src/auth/seed-staff.mjs";

const resetPasswords = process.argv.includes("--reset-passwords");
const password = process.env[PASSWORD_ENV];

if (!password) {
  console.error(`${PASSWORD_ENV} is not set.

  DATABASE_URL=postgres://... ${PASSWORD_ENV}='<a strong password>' \\
    node scripts/seed-staff.mjs

Accounts that would be created (${FOUNDING_STAFF.length}):
${FOUNDING_STAFF.map((p) => `  ${p.email.padEnd(20)} ${p.role}`).join("\n")}

Set it in the shell that runs this, not on the command line — an argument is
visible in shell history and to every process on the machine.`);
  process.exit(1);
}

try {
  const results = await seedStaff(db, { password, resetPasswords });
  for (const r of results) {
    console.log(`${r.action.padEnd(15)} ${r.email.padEnd(20)} ${r.role}`);
  }
  const created = results.filter((r) => r.action === "created").length;
  const reset = results.filter((r) => r.action === "password-reset").length;
  console.log(`\n${results.length} account(s): ${created} created, ${reset} password-reset, ` +
              `${results.filter((r) => r.action === "unchanged").length} already correct.`);
  if (!resetPasswords && created === 0) {
    console.log("Passwords were left untouched. Use --reset-passwords to force them back to the seed value.");
  }
} catch (e) {
  // A policy failure names the rule, never the value.
  console.error("FAILED:", e.message);
  process.exitCode = 1;
} finally {
  await close();
}
