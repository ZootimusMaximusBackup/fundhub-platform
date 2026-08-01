# Finance OS Audit — W1 through W10

**Batch:** `finance-os-audit-2026-07-31`
**Branch:** `claude/finance-os-audit-w1-w10-7jkl5x`
**Head at audit time:** `d6a5f94`
**Date:** 2026-07-31

This file is the shared board for the audit. It is written for a reader who does not
read code. Every claim carries an exact `file:line` so an engineer can go straight to it.

---

## The one-paragraph version

The eleven commits that make up the Finance OS (W1–W10) broke nothing that used to
work. That is confirmed, not assumed — see the regression verdict below. But the work
is a **library, not a working product**: five of the ten workflows built code that no
screen and no web address can reach. Of the things that *are* switched on, one is a
serious security hole (any signed-in employee can read any other company's client
records), two proven bugs charge a client twice for one credit check, and the Banking
Surface screen shows made-up dollar figures to staff. There are also ten open
compliance items, four of them already flagged by the authors and merged anyway.

**Totals: 1 critical · 21 major · 18 minor · 10 compliance.**

---

## Track status

All tracks are complete. Nothing is blocked.

| # | Track | Owner | Scope | Status |
|---|-------|-------|-------|--------|
| 0 | Priority Zero — regression verdict | Agent C | Settle whether W1–W10 broke the test suite | **done** |
| G | Grounding brief | Ground agent | One read of the shared context, file map, known issues | **done** |
| 1 | Schema + data integrity / operational readiness | D1+D10 | Migrations 075–089, keys, indexes, health, deploy | **done** |
| 2 | Business logic / performance | D2+D6 | Money maths, query shapes, N+1 | **done** |
| 3 | Security / auth | D3+D4 | Tenancy, role gates, secrets, PII | **done** |
| 4 | Testing / reliability | D5+D7 | Coverage, concurrency, transactions | **done** |
| 5 | Compliance / seams and dead code | D8+D11 | FCRA, SOC 2, LL144, retention, stubs | **done** |
| 6 | UI/UX / spec consistency | D9+D12 | The two new screens, navigation, error states | **done** |

---

## Priority Zero — the regression verdict

**Verdict: no regressions. Zero new failures, zero fixed.**

Two agents disagreed. The disagreement is settled and the cause is understood.

- The baseline commit `4830465` and `origin/main` `d6a5f94` each fail **exactly 24
  tests**, and the two lists of failing test names are **identical, name for name**.
- Verified with **four full runs per tree** against two separate real Postgres
  databases (not two runs — main was unstable on the first pair, so runs 3 and 4 were
  added).
- Main also **adds 695 passing tests** (2342 → 3037; 128 suites vs 83). The eleven
  commits added real coverage and broke nothing.

**Why the other agent saw "13 regressions."** It was a counting mistake, not a
different result. Node's test output nests: when a child test fails, its parent group
prints its own failure line for the same problem, and when a whole group is cancelled
every child prints a line too. Counting raw `not ok` lines therefore double- and
triple-counts. The arithmetic matches exactly:

- baseline: 24 real + 4 parent roll-up lines = 28
- main: 24 real + 12 cancelled children + 5 roll-up lines = 41
- "13 regressions" is just 41 − 28. No test name is actually main-only.

**Flaky, in both trees, not a regression.** One root cause, one error string:
`sessions_staff_id_fkey` violation. Test files run at the same time against one shared
database; a suite that deletes staff rows pulls the rug out from under a suite building
a login at that moment. It hit `src/http/conversations-read.pg.test.mjs` (16 tests) on
one run and `src/http/campaign-endpoints.pg.test.mjs` (suite + 12 cancelled children)
on another. `git diff 4830465 origin/main` shows those files are **unchanged** between
the two commits, so they cannot be a regression from these commits.

**Correction to CLAUDE.md §12.** The trap note predicts ~29 failures on a fresh
database dropping to ~24, blamed on five order-dependent `inquiries` suites. The
24-vs-29 shape is right; the blame is stale. Zero `inquiries` tests failed in any of
the eight runs. The extra failures on a cold run now come from the sessions/staff
foreign-key race described above. Worth fixing in the docs.

**Left running for later tracks.** Postgres is up on `127.0.0.1:5432`.
`fundhub_main` (66 migrations, 6 staff) at
`postgres://postgres:postgres@127.0.0.1:5432/fundhub_main`, worktree at
`/tmp/audit-main-tree`. `fundhub_baseline` and `/tmp/audit-baseline-tree` are also up.
Caveat: this Postgres does not survive a container restart — re-run
`pg_ctlcluster 16 main start` if the connection is refused.

---

## Grounding brief

### What is where

**Schema.** `db/migrate.mjs` runs `schema`, then `migrations`, then `seed`, recording
each file in `schema_migrations` keyed `<dir>/<file>`. The Finance OS block is
migrations **075–089**, all fifteen present, no gaps, no duplicate numbers.

| File | W | What it is |
|------|---|-----------|
| `075_subscriptions.sql` | W2 | What a client is on, cost, paying instrument, versioned |
| `076_client_cards.sql` | W2 | Payment instrument on file — a token reference only |
| `077_soft_pull_requests.sql` | W3 | Ledger: why credit was pulled, who asked, what it cost |
| `078_alerts.sql` | W4 | Raised-alert record. **No store layer** |
| `079_upsell_triggers.sql` | W4 | Rule config. Ships zero rows, `enabled=false`. **No store layer** |
| `080_plaid_items.sql` | W5 | One row per connected bank login; encrypted token + consent |
| `081_bank_accounts.sql` | W5 | Accounts behind a login |
| `082_bank_account_entity_kind.sql` | W5 | Whose money: unknown / personal / business |
| `083_card_liabilities.sql` | W6 | Current position on a card |
| `084_card_liability_history.sql` | W6 | Full observed series behind 083 |
| `085_bank_transactions.sql` | W7 | Bank ledger; negative means money out |
| `086_recurring_bills.sql` | W7 | Detected bills + evidence join. **No anchor-day column** |
| `087_cashflow_reminders.sql` | W8 | What to say, when, whether seen. **Has** a store |
| `088_cashflow_settings.sql` | W8 | The three cash-flow thresholds |
| `089_cashflow_confidence_floor.sql` | W8 | Supersedes 088's placeholder — correctly a new file |

