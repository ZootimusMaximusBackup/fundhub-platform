# Fundhub Beta Buildout — shared board

Six workflows. Five run at once. One waits. Read this file before you start.
Claim your task before you work it. Write your manifest before you report done.

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
| W1 | Provider seam, mock bank, manual entry, statement cycles, investments | 096–097 | `done` | this session |
| W2 | Consent capture + soft-pull request gate | 099 | `pending` | — |
| W3 | Retention policy + dry-run purge | 100 | `pending` | — |
| W4 | Deletion, erasure, orphan-transaction bug, key rotation, revocation | 101–102 | `pending` | — |
| W5 | UnderwriteIQ vendor + adapter + fixture test | none | `pending` | — |
| W6 | The dashboard screen | none | `blocked` — waits for W1 + W5 | — |

**Migration numbers are pre-allocated. Do not pick one at runtime.** Migrations 090–095
are in flight on `claude/finance-os-audit-w1-w10-7jkl5x` and are NOT in this tree. The
local `db/migrations/` folder ends at 089. That gap is deliberate — do not fill it.

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
| `db/migrations/096_account_statement_cycles.sql` | Statement cycles for accounts NOT from a credit report |
| `db/migrations/097_investment_holdings.sql` | Brokerage positions |
| `src/banking/provider.mjs` | **THE SEAM. Import this, never plaid.mjs or mock.mjs.** |
| `src/banking/mock.mjs` | Deterministic mock provider |
| `src/banking/statement-cycles.mjs` | PURE. The month-end rule lives here and nowhere else |
| `src/banking/accounts.mjs` | The writer for `bank_accounts`, cycles, holdings |
| `src/banking/import.mjs` | Provider → database |
| `api/banking/accounts.mjs` | GET + POST, action discriminator |
| `public/app/banking-entry.html` | The screen — manual entry, mock import, investments editor |
| `src/http/client-scope.mjs` | `requireClientInOrg()` — the org boundary for per-client endpoints |

**Migration 098 is RELEASED.** W1 did not need it. It is unallocated and the next workflow that needs a migration number should take it — 099 through 102 stay with W2/W3/W4 as assigned.

**Changed files** — seven:
- `netlify/functions/api.mjs` — one import, one ROUTES entry (`banking/accounts`)
- `public/app/shell.js` — added `banking-entry.html` to `ALL`
- `public/app/banking-surface.html`, `public/app/finance-os.html` — one nav link each
- `api/read/banking-surface.mjs`, `api/read/finance-os.mjs`, `api/read/tradelines.mjs` — one
  `requireClientInOrg()` call each (the F1 fix). **`src/tradelines/` was NOT touched.**

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

**Verification — now against a REAL Postgres, not only stubs**

- No `DATABASE_URL`: 2643 tests, **0 failures**, 345 skipped.
- With a database, settled over two runs on virgin databases: **26 distinct failures on
  `e67e2db` (base), 27 here.** The one delta, `GET /api/read/inquiries`, fails identically
  on the base commit when run in isolation — pre-existing and order-dependent. **Net new
  failures: zero.**
- Running the pg tests for the first time found **one real bug**: the import's
  `ON CONFLICT` did not repeat the predicate of 081's PARTIAL unique index, so every
  import failed on the first row. A stub could not catch it. Fixed in `eea2939`.
- End-to-end through the running dev server: import wrote 7 accounts / 2 cycles /
  4 holdings / 240 transactions; a full account number sent to the mask field stored as
  `9876`; an empty credit-limit box stored as NULL, not 0; APR `"24.99"` stored as
  `0.24990`; due dates computed server-side.
- Guards proven by reverting: NULL-preservation, `toCents` misuse, the ROUTES entry, and
  the org gate (without it a cross-org session gets **200 and the balance**; with it, 404).

**⚠ `npm install` FIRST.** A fresh clone has no `node_modules`, and `npm test` then
reports **132 failures** that are entirely `Cannot find package 'inngest'`. That is not a
broken suite. Install, then measure.

### W2 — Consent capture

*pending*

### W3 — Retention and purge

*pending*

### W4 — Deletion, erasure, rotation, revocation

*pending*

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
| ~~F1~~ | ~~`api/read/banking-surface.mjs`, `api/read/finance-os.mjs` and `api/read/tradelines.mjs` filter on `client_id` only, with no org scope.~~ **FIXED** in `b3137c4` — `requireClientInOrg()` in `src/http/client-scope.mjs`, applied to all three. Proven by reverting: without it another org's session gets 200 and the balance. `src/tradelines/` untouched. | W1 | ~~high~~ closed |
| F2 | `src/banking/store.mjs:69` uses the broken `withTransaction` probe. `saveDetection()` writes bills and evidence with autocommit; a mid-run failure leaves bills with no evidence. | W1 | medium |
| F3 | The org-scope and nav-reachability tests the brief relies on do not exist. Nothing enforces either rule today. | W1 | medium |
| F4 | `src/pii/index.mjs` `revealSsn()` has the same broken transaction probe, so its rule "the access log is written in the same transaction as the reveal" does not hold as shipped. Noted in `soft-pulls.mjs` and still open. | W1 (confirming an existing note) | high — compliance |
| F5 | `bank_transactions.bank_account_id` has NO foreign key, and its column comment claims `bank_accounts` does not exist in this repo — 081 created it. With `client_id ON DELETE SET NULL`, transactions orphan on both axes. **This is W4's assigned bug; located precisely, not fixed.** | W1 | high |
| F6 | A fresh clone has no `node_modules` and `npm test` reports 132 failures that are entirely missing packages. Nothing in the repo says to run `npm install` first, and the failure text does not obviously say "missing dependency". | W1 | low — but it cost real time |

---

## Blockers and open questions

*none yet*
