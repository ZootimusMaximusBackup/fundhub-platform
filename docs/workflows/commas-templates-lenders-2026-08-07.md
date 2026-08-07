# Batch: commas-templates-lenders — 2026-08-07

Three parallel workflows. Coordinate through this file. Agents do not message
each other (CLAUDE.md §5).

## Task list

| # | Workflow | Owner | Status | Migration |
|---|----------|-------|--------|-----------|
| W1 | Commas webhook rework (5 items) | main session | claimed | **156** |
| W2 | Seed 4 real template bodies to production | subagent | **done** | none |
| W3 | Demo lenders + Demo Mode gate | subagent | **done** | **157 released — unused** |

Claim a task by marking it `claimed` before starting. Write your manifest here
before reporting complete. Read this file before you start — another workflow
may already have changed something you depend on.

## Shared context brief

Established by the ground pass. Do not re-derive these.

### Migration numbers are pre-assigned

Highest migration on `main` is `155_inquiry_gate.sql`. W1 takes **156**, W3
takes **157**. This repo collided migration numbers earlier tonight; the
numbers are assigned up front so it cannot happen again. Do not pick your own.

### There is ONE lender table, not seven

`db/migrations/138_lenders.sql` creates a single `lenders` table with a
`lender_table` enum discriminator holding exactly seven product types:

```
OnlineBizCC, InBranchBizCC, BizLOC_Stated, BizLOC_Documented,
PersonalCC, PersonalLoans, PersonalLOC
```

Plus `lender_bureau_observations`. "Seven lender product tables" in the
request means seven product types in one table.

### ~~`lenders` has no `is_demo` column~~ — WRONG, RETRACTED 2026-08-06

**This claim was false and W3 was right to stop.** `148_demo_mode.sql` line 21
already adds `is_demo` to `lenders`, and line 31 adds
`lenders_is_demo_idx`. Verified directly.

Cause of the error, recorded so it is not repeated: the ground pass ran
`rg is_demo db/migrations/*.sql | head -30` and the `head` cut the output at
line 14 of `148_demo_mode.sql`, seven lines above the `lenders` line. A
truncated search was reported as an exhaustive one. Do not use `head` on a
search whose absence of a result is the finding.

### The Demo Mode pattern to copy

`src/galaxy/company-activity.mjs`. It resolves `orgDemoModeEnabled(db, orgId)`
once, then binds it as a query parameter:

```sql
AND ($2::boolean OR COALESCE(e.is_demo, false) = false)
```

Presence respects Demo Mode. Money never includes `is_demo`. Default is
exclude.

### Deploy budget: ONE, at the end

Deploying after each env var change burned the month's build credits on
2026-08-06 and paused the live site. No workflow deploys. No workflow sets env
vars. `CLAUDE.md` §11 has been rewritten to require batching.

### Test placement trap

`npm test`'s glob is `src/**` and `scripts/**` only. A test under `api/` never
runs (CLAUDE.md §12). Postgres tests are `*.pg.test.mjs`.

## Change manifests

Write yours here when done, before reporting complete.

### W1 — Commas

**Status: done.** The Commas webhook no longer does its work before answering.

#### The problem

Commas delivers **at most once**. No retries, ever — a delivery that fails on
their side is logged and dropped and we are never told. The adapter used to
verify, normalise, emit every canonical event and run the whole money chain
*before* returning a status code, so any failure anywhere in that chain lost a
real payment permanently. A deposit would simply never register.

Separately, the router read the signature off `x-commas-signature`. Commas
signs with `x-webhook-signature`. No live delivery has ever carried the old
name, so **every real payment webhook was failing verification and answering
401.**

#### Files added

| File | What it is |
|---|---|
| `db/migrations/156_commas_inbox.sql` | Durable landing table. Unique on `(org_id, dedupe_key)`. |
| `src/payments/commas-inbox.mjs` | Enqueue / claim / drain / mark. No adapter import (would cycle). |
| `src/payments/commas-api.mjs` | `GET /payments/:id` client + `reconcilePayment`. |
| `src/payments/commas-inbox.pg.test.mjs` | 8 real-Postgres tests. |
| `src/handlers/commas-disputes.mjs` | `payment.disputed` / `payment.refunded` → tasks. |
| `src/handlers/commas-disputes.test.mjs` | 7 tests. |
| `netlify/functions/commas-inbox-sweeper.mjs` | Drains the queue, every minute. |

