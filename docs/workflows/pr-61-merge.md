# PR #61 → main — merge and reconciliation board

Batch: 2026-08-01. Branch `claude/pr-61-merge-conflicts-mk5siy`.

Chris asked for PR #61 (the unprivileged Postgres role) to be merged to `main`
after tonight's integration left it conflicted. He approved doing it in one
session rather than fanning out, so the "owner" column is one session.

The rollout itself was already finished before this branch existed: the
migration is applied to production, `fundhub_app` has a password, Netlify's
`DATABASE_URL` and `MIGRATION_DATABASE_URL` are set, and the guard passes
against the new role. **Nothing here changes production.** This is the code
catching up with a change that has already happened.

## Task list

| # | Owner | Task | Status |
|---|---|---|---|
| W0 | (assistant, this session) | Merge `pr61` into the branch; resolve `package.json` | done |
| W1 | (assistant, this session) | Migration number collision: `090` → `104` | done |
| W2 | (assistant, this session) | Reconcile the two superuser guards | done |
| W3 | (assistant, this session) | CI: the `continue-on-error` question | **partial — see blocker** |
| W4 | (assistant, this session) | Runbook, `CLAUDE.md` §12, journeys, this board | done |

## What the merge actually collided with

Only `package.json` conflicted in git's eyes. The real reconciliation was in
three places git could not see, because `main` had independently grown its own
answer to the same problem while PR #61 sat open.

### 1. Two migrations numbered 090

PR #61 added `db/migrations/090_app_role.sql`. `main` had independently added
`db/migrations/090_soft_pull_one_open_per_client.sql`, and had moved on to 103.

Renamed to **`104_app_role.sql`**. Two reasons it had to move, not stay:

* `migrate.mjs` applies files in filename order. Left at 090, the role
  migration would run *before* migrations 091–103 on any database built from
  scratch — and section D of that file (`ALTER DEFAULT PRIVILEGES`) plus its
  `GRANT … ON ALL TABLES` only cover tables that exist when it runs. At 104 it
  runs last, after every table it needs to grant on.
* Two files sharing a number is a trap for whoever adds 105.

**Does renaming re-run it on production?** Yes. `schema_migrations` is keyed
`<dir>/<file>`, so production holds `migrations/090_app_role.sql` and will not
recognise `migrations/104_app_role.sql`. It will apply it again on the next
`node db/migrate.mjs`.

**That is safe, and it was checked rather than assumed.** The file has an
explicit re-run branch: when the role already exists it runs `ALTER ROLE` naming
only `NOSUPERUSER / NOCREATEDB / NOCREATEROLE / NOBYPASSRLS / NOREPLICATION`,
and **deliberately does not name LOGIN or PASSWORD** — `ALTER ROLE` only changes
attributes it names, so the password Chris set survives. Its own header calls
this out as the trap it was written to avoid. The grants are `GRANT`s (idempotent),
the `REVOKE CREATE … FROM PUBLIC` is idempotent, and section E re-verifies and
rolls the whole thing back if the role is dirty. Re-running it is a no-op that
re-asserts the security properties — which is the good kind of no-op.

No manual SQL is needed on production. Nothing to do.

### 2. Two superuser guards

| | |
|---|---|
| `src/security/superuser-guard.test.mjs` | from PR #61 |
| `src/compliance/rls-bypass.pg.test.mjs` | from `main`'s integration branch |

They overlap on one assertion — "is this role a superuser / does it hold
BYPASSRLS" — and the PR #61 version is strictly stronger on it: it asks through
role *membership* rather than `current_user`'s own catalog row, also covers
`pg_read_all_data`, `pg_write_all_data` and CREATE-on-public, gates the Netlify
build, and refuses to skip itself in a deployed context.

But `rls-bypass` has a second check the guard never had: **every partner-scoped
table has row security ENABLED and FORCED**. That is the schema half of the same
arrangement and is not duplicated anywhere.

Resolution: the role check was **removed from `rls-bypass`, not duplicated** —
one cause should not fail two files with the thinner message read first. The
schema check stays there. Both file headers now explain the split.

### 3. The guard would have broken `main`'s CI

`main` added `.github/workflows/tests.yml` *after* PR #61 branched. PR #61's
guard treats `CI` and `GITHUB_ACTIONS` as deployment signals — reasonable when
it was written, because there was no `.github/` at all.

