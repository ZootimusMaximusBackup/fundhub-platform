# Fundhub Beta Buildout — shared board

Six workflows. Five run at once. One waits. Read this file before you start.
Claim your task before you work it. Write your manifest before you report done.

> **TWO WORKFLOWS EACH CREATED THIS FILE, AND THIS IS THE STITCHED RESULT.**
> W1 wrote it as the batch board (the task list and ground brief below). The
> banking-compliance-revoke-erasure workflow, which is W4, could not see it and
> wrote its own file at the same path — recording, correctly, that the board
> "did not exist when that workflow started". Both were real and neither was a
> draft, so this merge keeps both: W1's structure, and W4's manifest, owner
> decisions and blockers folded into the slots that were waiting for them.
> Nothing was dropped to make the merge tidy.

---

## How to use this file

1. Find your workflow below.
2. Change your status from `pending` to `claimed`.
3. Do the work.
4. Fill in your **Change manifest** section.
5. Set status to `done`.

If you get stuck on something another workflow owns, set your status to `blocked`,
write why, and STOP. Do not work around another workflow's unfinished output.

---

## Task list

| Workflow | Owns | Migrations | Status | Owner |
|---|---|---|---|---|
| W1 | Provider seam, mock bank, manual entry, statement cycles, investments | 097–098 (renumbered on merge) | `done` | this session |
| W2 | Consent capture + soft-pull request gate | 099 | `done` | claude/migration-099-consent-repknn |
| W3 | Retention policy + dry-run purge | 100 | `done` | claude/migration-100-retention-policy-sn3x49 |
| W4 | Deletion, erasure, orphan-transaction bug, key rotation, revocation | 101–102 | `done` | banking-compliance-revoke-erasure |
| W5 | UnderwriteIQ vendor + adapter + fixture test | none | `pending` | — |
| W6 | The dashboard screen | none | `blocked` — waits for W1 + W5 | — |

**Migration numbers are pre-allocated. Do not pick one at runtime.**

Updated on merge: the audit branch has landed, so 090–096 now exist. It used 096 for
`096_demo_client_entitlements.sql`, which is the number W1 had reserved for statement
cycles. W1's two files were therefore renumbered 096→097 and 097→098 when this branch
merged. Two files may share a number without breaking `migrate.mjs` — it keys on
`<dir>/<file>` — but a duplicate number is a trap for the next person reading the
folder, so they were moved rather than left to collide. 099 and 100 remain reserved for
W2 and W3.

---

## Owner decisions — settled, do not re-litigate

| Date | Decision | Status |
|---|---|---|
| 2026-07-31 | **The kept-list in `src/privacy/erasure.mjs` ships as written.** What an erasure retains, and the written reason attached to each entry, is approved as-is. | **Owner-set.** Not to be re-flagged for compliance review. |
| 2026-07-31 | **Revoking a bank login keeps the transactions.** Disconnect and erase are different requests. | **Owner-set.** Do not change. |

CLAUDE.md §7 is the governing rule — "flagged changes ship only after explicit human
approval." That approval has been given for both items above, so they are approved rather
than pending. Anyone touching them should treat the decision as made.

Scope of the first approval: it covers the list as it stands. Adding a table, removing
one, or changing what a reason claims is a new decision and needs a fresh look.

> Note for the record: the approval was given citing an "Owner decisions are final"
> section of CLAUDE.md. No such section exists — CLAUDE.md runs §0–§12 and none of them
> is that. The approval itself is valid under §7 regardless, which is what is cited
> above. Flagged here rather than silently written down, because a compliance record
> that cites a rule which does not exist is the kind of thing that fails an audit later.

### Decisions other workflows need to know

1. **Revoking a bank login does NOT delete transactions.** It removes the credential and
   the accounts. The ledger stays, anchored by `subject_client_id`. Anyone writing an
   ingest path must not assume a revoke clears history.
2. **Erasure de-identifies; it does not DELETE the client row.** `pii_access_log.client_id`
   references `clients(id)` with no cascade, so a hard delete would be refused by the
   database anyway.
3. **Nothing here is automatic.** There is no scheduler and no retention sweep. Both
   actions run only on an explicit request that writes an audit row first.