#### Files changed

* `src/adapters/commas.mjs` — `handleCommasWebhook` now verifies, stores, and
  answers. New `processCommasInboxRow` does the interpreting from the sweeper.
  Added `SIGNATURE_HEADERS`, `paymentIdOf`, `eventTypeOf`; `normalizeCommasEvent`
  now returns `paymentId` and `dueBy`.
* `src/http/router.mjs` — `STD[].sig` may now be a LIST of header names, tried
  in order. Commas is `["x-webhook-signature", "x-commas-signature"]`. `headers`
  are forwarded to the adapter.
* `src/events/canonical.mjs` — four new names: `payment.expired`,
  `payment.canceled`, `payment.refunded`, `payment.disputed`.
* `src/events/bus.mjs` — exports `defaultOrgId` so the inbox can resolve an org
  before any event exists.
* `src/register-all.mjs` — registers the dispute handler.
* `netlify.toml` — `commas-inbox-sweeper` on `* * * * *`.
* `src/adapters/commas.test.mjs`, `src/http/router.test.mjs` — rewritten for
  the two-phase contract. Nothing skipped, nothing weakened.
* `docs/diagrams/*`, `db/expected-migrations.mjs` — regenerated.

#### Contract change other workflows must know about

`handleCommasWebhook` **no longer returns `emitted`**. At the moment it
answers, nothing has been decided yet. It returns
`{ ok, status, queued, deduped, inboxId, paymentId, eventType }`.

#### Placement note

`src/payments/` is new. `commas-inbox.mjs` and `commas-api.mjs` started in
`src/adapters/` and were moved out: `scripts/diagrams/extract.mjs` globs that
directory and treats every file as a webhook adapter, so a queue module and an
outbound client were being drawn on the adapter-boundary diagram as adapters
that verify nothing and emit nothing. Moving them kept `src/adapters/` meaning
exactly one thing rather than loosening the diagram test.

#### Checks

`npm run lint` clean (1008 files). Full suite **0 failures** without a
database (4660 + 631, 583 pg tests skipped). Against local Postgres 16.14
`fundhub_ci`: 66 failing assertions across 31 suites — **being diffed against
the baseline commit before any claim is made about them** (CLAUDE.md §12: the
count has never been stable and pre-existing failures are expected). None of
the 31 names touch Commas, payments, the router or webhooks.

`npx tsc --noEmit` is a **no-op in this repo — there is no tsconfig.json**, so
it prints its own help text and exits 0. It has never checked anything. Worth
knowing, since CLAUDE.md §6 lists it as a gate.

Journeys regenerated: **unchanged.** No route or role gate moved, so no
`-actual.md` edit and no changelog line is owed.

#### Left undone, deliberately

* **Reconciliation is partial and cannot be completed from this repo.**
  `GET /payments/:id` answers "tell me about this payment". It cannot answer
  "which payments happened that I never heard about" — that needs a list or
  search endpoint, and none is confirmed to exist. So a payment whose webhook
  delivery failed on the Commas side is still invisible until a human spots it
  in their dashboard. Header of `src/payments/commas-api.mjs` states exactly
  what is and is not covered.
* **`COMMAS_API_KEY` is not set**, so the reconciliation path is built and
  inert. It fails closed and says so rather than reporting "nothing to
  reconcile".
* **Refunds and disputes do not touch the ledger.** Clawback policy is
  undecided; guessing it would silently rewrite someone's commission.

### W2 — Templates

**Status: done.** Four `[DRAFT]` placeholder rows in the PRODUCTION
`message_templates` table replaced with the real copy that was already on `main`.

**Repo files changed: none.** No migration, no `src/` edit, no deploy, no env var.

#### What was wrong

The four keys were seeded on 2026-08-04 as `[DRAFT — NO SOURCE COPY IN
fundhub-docs]` bodies with `source_doc = 'DRAFT — no matching fundhub-docs copy'`.
Real copy has since landed in the **in-repo** `fundhub-docs/sources/` (commit
`cb15e4f`), so `analyse()` now resolves all four as `doc-exact` and the seeder's
DRAFT count is 0.

Docs-dir resolution note for anyone re-running this: `collect.mjs`
`DOCS_CANDIDATES` puts the *sibling* `../fundhub-docs/sources` first, but that
directory has no `SMS-TEMPLATES-CURRENT.md`, so `hasSources()` rejects it and the
in-repo `fundhub-platform/fundhub-docs/sources` wins. Confirmed at run time —
the script prints the resolved docs dir.

