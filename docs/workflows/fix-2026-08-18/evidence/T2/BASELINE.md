# T2 test baseline — measured, not assumed

**Where it ran:** `/tmp/wt-T2` (T2's own git worktree), branch `fix/T2-money-paylink-sign-unlock`
off `origin/main` at commit `d3fb2c7` ("Merge T0 — nav, reachability and page width (wave 0)").
**When:** 2026-08-18.
**Database:** live `DATABASE_URL` from local `.env` (loaded via `set -a; . ./.env; set +a`).
Only **3** tests skipped, so the database-backed tests really did run. This is NOT the
"442 skipped / 3730 passing" hollow baseline the repo warns about.

## Numbers before any T2 change

| | |
|---|---|
| tests | 5640 |
| pass | 5634 |
| **fail** | **3** |
| skipped | 3 |
| suites | 416 |

## The 3 pre-existing failures (present BEFORE T2 touched anything)

1. `the extraction is faithful to the code`
2. `an endpoint excused from the org filter still passes the session's org to its store`
   (nested: `*** no route's gate is left unverified ***`)
3. `DATABASE_URL is present and checkable`

None of these live in a file T2 owns. If they are still failing at the end of T2, that is the
baseline, not a regression. **Any 4th failure is mine and must be fixed.**

Raw output: `BASELINE-FULL.txt` in the worktree (not committed — it is 40k lines of test log).