4. **CRS is untouched.** `src/tradelines/`, `crs_results` and the soft-pull fulfil path
   were not modified. They are recorded as KEPT on every erasure with a written reason.

---

## Ground brief — read this instead of re-reading the tree

Written by W1 during the ground phase. Everything here was verified by reading the
code, not assumed.

### Things the task brief named that DO NOT EXIST

Six of these. Do not go looking for them; do not invent them.

| Named as existing | Reality |
|---|---|
| `npm run migrations:manifest` | No such script in `package.json`. Scripts are: `migrate`, `artifact`, `diagrams`, `diagrams:check`, `test`. |
| `docs/journeys/` | Folder does not exist. No journey files at all. |
| `src/auth/demo-logins.mjs` | Does not exist. The fail-closed pattern to copy is `plaidConfigFromEnv()` in `src/banking/plaid.mjs`. |
| `listRecurringBillsFor()` | The real name is `listRecurringBills()` in `src/banking/store.mjs`. |
| `src/http/read-endpoints-org-scope.test.mjs` | Does not exist. Nothing currently fails a build over an unscoped read endpoint. |
| `src/http/app-nav-reachability.test.mjs` | Does not exist. Nothing currently fails a build over an unreachable screen. |

**Owner decision on journeys:** each workflow generates `docs/journeys/<name>-actual.md`
from the code it wrote. Nobody authors the `-intended.md` files — those stay the owner's.
Append one line per change to `docs/journeys/CHANGELOG.md`, newest at top.

### Org scoping — the current state is WORSE than the brief implies

The brief says an org-scope test fails the build. It does not exist. And
`api/read/banking-surface.mjs` is **not org-scoped** — it filters on `client_id` only:

```sql
SELECT ... FROM bank_accounts WHERE client_id = $1
```

Any authenticated staff session from any org can read any client's bank balances if they
know the client's id. Same shape in `api/read/finance-os.mjs` — check before you copy it.

**Do not copy that pattern.** `staff.org_id` IS available — `requireAuth` attaches
`req.staff = { id, role, org_id, email, name, status }`. Every new read and write scopes
on it. W1 is not fixing the existing endpoints (out of scope, would collide with W6);
logged as a finding below.

### The two transaction helpers — one is broken

There are two `withTransaction` functions in this repo and they are not the same.

**BROKEN** — `src/banking/store.mjs:69`:
```js
if (typeof db.connect !== "function") return fn(db);
```
`src/db.mjs` exports `{ query }` with **no `connect`**, so this probe is always true for
the shared handle. Every multi-statement write through it runs with autocommit. A failure
half-way leaves half the rows written.

**CORRECT** — `src/finance/soft-pulls.mjs:485`:
```js
const acquire = typeof db?.connect === "function"
  ? () => db.connect()
  : (db === sharedDb ? () => pool().connect() : null);
if (!acquire) return fn(db);
```
Copy this one. It reaches for the pool when handed the shared singleton.

### Auth gate — two calls, never one argument

`requireAuth(req, res, opts)` forwards `opts` to `authenticate()`, which destructures
`{ db, env }` only. A `roles` key is silently dropped. This shipped once on
`api/read/tradelines.mjs` and the effective rule became "any staff session, any role" on
an endpoint serving a named client's credit limits.

```js
const staff = await requireAuth(req, res, { db });
if (!staff) return;
if (!requireRole(res, staff, ROLE_SETS.STAFF)) return;   // <-- the actual gate
```

### The ROUTES map

`netlify/functions/api.mjs` exports a hardcoded `ROUTES` object. A handler file not in it
404s whether or not the file exists. `src/http/routes.test.mjs` walks `api/` on disk and
fails if a handler is neither routed nor on an explicit allow-list — that list is
currently EMPTY. Adding a file under `api/` breaks the build until you route it.

### Money and rates

- Integer cents everywhere. `src/commissions/money.mjs`.
- `fromCents()` returns a **string**. Do not do arithmetic on the result.
- `percentOf()` takes percent units — `10` means 10%.
- NULL means UNKNOWN and must reach the screen as an em dash, never `$0.00`.
- APR is a **fraction 0..1**, `numeric(6,5)`, CHECK-constrained `>= 0 AND <= 1` on both
  083 and 084. A form collecting "24.99" must divide by 100. Use `readApr()` at
  `src/tradelines/index.mjs:51`.

