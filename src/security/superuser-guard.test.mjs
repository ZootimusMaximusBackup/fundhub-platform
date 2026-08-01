// The app must never connect to Postgres as a superuser. This test is the
// permanent guard on that, and it is wired into the Netlify build
// (`npm run guard:db`) so it blocks a deploy rather than just a test run.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHAT IS ACTUALLY BEING PROTECTED
//
// Not just blast radius. Row Level Security.
//
// 045_creative_factory.sql installs ENABLE + FORCE ROW LEVEL SECURITY and a
// partner-isolation policy across nineteen tables (045, 046, 047, 049, 050).
// src/partners/rls.mjs stamps fundhub.partner_id onto each transaction and the
// policies read it back. The whole design is documented as the second lock:
// scope.mjs protects the query that remembers its filter, RLS protects the one
// that forgets.
//
// A superuser bypasses every policy on every table. So does any role holding
// rolbypassrls, FORCE or no FORCE. While the app connects as one, that second
// lock is open and cross-partner disclosure — named in rls.mjs as the worst bug
// the module can produce — is one forgotten WHERE clause away.
//
// This test is what makes it impossible to ship back into that state.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY IT IS NAMED *.test.mjs AND NOT *.pg.test.mjs
//
// CLAUDE.md §12 trap 2: files named *.pg.test.mjs follow a convention of
// skipping themselves when DATABASE_URL is unset, and ~193 of them do. A guard
// that skips itself is not a guard — it would report green on precisely the
// misconfiguration it exists to catch. So this file does not join that
// convention, and it decides for itself when a skip is legitimate.
//
// The rule it uses: a skip is legitimate on a developer's machine and nowhere
// else.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY THERE IS A LOCAL OPT-OUT AT ALL
//
// Because the test suite cannot run without an owner connection, and that is
// not a smell — it is what the suite tests. Roughly fourteen suites run
// ALTER TABLE … DISABLE TRIGGER to prove the archive-only guards hold
// (entitlements, invoices, documents, failed_events, partner_revenue,
// affiliate_referrals, action_log, plus the creative/social/compliance
// suites). DISABLE TRIGGER requires table ownership. There is no version of
// those tests that runs as fundhub_app.
//
// So DATABASE_URL means two different things depending on where you are: the
// app's runtime identity in a deployed environment, a developer fixture on a
// laptop. ALLOW_SUPERUSER_DB=1 names that difference out loud instead of
// letting it be discovered by a confusing failure.
//
// The opt-out is refused in any deployed environment — see the first test. An
// escape hatch that works in production is not an escape hatch, it is the hole.

import { test, after } from "node:test";
import assert from "node:assert";
import { pool, close } from "../db.mjs";

/* Deployment signals. NETLIFY, CONTEXT and BUILD_ID are set by Netlify during
   every build (production, deploy-preview and branch-deploy alike — which is
   what "in any environment" requires).

   CI AND GITHUB_ACTIONS ARE DELIBERATELY NOT IN THIS LIST, and that is a change
   from how this file was first written. It was authored when there was no
   .github/ directory at all, so "a CI runner" was hypothetical and treating one
   as a deployment cost nothing. .github/workflows/tests.yml now exists, and
   including those two variables actively breaks it in both of its jobs:

     * The blocking job runs the suite with NO DATABASE_URL on purpose — that is
       its whole design (see that file's header). With CI counted as a
       deployment, test 2 below fails it for the absence of a variable the job
       is never meant to have. That job is the only blocking check in the repo.

     * The Postgres job legitimately sets ALLOW_SUPERUSER_DB=1, because ~14
       suites need an owner connection for ALTER TABLE … DISABLE TRIGGER. With
       CI counted as a deployment, test 1 refuses that opt-out.

   Neither failure describes a real misconfiguration, and a guard that cries
   wolf on its own CI is a guard somebody deletes. The distinction that actually
   matters is DEPLOYED-AND-SERVING-TRAFFIC, not "ran on a machine that is not a
   laptop": a CI runner points at a throwaway container, and nothing a user
   touches is reachable from it.

   This does not weaken the gate. The Netlify build is where DATABASE_URL is the
   real one, and NETLIFY/CONTEXT/BUILD_ID are all set there. What CI checks
   instead is the role question directly — see the guard step in tests.yml. */
const DEPLOY_SIGNAL =
  ["NETLIFY", "CONTEXT", "BUILD_ID"].find((k) => process.env[k]) ??
  (process.env.NODE_ENV === "production" ? "NODE_ENV=production" : null);