**Code.**
`src/banking/` — `plaid.mjs`, `recurring.mjs`, `store.mjs`, `cashflow.mjs`,
`cashflow-seam.mjs`, `reminders.mjs`, `settings.mjs`.
`src/finance/` — `banking-surface.mjs` (W10), `os-grid.mjs` (W9), `soft-pulls.mjs` (W3).
`src/liabilities/store.mjs` (W6), `src/subscriptions/store.mjs` (W2),
`src/alerts/evaluate.mjs` (W4), `src/shifts/timesheet.mjs` (W1).
Money is integer cents via `src/commissions/money.mjs`; `fromCents` returns a string;
`percentOf` takes percent units.

**Routing.** `netlify/functions/api.mjs` holds a hard-coded `ROUTES` map at line 87. A
handler that is not in it returns 404 whether or not the file exists.

**Screens.** `public/app/` — 28 HTML screens including the two new ones,
`finance-os.html` and `banking-surface.html`. `public/app/shell.js` is the CRM shell,
`public/app/data.js` the front-end data layer.

### Two directories CLAUDE.md points at that do not exist

- **`docs/journeys/` does not exist.** None of the eight tracked journeys (`client`,
  `role-owner`, `role-sales-manager`, `role-closer`, `role-funding-advisor`,
  `role-inquiry-remover`, `affiliate`, `white-label`) has an `-intended.md` or an
  `-actual.md`, and there is no `CHANGELOG.md`. The only "journey" file in the tree is
  `scripts/demo-journey.mjs`, which is unrelated.
- **`docs/compliance/` does not exist.** CLAUDE.md §7 instructs agents to read domain
  rules there before touching flagged code. There is no such directory. Compliance
  material lives in code (`src/compliance/`) and inside workflow docs instead.

Both absences are reported, not filled in.

### Pull requests and CI

Open PRs: **zero**. Everything W1–W10 is merged onto this branch. Merge order is not PR
number order — #54 landed before #52, #51, #44, #42, #53, #55, #58.

The branch is **10 commits ahead of main and 0 behind** — the whole Finance OS body of
work has not reached `main`, and `main` is what deploys to production.

**There is no CI.** No `.github/` directory at all — no workflows, no status checks.
Nothing runs tests on push. And three of the six gates in CLAUDE.md §6 cannot run in
this repo at all: `package.json` has no `lint` script, there is no TypeScript so no
`tsc`, and there is no Playwright config or `.spec` file anywhere. This is a standing
repo gap, not something this branch introduced.

`api.netlify.com` and `api.supabase.com` are blocked by network policy (403 at
CONNECT). No track routed around it. That means **nobody could check which migrations
are applied to the production database**, and 089 is the newest and most likely to be
missing.

### The three issues the brief flagged, and how they resolved

| Flag | Verdict |
|---|---|
| (a) W4 evaluators have no store and no caller | **Confirmed.** See M13. |
| (b) Recurring bills lose the anchor day; store/seam field mismatch | **Confirmed, twice.** See M11 and M12. |
| (c) PR #37 wage-inference policy and `shiftSeconds()` throwing | **Confirmed.** See M14 and K8. |

---

## Bucket 1 — CRITICAL

One item.

### C1 · Any signed-in employee can read every other company's clients, credit and bank data

`src/tradelines/store.mjs:84` (and eleven more read endpoints)

**Plain English.** Every table in this system records which company owns each row. The
company is known on every request. **Not one staff-facing read endpoint uses it.** With
only one company in the database this is harmless. The moment a second company exists —
which is what the white-label plan is — any employee of company A can read company B's
consumer credit files and bank balances.

**The chain, concretely.** A `setter` in company A calls `GET /api/read/documents` with
no client id. The query has no company filter, so it returns document rows for every
company, each carrying a `client_id`. They take any of those ids and call
`GET /api/read/tradelines?client_id=<that id>` — passes the role check, hits
`WHERE client_id = $1` with no company check, and returns that consumer's credit limits,
balances and APRs. Repeat against `/api/read/banking-surface` for bank balances and
`/api/read/finance-os` for the credit grid. The id does not need guessing; the unfiltered
list endpoints hand it over.

**Confirmed unfiltered:** `src/tradelines/store.mjs:84`,
`api/read/banking-surface.mjs:71`, `api/read/staff.mjs:18`, `api/read/invoices.mjs:18`,
`api/read/documents.mjs:23`, `api/read/funding-rounds.mjs:16`,
`api/read/inquiries.mjs:27`, `api/read/commissions.mjs:19`,
`api/read/message-templates.mjs:16`, `api/read/failed-events.mjs:18`,
`api/read/entitlements.mjs:33`, `api/read/conversations.mjs:52`.

**Why it is latent today.** `db/schema/001_init.sql:36` seeds exactly one company.
`api/read/conversations.mjs:41-44` even says so in a comment. **Adding a second company
is a data change, not a code change — nothing in this repo will fail when it happens.**

