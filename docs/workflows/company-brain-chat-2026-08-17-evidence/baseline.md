# Test baseline BEFORE this batch

Measured so integration can tell a real break from a failure that was already there
(CLAUDE.md §12 — record WHERE it ran, the environment moves the count).

- **Commit:** 7be91a0 (clean, detached git worktree — not the working tree)
- **Where:** this Mac, darwin 25.6.0, `node --test` via `npm test`
- **DATABASE_URL:** unset, so every `.pg.test.mjs` skipped. This number proves nothing
  about anything that needs a database.
- **When:** 2026-08-17

```
# tests 5552
# pass  5546
# fail  3
# skipped 3
```

The 3 failures are PRE-EXISTING at HEAD. None were caused by this batch:

1. `the extraction is faithful to the code`
2. `the expected list is exactly what db/ holds — it cannot drift silently`
3. `an endpoint excused from the org filter still passes the session's org to its store`

Note #2 asserts that a hand-kept list matches what `db/` actually holds. This batch adds
three migrations, so that test may need its list updated — check whether it is the same
failure or a new one before assuming.