const DEPLOYED = DEPLOY_SIGNAL !== null;
const DATABASE_URL = process.env.DATABASE_URL;
const OPT_OUT = process.env.ALLOW_SUPERUSER_DB === "1";

const RUNBOOK = "docs/runbooks/postgres-least-privilege.md";

function warn(lines) {
  const bar = "─".repeat(72);
  console.warn(`\n${bar}\n${lines.join("\n")}\n${bar}\n`);
}

after(async () => { await close().catch(() => {}); });

/* The privilege question, asked through role MEMBERSHIP rather than
   current_user's own catalog row. A role that is merely a member of a
   superuser role is a superuser in effect while its own rolsuper reads false,
   and that is a realistic way to reintroduce the problem by accident.

   MEMBER mode, not USAGE: USAGE asks whether the privileges are active right
   now, which is false for a NOINHERIT role that has not run SET ROLE yet.
   fundhub_app is created NOINHERIT, so a USAGE check would read clean on a
   role one SET ROLE away from superuser. MEMBER asks whether it can reach them
   at all. A role is always a MEMBER of itself, so its own flags stay covered.

   pg_read_all_data / pg_write_all_data are looked up by name and COALESCEd:
   they only exist on Postgres 14+, and a missing role must read as "no", not
   explode. Membership in either defeats the point of this exercise as
   thoroughly as rolsuper does. */
const PRIVILEGE_QUERY = `
  WITH reachable AS (
    SELECT r.* FROM pg_roles r WHERE pg_has_role(current_user, r.oid, 'MEMBER')
  )
  SELECT
    current_user::text                          AS role_name,
    current_database()::text                    AS db_name,
    current_setting('is_superuser')             AS is_superuser_setting,
    (SELECT count(*) FROM reachable WHERE rolsuper)       AS n_super,
    (SELECT count(*) FROM reachable WHERE rolbypassrls)   AS n_bypassrls,
    (SELECT count(*) FROM reachable WHERE rolcreaterole)  AS n_createrole,
    (SELECT count(*) FROM reachable WHERE rolcreatedb)    AS n_createdb,
    (SELECT count(*) FROM reachable WHERE rolreplication) AS n_replication,
    COALESCE((SELECT pg_has_role(current_user, oid, 'MEMBER')
                FROM pg_roles WHERE rolname = 'pg_read_all_data'),  false) AS read_all,
    COALESCE((SELECT pg_has_role(current_user, oid, 'MEMBER')
                FROM pg_roles WHERE rolname = 'pg_write_all_data'), false) AS write_all,
    has_schema_privilege(current_user, 'public', 'CREATE')  AS can_create_in_public
`;

/* ── 1. The opt-out cannot travel ──────────────────────────────────────────
   Checked before anything touches the database, because if this is set in a
   deployed environment then every other result in this file is untrustworthy
   regardless of what the database says. */
test("ALLOW_SUPERUSER_DB is refused outside a developer machine", () => {
  if (!DEPLOYED) return;
  assert.ok(
    !OPT_OUT,
    `ALLOW_SUPERUSER_DB is set in a deployed environment (detected via ${DEPLOY_SIGNAL}).\n` +
    `That variable exists only so a developer can run the test suite against an\n` +
    `owner connection on their own machine. It has no legitimate use here.\n` +
    `Remove it from the environment. See ${RUNBOOK}`
  );
});

/* ── 2. Silence is not consent ─────────────────────────────────────────────
   An unset DATABASE_URL in a deployed environment is the one failure mode most
   likely to be mistaken for success: nothing to check, so nothing fails.
   In this repo it has a specific and likely cause — a Netlify variable whose
   scope is "Functions" only is invisible to the build that runs this test. */
test("DATABASE_URL is present and checkable", () => {
  if (!DEPLOYED) {
    if (!DATABASE_URL) {
      warn([
        "SUPERUSER GUARD SKIPPED — DATABASE_URL is not set.",
        "",
        "This is allowed on a developer machine only. The guard runs for real in",
        "the Netlify build, where an unset DATABASE_URL fails the deploy."
      ]);
    }
    return;
  }
  assert.ok(
    DATABASE_URL,
    `DATABASE_URL is not set in a deployed environment (detected via ${DEPLOY_SIGNAL}).\n` +
    `The guard cannot verify what it cannot connect to, and an unverified\n` +
    `connection is treated as a failure, not as a pass.\n\n` +
    `Most likely cause: the Netlify variable's scope does not include Builds.\n` +
    `Set its scope to "All scopes" (or at least Builds + Functions).\n` +
    `See ${RUNBOOK}`
  );
});