### Table map — what already holds what

| Table | Holds | Key constraint that matters |
|---|---|---|
| `080 plaid_items` | one row per bank login, encrypted token, `consent_granted_at` (NULL on every row) | — |
| `081 bank_accounts` | one row per account under a login | `plaid_item_id` NULL = **hand-entered**. MASK ONLY — no account/routing number column, none may be added. Balances are signed bigint cents, deliberately not CHECK'd non-negative. |
| `082` | adds `entity_kind` to 081 | `unknown\|personal\|business`, defaults `unknown`, plus a provenance CHECK. Unknown is NEVER folded into personal. |
| `083 card_liabilities` | statement + due date + minimum payment per card | **`tradeline_id` is NOT NULL** — only exists for cards from a credit report. |
| `084 card_liability_history` | the same figures over time | unique on `(tradeline_id, as_of)` |
| `085 bank_transactions` | transactions | **NEGATIVE = money out** |
| `086 recurring_bills` | detected bills | `confidence_label`, partial index on medium/high only |

**The statement-cycle gap, precisely:** 083 already has `statement_date`,
`payment_due_date`, `minimum_payment_cents`, `statement_balance_cents` — but it requires
`tradeline_id`, so it covers only bureau-sourced cards. A hand-entered credit card in
`bank_accounts` has no cycle anywhere. W1's 096 covers the bank-account side and stores a
**recurring schedule** (close day, due day) rather than one-off dates, because that is
what a person knows about their own card. The dashboard must read both and say which
source each due date came from — same discipline as banking-surface vs finance-os.

### Do not touch

- `src/tradelines/` ingest, `crs_results` parsing, the soft-pull **fulfil** path. CRS is
  live and compliant.
- `src/mail/` — mails nothing by design.
- No outbound `fetch()` in `src/adapters/` or `src/lib/`. None exists. None may be added.

### Known open defect — check this FIRST if a screen behaves impossibly

`public/fh.js` has a sticky demo flag. `fh_demo="1"` in localStorage routes every later
call to a client-side mock that never contacts the backend, **and it swallows real 403s**.
Clear it before believing anything you see on a screen.

---

## Change manifests

### W1 — Provider seam, mock bank, manual entry — `done`

**New files**

| File | What it is |
|---|---|
| `db/migrations/097_account_statement_cycles.sql` | Statement cycles for accounts NOT from a credit report |
| `db/migrations/098_investment_holdings.sql` | Brokerage positions |
| `src/banking/provider.mjs` | **THE SEAM. Import this, never plaid.mjs or mock.mjs.** |
| `src/banking/mock.mjs` | Deterministic mock provider |
| `src/banking/statement-cycles.mjs` | PURE. The month-end rule lives here and nowhere else |
| `src/banking/accounts.mjs` | The writer for `bank_accounts`, cycles, holdings |
| `src/banking/import.mjs` | Provider → database |
| `api/banking/accounts.mjs` | GET + POST, action discriminator |
| `public/app/banking-entry.html` | The screen |

Migration 098 was allocated to W1 and **not used**. It is free — coordinate before taking it.

**Changed files** — four, all additive:
- `netlify/functions/api.mjs` — one import, one ROUTES entry (`banking/accounts`)
- `public/app/shell.js` — added `banking-entry.html` to `ALL`
- `public/app/banking-surface.html`, `public/app/finance-os.html` — one nav link each

**Exports other workflows will want**

