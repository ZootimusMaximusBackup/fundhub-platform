# T16 test baseline (measure before you blame yourself)

Measured by T16 before any T16 edit.

| Field | Value |
|---|---|
| Commit | `d3fb2c7` (origin/main, "Merge T0 — nav, reachability and page width (wave 0)") |
| Worktree | `/tmp/wt-T16` on branch `fix/T16-db-security` |
| Machine | owner's Mac (darwin 25.6.0), Node 22 |
| `DATABASE_URL` | **unset** — database tests skip |
| Command | `npm test` |
| Date | 2026-08-18 |

## Result

```
# tests   5640
# pass    5635
# fail    2
# skipped 3
```

## The 2 failures are pre-existing and are NOT T16's

1. `scripts/journeys/generate.test.mjs:146` — "*** no route's gate is left unverified ***"
   Two routes the journey generator cannot read the permission shape of:
   - `finance/crs-pull`
   - `gifts/message-blaster`
   Neither is a T16 file. `demo/simulate` is **not** in this list, and must not
   join it — so T16 must not change the gate shape in `api/demo/simulate.mjs`.

2. `an endpoint excused from the org filter still passes the session's org to its store`

## The 3 skips are the no-database skips

- `default org message_channel_routing is not left on the memory provider` — SKIP no DATABASE_URL
- `non-test orgs do not route any channel to memory` — SKIP no DATABASE_URL
- `the app's database role holds no superuser-level privilege` — SKIP DATABASE_URL not set

## Note on CLAUDE.md §12

§12 records "3730 passing, 0 failing" with `DATABASE_URL` unset. That number is
stale. On this branch, on this machine, today, it is **5640 tests / 5635 pass /
2 fail**. Diff against the numbers above, not against §12.