**Note.** The partner-facing surface *does* enforce this properly, using database-level
row security (`src/partners/rls.mjs`). The company boundary simply never got the same
treatment. `src/http/read-api.mjs:150-153` records the decision to leave scoping to each
endpoint's own SQL; no endpoint then wrote the filter.

**Fix.** Thread the session's company id through and make it a required argument that
throws when missing, so the next endpoint cannot silently omit it.

---

## Bucket 2 — MAJOR

21 items, grouped by theme.

### Security and access

**M1 · The whole client book, including phone numbers and message bodies, is open to
every staff role — including external white-label partners.**
`api/dashboard/clients.mjs:37`, `api/dashboard/client.mjs:24-60`
Neither handler calls a role check at all — only "are you signed in". A staff row with
`role='partner'` (which `db/migrations/036_partner_role.sql` exists to enable) can call
`GET /api/dashboard/clients` and get every client's name, email, phone and funded
amount, then `GET /api/dashboard/client?id=…` for full detail. The tighter role set
that would stop this already exists in this codebase — `ROLE_SETS.STAFF`
(`src/http/read-api.mjs:100`) deliberately excludes `partner` — this endpoint just does
not call it.

**M2 · The dashboard master key is accepted from the web address.**
`src/http/dashboard-auth.mjs:27`
The shared secret that unlocks the full client book can be passed as `?key=…`. The same
codebase forbids exactly this for session tokens, in writing, at
`src/http/middleware/requireAuth.mjs:22-23` — "query strings … land in access logs, and
this token is a live credential". The dashboard secret is *worse*: it never expires, is
not tied to a person, and cannot be revoked for one user. `public/dashboard.html:249`
documents putting it in a URL by design. It ends up in browser history, bookmarks, and
the Referer header sent to every third-party resource the page loads.

**M3 · Three endpoints always serve the default company, whoever is asking.**
`api/read/products.mjs:19`, `api/read/agents.mjs:20`, `api/read/affiliates.mjs:18`
These *do* filter by company — on a hard-coded lookup of the default company, not the
caller's. Once a second company exists, its staff see company A's affiliate roster and
none of their own. It gets reported as "my list is empty", which is not the symptom that
matters.

**M4 · An employee can order a credit check on another company's client, and it is
filed under the wrong company.**
`api/finance/soft-pull.mjs:136`
The function's own comment says a staff member "may act on any client in their org".
The code says `if (principal.kind === "staff") return true;` — it never compares
companies. Worse, the write path stamps the *caller's* company onto the row
(lines 91-93). So a pull on company B's consumer is recorded in company A's ledger, and
company B has no record of it at all. This ledger exists to be the compliance evidence
of who asked for whose credit file.

### Money and correctness

**M5 · Two taps on "pull credit" create two ledger rows and two charges. Proven.**
`src/finance/soft-pulls.mjs:212`
The guard reads "is a pull already open?" then writes — two separate steps with a gap
between them. Three simultaneous calls were run against real Postgres: **all three
succeeded, three rows landed, cost totalled 4500 cents instead of 1500.** In production
this is a client double-tapping, or a phone retrying a timed-out request. Each row is a
recorded consumer-credit event on a compliance-flagged ledger.
`/api/finance/soft-pull` is live (`netlify/functions/api.mjs:187`).

**M6 · The feature designed to make retries safe turns a retry into a server error.
Proven.**
`src/finance/soft-pulls.mjs:200`
Same read-then-write gap, but here the database *does* have a uniqueness rule
(`uq_soft_pull_requests_idem`), so the second write raises a raw Postgres error. Nothing
catches it — code 23505 is not in `CLIENT_DATA_ERRORS` (`src/http/read-api.mjs:45-50`),
so `netlify/functions/api.mjs:334` turns it into HTTP 500. **Twelve out of twelve
concurrent runs produced the error.** The user whose phone retried sees a red server
error, which is the exact opposite of what an idempotency key is for. The existing test
(`src/finance/soft-pulls.pg.test.mjs:368`) replays the key *after* the first call
finishes, so it never reaches this branch.

**M7 · The "all-or-nothing" protection around three critical writes does nothing in
production.**
`src/inquiries/work.mjs:214`, `src/banking/store.mjs:70`
Both files start with `if (typeof db.connect !== "function") return fn(db)`. The
database handle every production caller passes (`src/db.mjs:32`) is `{ query }` and has
no `connect`. So the check is **always** true and the writes run unprotected, each on a
possibly different connection.
*Consequence 1 (live):* `/api/inquiries` is routed. A dispute-attempt row can be written
while the counter on the parent record fails to update. The screen then shows two
attempts while the audit table holds three, on a consumer's credit-dispute record, and
nothing repairs it. The file's own header at lines 66-70 promises the opposite.
*Consequence 2 (latent):* `saveDetection` deletes a bill's supporting charges and then
inserts the new ones as two separate steps. If the insert fails, the bill survives
claiming a monthly charge with nothing behind it — which its own docblock at lines
165-171 calls "worse than not writing it at all".
A working version of this helper already exists in this repo at
`src/finance/soft-pulls.mjs:484-489`. There are four copies of the broken one.

**M8 · Banking Surface is live, has no data source, and fills the gap with invented
dollar figures.**
`api/read/banking-surface.mjs:71`, `public/app/banking-surface.html:183`
Nothing anywhere writes to `bank_accounts` — grep across `src/`, `api/`, `netlify/` and
`scripts/` finds zero inserts outside tests, and the only thing that would produce rows
(`src/banking/plaid.mjs` `getAccounts()`) returns `not_implemented`. So every real client
returns zero accounts. The screen then does `if (!shown.length) return null;` **before**
writing to the page, which leaves the hard-coded sample block at lines 84-92 on screen:
**"Personal 2,400.00" and "Unclassified 9,000.00"**. A funding advisor opens the screen
for a named client and reads dollar amounts that client does not have. The only
contradiction is an 11-pixel banner at the bottom of the window. The sibling screen does
not have this bug, because `src/finance/os-grid.mjs:171` always returns seven rows.

