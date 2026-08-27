# Database suite to zero — live board

**Status: 67 → 30 failures.** Started 2026-08-27 after PR #238 re-enabled the suite.

## Why this board exists

`scripts/run-suite.mjs` exits on the first unit failure **before** the database
phase starts. 16 unit tests were red from ~2026-08-21, so all 1,861
`*.pg.test.mjs` tests did not run for six days — in CI or locally. PR #238 turned
them back on. This board tracks driving the result to zero.

## How to measure (do not skip this)

Numbers from any other setup are not comparable.

```
createdb fh_tmpl
DATABASE_URL=postgres://<you>@localhost/fh_tmpl \
MIGRATION_DATABASE_URL=postgres://<you>@localhost/fh_tmpl \
ALLOW_SUPERUSER_DB=1 node db/migrate.mjs
psql -d fh_tmpl -c "ALTER ROLE fundhub_app LOGIN PASSWORD '<local>';"

# per file, on a byte-identical clean clone
createdb -T fh_tmpl fh_x
DATABASE_URL=postgres://<you>@localhost/fh_x \
MIGRATION_DATABASE_URL=postgres://<you>@localhost/fh_x \
APP_DATABASE_URL=postgres://fundhub_app:<local>@localhost/fh_x \
ALLOW_SUPERUSER_DB=1 node --test <file>
```

**Traps that cost hours today:**

* **`ℹ fail` lies.** A suite that errors during setup prints `fail 0` while
  marking every test ✖. Score by **exit code**, never that counter.
* **Two identities, both required.** The suite runs as the **owner** because ~14
  files need `ALTER TABLE … DISABLE TRIGGER`. Isolation files must assert through
  the unprivileged role or a superuser bypasses RLS and they false-fail. That is
  what `src/testing/rls-pool.mjs` is for.
* **`ℹ skipped 0` is the unit phase only.** It does not mean the pg tests ran.
  Look for a **second** `ℹ tests` block.

## Two REAL bugs found so far (both shipped)

| | |
|---|---|
| **#240** | `call_outcomes.transcript` never existed. `meet-transcript-sweeper` (cron `*/10`) failed on every Meet transcript since 2026-08-26; none were ever saved, and the unrecorded-calls report read every logged call as untranscribed. |
| **#245** | `Needs Pull` tile silently dropped every client with no `round_hold_reason`. `TRIM(NULL) = 'Fraud Alert'` is NULL → `NOT NULL` is NULL → `COUNT(*) FILTER` skips the row. Both `needs_pull` and `needs_consent` read 0. |

Everything else so far has been **stale description, not broken code** — a count
that moved, a signature that tightened, a wipe that predates the row it must clear.

## Done

`launch-proof-chain` · `card-stacking-rounds` · `lifecycle` · `inquiries-write` ·
`inquiry-ops/send` · `finance-entities` · `finance-command` · `telemetry-wiring` ·
`creative-endpoints` (18→1) · `invariants` (2→1) · `generate` (3→1) · `social` (1→0) ·
`repair-generate` (5→0) · `read-signals` (4→0)

## Remaining — 14 files, ~20 failures run individually

| file | fails | first signal |
|---|---|---|
| `cutover-acceptance` | 3 | `THE SAME MESSAGE WAS SENT 0 TIMES BY RACING DISPATCHERS` |
| `economics` | 2 | a raw `error:` during the run |
| `hiring-endpoints` | 2 | no message surfaced yet |
| `social-channels` | 2 | `cha…` assertion |
| `call-scheduler` | 2 | a raw `error:` during the run |
| `recurring` | 1 | `The i…` assertion |
| `invariants` | 1 | `bra…` assertion |
| `generate` | 1 | `a …` assertion |
| `company-activity` | 1 | `fixture: demo cash today should exist after seed` |
| `creative-endpoints` | 1 | `spe…` (spend) assertion |
| `dispatch` | 1 | deep-equal mismatch |
| `store` | 1 | `a …` assertion |
| `e2e-verification` | 1 | scratch-guard refusal |
| `invoice-workflows` | 1 | `letters were…` |

The suite reports **30** while these total ~20, so roughly ten are
**order-dependent** — they pass alone and fail after other files have written to
the same database. Test isolation is the structural half of this job and is not
started.

## Not done, deliberately

* `continue-on-error: true` still on the Postgres CI job. The workflow says to
  delete it once the isolation step is observed green. That step **cannot pass as
  written** — it runs whole files as `fundhub_app`, and their fixtures need
  ownership (`must be owner of table action_log`). Fixing the step is its own task.
* Branch protection requires only the unit suite. Adding the pg job would block
  every merge until this reaches zero.
