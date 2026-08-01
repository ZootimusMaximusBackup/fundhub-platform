# fundhub-beta-buildout — shared board

One line per workflow. Read this before you start; write your manifest here
before you report done. Append your own `## W<n>` heading rather than editing
anyone else's.

## Task list

| # | unit | owner | status |
|---|---|---|---|
| W-MM | Money Map — one owner screen: card due dates, recurring bills, cash flow, utilization, alerts, funding | claude/finance-os-dashboard-311v7j | **done** |
| W-BA | Bank accounts writer — the first writer `bank_accounts` has ever had, plus a mock provider behind the Plaid seam | claude/finance-os-dashboard-311v7j | **done** |
| W-090 | Migration 090 — `recurring_bills.anchor_day_of_month`, the month-end drift fix | claude/finance-os-dashboard-311v7j | **done** |

### Claimed elsewhere — DO NOT DOUBLE-FIX

| what | who has it |
|---|---|
| Org scoping on `api/read/tradelines.mjs` and `api/read/finance-os.mjs` (see finding 9) | the **underwrite thread**. Same defect class, already in hand. This workflow left both files untouched. |
| Generating `-actual.md` journey files | **W2**. `docs/journeys/role-owner-actual.md` here was written before that started and may be superseded by the generated one. Intended journeys are Phase 2 and come from the owner. |

---

## READ THIS FIRST — the board named in the brief did not exist

The brief said: *"Shared board: docs/workflows/fundhub-beta-buildout.md — READ THE
MANIFESTS FROM W1 AND W5 BEFORE YOU START."*

**This file did not exist.** It is being created by this workflow. There were no
W1 or W5 manifests in it to read, because there was no it.

Two other boards DO exist in this repo and they were read in full instead:

* `docs/workflows/finish-the-build.md` — W1–W4. **W1 there is staff telemetry
  writers** (`logStaffEvent()` call sites), not statement cycles.
* `docs/workflows/finance-os-banking.md` — W5–W10. **W5 there is the Plaid link**
  (migrations 080–082: `plaid_items`, `bank_accounts`, `entity_kind`), not an
  UnderwriteIQ adapter.

So three premises in the brief do not match the tree, and each is recorded here
rather than papered over:

| brief says | what is actually in the repo |
|---|---|
| "the statement cycles W1 built" | There is no statement-cycle module and no `statement_cycles` table anywhere. What exists is `card_liabilities` (migration 083) with `statement_date`, `payment_due_date` and `minimum_payment_cents` columns, plus `card_liability_history` (084). **This screen reads 083.** No cycle is computed or predicted — a due date is shown only when the bureau file reported one. |
| "W5's UnderwriteIQ adapter" | There is **no UnderwriteIQ adapter**. The string "UnderwriteIQ" appears in this repo only as a *product name* on sample/demo data and in document-kind registries. The real funding engine is `src/calculators/deal-funding.mjs` (`calcFunding()`), and the real external funding adapters are `src/adapters/lendflow.mjs` and `src/adapters/commas.mjs`, neither of which produces suggestions. **This screen's funding section is produced by `calcFunding()` and says so on the page, by name.** |
| "`listRecurringBillsFor()`" in `src/banking/store.mjs` | The exported function is **`listRecurringBills(db, { orgId, bankAccountId, clientId, presentableOnly })`**. There is no `listRecurringBillsFor`. |

Nothing was invented to close these gaps. Where a named source did not exist,
the nearest real one was used and is labelled with its own module path in the
API response and on the screen.

---

## W-MM — Money Map

**Owner:** `claude/finance-os-dashboard-311v7j`
**Status:** done
**Migrations owned:** none. None were needed and none were written.

### What this is

One screen an owner opens for one client, that answers six questions without
needing another screen:

1. when every card payment is due,
2. what bills repeat, across every account,
3. money in, money out, what is left, over a window,
4. how hard each card is being leaned on, and the portfolio overall,
5. what is coming that somebody should act on,
6. how much could be drawn, and what a draw would cost.

### Files added