```js
// src/banking/provider.mjs
bankingProviderFromEnv(env) // { name, ready, missing[], problems[] }
bankingProviderName(env)    // "mock" | "plaid" | null
isBankingEnabled(env)       // boolean
linkAccount({ clientId, publicToken, env })
getAccounts({ itemId, env })

// src/banking/accounts.mjs — every one takes { orgId, clientId }
createManualBankAccount(db, input, scope)
saveStatementCycle(db, input, { ...scope, bankAccountId })
replaceHoldings(db, holdings[], { ...scope, bankAccountId })
listBankAccounts(db, scope) / listStatementCycles(db, scope) / listHoldings(db, scope)
BankAccountWriteError   // .status, .field

// src/banking/statement-cycles.mjs — PURE, `today` is always a parameter
nextDueDate(cycleRow, { today })      // { dueOn, daysAway, unknownReason }
nextStatementClose(cycleRow, { today })
daysBetween(fromIso, toIso)
UNKNOWN_REASONS

// src/banking/import.mjs
importAccounts(db, { orgId, clientId, env, today })
```

**W6 — read this before building the dashboard**

- `GET /api/banking/accounts?client_id=<uuid>` returns
  `{ ok, provider, accounts[], cycles[], holdings[], as_of }`.
- **Each cycle already carries `next_due` and `next_close`, computed server-side.**
  Do NOT recompute a due date in the browser — that would put the month-end rule in two
  languages. When `next_due.dueOn` is null, `next_due.unknownReason` names the missing
  field; print that, do not leave the cell blank.
- **Bigint columns arrive as STRINGS** from node-postgres. `current_balance_cents` is
  `"250000"`, not `250000`. Do not do arithmetic on it without `Number()`.
- `provider` is `"mock"` when the data is invented. The screen must say so.
- A credit account's `available_balance_cents` is HEADROOM, not cash.
- Statement cycles live in TWO places and mean different things: `card_liabilities`
  (083, bureau-sourced, requires a tradeline) and `account_statement_cycles` (096,
  hand-entered or provider). The dashboard must say which source a due date came from.

**W5 — the card data you are adapting**

Cards now arrive from two places: `card_liabilities` (bureau) and `bank_accounts` where
`account_type = 'credit'` joined to `account_statement_cycles` (hand-entered or
provider). `credit_limit_cents` and `current_balance_cents` live on `bank_accounts`;
`apr`, `minimum_payment_cents` and the due schedule live on the cycle row. A
hand-entered card frequently has a NULL limit — that is the partial case your
suggestions must NAME rather than compute around.

**W4 — the orphan bug, precisely located**

`085_bank_transactions.sql` declares `bank_account_id uuid NOT NULL` with **no foreign
key at all**. Its own column comment says *"No FK yet — the bank_accounts table is owned
by the Plaid-link workflow and does not exist in this repo"* — but `081` created that
table. So `client_id` is `ON DELETE SET NULL` and `bank_account_id` references nothing:
delete a client and the transactions lose the person, delete an account and they point
at a row that is gone. Both routes back are severed. `src/banking/import.mjs` now writes
these rows, so the volume is about to grow.

**Verification**

- `npm test` — 2619 tests, **0 failures**, 321 skipped (no `DATABASE_URL`).
- 104 new unit tests passing; 13 pg tests correctly SKIPPING (0 passes, not green-by-absence).
- Three guards proven by reverting them — see the commit message on `74f5dbb`.

**⚠ `npm install` FIRST.** A fresh clone has no `node_modules`, and `npm test` then
reports **132 failures** that are entirely `Cannot find package 'inngest'`. That is not a
broken suite. Install, then measure.

### W2 — Consent capture — `done`

Migration 099 (`client_consents`), the capture handler at `api/consent/capture.mjs`
routed as `consent/capture`, the soft-pull request gate, and
`public/app/consent-capture.html`.

**Open on merge:** the screen has no inbound link — see F7.

### W3 — Retention and purge — `done`

**Branch:** `claude/migration-100-retention-policy-sn3x49`, cut fresh from `origin/main` @ `e67e2db`.

**COMPLIANCE REVIEW REQUIRED.** This unit touches consumer-credit records, the
PII access log and the soft-pull ledger. Nothing ships without human sign-off.

#### Files added

| File | What it does |
|---|---|
| `db/migrations/100_retention_policy.sql` | `retention_policy` table (one row per org per data class) + `v_retention_policy_gaps` view |
| `src/retention/policy.mjs` | Reads the table. NULL stays NULL — an unset retention period never becomes a number. |
| `src/retention/classes.mjs` | The five data classes: how each is counted, and whether it is de-identified or deleted |
| `scripts/retention-purge.mjs` | The runner. Dry run by default; `--apply` is the only way it writes. |
| `scripts/retention-purge.test.mjs` | Unit tests, no database needed |
| `scripts/retention-purge.pg.test.mjs` | Database tests, including "a dry run changes nothing" |

