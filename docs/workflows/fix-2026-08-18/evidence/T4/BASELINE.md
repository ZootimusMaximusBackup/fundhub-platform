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
