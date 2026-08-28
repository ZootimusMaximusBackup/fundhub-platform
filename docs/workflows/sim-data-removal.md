# Sim / fake data removal

Owner: Chris. Run by one session on branch `merge/2026-08-27-threads-live`.
Measured against the **production** database on 2026-08-27, read-only.

## The short version

The system has a "Demo Mode" that marks its rows with an `is_demo` flag, and every
screen hides flagged rows. That part works. **The problem is that almost none of the
fake data was ever flagged.** Only 14 rows in the whole database carry the flag.

Everything else — the test clients, their signed contracts, their messages, their
payment links — was written by verification and audit runs straight into the live
database with the flag left off. So it counts as real, shows on every screen, and
the built-in wipe (`teardownSimulated`) skips it, because that function only ever
deletes clients where `is_demo = true`.

Nothing was cleaned up. That is why it is still there.

## What is flagged today (the 14 rows the wipe can see)

| rows | table |
|---|---|
| 7 | staff |
| 2 | accounts |
| 1 each | affiliates, clients, crs_results, inquiry_log, partners |

No org has `demo_mode_enabled` turned on. No client uses the `sim+@demo.fundhub.local`
address pattern the seeder writes.

## What is NOT flagged — the actual mess

**101 of 153 clients are fake.** 52 are real (35 ClickFunnels, 9 no source,
7 website:home, 1 commas).

Caught by: name starting Sim / Gauntlet / Mock / Test / Demo / Probe; an email at
`example.com` / `example.test` or a `+sim` / `+test` / `+gauntlet` plus-tag; or a
channel source of `sim`, `gauntlet*`, `five-*`, `probe`, `pipeline`,
`crs-company-prove`, `live-send-window`.

Checked for false positives: of the 47 caught rows that sit under a *real* source
name (clickfunnels / commas / website:home), every one is a test address —
`example.test`, `example.com`, or a plus-tagged gmail. **No real lead is caught.**

### 1,583 child rows hang off those 101 clients

| rows | table |
|---|---|
| 553 | events |
| 478 | messages |
| 120 | tasks |
| 115 | documents |
| 114 | payment_links |
| 42 | agent_runs |
| 36 | contracts |
| 32 | contract_signers |
| 25 | transactions |
| 22 | commission_ledger |
| 13 | invoices |
| 12 | outbound_calls |
| 8 | failed_events |
| 8 | pii_access_log |
| 3 | repair_decision_log |
| 2 | applications |

### Contracts: all 44 are test artifacts

Every contract row in the database was written by a test or audit run. Signer names
on file include `Sim Repair`, `Sim Funding`, `Sim Combo`, `Sim Inquiry`,
`Mock CloserSign`, `TEST — Client Role`, `Real Person`, and one obvious joke entry.
Several carry a placeholder fingerprint (`sha256:abababab…`) instead of a real one.

**Two need your call before they go:**

- `EMPLOYEE-SALES-MANAGER-AGREEMENT` — signed, *Sarah Blankstein* (2 copies)
- `EMPLOYEE-CLOSER-AGREEMENT` — signed, *Justice Nikkel*

If those are real hires, they stay. Everything else in contracts goes.

## Where the fake data comes from

| file | what it makes | fires in production? |
|---|---|---|
| `src/demo/simulate-client.mjs` | one simulated client + credit result, tradelines, card, bank account | yes — flags correctly |
| `src/demo/platform-seed.mjs` | full Demo Mode set: clients, lenders, affiliate, partner, funding rounds, applications | yes — flags correctly |
| `src/demo/seed-ui-coverage.mjs` | rows to fill empty CRM screens | yes |
| `src/auth/demo-logins.mjs`, `src/auth/demo-roster.mjs`, `src/auth/seed-role-accounts.mjs` | demo staff logins | yes |
| `src/verification/journeys/*` | **the real source of the mess** — audit runs that create clients, contracts, messages without setting `is_demo` | yes, and unflagged |