#### Files changed

| File | Change |
|---|---|
| `src/finance/soft-pulls.mjs` | Added the word `export` to `withTransaction`. No behaviour change — it is now importable instead of being copied. |

#### Exports added

- `src/retention/policy.mjs` → `RetentionError`, `DATA_CLASSES`, `loadPolicy`, `policyGaps`
- `src/retention/classes.mjs` → `CLASSES`, `MOCK_MARKERS`, `classFor`, `countFor`, `applyFor`
- `src/finance/soft-pulls.mjs` → `withTransaction` (was already there, now exported)

#### Routes affected

None. This unit adds no HTTP handler, so `netlify/functions/api.mjs`'s `ROUTES`
map is untouched and `src/http/routes.test.mjs` is unaffected.

#### Journeys impacted

**None, and this is verified rather than assumed.** `npm run journeys:check`
reports `docs/journeys is up to date (9 files)` with this branch merged.

The journey generator reads the routing table and each handler's gate. This unit
adds **no route and no gate** — the purge runner is a terminal command, not an
endpoint, so `netlify/functions/api.mjs`'s `ROUTES` map is untouched. Nothing for
the generator to pick up.

`docs/journeys/` did not exist when this unit started. It does now: W2 built it on
`claude/journeys-actual-generated` and it merged to `main` as `e68bb63`. That
branch point is merged into this one, so the check above ran against the real
generator rather than against an empty folder.

#### The retention windows — OWNER-SET

The owner set these directly, as the decision-maker for this business, and asked
for them to be recorded as owner-set. They are not derived, not defaults, and
not this build's invention.

| Data class | Owner stated | Stored | Action at expiry |
|---|---|---|---|
| `crs_raw_payloads` | 25 months | 762 days | de-identify |
| `pii_access_log` | 25 months | 762 days | delete |
| `soft_pull_ledger` | 25 months | 762 days | delete |
| `bank_transactions` | 24 months | 731 days | de-identify |
| `mock_data` | 7 days | 7 days | delete |

**Months round UP to days, never down.** `retain_days` is an integer number of
days; months are 28–31 days long, so the conversion direction is a real choice.
Rounding up costs a few days of storage. Rounding down destroys records *before*
the window they were meant to cover has elapsed, permanently. 762 and 731 are the
longest possible 25- and 24-month spans — verified against Postgres's own
calendar in `scripts/retention-purge.pg.test.mjs`, not computed by hand. A naive
25 × 30.4 = 760 would have been **two days short** for a window starting in the
wrong month.

**Default org only.** Every other org — white-label tenants, anything created
later — still gets a policy row with `retain_days` NULL and is still reported by
`v_retention_policy_gaps`. One business's retention decision is not another's.

**Condition stated by the owner, recorded here so it does not get lost:** counsel
reviews these before real customers are onboarded. Note the trade-off that comes
with signing off — `v_retention_policy_gaps` reports a class until it is *both*
set *and* signed off, so the default org is now silent in that report. The
condition therefore lives in each row's `notes` column and here, not in the gaps
report. **If counsel changes a number, that is a NEW migration** — `migrate.mjs`
keys `schema_migrations` by `<dir>/<file>`, so editing 100 after it has been
applied is a silent no-op. Supersede it the way 089 superseded 088.

**Why 100 was edited rather than superseded this time:** migration 100 has never
been applied to any real database (production is unreachable from here) and the
branch is unmerged, so there is no `schema_migrations` row to make an edit inert.
That stops being true the moment it is applied anywhere. **If 100 has already been
applied in your environment, do not edit it — add a new migration.**

---

## Open findings

1. ~~**`docs/journeys/` and `docs/compliance/` do not exist.**~~ **RESOLVED for
   journeys** — W2 generated `docs/journeys/` from code on
   `claude/journeys-actual-generated`, merged to `main` as `e68bb63`. Merged into
   this branch; `npm run journeys:check` is clean. `docs/compliance/` (CLAUDE.md
   §7) still does not exist, and the owner has confirmed the folders are coming —
   left as-is, not flagged again.