**M9 · Banking Surface is switched on for every staff role although bank connections
were never approved.**
`api/read/banking-surface.mjs:58`, `public/app/shell.js:24`
`src/banking/plaid.mjs` exports a readiness check (`isPlaidEnabled`, `REQUIRED_ENV` at
line 60). **Nothing in production calls it — zero hits across `api/` and `src/`.** The
endpoint gates on "is staff" and queries the table directly. When bank linking is
eventually switched on for one test client, this screen silently starts serving real
balances to every staff role, with no second approval step, because the only gate that
ever existed was the generic staff check. W5's SOC 2 sign-off
(`docs/workflows/finish-the-build/W5.md:283`) is still open.

**M10 · Banking Surface adds credit-card headroom and card debt into the same total as
cash in the bank.**
`src/finance/banking-surface.mjs:144`, `:145`, `:114`
The totals sum every open account with no filter on account type.
`db/migrations/081_bank_accounts.sql:85-87` says the two balance columns mean *different
things* for a card than for a checking account — "spendable now" versus "remaining
headroom" — and line 71 warns in its own comment that treating a credit line as cash is
the mistake to avoid. A client with $2,000 in checking and a Visa with $9,000 owed on a
$10,000 limit is reported as **$11,000**. The same $1,000 of headroom is *also* counted
in the Finance OS credit grid, so one dollar is reported twice on two live screens. The
overdrawn flag inverts for the same reason: a maxed card reads "not overdrawn" and an
overpaid card reads "overdrawn".

**M16 · A client who cancels can never sign up again.**
`db/migrations/075_subscriptions.sql:237`, `src/subscriptions/store.mjs:281`
Cancelling defaults the end date to empty, so the cancelled row's date range stays open
forever. The database rule that stops two overlapping subscriptions looks only at dates,
not at status, so the cancelled row blocks every future one. Reproduced on the live
database: the second signup fails with a raw Postgres constraint name. Nothing catches
it — no handler for that error code exists anywhere in `src/`, `api/` or `netlify/`.
The client sees a database error, and the only recovery is a second cancel call carrying
an explicit end date.

**M17 · Bank transactions and detected bills point at bank accounts with no link
enforced, and the stated reason for that is not true. Proven.**
`db/migrations/085_bank_transactions.sql:181`, `086_recurring_bills.sql:208`
Both columns are declared "required" but with no reference to the accounts table. The
justification at 085:99-124 says the accounts table "DOES NOT EXIST IN THIS REPOSITORY
TODAY" — but `db/migrations/081_bank_accounts.sql:34` creates it and sorts *earlier*.
Reproduced on the live database: delete a bank login (what happens when a client revokes
consent), the accounts vanish, and the transaction and bill rows survive pointing at
nothing. A completely made-up account id is also accepted with no error. The bills
listing filters only on company, so the cash-flow projector would price payments against
an account the client disconnected.

### Things that were built but cannot be reached

**M11 · Bills saved to the database cannot be read back by the thing that consumes
them, and no test crosses that line.**
`src/banking/store.mjs:232`, `src/banking/cashflow-seam.mjs:141`,
`src/banking/cashflow-seam.test.mjs:66`
The store returns raw database rows in `snake_case`. The consumer reads `camelCase`. It
is worse than casing — one field is **renamed**: the column is `next_expected_on`, the
code wants `nextExpectedDate`. `cadence` is the only name that matches on both sides.
All 21 tests build their input by hand or from a live in-memory detector result; **no
test anywhere calls the store and feeds the result to the projector**, which is why this
has never fired. The first person to wire them together gets silence, not an error:
every bill returns "no confident date", every id renders as `undefined:undefined:monthly`,
every confidence is `NaN`. The screen would show a client with **no bills at all**,
which reads as "you are fine" rather than "we could not read your bills".

**M12 · The real billing day is worked out and then thrown away, and a test now locks
the omission in place.**
`src/banking/recurring.mjs:1138`, `src/banking/recurring.pg.test.mjs:168`,
`src/banking/recurring.test.mjs:948-960`
The detector computes the true day of the month at `recurring.mjs:1091` and its own
comment at 1082-1090 says it **cannot be recovered afterwards** — a bill on the 31st
gets clamped to the 30th in a short month. `toBillRow()` returns 16 keys and this is not
one of them, and `anchor_day_of_month` appears in **zero** files of any kind, including
every `.sql`. So rent charged on the 31st, once saved and read back, is pinned to the
30th forever — the exact bug `cashflow-seam.mjs:152-158` says a month-end test already
caught once in memory. The schema test only asks "is every field we write a real
column?", never "is every field the reader needs actually stored", and a unit test
asserts the exact 16-key set, so **adding the missing field now breaks a green test**.

**M13 · Two tables and four rules shipped for alerts, with nothing to save a decision
and nothing to make one.**
`src/alerts/evaluate.mjs:295`, `db/migrations/078_alerts.sql`, `079_upsell_triggers.sql`
`src/alerts/` contains exactly two files and no store — unlike every other domain in
this repo (`src/banking/store.mjs`, `src/tradelines/store.mjs`,
`src/liabilities/store.mjs`, and four more). Searching every `.mjs` and `.js` for any
query against the alerts table returns **zero hits**. The string `upsell_triggers`
appears twice, both in comments. Nothing outside `src/alerts/` imports the module at
all. If an owner switches a rule on by setting `enabled = true`, **nothing happens,
ever** — the feature looks configurable while being entirely inert. The rules themselves
are excellently tested (57 tests, 99.58% line coverage); there is simply nothing to test
past them. Contrast migration 087, which shipped with its store
(`src/banking/reminders.mjs`) and a 598-line database test.

