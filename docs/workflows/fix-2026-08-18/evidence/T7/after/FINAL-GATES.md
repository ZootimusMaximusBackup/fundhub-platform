# T7 — final gates, measured after every fix

Machine: Zootimuss-MacBook-Pro.local (Darwin 25.6.0 arm64), node v22.21.1.
Worktree `/tmp/wt-T7`, branch `fix/T7-bookings-calendar-webhooks`, base `d3fb2c7`.
Postgres tests ran against a **local throwaway database**, never production.

| Gate | Baseline `d3fb2c7` | After T7 | Verdict |
|---|---|---|---|
| `npm run lint` | clean, 1295 files | clean, 1300 files | PASS |
| `npx tsc --noEmit` | **cannot run — no `tsconfig.json` in this repo** | same | pre-existing, unrunnable as CLAUDE.md §6 writes it |
| `npm test` (no DB) | 5640 tests / 5635 pass / **2 fail** / 3 skip | 5665 / 5660 / **2 fail** / 3 skip | PASS — +25 tests, same 2 failures |
| `npx playwright test e2e/calendar.spec.mjs` | **9 failed / 2 passed** | **17 passed / 0 failed** | PASS |
| T7 pg tests + neighbours (scratch DB) | n/a | 82 pass / 0 fail | PASS |

The 2 remaining failures are the pre-existing ones and are outside T7's area:
- `scripts/journeys/generate.test.mjs` — "the extraction is faithful to the code"
  (`finance/crs-pull`, `gifts/message-blaster` gates the extractor cannot trace).
- `src/http/read-endpoints-org-scope.test.mjs` — `company-brain-affiliate.mjs`.

Two failures T7 *did* introduce were found and cleared before commit:
a stale `db/expected-migrations.mjs` (which would have blinded the live health
check to a missing migration) and stale `docs/journeys/*-actual.md`.

**The pg phase count is not stable on this machine.** Two back-to-back runs of the
same code gave 1535 pass / 51 fail and 1486 pass / 50 fail; the `d3fb2c7` baseline
gave 1457 / 50. The seven candidate regressions were each re-run in isolation on
both trees and all passed — shared-database cross-file contamination, which
`scripts/run-suite.mjs` documents in its own header. Do not quote a single number.
The connection role is also a Postgres superuser locally, so every row-level
security test is meaningless in this environment (CLAUDE.md §12).

## Re-measured after rebasing onto `main` (T16 and T6 landed underneath)

Base is now `b7f5c11`. Three further migrations applied to the throwaway database.

| Gate | Result |
|---|---|
| `npm run lint` | clean, 1304 files |
| `npm test` (no DB) | **5701 tests / 5696 pass / 2 fail / 3 skip** — the same two pre-existing failures |
| T7 pg tests + neighbours | **62 pass / 0 fail** |
| `npx playwright test e2e/calendar.spec.mjs` | **17 passed** |

`docs/journeys` regenerated after the rebase produced **no diff** — T16's and T6's
routes were already in the merged tree's generated pages.
