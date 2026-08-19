// MIGRATIONS RUN ON THE PRODUCTION DEPLOY ONLY. Owner rule, set 2026-08-19.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHAT THIS PREVENTS
//
// There is one database behind every Netlify context. Netlify hands
// MIGRATION_DATABASE_URL to deploy previews and branch deploys exactly as it
// does to production, and until 2026-08-19 netlify.toml ran db/migrate.mjs in
// all of them. The consequence: merely OPENING a pull request reshaped the
// LIVE database, before any human read the diff.
//
// That is not a theory. PR #86's three migrations were applied to production at
// 03:20 on 2026-08-19 by the pull request's own preview build — twenty minutes
// before it was merged at 03:42. Those three only added row policies and
// indexes, so nothing was lost. A dropped column, a rewritten table, or a
// mistaken lock would have gone live on the same schedule, with nobody
// expecting it and no obvious place to look afterwards.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY A TEST AND NOT JUST THE CONFIG CHANGE
//
// The fix is two lines in netlify.toml, and two lines in netlify.toml are
// exactly the kind of thing that gets "tidied" a year from now by someone who
// does not know what they protect. The rule survives only if breaking it is
// loud. So this file pins both halves: the shape of netlify.toml, and the
// runner's own refusal.
//
// If a deploy genuinely needs migrating from another context, that is a
// decision for the owner. Change it here, on purpose, with this comment read —
// not by editing netlify.toml until the build goes green.

import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..", "..");
const TOML = fs.readFileSync(path.join(ROOT, "netlify.toml"), "utf8");

// Minimal section reader. No TOML dependency is added for this (CLAUDE.md §8);
// we only need "which section is this `command =` line in", and comments are
// stripped so the prose above each command cannot be mistaken for the command.
function commandsBySection(toml) {
  const out = {};
  let section = "(root)";
  for (const raw of toml.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("#")) continue;
    const header = line.match(/^\[([^\]]+)\]/);
    if (header) { section = header[1]; continue; }
    const cmd = line.match(/^command\s*=\s*"(.*)"\s*$/);
    if (cmd) out[section] = cmd[1];
  }
  return out;
}

const COMMANDS = commandsBySection(TOML);
const migrates = (cmd) => /db\/migrate\.mjs/.test(cmd || "");

describe("migrations run on the production deploy only — netlify.toml", () => {
  test("the DEFAULT build command does not migrate", () => {
    assert.ok(COMMANDS.build, "netlify.toml has no [build] command at all");
    assert.equal(
      migrates(COMMANDS.build), false,
      "[build] command runs db/migrate.mjs. That is the command every context " +
      "WITHOUT its own block inherits — deploy previews, branch deploys, and any " +
      "context Netlify adds later. With it here, opening a pull request rewrites " +
      "the live database before anyone reviews it. Put the migrating command " +
      "under [context.production] instead.\n  found: " + COMMANDS.build
    );
  });

  test("production is the one context that migrates", () => {
    assert.ok(
      COMMANDS["context.production"],
      "no [context.production] command — with the default no longer migrating, " +
      "nothing would ever apply a migration and every deploy would ship against " +
      "an out-of-date database"
    );
    assert.ok(
      migrates(COMMANDS["context.production"]),
      "[context.production] must run db/migrate.mjs — it is now the only place " +
      "migrations are applied.\n  found: " + COMMANDS["context.production"]
    );
  });

  test("no other context migrates", () => {
    const offenders = Object.entries(COMMANDS)
      .filter(([name, cmd]) => name !== "context.production" && migrates(cmd))
      .map(([name]) => name);
    assert.deepEqual(
      offenders, [],
      "these contexts run db/migrate.mjs against the shared live database. " +
      "Only [context.production] may."
    );
  });

  test("the privilege guard still runs everywhere", () => {
    // guard:db reads nothing and writes nothing — it refuses the deploy if the
    // connection is a superuser or can bypass row locks. Worth asking in every
    // context, and dropping it here would be a silent downgrade.
    for (const [name, cmd] of Object.entries(COMMANDS)) {
      assert.match(
        cmd, /guard:db/,
        `the ${name} command no longer runs \`npm run guard:db\`. That check is ` +
        `read-only and belongs in every context.\n  found: ${cmd}`
      );
    }
  });
});

describe("migrations run on the production deploy only — the runner itself", () => {
  // The child env is scrubbed of both connection strings on purpose: these
  // tests must never be able to reach a database, whatever the machine running
  // them has set. A "DATABASE_URL not set" failure is the proof we want — it
  // means the runner got PAST the context guard and tried to work.
  const run = (env) => spawnSync(process.execPath, [path.join(ROOT, "db", "migrate.mjs")], {
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: "", MIGRATION_DATABASE_URL: "", ...env }
  });

  for (const context of ["deploy-preview", "branch-deploy", "dev"]) {
    test(`a ${context} build skips migrations and does not fail`, () => {
      const r = run({ NETLIFY: "true", CONTEXT: context });
      assert.equal(
        r.status, 0,
        `a ${context} build must exit 0 — skipping is the intended outcome there, ` +
        `not an error, and it must not red the build.\n${r.stdout}${r.stderr}`
      );
      assert.match(
        r.stdout, /skipping migrations/,
        `a ${context} build must say out loud that it skipped, so nobody hunts ` +
        `for a migration that never ran.\n${r.stdout}${r.stderr}`
      );
    });
  }

  test("a Netlify build with no context set skips too — fail closed", () => {
    const r = run({ NETLIFY: "true", CONTEXT: "" });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /skipping migrations/,
      "an unrecognised Netlify context must skip, not migrate. Anything that is " +
      "not provably production is treated as not production.");
  });

  test("a production build is NOT skipped", () => {
    const r = run({ NETLIFY: "true", CONTEXT: "production" });
    assert.doesNotMatch(
      r.stdout, /skipping migrations/,
      "production must still migrate — this is the only context that does"
    );
    // It gets as far as needing a connection, which is exactly how we know the
    // guard let it through without this test ever touching a database.
    assert.match(
      r.stderr + r.stdout, /DATABASE_URL not set/,
      "expected the runner to proceed and then stop for want of a connection"
    );
  });

  test("running it by hand, off Netlify, is unaffected", () => {
    // A laptop, CI, or the command in CLAUDE.md §11. CONTEXT is unset there and
    // this rule deliberately does not apply.
    const r = run({});
    assert.doesNotMatch(
      r.stdout, /skipping migrations/,
      "the rule must only bite inside a Netlify build — a developer running " +
      "migrations against their own scratch database is none of its business"
    );
    assert.match(r.stderr + r.stdout, /DATABASE_URL not set/);
  });
});