**M14 · Totalling someone's hours from raw shift records crashes instead of returning a
number.**
`src/shifts/timesheet.mjs:182`
`shiftSeconds()` throws in six separate cases rather than returning a value — including
whenever a shift was auto-closed with no evidence. The throw travels upward:
`secondsWorked()` loops it with no error handling, and `hoursWorked()` calls that. So
any future payroll screen that totals hours from the shifts table errors out the moment
one such shift is in the list. `timesheet()` is the only safe entry point — it removes
those rows first. Blast radius today is **nil**: there is no production importer of this
file anywhere.

**M15 · The two brand-new endpoints have no tests at all.**
`api/read/finance-os.mjs:33`, `api/read/banking-surface.mjs`
Both are live in the routes map (`netlify/functions/api.mjs:131` and `:139`). Searching
every file under `src/` and `scripts/` for either filename or route string returns only
the router itself and two manual smoke scripts that need a hand-typed client id and a
running server, so they run for nobody automatically. Untested: the wrong-method
rejection, the malformed-id rejection, the role gate, and the error mapping. In
`banking-surface.mjs` specifically, the column list at lines 45-51 is the only thing
standing between a read endpoint and the encrypted bank token one join away — and
nothing asserts that list. Someone widening it to `SELECT *` breaks nothing visible; the
suite still reports 1749 passing.

**M20 · Both new screens are registered but nothing links to them, and neither has a
way out.**
`public/app/shell.js:24`
The two screens are added to the allowed list, so the session chip tells a closer they
have 25 tabs — but the sidebar renders 23 rows and **no screen anywhere links to
either one**. Neither `finance-os.html` nor `banking-surface.html` contains a single
`<a>` element: no sidebar, no logo, no back link. The only way in is typing
`/app/finance-os.html?client_id=<uuid>` by hand; the only way out is the browser Back
button. In practice the two headline deliverables of W9 and W10 are invisible. The
comment at `shell.js:35-37` still claims the list is "every screen the sidebar links
to", which is now false.

### Operations

**M18 · The health check says "up" no matter how far behind the database is.**
`src/http/health.mjs:81`
It counts rows in the migrations table and reports healthy whenever that query
succeeds. It never compares the count to what should be applied. Meanwhile
`netlify.toml:7` sets the build command to an echo — **the deploy does not run
migrations** — and there is no CI to run them either. Deploy this branch while
production is still at migration 074 and health returns `{ok: true, state: "up"}` with
HTTP 200, the shell prints "LIVE — 51 migrations applied", and every Finance OS screen
fails on a missing table while the only health signal in the system says everything is
fine.

**M19 · There is no monitoring, no alerting and no runbook anywhere.**
`netlify.toml:7`
No `.github/` directory. No error-reporting or metrics dependency — `package.json` lists
exactly two dependencies, `pg` and `inngest`. `DEPLOY.md` has no rollback, incident or
on-call section. The single observability surface is `/api/health`, and
`src/http/health.mjs:8-14` says it deliberately always answers HTTP 200 so it will not
"trip uptime monitors" — which also means **a standard uptime monitor pointed at it can
never detect a database outage**. If the database stops answering at 2am, the check
stays green and nobody is told; it is found when a person opens the CRM.

**M21 · The recurring-bills listing has no page size and no index it can use.**
`src/banking/store.mjs:238`
The query filters on company, which is the only always-present condition — and none of
the table's four indexes lead with it, so the database must read the whole table and
sort it in memory. There is no `LIMIT`, and the result has no natural bound: one row per
account × merchant × cadence across every client. A company with 3,000 clients averaging
12 bills each is 36,000 rows read, sorted and serialised into one response inside a
10-second function budget, with no page size to turn down because none exists.

---

## Bucket 3 — MINOR

18 items. None of these breaks anything a user can see today.

