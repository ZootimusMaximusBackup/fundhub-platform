# T3 test baseline — measured, not quoted

**Where it ran:** worktree `/tmp/wt-T3` at `c860b8c` (origin/main, "Merge T7 — bookings, calendar &
inbound webhooks (wave 1)"), against my OWN scratch Postgres — `fundhub_t3` on local Postgres
`localhost:5432`, connected as the local superuser role. **Not** `fundhub_ci`, **not** production.
Measured 2026-08-18. Command: `DATABASE_URL=postgres://<me>@localhost:5432/fundhub_t3 npm test`.

```
# tests   5845
# pass    5842
# fail    3
# skipped 0
```

**CORRECTION — I got this wrong the first time, and it matters.** I originally wrote that
`skipped 0` proved this run exercised the 442 `.pg.test.mjs` tests. It does not. `npm test` runs a
unit phase and then a database phase, and `scripts/run-suite.mjs:69` (`if (code !== 0)
process.exit(code)`) **exits as soon as the unit phase has any failure**. Because `main` already
carries three unit failures, `npm test` has never reached the database phase on this tree at all.
`skipped 0` means those tests never started, not that they ran and passed.

So the database tests had to be run by hand, 109 files at `--test-concurrency=1`, against both a
dirty tree and a pristine `git archive HEAD` copy on the same scratch database:

```
pristine : 1648 tests  1521 pass  60 fail  67 cancelled
with T3  : 1649 tests  1523 pass  59 fail  67 cancelled
```

Compared failure-by-failure rather than by count, at both the suite and subtest level:
**zero failures appear on the T3 tree that do not also appear on pristine.** The extra test is T3's
own new one and it passes. The 59–60 baseline failures and 67 cancellations are pre-existing and are
dominated by cross-file pollution of a shared test database.

## The 3 pre-existing failures — none of them mine, none of them caused by this branch

| # | Test | File | Why it fails |
|---|---|---|---|
| 1 | the extraction is faithful to the code | `scripts/journeys/generate.test.mjs:96` | journey generator drift already on `main` |
| 2 | an endpoint excused from the org filter still passes the session's org to its store | `src/http/read-endpoints-org-scope.test.mjs:184` | drifted endpoint is `company-brain-affiliate.mjs` — **T9's file**, not T3's |
| 3 | the app's database role holds no superuser-level privilege | `src/security/superuser-guard.test.mjs:185` | expected here: I connected as the Postgres superuser, which is exactly the §12 trap. CI runs this as the unprivileged `fundhub_app` role |

**The merge bar for T3 is "no worse than these three."** Any fourth failure is mine.
