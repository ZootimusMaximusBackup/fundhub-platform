// Guards the seam that produced the CRM lockout bug: public/app/shell.js gates
// every screen on staff.role, but staff.role is free text and the catalog it is
// supposed to match lives in the database. Nothing connected the two, so a role
// in one and not the other was only discoverable by a user hitting it.
//
// This is a drift test, not a schema constraint. A CHECK or FK on staff.role
// would be stronger, but it can fail an existing database — 020_auth.sql
// deliberately backfills the catalog FROM staff.role precisely because rows with
// off-catalog roles are expected to exist. Adding that constraint is a call for
// the operator, not something to slip in. This test catches the drift in CI
// instead, with no migration risk.
//
// What it pins:
//   every STAFF role shell.js grants tabs to exists in staff_roles
//   'client' and 'affiliate' are NOT grantable staff roles — they are principal
//     types with no catalog row, and must stay that way until the accounts table
//   'partner' IS in the catalog, deliberately and temporarily (036_partner_role)

import { test, after, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "./org.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const SHELL = path.join(process.cwd(), "public/app/shell.js");

// Principal types: referenced by ROLE_TABS, but not employees. See the comment
// on ROLE_TABS in shell.js and the DESIGN NOTE in 036_partner_role.sql.
const PRINCIPALS = new Set(["client", "affiliate", "partner"]);
// The one principal seeded into the staff catalog on purpose, to make
// brand-studio.html reachable before the accounts table exists.
const PRINCIPAL_IN_CATALOG = new Set(["partner"]);

export function roleTabsKeys(source) {
  const block = source.match(/var ROLE_TABS = \{([\s\S]*?)\n {2}\};/);
  assert.ok(block, "could not find ROLE_TABS in shell.js — did the shape change?");
  const keys = [...block[1].matchAll(/^\s*([a-z_]+):/gm)].map((m) => m[1]);
  assert.ok(keys.length >= 6, `parsed only ${keys.length} roles from ROLE_TABS`);
  return keys;
}

describe("shell.js roles vs the staff_roles catalog",
  { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {

  after(async () => { await close(); });

  test("every staff role shell.js grants tabs to exists in the catalog", async () => {
    const org = await resolveDefaultOrg(db);
    const catalog = new Set((await db.query(
      `SELECT lower(btrim(key)) AS key FROM staff_roles WHERE org_id = $1`, [org]
    )).rows.map((r) => r.key));

    const staffRoles = roleTabsKeys(fs.readFileSync(SHELL, "utf8"))
      .filter((r) => !PRINCIPALS.has(r));

    const missing = staffRoles.filter((r) => !catalog.has(r));
    assert.deepEqual(missing, [],
      `shell.js grants tabs to ${JSON.stringify(missing)}, absent from staff_roles. ` +
      `A staff member holding one of those reaches the CRM as an unrecognised role.`);
  });

  test("'client' and 'affiliate' are not grantable as staff roles", async () => {
    const org = await resolveDefaultOrg(db);
    const catalog = new Set((await db.query(
      `SELECT lower(btrim(key)) AS key FROM staff_roles WHERE org_id = $1`, [org]
    )).rows.map((r) => r.key));

    for (const p of PRINCIPALS) {
      if (PRINCIPAL_IN_CATALOG.has(p)) {
        assert.ok(catalog.has(p),
          `'${p}' should be in the catalog per 036_partner_role.sql — was it reverted ` +
          `without updating PRINCIPAL_IN_CATALOG here?`);
      } else {
        assert.ok(!catalog.has(p),
          `'${p}' is a principal type, not an employee. A staff row holding it would be ` +
          `invited through the staff flow and gated as staff. It belongs in the accounts table.`);
      }
    }
  });

  test("no staff row holds a role the catalog does not know", async () => {
    const org = await resolveDefaultOrg(db);
    const orphans = (await db.query(
      `SELECT DISTINCT lower(btrim(s.role)) AS role
         FROM staff s
        WHERE s.org_id = $1
          AND s.role IS NOT NULL AND btrim(s.role) <> ''
          AND NOT EXISTS (
            SELECT 1 FROM staff_roles r
             WHERE r.org_id = s.org_id AND lower(btrim(r.key)) = lower(btrim(s.role))
          )`, [org]
    )).rows.map((r) => r.role);

    assert.deepEqual(orphans, [],
      `staff rows hold off-catalog roles: ${JSON.stringify(orphans)}. ` +
      `020_auth.sql's backfill should have added them — re-run migrations.`);
  });

  test("every catalog role resolves to at least one screen", async () => {
    const org = await resolveDefaultOrg(db);
    const catalog = (await db.query(
      `SELECT lower(btrim(key)) AS key FROM staff_roles WHERE org_id = $1`, [org]
    )).rows.map((r) => r.key);

    // shell.js falls back to the staff surface for an unknown role, so nobody
    // can be locked out any more — but a catalog role that shell.js has never
    // heard of still means the tab map is out of date, which is worth knowing.
    const known = new Set(roleTabsKeys(fs.readFileSync(SHELL, "utf8")));
    const unmapped = catalog.filter((r) => !known.has(r));
    assert.deepEqual(unmapped, [],
      `staff_roles carries ${JSON.stringify(unmapped)}, which ROLE_TABS does not mention. ` +
      `They fall back to the shared staff surface; add them to the map deliberately.`);
  });
});