| # | Finding | Where |
|---|---------|-------|
| m1 | Eleven foreign-key columns on the new tables have no index, so deleting a parent row scans the whole child table. Confirmed by query plan on the live database. Free while the tables are empty; appears the first time a real client's history is deleted. | `db/migrations/084:55`, `078:46/52/117/119`, `077:130/131/150`, `083:153`, `084:80`, `079:104` |
| m2 | `soft_pull_requests.subscription_id` has no link enforced, on a stated reason that is false on this branch (the subscriptions table *does* exist by then). A pull billed to a mistyped plan id silently vanishes from any cost-by-plan total. | `db/migrations/077:145` |
| m3 | The subscription tier is free text, trimmed but never case-corrected. "Starter" and "starter" become two plans in any count, with no error. | `db/migrations/075:110`, `src/subscriptions/store.mjs:143` |
| m4 | The alert rules read interest rates without normalising units, then turn the result into a dollar figure. If rates arrive as `24.99` instead of `0.2499`, a claimed annual saving of $960 becomes **$96,000**. The helper that resolves exactly this ambiguity exists next door and is not imported. Ties to K9. | `src/alerts/evaluate.mjs:162`, `:546` |
| m5 | Banking Surface adds amounts in different currencies together, which migration 081:80-81 explicitly forbids. Nothing marks the total as mixed. | `src/finance/banking-surface.mjs:144` |
| m6 | Saving a detection makes three database round trips per bill inside one open transaction — 120 sequential trips for 40 merchants, holding locks throughout. The inner helper is carefully batched; the loop around it is not. | `src/banking/store.mjs:195` |
| m7 | `?key=` means the dashboard secret in one file and the pipeline name in another, so the documented shared-secret route to the pipeline board is unreachable — it always returns 401. Fixing M2 removes this as a side effect. | `src/http/dashboard-auth.mjs:27`, `api/dashboard/pipeline.mjs:60` |
| m8 | Reading a partner's brand settings has no role check, so any staff row (including a rival white-label partner) can read another partner's colours, name and selected funnels. The write path is correctly gated; only the read is open. | `api/partner-brand.mjs:96` |
| m9 | The test that proves rollback works uses a fake database handle that has a capability the real one lacks, so it exercises a path production never takes. This is why M7 survived review. | `src/banking/store.test.mjs:264` |
| m10 | A card-history row can be left permanently unlinked to the position it feeds, because the third of three writes is a plain update with no retry safety and nothing reconciles it. The row then silently drops out of any joined view. | `src/liabilities/store.mjs:95` |
| m11 | The one branch in a tier change that only fires when two people edit at once is never executed by any test, and it throws a generic error that a future endpoint would turn into a 500 rather than "someone else just changed this". | `src/subscriptions/store.mjs:259` |
| m12 | Nothing schedules the sweep that closes forgotten shifts. A person who forgets to clock out cannot clock in the next day until someone fixes the row by hand. Flagged as an owner decision because it affects pay. | `src/shifts/store.mjs:287` |
| m13 | Thirteen modules across W2/W4/W5/W6/W7/W8 have **zero production callers** — nothing in the fifty-odd API handlers imports any banking, liabilities, subscriptions or alerts module. Not a runtime failure; a reporting one. Treat the Finance OS as a library, not a working system. | `src/banking/store.mjs:1` and twelve more |
| m14 | Four deliberate empty seams, all honest — each returns a named refusal rather than a plausible-looking answer, which is the right shape. Listed for completeness. | `src/banking/plaid.mjs:272`, `src/finance/soft-pulls.mjs:225`, `api/documents/[id].mjs:84`, `db/migrations/030:34` |
| m15 | Exactly two TODOs exist in the whole codebase, both saying two consent controls sit on the wrong screen. No TODO anywhere in W1–W10 code. | `public/app/ops-admin.html:432`, `public/crm.html:8974` |
| m16 | A value that is both unknown and incomplete renders as the literal string `—+`. The plus means "there is more than this"; attached to "we have no number", it reads as a glitch. | `public/app/finance-os.html:41`, `public/app/banking-surface.html:42` |
| m17 | A server crash is reported to the user as "backend unavailable" — a database outage. The banner appears correctly; it just names the wrong system, and whoever is called spends the outage checking the database instead of the function logs. | `public/app/data.js:83` |
| m18 | The confidence floor that decides whether a detected bill is safe to show a person has **no consumer** — no endpoint and no screen renders cash-flow or bills at all. The two screens that exist establish the opposite habit (show everything, mark it incomplete). | `src/banking/cashflow-seam.mjs:271` |

---

## Bucket 4 — COMPLIANCE

Ten items. Per CLAUDE.md §7 these need explicit human approval and are never ranked as
critical or major here, regardless of technical severity.

> **COMPLIANCE REVIEW REQUIRED** — this section covers dispute logic, credit-pull type,
> consent capture, fee timing, payment rails and retention.

### K1 · The record of who viewed a client's Social Security number is not protected the way the documentation says it is
`src/pii/index.mjs:200` — found independently by three tracks.

The module promises that the access log is written **in the same transaction** as the
reveal, so a failure to record the access aborts the disclosure. It does not. The check
`if (typeof db.connect !== "function")` always passes, because the shared database
handle (`src/db.mjs:33`) has no `connect`, so the reveal and the log run as separate
independent writes. The *safe* direction survives by luck — the log is written before
the decrypt, so a failed log still blocks the disclosure. What breaks is the reverse: if
the decrypt fails afterwards (wrong or rotated key), the log **permanently records that
a named employee viewed a consumer's SSN on a request where no SSN was ever returned.**
The audit trail over-reports disclosure and cannot be reconciled. A working fix already
exists at `src/finance/soft-pulls.mjs:484-489`; that author deliberately did not touch
this path, saying it deserved its own review. Nobody picked it up.

### K2 · A credit pull is authorised by a typed sentence, not by any consent record
`db/migrations/077_soft_pull_requests.sql:138`

Authorisation is modelled as free text with a "not blank" rule. There is no consent id,
no document reference, no signature, no client acceptance timestamp. A consent document
type **already exists** — `soft_pull_consent` in `src/documents/kinds.mjs:23`, described
in `db/migrations/030_documents.sql:75` as "the C-00 soft-pull consent gate" — and
neither `src/finance/soft-pulls.mjs` nor `api/finance/soft-pull.mjs` references it.
No code path checks that a consent document exists before a pull is filed. An employee
types "client asked" and files a credit-pull request for anyone, with no artefact to
produce if the client later disputes the inquiry. Nothing transmits today; the ledger
and the ingest path both work.
**Open question for a human:** is a typed reason sufficient authorisation, or must an
unexpired `soft_pull_consent` document be present?

### K3 · The FCRA rules are not written down anywhere near the credit-pull code, and the directory CLAUDE.md points at does not exist
`src/finance/soft-pulls.mjs:1`, CLAUDE.md §7