| file | what it is |
|---|---|
| `src/finance/money-map.mjs` | PURE assembler. No I/O, no clock, no randomness. Takes already-fetched rows plus an `asOf` and returns the whole screen payload. |
| `src/finance/money-map.test.mjs` | Unit tests for the assembler. No database. |
| `api/read/money-map.mjs` | `GET /api/read/money-map` — the only reader. Org-scoped from the session, fails closed. |
| `src/http/money-map.test.mjs` | Endpoint tests against a stubbed `db`. No `DATABASE_URL`. |
| `src/http/app-nav-reachability.test.mjs` | Did not exist. Created. Fails if a screen in `shell.js`'s `ALL` has no inbound sidebar link, or if a sidebar link points at a file that is not there. |
| `src/http/money-map-screen.test.mjs` | Runs the screen's inline render block in a `vm` sandbox against a stubbed DOM — the same trick `src/http/data-js.test.mjs` already uses. Proves the no-sample-markup rule and the escaping, which are the two things a click test is worst at. |
| `public/app/money-map.html` | The screen. |
| `docs/journeys/role-owner-actual.md` | The flow, traced from code. `docs/journeys/` did not exist. |
| `docs/journeys/CHANGELOG.md` | Created, with today's entries. |

### Files changed

| file | change |
|---|---|
| `netlify/functions/api.mjs` | `"read/money-map"` added to the hardcoded `ROUTES` map. Without this the endpoint 404s locally and deployed. |
| `public/app/shell.js` | `"money-map.html"` added to `ALL` so the role gate does not bounce it. |
| 25 × `public/app/*.html` | One `<a class="navitem" href="money-map.html">` added to the Finance group of each sidebar. |

### Exports added — `src/finance/money-map.mjs`

* `moneyMap(input)` — the assembler.
* `ENGINES` — the frozen id → human label map. This is what lets the screen say
  WHICH engine produced WHICH line.
* `billRowToDetected(row)` — a `recurring_bills` row → the camelCase shape
  `src/banking/cashflow-seam.mjs` expects. Written here because
  `toBillRow()` in `src/banking/recurring.mjs` is camel→snake and no reverse
  existed. It is the only new mapper in this unit.
* `DEPOSITORY` — the account-type predicate. Exported so a test can assert it,
  not so a caller can redefine it.

### Reused, not rebuilt

Nothing in this unit re-implements a rule that already had a home:

| rule | owner module |
|---|---|
| totals over data with holes are floors | `sumKnown` / `basisOf` in `src/finance/os-grid.mjs` |
| unknown entity kind is never personal, no combined cash total | `bankingSurface()` in `src/finance/banking-surface.mjs` |
| the seven credit numbers | `financeOsGrid()` in `src/finance/os-grid.mjs` |
| utilization against a threshold | `evaluateUtilization()` in `src/alerts/evaluate.mjs` |
| day-by-day cash projection | `project()` in `src/banking/cashflow.mjs` |
| a detected bill → dated occurrences | `toCashflowBills()` in `src/banking/cashflow-seam.mjs` |
| funding waterfall, pay-method comparison, guardrail | `calcFunding()` in `src/calculators/deal-funding.mjs` |
| tradeline rows → calculator cards | `toCalculatorCards()` in `src/tradelines/index.mjs` |
| a bureau date → `YYYY-MM-DD` or null | `readDate()` in `src/liabilities/index.mjs` |
| cents → a 2dp display string | `fromCents()` in `src/commissions/money.mjs` |

### Decisions made (recorded, not asked)

1. **The cash-flow projection pools depository accounts and says so, loudly.**
   `banking-surface.mjs` refuses to produce one combined cash total across
   personal / business / unclassified, and that refusal is kept: the grouped
   balances on this screen still have no combined figure. But a cash-flow
   projection is not a balance — it is "what happens to the money that is
   actually there", and running three separate projections would split the
   bills (which carry a `bank_account_id`) from the card minimums (which are
   client-level and belong to no account). So ONE projection runs, over open
   **depository** accounts only, and the payload carries `entity_census` and
   `mixes_entity_kinds`. When it mixes, the screen prints: *"this pools money
   across personal / business / unclassified — it is not the client's personal
   cash."* Unknown is never folded into personal; it is named.

2. **A credit line's "available" is never counted as cash.** `DEPOSITORY` admits
   `account_type === 'depository'` and nothing else. A NULL `account_type` is
   excluded and COUNTED, because 081's own comment says a default of
   'depository' "would quietly turn an unclassified line of credit into cash on
   hand".

3. **Date columns are cast to `text` in SQL.** `payment_due_date::text` etc.
   node-postgres turns a `date` into a Date at LOCAL midnight; `readDate()` then
   reads it back with `toISOString()`, which is UTC. In any timezone east of UTC
   that is an off-by-one on a payment due date. Casting in SQL removes the
   class of bug rather than working around it.

4. **`calcFunding()`'s headroom is reported with a caveat, not silently.**
   `toCalculatorCards()` maps an unknown balance to `0`, so `calcFunding` reads a
   card with a known limit and an unknown balance as fully available. That
   OVERSTATES what can be drawn. The payload counts those cards in
   `funding.caveats` and the screen prints the count. The conservative figure —
   `financeOsGrid()`'s "Available credit" row, which is null when either side is
   unknown — is shown next to it.

