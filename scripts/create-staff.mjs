// Create or update a staff login.
//
//   DATABASE_URL=postgres://... node scripts/create-staff.mjs <email> <password> <role> [name]
//
// Roles (catalog, 020_auth.sql): owner | admin | closer | funding_advisor |
// inquiry_specialist | setter. Upserts by (default org, email), sets the
// password hash and status=active. Prints the row — never the password.

import { db, close } from "../src/db.mjs";
import { hashPassword } from "../src/auth/hash.mjs";
import { resolveDefaultOrg } from "../src/auth/org.mjs";

const [email, password, role, ...nameParts] = process.argv.slice(2);
const name = nameParts.join(" ") || null;

if (!email || !password || !role) {
  console.error("usage: node scripts/create-staff.mjs <email> <password> <role> [name]");
  process.exit(1);
}

const norm = email.trim().toLowerCase();
const org = await resolveDefaultOrg(db);
const password_hash = await hashPassword(password);

const existing = await db.query(
  `SELECT id FROM staff WHERE org_id = $1 AND lower(email) = $2 LIMIT 1`,
  [org, norm]
);

let row;
if (existing.rows[0]) {
  ({ rows: [row] } = await db.query(
    `UPDATE staff SET password_hash = $2, role = $3, name = COALESCE($4, name), status = 'active'
      WHERE id = $1 RETURNING id, email, name, role, status`,
    [existing.rows[0].id, password_hash, role, name]
  ));
  console.log("updated:", row);
} else {
  ({ rows: [row] } = await db.query(
    `INSERT INTO staff (org_id, email, name, role, status, password_hash)
     VALUES ($1, $2, $3, $4, 'active', $5)
     RETURNING id, email, name, role, status`,
    [org, norm, name || norm, role, password_hash]
  ));
  console.log("created:", row);
}

await close();