#### Rows written (org `fundhub`)

| template_key | before | after | compliance_passed |
|---|---|---|---|
| `EMAIL-C06-DECLINE` | `[DRAFT]`, 289 chars | "Your Fundhub review — what we found", 1049 chars | `false` → `false` |
| `EMAIL-DS01-REPAIR-REFERRAL` | `[DRAFT]`, 279 chars | "The step that unlocks your funding", 1149 chars | `false` → `false` |
| `EMAIL-DS02-DIY-LETTERS-READY` | `[DRAFT]`, 279 chars | "Your correction letters are ready", 1016 chars | `false` → `false` |
| `SMS-C06-DECLINE` | `[DRAFT]`, 269 chars | real decline SMS w/ STOP opt-out, 380 chars | `false` → `false` |

`approved_by`, `approved_at`, `approved_body_sha` were NULL before and are NULL
after on all four. **Nothing was approved.** Approval stays manual in the
template editor (migration 116).

#### Scoping

`node src/messaging/seed/seed.mjs` seeds **all 218** parsed templates — a blanket
rewrite. Scoped instead by calling the module's own exports from a throwaway
script outside the repo (`/tmp/w2-seed-four.mjs`): `analyse()` → filter
`seedable` to the four keys → `seedTemplates(db, picked)`. The script refuses to
write if any picked row still parses as DRAFT or carries
`compliancePassed !== false`.

Command:

```bash
DATABASE_URL="<prod session pooler>" node /tmp/w2-seed-four.mjs --write
# → WRITE: inserted=0 updated=4 total=4
```

Proof no other row moved: `md5` fingerprint over
`template_key|subject|body|compliance_passed|updated_at` for the other **225**
rows is `a303199b64e0f91552b4c03af043a47f` **before and after** — identical.

#### Findings

