// Postgres-backed tests for the founding-staff seed. Skipped without
// DATABASE_URL, like the other *.pg.test.mjs files.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { seedStaff, upsertStaff, FOUNDING_STAFF, PASSWORD_ENV } from "./seed-staff.mjs";
import { resolveDefaultOrg } from "./org.mjs";
import { verifyPassword } from "./hash.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const GOOD = "seed-password-for-tests";
const OTHER = "a-different-password-1";

describe("founding staff seed", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org;
  const emails = FOUNDING_STAFF.map((p) => p.email);

  before(async () => {
    org = await resolveDefaultOrg(db);
    await db.query(`DELETE FROM staff WHERE org_id = $1 AND lower(email) = ANY($2)`, [org, emails]);
  });

  after(async () => {
    await db.query(`DELETE FROM staff WHERE org_id = $1 AND lower(email) = ANY($2)`, [org, emails]);
    await close();
  });

  test("creates all six accounts with the roles the catalog knows", async () => {
    const results = await seedStaff(db, { password: GOOD });
    assert.equal(results.length, 6);
    assert.ok(results.every((r) => r.action === "created"), JSON.stringify(results));

    const rows = (await db.query(
      `SELECT lower(email) AS email, role, status FROM staff
        WHERE org_id = $1 AND lower(email) = ANY($2) ORDER BY email`, [org, emails])).rows;
    assert.equal(rows.length, 6);
    assert.ok(rows.every((r) => r.status === "active"));

    // Every seeded role must exist in the staff_roles catalog, or shell.js sees
    // an unrecognised role in production.
    const catalog = (await db.query(
      `SELECT lower(key) AS key FROM staff_roles WHERE org_id = $1`, [org])).rows.map((r) => r.key);
    for (const r of rows) assert.ok(catalog.includes(r.role), `role ${r.role} not in staff_roles`);

    assert.deepEqual(
      rows.map((r) => `${r.email}:${r.role}`).sort(),
      ["alvin@fundhub.ai:inquiry_specialist", "chris@fundhub.ai:owner",
       "jordan@fundhub.ai:closer", "marcus@fundhub.ai:funding_advisor",
       "nina@fundhub.ai:closer", "sarah@fundhub.ai:admin"]
    );
  });

  test("the seeded password actually verifies", async () => {
    const { rows: [row] } = await db.query(
      `SELECT password_hash FROM staff WHERE org_id = $1 AND lower(email) = $2`,
      [org, "chris@fundhub.ai"]);
    assert.equal(await verifyPassword(GOOD, row.password_hash), true);
    assert.equal(await verifyPassword(OTHER, row.password_hash), false);
  });

  test("re-running is idempotent — no duplicates, nothing reported as changed", async () => {
    const results = await seedStaff(db, { password: GOOD });
    assert.ok(results.every((r) => r.action === "unchanged"), JSON.stringify(results));
    const { rows: [{ n }] } = await db.query(
      `SELECT count(*)::int AS n FROM staff WHERE org_id = $1 AND lower(email) = ANY($2)`,
      [org, emails]);
    assert.equal(n, 6);
  });

  test("re-running does NOT clobber a password the user has changed", async () => {
    // Simulate a staff member rotating their own password.
    const { hashPassword } = await import("./hash.mjs");
    await db.query(`UPDATE staff SET password_hash = $2 WHERE org_id = $1 AND lower(email) = $3`,
      [org, await hashPassword(OTHER), "nina@fundhub.ai"]);

    await seedStaff(db, { password: GOOD });

    const { rows: [row] } = await db.query(
      `SELECT password_hash FROM staff WHERE org_id = $1 AND lower(email) = $2`,
      [org, "nina@fundhub.ai"]);
    assert.equal(await verifyPassword(OTHER, row.password_hash), true,
      "the seed overwrote a password it should have left alone");
    assert.equal(await verifyPassword(GOOD, row.password_hash), false);
  });

  test("--reset-passwords is the opt-in that does overwrite", async () => {
    const results = await seedStaff(db, { password: GOOD, resetPasswords: true });
    assert.ok(results.every((r) => r.action === "password-reset"));
    const { rows: [row] } = await db.query(
      `SELECT password_hash FROM staff WHERE org_id = $1 AND lower(email) = $2`,
      [org, "nina@fundhub.ai"]);
    assert.equal(await verifyPassword(GOOD, row.password_hash), true);
  });

  test("a drifted role or a suspended account is reconciled", async () => {
    await db.query(
      `UPDATE staff SET role = 'setter', status = 'suspended'
        WHERE org_id = $1 AND lower(email) = $2`, [org, "jordan@fundhub.ai"]);

    const results = await seedStaff(db, { password: GOOD });
    const jordan = results.find((r) => r.email === "jordan@fundhub.ai");
    assert.equal(jordan.action, "updated");

    const { rows: [row] } = await db.query(
      `SELECT role, status FROM staff WHERE org_id = $1 AND lower(email) = $2`,
      [org, "jordan@fundhub.ai"]);
    assert.equal(row.role, "closer");
    assert.equal(row.status, "active");
  });

  test("a weak password is refused before any row is written", async () => {
    await db.query(`DELETE FROM staff WHERE org_id = $1 AND lower(email) = ANY($2)`, [org, emails]);
    await assert.rejects(
      () => seedStaff(db, { password: "short" }),
      (e) => e.message.includes(PASSWORD_ENV) && /at least/.test(e.message)
    );
    const { rows: [{ n }] } = await db.query(
      `SELECT count(*)::int AS n FROM staff WHERE org_id = $1 AND lower(email) = ANY($2)`,
      [org, emails]);
    assert.equal(n, 0, "a rejected password still created rows");
  });

  test("upsertStaff rejects an entry missing an email or a role", async () => {
    await assert.rejects(() => upsertStaff(db, org, { role: "owner" }, { password: GOOD }),
      /no email/);
    await assert.rejects(() => upsertStaff(db, org, { email: "x@y.z" }, { password: GOOD }),
      /no role/);
  });

  test("email and role are folded, so a stray case cannot create a second row", async () => {
    await db.query(`DELETE FROM staff WHERE org_id = $1 AND lower(email) = $2`, [org, "chris@fundhub.ai"]);
    await upsertStaff(db, org, { email: "  Chris@FundHub.ai ", role: " Owner ", name: "C" },
      { password: GOOD });
    await upsertStaff(db, org, { email: "chris@fundhub.ai", role: "owner", name: "C" },
      { password: GOOD });
    const { rows } = await db.query(
      `SELECT email, role FROM staff WHERE org_id = $1 AND lower(email) = $2`,
      [org, "chris@fundhub.ai"]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].email, "chris@fundhub.ai");
    assert.equal(rows[0].role, "owner");
  });
});