/* ── 3. The guard itself ───────────────────────────────────────────────── */
test("the app's database role holds no superuser-level privilege", async (t) => {
  if (!DATABASE_URL) {
    // Test 2 already failed the run if this mattered.
    return t.skip("DATABASE_URL not set (developer machine)");
  }

  let row;
  try {
    row = (await pool().query(PRIVILEGE_QUERY)).rows[0];
  } catch (err) {
    /* Fail closed. A connection that cannot be inspected has not been shown to
       be safe, and "the database was briefly unreachable" and "the credentials
       are wrong" are indistinguishable from here. Re-running the deploy is
       cheap; shipping an unverified connection is not. */
    const detail = `Could not verify the database role: ${err.message}`;
    if (DEPLOYED) {
      assert.fail(
        `${detail}\n\n` +
        `Treating an unverifiable connection as a failure on purpose. If the\n` +
        `database was only briefly unreachable, retry the deploy. If this\n` +
        `persists, the connection string is wrong. See ${RUNBOOK}`
      );
    }
    warn(["SUPERUSER GUARD COULD NOT RUN.", "", detail]);
    return t.skip("database unreachable (developer machine)");
  }

  const n = (v) => Number(v ?? 0);
  const violations = [];

  if (n(row.n_super)) violations.push("SUPERUSER — bypasses every permission and every RLS policy");
  if (row.is_superuser_setting === "on") violations.push("the session reports is_superuser = on");
  if (n(row.n_bypassrls)) violations.push("BYPASSRLS — partner isolation in 045/046/047/049/050 does not apply to this role");
  if (n(row.n_createrole)) violations.push("CREATEROLE — can grant itself anything it lacks");
  if (n(row.n_createdb)) violations.push("CREATEDB");
  if (n(row.n_replication)) violations.push("REPLICATION — can stream the whole database out");
  if (row.read_all) violations.push("member of pg_read_all_data — reads every table regardless of grants");
  if (row.write_all) violations.push("member of pg_write_all_data — writes every table regardless of grants");
  if (row.can_create_in_public) violations.push("CREATE on schema public — the app creates no objects and must not be able to");

  /* Named separately from the flag checks. On Supabase the `postgres` role is
     NOT flagged rolsuper, so a flags-only check can read clean on it — but it
     does hold rolbypassrls and rolcreaterole, which the checks above catch.
     This last one is the plain-language net: if the app is connecting as
     `postgres`, something went wrong regardless of what the catalog says. */
  if (row.role_name === "postgres") {
    violations.push("connected as the `postgres` role — this is the admin identity, not the app's");
  }

  if (violations.length && !DEPLOYED && OPT_OUT) {
    warn([
      "SUPERUSER GUARD BYPASSED — ALLOW_SUPERUSER_DB=1.",
      "",
      `Connected as "${row.role_name}" on "${row.db_name}", which holds:`,
      ...violations.map((v) => `  • ${v}`),
      "",
      "This is expected when running the full test suite: ~14 suites use",
      "ALTER TABLE … DISABLE TRIGGER, which requires table ownership.",
      "",
      "It is NOT acceptable for a deployed connection, and the guard will fail",
      "the Netlify build if this role is ever used there."
    ]);
    return t.skip("ALLOW_SUPERUSER_DB=1 on a developer machine");
  }

  assert.deepStrictEqual(
    violations,
    [],
    `The app is connected to Postgres as a privileged role.\n\n` +
    `  role:     ${row.role_name}\n` +
    `  database: ${row.db_name}\n` +
    `  context:  ${DEPLOYED ? DEPLOY_SIGNAL : "developer machine"}\n\n` +
    `Problems found:\n` +
    violations.map((v) => `  • ${v}`).join("\n") +
    `\n\n` +
    `The app must connect as fundhub_app, created by db/migrations/104_app_role.sql.\n` +
    (DEPLOYED
      ? `Fix DATABASE_URL for this environment, then redeploy.`
      : `On your own machine, prefix the command with ALLOW_SUPERUSER_DB=1 to run\n` +
        `the suite against an owner connection.`) +
    `\nSee ${RUNBOOK}`
  );

  console.log(
    `✔ superuser guard: connected as "${row.role_name}" on "${row.db_name}" — ` +
    `no superuser, no bypassrls, no createrole/createdb/replication, no schema create.`
  );
});