Merged as-is, that turns **both** CI jobs red:

* the blocking job runs with no `DATABASE_URL` by design, and the guard would
  fail it for the absence of a variable it is never meant to have
* the Postgres job legitimately sets `ALLOW_SUPERUSER_DB=1`, which the guard
  refuses in a "deployed" context

`CI` and `GITHUB_ACTIONS` were dropped from the deployment signals, with the
reasoning written into the file. This does **not** weaken the gate: Netlify sets
`NETLIFY`/`CONTEXT`/`BUILD_ID`, and Netlify is the only place `DATABASE_URL` is
the real one. Verified all three cases by hand — see the manifest.

## Blocker — W3, and it is deliberate

`.github/workflows/tests.yml` carried a standing instruction: *"WHEN THE
SUPERUSER FIX LANDS, DELETE `continue-on-error` FROM THAT JOB."* The fix has
landed. **The line was not deleted.**

Reason: the claim "the isolation tests go green once the suite connects as
`fundhub_app`" is *reasoned, not measured*. No Postgres could be started in this
environment — `su` and `useradd` are both denied by the sandbox, and there is no
unprivileged account to run `initdb` as. Two attempts, then stopped per §8.

Deleting the line on an unverified claim would repeat exactly the failure the
file was written to complain about: asserting a green nobody watched.

What was done instead — the job now performs the switch and **reports** it:

* `MIGRATION_DATABASE_URL` set, so migrations run as the owner
* `fundhub_app` given a throwaway CI-only login
* a new step runs the guard **as `fundhub_app`**
* a new step runs the five isolation suites **as `fundhub_app`**

**The first CI run after this merge is the measurement.** If that step is green,
delete `continue-on-error` — one run is enough. If it is red, the remaining
failures are not superuser-related and need reading on their own terms.

## Change manifest

| File | What |
|---|---|
| `package.json` | conflict resolved — union of `main`'s `lint`/`migrations:manifest`/`journeys*` and PR #61's `guard:db` |
| `db/migrations/090_app_role.sql` → `104_app_role.sql` | renamed; self-references updated |
| `db/expected-migrations.mjs` | regenerated — 81 migrations, `104_app_role.sql` last |
| `db/migrate.mjs` | comment reference 090 → 104 (behaviour unchanged) |
| `src/security/superuser-guard.test.mjs` | `CI`/`GITHUB_ACTIONS` dropped from deploy signals; 090 → 104 |
| `src/compliance/rls-bypass.pg.test.mjs` | duplicate role check removed; schema ENABLE+FORCE check kept; header rewritten |
| `netlify.toml` | comment no longer claims there is no CI; guard command unchanged |
| `.github/workflows/tests.yml` | lint step added; app-role setup + two `fundhub_app` steps added; counts corrected; `continue-on-error` kept with new instructions |
| `CLAUDE.md` | §12 trap rewritten — three conflicting failure counts recorded honestly, none asserted |
| `docs/runbooks/postgres-least-privilege.md` | "already done" banner; branch checkout → `main` |
| `docs/workflows/db-least-privilege.md` | 090 → 104 |

**Exports added:** none. **Props changed:** none. **Routes affected:** none.
**Journeys impacted:** none — `npm run journeys:check` and `npm run diagrams:check`
both report up to date. A connection-role change alters no user-facing flow, so
there is no `-actual.md` edit and no `docs/journeys/CHANGELOG.md` entry.

## Verified

* `npm run lint` — 644 files parse clean
* `npm test` (no `DATABASE_URL`) — **3730 pass, 0 fail, 442 skipped**
* `npm run guard:db` on a laptop → passes (skips live check)
* `npm run guard:db` with `CI=true GITHUB_ACTIONS=true`, no DB → **passes** (the fix)
* `npm run guard:db` with `NETLIFY=true`, no DB → **fails** (gate still real)
* `npm run migrations:manifest` — clean, no drift
* `npm run journeys:check`, `npm run diagrams:check` — up to date
* `.github/workflows/tests.yml` parses as valid YAML; all five referenced test files exist

## Not verified

* Anything requiring a live Postgres. No database could be started here.
* `npx tsc --noEmit` exits 0 but only because there is no TypeScript and no
  `tsconfig.json` — it prints its help text. That gate is vacuous in this repo,
  as `.github/workflows/tests.yml` already documents.
