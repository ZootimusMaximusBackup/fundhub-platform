// Regenerates the scrypt verifier that db/migrations/094_demo_logins.sql seeds.
//
// WHY A SCRIPT AND NOT SQL. src/auth/hash.mjs derives the key with scrypt
// (N=32768, r=8, p=1) and encodes it PHC-style. Postgres has no scrypt in core,
// so a migration cannot compute the value — it can only carry a literal. This
// script produces that literal using the SAME function the login path verifies
// with (src/auth/hash.mjs:hashPassword), which is the whole point: there is one
// hashing implementation in this repo and the demo rows go through it like
// everybody else. No second auth path, no password-check bypass.
//
// WHY A HASH IN A CHECKED-IN FILE IS NOT A LEAKED SECRET HERE. The demo
// password is published on purpose — public/login.html prints it on the page —
// and every row it unlocks is fenced three ways:
//   1. DEMO_LOGINS_ENABLED must be set, or none of them authenticate at all
//      (src/auth/demo-logins.mjs, fails closed exactly like isPlaidEnabled()).
//   2. Every row carries is_demo = true, so a demo login is refusable by the
//      row and not only by its address.
//   3. Every address is on demo.fundhub.local, a domain that cannot receive
//      mail and cannot be mistaken for an employee.
// A real credential must never be pasted into this file. If you need to change
// the demo password, change DEMO_PASSWORD in src/auth/demo-roster.mjs, re-run
// this script, and paste the new literal into 094.
//
// Usage: node scripts/db/demo-password-hash.mjs

import { hashPassword, verifyPassword } from "../../src/auth/hash.mjs";
import { DEMO_PASSWORD } from "../../src/auth/demo-roster.mjs";

const hash = await hashPassword(DEMO_PASSWORD);

// Verify before printing. A literal that does not verify would seed nine rows
// that look right in psql and refuse every login, which is the single most
// confusing failure this file could produce.
if (!(await verifyPassword(DEMO_PASSWORD, hash))) {
  console.error("FATAL: generated hash does not verify — do not use it.");
  process.exit(1);
}

console.log(hash);
