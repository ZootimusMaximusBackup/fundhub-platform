# T10 — measured test baseline

CLAUDE.md §12 says the recorded failure counts have never been stable and that you
must measure your own and record where you ran it. This is that measurement.

## Where

- Commit: `c860b8c` (origin/main), worktree `/tmp/wt-T10`, branch `fix/T10-affiliate-partner`
- Machine: owner's Mac (darwin), local Postgres on socket `/tmp:5432`
- Database: scratch `fundhub_t10_base`, created for this thread only.
  NOT `fundhub_ci`. NOT production. 167 migrations applied, 201 tables.
- Date: 2026-08-19

## Full suite — `npm test` with DATABASE_URL set

| | |
|---|---|
| tests | 5845 |
| pass | 5842 |
| **fail** | **3** |
| skipped | 0 |
| duration | 36.5s |

Note: 0 skipped. CLAUDE.md §12 describes a 442-skip / "3730 passing, 0 failing" state
that occurs when DATABASE_URL is UNSET. That is not this run — the pg tests ran.

### The 3 pre-existing failures, by name

1. `the extraction is faithful to the code`
2. `an endpoint excused from the org filter still passes the session's org to its store`
3. `the app's database role holds no superuser-level privilege`

Any post-change comparison is made against **these three by name**, never against a
total. A count alone lets a new break hide behind an old one.

Failure 3 is not a defect in the code under test: it fires because this baseline
connects as a Postgres superuser, which is what it exists to detect.

## Isolation subset — as the unprivileged `fundhub_app` role

Run exactly as `.github/workflows/tests.yml` step "Partner isolation, as the
unprivileged app role" runs it. Role confirmed `rolsuper=f, rolbypassrls=f`.

Result: **RED — 4 of 6 suites fail, and NOT for a security reason.**

Every failure is Postgres error `42501`, e.g. `must be owner of table action_log`,
`must be owner of table compliance_screenings`. They occur in the tests' own
`cleanup` hooks, which `TRUNCATE`. TRUNCATE requires table ownership, which the
unprivileged role deliberately does not have. The suites abort in cleanup before
reaching their isolation assertions — total runtime 145ms for 93 tests, versus 36s
for the full suite, which is the tell.

**So this step cannot currently answer the question it was built to answer.**
`.github/workflows/tests.yml:327` says: "If it is RED, the remaining failures are NOT
superuser-related and need reading on their own terms." Read: the blocker is that the
test cleanup path requires ownership the runtime role is designed to lack.

This is PRE-EXISTING and outside T10's file ownership. Recorded, not fixed.
It means row-level security enforcement remains **unmeasured** on this branch —
the same open question CLAUDE.md §12 flags as never having been measured.

## Consequence for T10

Unit A creates a new table (`affiliate_link_clicks`) carrying row-level security.
Because the shared isolation harness cannot run as the unprivileged role, that
table's policy must be proven by its own targeted test, not by the shared suite.

## Raw logs

- `baseline-full-suite.log.gz`
- `baseline-isolation-app-role.log.gz`