`docs/compliance/` does not exist. Searching the whole tree for "FCRA" and "permissible
purpose" returns **zero hits** in the soft-pull migration, the soft-pull module, or the
soft-pull endpoint. The only mentions are in the unrelated mail module, one line of a
workflow narrative, and one generic sentence on the public privacy page. The unresolved
question — permissible purpose differs for a client checking their own file versus an
employee checking it — sits in a workflow document nobody is instructed to read. The next
person to extend this path has nowhere to look up the rule, so they either invent one or
skip the check.

### K4 · Storing real bank credentials is one environment variable away, before any of four sign-offs
`db/migrations/080_plaid_items.sql:1`, `docs/workflows/finish-the-build/W5.md:283`

The encrypted token column holds long-lived permission to read a real person's bank
account. The engineering controls are genuinely good — AES-256-GCM, key from environment
only, never logged or returned, stripped from responses, feature disabled outright when
the key is absent. Four things are open: SOC 2 review of credential storage (key
management, rotation, who can read the database, retention, revocation), the consent
wording and capture flow, the retention and deletion answer, and whether Plaid is the
chosen provider under which agreement. The author **deliberately broke this repo's own
"set new env vars yourself" rule** and left `PLAID_CLIENT_ID`, `PLAID_SECRET` and
`PLAID_TOKEN_ENC_KEY` unset.
**Action:** CLAUDE.md §11 needs an explicit carve-out naming those three variables, so
nobody sets them by following the standing instruction. There is also no revocation or
deletion path — no delete of a bank login exists anywhere.

### K5 · There is no data retention or deletion policy, and the public privacy page promises one
`src/documents/README.md:155`, `db/migrations/030_documents.sql:34`,
`public/privacy/index.html:102`

Searching for retention, purge or deletion logic across `src/`, `api/`, `netlify/`,
`scripts/` and `db/` finds only test-fixture cleanup — never production code. No expiry
on raw credit-report payloads, no expiry on the PII access log, no expiry on the
soft-pull ledger, no deletion path for bank logins. The published privacy statement
tells the public data is "deleted or de-identified" when no longer needed. No code does
that. Credit-report payloads accumulate indefinitely.
**Needs a written retention schedule per data class before it needs code.**

### K6 · Deleting a client leaves their bank transactions behind, unreachable and undeletable
`db/migrations/085:187`, `086:213`, `081`

Reproduced on the live database. Transaction rows are set to keep the record when a
client is deleted — justified at 085:185-186 as "deleting a client must not destroy the
record that the money moved". But the accounts *are* deleted, and the account link is
not enforced (see M17). So a merchant-level spending history for a deleted person
survives with no route back to the person **and** no route to the account. A later
erasure request or subject-access request cannot find it.
**This retention decision was made by an ordering accident, not by policy.** It needs the
sign-off CLAUDE.md §7 requires — it is a retention decision, not a schema tidy-up.

### K7 · The hiring tool keeps the audit data but has never notified a candidate, and no bias audit exists
`src/hiring/pipeline.mjs:122`, `api/hiring/application.mjs:72`,
`db/migrations/051:522`

The posture here is unusually careful and should be said plainly: the grader is
deterministic with no AI model and no clock, filters protected characteristics out
before anything is scored, cannot reject anyone, records the rubric version so a bias
audit is possible, and tracks how often humans follow the machine. Migrations 051 and
053 name NYC Local Law 144 directly. Two gaps: the scoring notice is served behind a
staff role gate, so it reaches the **reviewer, not the candidate**; and
`hiring_decisions.candidate_notified_at` is read by two endpoints and **written by
nothing** — no writer exists anywhere. No bias-audit artefact, report or scheduled
analysis exists in the repo.
**Open for a human:** is the notice delivered outside this repo (job board, external
ATS), and has an audit been commissioned? If not, both LL144 obligations are unmet for
any New York City applicant.

### K8 · The wage-inference policy was merged with its compliance flag still open
commit `c6ae18e`, `src/shifts/timesheet.mjs:1-125`,
`docs/workflows/finish-the-build.md:250-345`

The commit message says so verbatim: "The author flagged this for human sign-off; it is
merged with that flag still open." The policy values a shift that nobody can vouch for
at the median of that person's own completed shifts, capped at the record's last-touched
time, and leaves anyone with no completed shifts at zero and flagged. It cites FLSA
29 CFR 516.2 and *Anderson v. Mt. Clemens Pottery*. Nothing reads the review list, no
screen shows it, and **no wage rate exists anywhere to multiply these seconds by** — the
$6.25/hr and related constants were deleted on 2026-07-31. Related: M14 (the crash) and
m12 (no sweep scheduled).

### K9 · The alert rules produce sentences about a person's credit, and one of them attaches a dollar figure
`docs/workflows/finish-the-build/W4.md`, `db/migrations/078_alerts.sql`

Two of the four rules make statements about a person's credit: one names a score band,
one attaches a money figure. Those become claims about a credit outcome the moment they
reach a client-visible screen. The mitigations are real: the code refuses adjectives
like "good" or "excellent" and returns band labels only, the title column carries a
NOT-CUSTOMER-FACING warning, and every rule ships switched off with empty thresholds and
zero rows. The saving figure is explicitly one year of interest-rate difference on an
existing balance, ignoring fees, promotional rates and approval odds — arithmetic, not a
promise. **See m4: an unnormalised interest rate can inflate that figure 100-fold.**
Human sign-off required before any of it is shown to a client.

### K10 · Cash-flow estimates shown to a consumer — flagged, not reviewed
`docs/workflows/finance-os-banking.md:354`

The author raised `COMPLIANCE REVIEW REQUIRED — estimates shown to a consumer` for the
W8 projection work, and explicitly declined to raise it for the W7 detection work at
line 259 of the same file. Nothing renders these estimates yet (see m18), so the flag is
open and not yet load-bearing.

### The one thing that makes all of the above survivable