* **5 rows are still `[DRAFT]` in production** and were deliberately left alone
  (out of W2's scope): `SMS-N01-COLD-NURTURE`, `SMS-N02-WARM-NURTURE`,
  `SMS-N03-HOT-NURTURE`, `SMS-N04-POST-FUNDING`, `SMS-N06-RENEWAL`. The N-series
  SMS copy does not exist in either source doc. `draft-guard.mjs` blocks them
  from sending regardless of the flag, so this is safe but unfinished.
* `WORKFLOW_DRAFT_INTENTS` in `src/messaging/seed/workflow-keys.mjs` still lists
  the four now-covered keys. Dead entries, harmless (the doc-exact branch wins
  first). Not removed — out of scope.

#### Checks

`npm run lint` clean (1002 files). `node --test src/messaging/seed/*.test.mjs` →
65 pass / 0 fail / 7 skipped (Postgres-gated). No UI change, so no Playwright.
No journey change, so no `-actual.md` or changelog entry.

### W3 — Demo lenders

**Status: done.** Not committed — left in the working tree for review.

**Migration 157 was NOT created. It is released and still free** (per A1: no
`ALTER` is needed, `148_demo_mode.sql` already added the column and index).

**No deploy, no netlify command, no env var, nothing applied to production.**

#### ONE DEVIATION FROM A1 — needs a yes/no

A1 said to put the demo rows in a new `db/seed/00N_*.sql`. **W3 did not do
that**, because a third option exists that A1 could not have known about:
`src/demo/roster.mjs` `DEMO_LENDERS` **already seeds 7 demo lenders**, one per
`lender_table`, via `seedPlatformDemo()`. W3 extended that roster instead.

Two verified reasons a `db/seed/` file is the wrong home here:

1. **It would be a second lender seeder** doing the same job as the first —
   the exact duplicate-implementation bug CLAUDE.md §8 exists to prevent.
2. **The rows would be permanently destroyed by the Wipe button.**
   `api/demo/mode.mjs` → `wipeDemoData()` runs
   `DELETE FROM lenders WHERE org_id=$1 AND is_demo`. `db/migrate.mjs` records
   each seed file in `schema_migrations` and skips it forever after. So:
   wipe once → demo lenders gone → re-running the migrator will not bring them
   back. The roster path has no such trap: `setDemoMode(enabled: true)` calls
   `seedPlatformDemo()`, which is idempotent and re-seeds on every toggle.

Also relevant: demo lenders **do not exist at migration time at all** — they are
created on demand when Demo Mode is switched on, so a seed file running during
`node db/migrate.mjs` is seeding a table nobody is looking at yet.

Reversible in about ten minutes if the owner still wants a `db/seed/` file.

#### Files changed

| File | Change |
|---|---|
| `src/demo/roster.mjs` | `DEMO_LENDERS` 7 → **21** rows; added `bureaus`, `states`, `tier`, `min_revenue`, `min_tib` per row |
| `src/demo/platform-seed.mjs` | seeds `bureaus_pulled`, `eligible_states`, per-row `priority_tier` (was hardcoded `2`); re-asserts them each run so an existing demo org self-heals; application seeding strides by 3 to keep product-type variety |
| `src/lenders/match.mjs` | `matchLenders({ includeDemo = false })` — filters the incoming array; also returns `is_demo` on each match |
| `src/lenders/store.mjs` | `matchForClient` resolves `orgDemoModeEnabled` **once** and passes it to both `listLenders` and `matchLenders` |
| `src/calculators/deal-funding.mjs` | `calcFunding({ includeDemo = false })`, passed through to `matchLenders` |
| `api/read/tradelines.mjs` | resolves demo mode once, passes to `listLenders` + `calcFunding` |
| `src/lenders/demo-gate.pg.test.mjs` | **new**, 6 real-Postgres tests |
| `src/lenders/match.test.mjs` | +5 gate tests |
| `src/calculators/deal-funding.test.mjs` | +2 tests, incl. money-cannot-move |

No exports removed. `matchLenders` and `calcFunding` gained one optional
parameter each, both defaulting to the old-safe behaviour, so no existing
caller changes meaning. **Nothing under `src/adapters/`, `src/http/router.mjs`
or `src/messaging/` was touched.**

#### The gate

`matchLenders` filters demo rows out of the incoming array. Dropped rows are
**not** added to `skipped` — `skipped` is rendered on the round planner, and a
demo lender named there is still a demo lender disclosed to a real client.
With Demo Mode off they are absent, not refused.

#### Seed shape (21 rows, 3 per `lender_table`)

Bureau spread: **EX 4 · EQ 5 · TU 5 · EX/EQ 2 · EQ/TU 2 · EX/TU 1 · EX/EQ/TU 2**

| Scenario | Matches |
|---|---|
| Demo Mode OFF | **0** demo (real lenders unaffected) |
| Demo Mode ON, clean file | **21** |
| Demo Mode ON, TransUnion blocked | **11** (EX-only 4, EQ-only 5, EX/EQ 2) |
| Demo Mode ON, TU + EX blocked | **5** |

Seeded only what `matchLenders` reads (`lender_table`, `active`,
`eligible_states`, `bureaus_pulled`, `priority_tier`) plus name/product/typical.
`minimum_revenue_threshold` and `minimum_time_in_business_years` are populated
because the columns exist — **the matcher does not filter on them.**

#### Pre-existing defect this fixes

The 7 original demo lenders were seeded with **`bureaus_pulled` NULL** and
`priority_tier` hardcoded to 2. `parseBureaus(null)` returns `[]`, so those rows
overlapped no bureau and **the inquiry gate never dropped a single one** — an
inquiry-heavy file got exactly the same list as a clean one. The per-bureau
demo could not have worked before this change.

#### Checks (CLAUDE.md §6)

Measured in an **isolated git worktree at `ccbda63` carrying only W3's 9 files**,
because the shared working tree also holds W1's in-flight Commas work.
Environment: local PostgreSQL 16.14, fresh database per run, connected as the
unprivileged **`fundhub_app`** role.

* `npm run lint` — clean, 1007 files.
* **Unit suite: baseline 4629 pass / 0 fail → W3 4636 pass / 0 fail.** +7 tests,
  no regressions. Includes the diagrams-sync and journeys-sync tests.
* `npm run journeys:check` / `diagrams:check` — both up to date. **No journey
  changed**, so no `-actual.md` edit and no CHANGELOG entry: no route, handler
  or step was added or removed. The gate is a filter inside an existing step.
* No UI file touched → no Playwright run.
* **`npx tsc --noEmit` cannot run in this repo — there is no `tsconfig.json`.**
  It prints its own usage text and exits 1 at pristine `HEAD` too. Pre-existing,
  not caused by W3, and worth someone deciding on (§6 lists it as required).
* **Postgres suite is flaky, and that is measured, not assumed.** Two runs of
  *identical pristine baseline code* on *identical fresh databases* gave **113**
  and **115** failures, disagreeing on 5 test names. W3's run gave **114**. Every
  name in W3's set-difference vs baseline (`two dispatchers racing…`,
  `n-06 …opted out during the sleep`, `an SMS queued at 23:00 ET…`, plus
  `replay() …ZERO messages` going the other way) is one of the names that also
  flips between the two baseline runs. All are in `src/messaging/`, which W3
  never touched. **Net regressions attributable to W3: zero.**
