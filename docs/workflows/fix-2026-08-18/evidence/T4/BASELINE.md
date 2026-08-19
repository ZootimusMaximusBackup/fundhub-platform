# T4 test baseline — measured, not assumed

Measured by T4 on 2026-08-18 in worktree `/tmp/wt-T4`, branch `fix/T4-inquiry-repair`,
at `c860b8c` (origin/main, includes the T7 wave-1 merge).

## Where it ran

- **Machine:** this Mac (darwin 25.6.0, aarch64).
- **Database:** a **scratch** PostgreSQL 16.14 cluster created for this thread only —
  `initdb` at `/tmp/wt-T4-pg`, port `55444`, database `fundhub_t4`, 167 migrations applied
  by `db/migrate.mjs`. **Not** production. **Not** `fundhub_ci`.
- Started with `LC_ALL=C` (Postgres 16.14 on this OS aborts with
  "postmaster became multithreaded during startup" without it).

## Run 1 — `DATABASE_URL` unset

```
# tests 5843
# pass  5838
# fail  2
# skipped 3
```

## The 2 pre-existing failures (present at HEAD, before any T4 edit)

| test | file | T4's? |
|---|---|---|
| `the extraction is faithful to the code` | `scripts/journeys/generate.test.mjs:96` | **no** |
| `an endpoint excused from the org filter still passes the session's org to its store` | `src/http/read-endpoints-org-scope.test.mjs:184` | **no** |

Neither file is owned by T4. Neither is touched by T4.

**Note for §6:** the first failure is in the journey generator's own test. T4 is required to run
`npm run journeys`. That generator is already failing its faithfulness test at HEAD — T4 did not
cause it and cannot fix it (the file is not T4's). Recorded here so a reviewer does not read it
as T4 breakage.

## Drift guard — verified intact before editing

`node --test src/http/inquiry-remover-view.test.mjs` → **80 pass, 0 fail**.
This is the character-for-character drift test between `public/app/inquiry-remover.html`
and `src/http/inquiry-remover-view.mjs`. It must still read 80/0 after T4's edits.

## Run 2 — against the scratch database

(see BASELINE-PG.md — recorded separately once the run finished)

## Run 2 — against the scratch database (recorded after the work)

**The runner hides half the suite.** `scripts/run-suite.mjs:69` does
`if (code !== 0) process.exit(code)` after the plain tests and before the database tests.
Three plain tests already fail on `main`, so `npm test` never reaches the 111
`*.pg.test.mjs` files — not in this baseline, and not in anyone else's on this branch.

### Plain half — `npm test`

| | before T4 | after T4 |
|---|---|---|
| pass | 5842 | 5842 |
| fail | **3** | **3** |

Same three, unchanged: `the extraction is faithful to the code`,
`an endpoint excused from the org filter…`, `the app's database role holds no
superuser-level privilege`. None is in a file T4 touches.

(The `extraction is faithful` failure names two untraceable route gates — `finance/crs-pull`
and `gifts/message-blaster`. Both pre-date this work and T7 recorded the same pair. T4's new
route traced correctly.)

### Database half — controlled comparison

`npm test` never reaches these, so they were run directly. **Like-for-like:** the identical
command on both sides, each against its own freshly-migrated scratch database.

```
node --test --test-concurrency=1 $(find src -name '*.pg.test.mjs' | sort)
```

| | `origin/main` (control) | `fix/T4-inquiry-repair` |
|---|---|---|
| tests | 1615 | 1628 (**+13** — exactly T4's 13 new tests) |
| pass | 1558 | 1571 (**+13**) |
| **fail** | **50** | **50** |
| cancelled | 7 | 7 |

**Identical failure count.** T4's 13 new tests all pass and nothing else moved.

### This batch is genuinely flaky — proven, not assumed

The two failure *name* lists differed by a single one-for-one swap, so the control was run a
**second time on the same unmodified code and the same database**:

| control run | failing suites |
|---|---|
| 1 | 24 |
| 2 | **29** |

Same code, same database, five different names. Among the five that appeared only in run 2 is
`updated_at triggers fire on the new tables` — **the one name that had shown up on T4's branch
and not in control run 1.** So it fails on unmodified `main` too.

Confirmed a third way: run on its own against `origin/main`, `src/auth/auth.pg.test.mjs`
**passes**. It is an ordering artifact between suites, not a defect and not T4's.

**Conclusion: T4 adds no test failures in either half.** That rests on three independent
checks — an equal failure count against a matched control, the flakiness of the one differing
name demonstrated on unmodified code, and the fact that **no failing suite imports any of the
ten files T4 changed**.

Every file T4 changed, for the record:
`api/inquiry-cases.mjs` · `api/repair/generate.mjs` · `netlify/functions/api.mjs` ·
`public/app/inquiry-remover.html` · `src/http/calendar-paint.test.mjs` ·
`src/http/inquiry-cases.pg.test.mjs` · `src/http/repair-generate.pg.test.mjs` ·
`src/inquiries/work.mjs` · `src/inquiries/work.pg.test.mjs` · `src/repair/analyze.mjs`

### Do not quote a single number from this batch

Anyone diffing it must run their own control on the same machine, ideally twice. A count taken
once proves nothing here.

### `npx tsc --noEmit`

There is no `tsconfig.json` in this repository — it is plain JavaScript. The command prints
its version and exits 0. Recorded as a no-op rather than claimed as a passing typecheck.