**Nothing transmits.** There is no outbound network call in `src/adapters/` or
`src/lib/`. Queued messages are written as database rows with status `queued` and never
sent. `src/mail/` has no scheduler, no send path and no activation flag. Alert rows are
records, not notifications. Every new threshold ships unset and every new rule ships
off. No code path can reach a bank or a credit bureau. This is the repo's main safety
property and it held everywhere the tracks looked.

---

## Confirmed sound — do not re-check

Recorded so a later pass does not spend time here.

- All fifteen migrations 075–089 present, no gaps, no duplicate leading numbers, across
  both `db/migrations/` and `db/schema/`.
- Every one of the fifteen re-applies cleanly against a live database (each wrapped and
  rolled back): every create guarded, every alter guarded, 088's seed is
  conflict-safe, and 089's update self-disables after the first run.
- Additive only: no drop table, drop column, alter column, rename, delete or truncate
  anywhere in 075–089. The four `DROP TRIGGER` statements are each immediately followed
  by a create, inside the runner's per-file transaction.
- The check constraints exist as designed: account entity kind restricted to
  unknown/personal/business; interest rate bounded 0–1 on both card tables; score
  threshold bounded 300–850 with full coverage of every new score column.
- `isPlaidEnabled` fails closed in all six tested cases — empty environment, each
  variable missing, empty strings, unrecognised environment name.
- The composite key that stops a card being charged for the wrong client
  (`subscriptions_card_fk`) exists and works.
- The cash-flow config gap view *does* handle a company with no settings row at all, so
  088's default-company seed is not a blind spot for white-label tenants.
- Coverage on W1–W10 module code is **not** below 80% — measured against real Postgres
  with the database tests actually running: most modules 96–100% by line. The weak
  numbers are branch coverage (`subscriptions/store.mjs` 67.57%,
  `liabilities/store.mjs` 76.92%). The real hole is the endpoint layer — see M15.
- No endpoint test is misplaced under `api/`. That trap has not been re-triggered.
- The four alert evaluators are thoroughly tested at every boundary, including an
  explicit assertion that no judgement adjective leaks out.
- No `SELECT`-inside-a-loop exists anywhere in `src/banking/`. The N+1 hypothesis is
  not confirmed; the only in-loop database access is the write pattern at m6.

---

## Could not be verified from here

Stated as absences, not filled in with assumptions.

1. **Which migrations are applied to the production database.** `api.netlify.com` and
   `api.supabase.com` are blocked by network policy (403 at CONNECT). No track routed
   around it. 089 is newest and most likely unapplied. **M18 assumes production may be
   behind; that was not confirmed.**
2. **Whether more than one company row exists in production.** This single fact decides
   whether **C1 is live or latent**. The schema seeds exactly one; production state is
   unknowable from here and must not be assumed.
3. **CI status.** There is none to read — no `.github/` directory exists.
4. **Whether Netlify currently has `DASHBOARD_SECRET` set**, and whether the three
   Plaid variables remain unset. If the dashboard secret is unset, that gate fails
   closed (correct), but M1/M2 then describe a path that may not currently be enabled.
5. **Whether any staff row actually holds `role='partner'` in production.** M1's real
   severity depends on it.
6. **Mobile rendering of the two new screens.** No browser in this environment. Static
   reading shows both declare a viewport and a small-screen rule; whether the fixed
   session chip overlaps the title, or the fixed bottom banner covers content, could not
   be confirmed. Not reported as findings.
7. **Whether the row-security policies the partner surface relies on actually cover
   every table those endpoints read.** The policies were read as SQL, not executed. If
   any table lacks one, ten partner endpoints leak with no second lock.
8. **The cross-site-scripting review was a sample, not an audit.** 252 innerHTML sites
   exist across `public/app`; 20 of 27 screens define an escaping helper and the ones
   read escape correctly. Seven screens with no helper were not individually checked.
9. **Whether the LL144 candidate notice is delivered outside this repository**, and
   whether a bias audit has been commissioned. Absence here is not proof of absence
   overall.
10. **Whether the two competing W4 branches still exist.** Neither is visible from this
    clone. The open question W4.md raises — the unmerged version stamps the threshold
    onto each alert row, which its own author calls the better design — cannot be
    settled from here.

---

## Suggested order of work

1. **C1** first. It is the only critical item and the fix is mechanical but touches
   twelve files, so it wants one dedicated workflow.
2. **M5, M6, M7** next — three proven bugs on live routes, all fixed by the same two
   patterns (let the database adjudicate; use the transaction helper that works).
3. **M8, M9, M10, M20** as one workflow — the entire Banking Surface story: no data
   source, invented figures, no feature gate, unreachable, and wrong maths.
4. **M1, M2, M3, M4** as one security workflow.
5. **K1, K2, K6** need a human decision before any code is written.
6. **M11, M12, M13** are the "built but unreachable" cluster — do them together with the
   wiring work, not before it.

---

## Notes for the next agent

- Editing an already-applied migration is a **silent no-op**. `db/migrate.mjs` keys
  `schema_migrations` on `<dir>/<file>`. Every schema fix above must be a **new file**,
  090 or later. 089 shows the correct pattern.
- `npm test`'s glob is `src/**` and `scripts/**` only. A test placed under `api/` never
  runs. Endpoint tests live at `src/http/<name>.pg.test.mjs` and import the `api/`
  handler.
- Three of CLAUDE.md §6's six gates cannot run in this repo (no lint script, no
  TypeScript, no Playwright). Say so rather than reporting them green.
- `docs/journeys/` and `docs/compliance/` do not exist. Do not create journey files from
  memory to satisfy §4 — the absence is the finding, and it is recorded here.
