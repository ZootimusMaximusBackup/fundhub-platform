# f4 — dashboard money units (funded + cash)

Batch: fulfillment-fixes-2026-08-29
Agent: agent-f4
Branch: `fix/dashboard-kpis-money-units` (off `main` @ `4f551ff1`)
Commit: `78701ea2`
Status: **done**

> Note: the board named in the task brief, `docs/workflows/fulfillment-fixes-2026-08-29.md`,
> does not exist in this worktree at `4f551ff1`. Nothing to claim or read. Recording the
> manifest here instead. Not invented — reporting the absence.

## The real column type

`funding_rounds.funded_amount` is **`numeric(14,2)` — DOLLARS**, not cents.

Evidence, in order of strength:

1. `db/schema/001_init.sql:128` — `funded_amount numeric(14,2)`. Never altered since:
   the only `ALTER TABLE funding_rounds` statements are `137_money_chain_idempotency.sql`
   (adds `source_event_id`) and `148_demo_mode.sql` (adds `is_demo`). Neither touches type.
2. `src/commissions/calculate.mjs:60` — `toCents(round.funded_amount)`. `toCents` multiplies
   by 100. You only do that to a dollar value.
3. `src/verification/journeys/funding.mjs:695` — "Closeout total_fee is $5000 (10% of round
   funded_amount $50000)". A stored `50000` means fifty thousand dollars.

`transactions.amount_paid` is the **same**: `numeric(14,2)` dollars
(`db/schema/001_init.sql:157`), confirmed by `toCents(row.amount_paid)` at
`src/sales/call-outcomes.mjs:70` and `src/sales/cockpit.mjs:195`.

## What was wrong

Two queries, both summing a dollars column, both casting to `::bigint` and aliasing `cents`.

| | funded | cash |
|---|---|---|
| Column | dollars `numeric(14,2)` | dollars `numeric(14,2)` |
| Old cast | `::bigint` — drops the cents | `::bigint` — drops the cents |
| Old alias | `cents` — wrong unit | `cents` — wrong unit |
| Old JS read | `.dollars` — **field never existed** | `.cents` — name matched |
| Old result | **always $0** | **100x too small, silently** |

The funded bug was loud ($0). The cash bug was quiet and worse: on real data,
$4,201.00 collected was displayed as **$42.01**.

## Files touched

- `src/dashboard/kpis.mjs`
  - cash query: `COALESCE(SUM(amount_paid), 0)::bigint AS cents` → `COALESCE(SUM(amount_paid), 0) AS dollars`
  - funded query: `COALESCE(SUM(funded_amount), 0)::bigint AS cents` → `COALESCE(SUM(funded_amount), 0) AS dollars`
  - `cashCents`: now `Math.round(Number(cash.rows[0]?.dollars || 0) * 100)`
  - `fundedCents`: unchanged (already the correct conversion; the SQL was the broken half)
- `src/dashboard/kpis.test.mjs` — **two tests appended, none edited, none removed**
  - `computeKpis treats transactions.amount_paid as dollars`
  - `computeKpis keeps ad spend in cents — spend_cents is a real cents column`

No exports added or changed. No props, routes, or schema touched. No new dependencies.

## Every `rows[0]?.<name>` read, checked against its alias

| read | SQL alias | unit | verdict |
|---|---|---|---|
| `cash.rows[0]?.dollars` | `AS dollars` | dollars → converted | **fixed** (was `.cents` on a dollars sum) |
| `funded.rows[0]?.n` | `count(...)::int AS n` | count | ok |
| `funded.rows[0]?.dollars` | `AS dollars` | dollars → converted | **fixed** (alias was `cents`) |
| `booked.rows[0]?.n` | `AS n` | count | ok |
| `showed.rows[0]?.n` | `AS n` | count | ok |
| `closed.rows[0]?.n` | `AS n` | count | ok |
| `clients.rows[0]?.n` | `AS n` | count | ok |
| `spend.rows[0]?.cents` | `SUM(spend_cents)::bigint AS cents` | **genuine cents** | ok — left alone |
| `moved.rows[0]?.n` | `AS n` | count | ok |

`ad_metrics_daily.spend_cents` is `bigint` (`db/migrations/046_ad_platforms.sql:440`) — a real
cents column. Its `::bigint AS cents` is correct and was deliberately not changed. Its
`.catch(() => ({ rows: [{ cents: null }] }))` fallback also matches the alias.

## NULL survival (CLAUDE.md §12) — findings, not changes

`spendCents` is the only field that handles unknown correctly:
`spendRaw == null ? null : Number(spendRaw)`, plus a `cost_per_funded_reason` string.

Two places still show an unknown as a real zero. **Left as-is deliberately — not in scope,
reporting per instruction:**

