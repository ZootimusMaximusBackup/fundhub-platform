# Proof — Chris will appear on the Sales Floor closer board

Two halves. Both are now closed.

## Half 1 — the database (run by Chris, 2026-08-19)

`psql "$DATABASE_URL" -f add-owner-set-closer.sql` against production. Verbatim output:

```
BEGIN
UPDATE 1
INSERT 0 0
       name       |      email       | role  | status | can_sign_in
------------------+------------------+-------+--------+-------------
 Chris Stanbridge | chris@fundhub.ai | owner | active | t
(1 row)

        name        |       email       |  role  | status
--------------------+-------------------+--------+--------
 Chris Stanbridge   | chris@fundhub.ai  | owner  | active
 TEST — Closer Role | closer@fundhub.ai | closer | active
(2 rows)

COMMIT
```

Reading it:

* `UPDATE 1` / `INSERT 0 0` — the row **already existed**. Nothing was created; it was set active
  and given the display name the code matches on.
* `can_sign_in | t` — the row already carries a credential. **This corrects an earlier note in
  BOARD.md that said the row could not sign in.** It can. So signing in as `chris@fundhub.ai`
  reaches this row, which means the People list shows it and `staff-teams.html` paints a Clock
  in/out button on it (`p.self` is matched on session email or id).
* The second table is `closerRoster()`'s exact SQL predicate from this branch. It returns 2 rows.

## Half 2 — the browser-side filter (run 2026-08-19 on this branch)

`filterCloserRoster()` applied to those exact two rows:

```
sql_returned : ["Chris Stanbridge", "TEST — Closer Role"]
board_shows  : ["Chris Stanbridge"]
dropped      : ["TEST — Closer Role"]
```

The seeded test login is dropped by `isBlockedCloserIdentity` (`/^test\b/i`), which is correct —
a seeded login does not belong on a live board. Chris survives via `isOwnerSetCloser()`.

## Conclusion

**One closer on the board: Chris Stanbridge.** Before this branch the same two rows produced an
empty board, because `belongsOnCloserBoard()` returned false for role `owner` and the roster SQL
only matched role `closer`.

## Still true, and not a defect

The "N CLOSERS ON SHIFT" chip counts **open shifts**, not roster size. It reads 0 until somebody
clocks in. Owner-set 2026-08-19: correct as built.