`src/demo/exclude-demo.mjs` is what hides flagged rows from screens. It is fine. It
just has nothing to hide, because the flag is off on almost everything.

## Plan

1. Flag every fake client and its 1,583 children `is_demo = true` — reversible, nothing lost.
2. Confirm the screens go clean.
3. Delete them, children before parents. **Needs Chris's explicit yes (CLAUDE.md §11).**
4. Make the verification harness set `is_demo` on everything it writes, so this cannot
   build up again.

## What was actually done (2026-08-27)

Chris confirmed Sarah Blankstein and Justice Nikkel are real hires. Their three
signed employment agreements are excluded from every step below.

### Step 1 — flagging: DONE and committed to the database

| flagged | table |
|---|---|
| 100 | clients (101 now flagged in total) |
| 553 | events |
| 478 | messages |
| 120 | tasks |
| 115 | documents |
| 114 | payment_links |
| 41 | contracts (44 total, minus Sarah ×2 and Justice) |
| 25 | transactions |
| 22 | commission_ledger |
| 13 | invoices |
| 2 | applications |

**The fake data is hidden from every screen as of now.** 1,583 rows flagged.

### Step 2 — permanent delete: BLOCKED, nothing deleted

Every delete attempt ran inside a transaction and rolled back. The database is
unchanged apart from the flags above.

Four obstacles were found and solved along the way:

1. `contract_signers` reaches contracts by a second link — cleared by contract id.
2. `documents` and `document_versions` point at each other — the cycle opens by
   dropping the "current version" pointer first.
3. `failed_events` cannot be deleted **by design** (`039_failed_events.sql`, no
   `is_demo` escape hatch). Correct handling is to mark them `ignored`, and to
   detach the 8 activity rows they pin from the fake client.
4. `affiliate_payout_lines` is a money row with an after-trigger that recreates it
   during a sweep — it has to be detached last.

The fifth was misdiagnosed at first and is worth recording, because the wrong fix
looked reasonable.

A `DELETE` kept failing on `affiliate_payout_lines` — a table our own `SELECT`
reported as holding one already-detached row. The reason: row-level security hid
rows from the connection, but a foreign key is checked by the database itself and
still sees them.

The tempting fix was `SET row_security = off`. **That is wrong twice over.** It is a
bypass of the control that separates tenants, and `fundhub_app` is refused it anyway
— the role holds neither `BYPASSRLS` nor table ownership, deliberately
(`104_app_role.sql`). The statement is accepted and then every query errors with
*"query would be affected by row-level security policy"*.

The real fix is that the script was missing the staff context the app itself sets on
every connection (`src/partners/rls.mjs`): `set_config('fundhub.actor', 'staff')`.
With it stamped, the policies grant the same view the app has and the counts are
honest. No bypass, no elevated role.

`scripts/purge-sim-data.mjs report` now runs clean.

A sixth and last one, and it is the only one that was left standing on purpose.

The final blocker named the constraint `affiliate_payout_lines_referral_id_fkey` —
**referral**, not client. One test client has an affiliate referral, and that
referral has a line on an affiliate payout run. Deleting the client cascades to the
referral and forces a change to that line. The run is **paid**, and a paid run's
lines are the payout statement: `033_affiliates.sql` refuses to let them change, by
design.

That client stays, flagged as demo so no screen shows it. The guard was not
weakened. Money records win over tidiness.

### The delete: DONE, 2026-08-28

```
clients deleted: 100 | child rows deleted: 1,726
clients:   153 → 53   (52 real, plus the one paid-payout fixture above)
contracts:  44 → 3    (Sarah Blankstein ×2, Justice Nikkel — all real)
```

`npm run sim:report` now returns **0 fake clients**.

Two things were kept rather than deleted, both deliberately:

* 8 `failed_events` error logs — undeletable by design; marked `ignored` and their
  8 activity rows detached from the client.
* the one client on the paid payout run, above.

### Step 3 — the cause, fixed in code

Two edits, so this stops happening:

* `src/verification/insert-client.mjs` — the single chokepoint every verification
  journey creates clients through. It never set `is_demo`. It now always does, and
  it is not a caller option: everything this function makes is a fixture.
* `src/contracts/send.mjs` — a contract now inherits `is_demo` from its client,
  read off the client row rather than passed in. Every caller that made a fixture
  contract would otherwise have to remember, and none of them did.

Gates: `npm run lint` clean. Test suite **79 failures with the change and 79
without it** — no regression. Those 79 are pre-existing on this branch and come
from a missing export, `logoPathOrPlaceholder`, in `src/lenders/resolve-logo.mjs`,
which breaks imports across many files. That is unrelated to this work but is the
exact shape of the trap in CLAUDE.md §12 that kills Netlify deploys — worth its own
task.

`npx tsc --noEmit` was not run: there is no tsconfig in this repo, so it checks
nothing.

### Step 4 — making this fast from now on

Three npm scripts, so an audit clean-up is one line instead of an investigation:

| command | what it does |
|---|---|
| `npm run sim:report` | counts the fixtures left behind. Changes nothing. |
| `npm run sim:hide` | flags them so every screen hides them. Reversible. |
| `npm run sim:purge` | removes them permanently, in one transaction. |

**Run `npm run sim:report` at the end of every end-to-end audit.** With the harness
fix above, new fixtures arrive already flagged, so they never show on a screen in
the first place — the report is just the count, and `sim:purge` clears them.

The whole delete is one transaction. If any part of it fails, nothing is removed.

## Step 5 — what the 2026-08-27 merge broke, fixed

The 79 failing tests were not this work. They were merge damage, and one piece of it
was live in production.

**The merge dropped code without conflicting.** Two branches each *added* a file at
`src/lenders/resolve-logo.mjs` — one holding `resolveLogoPath`, the other holding
the placeholder helper. To git that is one new file, not two edits, so it took one
whole version and silently discarded the other. Nothing to review, no conflict
marker.

| fixed | what was wrong | effect |
|---|---|---|
| `src/lenders/resolve-logo.mjs` | `logoPathOrPlaceholder` and `LENDER_LOGO_PLACEHOLDER` gone, still imported by `src/lenders/store.mjs` | every import chain through the lender store threw at load; **30 tests**. This is the CLAUDE.md §12 shape that kills Netlify deploys. |
| `api/read/underwrite.mjs` | the `linesForEngine` import was dropped while the call and its comment stayed | **UnderwriteIQ returned nothing on every request, in production**; 23 tests |
| `src/workflows/index.test.mjs` | pinned count still 63 | the merge brought in `daily-pulse` (acfa8bc9) and `af-01-affiliate-drip` (bc05c169); both real, so the pin moved to 65 |
| `docs/journeys/*-actual.md` | stale against the repaired code | regenerated with `npm run journeys`; changelog appended |

Both missing imports pass `npm run lint` and would pass a type check. A bare
identifier is legal JavaScript right up until it runs.

**Test suite: 79 failures → 24.**

## Left undone

* **24 failures remain, and they are not import damage — they are real
  disagreements in the product logic** that need a decision, not a repair. The
  largest cluster is closer-deck and UnderwriteIQ reporting different stacked
  totals for the same client. Which number is correct is a business call, so it was
  not guessed at. Also in there: `computeKpis` counting funded rounds vs
  `clients.funded`, the route-gate registry needing new entries acknowledged, and
  a couple of pinned manifests. Worth its own task.
* Nothing was committed: a hook blocks `git commit` on this branch.
* **Not mine, noticed in passing:** another session sharing this checkout changed
  the public short link in `netlify.toml` from `/go` to `/optimize.com`, plus the
  matching note in `docs/company-resources/`. Both are uncommitted and were left
  untouched. `/optimize.com` looks like a mistake worth a second look.

## Status

All done, 2026-08-28.

- Workflow A — counts: **done**.
- Workflow B — sources: **done**.
- Workflow C — flag, delete, cause fixed, one-command clean-up added: **done**.