5. **No sample markup on the screen.** Every other wired screen in this repo
   keeps built-in sample rows when a read fails, by `FHData.wire()`'s contract.
   This screen does not: it renders nothing until real rows arrive, and an empty
   or failed read prints a plain-English sentence saying which read returned
   nothing. `FHData.read()` is still used, for the 401/403/404/503
   classification; `FHData.wire()` is not.

6. **`anchor_day_of_month` is not stored anywhere.** `expectedOccurrences()`
   falls back to the day-of-month of `next_expected_on`. A bill charged on the
   31st whose stored next date was clamped to the 30th stays pinned to the 30th
   across the window. Reported below, not fixed here — fixing it is a migration
   and this unit owns none.

### Routes affected

`GET /api/read/money-map?client_id=<uuid>[&days=<1..365>][&amount=<dollars>]`
Gate: `requireAuth` then `requireRole(ROLE_SETS.STAFF)` — two calls, because
`requireAuth`'s third argument is `{ db, env }` and a `roles` key there is
silently dropped. Then org scoping: the client must belong to `staff.org_id`,
checked by a `SELECT ... WHERE id = $1 AND org_id = $2`, and a session with no
`org_id` is refused outright. **Fails closed.**

### Journeys impacted

`docs/journeys/` did not exist. Created, with `role-owner-actual.md` generated
from the code. **There is no `role-owner-intended.md`** — no intended journey
exists for any of the eight tracked journeys, so there was nothing to check this
flow against. That absence is a finding, not something this unit filled in:
CLAUDE.md §4 says intended journeys are hand-authored and agents do not write
them.

### Schema added

None. This unit owns no migrations and wrote none.

### Verification actually run

| what | result |
|---|---|
| `src/finance/money-map.test.mjs` | 37 pass, 0 fail |
| `src/http/money-map.test.mjs` | 26 pass, 0 fail |
| `src/http/money-map-screen.test.mjs` | 23 pass, 0 fail |
| `src/http/app-nav-reachability.test.mjs` | 8 pass, 0 fail |
| `npm test` (whole suite, `DATABASE_URL` unset) | **2302 pass, 0 fail, 321 skipped** — up from 2213 pass / 0 fail / 321 skipped before this unit |
| `npm run diagrams:check` | up to date, 12 files |
| `src/http/routes.test.mjs` | still green — the new handler is routed, not on the unrouted allow-list |

The 321 skips are the `.pg.test.mjs` suites, which need `DATABASE_URL`.
CLAUDE.md §12 says so, and it says the suite is not as green as it looks against
a real Postgres. **This unit was NOT verified against Postgres**, because
`DATABASE_URL` is not set in this environment and `api.netlify.com` /
`api.supabase.com` are blocked by the network policy, so it could not be
fetched. Every new test here is deliberately database-free for that reason.

**Not run, because they do not exist in this repository:** there is no `lint`
script, no TypeScript, and no Playwright. CLAUDE.md §6 lists all three as gates.
They cannot pass and are not claimed.

---

## W-BA — the bank accounts writer, and migrations 090 + 091

**Owner:** `claude/finance-os-dashboard-311v7j`
**Status:** done
**Migrations owned:** 090, 091. Both authorised by the owner after W-MM reported
the gaps. **Neither has been applied** — see Verification.

### Why this exists

W-MM's finding 8: four of the five tables the Money Map reads had no writer.
`bank_accounts` was the worst of them — it had no store module at all, and the
only `INSERT INTO bank_accounts` in the repository was inside
`src/banking/plaid.pg.test.mjs`. Three sections of the screen depend on it.

`src/banking/plaid.mjs`'s `getAccounts()` names "a separate store module" that
was never written. This is that module.

### Files added

| file | what it is |
|---|---|
| `db/migrations/090_recurring_bill_anchor_dom.sql` | `recurring_bills.anchor_day_of_month`. Closes the month-end drift. |
| `db/migrations/091_bank_account_provider.sql` | `bank_accounts.provider` + `provider_account_id` + a non-Plaid unique index. |
| `src/banking/accounts-store.mjs` | The writer. Database half only — no provider, no clock, no fetch. |
| `src/banking/accounts-store.test.mjs` | 27 tests, stubbed db. |
| `src/banking/providers/mock.mjs` | A stand-in provider matching the Plaid seam's exact shape. |
| `src/banking/accounts-sync.mjs` | Provider → store. Closed registry, no default provider. |
| `src/banking/accounts-sync.test.mjs` | 18 tests, no db and no network. |
| `api/banking/sync-accounts.mjs` | `POST /api/banking/sync-accounts`. |
| `src/http/sync-accounts.test.mjs` | 26 tests, stubbed db and auth. |