2. **Deleting a `crs_results` row can fail outright.** `soft_pull_requests.crs_result_id`
   is `ON DELETE SET NULL`, but `soft_pull_requests_result_ck` demands that a
   `fulfilled` row has a non-NULL `crs_result_id`. So the SET NULL violates the
   CHECK and the delete errors. This is why credit-report payloads are
   de-identified in place rather than deleted — see the migration header.

3. **The soft-pull ledger cannot be partially redacted.** `trg_soft_pull_requests_immutable`
   blocks updates to `client_id`, `requested_by_*`, `reason` and `requested_at`.
   De-identifying the row is impossible without changing that trigger, which is a
   compliance-path change and out of scope here.

4. **Mock data has no marker in the schema.** There is no `is_demo` column
   anywhere. The only identifiable mock rows are the ones
   `scripts/demo-journey.mjs` writes, recognised by their `demo:` idempotency
   keys. The demo *client* and everything cascading from it is counted and
   reported but never deleted — a cascading client delete touches five tables and
   is not something a script should do on its own.

5. **The transaction helper will need consolidating once PR #59 lands.** This unit
   exports the working `withTransaction` from `src/finance/soft-pulls.mjs` rather
   than writing a second copy. `docs/workflows/pii-and-journeys.md` records that
   PR #59 introduces `src/db/with-transaction.mjs` as a shared module, and that
   W1 will delete the broken copy in `src/pii/index.mjs` once it merges. When that
   happens `scripts/retention-purge.mjs` should import from the shared module too,
   and the `export` added here can go back to being private. Not a blocker — one
   import line — but it is the third helper in a tree that should have one.

6. **`bank_transactions` de-identification is partial by choice.** Merchant name
   and the verbatim provider payload are scrubbed; the amount, the dates and the
   client link stay. Severing `client_id` too would be stronger de-identification
   and would destroy per-client cash-flow history. That trade is a policy call,
   not an engineering one, and it is left to a human.

---

### W4 — Deletion, erasure, rotation, revocation — `done`

### Files added

| File | What it is |
|---|---|
| `db/migrations/101_bank_transaction_subject_anchor.sql` | The orphan fix: durable client anchor, trigger, backfill, index |
| `db/migrations/102_erasure_requests.sql` | The audit record: who asked, when, what was removed, what was kept and why |
| `src/db/with-transaction.mjs` | The correct transaction helper, shared |
| `src/banking/revoke.mjs` | Revoke a bank login |
| `src/banking/revoke.test.mjs` | Revoke unit tests, stubbed db |
| `src/banking/revoke.pg.test.mjs` | Revoke against real Postgres (skips with no `DATABASE_URL`) |
| `src/banking/key-rotation.test.mjs` | Rotation proof: rotate, then decrypt (pure, runs every pass) |
| `src/banking/key-rotation.pg.test.mjs` | Rotation against real Postgres: no plaintext in the table, no downtime |
| `src/banking/orphan-anchor.test.mjs` | Schema-contract test — fails if migration 101 is reverted |
| `src/privacy/erasure.mjs` | Client erasure / de-identification |
| `src/privacy/erasure.test.mjs` | Erasure unit tests, stubbed db |
| `src/privacy/erasure.pg.test.mjs` | Erasure against real Postgres (skips with no `DATABASE_URL`) |
| `api/banking/revoke.mjs` | `POST /api/banking/revoke` |
| `api/privacy/erasure.mjs` | `POST/GET /api/privacy/erasure` |
| `src/http/banking-revoke.test.mjs` | Endpoint tests, stubbed db |
| `src/http/privacy-erasure.test.mjs` | Endpoint tests, stubbed db |

### Files changed

| File | Change |
|---|---|
| `src/banking/plaid.mjs` | Added key rotation (`plaidTokenKeyId`, `rotatePlaidTokenCiphertext`, `rotatePlaidTokens`) and `KEY_ID_PATTERN`. Nothing existing changed. |
| `netlify/functions/api.mjs` | Two ROUTES entries: `banking/revoke`, `privacy/erasure` |