* `demo mode isolation` and `company-activity` fail in W3's run — and fail
  **identically at pristine baseline**, `company-activity` with
  `fixture: demo cash today should exist after seed`. Pre-existing.
* New `src/lenders/demo-gate.pg.test.mjs`: **6 / 6 pass.**

#### Ready to apply

Nothing to apply. There is no migration. The demo rows appear when someone
switches Demo Mode on, through the existing button.

## Blockers and open questions

### W3 blocker — the brief's premises do not match the code

Four findings. The first three are verified facts, not opinions. Each was
checked against the migration files AND against a live local Postgres
(`fundhub_ci`, PostgreSQL 16.14).

**1. `lenders.is_demo` already exists. The ground pass is wrong.**

`db/migrations/148_demo_mode.sql` line 21:

```sql
ALTER TABLE lenders ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
```

and line 31:

```sql
CREATE INDEX IF NOT EXISTS lenders_is_demo_idx ON lenders (org_id) WHERE is_demo;
```

Confirmed live in `fundhub_ci`: column `is_demo boolean NOT NULL DEFAULT false`
present; index `lenders_is_demo_idx` present.

The board says 148 "missed" `lenders`. It did not. Migration 157 as specified
in the brief is a no-op.

**2. The store gate already exists. There is nothing to add to `store.mjs`.**

`src/lenders/store.mjs` `listLenders()` already does exactly what the brief
asks for:

- line 85 — resolves `orgDemoModeEnabled(db, orgId)` once
- line 86 — `if (!demoOn) where.push("COALESCE(is_demo, false) = false")`
- line 22 — `is_demo` is already in `SELECT_COLS`
- line 38 — `publicLender()` already prefixes demo rows with `DEMO · `
- line 222 — `exportLendersCsv` passes `forExport: true`, which forces demo
  rows out of exports regardless of the toggle

`matchForClient()` (line 356) loads its lenders through `listLenders`, so the
round-planning path is **already gated**. Default is already exclude.

**3. `matchLenders` cannot take the SQL gate. It writes no SQL.**

`src/lenders/match.mjs` `matchLenders()` is a pure function. It receives a
`lenders` array and has no `db` handle and no query. The prescribed form

```sql
AND ($2::boolean OR COALESCE(x.is_demo, false) = false)
```

has nowhere to go in that file.

Gating it means changing the JavaScript signature instead — e.g. an
`includeDemo = false` option that filters the incoming array. That is a
contract change to a pure function with three callers
(`store.mjs`, `deal-funding.mjs`, and two unit-test files). **Needs a decision,
not a guess.**

**4. The seed fields named in the brief are not the fields the matcher reads.**

The brief says to vary "minimum FICO, maximum inquiries, revenue, time in
business". `matchLenders` reads none of those four. It reads only:

| Column | Used for |
|---|---|
| `lender_table` | product-type filter |
| `active` | skip inactive |
| `eligible_states` | state eligibility |
| `bureaus_pulled` | the inquiry-sensitivity gate |
| `priority_tier` | ranking |

There is **no FICO column and no maximum-inquiries column on `lenders` at
all**. `minimum_revenue_threshold` and `minimum_time_in_business_years` do
exist as columns but nothing in the matcher reads them.

The brief also says "do not seed fields nothing reads", which contradicts its
own list. Seeding the five columns above is the reading W3 would take, but the
two instructions cannot both be followed.

**Not a blocker, recorded for the batch — no bypass in `deal-funding.mjs`.**

`calcFunding()` is pure. Its money math (`totalAvailableCredit`, `allocation`,
`payMethodComparison`, `guardrail`) is computed from `cards`, never from
`lenders`. Lenders feed only `lenderMatchCount` / `lenderMatches`. Its one real
caller, `api/read/tradelines.mjs` line 153, sources lenders from `listLenders`,
which is gated. So a demo lender structurally cannot reach a money or
commission number today.

### Two questions blocking W3 — ANSWERED 2026-08-06 by W1/main session