### Files changed

| file | change |
|---|---|
| `netlify/functions/api.mjs` | `"banking/sync-accounts"` added to `ROUTES`. |
| `src/banking/recurring.mjs` | `toBillRow()` now carries `anchor_day_of_month`. One line plus its comment; nothing else in that file was touched. |
| `src/banking/recurring.test.mjs` | The exact-columns assertion updated for 090, plus two new tests for the drift. |
| `src/finance/money-map.mjs` | Reads the stored anchor day; takes the org's `thresholds`; counts and names mock accounts. |
| `api/read/money-map.mjs` | Loads `cashflow_settings` through `loadThresholds()`; selects `provider` and `anchor_day_of_month`. |
| `public/app/money-map.html` | Prints a NOT REAL MONEY banner above everything when any account is a mock. |

### THE SEAM IS STILL OPEN. NOTHING TRANSMITS.

`linkAccount()` in `src/banking/plaid.mjs` is untouched. Its header says an agent
must not close it and names three gates that are not code — a SOC 2 review of
storing bank credentials, a compliance-signed consent flow, and a human
decision. The owner's decision covers the third; the other two are not theirs to
wave and are not waved here.

The `plaid` provider in the registry calls the existing `getAccounts()` seam and
carries its refusal out unchanged. **The mock path reads a fixture in this
repository.** There is no outbound `fetch` in anything this unit added.

### Why a `provider` column, and why it is the whole safety argument

The mock writes into the same table a real bank read would, and 081's scheme
gave it no way to be told apart: a mock row has a NULL `plaid_item_id` for the
same reason a hand-typed one does.

A made-up balance a screen cannot distinguish from a bank read, on a funding
screen, is the worst thing that could exist in this repository. So:

* `provider` is NOT NULL with a CHECK — a row cannot lose it;
* a CHECK ties `plaid_item_id` to `provider = 'plaid'` in both directions;
* `uq_bank_accounts_provider_ref` keys on it, so a mock and a real account can
  never collide into one row;
* the read endpoint returns it and **the screen prints a red banner above every
  figure it affects.**

### Two switches, and neither is a typo

The mock cannot run by accident:

1. `provider` is a **required** parameter on the endpoint. No default, because a
   default is how a mock ends up in production. An unknown name is a 400.
2. `BANKING_MOCK_PROVIDER` must be the exact string `"1"`. Not `true`, not
   `yes`, not "any non-empty value" — `isMockEnabled()` tests for `=== "1"` and
   there is a test asserting each of those spellings is refused.

### Gated harder than the reads next door

`ROLE_SETS.FINANCE` — `{owner, admin}` — not `ROLE_SETS.STAFF`. The read
endpoints serve six roles because a closer working a file needs to see it. This
one CREATES the rows those screens total. Reading a balance and conjuring one
are different powers.

Org scoping from the session, fails closed, identical to `read/money-map`.

### Nothing is deleted, ever

An account that stops appearing in a provider's list is reported in `vanished`
and left exactly as it was. An absence from one read is not evidence an account
was closed — marking `closed_at` on it would be a claim about a real person's
finances derived from a missing row. A test asserts no `DELETE` is issued.

### A bug W-MM shipped, found while doing this and fixed

`src/finance/money-map.mjs` passed cashflow-seam's `PRESENTABLE_CONFIDENCE_FLOOR`
(0.55) as `project()`'s `thresholds.confidenceFloor`. Migration 089 spells out
at length that those are two different questions: 0.55 asks *"safe to SHOW a
person as a bill"*, and `cashflow_settings.confidence_floor` (089 set it to
0.750) asks *"certain enough to treat as MONEY DEFINITELY LEAVING"*.

Using the lower number put every `medium` bill in the committed track and
overstated what is going out. The endpoint now reads the org's own value through
`loadThresholds()`, and an org with no row gets its gap reported instead of a
number nobody chose. Two tests pin the difference.

### Decisions made (recorded, not asked)

1. **The mock fixture is shaped to prove the screen tells the truth, not to make
   it look full.** It deliberately includes a credit line with $9,000 of
   headroom (which must NOT be counted as cash) and a depository account the
   bank reported with no balance (which must refuse the whole projection with a
   stated reason). A fixture of four tidy chequing accounts would exercise none
   of the rules that matter.
2. **No backfill on 090.** The true anchor cannot be recovered from a clamped
   date — that is the guess the migration exists to stop. Old rows keep the
   behaviour they already had and correct themselves the next time the detector
   runs.