1. **A funded round with no amount recorded contributes nothing, silently.**
   `COALESCE(SUM(funded_amount), 0)` — SQL `SUM` skips NULLs. Proven on a scratch Postgres:
   adding a `status='funded'` round with `funded_amount = NULL` left `funded_amount_cents`
   unchanged. The owner sees a funded-client count that the dollar total does not explain,
   with no flag. `src/handlers/money-chain.mjs:546` confirms this state is reachable — it
   emits a `missing_funded_amount` warning for exactly this shape.
   (`src/funding/card-stacking-rounds.mjs:129` guards its own write path with
   `funded_amount > 0`, so the normal card-stacking route cannot create it. The money-chain
   route can.)
2. **`cash_collected_cents` and `funded_amount_cents` cannot say "unknown".** Both are
   `|| 0`. "Nothing funded this week" and "we could not read the funding numbers" render
   identically as `$0`. The file header says zero means "nothing happened in the window" —
   that is a deliberate stance, so I did not change it, but it is load-bearing for a money
   screen and worth a decision.

## Verification

- `npm run lint` — **clean**, 1594 files parse.
- `npm test` on branch: **7139 tests, 7130 pass, 6 fail, 3 skipped.**
- `npm test` on `main` @ `4f551ff1`: **7137 tests, 7127 pass, 7 fail, 3 skipped.**
- Failure lists diffed line by line: **identical except `computeKpis counts funded rounds,
  not clients.funded`, which fails on `main` and passes here.** The 6 survivors are
  pre-existing and unrelated (route gate, S-23 invoice link, `hasLLC`, pulse registry,
  contract template keys, `start.html`, extraction faithfulness, `toBureaus`).
- `src/dashboard/kpis.test.mjs` alone: **7/7 pass** (was 4 pass / 1 fail on `main`).

### Measurement honesty — the pg phase never ran

`scripts/run-suite.mjs:82` is `if (code !== 0) process.exit(code);`. The unit phase fails on
`main` already, so the runner exits before the pg phase starts. **All 129 `.pg.test.mjs`
files never executed** — they are not the "skipped 3" in the summary; they simply never
began. So the 7139 figure is the **unit phase only**, and no database test ran on either side
of the comparison.

Seven `.pg.test.mjs` files touch `funding_rounds` and none of them ran:
`src/fulfillment/read-signals`, `src/affiliates/economics`, `src/messaging/cutover-acceptance`,
`src/handlers/money-chain`, `src/handlers/commission-money-chain`, `src/handlers/inquiry-gate`,
`src/funding/card-stacking-rounds`. **No pg test covers `computeKpis` at all** — the only
coverage of this module is the mock-based unit test.

### Real-Postgres proof (because a mock cannot prove SQL)

Ran the actual `computeKpis` against a throwaway local database (`f4_kpis_scratch`, created
and dropped for this run — never production, never `fundhub_ci`), with the real column types
from `db/schema/001_init.sql`:

| input | old code | new code |
|---|---|---|
| two funded rounds, $50,000.00 + $25,000.50 | `$0` | `7500050` cents = **$75,000.50** ✓ |
| paid $3,000.55 + $1,200.45, one refunded row excluded | `4201` cents = **$42.01** | `420100` cents = **$4,201.00** ✓ |

The half-dollar surviving ($75,000.**50**) is the proof the `::bigint` truncation is gone.

## Journeys

None updated, deliberately. `docs/journeys/role-owner-actual.md:122` lists
`/api/dashboard/kpis` as a route; the route, its auth, and its steps are unchanged. Only the
arithmetic inside one step is corrected, which the diagram does not depict. No
`docs/journeys/CHANGELOG.md` entry, since no journey file changed.

## Risk

Low, and one-directional: both numbers move from wrong to right. `cash_collected_cents` will
jump ~100x on every screen that reads it — that is the fix, not a regression. Confirmed no
consumer was compensating for the old bug: `api/dashboard/kpis.mjs:35,37`,
`src/ops/briefs.mjs:51,53` and `src/ops/pulse.mjs:48,50` all pass the value straight to
`formatCents`, which divides by 100 exactly once.

`call_outcomes.cash_collected_cents` (used by `src/sales/metrics.mjs`, `src/sales/cockpit.mjs`,
`src/galaxy/company-activity.mjs`) is a **different, genuinely-cents column** and is untouched.

## Left undone

- The two NULL-as-zero findings above — reported, not changed, per the task brief.
- No pg test was added for `computeKpis`. Out of the stated scope, and the pg phase cannot
  run to green while `main`'s unit phase is red.
- Cannot say whether production currently holds any `status='funded'` round. Not checked —
  the brief forbids connecting to the live database.