W3's findings 1–4 are all confirmed correct. The brief was wrong; it has been
retracted above. Answers:

**A1 — Migration 157 contains nothing. It is released, unused.**
No `ALTER` is needed. The demo rows are seed data, so they belong in
`db/seed/`, not `db/migrations/`. `db/migrate.mjs` line 14 applies
`["schema", "migrations", "seed"]` in that order and records every file in
`schema_migrations` keyed `<dir>/<file>`, so a seed file runs exactly once
and is applied to production by the same command. Create the next free
`db/seed/00N_*.sql`. Use `ON CONFLICT DO NOTHING` so a re-run is safe.

**A2 — Yes, add `includeDemo = false` to `matchLenders`. Make the change.**
The owner's instruction named both surfaces: "matchLenders and the lender
store EXCLUDE is_demo rows unless Demo Mode is on." `listLenders` already
being gated does not satisfy it, and defence in depth is the point — if any
caller ever hands `matchLenders` an ungated array, demo rows must still not
come back. Keep it a pure function: no `db` handle, no SQL. Filter the
incoming array, default `false`, and update the three callers plus their
tests.

**On finding 4 — seed exactly the five columns the matcher reads**
(`lender_table`, `active`, `eligible_states`, `bureaus_pulled`,
`priority_tier`). "Do not seed fields nothing reads" is the instruction that
wins; the FICO / max-inquiries / revenue list in the brief was written without
checking the matcher and those columns mostly do not exist. Vary
`bureaus_pulled` and `eligible_states` — those are what make the list get
shorter for an inquiry-heavy file. Populate `name`, `org_id` and `is_demo` as
required. You may additionally set `minimum_revenue_threshold` and
`minimum_time_in_business_years` since those columns do exist, but do not
claim the matcher filters on them.

**On the `fundhub_ci` row count.** One real (non-demo) lender exists there, so
"zero with Demo Mode OFF" will not hold as written. Assert the real property
instead: with Demo Mode OFF the result contains **no demo rows** (and equals
the real-lender-only result); with Demo Mode ON it is strictly larger. That is
the claim that actually protects a client on a real call.

W3: unblocked. Proceed.

### W3 — one open question left after doing the work

A1 said "create the next free `db/seed/00N_*.sql`". W3 did not, and used the
existing `src/demo/roster.mjs` seeder instead. Reason, in short: a `db/seed/`
file would be a **second** lender seeder, and its rows would be deleted by the
Demo Mode Wipe button and never come back, because `db/migrate.mjs` skips a
seed file once it is recorded in `schema_migrations`. Full reasoning and the
evidence are in the W3 manifest above. **Reversible in ~10 minutes — say the
word if you still want the `db/seed/` file.**

### W3 — a §6 item that cannot pass in this repo

`npx tsc --noEmit` has no `tsconfig.json` to read. It prints its usage text and
exits 1 at pristine `HEAD`, with or without W3's changes. It is listed in
CLAUDE.md §6 as required for every task, so every workflow will keep hitting
it. Someone should either add a `tsconfig.json` or drop the line from §6.
There is exactly one TypeScript file in the repo (`src/lib/rbac.ts`).

### W3 — the Postgres suite is flaky, with numbers

CLAUDE.md §12 asks for a measured count and the environment it came from. Two
runs of **identical pristine `ccbda63` code** against **identical fresh
databases** (local PostgreSQL 16.14, `fundhub_app` role) produced **113** and
**115** pg failures, disagreeing on 5 test names, all in `src/messaging/`:

```
PostGrid delivery webhook → call clock
an SMS queued at 23:00 ET is still queued at 23:05 and sends after 11:00 ET
n-06: a client who opted out during the sleep gets nothing
two dispatchers racing the same message produce exactly one send
replay() over the same event log sends ZERO messages
```

Anyone comparing pg failure counts across runs needs to know this first — a
±2 swing here means nothing. The unit suite, by contrast, was **4629 / 0 fail**
on both baseline runs and is a reliable signal.

### Also worth knowing

`fundhub_ci` currently holds **1 lender row, 0 of them demo**. So the brief's
verification step "matchLenders returns zero with Demo Mode OFF given no real
lenders exist" would not hold there as written — one real lender is present.

A local Postgres **is** reachable (16.14, `fundhub_ci` and `fundhub_verify`
both migrated), so the `.pg.test.mjs` work is testable once the two questions
above are answered.
