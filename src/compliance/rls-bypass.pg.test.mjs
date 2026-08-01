// THE SCHEMA HALF OF THE ROW-LEVEL-SECURITY ARRANGEMENT.
//
// *** READ THIS FIRST: THIS FILE USED TO DO TWO JOBS, AND NOW DOES ONE. ***
//
// Partner isolation in this system needs two independent things to be true, and
// either one being false leaks the same data:
//
//   1. THE CONNECTION ROLE must not be able to bypass row security. A Postgres
//      superuser — and any role holding BYPASSRLS — ignores every policy in the
//      catalog. FORCE ROW LEVEL SECURITY does not change that: FORCE closes the
//      OWNER loophole, not the SUPERUSER one.
//
//   2. THE SCHEMA must actually have row security switched on, and forced, on
//      every table that carries a policy. A policy on a table without ENABLE
//      does nothing at all. A policy without FORCE does nothing for the table's
//      owner — which is the role that ran the migrations.
//
// This file originally asserted both. Item 1 is now owned, in much more depth,
// by src/security/superuser-guard.test.mjs — which arrived with the migration
// that created the unprivileged `fundhub_app` role
// (db/migrations/104_app_role.sql). That guard checks role MEMBERSHIP rather
// than just current_user's own catalog row, covers pg_read_all_data /
// pg_write_all_data and CREATE-on-public as well as rolsuper/rolbypassrls, runs
// as a Netlify build gate rather than only inside the suite, and deliberately
// does NOT skip itself when DATABASE_URL is unset in a deployed context.
//
// Keeping a weaker copy of that assertion here would mean two files failing for
// one cause, with the thinner message the more likely one to be read first. So
// the role check was removed from this file rather than duplicated. THE CHECK
// WAS NOT DROPPED — it moved, and it got stronger. Run `npm run guard:db`.
//
// What remains here is item 2, which the guard does not cover and never did:
// the guard interrogates the connection, this interrogates the schema. A
// correct role against a schema that forgot to FORCE fails just as open as the
// reverse.
//
//
// *** WHY THE SCHEMA HALF STILL NEEDS ITS OWN TEST. ***
//
// src/partners/rls.mjs stamps fundhub.partner_id onto each transaction and
// eighteen tables carry the policy that reads it back:
//
//   ((partner_id = fundhub_current_partner()) OR fundhub_is_staff())
//
// Those tables are installed across 045, 046, 047, 049 and 050. Nothing stops a
// nineteenth table from being added later with a policy and without the two
// ALTER TABLE lines that make the policy mean anything — and in a casual `\d`
// listing, that table looks exactly like the other eighteen. This test is what
// notices.
//
// SKIPPED, NOT PASSED, WITH NO DATABASE. It asks a live catalog a question it
// cannot answer offline. Reporting green without a connection would be the same
// failure mode this whole area of the codebase exists to prevent.

import { test, after } from "node:test";
import assert from "node:assert";

import { db, close } from "../db.mjs";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const opts = HAS_DB ? {} : { skip: "DATABASE_URL is not set — this asks a live database about its own schema" };

after(async () => { if (HAS_DB) await close(); });

test("every partner-scoped table has row security enabled AND forced", opts, async () => {
  const res = await db.query(
    `SELECT c.relname            AS table_name,
            c.relrowsecurity     AS enabled,
            c.relforcerowsecurity AS forced
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND EXISTS (SELECT 1 FROM pg_policies p
                     WHERE p.tablename = c.relname AND p.schemaname = 'public')
      ORDER BY c.relname`
  );

  assert.ok(res.rows.length > 0, "no table in this database carries a policy at all");

  const unforced = res.rows.filter((r) => !r.enabled || !r.forced);
  assert.deepEqual(
    unforced.map((r) => r.table_name), [],
    "these tables carry a partner-isolation policy that is not fully in force. A policy " +
    "that is not ENABLED does nothing; a policy that is not FORCED does nothing for the " +
    "table's owner, which is the role that ran the migrations. Fix with: " +
    "ALTER TABLE <name> ENABLE ROW LEVEL SECURITY; ALTER TABLE <name> FORCE ROW LEVEL SECURITY;"
  );
});
