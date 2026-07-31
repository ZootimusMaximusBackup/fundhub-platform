// THE CONNECTION ROLE IS PART OF THE SECURITY MODEL, AND NOTHING CHECKED IT.
//
// *** WHAT THIS FILE EXISTS TO CATCH. ***
//
// src/partners/rls.mjs relies on Postgres row-level security to keep one
// white-label partner out of another's data. The policies are real, they are
// correct, and eighteen tables carry one:
//
//   ((partner_id = fundhub_current_partner()) OR fundhub_is_staff())
//
// Every one of those tables also has RLS both ENABLED and FORCED, which is the
// stronger setting and the one that closes the table-owner loophole.
//
// None of that matters if the application connects as a superuser.
//
// A Postgres superuser — and any role holding BYPASSRLS — ignores row security
// entirely. FORCE ROW LEVEL SECURITY does not change that; FORCE closes the
// OWNER loophole, not the SUPERUSER one. There is no policy, no constraint and
// no grant that can restrain a superuser, because bypassing them is what the
// attribute means.
//
// Demonstrated against a real database while writing this file. One row of
// partner A's brand_kits, two sessions, both setting app.partner_id to a
// DIFFERENT partner, the same SELECT:
//
//   connected as a superuser      -> 1 row   (partner A's row, handed to B)
//   connected as a normal role    -> 0 rows  (the policy applied)
//
// So the isolation this system documents is a property of the CONNECTION
// STRING, not of the schema. Point DATABASE_URL at the `postgres` role and
// every partner boundary in the product silently disappears, with the policies
// still sitting in the catalog looking correct.
//
//
// *** WHY THIS WENT UNNOTICED FOR SO LONG. ***
//
// It did not go unnoticed. It was misfiled.
//
// Twenty-four tests fail against a real database on this branch, and they
// failed identically on the baseline commit eleven commits earlier, so the
// W1-W10 audit correctly classified them as "pre-existing, not a regression"
// and moved on. But every one of those twenty-four is an isolation test:
//
//   src/compliance/invariants.pg.test.mjs  - "an unscoped session reads zero
//                                             rows from every module table"
//                                          - "partner B reads zero rows of
//                                             partner A's data"
//   src/http/creative-endpoints.pg.test.mjs - fourteen "returns nothing for a
//                                             partner who owns none of it"
//   src/creative/generate.pg.test.mjs      - three partner-scoping cases
//   src/social/social.pg.test.mjs          - "usage events are partner-isolated"
//
// They were not failing because they are flaky, or slow, or badly written. They
// were failing because they are correct and the thing they test was broken —
// under the superuser connection the suite itself runs on. A long-standing red
// test that everyone has agreed to ignore is the best hiding place a security
// defect has, and CLAUDE.md's own trap note ("the suite is not as green as it
// looks... ~24 pre-existing failures") had made ignoring them official.
//
//
// *** WHAT THIS TEST DOES, AND WHAT IT DELIBERATELY DOES NOT DO. ***
//
// It asks one question of whatever DATABASE_URL points at: can the role we
// connected as bypass row security? It does not try to fix anything, it does
// not create a role, and it does not read or write a single application row.
//
// It CANNOT tell you about production from here. api.netlify.com is blocked by
// network policy in the agent environment, so nobody in this repository can
// read production's DATABASE_URL. This test answers the question for whichever
// database it is pointed at, which is exactly why it belongs in the suite: run
// it in CI against the deployment target and the answer stops being a guess.
//
// SKIPPED, NOT PASSED, WITH NO DATABASE. Reporting green here without a
// connection would be the same failure mode as the twenty-four above.

import { test, before, after } from "node:test";
import assert from "node:assert";

import { db, close } from "../db.mjs";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const opts = HAS_DB ? {} : { skip: "DATABASE_URL is not set — this asks a live database about its own role" };

after(async () => { if (HAS_DB) await close(); });

test("the role the application connects as cannot bypass row-level security", opts, async () => {
  const res = await db.query(
    `SELECT current_user AS role,
            rolsuper     AS is_superuser,
            rolbypassrls AS has_bypassrls
       FROM pg_roles
      WHERE rolname = current_user`
  );

  const row = res.rows[0];
  assert.ok(row, "could not read the current role from pg_roles");

  /* Two separate attributes, either of which defeats every policy in the
     catalog. They are asserted separately so the failure names which one is
     set — the remedies differ (stop using the superuser vs. revoke BYPASSRLS)
     and a combined assertion would send somebody down the wrong path. */

  assert.equal(
    row.is_superuser, false,
    `DATABASE_URL connects as "${row.role}", which is a SUPERUSER. Superusers ignore ` +
    "row-level security completely — FORCE ROW LEVEL SECURITY does not apply to them. " +
    "Every partner-isolation policy in src/partners/rls.mjs is inert on this connection: " +
    "one partner can read another partner's brand kits, campaigns, creative assets, ad " +
    "spend and usage events. Connect as a dedicated non-superuser application role that " +
    "owns nothing and holds only the grants it needs."
  );

  assert.equal(
    row.has_bypassrls, false,
    `DATABASE_URL connects as "${row.role}", which holds BYPASSRLS. That attribute does ` +
    "exactly what its name says and defeats every partner-isolation policy. " +
    "Run: ALTER ROLE " + row.role + " NOBYPASSRLS;"
  );
});

/* A companion assertion, because a correct role with a broken schema fails just
   as open as the reverse. This is cheap and it pins the OTHER half of the
   arrangement: every table src/partners/rls.mjs reads must have row security
   both enabled AND forced.

   FORCE matters on its own. Without it the policies do not apply to the table's
   OWNER, and an application connecting as the role that ran the migrations is
   the owner. Enabled-but-not-forced is the second way this leaks, and it looks
   identical in a casual `\d` listing. */
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