### Exports added

- `src/banking/plaid.mjs` — `plaidTokenKeyId`, `rotatePlaidTokenCiphertext`, `rotatePlaidTokens`, `KEY_ID_PATTERN`
- `src/banking/revoke.mjs` — `revokeBankLogin`, `listBankLogins`, `RevokeError`
- `src/privacy/erasure.mjs` — `eraseClient`, `listErasureRequests`, `ErasureError`, `KEPT_WITH_REASON`
- `src/db/with-transaction.mjs` — `withTransaction`

### Routes affected

- `POST /api/banking/revoke` — owner/admin only
- `POST /api/privacy/erasure`, `GET /api/privacy/erasure?client_id=` — owner/admin only

### Journeys impacted

`docs/journeys/` **does not exist in this repository.** No `-actual.md` file was updated
and none was invented. Recorded under blockers below.

---

### How this was verified

A real PostgreSQL 16 was started locally, all 68 migrations applied including 101 and 102,
and the suite run against it. Both migrations apply cleanly from scratch.

| Check | Result |
|---|---|
| Full suite, no `DATABASE_URL` (the CI condition) | 2680 tests, **0 fail**, 350 skip |
| This workflow's tests, against real Postgres | 160 tests, **0 fail** |
| New `.pg.test.mjs` files with `DATABASE_URL` unset | **skip**, never pass (21 + 8) |
| New failures vs `origin/main` on the same database | **none** — failure lists diffed, empty |

The repository has pre-existing failures against a real database (~36 after the first run;
CLAUDE.md §12 records this and the order-dependence behind it). `origin/main` was checked
out into a separate worktree and run against its own fresh database to establish that
baseline. Every failure in this branch's run is also in the baseline's. Nothing here
added one.

**Two bugs in this workflow's own tests were caught only by running against a real
database**, and both would have shipped as green otherwise: the `orgs` seed omitted the
NOT NULL `slug` column, and the cleanup deleted clients by email — which silently misses
an erased client, because erasure sets the email to NULL.

#### Context this workflow established
### The tables this touches

- `plaid_items` (080) — one row per **bank login**. Holds the encrypted access token.
  `client_id` cascades on client delete.
- `bank_accounts` (081) — the individual accounts behind a login. Cascades from both
  `clients` and `plaid_items`.
- `bank_transactions` (085) — the money ledger. `client_id` is `ON DELETE SET NULL`
  (deliberate: deleting a client must not destroy the evidence money moved).
  `bank_account_id` has **no foreign key** — 085's header records that as a known gap.

### The orphan bug, in one paragraph

Delete a client and two things happen at once. `bank_transactions.client_id` is set to
NULL, and every `bank_accounts` row for that client is cascade-deleted. The transaction
rows keep a `bank_account_id` value, but the account it names no longer exists. So there
is no route from the person to the rows and no route from the rows back to the person.
A later erasure request cannot find them. They are invisible and permanent.

### The fix (migration 101)

`bank_transactions.subject_client_id` — a durable copy of the client id that is
**deliberately not a foreign key**, so nothing cascades or nulls it. Populated by a
BEFORE INSERT/UPDATE trigger so any writer picks it up, including a psql session or a
backfill this repo does not own. Backfilled for existing rows.

### W5 — UnderwriteIQ adapter

*pending*

### W6 — Dashboard

*pending — blocked on W1 and W5*

---

## Findings — written down, not fixed

Things worth fixing that are outside the workflow that found them. Do not drive-by fix
these; they need their own scoped task.