3. **`provider_account_id` rather than reusing `plaid_account_id`.** Storing a
   mock id in a column named after one vendor is how a schema stops meaning what
   it says. `plaid_account_id` and 081's own unique index are untouched.

### Verification actually run

| what | result |
|---|---|
| `src/banking/accounts-store.test.mjs` | 27 pass, 0 fail |
| `src/banking/accounts-sync.test.mjs` | 18 pass, 0 fail |
| `src/http/sync-accounts.test.mjs` | 26 pass, 0 fail |
| `src/finance/money-map.test.mjs` | 43 pass (was 37) |
| `npm test` (whole suite, `DATABASE_URL` unset) | **2383 pass, 0 fail, 321 skipped** |

**MIGRATIONS 090 AND 091 HAVE NOT BEEN APPLIED.** CLAUDE.md §11 says applying
new SQL is mine to do without asking — but the command needs `netlify env:get`,
and `api.netlify.com` is blocked by the network policy in this environment (403
at CONNECT, an org policy denial). Same for `BANKING_MOCK_PROVIDER`, which is a
plain feature flag and not a credential. Both are in the owner's hands and the
exact commands are in the task report.

Until 090 and 091 are applied, `read/money-map` will error on the missing
columns. **Apply the migrations before opening the screen again.**

### FINDINGS — reported, not filled in

1. **`docs/workflows/fundhub-beta-buildout.md` did not exist**, and neither did
   the W1/W5 manifests the brief said to read. See the top of this file.
2. **There is no UnderwriteIQ adapter.** Funding suggestions come from
   `calcFunding()` and the screen names it.
3. **There is no statement-cycle module.** Due dates come from
   `card_liabilities.payment_due_date` and are blank when the file did not
   report one.
4. **`src/http/app-nav-reachability.test.mjs` did not exist.** The brief said it
   fails if a screen has no way in. It was not there. It is now.
5. **Journeys are owned elsewhere.** W2 is generating `-actual.md` files and
   intended journeys come from the owner in Phase 2. Noted here so nobody
   re-raises it; `docs/journeys/role-owner-actual.md` in this branch predates
   W2 and may be superseded by the generated one.
6. **`calcFunding()` reads an unknown card balance as zero**, overstating
   headroom. Surfaced as a caveat; not fixed, because changing
   `toCalculatorCards()` would move a number the closer dashboard already says
   out loud, and that is not this unit's call.
7. ~~**`recurring_bills` has no `anchor_day_of_month` column**, so month-end
   bills drift.~~ **FIXED** by migration 090 — see W-BA above. Authorised by the
   owner after this was reported.
8. **FOUR OF THE FIVE TABLES THIS SCREEN READS HAVE NO LIVE WRITER.** Traced by
   following imports, not assumed. This is the single most important thing on
   this board, because it decides what the screen actually shows on day one:

   | table | writer module | is anything calling it? |
   |---|---|---|
   | `tradelines` | `src/tradelines/store.mjs` `ingestCrsResult()` | **YES** — `src/finance/soft-pulls.mjs`, reached by the routed `POST /api/finance/soft-pull`. |
   | `card_liabilities` | `src/liabilities/store.mjs` `ingestCrsLiabilities()` | **NO.** Nothing in `src/` or `api/` imports that module. |
   | `recurring_bills` | `src/banking/store.mjs` `saveDetection()` | **NO.** Nothing imports it. |
   | `bank_accounts` | ~~none~~ **`src/banking/accounts-store.mjs` — WRITTEN, see W-BA above** | **YES, now** — `POST /api/banking/sync-accounts`. Was: no store module at all, the only INSERT was in a pg test. |
   | `cashflow_reminders` | `src/banking/reminders.mjs` `createReminder()` | **NO.** Nothing imports it, and nothing calls `recordReminders()` either. |

   Consequence, stated plainly: after a soft pull this screen shows real cards,
   real utilization from all three engines, and a real funding plan. Payment due
   dates, repeating bills, cash flow and bank balances will be **empty and will
   say so on the page** until somebody wires the four missing writers. The
   screen was built to state that rather than to look full.

   Wiring those writers is four separate units of work and none of them is this
   one. They are named here so the next workflow can claim them.

9. **`api/read/finance-os.mjs` and `api/read/banking-surface.mjs` do not
   org-scope their queries.** They gate on a valid staff session and a
   `client_id`, and then read that client's rows without checking the client is
   in the caller's org. Both new endpoints in this branch do check.
   **CLAIMED BY THE UNDERWRITE THREAD** — same defect class as
   `read/tradelines`. Left untouched here on purpose. Do not double-fix.