| # | Finding | Found by | Severity |
|---|---|---|---|
| F1 | `api/read/banking-surface.mjs` and `api/read/finance-os.mjs` filter on `client_id` only, with no org scope. Cross-org read of a named client's balances is possible. | W1 | high |
| F2 | `src/banking/store.mjs:69` uses the broken `withTransaction` probe. `saveDetection()` writes bills and evidence with autocommit; a mid-run failure leaves bills with no evidence. | W1 | medium |
| F3 | The org-scope and nav-reachability tests the brief relies on do not exist. Nothing enforces either rule today. | W1 | medium |
| F4 | `src/pii/index.mjs` `revealSsn()` has the same broken transaction probe, so its rule "the access log is written in the same transaction as the reveal" does not hold as shipped. Noted in `soft-pulls.mjs` and still open. | W1 (confirming an existing note) | high — compliance |
| F5 | `bank_transactions.bank_account_id` has NO foreign key, and its column comment claims `bank_accounts` does not exist in this repo — 081 created it. With `client_id ON DELETE SET NULL`, transactions orphan on both axes. **CLOSED by W4** — migration 101 adds the durable `subject_client_id` anchor, and 092 (audit branch) makes the foreign key `ON DELETE SET NULL` so the ledger survives. | W1 | high |
| F7 | `public/app/consent-capture.html` (W2) is finished and has no way in: it is not in shell.js `ALL`, and no screen links to it. app-nav-reachability only enforces reachability for screens in `ALL`, so nothing fails — this is the same "built and unreachable" pattern audit M20 fixed for Finance OS and Banking Surface, found again. Its sidebar was canonicalised on merge so the nav does not change under the reader; where the inbound link belongs is a product decision and was not invented here. | integration merge | medium |
| F6 | A fresh clone has no `node_modules` and `npm test` reports 132 failures that are entirely missing packages. Nothing in the repo says to run `npm install` first, and the failure text does not obviously say "missing dependency". | W1 | low — but it cost real time |

---

## Blockers and open questions

Raised by W4 (banking-compliance-revoke-erasure). Items 1 and 2 are now resolved;
kept with their outcome rather than deleted, because the record of what was missing is
the finding.

1. **`docs/journeys/` is absent.** CLAUDE.md §4 requires every flow to have an intended
   and an actual Mermaid file, and requires `-actual.md` to be updated in the same commit
   as the code. The directory does not exist and neither does `docs/journeys/CHANGELOG.md`.
   Generating an `-actual.md` with no `-intended.md` to read first would invert the rule
   that says read the intended journey before building, so nothing was written. **Someone
   needs to decide whether these journeys are being tracked.**

2. **`docs/compliance/` is absent.** CLAUDE.md §7 says domain rules live there and must be
   read before touching related code. There was nothing to read. The compliance decisions
   in this work are therefore written into the migration headers and the module headers,
   where the next reader will find them.

3. **`src/pii/index.mjs` `revealSsn()` runs with autocommit.** Its `withTransaction` uses
   the `typeof db.connect !== "function"` probe. `src/db.mjs` exports `db` as `{ query }`
   with no `connect()`, so the probe takes the no-transaction branch on the handle every
   production caller passes. Rule 3 in that file's own header — "if the log write fails,
   the reveal fails" — does not hold as shipped. `src/finance/soft-pulls.mjs` already
   recorded this and declined to fix it. **Not fixed here either** — it is a behavioural
   change to a compliance path and deserves its own review. Reported, not touched.

4. **`bank_transactions.bank_account_id` still has no foreign key.** Adding one would
   change what happens when a client is deleted (cascade would destroy the ledger,
   restrict would refuse the delete). That is a decision with a compliance consequence,
   not a schema tidy-up, so it was left alone and the durable anchor was added instead.

**Outcomes since these were written:**

1. `docs/journeys/` and its CHANGELOG now exist and are maintained; `npm run journeys`
   regenerates every `-actual.md` and a test fails if they go stale.
2. `docs/compliance/` is still absent. CLAUDE.md §7 still points at it. Unchanged.
3. `revealSsn()` autocommit — still open. Audit M7 fixed the same broken probe in
   `src/inquiries/work.mjs`, `src/banking/store.mjs` and `src/pii/index.mjs`; confirm
   against the current file before re-reporting.
4. Resolved on merge, and not the way this note expected. The audit branch added the
   foreign key as `ON DELETE CASCADE`, which is the outcome this note warned would
   "destroy the ledger". The owner chose to keep the records, so it is now
   `ON DELETE SET NULL` on `bank_transactions` with the anchor from 101 doing the
   finding. `recurring_bills` keeps CASCADE — a detected bill is derived data.
